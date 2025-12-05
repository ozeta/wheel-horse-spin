// Minimal Node WebSocket server for Wheel Horse Spin multiplayer
// Rooms, lobby -> countdown -> race -> results, bots fill to 10 lanes
//
// Setup & Run:
// 1) Install dependencies (ws)
//    cd multiplayer-race
//    npm install
//
// 2) Start the server (default port 8080)
//    npm start  # uses PORT env if provided
//    # or
//    node server.js
//
// 3) Optional: run thin client(s) in another terminal to simulate players
//    node thin-client.js ws://localhost:8080 roomId=dev username=Alice
//    node thin-client.js ws://localhost:8080 roomId=dev username=Bob

require('dotenv').config();

const http = require('http');
const express = require('express');
const RateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const validator = require('validator');
const xss = require('xss');
const path = require('path');
const { WebSocketServer } = require('ws');
const { execSync } = require('child_process');
// Optional database integration (auto-migrate on startup if DATABASE_URL present)
let dbPool = null;
try {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const connStr = process.env.DATABASE_URL;
    let poolConfig = { connectionString: connStr };
    // Enable SSL only when explicitly requested or when URL scheme requires it
    const wantSSL = String(process.env.DATABASE_SSL || '').toLowerCase() === 'true';
    try {
      const u = new URL(connStr);
      const host = u.hostname || '';
      const hostedProvider = /render|azure|amazonaws|heroku|supabase|neon|timescale/.test(host);
      if (wantSSL || hostedProvider) {
        poolConfig.ssl = { rejectUnauthorized: false };
      }
    } catch {}
    dbPool = new Pool(poolConfig);
    // Run migrations idempotently
    const { migrate } = require('./db/migrate');
    migrate(dbPool).catch(err => console.error('[db] migrate error', err));
  }
} catch (err) {
  console.error('[db] init failed', err);
  dbPool = null;
}

// Get commit SHA at startup (fallback if git not available or not a git repo)
let COMMIT_SHA = 'unknown';
try {
  COMMIT_SHA = execSync('git rev-parse --short HEAD', {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
  }).toString().trim();
} catch (err) {
  // Git not installed, not a git repo, or other error - use env var or timestamp
  COMMIT_SHA = process.env.COMMIT_SHA || `build-${Date.now()}`;
}

// --- Constants ---
const INPUT_KEY = 'E';
const DEFAULT_PLAYERS = 2;
const MAX_PLAYERS = 6; // humans
const TOTAL_LANES = 8;
const COUNTDOWN_SECONDS = 3;
// Tick frequency: higher values yield smoother client updates (at cost of bandwidth)
const TICK_RATE_HZ = 60;
const BOOST_FACTOR = 2.0; // increased from 1.4 for more noticeable boost
// Motion tuning: when not boosting, players decelerate toward an idle speed.
// Accel/decel rates are in progress-per-second change per second (applied over dt).
const IDLE_SPEED_FACTOR = Number(process.env.IDLE_SPEED_FACTOR ?? 0.6); // vs base
const ACCELERATION_RATE = Number(process.env.ACCELERATION_RATE ?? 0.25); // per sec - increased from 0.12 for faster boost response
const DECELERATION_RATE = Number(process.env.DECELERATION_RATE ?? 0.20); // per sec
// Bot-specific motion tuning
// Make bot base speed equal to player start (idle) speed by default
const BOT_IDLE_SPEED_FACTOR = Number(process.env.BOT_IDLE_SPEED_FACTOR ?? IDLE_SPEED_FACTOR);
const BOT_ACCELERATION_RATE = Number(process.env.BOT_ACCELERATION_RATE ?? 0.25);
const BOT_DECELERATION_RATE = Number(process.env.BOT_DECELERATION_RATE ?? 0.22);
const BOT_BOOST_PROB_PER_TICK = Number(process.env.BOT_BOOST_PROB_PER_TICK ?? 0.15); // increased from 0.1
const BOT_BOOST_ENABLE_PROB = Number(process.env.BOT_BOOST_ENABLE_PROB ?? 0.8); // increased from 0.7

const BOOST_MAX_DURATION_MS = Number(process.env.BOOST_MAX_DURATION_MS ?? 300); // Max boost hold time
const BOOST_COOLDOWN_MS = Number(process.env.BOOST_COOLDOWN_MS ?? 50);
const FINISH_DECELERATION_DURATION_MS = Number(process.env.FINISH_DECELERATION_DURATION_MS ?? 2000);

// Base motion constants (should match client)
const MAX_EXECUTION_TIME = 10; // seconds nominal lap duration per single-player

// --- Security Constants ---
const MAX_CONNECTIONS_PER_IP = 5;
const MAX_MESSAGE_SIZE = 10240; // 10KB

// --- Data Structures ---
const rooms = new Map(); // roomId -> Room
let nextClientId = 1;
const connectionsByIP = new Map(); // Track WebSocket connections per IP

function nowMs() { return Date.now(); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// --- Input Sanitization Functions ---
function sanitizeUsername(input) {
  if (!input || typeof input !== 'string') return '';
  const cleaned = xss(input.trim());
  // Allow only alphanumeric, spaces, underscores, hyphens
  if (!/^[a-zA-Z0-9_ -]+$/.test(cleaned)) return '';
  return cleaned.substring(0, 40);
}

function sanitizeRoomId(input) {
  if (!input || typeof input !== 'string') return '';
  const cleaned = xss(input.trim());
  // Allow only alphanumeric, underscores, hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) return '';
  return cleaned.substring(0, 50);
}

function createRoom(roomId) {
  const room = {
    id: roomId,
    phase: 'lobby', // lobby | countdown | race | results
    hostId: null,
    players: new Map(), // clientId -> {id, username, ready, lane, lastResult}
    bots: [], // {username, lane}
    readySet: new Set(),
    countdownEndsAt: null,
    raceStartEpochMs: null,
    raceId: null,
    seeds: {},
    constants: { INPUT_KEY, DEFAULT_PLAYERS, MAX_PLAYERS, TOTAL_LANES, COUNTDOWN_SECONDS, BOOST_FACTOR, BOOST_MAX_DURATION_MS, BOOST_COOLDOWN_MS, IDLE_SPEED_FACTOR, ACCELERATION_RATE, DECELERATION_RATE, BOT_IDLE_SPEED_FACTOR, BOT_ACCELERATION_RATE, BOT_DECELERATION_RATE, BOT_BOOST_PROB_PER_TICK, BOT_BOOST_ENABLE_PROB, FINISH_DECELERATION_DURATION_MS },
    tickTimer: null,
    lastUpdateMs: null,
  };
  rooms.set(roomId, room);
  return room;
}

// Allocate lanes 0..9; players first, then bots
function allocateLanes(room) {
  const lanes = Array.from({ length: TOTAL_LANES }, (_, i) => i);
  // assign human players deterministically by join order
  const playerEntries = Array.from(room.players.values()).sort((a,b)=>a.joinMs-b.joinMs);
  playerEntries.forEach((p, idx) => { p.lane = lanes[idx]; });
  // fill remaining with bots
  room.bots = [];
  const humans = playerEntries.length;
  for (let i = humans; i < TOTAL_LANES; i++) {
    room.bots.push({ username: `Bot_${i+1-humans}`, lane: lanes[i] });
  }
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  room.players.forEach(p => {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(data);
    }
  });
}

function roomStatePayload(room) {
  return {
    type: 'roomState',
    roomId: room.id,
    phase: room.phase,
    hostId: room.hostId,
    players: Array.from(room.players.values()).map(p=>({ id: p.id, username: p.username, ready: !!p.ready, lane: p.lane, lastResult: p.lastResult || null })),
    bots: room.bots,
    constants: room.constants,
  };
}

function startCountdown(room) {
  room.phase = 'countdown';
  room.countdownEndsAt = nowMs() + COUNTDOWN_SECONDS * 1000;
  console.log(`[room:${room.id}] countdown started for ${COUNTDOWN_SECONDS}s (players=${room.players.size})`);
  broadcast(room, { type: 'countdown', secondsLeft: COUNTDOWN_SECONDS, countdownEndsAt: room.countdownEndsAt });
  // Begin ticking so clients can render decreasing countdown time
  beginTick(room);
}

function startRace(room) {
  room.phase = 'race';
  room.raceId = `${room.id}-${nowMs()}`;
  room.raceStartEpochMs = nowMs();
  // seeding per player
  room.seeds = {};
  room.players.forEach(p => { room.seeds[p.id] = Math.floor(Math.random()*1e9); });
  allocateLanes(room);
  // initialize runtime race state for players & bots
  room.players.forEach(p => {
    p.progress = 0; // 0..1 lap completion
    p.finished = false;
    p.finishSeconds = null;
    p.boostDown = false;
    p.boostSinceMs = null;
    p.lastBoostStartMs = null;
    p.lastBoostEndMs = null; // cooldown reference
    p.currentSpeed = 0; // progress/sec, integrated toward target
    p.finishDecelStartMs = null; // when post-finish decel started
    p.fullyFinished = false; // true when deceleration complete
  });
  room.bots.forEach(b => {
    b.progress = 0;
    b.finished = false;
    b.finishSeconds = null;
    b.currentSpeed = 0;
    // Per-bot variation so bots don't move identically - wider ranges for more personality
    b.biasFactor = (0.85 + Math.random() * 0.30); // ~0.85..1.15 (wider from 0.92..1.08)
    b.jitterScale = (0.5 + Math.random() * 1.0); // ~0.5..1.5 (wider from 0.7..1.3)
    b.boostPreference = Math.random(); // 0-1, affects boost decisions
    b.finishDecelStartMs = null;
    b.fullyFinished = false;
  });
  room.lastUpdateMs = room.raceStartEpochMs;
  console.log(`[room:${room.id}] race start (raceId=${room.raceId}, players=${room.players.size}, bots=${room.bots.length})`);
  broadcast(room, {
    type: 'raceStart',
    roomId: room.id,
    raceId: room.raceId,
    raceStartEpochMs: room.raceStartEpochMs,
    players: Array.from(room.players.values()).map(p=>({ id: p.id, username: p.username, lane: p.lane })),
    bots: room.bots,
    seeds: room.seeds,
    constants: room.constants,
  });
  beginTick(room);
}

function endRace(room, results) {
  room.phase = 'results';
  // Reset all players to unready
  room.players.forEach(p => {
    p.ready = false;
  });
  room.readySet.clear();
  // Try to derive winner id from results if present
  let winnerId = null;
  try {
    if (Array.isArray(results)) {
      const sorted = [...results].sort((a,b)=>{
        const ta = (a && (a.finishSeconds ?? a.time ?? a.t)) || Infinity;
        const tb = (b && (b.finishSeconds ?? b.time ?? b.t)) || Infinity;
        return ta - tb;
      });
      winnerId = sorted[0] && (sorted[0].id ?? sorted[0].playerId ?? sorted[0].lane ?? null);
    } else if (results && typeof results === 'object') {
      winnerId = results.winnerId ?? results.winner ?? null;
    }
  } catch {}
  console.log(`[room:${room.id}] race end (raceId=${room.raceId}) winner=${winnerId}`);
  broadcast(room, { type: 'raceEnd', results });
  stopTick(room);
  // Persist race results if DB available
  if (dbPool && results && results.results && Array.isArray(results.results)) {
    saveRaceResults(room, results).catch(err => console.error('[db] saveRaceResults error', err));
  }
  // Do not auto-reset; wait for host to exit or explicit command
}

function beginTick(room) {
  stopTick(room);
  const interval = Math.round(1000 / TICK_RATE_HZ);
  room.tickTimer = setInterval(() => {
    if (room.phase === 'race') {
      updateRace(room);
    }
    // Tick payload includes server time + progress snapshot during race
    let payload = { type: 'tick', tServerMs: nowMs() };
    if (room.phase === 'race') {
      payload.players = Array.from(room.players.values()).map(p=>({ id: p.id, lane: p.lane, progress: p.progress, finished: p.finished, currentSpeed: p.currentSpeed || 0 }));
      payload.bots = room.bots.map(b=>({ lane: b.lane, progress: b.progress, finished: b.finished, currentSpeed: b.currentSpeed || 0 }));
    }
    broadcast(room, payload);
  }, interval);
}
function stopTick(room) {
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

// --- Server Setup ---
const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : '*',
  methods: ['GET', 'POST'],
  credentials: false,
  maxAge: 86400 // 24 hours
};
app.use(cors(corsOptions));

// Rate limiting for API endpoints
const apiLimiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  message: { error: 'Too many requests, please try again later' }
});

// Apply rate limiting to all API routes
app.use('/api/', apiLimiter);

// Serve static files from parent directory (repo root)
const staticPath = path.join(__dirname, '..');
app.use(express.static(staticPath));

// API endpoint to get current commit SHA (cached at startup)
app.get('/api/commit', (req, res) => {
  res.json({ sha: COMMIT_SHA });
});

// Health endpoint: reports basic status and DB connectivity
app.get('/api/health', async (req, res) => {
  const health = { status: 'ok', commit: COMMIT_SHA, db: { configured: !!dbPool, ok: false } };
  if (dbPool) {
    try {
      const r = await dbPool.query('SELECT 1');
      health.db.ok = !!r;
    } catch (err) {
      health.db.ok = false;
      health.db.error = String(err.message || err);
    }
  }
  res.json(health);
});

// Leaderboard APIs (DB optional)
app.get('/api/leaderboard/fastest', async (req, res) => {
  if (!dbPool) return res.json({ items: [] });
  try {
    const { rows } = await dbPool.query(`
      SELECT r.winner_username AS username, r.winner_time_seconds AS time, r.race_timestamp AS ts, r.room_id
      FROM races r
      ORDER BY r.winner_time_seconds ASC
      LIMIT 10
    `);
    res.json({ items: rows });
  } catch (err) {
    console.error('[api] fastest error', err);
    res.json({ items: [] });
  }
});

app.get('/api/leaderboard/top', async (req, res) => {
  if (!dbPool) return res.json({ items: [] });
  try {
    const { rows } = await dbPool.query(`
      SELECT winner_username AS username, COUNT(*) AS wins, MIN(winner_time_seconds) AS best_time
      FROM races
      GROUP BY winner_username
      ORDER BY wins DESC, best_time ASC
      LIMIT 10
    `);
    res.json({ items: rows });
  } catch (err) {
    console.error('[api] top error', err);
    res.json({ items: [] });
  }
});

app.get('/api/leaderboard/player/:username', async (req, res) => {
  const username = String(req.params.username || '').trim();
  if (!dbPool || !username) return res.json({ items: [] });
  try {
    const { rows } = await dbPool.query(`
      SELECT r.race_timestamp AS ts, rp.final_position AS position, rp.finish_time_seconds AS time,
             rp.delta_from_winner_seconds AS delta, r.total_participants AS total
      FROM race_participants rp
      JOIN races r ON rp.race_id = r.id
      WHERE rp.username = $1 AND rp.is_bot = false
      ORDER BY r.race_timestamp DESC
      LIMIT 20
    `, [username]);
    res.json({ items: rows });
  } catch (err) {
    console.error('[api] player error', err);
    res.json({ items: [] });
  }
});

// Players who most recently arrived last among humans, with their last time
app.get('/api/leaderboard/last-humans', async (req, res) => {
  if (!dbPool) return res.json({ items: [] });
  try {
    const room = (req.query.room && String(req.query.room).trim()) || null;
    const sql = `
      SELECT DISTINCT ON (rp.username)
        rp.username,
        rp.human_finish_time_seconds AS time,
        r.race_timestamp AS ts,
        r.room_id
      FROM race_participants rp
      JOIN races r ON r.id = rp.race_id
      WHERE rp.is_last_human = TRUE AND rp.is_bot = FALSE
      ${room ? 'AND r.room_id = $1' : ''}
      ORDER BY rp.username, r.race_timestamp DESC
    `;
    const params = room ? [room] : [];
    const { rows } = await dbPool.query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error('[api] last-humans error', err);
    res.json({ items: [] });
  }
});

// Room summary: per human player -> wins count, last-place count, last win time+seconds, last last-place time+seconds
app.get('/api/leaderboard/room-summary', async (req, res) => {
  if (!dbPool) return res.json({ items: [] });
  const room = (req.query.room && String(req.query.room).trim()) || null;
  if (!room) return res.json({ items: [] });
  try {
    // Wins summary per username in room
    const winsQuery = `
      SELECT rp.username AS username,
             COUNT(*) AS wins,
             MAX(r.race_timestamp) AS last_win_ts,
             (ARRAY_AGG(rp.finish_time_seconds ORDER BY r.race_timestamp DESC))[1] AS last_win_seconds
      FROM races r
      JOIN race_participants rp ON rp.race_id = r.id
      WHERE r.room_id = $1 AND rp.is_bot = FALSE AND rp.final_position = 1
      GROUP BY rp.username
    `;
    const winsRes = await dbPool.query(winsQuery, [room]);
    const winsMap = new Map();
    winsRes.rows.forEach(row => {
      winsMap.set(row.username, {
        username: row.username,
        wins: Number(row.wins) || 0,
        last_win_ts: row.last_win_ts,
        last_win_seconds: row.last_win_seconds != null ? Number(row.last_win_seconds) : null,
      });
    });

    // Last-place summary per username in room (humans only)
    const lastQuery = `
      SELECT rp.username AS username,
             COUNT(*) AS last_places,
             MAX(r.race_timestamp) AS last_last_ts,
             (ARRAY_AGG(rp.human_finish_time_seconds ORDER BY r.race_timestamp DESC))[1] AS last_last_seconds
      FROM race_participants rp
      JOIN races r ON r.id = rp.race_id
      WHERE r.room_id = $1 AND rp.is_bot = FALSE AND rp.is_last_human = TRUE
      GROUP BY rp.username
    `;
    const lastRes = await dbPool.query(lastQuery, [room]);
    const lastMap = new Map();
    lastRes.rows.forEach(row => {
      lastMap.set(row.username, {
        username: row.username,
        last_places: Number(row.last_places) || 0,
        last_last_ts: row.last_last_ts,
        last_last_seconds: row.last_last_seconds != null ? Number(row.last_last_seconds) : null,
      });
    });

    // Union of usernames present in either wins or last maps
    const usernames = new Set([...winsMap.keys(), ...lastMap.keys()]);
    const items = Array.from(usernames).map(u => {
      const w = winsMap.get(u) || {};
      const l = lastMap.get(u) || {};
      return {
        username: u,
        wins: w.wins || 0,
        last_places: l.last_places || 0,
        last_win_ts: w.last_win_ts || null,
        last_win_seconds: w.last_win_seconds || null,
        last_last_ts: l.last_last_ts || null,
        last_last_seconds: l.last_last_seconds || null,
      };
    }).sort((a,b) => {
      // Sort by wins desc, then last_places desc, then username asc
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.last_places !== a.last_places) return b.last_places - a.last_places;
      return String(a.username).localeCompare(String(b.username));
    });

    res.json({ room, items });
  } catch (err) {
    console.error('[api] room-summary error', err);
    res.json({ items: [] });
  }
});

// Room loses: humans ordered by number of last places (descending)
app.get('/api/leaderboard/room-loses', async (req, res) => {
  if (!dbPool) return res.json({ items: [] });
  const room = (req.query.room && String(req.query.room).trim()) || null;
  if (!room) return res.json({ items: [] });
  try {
    const sql = `
      SELECT rp.username AS username,
             COUNT(*) AS last_places,
             MAX(r.race_timestamp) AS last_last_ts,
             (ARRAY_AGG(rp.human_finish_time_seconds ORDER BY r.race_timestamp DESC))[1] AS last_last_seconds
      FROM race_participants rp
      JOIN races r ON r.id = rp.race_id
      WHERE r.room_id = $1 AND rp.is_bot = FALSE AND rp.is_last_human = TRUE
      GROUP BY rp.username
      ORDER BY last_places DESC, rp.username ASC
      LIMIT 20
    `;
    const { rows } = await dbPool.query(sql, [room]);
    res.json({ room, items: rows });
  } catch (err) {
    console.error('[api] room-loses error', err);
    res.json({ items: [] });
  }
});

// Room aggregate stats
app.get('/api/leaderboard/room-stats', async (req, res) => {
  if (!dbPool) return res.json({ room: null, stats: null });
  const room = (req.query.room && String(req.query.room).trim()) || null;
  if (!room) return res.json({ room: null, stats: null });
  try {
    const baseSql = `
      SELECT
        COUNT(*)::INT AS total_races,
        MAX(race_timestamp) AS last_race_ts,
        AVG(human_players_count)::FLOAT AS avg_humans,
        AVG(race_duration_seconds)::FLOAT AS avg_duration_seconds,
        SUM(human_players_count)::INT AS total_human_starts
      FROM races
      WHERE room_id = $1
    `;
    const baseRes = await dbPool.query(baseSql, [room]);
    const baseRow = baseRes.rows[0] || {};

    const uniqueSql = `
      SELECT COUNT(DISTINCT rp.username)::INT AS unique_humans
      FROM race_participants rp
      JOIN races r ON r.id = rp.race_id
      WHERE r.room_id = $1 AND rp.is_bot = FALSE
    `;
    const uniqueRes = await dbPool.query(uniqueSql, [room]);
    const uniqueRow = uniqueRes.rows[0] || {};

    const lastWinnerSql = `
      SELECT winner_username, winner_time_seconds, race_timestamp
      FROM races
      WHERE room_id = $1
      ORDER BY race_timestamp DESC
      LIMIT 1
    `;
    const lastWinnerRes = await dbPool.query(lastWinnerSql, [room]);
    const lastWinnerRow = lastWinnerRes.rows[0] || null;

    const fastestSql = `
      SELECT winner_username, winner_time_seconds, race_timestamp
      FROM races
      WHERE room_id = $1
      ORDER BY winner_time_seconds ASC
      LIMIT 1
    `;
    const fastestRes = await dbPool.query(fastestSql, [room]);
    const fastestRow = fastestRes.rows[0] || null;

    const stats = {
      total_races: baseRow.total_races != null ? Number(baseRow.total_races) : 0,
      total_human_starts: baseRow.total_human_starts != null ? Number(baseRow.total_human_starts) : 0,
      unique_humans: uniqueRow.unique_humans != null ? Number(uniqueRow.unique_humans) : 0,
      avg_humans_per_race: baseRow.avg_humans != null ? Number(baseRow.avg_humans) : 0,
      avg_duration_seconds: baseRow.avg_duration_seconds != null ? Number(baseRow.avg_duration_seconds) : 0,
      last_race: lastWinnerRow ? {
        winner_username: lastWinnerRow.winner_username || null,
        winner_time_seconds: lastWinnerRow.winner_time_seconds != null ? Number(lastWinnerRow.winner_time_seconds) : null,
        race_timestamp: lastWinnerRow.race_timestamp || null,
      } : null,
      fastest_win: fastestRow ? {
        winner_username: fastestRow.winner_username || null,
        winner_time_seconds: fastestRow.winner_time_seconds != null ? Number(fastestRow.winner_time_seconds) : null,
        race_timestamp: fastestRow.race_timestamp || null,
      } : null,
    };

    res.json({ room, stats });
  } catch (err) {
    console.error('[api] room-stats error', err);
    res.json({ room, stats: null });
  }
});

// Rate limiter for serving game.html (fallback route)
const rootLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.get('/', rootLimiter, (req, res) => {
  res.sendFile(path.join(staticPath, 'game.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const clientId = nextClientId++;
  const ip = req.socket.remoteAddress;
  
  // Check connection limit per IP
  const ipConnections = connectionsByIP.get(ip) || 0;
  if (ipConnections >= MAX_CONNECTIONS_PER_IP) {
    ws.close(1013, 'Too many connections from this IP, try again later');
    return;
  }
  
  connectionsByIP.set(ip, ipConnections + 1);
  
  let room = null;
  let player = null;

  ws.on('message', (buf) => {
    // Check message size
    if (buf.length > MAX_MESSAGE_SIZE) {
      ws.close(1009, 'Message too large');
      return;
    }
    
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.type === 'hello') {
      const roomId = sanitizeRoomId(msg.roomId) || 'default';
      room = rooms.get(roomId) || createRoom(roomId);
      const username = sanitizeUsername(msg.username) || `Player_${clientId}`;
      player = { id: clientId, username, ready: false, lane: null, ws, joinMs: nowMs(), lastResult: null };
      room.players.set(clientId, player);
      if (!room.hostId) room.hostId = clientId;
      allocateLanes(room);
      console.log(`[room:${room.id}] connect clientId=${clientId} username=${username} (hostId=${room.hostId})`);
      ws.send(JSON.stringify({ type: 'welcome', clientId, roomId: room.id, hostId: room.hostId }));
      broadcast(room, roomStatePayload(room));
      return;
    }
    if (!room || !player) return;

    switch (msg.type) {
      case 'setReady': {
        player.ready = !!msg.ready;
        if (player.ready) room.readySet.add(player.id); else room.readySet.delete(player.id);
        broadcast(room, roomStatePayload(room));
        break;
      }
      case 'startGame': {
        if (room.hostId !== player.id) break;
        const playerCount = room.players.size;
        const readyCount = Array.from(room.players.values()).filter(p=>p.ready).length;
        // Allow host to start if: single player OR all players ready
        const canStart = (playerCount === 1) || (readyCount === playerCount);
        if (playerCount >= 1 && canStart && room.phase === 'lobby') {
          startCountdown(room);
          setTimeout(() => startRace(room), COUNTDOWN_SECONDS * 1000);
        }
        break;
      }
      case 'pressBoost': {
        // Boost with cooldown + max duration enforcement
        if (room.phase === 'race') {
          const now = nowMs();
          if (msg.down) {
            // Attempt to start boost
            const canStart = (!player.lastBoostEndMs) || (now - player.lastBoostEndMs >= BOOST_COOLDOWN_MS);
            if (canStart && !player.boostDown) {
              player.boostDown = true;
              player.boostSinceMs = now;
              player.lastBoostStartMs = now;
              broadcast(room, { type: 'boost', playerId: player.id, down: true, atClientMs: msg.atClientMs || now, accepted: true });
            } else {
              // Denied (cooldown)
              broadcast(room, { type: 'boost', playerId: player.id, down: true, atClientMs: msg.atClientMs || now, accepted: false, cooldownMsRemaining: player.lastBoostEndMs ? (BOOST_COOLDOWN_MS - (now - player.lastBoostEndMs)) : null });
            }
          } else {
            // End boost early if key released
            if (player.boostDown) {
              player.boostDown = false;
              player.lastBoostEndMs = now;
              broadcast(room, { type: 'boost', playerId: player.id, down: false, atClientMs: msg.atClientMs || now, accepted: true });
            }
          }
        }
        break;
      }
      case 'returnToLobby': {
        if (room.hostId !== player.id) break;
        if (room.players.size >= 2) {
          room.phase = 'lobby';
          stopTick(room);
          broadcast(room, roomStatePayload(room));
        }
        break;
      }
      case 'resetGame': {
        if (room.hostId !== player.id) break;
        if (room.phase === 'results') {
          // Reset all players to unready and clear race state
          room.players.forEach(p => {
            p.ready = false;
            p.progress = 0;
            p.currentSpeed = 0;
            p.finished = false;
            p.fullyFinished = false;
            p.finishSeconds = null;
            p.finishDecelStartMs = null;
            p.finishSpeed = null;
            p.boostDown = false;
            p.boostSinceMs = null;
            p.lastBoostStartMs = null;
            p.lastBoostEndMs = null;
          });
          room.readySet.clear();
          room.phase = 'lobby';
          stopTick(room);
          broadcast(room, roomStatePayload(room));
          console.log(`[room:${room.id}] game reset by host`);
        }
        break;
      }
      case 'rename': {
        if (room.phase === 'race') break; // prevent mid-race rename for simplicity
        const newName = sanitizeUsername(msg.username);
        if (newName) {
          const oldName = player.username;
          player.username = newName;
          console.log(`[room:${room.id}] rename clientId=${player.id} '${oldName}' -> '${newName}'`);
          broadcast(room, roomStatePayload(room));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    // Clean up connection counter
    const count = connectionsByIP.get(ip) || 0;
    if (count <= 1) {
      connectionsByIP.delete(ip);
    } else {
      connectionsByIP.set(ip, count - 1);
    }
    
    if (room && player) {
      console.log(`[room:${room.id}] disconnect clientId=${player.id} username=${player.username}`);
      room.players.delete(player.id);
      const wasHost = room.hostId === player.id;
      if (wasHost) {
        const first = room.players.values().next().value;
        room.hostId = first ? first.id : null;
      }
      allocateLanes(room);
      broadcast(room, roomStatePayload(room));
      // Dynamic end: if no players remain, end game and return to lobby
      if (room.players.size === 0) {
        stopTick(room);
        room.phase = 'lobby';
        room.readySet.clear();
        room.countdownEndsAt = null;
        room.raceStartEpochMs = null;
        broadcast(room, roomStatePayload(room));
      }
      // If in results phase, wait until host exits before resetting to lobby
      else if (room.phase === 'results' && wasHost) {
        stopTick(room);
        room.phase = 'lobby';
        room.readySet.clear();
        room.countdownEndsAt = null;
        room.raceStartEpochMs = null;
        broadcast(room, roomStatePayload(room));
      }
    }
  });
});

// --- Race Simulation Logic ---
function updateRace(room) {
  if (room.phase !== 'race') return;
  const now = nowMs();
  const dtMs = room.lastUpdateMs ? (now - room.lastUpdateMs) : 0;
  room.lastUpdateMs = now;
  const dtSec = dtMs / 1000;
  const baseSpeed = (1 / MAX_EXECUTION_TIME) * 1.2; // progress per second (20% faster)

  // helper jitter using Math.random; seeds can be used later for deterministic PRNG
  function targetSpeed(boostActive) {
    const targetFactor = boostActive ? BOOST_FACTOR : IDLE_SPEED_FACTOR;
    return baseSpeed * targetFactor;
  }
  function applyJitter(spd, scale = 1) {
    const jitter = (Math.random() - 0.5) * 0.06 * scale; // base ±3%, scaled
    return spd * (1 + jitter);
  }

  // Update players
  room.players.forEach(p => {
    if (p.fullyFinished) return;

    // Skip normal race logic if already finished (only decelerate)
    if (!p.finished) {
      const boostActive = p.boostDown && p.boostSinceMs && (now - p.boostSinceMs) <= BOOST_MAX_DURATION_MS;
      // Auto-end boost if duration exceeded
      if (p.boostDown && !boostActive) {
        p.boostDown = false;
        p.lastBoostEndMs = now;
        broadcast(room, { type: 'boost', playerId: p.id, down: false, atClientMs: now, accepted: true, reason: 'auto-expire' });
      }
      // Integrate speed toward target using accel/decel rates
      const tSpd = targetSpeed(boostActive);
      const delta = tSpd - (p.currentSpeed || 0);
      const maxUp = ACCELERATION_RATE * dtSec;
      const maxDown = DECELERATION_RATE * dtSec;
      const step = delta > 0 ? Math.min(delta, maxUp) : Math.max(delta, -maxDown);
      p.currentSpeed = (p.currentSpeed || 0) + step;
      const spd = applyJitter(p.currentSpeed);
      p.progress += spd * dtSec;
    }

    // Check finish line crossing
    if (p.progress >= 1 && !p.finished) {
      p.finished = true;
      p.finishSeconds = (now - room.raceStartEpochMs) / 1000;
      p.finishDecelStartMs = now;
      p.finishSpeed = p.currentSpeed; // Store speed at finish for physics-based deceleration
    }

    // Post-finish deceleration - physics-based with constant deceleration rate
    if (p.finished && !p.fullyFinished) {
      const decelElapsed = now - p.finishDecelStartMs;
      // Calculate deceleration as fraction of finish speed per second
      const decelRatePerSec = (p.finishSpeed || p.currentSpeed) / (FINISH_DECELERATION_DURATION_MS / 1000);
      const speedDrop = decelRatePerSec * dtSec;
      p.currentSpeed = Math.max(0, p.currentSpeed - speedDrop);

      // Continue moving forward while decelerating
      const spd = applyJitter(p.currentSpeed);
      p.progress += spd * dtSec;

      if (p.currentSpeed <= 0) {
        p.fullyFinished = true;
        p.currentSpeed = 0;
      }
    }
  });

  // Update bots (apply similar decel/accel behavior)
  room.bots.forEach(b => {
    if (b.fullyFinished) return;

    // Skip normal race logic if already finished (only decelerate)
    if (!b.finished) {
      // More varied boost behavior based on bot personality
      const boostChance = Math.random() < (BOT_BOOST_PROB_PER_TICK * (0.5 + b.boostPreference)); // personality affects frequency
      const botBoost = boostChance && (Math.random() < BOT_BOOST_ENABLE_PROB);
      b.currentSpeed = b.currentSpeed || 0;
      const tFactor = botBoost ? BOOST_FACTOR : (BOT_IDLE_SPEED_FACTOR * (b.biasFactor || 1));
      const tSpd = baseSpeed * tFactor;
      const delta = tSpd - b.currentSpeed;
      const maxUp = BOT_ACCELERATION_RATE * dtSec;
      const maxDown = BOT_DECELERATION_RATE * dtSec;
      const step = delta > 0 ? Math.min(delta, maxUp) : Math.max(delta, -maxDown);
      b.currentSpeed = b.currentSpeed + step;
      const spd = applyJitter(b.currentSpeed, b.jitterScale || 1);
      b.progress += spd * dtSec;
    }

    // Check finish line crossing
    if (b.progress >= 1 && !b.finished) {
      b.finished = true;
      b.finishSeconds = (now - room.raceStartEpochMs) / 1000;
      b.finishDecelStartMs = now;
      b.finishSpeed = b.currentSpeed; // Store speed at finish for physics-based deceleration
    }

    // Post-finish deceleration - physics-based with constant deceleration rate
    if (b.finished && !b.fullyFinished) {
      // Calculate deceleration as fraction of finish speed per second
      const decelRatePerSec = (b.finishSpeed || b.currentSpeed) / (FINISH_DECELERATION_DURATION_MS / 1000);
      const speedDrop = decelRatePerSec * dtSec;
      b.currentSpeed = Math.max(0, b.currentSpeed - speedDrop);

      // Continue moving forward while decelerating
      const spd = applyJitter(b.currentSpeed, b.jitterScale || 1);
      b.progress += spd * dtSec;

      if (b.currentSpeed <= 0) {
        b.fullyFinished = true;
        b.currentSpeed = 0;
      }
    }
  });

  // Completion check - wait for all to fully stop after deceleration
  const allPlayersFinished = Array.from(room.players.values()).every(p => p.fullyFinished);
  const allBotsFinished = room.bots.every(b => b.fullyFinished);
  if (allPlayersFinished && allBotsFinished) {
    // Compile results
    const results = [];
    room.players.forEach(p => results.push({ id: p.id, username: p.username, lane: p.lane, finishSeconds: p.finishSeconds, isBot: false }));
    room.bots.forEach(b => results.push({ id: `bot:${b.lane}`, username: b.username, lane: b.lane, finishSeconds: b.finishSeconds, isBot: true }));
    results.sort((a,b)=>a.finishSeconds - b.finishSeconds);
    const winnerId = results[0] ? results[0].id : null;
    const winnerTime = results[0] ? results[0].finishSeconds : null;
    results.forEach(r => { r.deltaSeconds = winnerTime != null ? +(r.finishSeconds - winnerTime).toFixed(3) : null; });
    endRace(room, { winnerId, results });
  }
}

// Save race results to database
async function saveRaceResults(room, resultsObj) {
  if (!dbPool) return;
  const results = resultsObj.results;
  if (!Array.isArray(results) || results.length === 0) return;
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const winner = results[0];
    const last = results[results.length - 1];
    const humanCount = results.filter(r => !r.isBot).length;
    const botCount = results.filter(r => r.isBot).length;
    // Compute human-only ranking and last-human
    const humanResults = results.filter(r => !r.isBot).slice().sort((a,b)=>a.finishSeconds - b.finishSeconds);
    const humanLast = humanResults[humanResults.length - 1];
    const raceRes = await client.query(`
      INSERT INTO races (
        race_id, room_id, race_duration_seconds, total_participants,
        human_players_count, bot_count, winner_id, winner_username,
        winner_time_seconds, last_place_time_seconds
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `, [
      room.raceId,
      room.id,
      last.finishSeconds,
      results.length,
      humanCount,
      botCount,
      winner.id,
      winner.username,
      winner.finishSeconds,
      last.finishSeconds
    ]);
    const raceDbId = raceRes.rows[0].id;
    // participants
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const humanIndex = r.isBot ? null : humanResults.findIndex(h => h.id === r.id);
      const humanFinalPos = humanIndex != null && humanIndex >= 0 ? (humanIndex + 1) : null;
      const isLastHuman = !!(humanLast && !r.isBot && humanLast.id === r.id);
      const humanFinishTime = !r.isBot ? r.finishSeconds : null;
      await client.query(`
        INSERT INTO race_participants (
          race_id, player_id, username, is_bot, lane,
          finish_time_seconds, delta_from_winner_seconds, final_position,
          is_last_human, human_final_position, human_finish_time_seconds
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        raceDbId,
        r.id,
        r.username,
        r.isBot || false,
        r.lane,
        r.finishSeconds,
        r.deltaSeconds,
        i + 1,
        isLastHuman,
        humanFinalPos,
        humanFinishTime
      ]);
    }
    await client.query('COMMIT');
    console.log(`[db] race saved raceId=${room.raceId} rows=${results.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[db] save error', err);
  } finally {
    client.release();
  }
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Multiplayer server listening on :${PORT}`);
});

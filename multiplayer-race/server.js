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
//no.
// 3) Optional: run thin client(s) in another terminal to simulate players
//    node thin-client.js ws://localhost:8080 roomId=dev username=Alice
//    node thin-client.js ws://localhost:8080 roomId=dev username=Bob

const http = require('http');
const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');
const { execSync } = require('child_process');

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
const COUNTDOWN_SECONDS = 1;
const AUTOSTART_ENABLED = false; // disable auto-start when all players ready
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

// --- Data Structures ---
const rooms = new Map(); // roomId -> Room
let nextClientId = 1;

function nowMs() { return Date.now(); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

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

// Serve static files from parent directory (repo root)
const staticPath = path.join(__dirname, '..');
app.use(express.static(staticPath));

// API endpoint to get current commit SHA (cached at startup)
app.get('/api/commit', (req, res) => {
  res.json({ sha: COMMIT_SHA });
});

// Fallback: serve game.html as default
app.get('/', (req, res) => {
  res.sendFile(path.join(staticPath, 'game.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const clientId = nextClientId++;
  let room = null;
  let player = null;

  ws.on('message', (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.type === 'hello') {
      const roomId = msg.roomId || 'default';
      room = rooms.get(roomId) || createRoom(roomId);
      const username = (msg.username && String(msg.username).trim()) || `Player_${clientId}`;
      player = { id: clientId, username, ready: false, lane: null, ws, joinMs: nowMs(), lastResult: null };
      room.players.set(clientId, player);
      if (!room.hostId) room.hostId = clientId;
      allocateLanes(room);
      console.log(`[room:${room.id}] connect clientId=${clientId} username=${username} (hostId=${room.hostId})`);
      ws.send(JSON.stringify({ type: 'welcome', clientId, roomId: room.id, hostId: room.hostId }));
      broadcast(room, roomStatePayload(room));
      // Auto-start policy: if room was empty and now we have enough players, start a new game
      const playerCount = room.players.size;
      if (room.phase === 'lobby' && playerCount >= 2) {
        console.log(`[room:${room.id}] auto-start threshold met (players=${playerCount}) -> countdown`);
        startCountdown(room);
        setTimeout(() => startRace(room), COUNTDOWN_SECONDS * 1000);
      } else if (room.phase === 'lobby') {
        console.log(`[room:${room.id}] waiting in lobby (players=${playerCount}, need >=2 for auto-start)`);
      }
      return;
    }
    if (!room || !player) return;

    switch (msg.type) {
      case 'setReady': {
        player.ready = !!msg.ready;
        if (player.ready) room.readySet.add(player.id); else room.readySet.delete(player.id);
        broadcast(room, roomStatePayload(room));
        // auto-start if enabled and all ready and >=2 players
        if (AUTOSTART_ENABLED) {
          const readyCount = Array.from(room.players.values()).filter(p=>p.ready).length;
          if (readyCount >= Math.max(DEFAULT_PLAYERS, 2) && readyCount === room.players.size && room.phase === 'lobby') {
            startCountdown(room);
            setTimeout(() => startRace(room), COUNTDOWN_SECONDS * 1000);
          }
        }
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
        const newName = (msg.username && String(msg.username).trim()) || '';
        if (newName && newName.length <= 40) {
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
      const decelElapsed = now - b.finishDecelStartMs;
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

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Multiplayer server listening on :${PORT}`);
});

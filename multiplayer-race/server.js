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
const { WebSocketServer } = require('ws');

// --- Constants ---
const INPUT_KEY = 'E';
const DEFAULT_PLAYERS = 2;
const MAX_PLAYERS = 6; // humans
const TOTAL_LANES = 10;
const COUNTDOWN_SECONDS = 5;
const TICK_RATE_HZ = 15;
const BOOST_FACTOR = 1.4;
const BOOST_MAX_DURATION_MS = 500;
const BOOST_COOLDOWN_MS = 1000;

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
    constants: { INPUT_KEY, DEFAULT_PLAYERS, MAX_PLAYERS, TOTAL_LANES, COUNTDOWN_SECONDS, BOOST_FACTOR, BOOST_MAX_DURATION_MS, BOOST_COOLDOWN_MS },
    tickTimer: null,
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
  broadcast(room, { type: 'countdown', secondsLeft: COUNTDOWN_SECONDS, countdownEndsAt: room.countdownEndsAt });
}

function startRace(room) {
  room.phase = 'race';
  room.raceId = `${room.id}-${nowMs()}`;
  room.raceStartEpochMs = nowMs();
  // seeding per player
  room.seeds = {};
  room.players.forEach(p => { room.seeds[p.id] = Math.floor(Math.random()*1e9); });
  allocateLanes(room);
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
  broadcast(room, { type: 'raceEnd', results });
  stopTick(room);
  // return to lobby shortly
  setTimeout(() => {
    room.phase = 'lobby';
    room.readySet.clear();
    room.countdownEndsAt = null;
    room.raceStartEpochMs = null;
    broadcast(room, roomStatePayload(room));
  }, 4000);
}

function beginTick(room) {
  stopTick(room);
  const interval = Math.round(1000 / TICK_RATE_HZ);
  room.tickTimer = setInterval(() => {
    broadcast(room, { type: 'tick', tServerMs: nowMs() });
  }, interval);
}
function stopTick(room) {
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

// --- Server Setup ---
const server = http.createServer();
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
      ws.send(JSON.stringify({ type: 'welcome', clientId, roomId: room.id, hostId: room.hostId }));
      broadcast(room, roomStatePayload(room));
      // Auto-start policy: if room was empty and now we have enough players, start a new game
      const playerCount = room.players.size;
      if (room.phase === 'lobby' && playerCount >= 1) {
        startCountdown(room);
        setTimeout(() => startRace(room), COUNTDOWN_SECONDS * 1000);
      }
      return;
    }
    if (!room || !player) return;

    switch (msg.type) {
      case 'setReady': {
        player.ready = !!msg.ready;
        if (player.ready) room.readySet.add(player.id); else room.readySet.delete(player.id);
        broadcast(room, roomStatePayload(room));
        // auto-start if all ready and >=2 players
        const readyCount = Array.from(room.players.values()).filter(p=>p.ready).length;
        if (readyCount >= Math.max(DEFAULT_PLAYERS, 2) && readyCount === room.players.size && room.phase === 'lobby') {
          startCountdown(room);
          setTimeout(() => startRace(room), COUNTDOWN_SECONDS * 1000);
        }
        break;
      }
      case 'startGame': {
        if (room.hostId !== player.id) break;
        const playerCount = room.players.size;
        if (playerCount >= 1 && room.phase === 'lobby') {
          startCountdown(room);
          setTimeout(() => startRace(room), COUNTDOWN_SECONDS * 1000);
        }
        break;
      }
      case 'pressBoost': {
        // Relay to clients; server could validate rate/cooldown in future
        broadcast(room, { type: 'boost', playerId: player.id, down: !!msg.down, atClientMs: msg.atClientMs || nowMs() });
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
    }
  });

  ws.on('close', () => {
    if (room && player) {
      room.players.delete(player.id);
      if (room.hostId === player.id) {
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
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Multiplayer server listening on :${PORT}`);
});

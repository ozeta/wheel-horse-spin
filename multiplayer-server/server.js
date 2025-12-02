/**
 * space-press-server
 *
 * Node.js WebSocket server (ws) for a simple authoritative realtime game:
 * - Max 10 players
 * - Players send { type: "press", key: "SPACE" }
 * - Auto-start when all 10 players connected
 * - Server authoritative timer (default 10s)
 * - Rate limit: 20 presses / 1000ms (sliding window) per player
 * - Broadcast scores every 300ms
 * - If player disconnects during match -> their score is frozen (connected: false)
 *
 * Usage:
 *   npm install
 *   npm start
 */

import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

// CONFIGURABLE CONSTANTS
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const MAX_PLAYERS = 2;
const MATCH_DURATION_MS = 10_000; // 10 seconds
const BROADCAST_INTERVAL_MS = 300; // 300 ms for live updates
const RATE_LIMIT_WINDOW_MS = 1000; // sliding window 1000ms
const RATE_LIMIT_MAX_PER_WINDOW = 20; // max presses per player per window

// Game state
const StateStatus = {
  WAITING: "waiting",
  PLAYING: "playing",
  FINISHED: "finished",
};

const gameState = {
  status: StateStatus.WAITING,
  players: new Map(), // id -> PlayerState
  startTime: null,
  endTime: null,
  winner: null,
  broadcastTimer: null,
  finishTimer: null,
};

// PlayerState
// {
//   id: string,
//   score: number,
//   lastPressTimestamps: number[],
//   connected: boolean,
//   ws: WebSocket | null
// }

function createPlayer(ws) {
  return {
    id: uuidv4(),
    score: 0,
    lastPressTimestamps: [],
    connected: true,
    ws,
  };
}

// Utility: send JSON safely
function sendSafe(ws, obj) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch (err) {
    // ignore send errors for now
  }
}

// Broadcast current summary to all connected players
function broadcastState() {
  const scores = Array.from(gameState.players.values()).map((p) => ({
    id: p.id,
    score: p.score,
    connected: p.connected,
  }));

  let remaining = null;
  if (gameState.status === StateStatus.PLAYING && gameState.endTime) {
    remaining = Math.max(0, gameState.endTime - Date.now());
  }

  const payload = {
    type: "update",
    status: gameState.status,
    scores,
    remaining,
  };

  for (const p of gameState.players.values()) {
    if (p.ws && p.connected) sendSafe(p.ws, payload);
  }
}

// Choose winner when match ends
function resolveWinner() {
  let best = -1;
  let winners = [];
  for (const p of gameState.players.values()) {
    if (p.score > best) {
      best = p.score;
      winners = [p.id];
    } else if (p.score === best) {
      winners.push(p.id);
    }
  }
  // If tie, return array; else single id
  gameState.winner = winners.length === 1 ? winners[0] : winners;
  return { winners, bestScore: best };
}

function finishMatch() {
  if (gameState.status !== StateStatus.PLAYING) return;
  gameState.status = StateStatus.FINISHED;
  gameState.startTime = null;
  gameState.endTime = null;

  // stop broadcast & finish timers
  if (gameState.broadcastTimer) {
    clearInterval(gameState.broadcastTimer);
    gameState.broadcastTimer = null;
  }
  if (gameState.finishTimer) {
    clearTimeout(gameState.finishTimer);
    gameState.finishTimer = null;
  }

  const result = resolveWinner();

  // Send finished message
  const payload = {
    type: "finished",
    winner: gameState.winner,
    winners: result.winners,
    score: result.bestScore,
  };

  for (const p of gameState.players.values()) {
    if (p.ws && p.connected) sendSafe(p.ws, payload);
  }

  // Keep scores frozen. After a short delay, reset to WAITING and clear players to allow new match.
  // In our single-room design, we reset state but keep players (they remain connected).
  setTimeout(() => {
    resetForNextMatch();
  }, 2000);
}

function resetForNextMatch() {
  // Reset all players' scores and timestamps, but keep connected status and ws references.
  for (const p of gameState.players.values()) {
    p.score = 0;
    p.lastPressTimestamps = [];
    // keep p.connected and p.ws as-is
  }
  gameState.status = StateStatus.WAITING;
  gameState.winner = null;
  // If still enough players, auto-start again
  tryAutoStart();
}

function tryAutoStart() {
  // Start only if status waiting and connected players count == MAX_PLAYERS
  if (gameState.status !== StateStatus.WAITING) return;
  const connectedCount = Array.from(gameState.players.values()).filter(
    (p) => p.connected
  ).length;
  if (connectedCount === MAX_PLAYERS) {
    startMatch();
  }
}

function startMatch() {
  if (gameState.status !== StateStatus.WAITING) return;
  const now = Date.now();
  gameState.status = StateStatus.PLAYING;
  gameState.startTime = now;
  gameState.endTime = now + MATCH_DURATION_MS;
  gameState.winner = null;

  // Start broadcast interval
  gameState.broadcastTimer = setInterval(broadcastState, BROADCAST_INTERVAL_MS);
  // Ensure a final broadcast at start
  broadcastState();

  // Schedule finish
  gameState.finishTimer = setTimeout(() => {
    finishMatch();
  }, MATCH_DURATION_MS);
}

// Validate incoming press event; update player's score if valid
function handlePress(player, msg) {
  // Accept only during PLAYING
  if (gameState.status !== StateStatus.PLAYING) return;

  // Validate key
  if (!msg || msg.key !== "SPACE") return;

  const now = Date.now();

  // Remove timestamps older than RATE_LIMIT_WINDOW_MS
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  player.lastPressTimestamps = player.lastPressTimestamps.filter(
    (ts) => ts >= windowStart
  );

  if (player.lastPressTimestamps.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    // Rate limit exceeded: reject this press
    // Optionally log or notify client about rate limit
    sendSafe(player.ws, {
      type: "rate_limited",
      message: "Too many presses in short time",
    });
    return;
  }

  // Accept press
  player.lastPressTimestamps.push(now);
  player.score += 1;
}

// WS server setup
const wss = new WebSocketServer({ port: PORT }, () => {
  console.log(`WebSocket server listening on ws://localhost:${PORT}`);
});

// Connection lifecycle
wss.on("connection", (ws) => {
  // Create player and add to state
  const player = createPlayer(ws);
  gameState.players.set(player.id, player);

  // Send welcome with assigned id and current status
  sendSafe(ws, {
    type: "welcome",
    id: player.id,
    status: gameState.status,
    playersCount: gameState.players.size,
    maxPlayers: MAX_PLAYERS,
  });

  // Immediately try to auto-start if enough players
  tryAutoStart();

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      // invalid JSON; ignore
      return;
    }
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "press":
        handlePress(player, msg);
        break;
      case "ping": // optional client heartbeat
        sendSafe(ws, { type: "pong" });
        break;
      default:
        // ignore unknown types
        break;
    }
  });

  ws.on("close", () => {
    // Mark player as disconnected but keep their score (freeze)
    player.connected = false;
    player.ws = null;
    // Do not remove from gameState.players to preserve score
    // If the match is in waiting state and players < MAX_PLAYERS, we won't auto-start.
    console.log(`player disconnected: ${player.id}`);
  });

  ws.on("error", (err) => {
    console.warn("ws error for player", player.id, err && err.message);
  });
});

// Periodic cleanup for stale disconnected players (optional):
// If a disconnected player stays disconnected for long, you may wish to remove them.
// For the single-match simple server we keep them; implement removal policy if desired.

process.on("SIGINT", () => {
  console.log("Shutting down gracefully...");
  // Stop timers
  if (gameState.broadcastTimer) clearInterval(gameState.broadcastTimer);
  if (gameState.finishTimer) clearTimeout(gameState.finishTimer);

  // Close all websocket connections
  for (const p of gameState.players.values()) {
    try {
      if (p.ws) p.ws.close();
    } catch (err) {}
  }
  wss.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

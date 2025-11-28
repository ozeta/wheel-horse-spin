# Copilot Instructions — Browser Game Multiplayer Server

This repository contains the **authoritative game server** for a small browser-based realtime multiplayer game.

## 🎮 Game Summary
- Max **10 players**
- Players can only send **a single input**: press the `SPACE` key
- The server runs a **single global match** (no rooms, no matchmaking)
- Each match **auto-starts only when all 10 players are connected**
- The goal is to press `SPACE` as fast as possible within the server-defined time window
- **Winner = player with highest valid press count**
- If a player disconnects mid-match, their score must be **frozen but preserved**
- Each player is limited to **max 20 valid key presses per second**
- Score updates must be **broadcast to all connected players every 300–500ms**
- The server clock and game timer are **fully authoritative** (never trust client timestamps for scoring or timer logic)

## 🧠 Server Architecture Requirements
- **Runtime:** Node.js (or compatible like Bun/Deno, but target Node for implementation)
- **Realtime transport:** WebSocket (use `ws` library unless there is a strong reason otherwise)
- **State storage:** In-memory (RAM only, no DB required for match state)
- **Match state machine:**
  `waiting → playing → finished → reset`
- **Shared game state model:** Must align with this structure:

```ts
interface GameState {
  status: 'waiting' | 'playing' | 'finished';
  players: Map<string, PlayerState>;
  startTime: number | null;
  endTime: number | null;
  winner: string | null;
}

interface PlayerState {
  id: string;
  score: number;
  lastPressTimestamps: number[]; // sliding window for rate-limit
  connected: boolean;
  ws?: WebSocket; // live reference for connected players
}





Input Validation & Anti-Cheat
	•	Accept only SPACE presses
	•	Implement server-side sliding window rate limiting
	•	Reject input bursts over 20 presses in 1000ms per player
	•	On rejection: do not increment score, optionally log for debugging
	•	Do not allow score tampering by clients

🚀 Code Style Expectations
	•	Code should be written in English with clear naming and comments
	•	Avoid unnecessary dependencies beyond WebSocket (ws)
	•	Prefer simple, explicit, non-abstract logic for game loop and validation to make latency predictable
	•	Keep the server stateless beyond in-memory match state
	•	Favor readability, low-overhead execution, and minimal latency
	•	Provide clean shutdown and avoid memory leaks in WS references or press buffers
	•	Use modern JS/TS where appropriate, but without experimental language features not supported in LTS Node

✅ Before submitting code, always ask:
	1.	Does this run fully in-memory?
	2.	Is the timer authoritative?
	3.	Is rate-limit enforced server-side?
	4.	Are disconnecting players frozen but preserved?
	5.	Does broadcast scale to 10 players without overhead?
	6.	Are message contracts respected exactly?

If any answer is no, fix the implementation.

# Copilot Instructions — Wheel Horse Spin (Multiplayer)

Purpose: Guide AI coding assistants working on the multiplayer layer. Keep code simple, documented, and consistent with the single-page client.

## Core Principles

- Do not introduce build tooling for the browser client (no bundlers). Keep client JS vanilla.
- Prefer minimal diffs; preserve existing public APIs and constants unless explicitly updated.
- Every time you add a parameter, option, or message field: update header docs at the top of the file and the README.
- Keep server authoritative for phases (lobby → countdown → race → results) and start times. Movement can be client-predicted, with occasional server corrections.

## Folder Scope

- `multiplayer-race/` contains:
  - `server.js`: Node WebSocket server — rooms, host, ready gate, countdown/start, tick.
  - `thin-client.js`: Node client — logs and simple inputs for testing.
  - `README.md`: Setup, run, protocol, options.
  - `package.json`: scripts and dependencies.

## Protocol (Baseline)

- Client → Server:
  - `hello { roomId, username, version }`
  - `setReady { ready }`
  - `startGame {}` (host only)
  - `pressBoost { down, atClientMs }`
  - `returnToLobby {}` (host only)
- Server → Client:
  - `welcome { clientId, roomId, hostId }`
  - `roomState { players[], bots[], phase, hostId, constants }`
  - `countdown { secondsLeft, countdownEndsAt }`
  - `raceStart { raceId, raceStartEpochMs, players[], bots[], seeds, constants }`
  - `tick { tServerMs }`
  - `raceEnd { results[] }`

## Constants and Limits

- `INPUT_KEY = 'E'`
- `DEFAULT_PLAYERS = 2`
- `MAX_PLAYERS = 6` (humans)
- `TOTAL_LANES = 10`
- `COUNTDOWN_SECONDS = 5`
- `TICK_RATE_HZ = 15`
- Boosts: `BOOST_FACTOR`, `BOOST_MAX_DURATION_MS`, `BOOST_COOLDOWN_MS`

## Expected Behaviors

- First player in room becomes host; host can start the game when ≥2 players or when all ready.
- Lanes: assigned deterministically by join order; bots fill remaining lanes to 10.
- Thin client supports `pretty-output` and `debug` options; document any new options.

## Documentation Requirements

- At file headers (server.js, thin-client.js): add “Setup & Run” and list all options/parameters.
- Update `multiplayer-race/README.md` whenever protocol or options change.
- Reference any newly added environment variables (e.g., `PORT`) and scripts in `package.json`.

## Integration Guidance (Client-side)

- When adding the browser adapter, map server events into existing `sketch.js` state transitions without introducing frameworks.
- Add lobby UI minimally in `single-player-game.html`/`style.css`; bind with small helper functions.
- Use shared constants; keep movement deterministic (base speed + boost). Server may later send corrections.

## Quality Bar

- Small, focused changes; avoid refactors that aren’t required.
- Clear comments for new code paths; include rationale when non-obvious.
- Prefer readability over micro-optimization.

## When Receiving New Directives

- If the user specifies new mechanics or constraints, update this file and affected headers (server, client, README) before coding.

# Copilot Project Instructions

These instructions orient AI coding agents quickly in the Wheel Horse Spin repository.
Keep responses focused on existing patterns – do not introduce frameworks or build tooling.

## Overview
Two modes:
1. Single-page browser race (HTML/CSS/JS + p5.js) – local horses.
2. Multiplayer WebSocket server (`multiplayer-race/`) – lobby → countdown → race → results with bots auto-filling lanes.

Framework-free; no build step. Keep additions minimal and consistent.

## Key Files
Single-player:
- `index.html` – static scaffold & controls.
- `style.css` – layout & visual constants.
- `sketch.js` – race logic/state/render.
Multiplayer:
- `multiplayer-race/server.js` – Express + WebSocket, REST endpoints.
- `mp-game.js` – multiplayer client canvas & dynamic boost HUD.
- `multiplayer-race/db/migrate.js` / `seed.js` – schema + demo data.
- `multiplayer-race/openapi.yaml` – REST contract.
- `thin-client.js` – scripted player simulation.

## State & Data Model
Single-player:
- `horses[]` persisted roster; `horseObjects[]` runtime physics.
Multiplayer:
- Rooms keyed by id; per-room `players` (Map), `bots[]` (fill lanes), phases: `lobby` | `countdown` | `race` | `results`.
- Server tracks per-player progress, boost state, finish + deceleration completion.
- Database (optional) stores `races` + `race_participants` with human/bot flags & last-human markers.

## Race Geometry & Rendering
Shared oval track logic: alternating lanes, finish rectangle. Multiplayer client downsizes complexity vs single-player but reuses lane mapping & avatar seeding.
- Geometry recalculated each frame (`calculateTrackGeometry`) – depends on canvas size and lane count.
- Track: Two semicircle arcs joined by straights (derived from outer rectangle minus arc diameter). Lane width is uniform.
- Alternating lane colors; divider lines drawn atop.
- Finish line: Red rectangle at left straight; width controlled by `FINISH_LINE_WIDTH`.
- Horse position computed by segment mapping of perimeter distance (top straight → right arc → bottom straight → left arc).

## Lifecycle & Timing
Single-player: `startRace()` → frame loop updates until all decel done.
Multiplayer: lobby ready gating → short `COUNTDOWN_SECONDS` → server-driven tick (progress + speed interpolation on client) → full-stop deceleration → results.
1. `startRace()`: Resets progress/speed; sets `raceStartMillis`, clears timing accumulators; hides Run, shows Pause/Reset.
2. `updateHorses()`: For each horse: fluctuate speed around base; upon crossing finish sets `finished`, records `finishSeconds`, starts deceleration phase.
3. Deceleration: Linear speed drop over `DECELERATION_DURATION_MS`; horse continues moving (progress keeps increasing past official finish distance) until speed reaches 0.
4. Completion: `checkRaceCompletion()` only ends race when every horse is `finished` AND `decelerating` phase ended (speed == 0).
5. Timing excludes paused durations (`pausedAccumulatedMillis`). Winner time = earliest finishSeconds; total duration = latest finishSeconds.

## Leaderboards & Overlay
Single-player: live + final leaderboard overlay.
Multiplayer: REST endpoints supply aggregated stats (fastest, top wins, last humans, room summary, loses). Client sidebar renders dynamic tables + charts.
- Live leaderboard: Sorted finished (by finish time asc) then unfinished (by progress descending). Displays finish time or ellipsis for unfinished, marks top 3 with gold/silver/copper bullet.
- Final leaderboard: After race end; rank by finish time; columns Rank | Name | Time (with tie) | +Delta. Top 3 colored, tie flagged on equal winnerTime.
- Winner overlay: Trophy emoji, winner time, total race duration, tie indicator.

## Constants
Single-player: adjust in `sketch.js`.
Multiplayer: constants dispatched via `roomState` / `raceStart` (`INPUT_KEY`, `COUNTDOWN_SECONDS`, speed tuning, boost cooldowns, decel duration). Dynamic boost key rotation handled client-side.
- `MAX_EXECUTION_TIME`: Target nominal race length (seconds) used to derive base speed.
- `LANE_WIDTH`: Lane thickness (impacts track radius & avatar sizing).
- `AVATAR_SIZE_FACTOR`: Size multiplier vs lane width.
- `DECELERATION_DURATION_MS`: Coast duration after finish line crossing.
- `FINISH_LINE_WIDTH`: Horizontal width of finish rectangle.

## Pause Behavior
Single-player only (`paused` state). Multiplayer does not pause mid-race; state machine is linear.
- `pauseGameBtn` toggles `racing` ↔ `paused` – progress & speed updates suspended; timing accumulation excluded.
- Resuming continues from preserved `pausedAccumulatedMillis` offset.

## Adding Features – Follow Existing Patterns
General:
- Prefer extending existing procedural style; avoid large abstractions.
Single-player additions: inject into `draw()`, modify `updateHorses()` or leaderboard rendering.
Multiplayer additions:
- Server: expand REST endpoints in `server.js`; update `openapi.yaml` accordingly.
- WebSocket protocol: add new message types with clear payload shape; broadcast via `broadcast(room, msg)`.
- Client: update `mp-game.js` HUD or track rendering; keep rotation logic lightweight.
- UI additions: Add button markup in `index.html`, style in `style.css`, bind in `setup()` and implement in `sketch.js`.
- New per-horse attributes: Extend object creation in `initializeHorseObjects()`; avoid mutating `horses` (persisted) – use `horseObjects` for runtime fields.
- Race logic changes: Modify `updateHorses()` (motion) or `checkRaceCompletion()` (finish criteria) – keep separation.
- Rendering add-ons: Inject into `draw()` respecting game state gating (avoid expensive work outside racing/finished states).

## Do / Don’t
- DO keep everything framework-free (no build steps).
- DO preserve existing state machine strings.
- DO reuse constants; if introducing a new tuning variable, group near existing constant block.
- DO ensure pause logic excludes elapsed time additions.
- DON’T refactor into classes/modules unless explicitly requested.
- DON’T introduce asynchronous fetch loops each frame; preload assets in `preload()` or during horse add.

## Common Extension Examples
Multiplayer:
- New stat endpoint (e.g. median finish): add SQL query, update OpenAPI spec.
- Authoritative boost key rotation (currently client-only): move key sequence to server and broadcast.
- Accessibility: fixed boost key mode toggle.
- Export CSV: Build array from `horseObjects` after `finished` state; derive delta = finishSeconds - winnerTime.
- Alternate deceleration curve: Replace linear `(1 - t)` with easing (e.g. `1 - t*t`).
- Responsive scaling: Adjust `LANE_WIDTH` based on `width` before geometry calc.

## Quick Reference (Typical Hooks)
Single-player:
- Start: `startRace()`
- Frame: `draw()`, calls `updateHorses()`, `checkRaceCompletion()`
- Position: `getHorsePosition(horse)`
- Leaderboards: `drawLeaderboard()`, `drawFinalLeaderboard()`
- Overlay: `drawWinnerMessage()`
Multiplayer:
- Server tick: `updateRace(room)` → `broadcast` ticks
- Begin race: `startRace(room)`
- Finish compile: `endRace(room, results)` → DB persist
- Client progress smoothing: interpolation in `syncRaceProgress()`
- Dynamic boost key: rotation functions in `mp-game.js`

## Dynamic Boost Key (Multiplayer)
- Rotation interval: 3000ms
- Key set: W A S D Q E Z X C Space
- HUD: countdown + flash + audio beep
- Auto-release on key change & max duration enforcement server-side

## REST Endpoints Summary
See `multiplayer-race/openapi.yaml`.
- `/api/commit`, `/api/health`
- `/api/leaderboard/fastest`, `/api/leaderboard/top`
- `/api/leaderboard/player/:username`
- `/api/leaderboard/last-humans`
- `/api/leaderboard/room-summary?room=ID`
- `/api/leaderboard/room-loses?room=ID`

## Database Schema (Delta)
`race_participants` includes: `is_last_human`, `human_final_position`, `human_finish_time_seconds` for last-place & human-only stats.

Clarify any missing conventions or request expansion before implementing big changes.

Clarify any missing conventions or request expansion (e.g., artifact workflow patterns) before implementing big changes.

# Copilot Project Instructions

These instructions orient AI coding agents quickly in the Wheel Horse Spin repository.
Keep responses focused on existing patterns – do not introduce frameworks or build tooling.

## Overview
Single-page browser game (HTML/CSS/JS + p5.js) that simulates a horse race.
No bundler, no transpilation – all code runs directly in the browser.
Race flow: setup → racing → (optional paused) → all finish & decelerate → finished overlay + final leaderboard.

## Key Files
- `index.html`: Static scaffold, canvas container, sidebar buttons (add/run/pause/reset/clear/share).
- `style.css`: Flex layout (fixed header + side panel), button color conventions, horse list styling.
- `sketch.js`: All game logic (state machine, geometry, animation, leaderboard rendering, pause, finish logic).
- `readme.md`: High-level project description and usage notes.

## State & Data Model
- Global arrays: `horses` (plain objects: `{name, avatar}`), `horseObjects` (runtime race objects with dynamic fields: lane, progress, speed, finished, finishSeconds, deceleration params).
- Game states: `setup`, `racing`, `paused`, `finished` (only transition to `finished` when ALL horses crossed AND completed deceleration).
- Persistence: `localStorage` key `horses` plus optional URL override via `?horses=Name1,Name2` (URL list replaces stored roster then is saved).

## Race Geometry & Rendering
- Geometry recalculated each frame (`calculateTrackGeometry`) – depends on canvas size and lane count.
- Track: Two semicircle arcs joined by straights (derived from outer rectangle minus arc diameter). Lane width is uniform.
- Alternating lane colors; divider lines drawn atop.
- Finish line: Red rectangle at left straight; width controlled by `FINISH_LINE_WIDTH`.
- Horse position computed by segment mapping of perimeter distance (top straight → right arc → bottom straight → left arc).

## Lifecycle & Timing
1. `startRace()`: Resets progress/speed; sets `raceStartMillis`, clears timing accumulators; hides Run, shows Pause/Reset.
2. `updateHorses()`: For each horse: fluctuate speed around base; upon crossing finish sets `finished`, records `finishSeconds`, starts deceleration phase.
3. Deceleration: Linear speed drop over `DECELERATION_DURATION_MS`; horse continues moving (progress keeps increasing past official finish distance) until speed reaches 0.
4. Completion: `checkRaceCompletion()` only ends race when every horse is `finished` AND `decelerating` phase ended (speed == 0).
5. Timing excludes paused durations (`pausedAccumulatedMillis`). Winner time = earliest finishSeconds; total duration = latest finishSeconds.

## Leaderboards & Overlay
- Live leaderboard: Sorted finished (by finish time asc) then unfinished (by progress descending). Displays finish time or ellipsis for unfinished, marks top 3 with gold/silver/copper bullet.
- Final leaderboard: After race end; rank by finish time; columns Rank | Name | Time (with tie) | +Delta. Top 3 colored, tie flagged on equal winnerTime.
- Winner overlay: Trophy emoji, winner time, total race duration, tie indicator.

## Constants (Adjust in `sketch.js`)
- `MAX_EXECUTION_TIME`: Target nominal race length (seconds) used to derive base speed.
- `LANE_WIDTH`: Lane thickness (impacts track radius & avatar sizing).
- `AVATAR_SIZE_FACTOR`: Size multiplier vs lane width.
- `DECELERATION_DURATION_MS`: Coast duration after finish line crossing.
- `FINISH_LINE_WIDTH`: Horizontal width of finish rectangle.

## Pause Behavior
- `pauseGameBtn` toggles `racing` ↔ `paused` – progress & speed updates suspended; timing accumulation excluded.
- Resuming continues from preserved `pausedAccumulatedMillis` offset.

## Adding Features – Follow Existing Patterns
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
- Export CSV: Build array from `horseObjects` after `finished` state; derive delta = finishSeconds - winnerTime.
- Alternate deceleration curve: Replace linear `(1 - t)` with easing (e.g. `1 - t*t`).
- Responsive scaling: Adjust `LANE_WIDTH` based on `width` before geometry calc.

## Quick Reference (Typical Hooks)
- Start: `startRace()`
- Frame: `draw()`, calls `updateHorses()`, `checkRaceCompletion()`
- Position: `getHorsePosition(horse)`
- Leaderboards: `drawLeaderboard()`, `drawFinalLeaderboard()`
- Overlay: `drawWinnerMessage()`

Clarify any missing conventions or request expansion (e.g., artifact workflow patterns) before implementing big changes.

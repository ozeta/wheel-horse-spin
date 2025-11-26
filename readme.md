# Wheel Horse Spin

Play live: <https://ozeta.github.io/wheel-horse-spin/>

## Summary

Wheel Horse Spin is a browser-based animated horse race built with plain HTML/CSS/JavaScript and p5.js. You add up to 10 horses, each rendered with a randomly chosen DiceBear avatar style per session. The race runs on a dynamically sized oval track whose geometry adapts to the canvas. All horses complete the race; their finish times are recorded, and only after every horse has coasted to a full stop the winner overlay & final leaderboard appear.

## Core Features

- Horse Management: Add / remove horses, persisted via `localStorage`; optional sharing through URL query (`?horses=Name1,Name2`).
- Random Avatars: One DiceBear style chosen each page load; avatar seeded by horse name for repeatable identity.
- Adaptive Track: Oval track sized to canvas with alternating lane colors and a fixed-width finish line rectangle.
- Race States: `setup`, `racing`, `paused`, `finished` with appropriate button visibility (Run, Pause/Resume, Reset).
- Speed & Duration: Speeds normalized to target duration constant `MAX_EXECUTION_TIME` while allowing slight per-frame variation.
- Finish Logic: Each horse records a precise finish time then decelerates smoothly (coast phase) before stopping; race ends only when all horses have stopped.
- Leaderboards: Live leaderboard (finished show time, unfinished show ellipsis), final leaderboard shows rank, finish time, delta from winner, tie markers, colored bullets for top 3 (gold/silver/copper).
- Winner Overlay: Displays trophy icon, winner time, and total race duration (time of last finisher).
- Pause/Resume: Fully pauses motion and timing (paused seconds excluded from finish times).

## Key Constants (tune in `sketch.js`)

- `MAX_EXECUTION_TIME`: Target race duration (seconds) influencing base speed.
- `LANE_WIDTH`: Visual lane thickness (affects track & avatar scale).
- `AVATAR_SIZE_FACTOR`: Multiplier for avatar size relative to lane width.
- `DECELERATION_DURATION_MS`: Milliseconds horses coast after crossing finish.
- `FINISH_LINE_WIDTH`: Width of the red finish rectangle.

## Data & Sharing

Horse roster saved in browser via `localStorage`. To share a lineup, construct a URL: `https://.../wheel-horse-spin/?horses=Seabiscuit,Secretariat` (max 10). On load, URL horses override stored horses and are then persisted.

## Controls

- Add Horse: Prompts for name, creates avatar.
- Run Race: Starts race (hidden during race).
- Pause / Resume: Toggles race state without affecting finish times.
- Reset Game: Returns to setup retaining horse list.
- Clear All Data: Removes all horses from storage.
- Share URL: Copies a prebuilt sharable link with current horses.

## Finish & Leaderboard Rules

1. Finish time captured exactly when a horse first crosses its lane distance.
2. Horse enters deceleration phase until speed reaches zero.
3. Race completes only after all horses have stopped.
4. Winner determined by lowest finish time; ties flagged `(tie)`.
5. Final leaderboard lists Rank | Name | Time | +Delta.

## Extending Ideas

- Export results as CSV and upload as artifact (placeholder—pipeline logic not yet implemented here).
- Add sound effects or countdown.
- Mobile adjustments (responsive scaling of `LANE_WIDTH`).
- Easing curves (e.g. quadratic ease-out) for deceleration.
- Different track shapes (figure-eight, etc.).

## Dev Notes

The app is framework-free; p5.js handles rendering/animation. All state lives in memory plus `localStorage`. To change styling or race behavior, edit `sketch.js` and `style.css`. No build step required.

## License

No explicit license declared yet; treat as private/personal until one is added.

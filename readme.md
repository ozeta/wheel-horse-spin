# Wheel Horse Spin

[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0-blue)](multiplayer-race/openapi.yaml)
[![Status](https://img.shields.io/badge/Mode-Single--Player_+_Multiplayer-green)](#summary)

Play single‑player: <https://ozeta.github.io/wheel-horse-spin/>

Multiplayer server: run locally from `multiplayer-race/` (WebSocket + REST + optional Postgres persistence)

Live multiplayer (Render): <https://wheel-horse-spin-mp-server.onrender.com/game.html>

## Gameplay & Objective

Wheel Horse Spin is a fast lap sprint focused on pacing and tactical boost timing. In multiplayer the psychological twist is: **your primary objective is to avoid being the last human finisher**. The human who arrives last pays the (figurative) "toll" – a social / penalty mechanic (e.g. picking up next round, forfeiting a token, or logging an owed favor) you can adapt to your group. Bots do not count for the toll; ranking is evaluated among human players only.

Key tension points:
- Rotating boost input (every 3s) forces attention and prevents macro scripting.
- Short countdown emphasizes readiness; early boost timing can create decisive separation.
- Deceleration after finish means photo-finishes can still shift if a trailing player surges before crossing.

House Rule Ideas for the Toll:
- Loser adds 1 to a cumulative debt counter.
- Loser must seed a special challenge for next race.
- Loser funds an in-game cosmetic (future feature) for the winner.

## Summary

Wheel Horse Spin is a browser-based horse racing game rendered with p5.js and plain HTML/CSS/JavaScript. It now supports both:

1. Single‑player local races (original mode)
2. Multiplayer lobby → countdown → race → results flow with dynamic boost key rotation and persistent leaderboards

Each session picks a DiceBear avatar style; avatars seed on horse/player name for consistent identity. Track geometry adapts to canvas size; races only end once all competitors (including bots in multiplayer) have crossed AND finished decelerating.

Render deployment provides a public multiplayer arena; see below for hosting notes.

## Core Features (Single‑Player)

- Horse Management: Add / remove horses, persisted via `localStorage`; optional sharing through URL query (`?horses=Name1,Name2`).
- Random Avatars: One DiceBear style chosen each page load; avatar seeded by horse name for repeatable identity.
- Adaptive Track: Oval track sized to canvas with alternating lane colors and a fixed-width finish line rectangle.
- Race States: `setup`, `racing`, `paused`, `finished` with appropriate button visibility (Run, Pause/Resume, Reset).
- Speed & Duration: Speeds normalized to target duration constant `MAX_EXECUTION_TIME` while allowing slight per-frame variation.
- Finish Logic: Each horse records a precise finish time then decelerates smoothly (coast phase) before stopping; race ends only when all horses have stopped.
- Leaderboards: Live leaderboard (finished show time, unfinished show ellipsis), final leaderboard shows rank, finish time, delta from winner, tie markers, colored bullets for top 3 (gold/silver/copper).
- Winner Overlay: Displays trophy icon, winner time, and total race duration (time of last finisher).
- Pause/Resume: Fully pauses motion and timing (paused seconds excluded from finish times).

## Key Constants (Single‑Player, in `sketch.js`)

- `MAX_EXECUTION_TIME`: Target race duration (seconds) influencing base speed.
- `LANE_WIDTH`: Visual lane thickness (affects track & avatar scale).
- `AVATAR_SIZE_FACTOR`: Multiplier for avatar size relative to lane width.
- `DECELERATION_DURATION_MS`: Milliseconds horses coast after crossing finish.
- `FINISH_LINE_WIDTH`: Width of the red finish rectangle.

## Data & Sharing (Single‑Player)

Horse roster saved in browser via `localStorage`. To share a lineup, construct a URL: `https://.../wheel-horse-spin/?horses=Seabiscuit,Secretariat` (max 10). On load, URL horses override stored horses and are then persisted.

## Controls (Single‑Player)

- Add Horse: Prompts for name, creates avatar.
- Run Race: Starts race (hidden during race).
- Pause / Resume: Toggles race state without affecting finish times.
- Reset Game: Returns to setup retaining horse list.
- Clear All Data: Removes all horses from storage.
- Share URL: Copies a prebuilt sharable link with current horses.

## Finish & Leaderboard Rules (Single‑Player)

1. Finish time captured exactly when a horse first crosses its lane distance.
2. Horse enters deceleration phase until speed reaches zero.
3. Race completes only after all horses have stopped.
4. Winner determined by lowest finish time; ties flagged `(tie)`.
5. Final leaderboard lists Rank | Name | Time | +Delta.

## Extending Ideas (Single‑Player)

- Export results as CSV and upload as artifact (placeholder—pipeline logic not yet implemented here).
- Add sound effects or countdown.
- Mobile adjustments (responsive scaling of `LANE_WIDTH`).
- Easing curves (e.g. quadratic ease-out) for deceleration.
- Different track shapes (figure-eight, etc.).

## Dev Notes (Single‑Player)

The app is framework-free; p5.js handles rendering/animation. All state lives in memory plus `localStorage`. To change styling or race behavior, edit `sketch.js` and `style.css`. No build step required.

## Multiplayer Overview

Located in `multiplayer-race/`:

- `server.js`: Express + WebSocket server; auto-migrates Postgres schema if `DATABASE_URL` set.
- `mp-game.js`: Client multiplayer rendering, dynamic rotating boost key HUD, avatar logging.
- `db/migrate.js` & `db/seed.js`: Schema ensure + demo data.
- `openapi.yaml`: REST endpoint specification (Swagger/OpenAPI 3.0).
- `thin-client.js`: Scriptable terminal client to simulate players.

### Phases
`lobby` → `countdown` (default 1s, adjustable) → `race` → `results` → host reset returns to `lobby`.

### Dynamic Boost Key Mechanic
- Rotates every 3s among: W A S D Q E Z X C Space.
- HUD shows current key + seconds until rotation; flashes yellow briefly on change; short sine beep.
- Key is forced released on rotation to prevent stuck boosts.

### Multiplayer Constants (excerpt)
`TOTAL_LANES`, `COUNTDOWN_SECONDS`, `BOOST_FACTOR`, `BOOST_MAX_DURATION_MS`, `BOOST_COOLDOWN_MS`, acceleration/deceleration rates, bot behavior probabilities.

### Leaderboard & Statistics
REST endpoints (see `openapi.yaml`) expose fastest times, top winners, player histories, last human finishes, room summaries, and last-place counts.

### Database Schema Highlights
Tables: `races`, `race_participants` (augmented with `is_last_human`, `human_final_position`, `human_finish_time_seconds`). Auto-indexed for common queries.

### Running Multiplayer
```zsh
cd multiplayer-race
npm install
npm start            # starts server on :8080
# Optional Postgres
export DATABASE_URL="postgresql://user:pass@host:5432/db"; npm start
```

Open browser to `http://localhost:8080`.

Swagger / API Docs (local): `http://localhost:8080/multiplayer-race/api-docs.html`

### Render.com Deployment
The live multiplayer instance runs on Render.com:
- Continuous Deployment: pushes to the tracked branch rebuild and redeploy automatically.
- Service Type: Web Service + optional PostgreSQL database (provisioned via `render.yaml`).
- Environment: `DATABASE_URL` injected by Render for leaderboards; if absent, endpoints degrade gracefully to empty lists.
- Free Tier Considerations: cold starts can briefly delay first response; database has limited connections & storage. Health endpoint exposes `db.configured` and `db.ok` for quick diagnostics.
- Static Assets: served directly via Express from repo root (no CDN layer). For heavier traffic consider enabling a CDN or splitting static hosting.

To self-host similarly:
1. Fork repository.
2. Add a new Web Service (Node) pointing to fork.
3. Add a PostgreSQL database; link its environment details.
4. Ensure `DATABASE_URL` present; deploy.
5. Verify `/api/health` returns `db.ok: true`.

### Simulating Players
```zsh
node thin-client.js ws://localhost:8080 roomId=dev username=Alice
node thin-client.js ws://localhost:8080 roomId=dev username=Bob pretty-output=true
```

### WebSocket Message Summary
Client → Server: `hello`, `setReady`, `startGame`, `pressBoost`, `rename`, `resetGame`, `returnToLobby`.
Server → Client: `welcome`, `roomState`, `countdown`, `raceStart`, `tick`, `boost`, `raceEnd`.

## Updated Documentation
Additional detailed docs live in:
- `multiplayer-race/README.md` (server usage & protocol)
- `multiplayer-race/DATABASE_SETUP.md` (database schema & provisioning)
- `multiplayer-race/game-description.md` (game design notes, updated for dynamic boost)
- `.github/copilot-instructions.md` (agent guidance covering both modes)
- `multiplayer-race/openapi.yaml` (OpenAPI spec)
- `multiplayer-race/api-docs.html` (Swagger UI HTML)

## Contributing & Style
Keep framework-free approach; prefer small, surgical changes. Avoid introducing build tooling unless explicitly requested.

## License
No explicit license declared yet; treat as private/personal until one is added.

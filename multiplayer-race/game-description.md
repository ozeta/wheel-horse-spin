## Game Description (Multiplayer Mode)

### Objective

Be the first (human or bot) to cross the finish line. Official finish time is captured at first crossing; race concludes only after every competitor fully decelerates to zero speed.

### Phases

`lobby` → `countdown` (short; currently 1s) → `race` → `results` → host reset → `lobby`.

### Lobby

- Shows human players (bots hidden until race start) with id, username, ready state, optional last result (time & position).
- Username can be set via UI or URL query `?username=Name`.
- First arrival becomes `host` (can start when alone or when all are ready).
- Start condition: either single player OR all players marked ready.

### Player Limits

- Human players: configurable; current `MAX_PLAYERS = 6`.
- Total lanes: `TOTAL_LANES = 8` (bots fill remaining lanes so race always has consistent track occupancy).
- Bots: `TOTAL_LANES - humanCount` auto-generated with deterministic lane allocation.

### Dynamic Boost Key Mechanic

- Rotating key every 3000ms among set: `W A S D Q E Z X C Space`.
- HUD shows current key and seconds until next rotation; flashes highlight + plays short beep on change.
- Boost auto-released when rotation occurs (prevents stale boost hold).
- Server enforces max boost duration (`BOOST_MAX_DURATION_MS`) and cooldown (`BOOST_COOLDOWN_MS`).

### Movement & Physics

- Base speed normalized to nominal lap duration (`MAX_EXECUTION_TIME`).
- Acceleration/deceleration curves smoothly lerp toward target (boost vs idle) with jitter to avoid uniform motion.
- Post-finish deceleration physics continues until speed reaches zero; only then is competitor marked fully finished.

### Countdown

- Short `COUNTDOWN_SECONDS` (currently 1) displayed; includes hint of current boost key so player can anticipate first boost.

### Results

- Compiled list of humans + bots with finish times, delta from winner, sorted ascending.
- Persisted to database when configured, capturing additional human-only fields (`is_last_human`, `human_final_position`, `human_finish_time_seconds`).

### Bots

- Personality factors: bias factor, jitter scale, boost preference to create varied behavior.
- Use similar acceleration rules as humans but probabilistic boost triggers.

### Future Enhancements (Optional)

- Server-authoritative dynamic boost key broadcast (current rotation is client-side only).
- Accessibility: fixed boost key toggle for players needing consistency.
- Variable countdown duration based on player count.
- Additional stats (median finish time, consistency index).

### Fair Play Considerations

- Client forcibly ends boost on key rotation and at max duration expiry.
- Server revalidates cooldown and auto-expires boosts beyond duration.

### Design Principles

- Keep protocol compact; send minimal tick data (progress + speed + finished flag).
- Avoid continuous per-frame REST calls—only WebSocket for live updates; REST reserved for aggregated stats.

# Wheel Horse Spin — Multiplayer Server

Node.js WebSocket + REST server implementing lobby → countdown → race → results with bots filling remaining lanes and dynamic rotating boost keys.

## Setup

```zsh
cd multiplayer-race
npm install
```

## Run server (DB optional)

```zsh
npm start
# or
node server.js
```

- Listens on `:8080` by default (set `PORT` to override).
- Visit `http://localhost:8080` to open the multiplayer page.
- Single-player assets served from repo root; multiplayer HUD logic in `mp-game.js`.

### Enable Database Leaderboards

If you set `DATABASE_URL`, the server will:

- Auto-run migrations on startup (idempotent)
- Save race results at the end of each race
- Serve leaderboard APIs

```zsh
export DATABASE_URL="postgresql://username:password@host:port/dbname"
npm start
```

### Local Postgres via Docker Compose

You can spin up Postgres locally with Adminer using the root `docker-compose.yml`:

```zsh
# From repo root
docker compose up -d

# Connection string for local DB
export DATABASE_URL="postgresql://whs:whs_password@localhost:5432/wheel_horse_spin"

# Run migrations (optional, server will auto-migrate on start)
cd multiplayer-race
npm run db:migrate

# Seed demo data
npm run db:seed

# Start server (leaderboards active)
npm start
```

Adminer UI: open `http://localhost:8081` (System: PostgreSQL, Server: `db` or `localhost`, Username: `whs`, Password: `whs_password`, Database: `wheel_horse_spin`).

### REST API Summary

See `openapi.yaml` for full schema.

| Endpoint | Description |
|----------|-------------|
| `GET /api/commit` | Current commit SHA |
| `GET /api/health` | Server + DB health |
| `GET /api/leaderboard/fastest` | Fastest winner times (global) |
| `GET /api/leaderboard/top` | Top winners (wins + best time) |
| `GET /api/leaderboard/player/:username` | Recent races for player |
| `GET /api/leaderboard/last-humans` | Most recent last human finishes (optional room filter) |
| `GET /api/leaderboard/room-summary?room=ID` | Aggregated wins/last places for a room |
| `GET /api/leaderboard/room-loses?room=ID` | Users ordered by last-place count |

If DB absent: endpoints return empty arrays.

Notes:
- Health endpoint reports `db.configured` and `db.ok` (with optional `error`).

## Thin client

Open a second terminal to simulate players:

```zsh
npm run client
# or specify args
node thin-client.js ws://localhost:8080 roomId=dev username=Alice
node thin-client.js ws://localhost:8080 roomId=dev username=Bob
# Pretty output and debug pause
node thin-client.js ws://localhost:8080 roomId=dev username=Alice pretty-output=true
node thin-client.js ws://localhost:8080 roomId=dev username=Alice pretty-output=true debug=true
```

## Protocol (summary)

- Client → Server
  - `hello { roomId, username, version }`
  - `setReady { ready }`
  - `startGame {}` (host only)
  - `pressBoost { down, atClientMs }`
  - `returnToLobby {}` (host only)
-- Server → Client
  - `welcome { clientId, roomId, hostId }`
  - `roomState { players[], bots[], phase, hostId, constants }`
  - `countdown { secondsLeft, countdownEndsAt }`
  - `raceStart { raceId, raceStartEpochMs, players[], bots[], seeds, constants }`
  - `tick { tServerMs, players[], bots[] }`
  - `boost { playerId, down, accepted, cooldownMsRemaining? }`
  - `raceEnd { results }`

### Dynamic Boost Key (Client HUD)
- Rotates every 3s among `W A S D Q E Z X C Space`.
- HUD shows countdown seconds until next rotation.
- Flash highlight and beep on change; boost forcibly released.

Server enforces boost duration (`BOOST_MAX_DURATION_MS`) & cooldown (`BOOST_COOLDOWN_MS`).

## Database & Deployment
### Schema Delta
`race_participants` includes extra columns: `is_last_human`, `human_final_position`, `human_finish_time_seconds` and index `idx_participants_last_human`.

### OpenAPI
Import `openapi.yaml` into Swagger UI / Postman for interactive docs.

### Extending
- Add new metrics: create SQL query, expose via `/api/...`, update `openapi.yaml`.
- Move boost key rotation server-side for authoritative fairness (broadcast current key each tick).
- Add accessibility override to fix boost key.


See `multiplayer-race/DATABASE_SETUP.md` and root `render.yaml` for provisioning a managed PostgreSQL on Render and linking `DATABASE_URL` to the web service.

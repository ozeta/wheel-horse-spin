# Wheel Horse Spin — Multiplayer Server

Node.js WebSocket server implementing lobby → countdown → race → results for the Wheel Horse Spin game.

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

### Enable Database Leaderboards

If you set `DATABASE_URL`, the server will:

- Auto-run migrations on startup (idempotent)
- Save race results at the end of each race
- Serve leaderboard APIs

```zsh
export DATABASE_URL="postgresql://username:password@host:port/dbname"
npm start
```

APIs:
- `GET /api/health` — server + DB status
- `GET /api/commit` — current commit SHA
- `GET /api/leaderboard/top` — top winners (wins + best time)
- `GET /api/leaderboard/fastest` — fastest winner times
- `GET /api/leaderboard/player/:username` — recent races for a player

Notes:
- If no DB is configured, leaderboard endpoints return `{ items: [] }`.
- Health endpoint reports `db.configured` and `db.ok`.

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
- Server → Client
  - `welcome { clientId, roomId, hostId }`
  - `roomState { players[], bots[], phase, hostId, constants }`
  - `countdown { secondsLeft, countdownEndsAt }`
  - `raceStart { raceId, raceStartEpochMs, players[], bots[], seeds, constants }`
  - `tick { tServerMs }`
  - `raceEnd { results }`

## Render Deployment

See `multiplayer-race/DATABASE_SETUP.md` and root `render.yaml` for provisioning a managed PostgreSQL on Render and linking `DATABASE_URL` to the web service.

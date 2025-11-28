# Wheel Horse Spin — Multiplayer Server

Node.js WebSocket server implementing lobby → countdown → race → results for the Wheel Horse Spin game.

## Setup

```sh
cd multiplayer-race
npm install
```

## Run server

```sh
npm start
# or
node server.js
```

Server listens on `:8080` by default (set `PORT` to override).

## Thin client

Open a second terminal to simulate players:

```sh
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
  - `raceEnd { results[] }`


## Notes

- Bots fill to 10 lanes; human max 6.
- Boost events are relayed; validation/cooldowns can be enforced server-side later.
- Countdown lasts 5 seconds; server broadcasts start time.

## Thin client options

- `roomId`: room identifier (default `default`)
- `username`: display name (default random Tester_XXXX)
- `pretty-output=true|false`: compact human-friendly logs
- `debug=true|false`: pause after each server message until Enter

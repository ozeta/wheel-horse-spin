import WebSocket from "ws";

const URL = "ws://localhost:8080";
const PLAYERS = 10;
const PRESS_MS = 40; // ~25 press/sec
const clients = [];

for (let i = 0; i < PLAYERS; i++) {
  const ws = new WebSocket(URL);
  ws.on("message", (m) => console.log(`[Player ${i}]`, m.toString()));
  ws.on("open", () => console.log(`Player ${i} connected`));
  clients.push(ws);
  clients[i] = ws;
}

setTimeout(() => {
  console.log("Start spamming SPACE presses...");
  for (let i = 0; i < PLAYERS; i++) {
    setInterval(() => {
      clients[i].send(JSON.stringify({ type: "press", key: "SPACE" }));
    }, PRESS_MS);
  }
}, 1000);

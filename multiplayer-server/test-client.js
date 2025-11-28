// test-client.js
import WebSocket from "ws";

const URL = "ws://localhost:8080";
const PLAYER_COUNT = 2;
const PRESS_INTERVAL_MS = 50; // ogni 50ms = 20 press/sec max

for (let i = 0; i < PLAYER_COUNT; i++) {
  const ws = new WebSocket(URL);

  ws.on("open", () => {
    console.log(`Player ${i} connected`);
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());
    // log all updates
    if (data.type === "update") {
      console.log(`Player ${i} sees:`, data.scores);
    }
  });

  // Simulate pressing SPACE
  setInterval(() => {
    ws.send(JSON.stringify({ type: "press", key: "SPACE" }));
  }, PRESS_INTERVAL_MS);
}

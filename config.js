// Optional client config for multiplayer backend URL.
// If deployed, set window.__MP_SERVER_URL to your Render backend WebSocket URL.
// Example:
//   window.__MP_SERVER_URL = 'wss://wheel-horse-spin-mp-server.onrender.com';
// If left unset, mp-game.js will fall back to meta tag or ws://localhost:8080.
(function(){
  if (typeof window === 'undefined') return;
  // No-op by default.
})();

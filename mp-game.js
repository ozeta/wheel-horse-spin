// Multiplayer-only game page logic for Wheel Horse Spin
// Parameters: ?room=ROOM&name=USERNAME
// Defaults: room=dev, name=Browser
// Lobby lists only real players (bots hidden). Host is first arrival; can start with 1 player.

const MP = {
  ws: null,
  connected: false,
  clientId: null,
  hostId: null,
  phase: 'lobby', // lobby|countdown|race|results
  players: [],
  countdownEndsAt: null,
  room: null,
  username: null,
};

// DOM references
let serverUrlInput, roomNameInput, usernameInput, connectBtn, readyBtn, startBtn,
    playerListUL, statusDiv, countdownHeader, renameWrap, renameInput, renameBtn,
    raceOverlay;

// --- Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  serverUrlInput = document.getElementById('serverUrl');
  roomNameInput = document.getElementById('roomName');
  usernameInput = document.getElementById('username');
  connectBtn = document.getElementById('connectBtn');
  readyBtn = document.getElementById('readyBtn');
  startBtn = document.getElementById('startBtn');
  playerListUL = document.getElementById('player-list');
  statusDiv = document.getElementById('status');
  countdownHeader = document.getElementById('countdownHeader');
  renameWrap = document.getElementById('renameWrap');
  renameInput = document.getElementById('renameInput');
  renameBtn = document.getElementById('renameBtn');
  raceOverlay = document.getElementById('raceOverlay');

  // URL parameters
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  const nameParam = params.get('name');
  roomNameInput.value = roomParam || 'dev';
  usernameInput.value = nameParam || 'Browser';

  connectBtn.addEventListener('click', connectMP);
  readyBtn.addEventListener('click', toggleReady);
  startBtn.addEventListener('click', startGame); // host only
  renameBtn.addEventListener('click', doRename);

  // Auto-connect if both room and name provided in URL
  if (roomParam && nameParam) {
    connectMP();
  }
});

function connectMP() {
  if (MP.connected) return;
  const url = (serverUrlInput.value || 'ws://localhost:8080').trim();
  MP.room = (roomNameInput.value || 'dev').trim();
  MP.username = (usernameInput.value || 'Browser').trim();
  MP.ws = new WebSocket(url);
  statusDiv.textContent = 'Connecting...';
  MP.ws.onopen = () => {
    MP.ws.send(JSON.stringify({ type: 'hello', roomId: MP.room, username: MP.username, version: 1 }));
    MP.connected = true;
    statusDiv.textContent = 'Connected. Waiting for welcome...';
  };
  MP.ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };
  MP.ws.onclose = () => {
    statusDiv.textContent = 'Disconnected.';
    MP.connected = false;
    MP.phase = 'lobby';
  };
  MP.ws.onerror = () => { statusDiv.textContent = 'Connection error.'; };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      MP.clientId = msg.clientId; MP.hostId = msg.hostId; statusDiv.textContent = `Joined room ${msg.roomId}`;
      readyBtn.disabled = false; renameWrap.style.display = 'flex';
      updateButtons();
      break;
    case 'roomState':
      MP.phase = msg.phase;
      MP.hostId = msg.hostId;
      MP.players = (msg.players || []).map(p => ({ id: p.id, username: p.username, ready: p.ready, lane: p.lane }));
      renderPlayers();
      updateButtons();
      countdownHeader.style.display = 'none';
      if (MP.phase === 'lobby') {
        raceOverlay.style.display = 'none';
      }
      break;
    case 'countdown':
      MP.phase = 'countdown';
      MP.countdownEndsAt = msg.countdownEndsAt;
      countdownHeader.style.display = 'block';
      break;
    case 'raceStart':
      MP.phase = 'race'; countdownHeader.style.display = 'none'; raceOverlay.style.display = 'none';
      break;
    case 'tick':
      if (MP.phase === 'countdown' && MP.countdownEndsAt) {
        const remaining = Math.max(0, Math.round((MP.countdownEndsAt - Date.now()) / 1000));
        countdownHeader.textContent = `Countdown: ${remaining}s`;
      }
      break;
    case 'raceEnd':
      MP.phase = 'results'; raceOverlay.style.display = 'flex';
      break;
    case 'boost':
      // ignore for lobby UI
      break;
  }
}

function updateButtons() {
  const isHost = MP.clientId === MP.hostId;
  startBtn.style.display = isHost ? 'block' : 'none';
  startBtn.disabled = !(isHost && MP.phase === 'lobby');
  const me = MP.players.find(p => p.id === MP.clientId);
  if (me) {
    readyBtn.textContent = me.ready ? 'Unready' : 'Ready to Start';
    // Disable rename while marked ready
    if (renameBtn) {
      renameBtn.disabled = me.ready;
    }
  }
}

function renderPlayers() {
  playerListUL.innerHTML = '';
  MP.players.forEach(p => {
    const li = document.createElement('li');
    const hostMark = p.id === MP.hostId ? ' (host)' : '';
    const readyMark = p.ready ? ' [R]' : '';
    li.textContent = `#${p.id} ${p.username}${hostMark}${readyMark}`;
    playerListUL.appendChild(li);
  });
  statusDiv.textContent = `Players: ${MP.players.length}`;
}

function toggleReady() {
  if (!MP.ws) return;
  const me = MP.players.find(p => p.id === MP.clientId);
  const newReady = !(me && me.ready);
  MP.ws.send(JSON.stringify({ type: 'setReady', ready: newReady }));
  // Optimistic UI update for rename disabled state before roomState returns
  if (renameBtn) renameBtn.disabled = newReady;
}

function startGame() {
  if (!MP.ws) return;
  if (MP.clientId !== MP.hostId) return;
  MP.ws.send(JSON.stringify({ type: 'startGame' }));
}

function doRename() {
  if (!MP.ws || MP.phase === 'race') return;
  const newName = renameInput.value.trim();
  if (newName && newName.length <= 40) {
    MP.ws.send(JSON.stringify({ type: 'rename', username: newName }));
    usernameInput.value = newName; // reflect change locally
  }
}

// --- (Optional) Race Rendering Placeholder ---
// We could reuse full track rendering later; for now a minimal p5 canvas with phase label.
let phaseLabel = '';
function setup() {
  const canvasContainer = document.getElementById('canvas-container');
  const rect = canvasContainer.getBoundingClientRect();
  const c = createCanvas(rect.width, rect.height);
  c.parent(canvasContainer);
}
function windowResized() {
  const canvasContainer = document.getElementById('canvas-container');
  const rect = canvasContainer.getBoundingClientRect();
  resizeCanvas(rect.width, rect.height);
}
function draw() {
  background(30, 110, 40);
  phaseLabel = MP.phase.toUpperCase();
  fill(255); textAlign(CENTER, CENTER); textSize(42);
  text(phaseLabel, width/2, height/2);
  if (MP.phase === 'results') {
    textSize(18); text('Race complete', width/2, height/2 + 50);
  }
}

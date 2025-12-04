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
  bots: [],
  countdownEndsAt: null,
  room: null,
  username: null,
};

const synthwave = {
  context: null,
  masterGain: null,
  bassGain: null,
  leadGain: null,
  drumGain: null,
  noiseBuffer: null,
  isPlaying: false,
  tempo: 0,
  beatDuration: 0,
  nextNoteTime: 0,
  stepIndex: 0,
  schedulerId: null,
  bassPattern: [],
  leadPattern: [],
  hatPattern: [],
  snareSteps: [],
  scale: [],
  kickGain: null,
  kickPattern: [],
  padGain: null,
  padFilter: null,
  padVoices: [],
  chordIndex: 0,
  lastMeasureTarget: 0,
};

// DOM references
let displayServer, displayRoom, connectBtn, readyBtn, startBtn, resetBtn,
    toggleMusicBtn, playerListUL, statusDiv, countdownHeader, renameWrap, renameInput, renameBtn,
    raceOverlay, lobbySection, resultsWrap, finalList;
// Config captured from URL or defaults
// Derive server URL: same-origin WebSocket by default (works locally and on Render)
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.host; // includes port
MP.serverUrl = `${protocol}//${host}`;

// --- Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  displayServer = document.getElementById('displayServer');
  displayRoom = document.getElementById('displayRoom');
  lobbySection = document.getElementById('lobby');
  connectBtn = document.getElementById('connectBtn');
  readyBtn = document.getElementById('readyBtn');
  startBtn = document.getElementById('startBtn');
  resetBtn = document.getElementById('resetBtn');
  toggleMusicBtn = document.getElementById('toggleMusic');
  playerListUL = document.getElementById('player-list');
  statusDiv = document.getElementById('status');
  countdownHeader = document.getElementById('countdownHeader');
  renameWrap = document.getElementById('renameWrap');
  renameInput = document.getElementById('renameInput');
  renameBtn = document.getElementById('renameBtn');
  raceOverlay = document.getElementById('raceOverlay');
  resultsWrap = document.getElementById('resultsWrap');
  finalList = document.getElementById('final-list');

  // URL parameters
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  const nameParam = params.get('name');
  const serverParam = params.get('server');
  MP.room = (roomParam && roomParam.trim()) || 'dev';
  MP.username = (nameParam && nameParam.trim()) || 'Browser';
  // Allow server override via query param
  MP.serverUrl = (serverParam && serverParam.trim()) || MP.serverUrl;
  // If server param provided, prefer it
  // Normalize protocol: if page is https and using ws:// remote host, upgrade to wss://
  try {
    const u = new URL(MP.serverUrl, window.location.href);
    if (window.location.protocol === 'https:' && u.protocol === 'ws:') {
      u.protocol = 'wss:';
      MP.serverUrl = u.toString();
    }
  } catch {}
  if (displayServer) displayServer.textContent = `Server: ${MP.serverUrl}`;
  if (displayRoom) displayRoom.textContent = `Room: ${MP.room}`;

  if (connectBtn) connectBtn.addEventListener('click', connectMP);
  readyBtn.addEventListener('click', toggleReady);
  startBtn.addEventListener('click', startGame); // host only
  resetBtn.addEventListener('click', resetGame); // host only
  renameBtn.addEventListener('click', doRename);
  if (toggleMusicBtn) {
    toggleMusicBtn.addEventListener('click', toggleSynthwave);
    updateToggleMusicButton();
  }

  // Auto-connect if both room and name provided in URL
  if (roomParam && nameParam) {
    connectMP();
  }

  // Fetch and display commit SHA
  fetch('/api/commit')
    .then(res => res.json())
    .then(data => {
      const shaEl = document.getElementById('commitSha');
      if (shaEl) shaEl.textContent = `commit: ${data.sha}`;
    })
    .catch(() => {
      const shaEl = document.getElementById('commitSha');
      if (shaEl) shaEl.textContent = 'commit: unknown';
    });

  // Keyboard boost listeners
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
});

function connectMP() {
  if (MP.connected) return;
  // Username already taken from URL param or kept after rename
  MP.ws = new WebSocket(MP.serverUrl);
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
    countdownBoostPrimed = false;
    boostKeyInitialized = false;
    scheduleNextBoostKeyRotation(Number.POSITIVE_INFINITY);
    localPlayerFinished = false;
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
      MP.bots = (msg.bots || []).map(b => ({ lane: b.lane, username: b.username }));
      renderPlayers();
      updateButtons();
      buildTrackObjectsFromPlayers();
      countdownHeader.style.display = 'none';
      if (MP.phase === 'lobby') {
        raceOverlay.style.display = 'none';
        if (lobbySection) lobbySection.style.display = 'block';
        if (resultsWrap) resultsWrap.style.display = 'none';
        countdownBoostPrimed = false;
        scheduleNextBoostKeyRotation(Number.POSITIVE_INFINITY);
        localPlayerFinished = false;
      }
      // Refresh leaderboards once we have room state (ensures MP.room is set and connection established)
      try { if (typeof window.refreshLeaderboards === 'function') window.refreshLeaderboards(); } catch {}
      break;
    case 'countdown':
      MP.phase = 'countdown';
      MP.countdownEndsAt = msg.countdownEndsAt;
      countdownHeader.style.display = 'block';
      if (lobbySection) lobbySection.style.display = 'block';
      if (!countdownBoostPrimed) {
        primeBoostKeyForCountdown();
      } else {
        scheduleNextBoostKeyRotation(Number.POSITIVE_INFINITY);
      }
      localPlayerFinished = false;
      countdownHeader.textContent = `Countdown: -- (Boost key: ${displayBoostKey(currentBoostKey)})`;
      break;
    case 'raceStart':
      MP.phase = 'race'; countdownHeader.style.display = 'none'; raceOverlay.style.display = 'none';
      buildTrackObjectsFromPlayers(); // ensure roster locked for race
      if (lobbySection) lobbySection.style.display = 'none';
      initDynamicBoost();
      localPlayerFinished = false;
      break;
    case 'tick':
      if (MP.phase === 'countdown' && MP.countdownEndsAt) {
        const remaining = Math.max(0, Math.round((MP.countdownEndsAt - Date.now()) / 1000));
        countdownHeader.textContent = `Countdown: ${remaining}s (Boost key: ${displayBoostKey(currentBoostKey)})`;
      }
      if (MP.phase === 'race') {
        if (msg.players) syncRaceProgress(msg.players);
        if (msg.bots) syncBotProgress(msg.bots);
      }
      break;
    case 'raceEnd':
      MP.phase = 'results'; raceOverlay.style.display = 'flex';
      scheduleNextBoostKeyRotation(Number.POSITIVE_INFINITY);
      countdownBoostPrimed = false;
      // Reset all players to unready on client side
      MP.players.forEach(p => { p.ready = false; });
      // Populate Final Leaderboard in sidebar
      if (resultsWrap && finalList) {
        resultsWrap.style.display = 'block';
        finalList.innerHTML = '';
        const items = (msg.results && msg.results.results) ? msg.results.results.slice() : [];
        items.sort((a,b)=>a.finishSeconds - b.finishSeconds);
        const winnerTime = items.length ? items[0].finishSeconds : null;
        items.forEach((r, idx) => {
          const li = document.createElement('li');
          const delta = (winnerTime != null && r.finishSeconds != null) ? (r.finishSeconds - winnerTime) : null;
          const deltaStr = delta == null ? '' : (delta === 0 ? ' +0.00s' : ` +${delta.toFixed(2)}s`);
          const timeStr = r.finishSeconds != null ? `${r.finishSeconds.toFixed(2)}s` : '';
          const botTag = r.isBot ? ' [Bot]' : '';
          const name = (r.username || (r.isBot ? `Bot_${(r.lane ?? 0)+1}` : `#${r.id}`)) + botTag;
          // Top 3 markers
          const podium = idx === 0 ? '🏆' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '•';
          li.textContent = `${podium} ${idx+1}. ${name} — ${timeStr}${deltaStr}`;
          finalList.appendChild(li);
        });
      }
      if (lobbySection) lobbySection.style.display = 'block';
      // Update UI to reflect unready state
      renderPlayers();
      updateButtons();
      // Refresh leaderboards immediately on race completion
      if (typeof window.refreshLeaderboards === 'function') {
        try {
          window.refreshLeaderboards();
          setTimeout(() => {
            try { window.refreshLeaderboards(); } catch (err) { console.warn('refreshLeaderboards retry failed', err); }
          }, 800);
        } catch (err) {
          console.warn('refreshLeaderboards failed', err);
        }
      }
      break;
    case 'boost':
      // show notification on boost press/release
      if (msg.down && msg.accepted) {
        showBoostNotice('Speed Up!');
      } else if (msg.down && msg.accepted === false) {
        const remain = typeof msg.cooldownMsRemaining === 'number' ? Math.max(0, Math.round(msg.cooldownMsRemaining/100)/10) : null;
        showBoostNotice(remain != null ? `Cooldown ${remain}s…` : 'Cooldown…');
      }
      break;
  }
}

function updateButtons() {
  const isHost = MP.clientId === MP.hostId;
  const me = MP.players.find(p => p.id === MP.clientId);
  const allReady = MP.players.every(p => p.ready);
  const hostPlayer = MP.players.find(p => p.id === MP.hostId);

  // Show start button only in lobby phase, reset button only in results phase
  startBtn.style.display = isHost && MP.phase === 'lobby' ? 'block' : 'none';
  // Enable start button only when all players (including single player) are ready
  startBtn.disabled = !(isHost && MP.phase === 'lobby' && allReady);

  resetBtn.style.display = isHost && MP.phase === 'results' ? 'block' : 'none';
  resetBtn.disabled = !(isHost && MP.phase === 'results');

  // Disable ready button when game is in results phase (only host can reset)
  readyBtn.disabled = MP.phase === 'results';

  if (me) {
    readyBtn.textContent = me.ready ? 'Unready' : 'Ready to Start';
    // Disable rename while marked ready
    if (renameBtn) {
      renameBtn.disabled = me.ready;
    }
  }

  if (MP.phase === 'race' && localPlayerFinished) {
    readyBtn.disabled = true;
    readyBtn.textContent = 'Finished';
    if (renameBtn) renameBtn.disabled = true;
    readyBtn.classList.remove('ready-active');
    startBtn.classList.remove('start-active');
    return;
  }

  const shouldGlowReady = MP.phase === 'lobby' && (!me || !me.ready) && !readyBtn.disabled;
  readyBtn.classList.toggle('ready-active', shouldGlowReady);

  const shouldGlowStart = MP.phase === 'lobby' && isHost && hostPlayer && hostPlayer.ready && !startBtn.disabled;
  startBtn.classList.toggle('start-active', shouldGlowStart);
}

function renderPlayers() {
  playerListUL.innerHTML = '';
  MP.players.forEach(p => {
    const li = document.createElement('li');
    const hostMark = p.id === MP.hostId ? ' (host)' : '';
    const readyMark = p.ready ? ' [ready 🟢]' : ' [not ready 🔴]';
    const youMark = p.id === MP.clientId ? ' (You)' : '';
    li.textContent = `#${p.id} ${p.username}${youMark}${hostMark}${readyMark}`;
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

function resetGame() {
  if (!MP.ws) return;
  if (MP.clientId !== MP.hostId) return;
  MP.ws.send(JSON.stringify({ type: 'resetGame' }));
}

function doRename() {
  if (!MP.ws || MP.phase === 'race') return;
  const newName = renameInput.value.trim();
  if (newName && newName.length <= 40) {
    MP.ws.send(JSON.stringify({ type: 'rename', username: newName }));
    MP.username = newName; // keep local copy
  }
}

// --- (Optional) Race Rendering Placeholder ---
// We could reuse full track rendering later; for now a minimal p5 canvas with phase label.
// --- Track Rendering (adapted from single-player sketch) ---
// --- Rendering Constants (tweak as desired) ---
let trackGeometry = {};
// Fixed aspect ratio for canvas (e.g., 16:9)
const ASPECT_W = 16;
const ASPECT_H = 9;
const LANE_WIDTH = 40; // Lane thickness in pixels
const AVATAR_SIZE_FACTOR = 0.8; // Avatar size relative to lane width
const FINISH_LINE_WIDTH = 100; // Finish line chessboard width
const INTERP_ALPHA = 0.25; // Smoothing factor toward server target (0..1)
let trackObjects = []; // { id, username, lane, progress, remoteProgress, totalDistance, img }
// DiceBear avatar style selection (random like sketch.js)
const AVATAR_STYLES = [
  'adventurer', 'avataaars', 'big-ears', 'big-smile', 'bottts', 'croodles',
  'fun-emoji', 'lorelei', 'micah', 'miniavs', 'open-peeps', 'personas', 'pixel-art'
];
let avatarStyle = AVATAR_STYLES[Math.floor(Math.random() * AVATAR_STYLES.length)];

// --- Dynamic Boost Key Rotation (client-side only) ---
// Rotate every 3s among WASDQEZXC + Space. Includes countdown, sound cue, flash.
const BOOST_KEYS = ['W','A','S','D','Q','E','Z','X','C',' '];
const BOOST_KEY_INTERVAL_MS = 3000;
let currentBoostKey = 'E';
let nextKeyChangeAt = 0; // performance.now() timestamp for next change
let lastBoostKey = null;
let keyFlashUntil = 0; // highlight flash end timestamp
let _boostDown = false; // moved earlier to allow rotation-induced release
let _boostNotice = null; // { text, ts, durationMs }
let boostKeyInitialized = false;
let countdownBoostPrimed = false;
let localPlayerFinished = false;

function displayBoostKey(k) { return k === ' ' ? 'Space' : k; }

function playBoostKeyCue() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880; // A5 beep
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

function scheduleNextBoostKeyRotation(delayMs = BOOST_KEY_INTERVAL_MS) {
  if (!Number.isFinite(delayMs)) {
    nextKeyChangeAt = Number.POSITIVE_INFINITY;
  } else {
    nextKeyChangeAt = performance.now() + delayMs;
  }
}

function rotateBoostKey() {
  const candidates = BOOST_KEYS.filter(k => k !== currentBoostKey);
  const idx = Math.floor(Math.random() * candidates.length);
  lastBoostKey = currentBoostKey;
  currentBoostKey = candidates[idx] || currentBoostKey;
  boostKeyInitialized = true;
  scheduleNextBoostKeyRotation();
  keyFlashUntil = performance.now() + 600; // flash ~600ms
  playBoostKeyCue();
  // Release boost if held when key changes to avoid stuck boost
  if (_boostDown) {
    _boostDown = false;
    try { if (MP.ws) MP.ws.send(JSON.stringify({ type: 'pressBoost', down: false, atClientMs: Date.now(), reason: 'keyRotated' })); } catch {}
  }
  try { console.log('[DynamicBoost] New boost key:', displayBoostKey(currentBoostKey)); } catch {}
}

function primeBoostKeyForCountdown() {
  rotateBoostKey();
  scheduleNextBoostKeyRotation(Number.POSITIVE_INFINITY);
  countdownBoostPrimed = true;
}

function initDynamicBoost() {
  if (!boostKeyInitialized) {
    rotateBoostKey();
  } else {
    scheduleNextBoostKeyRotation();
  }
  countdownBoostPrimed = false;
}

function setup() {
  const canvasContainer = document.getElementById('canvas-container');
  if (!canvasContainer) return;
  const { w, h } = computeCanvasSize(canvasContainer);
  const c = createCanvas(w, h);
  c.parent(canvasContainer);
  frameRate(60);
  buildTrackObjectsFromPlayers(); // initial (may be empty)
  // Log avatar style once after p5 setup (game loaded)
  try {
    console.log('[WheelHorseSpin Multiplayer] Avatar style:', avatarStyle);
    const sampleSeed = (MP.players && MP.players[0] && MP.players[0].username) || 'Sample';
    console.log('[WheelHorseSpin Multiplayer] Sample avatar URL:', `https://api.dicebear.com/8.x/${avatarStyle}/svg?seed=${encodeURIComponent(sampleSeed)}`);
  } catch (e) {}
}

function windowResized() {
  const canvasContainer = document.getElementById('canvas-container');
  if (!canvasContainer) return;
  const { w, h } = computeCanvasSize(canvasContainer);
  resizeCanvas(w, h);
  calculateTrackGeometry();
}

function computeCanvasSize(containerEl) {
  const rect = containerEl.getBoundingClientRect();
  const availW = Math.max(1, rect.width);
  const availH = Math.max(1, rect.height);
  const targetAspect = ASPECT_W / ASPECT_H;
  // Fit within container while preserving aspect
  let w = availW;
  let h = Math.round(w / targetAspect);
  if (h > availH) {
    h = availH;
    w = Math.round(h * targetAspect);
  }
  return { w, h };
}

function calculateTrackGeometry() {
  const numLanes = trackObjects.length || 1; // Dynamic based on actual participants
  const margin = 40;
  const laneWidth = LANE_WIDTH;
  const outerRectWidth = width - 2 * margin;
  const outerRectHeight = height - 2 * margin;
  const arcDiameter = outerRectHeight;
  const arcRadius = arcDiameter / 2;
  const straightLength = Math.max(0, outerRectWidth - arcDiameter);
  trackGeometry = {
    margin,
    laneWidth,
    numLanes,
    arcRadius,
    straightLength,
    leftArcCenter: { x: margin + arcRadius, y: height / 2 },
    rightArcCenter: { x: margin + arcRadius + straightLength, y: height / 2 },
  };
  // Update totalDistance for each trackObject when geometry changes
  trackObjects.forEach(obj => {
    const laneRadius = arcRadius - (obj.lane * laneWidth) - (laneWidth / 2);
    obj.totalDistance = (2 * straightLength) + (TWO_PI * laneRadius);
  });
}

function drawTrack() {
  const { numLanes, laneWidth, arcRadius, straightLength, leftArcCenter, rightArcCenter } = trackGeometry;
  if (!arcRadius) return;

  const outerRadius = arcRadius - laneWidth / 2;

  push();
  stroke(0, 242, 255, 28);
  strokeWeight((laneWidth * numLanes) + 36);
  noFill();
  arc(leftArcCenter.x, leftArcCenter.y, outerRadius * 2, outerRadius * 2, HALF_PI, PI + HALF_PI);
  arc(rightArcCenter.x, rightArcCenter.y, outerRadius * 2, outerRadius * 2, PI + HALF_PI, HALF_PI);
  line(leftArcCenter.x, leftArcCenter.y - outerRadius, rightArcCenter.x, rightArcCenter.y - outerRadius);
  line(rightArcCenter.x, rightArcCenter.y + outerRadius, leftArcCenter.x, leftArcCenter.y + outerRadius);
  pop();

  push();
  noFill();
  strokeCap(SQUARE);
  strokeJoin(ROUND);
  strokeWeight(laneWidth);
  for (let i = 0; i < numLanes; i++) {
    const laneRadius = arcRadius - (i * laneWidth) - (laneWidth / 2);
    if (laneRadius <= 0) continue;
    const laneColor = i % 2 === 0 ? color(0, 242, 255, 160) : color(0, 140, 190, 160);
    stroke(laneColor);
    arc(leftArcCenter.x, leftArcCenter.y, laneRadius * 2, laneRadius * 2, HALF_PI, PI + HALF_PI);
    arc(rightArcCenter.x, rightArcCenter.y, laneRadius * 2, laneRadius * 2, PI + HALF_PI, HALF_PI);
    line(leftArcCenter.x, leftArcCenter.y - laneRadius, rightArcCenter.x, rightArcCenter.y - laneRadius);
    line(rightArcCenter.x, rightArcCenter.y + laneRadius, leftArcCenter.x, leftArcCenter.y + laneRadius);
  }
  pop();

  push();
  stroke(0, 220, 255, 180);
  strokeWeight(2);
  noFill();
  for (let i = 1; i < numLanes; i++) {
    const dividerRadius = arcRadius - i * laneWidth;
    if (dividerRadius <= 0) continue;
    arc(leftArcCenter.x, leftArcCenter.y, dividerRadius * 2, dividerRadius * 2, HALF_PI, PI + HALF_PI);
    arc(rightArcCenter.x, rightArcCenter.y, dividerRadius * 2, dividerRadius * 2, PI + HALF_PI, HALF_PI);
    line(leftArcCenter.x, leftArcCenter.y - dividerRadius, rightArcCenter.x, rightArcCenter.y - dividerRadius);
    line(rightArcCenter.x, rightArcCenter.y + dividerRadius, leftArcCenter.x, leftArcCenter.y + dividerRadius);
  }
  pop();

  const finishLineX = leftArcCenter.x;
  const finishLineYStart = leftArcCenter.y - arcRadius;
  const finishLineYEnd = leftArcCenter.y - (arcRadius - (numLanes * laneWidth));
  const rectW = FINISH_LINE_WIDTH;
  const rectH = finishLineYEnd - finishLineYStart;

  push();
  noStroke();
  rectMode(CORNERS);
  const tiles = 8;
  const tileW = rectW / tiles;
  const tileH = rectH / tiles;
  for (let row = 0; row < tiles; row++) {
    for (let col = 0; col < tiles; col++) {
      const isDark = (row + col) % 2 === 1;
      fill(isDark ? color(197, 0, 60, 220) : color(136, 4, 37, 220));
      rect(
        finishLineX + col * tileW,
        finishLineYStart + row * tileH,
        finishLineX + (col + 1) * tileW,
        finishLineYStart + (row + 1) * tileH
      );
    }
  }
  pop();
}

function getTrackPosition(obj) {
  const { laneWidth, arcRadius, straightLength, leftArcCenter, rightArcCenter } = trackGeometry;
  if (!arcRadius) return { x: width / 2, y: height / 2 };
  const laneRadius = arcRadius - (obj.lane * laneWidth) - (laneWidth / 2);
  const topStraightEnd = straightLength;
  const rightArcEnd = topStraightEnd + PI * laneRadius;
  const bottomStraightEnd = rightArcEnd + straightLength;
  const totalLapDistance = bottomStraightEnd + PI * laneRadius;
  let progress = (obj.progress || 0) % totalLapDistance;
  let x, y;
  if (progress < topStraightEnd) {
    x = leftArcCenter.x + progress;
    y = leftArcCenter.y - laneRadius;
  } else if (progress < rightArcEnd) {
    const angle = map(progress, topStraightEnd, rightArcEnd, -HALF_PI, HALF_PI);
    x = rightArcCenter.x + cos(angle) * laneRadius;
    y = rightArcCenter.y + sin(angle) * laneRadius;
  } else if (progress < bottomStraightEnd) {
    x = rightArcCenter.x - (progress - rightArcEnd);
    y = rightArcCenter.y + laneRadius;
  } else {
    const angle = map(progress, bottomStraightEnd, totalLapDistance, HALF_PI, PI + HALF_PI);
    x = leftArcCenter.x + cos(angle) * laneRadius;
    y = leftArcCenter.y + sin(angle) * laneRadius;
  }
  return { x, y };
}

function drawTrackObjects() {
  const avatarSize = (trackGeometry.laneWidth || LANE_WIDTH) * AVATAR_SIZE_FACTOR;
  imageMode(CENTER);
  trackObjects.forEach(obj => {
    if (!obj.img || !obj.img.width) return;
    const pos = getTrackPosition(obj);
    image(obj.img, pos.x, pos.y, avatarSize, avatarSize);
    const tx = pos.x + avatarSize / 2 + 5;
    const ty = pos.y;
    textSize(16); textStyle(BOLD); textAlign(LEFT, CENTER);
    fill(226, 236, 255); noStroke();
    // Dark outline for readability on neon lanes
    push();
    const ctx = drawingContext;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(5, 10, 24, 0.85)';
    ctx.lineWidth = 3;
    // Use same font settings as p5
    // p5 sets its own font internally; strokeText will use current context font
    ctx.strokeText(obj.username, tx, ty);
    ctx.restore();
    pop();
    // Filled text on top
    text(obj.username, tx, ty);
  });
}

function buildTrackObjectsFromPlayers() {
  // Build / refresh trackObjects from humans + bots so all lanes show
  const humans = (MP.players || []).map(p => ({ id: p.id, username: p.username, lane: p.lane, isBot: false }));
  const bots = (MP.bots || []).map(b => ({ id: `bot:${b.lane}`, username: b.username || `Bot_${b.lane+1}`, lane: b.lane, isBot: true }));
  const combined = humans.concat(bots).sort((a,b)=>a.lane - b.lane);
  trackObjects = combined.map(entry => {
    const avatarUrl = `https://api.dicebear.com/8.x/${avatarStyle}/svg?seed=${encodeURIComponent(entry.username)}`;
    const img = loadImage(avatarUrl);
    return {
      id: entry.id,
      username: entry.username,
      lane: entry.lane,
      progress: 0,
      remoteProgress: 0,
      totalDistance: 0,
      img,
      finished: false,
      isBot: entry.isBot,
    };
  });
  calculateTrackGeometry();
}

function syncRaceProgress(playersProgress) {
  playersProgress.forEach(pp => {
    const obj = trackObjects.find(o => o.id === pp.id);
    if (!obj || !obj.totalDistance) return;
    // Interpolate toward latest server progress for smoothness
    const target = (pp.progress || 0) * obj.totalDistance;
    obj.remoteProgress = pp.progress; // normalized 0..1
    obj.progress = obj.progress + (target - obj.progress) * INTERP_ALPHA; // simple lerp
    obj.finished = pp.finished;
    // Use server-provided speed and calculate acceleration from it
    const oldSpeed = obj.currentSpeed || 0;
    obj.currentSpeed = pp.currentSpeed || 0; // direct from server
    const dt = 1/60; // approximate server tick interval
    obj.currentAccel = (obj.currentSpeed - oldSpeed) / dt;
    if (pp.id === MP.clientId && pp.finished) {
      localPlayerFinished = true;
    }
  });
}

function syncBotProgress(botsProgress) {
  botsProgress.forEach(bp => {
    const obj = trackObjects.find(o => o.isBot && o.lane === bp.lane);
    if (!obj || !obj.totalDistance) return;
    const target = (bp.progress || 0) * obj.totalDistance;
    obj.remoteProgress = bp.progress;
    obj.progress = obj.progress + (target - obj.progress) * INTERP_ALPHA;
    obj.finished = bp.finished;
  });
}

function draw() {
  background(8, 12, 26);
  calculateTrackGeometry();
  drawTrack();
  // Draw avatars even in lobby so arrivals appear immediately
  drawTrackObjects();
  // Countdown overlay text in header already handled; show phase label subtle corner
  // Phase label removed per request
  if (MP.phase === 'results') {
    textAlign(CENTER, CENTER);
    textSize(48);
    stroke(0);
    strokeWeight(4);
    fill(255);
    text('Race complete', width/2, height/2);
    noStroke();
  }
  // Boost notification disabled - removed tooltip display

  // Draw player speed and acceleration during race
  if (MP.phase === 'race') {
    if (!localPlayerFinished && performance.now() >= nextKeyChangeAt) rotateBoostKey();
    const me = trackObjects.find(o => o.id === MP.clientId);
    if (!localPlayerFinished && me && typeof me.currentSpeed === 'number') {
      const speed = Math.round(me.currentSpeed * 1000);
      const accel = (me.currentAccel || 0) * 1000;

      // Background panel (increased height for key instruction)
      fill(0, 0, 0, 160);
      noStroke();
      rectMode(CENTER);
      // HUD panel enlarged by ~10%
      rect(width/2, height/2, 308, 121, 8);

      // Key instruction at top (flash when key just rotated)
      if (performance.now() < keyFlashUntil) {
        fill(255, 255, 0);
      } else {
        fill(255);
      }
      textAlign(CENTER, CENTER);
      // Increase boost key instruction label size by ~20%
      textSize(18);
      textStyle(NORMAL);
      const msRemaining = Math.max(0, nextKeyChangeAt - performance.now());
      const secRemaining = Math.ceil(msRemaining / 1000);
      text(`Press [${displayBoostKey(currentBoostKey)}] to boost (${secRemaining}s)`, width/2, height/2 - 35);

      // Speed text
      textStyle(BOLD);
      textSize(18);
      text(`Speed: ${speed}`, width/2, height/2 - 10);

      // Acceleration meter bar (only show when positive)
      textSize(12);
      textStyle(NORMAL);
      text(`Acceleration`, width/2, height/2 + 18);

      // Bar background
      const barWidth = 200;
      const barHeight = 12;
      const barX = width/2 - barWidth/2;
      const barY = height/2 + 30;
      rectMode(CORNER);
      fill(60);
      rect(barX, barY, barWidth, barHeight, 4);

      // Bar fill (only show positive acceleration)
      if (accel > 0) {
        const maxAccel = 50; // adjust based on typical values
        const accelRatio = Math.min(1, accel / maxAccel);
        const fillWidth = accelRatio * barWidth;
        fill(100, 255, 100);
        rect(barX, barY, fillWidth, barHeight, 4);
      }

      textStyle(NORMAL);
    }
  }
}

// --- Boost Controls & Notification (dynamic key variant) ---
function onKeyDown(e) {
  if (MP.phase !== 'race' || !MP.ws) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
  const key = (e.key === ' ' || e.code === 'Space') ? ' ' : e.key.toUpperCase();
  if (key === currentBoostKey && !_boostDown) {
    _boostDown = true;
    MP.ws.send(JSON.stringify({ type: 'pressBoost', down: true, atClientMs: Date.now() }));
  }
}

function onKeyUp(e) {
  if (!MP.ws) return;
  const key = (e.key === ' ' || e.code === 'Space') ? ' ' : e.key.toUpperCase();
  if (key === currentBoostKey && _boostDown) {
    _boostDown = false;
    MP.ws.send(JSON.stringify({ type: 'pressBoost', down: false, atClientMs: Date.now() }));
  }
}

function showBoostNotice(text) {
  const defaultDur = 900;
  const tunedDur = (MP && MP.constants && typeof MP.constants.BOOST_COOLDOWN_MS === 'number')
    ? Math.min(Math.max(400, MP.constants.BOOST_COOLDOWN_MS), 2000)
    : defaultDur;
  _boostNotice = { text, ts: millis(), durationMs: tunedDur };
}

// --- Synthwave Soundtrack (mirrors single-player implementation) ---
function toggleSynthwave() {
  if (synthwave.isPlaying) {
    stopSynthwave();
  } else {
    startSynthwave();
  }
}

function startSynthwave() {
  const ctx = initSynthwaveContext();
  if (!ctx) {
    alert('Your browser does not support Web Audio, so the synthwave track cannot play.');
    return;
  }

  synthwave.isPlaying = true;
  updateToggleMusicButton();
  const resumePromise = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
  resumePromise.then(() => {
    synthwave.tempo = 92 + Math.random() * 14;
    synthwave.beatDuration = 60 / synthwave.tempo / 4;
    synthwave.stepIndex = 0;
    synthwave.nextNoteTime = ctx.currentTime + 0.12;
    generateSynthwavePatterns();
    ensurePadVoices(ctx);
    updatePadChord(ctx.currentTime + 0.05);
    applyMeasureDynamics(ctx.currentTime + 0.1);
    synthwave.masterGain.gain.cancelScheduledValues(ctx.currentTime);
    synthwave.masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    synthwave.masterGain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 1.0);
    runSynthwaveScheduler();
    updateToggleMusicButton();
  }).catch((error) => {
    console.warn('Unable to start synthwave audio:', error);
    synthwave.isPlaying = false;
    updateToggleMusicButton();
  });
}

function stopSynthwave() {
  if (!synthwave.context) {
    updateToggleMusicButton();
    return;
  }
  synthwave.isPlaying = false;
  if (synthwave.schedulerId) {
    cancelAnimationFrame(synthwave.schedulerId);
    synthwave.schedulerId = null;
  }
  const ctx = synthwave.context;
  if (synthwave.padGain) {
    synthwave.padGain.gain.cancelScheduledValues(ctx.currentTime);
    synthwave.padGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
  }
  if (synthwave.kickGain) {
    synthwave.kickGain.gain.cancelScheduledValues(ctx.currentTime);
    synthwave.kickGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
  }
  synthwave.masterGain.gain.cancelScheduledValues(ctx.currentTime);
  synthwave.masterGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
  synthwave.nextNoteTime = 0;
  synthwave.stepIndex = 0;
  updateToggleMusicButton();
}

function initSynthwaveContext() {
  if (synthwave.context) {
    return synthwave.context;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return null;
  }
  const ctx = new AudioCtx();
  synthwave.context = ctx;
  synthwave.masterGain = ctx.createGain();
  synthwave.masterGain.gain.value = 0.0001;
  synthwave.masterGain.connect(ctx.destination);

  synthwave.kickGain = ctx.createGain();
  synthwave.kickGain.gain.value = 0.6;
  synthwave.kickGain.connect(synthwave.masterGain);

  synthwave.bassGain = ctx.createGain();
  synthwave.bassGain.gain.value = 0.75;
  synthwave.bassGain.connect(synthwave.masterGain);

  synthwave.leadGain = ctx.createGain();
  synthwave.leadGain.gain.value = 0.38;
  synthwave.leadGain.connect(synthwave.masterGain);

  synthwave.drumGain = ctx.createGain();
  synthwave.drumGain.gain.value = 0.65;
  synthwave.drumGain.connect(synthwave.masterGain);

  synthwave.padFilter = ctx.createBiquadFilter();
  synthwave.padFilter.type = 'lowpass';
  synthwave.padFilter.frequency.value = 400;
  synthwave.padFilter.Q.value = 0.8;

  synthwave.padGain = ctx.createGain();
  synthwave.padGain.gain.value = 0.0001;
  synthwave.padFilter.connect(synthwave.padGain);
  synthwave.padGain.connect(synthwave.masterGain);
  synthwave.padVoices = [];

  synthwave.noiseBuffer = createNoiseBuffer(ctx);
  return ctx;
}

function runSynthwaveScheduler() {
  if (!synthwave.isPlaying || !synthwave.context) {
    return;
  }
  const ctx = synthwave.context;
  while (synthwave.nextNoteTime < ctx.currentTime + 0.2) {
    scheduleSynthwaveStep(synthwave.stepIndex, synthwave.nextNoteTime);
    synthwave.nextNoteTime += synthwave.beatDuration;
    synthwave.stepIndex = (synthwave.stepIndex + 1) % 16;
    if (synthwave.stepIndex === 0) {
      if (Math.random() > 0.6) {
        mutateSynthwavePatterns();
      }
      updatePadChord(synthwave.nextNoteTime);
      applyMeasureDynamics(synthwave.nextNoteTime);
    }
  }
  synthwave.schedulerId = requestAnimationFrame(runSynthwaveScheduler);
}

function scheduleSynthwaveStep(step, time) {
  if (synthwave.kickPattern[step]) {
    triggerKick(time);
  }
  const bassFreq = synthwave.bassPattern[step];
  if (bassFreq) {
    triggerBass(time, bassFreq);
  }

  const leadFreq = synthwave.leadPattern[step];
  if (leadFreq) {
    triggerLead(time, leadFreq);
  }

  if (synthwave.hatPattern[step]) {
    triggerHat(time);
  }

  if (synthwave.snareSteps.includes(step)) {
    triggerSnare(time + synthwave.beatDuration * 0.05);
  }
}

function generateSynthwavePatterns() {
  const rootChoices = [40, 42, 45, 47];
  const root = rootChoices[Math.floor(Math.random() * rootChoices.length)];
  const scaleOffsets = [0, 2, 5, 7, 9, 12];
  const scale = scaleOffsets.map(offset => root + offset);
  synthwave.scale = scale;

  const bassPattern = new Array(16).fill(null);
  for (let step = 0; step < 16; step++) {
    if (step % 4 === 0 || Math.random() > 0.62) {
      const octaveShift = Math.random() > 0.7 ? -12 : 0;
      const noteIndex = (step / 4 + Math.floor(Math.random() * 2)) % scale.length;
      bassPattern[step] = midiToFrequency(scale[noteIndex] + octaveShift);
    }
  }
  if (!bassPattern[0]) {
    bassPattern[0] = midiToFrequency(scale[0]);
  }
  synthwave.bassPattern = bassPattern;

  const leadPattern = new Array(16).fill(null);
  for (let step = 0; step < 16; step++) {
    if (Math.random() > 0.7) {
      const note = scale[Math.floor(Math.random() * scale.length)] + 12;
      leadPattern[step] = midiToFrequency(note + (Math.random() > 0.6 ? 12 : 0));
    }
  }
  synthwave.leadPattern = leadPattern;

  synthwave.hatPattern = new Array(16).fill(true).map(() => Math.random() > 0.12);
  synthwave.snareSteps = [4, 12];

  const kickPattern = new Array(16).fill(false);
  for (let step = 0; step < 16; step += 4) {
    kickPattern[step] = true;
    if (step + 2 < 16 && Math.random() > 0.65) {
      kickPattern[step + 2] = true;
    }
  }
  if (Math.random() > 0.7) {
    const extra = Math.floor(Math.random() * 16);
    kickPattern[extra] = true;
  }
  synthwave.kickPattern = kickPattern;
}

function mutateSynthwavePatterns() {
  const scale = synthwave.scale;
  if (!scale || scale.length === 0) {
    return;
  }
  synthwave.kickPattern = synthwave.kickPattern.map((on, idx) => {
    if (idx % 4 === 0) return true;
    if (Math.random() > 0.92) return !on;
    if (on && Math.random() > 0.96) return false;
    return on;
  });
  if (Math.random() > 0.55) {
    const accent = Math.floor(Math.random() * 16);
    synthwave.kickPattern[accent] = true;
  }
  for (let i = 0; i < synthwave.leadPattern.length; i++) {
    if (Math.random() > 0.94) {
      synthwave.leadPattern[i] = midiToFrequency(scale[Math.floor(Math.random() * scale.length)] + 12);
    } else if (Math.random() > 0.97) {
      synthwave.leadPattern[i] = null;
    }
  }
  if (Math.random() > 0.7) {
    const idx = Math.floor(Math.random() * synthwave.bassPattern.length);
    synthwave.bassPattern[idx] = midiToFrequency(scale[Math.floor(Math.random() * scale.length)]);
  }
  synthwave.hatPattern = synthwave.hatPattern.map(flag => (Math.random() > 0.97 ? !flag : flag));
}

function triggerBass(time, frequency) {
  const ctx = synthwave.context;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(frequency, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.32, time + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + synthwave.beatDuration * 1.6);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1400, time);
  filter.Q.value = 0.8;

  osc.connect(filter).connect(gain).connect(synthwave.bassGain);
  osc.start(time);
  osc.stop(time + synthwave.beatDuration * 1.6);
}

function triggerLead(time, frequency) {
  const ctx = synthwave.context;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequency, time);
  osc.frequency.linearRampToValueAtTime(frequency * 1.01, time + synthwave.beatDuration * 0.6);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.18, time + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + synthwave.beatDuration * 2.2);

  const delay = ctx.createDelay();
  delay.delayTime.setValueAtTime(synthwave.beatDuration * 2, time);
  const feedback = ctx.createGain();
  feedback.gain.setValueAtTime(0.35, time);

  delay.connect(feedback);
  feedback.connect(delay);

  osc.connect(gain);
  gain.connect(synthwave.leadGain);
  gain.connect(delay);
  delay.connect(synthwave.leadGain);

  osc.start(time);
  osc.stop(time + synthwave.beatDuration * 2.4);
}

function triggerHat(time) {
  if (!synthwave.noiseBuffer) return;
  const ctx = synthwave.context;
  const source = ctx.createBufferSource();
  source.buffer = synthwave.noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(8000, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);

  source.connect(filter).connect(gain).connect(synthwave.drumGain);
  source.start(time);
  source.stop(time + 0.12);
}

function triggerSnare(time) {
  if (!synthwave.noiseBuffer) return;
  const ctx = synthwave.context;
  const source = ctx.createBufferSource();
  source.buffer = synthwave.noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1800, time);
  filter.Q.value = 0.8;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.24, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);

  source.connect(filter).connect(gain).connect(synthwave.drumGain);
  source.start(time);
  source.stop(time + 0.35);
}

function ensurePadVoices(ctx) {
  if (!ctx || !synthwave.padFilter) return;
  if (Array.isArray(synthwave.padVoices) && synthwave.padVoices.length) return;
  synthwave.padVoices = [];
  const chordOffsets = [0, 7, 12, 24];
  chordOffsets.forEach((offset, idx) => {
    const osc = ctx.createOscillator();
    osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(synthwave.padFilter);
    osc.start();
    synthwave.padVoices.push({ osc, gain, offset });
  });
}

function updatePadChord(time) {
  const ctx = synthwave.context;
  if (!ctx) return;
  ensurePadVoices(ctx);
  if (!Array.isArray(synthwave.padVoices) || synthwave.padVoices.length === 0) return;
  const scale = (synthwave.scale && synthwave.scale.length) ? synthwave.scale : [40, 43, 47, 52, 55, 59];
  synthwave.chordIndex = (synthwave.chordIndex + (Math.random() > 0.5 ? 2 : 1)) % scale.length;
  const rootMidi = scale[synthwave.chordIndex];
  const chordTemplate = [0, 4, 7];
  synthwave.padVoices.forEach((voice, idx) => {
    const note = rootMidi + chordTemplate[idx % chordTemplate.length] + voice.offset;
    const freq = midiToFrequency(note);
    voice.osc.frequency.cancelScheduledValues(time);
    voice.osc.frequency.setValueAtTime(freq, time);
    voice.osc.frequency.linearRampToValueAtTime(freq * 1.01, time + 0.8);
    voice.gain.gain.cancelScheduledValues(time);
    const level = 0.04 + 0.02 * (idx % chordTemplate.length);
    voice.gain.gain.setTargetAtTime(level, time, 0.6);
  });
  if (synthwave.padFilter) {
    const targetFreq = 360 + Math.random() * 900;
    synthwave.padFilter.frequency.setTargetAtTime(targetFreq, time, 0.7);
  }
  if (synthwave.padGain) {
    const padLevel = 0.16 + Math.random() * 0.05;
    synthwave.padGain.gain.cancelScheduledValues(time);
    synthwave.padGain.gain.setTargetAtTime(padLevel, time, 0.8);
  }
}

function applyMeasureDynamics(time) {
  if (!synthwave.masterGain) return;
  const masterLevel = 0.18 + Math.random() * 0.08;
  synthwave.masterGain.gain.cancelScheduledValues(time);
  synthwave.masterGain.gain.setTargetAtTime(masterLevel, time, 0.85);
  if (synthwave.leadGain) {
    const leadLevel = 0.3 + Math.random() * 0.12;
    synthwave.leadGain.gain.setTargetAtTime(leadLevel, time, 0.7);
  }
  if (synthwave.drumGain) {
    const drumLevel = 0.55 + Math.random() * 0.18;
    synthwave.drumGain.gain.setTargetAtTime(drumLevel, time, 0.5);
  }
  if (synthwave.bassGain) {
    const bassLevel = 0.7 + Math.random() * 0.12;
    synthwave.bassGain.gain.setTargetAtTime(bassLevel, time, 0.6);
  }
}

function triggerKick(time) {
  if (!synthwave.kickGain) return;
  const ctx = synthwave.context;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(68, time);
  osc.frequency.exponentialRampToValueAtTime(30, time + 0.2);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.9, time + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);

  osc.connect(gain).connect(synthwave.kickGain);
  osc.start(time);
  osc.stop(time + 0.4);
}

function createNoiseBuffer(ctx) {
  const duration = 0.5;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function midiToFrequency(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function updateToggleMusicButton() {
  if (toggleMusicBtn) {
    toggleMusicBtn.textContent = synthwave.isPlaying ? 'Stop Synthwave' : 'Play Synthwave';
  }
}

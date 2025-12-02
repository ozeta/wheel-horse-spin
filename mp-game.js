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

// DOM references
let displayServer, displayRoom, connectBtn, readyBtn, startBtn, resetBtn,
    playerListUL, statusDiv, countdownHeader, renameWrap, renameInput, renameBtn,
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
  MP.serverUrl = (serverParam && serverParam.trim()) || MP.serverUrl;
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
      }
      // Refresh leaderboards once we have room state (ensures MP.room is set and connection established)
      try { if (typeof window.refreshLeaderboards === 'function') window.refreshLeaderboards(); } catch {}
      break;
    case 'countdown':
      MP.phase = 'countdown';
      MP.countdownEndsAt = msg.countdownEndsAt;
      countdownHeader.style.display = 'block';
      if (lobbySection) lobbySection.style.display = 'block';
      break;
    case 'raceStart':
      MP.phase = 'race'; countdownHeader.style.display = 'none'; raceOverlay.style.display = 'none';
      buildTrackObjectsFromPlayers(); // ensure roster locked for race
      if (lobbySection) lobbySection.style.display = 'none';
      initDynamicBoost();
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

function rotateBoostKey() {
  const candidates = BOOST_KEYS.filter(k => k !== currentBoostKey);
  const idx = Math.floor(Math.random() * candidates.length);
  lastBoostKey = currentBoostKey;
  currentBoostKey = candidates[idx] || currentBoostKey;
  nextKeyChangeAt = performance.now() + BOOST_KEY_INTERVAL_MS;
  keyFlashUntil = performance.now() + 600; // flash ~600ms
  playBoostKeyCue();
  // Release boost if held when key changes to avoid stuck boost
  if (_boostDown) {
    _boostDown = false;
    try { if (MP.ws) MP.ws.send(JSON.stringify({ type: 'pressBoost', down: false, atClientMs: Date.now(), reason: 'keyRotated' })); } catch {}
  }
  try { console.log('[DynamicBoost] New boost key:', displayBoostKey(currentBoostKey)); } catch {}
}

function initDynamicBoost() { rotateBoostKey(); }

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
  const evenLaneColor = color(210, 180, 140);
  const oddLaneColor = color(200, 170, 130);
  noFill();
  strokeWeight(laneWidth);
  for (let i = 0; i < numLanes; i++) {
    const laneRadius = arcRadius - (i * laneWidth) - (laneWidth / 2);
    if (laneRadius <= 0) continue;
    stroke(i % 2 === 0 ? evenLaneColor : oddLaneColor);
    arc(leftArcCenter.x, leftArcCenter.y, laneRadius * 2, laneRadius * 2, HALF_PI, PI + HALF_PI);
    arc(rightArcCenter.x, rightArcCenter.y, laneRadius * 2, laneRadius * 2, PI + HALF_PI, HALF_PI);
    line(leftArcCenter.x, leftArcCenter.y - laneRadius, rightArcCenter.x, rightArcCenter.y - laneRadius);
    line(rightArcCenter.x, rightArcCenter.y + laneRadius, leftArcCenter.x, leftArcCenter.y + laneRadius);
  }
  // Divider lines
  stroke(255, 150); strokeWeight(2); noFill();
  for (let i = 1; i < numLanes; i++) {
    const dividerRadius = arcRadius - i * laneWidth;
    if (dividerRadius <= 0) continue;
    arc(leftArcCenter.x, leftArcCenter.y, dividerRadius * 2, dividerRadius * 2, HALF_PI, PI + HALF_PI);
    arc(rightArcCenter.x, rightArcCenter.y, dividerRadius * 2, dividerRadius * 2, PI + HALF_PI, HALF_PI);
    line(leftArcCenter.x, leftArcCenter.y - dividerRadius, rightArcCenter.x, rightArcCenter.y - dividerRadius);
    line(rightArcCenter.x, rightArcCenter.y + dividerRadius, leftArcCenter.x, leftArcCenter.y + dividerRadius);
  }
  // Finish line chessboard
  const finishLineX = leftArcCenter.x;
  const finishLineYStart = leftArcCenter.y - arcRadius;
  const finishLineYEnd = leftArcCenter.y - (arcRadius - (numLanes * laneWidth));
  const rectW = FINISH_LINE_WIDTH;
  const rectH = finishLineYEnd - finishLineYStart;
  noStroke(); rectMode(CORNERS);
  const tiles = 8; const tileW = rectW / tiles; const tileH = rectH / tiles;
  for (let row = 0; row < tiles; row++) {
    for (let col = 0; col < tiles; col++) {
      let isDark = (row + col) % 2 === 1;
      fill(isDark ? color(181, 136, 99) : color(240, 217, 181));
      rect(
        finishLineX + col * tileW,
        finishLineYStart + row * tileH,
        finishLineX + (col + 1) * tileW,
        finishLineYStart + (row + 1) * tileH
      );
    }
  }
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
    // Bold black fill
    fill(0); noStroke(); textSize(16); textStyle(BOLD); textAlign(LEFT, CENTER);
    // White outline using canvas strokeText for better readability
    push();
    const ctx = drawingContext;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#ffffff';
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
  background(0, 100, 0);
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
    if (performance.now() >= nextKeyChangeAt) rotateBoostKey();
    const me = trackObjects.find(o => o.id === MP.clientId);
    if (me && typeof me.currentSpeed === 'number') {
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

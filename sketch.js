let horses = [];
let horseObjects = [];
let horseImages = {}; // Cache for loaded avatar images
let horseList, addHorseBtn, clearDataBtn, runRaceBtn, resetGameBtn, shareUrlBtn, pauseGameBtn;
let winner = null;
// --- Timing ---
let raceStartMillis = 0;
let raceElapsedSeconds = 0; // captured when race finishes
let pauseStartMillis = 0; // when pause initiated
let pausedAccumulatedMillis = 0; // total paused duration
let overallRaceDurationSeconds = 0; // time when last horse finishes
// --- Persistent Stats ---
// Structure: { HorseName: { wins: Number, losses: Number, bestTime: Number|null, lastWinTime: Number|null } }
let horseStats = {};
// Multiplayer adapter state
let multiplayer = {
    ws: null,
    connected: false,
    clientId: null,
    hostId: null,
    roomPhase: 'none', // lobby | countdown | race | results
    players: [], // {id, username, lane, ready, progress, finished}
    bots: [], // {lane, progress, finished}
    countdownEndsAt: null,
    raceId: null,
    results: null,
    lastTickMs: null,
    username: null,
    roomId: null,
};

// --- Chessboard SVG ---
let chessboardImg;

// --- Game State & Configuration ---
const MAX_EXECUTION_TIME = 10; // Target race duration in seconds
const avatarStyles = [
    'adventurer', 'avataaars', 'big-ears', 'big-smile', 'bottts', 'croodles',
    'fun-emoji', 'lorelei', 'micah', 'miniavs', 'open-peeps', 'personas', 'pixel-art',
];
let currentStyle;
let gameState = 'setup'; // 'setup', 'racing', 'paused', 'finished'

// --- Racetrack Geometry ---
let trackGeometry = {};
const FINISH_LINE_WIDTH = 100; // px, wide enough for avatar and name
// --- Visual Size Controls ---
const LANE_WIDTH = 70; // Base lane width (was 30)
const AVATAR_SIZE_FACTOR = 0.8; // Multiplier relative to lane width (was 0.9)
const DECELERATION_DURATION_MS = 2000; // Coast for ~2s after crossing finish

// --- p5.js Sketch ---

function preload() {
    // Preload images if horses are already in localStorage
    const storedHorses = localStorage.getItem('horses');
    if (storedHorses) {
        const stored = JSON.parse(storedHorses);
        stored.forEach(horse => {
            if (horse.avatar) {
                horseImages[horse.name] = loadImage(horse.avatar);
            }
        });
    }

    // Preload chessboard SVG
    // chessboardImg = loadImage('chessboard.svg');
}

function setup() {
    const canvasContainer = document.getElementById('canvas-container');
    if (!canvasContainer) {
        console.error('Canvas container not found!');
        return;
    }
    const containerSize = canvasContainer.getBoundingClientRect();
    const canvas = createCanvas(containerSize.width, containerSize.height);
    canvas.parent('canvas-container');
    frameRate(60); // Set a consistent frame rate for predictable speed

    // --- DOM Element Initialization ---
    horseList = document.getElementById('horse-list');
    addHorseBtn = document.getElementById('add-horse');
    clearDataBtn = document.getElementById('clear-data');
    runRaceBtn = document.getElementById('run-race');
    resetGameBtn = document.getElementById('reset-game');
    shareUrlBtn = document.getElementById('share-url');
    pauseGameBtn = document.getElementById('pause-game');
    // Multiplayer DOM elements
    multiplayer.serverInput = document.getElementById('mp-server');
    multiplayer.roomInput = document.getElementById('mp-room');
    multiplayer.usernameInput = document.getElementById('mp-username');
    multiplayer.connectBtn = document.getElementById('mp-connect');
    multiplayer.readyBtn = document.getElementById('mp-ready');
    multiplayer.startBtn = document.getElementById('mp-start');
    multiplayer.playersList = document.getElementById('mp-players');
    multiplayer.statusDiv = document.getElementById('mp-status');
    multiplayer.countdownDiv = document.getElementById('mp-countdown');

    // --- Event Listeners ---
    addHorseBtn.addEventListener('click', addHorse);
    clearDataBtn.addEventListener('click', clearAllData);
    runRaceBtn.addEventListener('click', handleRaceButton);
    resetGameBtn.addEventListener('click', resetGame);
    shareUrlBtn.addEventListener('click', copyShareableURL);
    pauseGameBtn.addEventListener('click', togglePause);
    // Multiplayer events
    if (multiplayer.connectBtn) {
        multiplayer.connectBtn.addEventListener('click', mpConnect);
    }
    if (multiplayer.readyBtn) {
        multiplayer.readyBtn.addEventListener('click', mpToggleReady);
    }
    if (multiplayer.startBtn) {
        multiplayer.startBtn.addEventListener('click', mpStartGame);
    }

    // --- Initial Load ---
    currentStyle = avatarStyles[Math.floor(Math.random() * avatarStyles.length)];
    loadHorses();
}

function draw() {
    drawCyberpunkBackground();
    calculateTrackGeometry();
    drawTrack();
    if (!isMultiplayerActive()) {
        if (gameState === 'racing') {
            updateHorses();
            checkRaceCompletion();
        }
    } else {
        drawMultiplayerOverlay();
        // Race finish handled by server; we rely on incoming messages.
    }

    if (horseObjects.length > 0) {
        drawHorses();
        if (gameState === 'racing' || gameState === 'paused') {
            drawLeaderboard();
        }
    }

    if (gameState === 'finished' && winner) {
        drawWinnerMessage();
        drawFinalLeaderboard();
        drawResultsYamlPanel();
    }
}

function isMultiplayerActive() {
    return multiplayer.connected && multiplayer.roomPhase !== 'none';
}

function mpConnect() {
    if (multiplayer.connected) return;
    if (!multiplayer.serverInput || !multiplayer.roomInput || !multiplayer.usernameInput) return;
    const url = (multiplayer.serverInput.value || 'ws://localhost:8080').trim();
    const roomId = (multiplayer.roomInput.value || 'default').trim();
    const username = (multiplayer.usernameInput.value || 'Browser').trim();
    multiplayer.ws = new WebSocket(url);
    if (multiplayer.statusDiv) {
        multiplayer.statusDiv.textContent = 'Connecting...';
    }
    multiplayer.ws.onopen = () => {
        multiplayer.ws.send(JSON.stringify({ type: 'hello', roomId, username, version: 1 }));
        multiplayer.connected = true;
        multiplayer.username = username;
        multiplayer.roomId = roomId;
        if (multiplayer.statusDiv) {
            multiplayer.statusDiv.textContent = 'Connected. Waiting for welcome...';
        }
    };
    multiplayer.ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        handleMultiplayerMessage(msg);
    };
    multiplayer.ws.onclose = () => {
        if (multiplayer.statusDiv) {
            multiplayer.statusDiv.textContent = 'Disconnected.';
        }
        multiplayer.connected = false;
        multiplayer.roomPhase = 'none';
        if (multiplayer.startBtn) {
            multiplayer.startBtn.style.display = 'none';
        }
    };
    multiplayer.ws.onerror = () => {
        if (multiplayer.statusDiv) {
            multiplayer.statusDiv.textContent = 'Connection error.';
        }
    };
}

function mpToggleReady() {
    if (!multiplayer.connected || !multiplayer.ws) return;
    const player = multiplayer.players.find(p => p.id === multiplayer.clientId);
    const newReady = !(player && player.ready);
    multiplayer.ws.send(JSON.stringify({ type: 'setReady', ready: newReady }));
}

function mpStartGame() {
    if (!multiplayer.connected || !multiplayer.ws) return;
    if (multiplayer.clientId !== multiplayer.hostId) return;
    multiplayer.ws.send(JSON.stringify({ type: 'startGame' }));
}

function handleMultiplayerMessage(msg) {
    switch (msg.type) {
        case 'welcome': {
            multiplayer.clientId = msg.clientId;
            multiplayer.hostId = msg.hostId;
            if (multiplayer.statusDiv) {
                multiplayer.statusDiv.textContent = `Joined room ${msg.roomId} (clientId=${msg.clientId})`;
            }
            if (multiplayer.readyBtn) {
                multiplayer.readyBtn.disabled = false;
            }
            break;
        }
        case 'roomState': {
            multiplayer.roomPhase = msg.phase;
            multiplayer.hostId = msg.hostId;
            multiplayer.players = msg.players || [];
            multiplayer.bots = msg.bots || [];
            renderMultiplayerPlayers();
            updateMultiplayerButtons();
            if (msg.phase === 'lobby') {
                // Map to local setup state
                gameState = 'setup';
            }
            break;
        }
        case 'countdown': {
            multiplayer.roomPhase = 'countdown';
            multiplayer.countdownEndsAt = msg.countdownEndsAt;
            if (multiplayer.countdownDiv) {
                multiplayer.countdownDiv.style.display = 'block';
            }
            break;
        }
        case 'raceStart': {
            multiplayer.roomPhase = 'race';
            multiplayer.raceId = msg.raceId;
            if (multiplayer.countdownDiv) {
                multiplayer.countdownDiv.style.display = 'none';
            }
            gameState = 'racing';
            // Build horseObjects from players + bots
            buildHorseObjectsFromMultiplayer(msg.players, msg.bots);
            break;
        }
        case 'tick': {
            if (multiplayer.roomPhase === 'race' && msg.players && horseObjects.length > 0) {
                // Update progress based on normalized progress
                msg.players.forEach(p => {
                    const h = horseObjects.find(hh => hh._mpId === p.id);
                    if (h) {
                        h.finished = p.finished;
                        h.remoteProgress = p.progress; // 0..1
                        h.progress = h.remoteProgress * h.totalDistance; // convert lap fraction to distance
                    }
                });
                (msg.bots || []).forEach(b => {
                    const h = horseObjects.find(hh => hh._mpBotLane === b.lane);
                    if (h) {
                        h.finished = b.finished;
                        h.remoteProgress = b.progress;
                        h.progress = h.remoteProgress * h.totalDistance;
                    }
                });
            }
            // Countdown overlay update
            if (multiplayer.roomPhase === 'countdown' && multiplayer.countdownEndsAt && multiplayer.countdownDiv) {
                const remaining = Math.max(0, Math.round((multiplayer.countdownEndsAt - Date.now()) / 1000));
                multiplayer.countdownDiv.textContent = `Countdown: ${remaining}s`;
            }
            break;
        }
        case 'raceEnd': {
            multiplayer.roomPhase = 'results';
            multiplayer.results = msg.results;
            // Map results to horseObjects finishSeconds
            if (msg.results && msg.results.results) {
                const list = msg.results.results;
                list.forEach(r => {
                    if (r.isBot) {
                        const h = horseObjects.find(hh => hh._mpBotLane === r.lane);
                        if (h) h.finishSeconds = r.finishSeconds;
                    } else {
                        const h = horseObjects.find(hh => hh._mpId === r.id);
                        if (h) h.finishSeconds = r.finishSeconds;
                    }
                });
                // Winner/time mapping
                const winnerEntry = list[0];
                if (winnerEntry) {
                    winner = horseObjects.find(h => (!winnerEntry.isBot && h._mpId === winnerEntry.id) || (winnerEntry.isBot && h._mpBotLane === winnerEntry.lane));
                    raceElapsedSeconds = winnerEntry.finishSeconds;
                    overallRaceDurationSeconds = list[list.length - 1].finishSeconds;
                }
                gameState = 'finished';
            }
            renderMultiplayerPlayers();
            break;
        }
        case 'boost': {
            // Could show boost indicators later
            break;
        }
    }
}

function buildHorseObjectsFromMultiplayer(players, bots) {
    horses = []; // override local roster for drawing purposes
    horseObjects = [];
    const combined = [];
    players.forEach(p => combined.push({ type: 'player', id: p.id, username: p.username, lane: p.lane }));
    bots.forEach(b => combined.push({ type: 'bot', lane: b.lane, username: b.username }));
    combined.sort((a,b)=>a.lane - b.lane);
    combined.forEach(entry => {
        const name = entry.username;
        const avatarUrl = `https://api.dicebear.com/8.x/${currentStyle}/svg?seed=${encodeURIComponent(name)}`;
        // Preload image (non-blocking)
        if (!horseImages[name]) {
            horseImages[name] = loadImage(avatarUrl);
        }
        horses.push({ name, avatar: avatarUrl });
    });
    calculateTrackGeometry();
    // Create horseObjects with mapping fields
    horseObjects = combined.map((entry, i) => {
        const lane = entry.lane;
        const { laneWidth, arcRadius, straightLength } = trackGeometry;
        const laneRadius = arcRadius - (lane * laneWidth) - (laneWidth / 2);
        const totalDistance = (2 * straightLength) + (TWO_PI * laneRadius);
        return {
            name: entry.username,
            lane,
            progress: 0,
            remoteProgress: 0,
            speed: 0,
            totalDistance,
            img: horseImages[entry.username],
            finished: false,
            finishSeconds: null,
            _mpId: entry.type === 'player' ? entry.id : null,
            _mpBotLane: entry.type === 'bot' ? entry.lane : null,
        };
    });
}

function renderMultiplayerPlayers() {
    if (!multiplayer.playersList) return;
    multiplayer.playersList.innerHTML = '';
    multiplayer.players.forEach(p => {
        const li = document.createElement('li');
        const isMe = p.id === multiplayer.clientId;
        const hostMark = p.id === multiplayer.hostId ? ' (host)' : '';
        const readyMark = p.ready ? ' [R]' : '';
        li.textContent = `${p.username}${hostMark}${readyMark} @L${p.lane}${isMe ? ' (you)' : ''}`;
        multiplayer.playersList.appendChild(li);
    });
    // bots summary
    if (multiplayer.bots && multiplayer.bots.length > 0) {
        const li = document.createElement('li');
        li.style.marginTop = '4px';
        li.textContent = `Bots: ${multiplayer.bots.map(b=>`L${b.lane}`).join(', ')}`;
        multiplayer.playersList.appendChild(li);
    }
}

function updateMultiplayerButtons() {
    if (!multiplayer.startBtn || !multiplayer.readyBtn) return;
    const isHost = multiplayer.clientId === multiplayer.hostId;
    multiplayer.startBtn.style.display = isHost ? 'block' : 'none';
    multiplayer.startBtn.disabled = !(isHost && multiplayer.roomPhase === 'lobby');
    // Ready button toggles label
    const me = multiplayer.players.find(p => p.id === multiplayer.clientId);
    if (me) {
        multiplayer.readyBtn.textContent = me.ready ? 'Unready' : 'Ready to Start';
    }
}

function drawMultiplayerOverlay() {
    // Countdown overlay
    if (multiplayer.roomPhase === 'countdown' && multiplayer.countdownEndsAt) {
        const remaining = Math.max(0, Math.round((multiplayer.countdownEndsAt - Date.now()) / 1000));
        fill(5, 8, 18, 200);
        rect(0,0,width,height);
        fill(0, 242, 255);
        textAlign(CENTER,CENTER);
        textSize(48);
        text(`Race starts in ${remaining}s`, width/2, height/2);
    }
    if (multiplayer.roomPhase === 'results' && multiplayer.results) {
        // Reuse existing finished overlay drawing after mapping winner etc.
        // Nothing special here; raceEnd handler already set gameState.
    }
}

function windowResized() {
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
        const containerSize = canvasContainer.getBoundingClientRect();
        resizeCanvas(containerSize.width, containerSize.height);
        calculateTrackGeometry();
        initializeHorseObjects();
    }
}

// --- Game Logic ---

function handleRaceButton() {
    if ((gameState === 'setup' || gameState === 'finished') && horses.length > 0) {
        startRace();
    }
}

function startRace() {
    gameState = 'racing';
    winner = null;
    raceStartMillis = millis();
    raceElapsedSeconds = 0;
    pausedAccumulatedMillis = 0;
    pauseStartMillis = 0;
    runRaceBtn.style.display = 'none'; // Hide button during the race
    resetGameBtn.style.display = 'block'; // Show reset button during race
    pauseGameBtn.style.display = 'block';
    pauseGameBtn.textContent = 'Pause';

    // Reset progress and set initial speed for all horses
    horseObjects.forEach(h => {
        h.progress = 0;
        // Calculate a speed that aims for the target race duration
        const targetFrames = MAX_EXECUTION_TIME * 60; // e.g., 15 seconds * 60fps
        const baseSpeed = h.totalDistance / targetFrames;
        h.speed = random(baseSpeed * 0.9, baseSpeed * 1.1); // Start with a slight variation
    });
}

function initializeHorseObjects() {
    const { laneWidth, arcRadius, straightLength } = trackGeometry;
    if (!arcRadius) return; // Don't run if geometry isn't calculated

    horseObjects = horses.map((horse, i) => {
        const lane = i;
        const laneRadius = arcRadius - (lane * laneWidth) - (laneWidth / 2);
        const totalDistance = (2 * straightLength) + (TWO_PI * laneRadius);

        return {
            ...horse,
            lane: i,
            progress: 0, // Distance covered
            speed: 0,
            totalDistance: totalDistance,
            img: horseImages[horse.name],
            finished: false,
            finishSeconds: null
        };
    });
}

function updateHorses() {
    const targetFrames = MAX_EXECUTION_TIME * 60;
    horseObjects.forEach(horse => {
        const baseSpeed = horse.totalDistance / targetFrames;
        if (!horse.finished) {
            // Fluctuate speed slightly around the base speed
            horse.speed += random(-baseSpeed * 0.05, baseSpeed * 0.05);
            horse.speed = constrain(horse.speed, baseSpeed * 0.8, baseSpeed * 1.2);
            horse.progress += horse.speed;
            if (horse.progress >= horse.totalDistance) {
                // Crossed finish: mark finished and initiate deceleration phase
                horse.finished = true;
                const rawFinishMillis = millis() - raceStartMillis - pausedAccumulatedMillis;
                horse.finishSeconds = rawFinishMillis / 1000.0;
                // Start deceleration
                horse.decelerating = true;
                horse.decelStartMillis = millis();
                horse.decelInitialSpeed = horse.speed;
                horse.decelDurationMs = DECELERATION_DURATION_MS;
            }
        } else {
            // Decelerate smoothly and coast past the finish line
            if (horse.decelerating) {
                const elapsed = millis() - (horse.decelStartMillis || millis());
                const duration = horse.decelDurationMs || DECELERATION_DURATION_MS;
                const t = constrain(elapsed / duration, 0, 1);
                horse.speed = max(0, (horse.decelInitialSpeed || 0) * (1 - t));
                horse.progress += horse.speed;
                if (t >= 1) {
                    horse.decelerating = false;
                    horse.speed = 0;
                }
            } else {
                horse.speed = 0;
            }
        }
    });
}

function checkRaceCompletion() {
    if (gameState !== 'racing') return;
    // Require all horses to have crossed the finish line first
    const allFinished = horseObjects.every(h => h.finished);
    if (!allFinished) return;
    // Then wait until all finished horses have completed deceleration (speed == 0)
    const allStopped = horseObjects.every(h => h.finished && !h.decelerating && h.speed === 0);
    if (!allStopped) return;

    // Determine winner by earliest finishSeconds
    const minTime = Math.min(...horseObjects.map(h => h.finishSeconds));
    const firstFinishers = horseObjects.filter(h => h.finishSeconds === minTime);
    winner = firstFinishers[0]; // choose first for display
    const lastTime = Math.max(...horseObjects.map(h => h.finishSeconds));
    raceElapsedSeconds = minTime; // winner's time
    overallRaceDurationSeconds = lastTime; // total race duration

    // Update persistent stats now that race fully completed
    updateStatsAfterRace(firstFinishers);

    gameState = 'finished';
    runRaceBtn.textContent = 'New Race';
    runRaceBtn.style.display = 'none';
    resetGameBtn.style.display = 'block';
    pauseGameBtn.style.display = 'none';
    // Store tie info for overlay
    winner._tie = firstFinishers.length > 1;
}

// --- Reset Game ---
function resetGame() {
    // Return to setup state without clearing horses
    gameState = 'setup';
    winner = null;
    // Reset horse progress and speed
    horseObjects.forEach(h => {
        h.progress = 0;
        h.speed = 0;
    });
    initializeHorseObjects();
    // Show Run Race button again if horses exist
    runRaceBtn.textContent = 'Run Race';
    runRaceBtn.style.display = horses.length > 0 ? 'block' : 'none';
    resetGameBtn.style.display = 'none';
    pauseGameBtn.style.display = 'none';
    pauseGameBtn.textContent = 'Pause';
}

// --- Drawing Functions ---

function drawCyberpunkBackground() {
    push();
    const ctx = drawingContext;
    ctx.save();
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, 'rgba(0, 114, 140, 0.95)');
    gradient.addColorStop(0.5, 'rgba(36, 19, 95, 0.92)');
    gradient.addColorStop(1, 'rgba(120, 10, 130, 0.95)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    pop();

    push();
    rectMode(CORNER);
    noFill();
    stroke(0, 242, 255, 35);
    strokeWeight(2);
    rect(12, 12, width - 24, height - 24, 20);
    pop();
}

function calculateTrackGeometry() {
    const numLanes = horses.length > 0 ? horses.length : 1;
    const margin = 40;
    const laneWidth = LANE_WIDTH;

    const outerRectWidth = width - 2 * margin;
    const outerRectHeight = height - 2 * margin;
    const arcDiameter = outerRectHeight;
    const arcRadius = arcDiameter / 2;
    const straightLength = max(0, outerRectWidth - arcDiameter);

    trackGeometry = {
        margin,
        laneWidth,
        numLanes,
        arcRadius,
        straightLength,
        leftArcCenter: { x: margin + arcRadius, y: height / 2 },
        rightArcCenter: { x: margin + arcRadius + straightLength, y: height / 2 },
    };
}

function drawTrack() {
    const { numLanes, laneWidth, arcRadius, straightLength, leftArcCenter, rightArcCenter } = trackGeometry;

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
        const laneColor = i % 2 === 0 ? color(0, 242, 255, 160) : color(0, 140, 190, 160);

        if (laneRadius > 0) {
            stroke(laneColor);
            arc(leftArcCenter.x, leftArcCenter.y, laneRadius * 2, laneRadius * 2, HALF_PI, PI + HALF_PI);
            arc(rightArcCenter.x, rightArcCenter.y, laneRadius * 2, laneRadius * 2, PI + HALF_PI, HALF_PI);
            line(leftArcCenter.x, leftArcCenter.y - laneRadius, rightArcCenter.x, rightArcCenter.y - laneRadius);
            line(rightArcCenter.x, rightArcCenter.y + laneRadius, leftArcCenter.x, leftArcCenter.y + laneRadius);
        }
    }
    pop();

    push();
    stroke(0, 220, 255, 180);
    strokeWeight(2);
    noFill();
    for (let i = 1; i < numLanes; i++) {
        const dividerRadius = arcRadius - i * laneWidth;
        if (dividerRadius > 0) {
            arc(leftArcCenter.x, leftArcCenter.y, dividerRadius * 2, dividerRadius * 2, HALF_PI, PI + HALF_PI);
            arc(rightArcCenter.x, rightArcCenter.y, dividerRadius * 2, dividerRadius * 2, PI + HALF_PI, HALF_PI);
            line(leftArcCenter.x, leftArcCenter.y - dividerRadius, rightArcCenter.x, rightArcCenter.y - dividerRadius);
            line(rightArcCenter.x, rightArcCenter.y + dividerRadius, leftArcCenter.x, leftArcCenter.y + dividerRadius);
        }
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
            fill(isDark ? color(255, 0, 212, 220) : color(255, 255, 255, 220));
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

function getHorsePosition(horse) {
    const { laneWidth, arcRadius, straightLength, leftArcCenter, rightArcCenter } = trackGeometry;
    const laneRadius = arcRadius - (horse.lane * laneWidth) - (laneWidth / 2);

    // Define the length of each segment of the track for this lane
    const topStraightEnd = straightLength;
    const rightArcEnd = topStraightEnd + PI * laneRadius;
    const bottomStraightEnd = rightArcEnd + straightLength;
    const totalLapDistance = bottomStraightEnd + PI * laneRadius;

    let progress = horse.progress % totalLapDistance;
    let x, y;

    if (progress < topStraightEnd) { // On the top straight
        x = leftArcCenter.x + progress;
        y = leftArcCenter.y - laneRadius;
    } else if (progress < rightArcEnd) { // On the right arc
        const angle = map(progress, topStraightEnd, rightArcEnd, -HALF_PI, HALF_PI);
        x = rightArcCenter.x + cos(angle) * laneRadius;
        y = rightArcCenter.y + sin(angle) * laneRadius;
    } else if (progress < bottomStraightEnd) { // On the bottom straight
        x = rightArcCenter.x - (progress - rightArcEnd);
        y = rightArcCenter.y + laneRadius;
    } else { // On the left arc
        const angle = map(progress, bottomStraightEnd, totalLapDistance, HALF_PI, PI + HALF_PI);
        x = leftArcCenter.x + cos(angle) * laneRadius;
        y = leftArcCenter.y + sin(angle) * laneRadius;
    }
    return { x, y };
}


function drawHorses() {
    const avatarSize = trackGeometry.laneWidth * AVATAR_SIZE_FACTOR;
    imageMode(CENTER);

    horseObjects.forEach(horse => {
        if (!horse.img || !horse.img.width) return; // Don't draw if image not loaded

        const pos = getHorsePosition(horse);

        // Draw the horse avatar
        image(horse.img, pos.x, pos.y, avatarSize, avatarSize);

        // Draw the horse's name to the right of the avatar
        stroke(5, 8, 18, 180);
        strokeWeight(3);
        fill(226, 236, 255);
        textSize(16);
        textAlign(LEFT, CENTER);
        text(horse.name, pos.x + avatarSize / 2 + 5, pos.y);
        noStroke();
    });
}

function drawWinnerMessage() {
    push();
    rectMode(CORNER);
    noStroke();
    fill(5, 8, 18, 200);
    rect(0, 0, width, height);

    fill(0, 242, 255);
    textAlign(CENTER, CENTER);
    const winnerTimeStr = raceElapsedSeconds.toFixed(2);
    const totalTimeStr = overallRaceDurationSeconds.toFixed(2);
    const tieLabel = winner && winner._tie ? ' (tie)' : '';
    textSize(50);
    text(`🏆 Winner${tieLabel}: ${winner.name}`, width / 2, height / 2 - 50);
    fill(226, 236, 255);
    textSize(24);
    text(`Winner Time: ${winnerTimeStr}s`, width / 2, height / 2);
    text(`Total Duration: ${totalTimeStr}s`, width / 2, height / 2 + 40);
    pop();
}

// --- Leaderboard ---
function drawLeaderboard() {
    // Build ranking: finished first by finishSeconds ascending, then unfinished by progress descending
    const ranked = [...horseObjects].sort((a, b) => {
        if (a.finished && b.finished) return a.finishSeconds - b.finishSeconds;
        if (a.finished && !b.finished) return -1;
        if (!a.finished && b.finished) return 1;
        const aPct = a.progress / a.totalDistance;
        const bPct = b.progress / b.totalDistance;
        return bPct - aPct; // both unfinished: higher progress first
    });

    const padding = 14;
    const headerHeight = 40;
    const rowHeight = 30;
    const boxWidth = min(420, width * 0.6);
    const boxHeight = headerHeight + ranked.length * rowHeight + padding * 2;
    const x = (width - boxWidth) / 2;
    const y = (height - boxHeight) / 2;

    push();
    rectMode(CORNER);
    stroke(0, 242, 255, 120);
    strokeWeight(2);
    fill(10, 16, 38, 230);
    rect(x, y, boxWidth, boxHeight, 16);

    noStroke();
    fill(0, 242, 255);
    textAlign(LEFT, CENTER);
    textSize(18);
    textStyle(BOLD);
    text('Live Leaderboard', x + padding, y + padding + headerHeight / 2);

    ranked.forEach((h, i) => {
        const yTop = y + padding + headerHeight + i * rowHeight;
        const centerY = yTop + rowHeight / 2;
        const rankStr = (i + 1).toString().padStart(2, '0');
        const rightInfo = h.finished ? `${h.finishSeconds.toFixed(2)}s` : '...';

        fill(18, 26, 56, 180);
        rect(x + padding, centerY - 12, boxWidth - padding * 2, 24, 6);

        fill(225, 235, 255);
        textAlign(LEFT, CENTER);
        textSize(16);
        textStyle(NORMAL);
        text(`${rankStr}. ${h.name}`, x + padding + 12, centerY - 2);
        textAlign(RIGHT, CENTER);
        text(rightInfo, x + boxWidth - padding - 12, centerY - 2);

        if (i < 3) {
            const bulletColors = [color(0, 242, 255), color(173, 209, 255), color(255, 0, 212)];
            fill(bulletColors[i]);
            ellipse(x + padding + 6, centerY - 2, 10, 10);
        }
    });

    pop();
}

// --- Final Leaderboard (Post-Race) ---
function drawFinalLeaderboard() {
    // All horses finished: sort by finishSeconds ascending
    const ranked = [...horseObjects].sort((a, b) => a.finishSeconds - b.finishSeconds);
    const winnerTime = raceElapsedSeconds; // earliest
    const padding = 16;
    const headerHeight = 44;
    const rowHeight = 34;
    const boxWidth = min(560, width * 0.85);
    const boxHeight = headerHeight + ranked.length * rowHeight + padding * 2;
    const boxX = (width - boxWidth) / 2;
    const boxY = (height / 2) + 90; // below overlay winner text

    push();
    rectMode(CORNER);
    stroke(255, 0, 212, 120);
    strokeWeight(2);
    fill(12, 18, 48, 230);
    rect(boxX, boxY, boxWidth, boxHeight, 18);

    noStroke();
    fill(0, 242, 255);
    textAlign(LEFT, CENTER);
    textSize(20);
    textStyle(BOLD);
    text(`Final Leaderboard  |  Winner: ${winnerTime.toFixed(2)}s`, boxX + padding, boxY + padding + headerHeight / 2);

    ranked.forEach((h, i) => {
        const yTop = boxY + padding + headerHeight + i * rowHeight;
        const centerY = yTop + rowHeight / 2;
        const rankStr = (i + 1).toString().padStart(2, '0');
        const timeStr = h.finishSeconds.toFixed(2) + 's' + (winner._tie && h.finishSeconds === winnerTime ? ' (tie)' : '');
        const delta = h.finishSeconds - winnerTime;
        const deltaStr = (delta === 0 ? '+0.00s' : `+${delta.toFixed(2)}s`);

        fill(18, 28, 60, 190);
        rect(boxX + padding, centerY - 14, boxWidth - padding * 2, 28, 8);

        if (i < 3) {
            const badgeColors = [color(0, 242, 255), color(173, 209, 255), color(255, 0, 212)];
            fill(badgeColors[i]);
            ellipse(boxX + padding + 14, centerY, 14, 14);
        }

        fill(226, 236, 255);
        textAlign(LEFT, CENTER);
        textSize(16);
        text(`${rankStr}. ${h.name}`, boxX + padding + 36, centerY - 2);
        textAlign(CENTER, CENTER);
        text(timeStr, boxX + boxWidth / 2, centerY - 2);
        textAlign(RIGHT, CENTER);
        text(deltaStr, boxX + boxWidth - padding - 16, centerY - 2);
    });

    pop();
}

// --- Data Persistence & Horse Management ---

function saveHorses() {
    localStorage.setItem('horses', JSON.stringify(horses));
}

function loadHorses() {
    // First attempt to read from URL (?horses=name1,name2,...)
    const urlNames = parseHorseNamesFromURL();
    if (urlNames.length > 0) {
        horses = [];
        urlNames.slice(0, 10).forEach(name => {
            const avatarUrl = `https://api.dicebear.com/8.x/${currentStyle}/svg?seed=${encodeURIComponent(name)}`;
            horses.push({ name, avatar: avatarUrl });
            // Preload image into cache
            horseImages[name] = loadImage(avatarUrl);
        });
        // Persist so refresh keeps same horses
        saveHorses();
    } else {
        const storedHorses = localStorage.getItem('horses');
        if (storedHorses) {
            horses = JSON.parse(storedHorses);
        }
    }
    // Ensure stats entries exist for current horses
    loadHorseStats();
    renderHorseList();
    calculateTrackGeometry(); // Ensure geometry is ready
    initializeHorseObjects(); // Prepare horses for drawing
}

// --- Stats Persistence ---
function loadHorseStats() {
    const stored = localStorage.getItem('horseStats');
    if (stored) {
        try {
            horseStats = JSON.parse(stored) || {};
        } catch (e) {
            horseStats = {};
        }
    }
    // Ensure each current horse has an entry
    horses.forEach(h => {
        if (!horseStats[h.name]) {
            horseStats[h.name] = { wins: 0, losses: 0, bestTime: null, lastWinTime: null };
        }
    });
    saveHorseStats();
}

function saveHorseStats() {
    localStorage.setItem('horseStats', JSON.stringify(horseStats));
}

function updateStatsAfterRace(winnerObjects) {
    if (!winnerObjects || winnerObjects.length === 0) return;
    const winnerTime = winnerObjects[0].finishSeconds;
    const winnerNames = new Set(winnerObjects.map(w => w.name));
    horseObjects.forEach(h => {
        // Initialize if missing (defensive)
        if (!horseStats[h.name]) {
            horseStats[h.name] = { wins: 0, losses: 0, bestTime: null, lastWinTime: null };
        }
        const stats = horseStats[h.name];
        if (winnerNames.has(h.name)) {
            stats.wins += 1;
            stats.lastWinTime = Date.now();
        } else {
            stats.losses += 1;
        }
        if (stats.bestTime === null || h.finishSeconds < stats.bestTime) {
            stats.bestTime = h.finishSeconds;
        }
    });
    saveHorseStats();
}

function drawResultsYamlPanel() {
    // Build YAML representation
    const lines = ['stats:'];
    horses.forEach(h => {
        const s = horseStats[h.name] || { wins: 0, losses: 0, bestTime: null, lastWinTime: null };
        const bestTimeStr = s.bestTime === null ? 'null' : s.bestTime.toFixed(2);
        const lastWinStr = s.lastWinTime ? new Date(s.lastWinTime).toISOString() : 'null';
        lines.push(`  - name: ${h.name}`);
        lines.push(`    wins: ${s.wins}`);
        lines.push(`    losses: ${s.losses}`);
        lines.push(`    bestTime: ${bestTimeStr}`);
        lines.push(`    lastWin: ${lastWinStr}`);
    });

    const padding = 12;
    const lineHeight = 18;
    const boxWidth = Math.min(480, width * 0.55);
    const boxHeight = padding * 2 + lineHeight * (lines.length + 1);
    const boxX = 20;
    const boxY = height - boxHeight - 20; // anchor near bottom-left

    // Copy button geometry (inside panel bottom-right)
    const copyBtnWidth = 70;
    const copyBtnHeight = 26;
    const copyBtnX = boxX + boxWidth - copyBtnWidth - padding;
    const copyBtnY = boxY + boxHeight - copyBtnHeight - padding;
    const prevMeta = window._yamlPanelMeta || {};
    // Store meta for mouse interaction, keep last copied timestamp
    window._yamlPanelMeta = {
        lines,
        boxX, boxY, boxWidth, boxHeight,
        copyBtn: { x: copyBtnX, y: copyBtnY, w: copyBtnWidth, h: copyBtnHeight },
        justCopied: prevMeta.justCopied || null
    };

    push();
    rectMode(CORNER);
    stroke(0, 242, 255, 120);
    strokeWeight(2);
    fill(10, 16, 38, 230);
    rect(boxX, boxY, boxWidth, boxHeight, 14);

    noStroke();
    fill(0, 242, 255);
    textAlign(LEFT, TOP);
    textSize(16);
    textStyle(BOLD);
    text('Horse Stats (YAML)', boxX + padding, boxY + padding);
    textStyle(NORMAL);
    textSize(14);
    textFont('monospace');
    fill(226, 236, 255);
    lines.forEach((ln, i) => {
        text(ln, boxX + padding, boxY + padding + lineHeight * (i + 1));
    });

    // Determine hover/click states
    const isHover = mouseX >= copyBtnX && mouseX <= copyBtnX + copyBtnWidth && mouseY >= copyBtnY && mouseY <= copyBtnY + copyBtnHeight;
    const clickedRecently = window._yamlPanelMeta.justCopied && (millis() - window._yamlPanelMeta.justCopied < 900);
    let btnColor;
    if (clickedRecently) {
        btnColor = color(0, 214, 170);
    } else if (isHover) {
        btnColor = color(255, 0, 212);
    } else {
        btnColor = color(0, 242, 255);
    }
    fill(btnColor);
    rect(copyBtnX, copyBtnY, copyBtnWidth, copyBtnHeight, 6);
    fill(12, 18, 40);
    textAlign(CENTER, CENTER);
    textSize(14);
    text(clickedRecently ? 'Copied' : 'Copy', copyBtnX + copyBtnWidth / 2, copyBtnY + copyBtnHeight / 2);
    pop();
}

// Handle copy button click
function mousePressed() {
    if (gameState !== 'finished' || !window._yamlPanelMeta) return;
    const { copyBtn, lines } = window._yamlPanelMeta;
    if (
        mouseX >= copyBtn.x && mouseX <= copyBtn.x + copyBtn.w &&
        mouseY >= copyBtn.y && mouseY <= copyBtn.y + copyBtn.h
    ) {
        const yamlText = lines.join('\n');
        if (navigator.clipboard) {
            navigator.clipboard.writeText(yamlText).then(() => {
                window._yamlPanelMeta.justCopied = millis();
            }).catch(() => {
                console.warn('Clipboard copy failed');
            });
        }
    }
}

function addHorse() {
    if (gameState === 'racing') {
        alert("Cannot add horses while a race is in progress.");
        return;
    }
    const horseName = prompt("Enter the new horse's name:");
    if (horseName && horseName.trim() !== '') {
        if (horses.length >= 10) {
            alert("The racetrack can only hold a maximum of 10 horses.");
            return;
        }
        const avatarUrl = `https://api.dicebear.com/8.x/${currentStyle}/svg?seed=${encodeURIComponent(horseName.trim())}`;

        // Load the new image and then update the state
        horseImages[horseName.trim()] = loadImage(avatarUrl, () => {
            horses.push({ name: horseName.trim(), avatar: avatarUrl });
            saveHorses();
            renderHorseList();
            calculateTrackGeometry();
            initializeHorseObjects();
        });
    }
}

function deleteHorse(index) {
    if (gameState === 'racing') {
        alert("Cannot delete horses while a race is in progress.");
        return;
    }
    const horseName = horses[index].name;
    delete horseImages[horseName]; // Remove from cache

    horses.splice(index, 1);
    saveHorses();
    renderHorseList();
    calculateTrackGeometry();
    initializeHorseObjects();
}

function clearAllData() {
    if (gameState === 'racing') {
        alert("Cannot clear data while a race is in progress.");
        return;
    }
    if (confirm("Are you sure you want to delete all horse data? This cannot be undone.")) {
        horses = [];
        horseObjects = [];
        horseImages = {};
        localStorage.removeItem('horses');
        renderHorseList();
    }
}

// --- UI Rendering ---

function renderHorseList() {
    horseList.innerHTML = ''; // Clear the current list
    horses.forEach((horse, index) => {
        const li = document.createElement('li');
        li.className = 'horse-item';

        const avatar = document.createElement('img');
        avatar.src = horse.avatar;
        avatar.alt = `${horse.name}'s avatar`;
        avatar.className = 'horse-avatar';

        const name = document.createElement('span');
        name.textContent = horse.name;
        name.className = 'horse-name';

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'X';
        deleteBtn.className = 'delete-horse-btn';
        deleteBtn.onclick = () => deleteHorse(index);

        li.appendChild(avatar);
        li.appendChild(name);
        li.appendChild(deleteBtn);
        horseList.appendChild(li);
    });

    // Update button based on state
    if (gameState === 'setup') {
        runRaceBtn.textContent = 'Run Race';
        runRaceBtn.style.display = horses.length > 0 ? 'block' : 'none';
        resetGameBtn.style.display = 'none';
        pauseGameBtn.style.display = 'none';
    } else if (gameState === 'racing') {
        runRaceBtn.style.display = 'none';
        resetGameBtn.style.display = 'block';
        pauseGameBtn.style.display = 'block';
        pauseGameBtn.textContent = 'Pause';
    } else if (gameState === 'paused') {
        runRaceBtn.style.display = 'none';
        resetGameBtn.style.display = 'block';
        pauseGameBtn.style.display = 'block';
        pauseGameBtn.textContent = 'Resume';
    } else if (gameState === 'finished') {
        // After finish: keep reset visible, hide run button until user resets
        runRaceBtn.style.display = 'none';
        resetGameBtn.style.display = 'block';
        pauseGameBtn.style.display = 'none';
    }
}

// ---------------- URL Encoding Support ----------------
// Format: ?horses=Name1,Name2,Name3
// Example: https://example.com/wheel.html?horses=Seabiscuit,Secretariat,Man%20o%20War
// Up to 10 horses accepted. If provided, overrides localStorage horses.
function parseHorseNamesFromURL() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('horses');
    if (!raw) return [];
    return raw.split(',')
        .map(s => decodeURIComponent(s.trim()))
        .filter(s => s.length > 0)
        .slice(0, 10); // enforce max
}

function buildShareableURL() {
    const base = window.location.origin + window.location.pathname;
    if (horses.length === 0) return base;
    const encoded = horses.map(h => encodeURIComponent(h.name)).join(',');
    return `${base}?horses=${encoded}`;
}

function copyShareableURL() {
    const url = buildShareableURL();
    navigator.clipboard.writeText(url).then(() => {
        alert('Shareable URL copied to clipboard!');
    }).catch(() => {
        alert('Failed to copy URL.');
    });
}

// --- Pause Handling ---
function togglePause() {
    if (gameState === 'racing') {
        gameState = 'paused';
        pauseStartMillis = millis();
        pauseGameBtn.textContent = 'Resume';
    } else if (gameState === 'paused') {
        gameState = 'racing';
        pausedAccumulatedMillis += millis() - pauseStartMillis;
        pauseStartMillis = 0;
        pauseGameBtn.textContent = 'Pause';
    }
}

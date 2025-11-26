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

    // --- Event Listeners ---
    addHorseBtn.addEventListener('click', addHorse);
    clearDataBtn.addEventListener('click', clearAllData);
    runRaceBtn.addEventListener('click', handleRaceButton);
    resetGameBtn.addEventListener('click', resetGame);
    shareUrlBtn.addEventListener('click', copyShareableURL);
    pauseGameBtn.addEventListener('click', togglePause);

    // --- Initial Load ---
    currentStyle = avatarStyles[Math.floor(Math.random() * avatarStyles.length)];
    loadHorses();
}

function draw() {
    background(0, 100, 0); // Dark green for infield and outer area
    calculateTrackGeometry();
    drawTrack();

    if (gameState === 'racing') {
        updateHorses();
        checkRaceCompletion();
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
                horse.progress = horse.totalDistance; // clamp
                horse.finished = true;
                const rawFinishMillis = millis() - raceStartMillis - pausedAccumulatedMillis;
                horse.finishSeconds = rawFinishMillis / 1000.0;
            }
        } else {
            // Decelerate to full stop
            if (horse.speed > 0.05) {
                horse.speed *= 0.85;
            } else {
                horse.speed = 0;
            }
            horse.progress = horse.totalDistance; // keep at finish
        }
    });
}

function checkRaceCompletion() {
    if (gameState !== 'racing') return;
    // If any horse not finished, keep racing
    const allFinished = horseObjects.every(h => h.finished);
    if (!allFinished) return;

    // Determine winner by earliest finishSeconds
    const minTime = Math.min(...horseObjects.map(h => h.finishSeconds));
    const firstFinishers = horseObjects.filter(h => h.finishSeconds === minTime);
    winner = firstFinishers[0]; // choose first for display
    const lastTime = Math.max(...horseObjects.map(h => h.finishSeconds));
    raceElapsedSeconds = minTime; // winner's time
    overallRaceDurationSeconds = lastTime; // total race duration

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

function calculateTrackGeometry() {
    const numLanes = horses.length > 0 ? horses.length : 1;
    const margin = 40;
    const laneWidth = 30;

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

    const evenLaneColor = color(210, 180, 140); // Lighter brown
    const oddLaneColor = color(200, 170, 130);  // Slightly darker brown

    // Draw each lane individually with its correct color
    noFill();
    strokeWeight(laneWidth);
    for (let i = 0; i < numLanes; i++) {
        const laneRadius = arcRadius - (i * laneWidth) - (laneWidth / 2);
        const laneColor = i % 2 === 0 ? evenLaneColor : oddLaneColor;

        if (laneRadius > 0) {
            stroke(laneColor);
            // Draw the path for the current lane
            arc(leftArcCenter.x, leftArcCenter.y, laneRadius * 2, laneRadius * 2, HALF_PI, PI + HALF_PI);
            arc(rightArcCenter.x, rightArcCenter.y, laneRadius * 2, laneRadius * 2, PI + HALF_PI, HALF_PI);
            line(leftArcCenter.x, leftArcCenter.y - laneRadius, rightArcCenter.x, rightArcCenter.y - laneRadius);
            line(rightArcCenter.x, rightArcCenter.y + laneRadius, leftArcCenter.x, leftArcCenter.y + laneRadius);
        }
    }

    // Draw thin white divider lines on top of the lanes
    stroke(255, 150); // White, semi-transparent lines
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

    // --- Draw Finish Line as a rectangle ---
    const finishLineX = leftArcCenter.x;
    const finishLineYStart = leftArcCenter.y - arcRadius;
    const finishLineYEnd = leftArcCenter.y - (arcRadius - (numLanes * laneWidth));
    noStroke();
    fill(255, 0, 0);
    rectMode(CORNERS);
    rect(finishLineX, finishLineYStart, finishLineX + FINISH_LINE_WIDTH, finishLineYEnd);
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
    const avatarSize = trackGeometry.laneWidth * 0.9;
    imageMode(CENTER);

    horseObjects.forEach(horse => {
        if (!horse.img || !horse.img.width) return; // Don't draw if image not loaded

        const pos = getHorsePosition(horse);

        // Draw the horse avatar
        image(horse.img, pos.x, pos.y, avatarSize, avatarSize);

        // Draw the horse's name to the right of the avatar
        fill(0); // Black text
        noStroke();
        textSize(16);
        textAlign(LEFT, CENTER);
        text(horse.name, pos.x + avatarSize / 2 + 5, pos.y);
    });
}

function drawWinnerMessage() {
    fill(0, 0, 0, 150); // Semi-transparent backdrop
    rectMode(CORNER);
    rect(0, 0, width, height);

    fill(255);
    textAlign(CENTER, CENTER);
    const winnerTimeStr = raceElapsedSeconds.toFixed(2);
    const totalTimeStr = overallRaceDurationSeconds.toFixed(2);
    const tieLabel = winner && winner._tie ? ' (tie)' : '';
    textSize(50);
    text(`Winner${tieLabel}: ${winner.name}`, width / 2, height / 2 - 50);
    textSize(24);
    text(`Winner Time: ${winnerTimeStr}s`, width / 2, height / 2);
    text(`Total Duration: ${totalTimeStr}s`, width / 2, height / 2 + 40);
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

    rectMode(CORNER);
    noStroke();
    fill(255, 255, 255, 210);
    rect(x, y, boxWidth, boxHeight, 12);

    fill(30);
    textAlign(LEFT, CENTER);
    textSize(18);
    textStyle(BOLD);
    text('Live Leaderboard', x + padding, y + padding + headerHeight / 2);

    ranked.forEach((h, i) => {
        const yTop = y + padding + headerHeight + i * rowHeight;
        const centerY = yTop + rowHeight / 2;

        // Color logic top 3 of current ranking
        let rowColor;
        if (i === 0) rowColor = color(255, 215, 0); // Gold
        else if (i === 1) rowColor = color(192); // Silver
        else if (i === 2) rowColor = color(184, 115, 51); // Copper
        else rowColor = color(255); // White

        // Text
        textAlign(LEFT, CENTER);
        textSize(16);
        textStyle(NORMAL);
        fill(30);
        const rankStr = (i + 1).toString().padStart(2, '0');
        let rightInfo = h.finished ? `${h.finishSeconds.toFixed(2)}s` : '...';
        // Background row accent (optional subtle)
        fill(230);
        rect(x + padding, centerY - 12, boxWidth - padding * 2, 24, 6);
        fill(30);
        text(`${rankStr}. ${h.name}`, x + padding + 8, centerY - 2);
        textAlign(RIGHT, CENTER);
        text(rightInfo, x + boxWidth - padding - 8, centerY - 2);
        // Draw a small colored bullet for top3
        if (i < 3) {
            fill(rowColor);
            ellipse(x + padding + 4, centerY - 2, 10, 10);
        }
    });
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

    rectMode(CORNER);
    noStroke();
    fill(255, 255, 255, 215);
    rect(boxX, boxY, boxWidth, boxHeight, 14);

    fill(30);
    textAlign(LEFT, CENTER);
    textSize(20);
    textStyle(BOLD);
    text(`Final Leaderboard  |  Winner: ${winnerTime.toFixed(2)}s`, boxX + padding, boxY + padding + headerHeight / 2);

    ranked.forEach((h, i) => {
        const yTop = boxY + padding + headerHeight + i * rowHeight;
        const centerY = yTop + rowHeight / 2;
        let colorFill;
        if (i === 0) colorFill = color(255, 215, 0); // Gold
        else if (i === 1) colorFill = color(192); // Silver
        else if (i === 2) colorFill = color(184, 115, 51); // Copper
        else colorFill = color(255);

        const rankStr = (i + 1).toString().padStart(2, '0');
        const timeStr = h.finishSeconds.toFixed(2) + 's' + (winner._tie && h.finishSeconds === winnerTime ? ' (tie)' : '');
        const delta = h.finishSeconds - winnerTime;
        const deltaStr = (delta === 0 ? '+0.00s' : `+${delta.toFixed(2)}s`);

        // Row background
        fill(230);
        rect(boxX + padding, centerY - 14, boxWidth - padding * 2, 28, 8);
        // Colored bullet for top3
        if (i < 3) {
            fill(colorFill);
            ellipse(boxX + padding + 12, centerY - 0, 14, 14);
        }
        fill(30);
        textAlign(LEFT, CENTER);
        textSize(16);
        text(`${rankStr}. ${h.name}`, boxX + padding + 30, centerY - 2);
        textAlign(CENTER, CENTER);
        text(timeStr, boxX + boxWidth / 2, centerY - 2);
        textAlign(RIGHT, CENTER);
        text(deltaStr, boxX + boxWidth - padding - 12, centerY - 2);
    });
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
    renderHorseList();
    calculateTrackGeometry(); // Ensure geometry is ready
    initializeHorseObjects(); // Prepare horses for drawing
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

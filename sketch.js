let horses = [];
let horseObjects = [];
let horseImages = {}; // Cache for loaded avatar images
let horseList, addHorseBtn, clearDataBtn, runRaceBtn, resetGameBtn;
let winner = null;

// --- Game State & Configuration ---
const MAX_EXECUTION_TIME = 10; // Target race duration in seconds
const avatarStyles = [
    'adventurer', 'avataaars', 'big-ears', 'big-smile', 'bottts', 'croodles',
    'fun-emoji', 'lorelei', 'micah', 'miniavs', 'open-peeps', 'personas', 'pixel-art',
];
let currentStyle;
let gameState = 'setup'; // 'setup', 'racing', 'finished'

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

    // --- Event Listeners ---
    addHorseBtn.addEventListener('click', addHorse);
    clearDataBtn.addEventListener('click', clearAllData);
    runRaceBtn.addEventListener('click', handleRaceButton);
    resetGameBtn.addEventListener('click', resetGame);

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
        checkWinner();
    }

    if (horseObjects.length > 0) {
        drawHorses();
        if (gameState === 'racing') {
            drawLeaderboard();
        }
    }

    if (gameState === 'finished' && winner) {
        drawWinnerMessage();
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
    runRaceBtn.style.display = 'none'; // Hide button during the race
    resetGameBtn.style.display = 'block'; // Show reset button during race

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
            img: horseImages[horse.name]
        };
    });
}

function updateHorses() {
    const targetFrames = MAX_EXECUTION_TIME * 60;
    horseObjects.forEach(horse => {
        const baseSpeed = horse.totalDistance / targetFrames;
        // Fluctuate speed slightly around the base speed
        horse.speed += random(-baseSpeed * 0.05, baseSpeed * 0.05);
        // Constrain the speed to prevent it from becoming too fast or slow
        horse.speed = constrain(horse.speed, baseSpeed * 0.8, baseSpeed * 1.2);

        // Update progress based on speed
        horse.progress += horse.speed;
    });
}

function checkWinner() {
    if (winner) return; // Stop checking once a winner is found

    for (const horse of horseObjects) {
        if (horse.progress >= horse.totalDistance) {
            winner = horse;
            gameState = 'finished';
            runRaceBtn.textContent = 'New Race';
            // In finished state we keep only reset visible until user clicks it
            runRaceBtn.style.display = 'none';
            resetGameBtn.style.display = 'block';
            break;
        }
    }
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
    fill(0, 0, 0, 150); // Semi-transparent black overlay
    rectMode(CORNER);
    rect(0, 0, width, height);

    fill(255);
    textAlign(CENTER, CENTER);
    textSize(50);
    text(`Winner is ${winner.name}!`, width / 2, height / 2);
}

// --- Leaderboard ---
function drawLeaderboard() {
    // Sort by percent completion descending
    const ranked = [...horseObjects].map(h => {
        const pct = constrain(h.progress / h.totalDistance, 0, 1);
        return { name: h.name, pct };
    }).sort((a, b) => b.pct - a.pct);

    const padding = 8;
    const lineHeight = 18;
    const headerHeight = 20;
    const boxWidth = 180;
    const boxHeight = headerHeight + ranked.length * lineHeight + padding * 2;
    const cx = width / 2;
    const cy = height / 2;
    const x = cx - boxWidth / 2;
    const y = cy - boxHeight / 2;

    // Background box
    noStroke();
    fill(255, 255, 255, 180);
    rectMode(CORNER);
    rect(x, y, boxWidth, boxHeight, 10);

    // Header
    fill(30);
    textAlign(LEFT, CENTER);
    textSize(14);
    textStyle(BOLD);
    text('Leaderboard', x + padding, y + padding + headerHeight / 2);

    // Entries
    textSize(12);
    textStyle(NORMAL);
    ranked.forEach((r, i) => {
        const rowY = y + padding + headerHeight + i * lineHeight + lineHeight / 2;
        const rankStr = (i + 1).toString().padStart(2, ' ');
        const pctStr = Math.round(r.pct * 100);
        fill(0);
        text(`${rankStr}. ${r.name} (${pctStr}%)`, x + padding, rowY);
    });
}

// --- Data Persistence & Horse Management ---

function saveHorses() {
    localStorage.setItem('horses', JSON.stringify(horses));
}

function loadHorses() {
    const storedHorses = localStorage.getItem('horses');
    if (storedHorses) {
        horses = JSON.parse(storedHorses);
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
    } else if (gameState === 'racing') {
        runRaceBtn.style.display = 'none';
        resetGameBtn.style.display = 'block';
    } else if (gameState === 'finished') {
        // After finish: keep reset visible, hide run button until user resets
        runRaceBtn.style.display = 'none';
        resetGameBtn.style.display = 'block';
    }
}

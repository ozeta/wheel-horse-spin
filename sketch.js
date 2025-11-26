let horses = [];
let horseList, addHorseBtn, clearDataBtn, runRaceBtn;

// --- Game State & Configuration ---
const avatarStyles = [
    'adventurer', 'avataaars', 'big-ears', 'big-smile', 'bottts', 'croodles',
    'fun-emoji', 'lorelei', 'micah', 'miniavs', 'open-peeps', 'personas', 'pixel-art',
];
let currentStyle;

// --- p5.js Sketch ---

function setup() {
    const canvasContainer = document.getElementById('canvas-container');
    if (!canvasContainer) {
        console.error('Canvas container not found!');
        return;
    }
    const containerSize = canvasContainer.getBoundingClientRect();
    const canvas = createCanvas(containerSize.width, containerSize.height);
    canvas.parent('canvas-container');

    // --- DOM Element Initialization ---
    horseList = document.getElementById('horse-list');
    addHorseBtn = document.getElementById('add-horse');
    clearDataBtn = document.getElementById('clear-data');
    runRaceBtn = document.getElementById('run-race');

    // --- Event Listeners ---
    addHorseBtn.addEventListener('click', addHorse);
    clearDataBtn.addEventListener('click', clearAllData);
    runRaceBtn.addEventListener('click', () => {
        if (horses.length > 0) {
            alert("The race will start now!"); // Placeholder
        }
    });

    // --- Initial Load ---
    currentStyle = avatarStyles[Math.floor(Math.random() * avatarStyles.length)];
    loadHorses();
}

function draw() {
    background(0, 100, 0); // Dark green for the infield
    drawTrack();
}

function windowResized() {
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
        const containerSize = canvasContainer.getBoundingClientRect();
        resizeCanvas(containerSize.width, containerSize.height);
    }
}

// --- Racetrack Drawing ---

function drawTrack() {
    const numHorses = horses.length > 0 ? horses.length : 1; // Draw at least one lane
    const margin = 30;
    const laneWidth = 25;
    const trackWidth = numHorses * laneWidth;

    // Calculate the dimensions of the outer track boundary
    const outerRectWidth = width - 2 * margin;
    const outerRectHeight = height - 2 * margin;
    const arcDiameter = outerRectHeight;
    const arcRadius = arcDiameter / 2;
    const straightLength = outerRectWidth - arcDiameter;

    // Center points for the arcs
    const leftArcCenter = { x: margin + arcRadius, y: height / 2 };
    const rightArcCenter = { x: margin + arcRadius + straightLength, y: height / 2 };

    // Draw from the outside in
    for (let i = 0; i < numHorses; i++) {
        const currentRadius = arcRadius - i * laneWidth;
        const laneColor = i % 2 === 0 ? color(210, 180, 140) : color(200, 170, 130); // Alternating tan colors

        // --- Draw the track surface for this lane ---
        noStroke();
        fill(laneColor);

        // Draw the two straight sections
        rect(leftArcCenter.x, leftArcCenter.y - currentRadius, straightLength, currentRadius * 2);

        // Draw the two semi-circular ends
        arc(leftArcCenter.x, leftArcCenter.y, currentRadius * 2, currentRadius * 2, HALF_PI, -HALF_PI);
        arc(rightArcCenter.x, rightArcCenter.y, currentRadius * 2, currentRadius * 2, -HALF_PI, HALF_PI);

        // --- Draw the lane boundaries ---
        stroke(255); // White lane lines
        strokeWeight(2);
        noFill();

        // Draw outer boundary of the current lane
        if (currentRadius > 0) {
            arc(leftArcCenter.x, leftArcCenter.y, currentRadius * 2, currentRadius * 2, HALF_PI, PI + HALF_PI);
            line(leftArcCenter.x, leftArcCenter.y - currentRadius, rightArcCenter.x, rightArcCenter.y - currentRadius);
            arc(rightArcCenter.x, rightArcCenter.y, currentRadius * 2, currentRadius * 2, PI + HALF_PI, HALF_PI);
            line(rightArcCenter.x, rightArcCenter.y + currentRadius, leftArcCenter.x, leftArcCenter.y + currentRadius);
        }
    }

    // --- Draw Finish Line ---
    const finishLineStart = { x: rightArcCenter.x, y: rightArcCenter.y - arcRadius };
    const finishLineEnd = { x: rightArcCenter.x, y: rightArcCenter.y + arcRadius };
    
    stroke(255, 0, 0); // Red finish line
    strokeWeight(4);
    line(finishLineStart.x, finishLineStart.y, finishLineEnd.x, finishLineEnd.y);
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
}

function addHorse() {
    const horseName = prompt("Enter the new horse's name:");
    if (horseName && horseName.trim() !== '') {
        if (horses.length >= 10) {
            alert("The racetrack can only hold a maximum of 10 horses.");
            return;
        }
        const avatarUrl = `https://api.dicebear.com/8.x/${currentStyle}/svg?seed=${encodeURIComponent(horseName.trim())}`;
        horses.push({ name: horseName.trim(), avatar: avatarUrl });
        saveHorses();
        renderHorseList();
    }
}

function deleteHorse(index) {
    horses.splice(index, 1);
    saveHorses();
    renderHorseList();
}

function clearAllData() {
    if (confirm("Are you sure you want to delete all horse data? This cannot be undone.")) {
        horses = [];
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

    runRaceBtn.style.display = horses.length > 0 ? 'block' : 'none';
}

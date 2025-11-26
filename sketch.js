// Wait for the DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {
    const horseList = document.getElementById('horse-list');
    const addHorseBtn = document.getElementById('add-horse');
    const clearDataBtn = document.getElementById('clear-data');
    const runRaceBtn = document.getElementById('run-race');

    // List of available DiceBear styles
    const avatarStyles = [
        'adventurer',
        'avataaars',
        'big-ears',
        'big-smile',
        'bottts',
        'croodles',
        'fun-emoji',
        'lorelei',
        'micah',
        'miniavs',
        'open-peeps',
        'personas',
        'pixel-art',
    ];

    // Select a random style on page load
    const currentStyle = avatarStyles[Math.floor(Math.random() * avatarStyles.length)];

    let horses = [];

    // --- Data Persistence ---
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

    // --- Horse Management ---
    function addHorse() {
        const horseName = prompt("Enter the new horse's name:");
        if (horseName && horseName.trim() !== '') {
            if (horses.length >= 10) {
                alert("The racetrack can only hold a maximum of 10 horses.");
                return;
            }
            // Use the randomly selected style for the new avatar
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

        // Toggle "Run Race" button visibility
        runRaceBtn.style.display = horses.length > 0 ? 'block' : 'none';
    }

    // --- Event Listeners ---
    addHorseBtn.addEventListener('click', addHorse);
    clearDataBtn.addEventListener('click', clearAllData);
    runRaceBtn.addEventListener('click', () => {
        if (horses.length > 0) {
            alert("The race will start now!"); // Placeholder for race logic
        }
    });

    // --- Initial Load ---
    loadHorses();
});


function setup() {
    const canvasContainer = document.getElementById('canvas-container');

    // Ensure the container is there before creating the canvas
    if (canvasContainer) {
        const containerSize = canvasContainer.getBoundingClientRect();
        const canvas = createCanvas(containerSize.width, containerSize.height);
        canvas.parent('canvas-container');
    } else {
        console.error('Canvas container not found!');
    }
}

function draw() {
    background(220); // Light grey background for the canvas
    // The track and horses will be drawn here later
}

function windowResized() {
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
        const containerSize = canvasContainer.getBoundingClientRect();
        resizeCanvas(containerSize.width, containerSize.height);
    }
}

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

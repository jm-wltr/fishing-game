const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let width, height;
let time = 0;

// Game State
const bobber = {
    x: 0,
    y: 0,
    radius: 15,
    state: 'floating', // floating, submerged
    submergeTime: 0
};

const waves = [];
let fish = null;
let gameState = 'start'; // start, playing, reeling, caught, missed
let message = 'Click to Start';
let messageTimer = 0;

// Minigame State
const GRAVITY = 0.15;
const BAR_LIFT = -0.3;
const BAR_MAX_SPEED = 4;

let minigame = {
    active: false,
    fishPos: 50, // 0-100
    fishTarget: 50,
    fishTimer: 0,
    barPos: 50, // 0-100
    barVelocity: 0,
    progress: 30, // 0-100
    barSize: 25,
    fishSpeed: 0.05,
    erratic: 0.3
};

// Audio Context
let audioCtx;
let ambientNode;
let tailNode;
let tailGain;
let glugInterval;

function initAudio() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();

    // Ambient Water Sound (Pink Noise + Lowpass)
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5;
    }

    ambientNode = audioCtx.createBufferSource();
    ambientNode.buffer = noiseBuffer;
    ambientNode.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;

    // Modulate filter for wave effect
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 0.1;
    const oscGain = audioCtx.createGain();
    oscGain.gain.value = 200;

    osc.connect(oscGain);
    oscGain.connect(filter.frequency);
    osc.start();

    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.1;

    ambientNode.connect(filter);
    filter.connect(masterGain);
    masterGain.connect(audioCtx.destination);
    ambientNode.start();

    // Tail Swish Sound (Bubbly chirps)
    // Create a buffer with multiple bubble chirps
    const tailBufferSize = audioCtx.sampleRate * 2;
    const tailBuffer = audioCtx.createBuffer(1, tailBufferSize, audioCtx.sampleRate);
    const tailData = tailBuffer.getChannelData(0);

    // Generate multiple bubble chirps throughout the buffer
    for (let chirp = 0; chirp < 20; chirp++) {
        const startSample = Math.floor((chirp / 20) * tailBufferSize);
        const chirpLength = Math.floor(audioCtx.sampleRate * 0.05); // 50ms chirps

        for (let i = 0; i < chirpLength; i++) {
            const t = i / audioCtx.sampleRate;
            // Frequency drops from 800 to 200 Hz
            const freq = 800 - (600 * (i / chirpLength));
            const envelope = Math.sin((i / chirpLength) * Math.PI); // Smooth envelope
            tailData[startSample + i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.3;
        }
    }

    tailNode = audioCtx.createBufferSource();
    tailNode.buffer = tailBuffer;
    tailNode.loop = true;

    tailGain = audioCtx.createGain();
    tailGain.gain.value = 0;

    tailNode.connect(tailGain);
    tailGain.connect(audioCtx.destination);
    tailNode.start();
}

function playBubble() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400 + Math.random() * 200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function startGlug() {
    if (glugInterval) return;
    glugInterval = setInterval(() => {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200 + Math.random() * 50, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(100, audioCtx.currentTime + 0.15);

        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    }, 150);
}

function stopGlug() {
    if (glugInterval) {
        clearInterval(glugInterval);
        glugInterval = null;
    }
}

function playCatchSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.2);

    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

// Fish Class
class Fish {
    constructor() {
        this.reset();
    }

    reset() {
        // Spawn somewhere far from center
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.max(width, height) * 0.4 + Math.random() * 200;
        this.x = width / 2 + Math.cos(angle) * dist;
        this.y = height / 2 + Math.sin(angle) * dist;

        this.vx = 0;
        this.vy = 0;
        this.angle = angle + Math.PI; // Face center roughly
        this.speed = 0;

        this.state = 'IDLE'; // IDLE, APPROACHING, NIBBLING, BITING, FLEEING
        this.stateTimer = 0;
        this.targetX = this.x;
        this.targetY = this.y;

        // Visuals
        this.size = 20;
        this.tailAngle = 0;
    }

    update() {
        this.stateTimer++;

        // State Machine
        switch (this.state) {
            case 'IDLE':
                // Wander randomly
                if (this.stateTimer > 100 && Math.random() < 0.02) {
                    this.setTarget(
                        this.x + (Math.random() - 0.5) * 200,
                        this.y + (Math.random() - 0.5) * 200
                    );
                }
                // Occasionally decide to approach
                if (this.stateTimer > 200 && Math.random() < 0.005) {
                    this.state = 'APPROACHING';
                    this.stateTimer = 0;
                }
                break;

            case 'APPROACHING':
                // Move towards bobber
                const dist = Math.hypot(bobber.x - this.x, bobber.y - this.y);
                if (dist > 60) {
                    this.setTarget(bobber.x, bobber.y);
                } else {
                    // Close enough
                    this.vx *= 0.9;
                    this.vy *= 0.9;
                    if (Math.random() < 0.02) {
                        // Decide to nibble or wait
                        this.state = Math.random() < 0.7 ? 'NIBBLING' : 'APPROACHING';
                        // If we stay approaching, we just hover
                    }

                    // Chance to bite
                    if (this.stateTimer > 100 && Math.random() < 0.01) {
                        this.state = 'BITING';
                        this.stateTimer = 0;
                        bobber.state = 'submerged';
                        bobber.submergeTime = time;
                        startGlug();
                    }
                }
                break;

            case 'NIBBLING':
                // Quick dart to bobber and back
                if (this.stateTimer === 1) {
                    // Dart in
                    this.vx = (bobber.x - this.x) * 0.1;
                    this.vy = (bobber.y - this.y) * 0.1;
                    playBubble();
                }
                if (this.stateTimer === 10) {
                    // Dart out
                    this.vx = -(bobber.x - this.x) * 0.1;
                    this.vy = -(bobber.y - this.y) * 0.1;
                }
                if (this.stateTimer > 30) {
                    this.state = 'APPROACHING';
                    this.stateTimer = 0;
                }
                break;

            case 'BITING':
                // Latch on
                this.x = bobber.x;
                this.y = bobber.y;
                this.vx = 0;
                this.vy = 0;

                // Shake effect
                this.x += (Math.random() - 0.5) * 5;
                this.y += (Math.random() - 0.5) * 5;

                // Timeout - Missed fish
                if (this.stateTimer > 30 && gameState === 'playing') { // 0.5 seconds (at 60fps)
                    this.flee();
                    gameState = 'missed';
                    message = 'Too slow!';
                    messageTimer = 120;
                    bobber.state = 'floating';
                    stopGlug();
                }
                break;

            case 'FLEEING':
                // Move away fast
                const angle = Math.atan2(this.y - bobber.y, this.x - bobber.x);
                this.vx = Math.cos(angle) * 8;
                this.vy = Math.sin(angle) * 8;

                if (this.stateTimer > 120) {
                    // Reset game after fleeing
                    if (gameState === 'missed') {
                        gameState = 'playing';
                        this.reset();
                    }
                }
                break;
        }

        // Physics
        this.x += this.vx;
        this.y += this.vy;

        // Friction
        this.vx *= 0.95;
        this.vy *= 0.95;

        // Rotation
        const speed = Math.hypot(this.vx, this.vy);
        if (speed > 0.1) {
            const targetAngle = Math.atan2(this.vy, this.vx);
            // Smooth rotation
            let diff = targetAngle - this.angle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            this.angle += diff * 0.1;
        }

        // Tail animation
        this.tailAngle = Math.sin(time * (10 + speed * 5)) * (0.5 + speed * 0.2);

        // Update Tail Sound
        if (tailGain) {
            // Map speed (0-8) to gain (0-0.2)
            tailGain.gain.setTargetAtTime(Math.min(speed * 0.03, 0.3), audioCtx.currentTime, 0.1);
        }
    }

    setTarget(tx, ty) {
        const angle = Math.atan2(ty - this.y, tx - this.x);
        const force = 0.2;
        this.vx += Math.cos(angle) * force;
        this.vy += Math.sin(angle) * force;
    }

    flee() {
        this.state = 'FLEEING';
        this.stateTimer = 0;
        bobber.state = 'floating';
        stopGlug();
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // Dark inverted waterdrop shape
        ctx.fillStyle = '#1a2639'; // Dark blue/black

        // Body
        ctx.beginPath();
        ctx.moveTo(15, 0); // Nose
        ctx.bezierCurveTo(5, -10, -10, -10, -15, 0); // Top curve
        ctx.bezierCurveTo(-10, 10, 5, 10, 15, 0); // Bottom curve
        ctx.fill();

        // Tail
        ctx.save();
        ctx.translate(-15, 0);
        ctx.rotate(this.tailAngle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-10, -8);
        ctx.lineTo(-10, 8);
        ctx.fill();
        ctx.restore();

        // Eye (optional, for direction)
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(8, -3, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    bobber.x = width / 2;
    bobber.y = height / 2;

    if (!fish) fish = new Fish();
}

window.addEventListener('resize', resize);
resize();

// Input Handling
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        if (gameState === 'start') {
            initAudio();
            gameState = 'playing';
            message = '';
        } else if (gameState === 'playing') {
            if (fish.state === 'BITING') {
                // Success!
                gameState = 'caught';
                message = 'Caught!';
                messageTimer = 120;
                bobber.state = 'floating';
                stopGlug();
                playCatchSound();
            } else {
                // Fail - Early pull
                fish.flee();
                gameState = 'missed';
                message = 'Too early!';
                messageTimer = 120;
            }
        }
    }
});

window.addEventListener('click', () => {
    if (gameState === 'start') {
        initAudio();
        gameState = 'playing';
        message = '';
    }
});

// Simple noise function for water texture
function getWaterHeight(x, y, t) {
    const scale = 0.02;
    const v1 = Math.sin(x * scale + t);
    const v2 = Math.sin(y * scale + t * 0.5);
    const v3 = Math.sin((x + y) * scale * 0.5 + t * 0.7);
    return (v1 + v2 + v3) / 3;
}

function drawWater() {
    ctx.fillStyle = '#4da6ff';
    ctx.fillRect(0, 0, width, height);

    const gridSize = 40;
    const cols = Math.ceil(width / gridSize);
    const rows = Math.ceil(height / gridSize);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';

    for (let i = 0; i <= cols; i++) {
        for (let j = 0; j <= rows; j++) {
            const x = i * gridSize;
            const y = j * gridSize;
            const h = getWaterHeight(x, y, time * 2);

            if (h > 0) {
                const size = h * (gridSize / 2);
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function drawBobber() {
    // Bobber visuals change based on state
    let scale = 1 + Math.sin(time * 3) * 0.05;
    let colorBody = '#ff4444';
    let colorTop = 'white';

    if (bobber.state === 'submerged') {
        scale = 0.8; // Looks smaller/deeper
        colorBody = '#000080'; // Dark blue version
        colorTop = '#8080ff';
    }

    ctx.save();
    ctx.translate(bobber.x, bobber.y);
    ctx.scale(scale, scale);

    // Bobber body
    ctx.beginPath();
    ctx.arc(0, 0, bobber.radius, 0, Math.PI * 2);
    ctx.fillStyle = colorTop;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, bobber.radius, 0, Math.PI, false); // Bottom half
    ctx.fillStyle = colorBody;
    ctx.fill();

    // Center pin
    ctx.beginPath();
    ctx.arc(0, 0, bobber.radius * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#cc0000';
    ctx.fill();

    ctx.restore();
}

function updateWaves() {
    // Spawn new wave occasionally
    if (Math.random() < 0.02) {
        waves.push({
            r: bobber.radius,
            alpha: 0.5,
            speed: 1 + Math.random()
        });
    }

    // If biting, spawn waves faster/more chaotic
    if (fish.state === 'BITING' && Math.random() < 0.2) {
        waves.push({
            r: bobber.radius,
            alpha: 0.8,
            speed: 2 + Math.random()
        });
    }

    // Update and draw waves
    for (let i = waves.length - 1; i >= 0; i--) {
        const wave = waves[i];
        wave.r += wave.speed;
        wave.alpha -= 0.005;

        if (wave.alpha <= 0) {
            waves.splice(i, 1);
            continue;
        }

        ctx.beginPath();
        ctx.arc(bobber.x, bobber.y, wave.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${wave.alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

function drawUI() {
    if (gameState === 'start') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = 'white';
        ctx.font = '40px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(message, width / 2, height / 2);
    } else if (messageTimer > 0) {
        ctx.fillStyle = 'white';
        ctx.font = '40px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(message, width / 2, height / 4);
        messageTimer--;

        if (messageTimer === 0 && gameState === 'caught') {
            gameState = 'playing';
            fish.reset();
        }
    }
}

function loop() {
    time += 0.01;

    ctx.clearRect(0, 0, width, height);

    drawWater();

    if (gameState === 'playing' || gameState === 'missed' || gameState === 'caught') {
        fish.update();
        fish.draw();
    }

    updateWaves();
    drawBobber();
    drawUI();

    requestAnimationFrame(loop);
}

loop();

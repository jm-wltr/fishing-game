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

// Difficulty Levels
const DIFFICULTY = {
    EASY: { name: 'Easy', barSize: 25, fishSpeed: 0.05, erratic: 0.3, progressLoss: 0.3 }, // Was Medium
    MEDIUM: { name: 'Medium', barSize: 20, fishSpeed: 0.08, erratic: 0.5, progressLoss: 0.35 }, // Was Hard
    HARD: { name: 'Hard', barSize: 15, fishSpeed: 0.1, erratic: 0.5, progressLoss: 0.4 } // Hybrid: Medium speed, Legendary bar
};

let currentDifficulty = DIFFICULTY.EASY;

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

function playReelTick() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'square';
    osc.frequency.value = 300;

    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
}

function playWinMelody() {
    if (!audioCtx) return;
    const notes = [523, 659, 784, 1046]; // C, E, G, C
    notes.forEach((freq, i) => {
        setTimeout(() => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = 'square';
            osc.frequency.value = freq;

            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start();
            osc.stop(audioCtx.currentTime + 0.2);
        }, i * 100);
    });
}

function playLoseSound() {
    if (!audioCtx) return;
    const notes = [400, 350, 300];
    notes.forEach((freq, i) => {
        setTimeout(() => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.value = freq;

            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start();
            osc.stop(audioCtx.currentTime + 0.3);
        }, i * 300);
    });
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
                // Occasionally decide to approach (faster)
                if (this.stateTimer > 60 && Math.random() < 0.02) {
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
                    if (Math.random() < 0.05) {
                        // Decide to nibble or wait (faster decisions)
                        this.state = Math.random() < 0.7 ? 'NIBBLING' : 'APPROACHING';
                        // If we stay approaching, we just hover
                    }

                    // Chance to bite (faster)
                    if (this.stateTimer > 30 && Math.random() < 0.03) {
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
let spacePressed = false;

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        spacePressed = true;

        if (gameState === 'start') {
            initAudio();
            gameState = 'playing';
            message = '';
        } else if (gameState === 'playing') {
            if (fish.state === 'BITING') {
                // Start reeling minigame!
                gameState = 'reeling';
                stopGlug();
                initMinigame();
            } else {
                // Fail - Early pull
                fish.flee();
                gameState = 'missed';
                message = 'Too early!';
                messageTimer = 120;
            }
        } else if (gameState === 'caught' || gameState === 'missed') {
            gameState = 'playing';
            fish.reset();
            message = '';
            messageTimer = 0;
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        spacePressed = false;
    }
});

window.addEventListener('click', () => {
    if (gameState === 'start') {
        initAudio();
        gameState = 'playing';
        message = '';
    }
});

// Difficulty Selector
const diffButtons = document.querySelectorAll('.diff-btn');
diffButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent triggering game start

        // Update UI
        diffButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update Game State
        const diffKey = btn.getAttribute('data-diff');
        currentDifficulty = DIFFICULTY[diffKey];

        // Reset focus so spacebar doesn't trigger button click
        btn.blur();
    });
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

    // Persistent control hint
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Tap SPACE when the fish dips', 16, height - 16);
    ctx.restore();
}

// Minigame Functions
function initMinigame() {
    minigame.active = true;
    minigame.fishPos = 50;
    minigame.barPos = 50;
    minigame.barVelocity = 0;
    minigame.progress = 30;
    minigame.fishTimer = 0;
    bobber.state = 'floating';
}

function updateMinigame() {
    minigame.fishTimer++;

    // Fish AI - moves to random targets (using current difficulty)
    if (minigame.fishTimer > (100 - currentDifficulty.erratic * 80)) {
        minigame.fishTarget = Math.random() * 80 + 10;
        minigame.fishTimer = 0;
    }

    // Move fish towards target
    const diff = minigame.fishTarget - minigame.fishPos;
    minigame.fishPos += diff * currentDifficulty.fishSpeed;

    // Bar Physics
    if (spacePressed) {
        minigame.barVelocity += BAR_LIFT;
    }
    minigame.barVelocity += GRAVITY;

    // Clamp velocity
    minigame.barVelocity = Math.max(-BAR_MAX_SPEED, Math.min(BAR_MAX_SPEED, minigame.barVelocity));

    minigame.barPos += minigame.barVelocity;

    // Bounce off walls
    if (minigame.barPos < 0) {
        minigame.barPos = 0;
        minigame.barVelocity = 0;
    }
    if (minigame.barPos > 100 - currentDifficulty.barSize) {
        minigame.barPos = 100 - currentDifficulty.barSize;
        minigame.barVelocity = 0;
    }

    // Check overlap (using current difficulty)
    const barTop = minigame.barPos;
    const barBottom = minigame.barPos + currentDifficulty.barSize;
    const fishTop = minigame.fishPos;
    const fishBottom = minigame.fishPos + 10;

    const overlap = (fishBottom > barTop && fishTop < barBottom);

    let lastProgress = minigame.progress;
    if (overlap) {
        minigame.progress += 0.4;
    } else {
        minigame.progress -= currentDifficulty.progressLoss; // Use difficulty-based loss rate
    }

    // Play tick sound when progress increases
    if (overlap && Math.floor(minigame.progress / 5) > Math.floor(lastProgress / 5)) {
        playReelTick();
    }

    // Win/Loss
    if (minigame.progress >= 100) {
        gameState = 'caught';
        message = 'Caught!';
        messageTimer = 120;
        minigame.active = false;
        playWinMelody();
    } else if (minigame.progress <= 0) {
        gameState = 'missed';
        message = 'It escaped!';
        messageTimer = 120;
        minigame.active = false;
        fish.flee();
        playLoseSound();
    }
}

function drawMinigame() {
    const barX = width - 150;
    const barY = 100;
    const barW = 40;
    const barH = 400;

    // Background
    ctx.fillStyle = 'rgba(26, 38, 57, 0.9)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = '#4da6ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);

    // Fish indicator
    const fishY = barY + (minigame.fishPos / 100) * (barH - 30);
    ctx.save();
    ctx.translate(barX + barW / 2, fishY + 15);
    ctx.rotate(Math.PI / 2);

    // Draw fish shape
    ctx.fillStyle = '#2ecc71';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.bezierCurveTo(3, -6, -6, -6, -10, 0);
    ctx.bezierCurveTo(-6, 6, 3, 6, 10, 0);
    ctx.fill();

    // Tail
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-15, -5);
    ctx.lineTo(-15, 5);
    ctx.fill();

    ctx.restore();

    // Catch Bar (using current difficulty)
    const barPixelH = (currentDifficulty.barSize / 100) * barH;
    const catchY = barY + (minigame.barPos / 100) * barH;
    ctx.fillStyle = 'rgba(144, 238, 144, 0.6)';
    ctx.fillRect(barX + 2, catchY, barW - 4, barPixelH);
    ctx.strokeStyle = '#90ee90';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX + 2, catchY, barW - 4, barPixelH);

    // Progress Bar
    const progX = barX + barW + 10;
    const progY = barY;
    const progW = 20;
    const progH = barH;

    ctx.fillStyle = '#1a2639';
    ctx.fillRect(progX, progY, progW, progH);
    ctx.strokeStyle = '#4da6ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(progX, progY, progW, progH);

    const fillH = (minigame.progress / 100) * progH;
    const grad = ctx.createLinearGradient(0, progY + (progH - fillH), 0, progY + progH);
    grad.addColorStop(0, '#00ff00');
    grad.addColorStop(1, '#004400');

    ctx.fillStyle = grad;
    ctx.fillRect(progX + 2, progY + (progH - fillH), progW - 4, fillH);

    // Instructions and Difficulty Label
    ctx.fillStyle = 'white';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Hold SPACE', barX + barW / 2, barY - 30);
    ctx.fillText('to lift bar', barX + barW / 2, barY - 10);

    // Display current difficulty
    ctx.font = 'bold 14px Arial';
    ctx.fillStyle = '#4da6ff';
    ctx.fillText(currentDifficulty.name, barX + barW / 2, barY + barH + 25);
}

function loop() {
    time += 0.01;

    ctx.clearRect(0, 0, width, height);

    drawWater();

    if (gameState === 'playing' || gameState === 'missed' || gameState === 'caught') {
        fish.update();
        fish.draw();
    } else if (gameState === 'reeling') {
        // Keep fish visible but frozen
        fish.draw();
        updateMinigame();
    }

    updateWaves();
    drawBobber();

    if (gameState === 'reeling') {
        drawMinigame();
    }

    drawUI();

    requestAnimationFrame(loop);
}

loop();

let canvas;
let ctx;

// Game State
let gameLoopId;
let lastTime = 0;
let isGameOver = false;
let isPlaying = false;
let isPaused = false;
let gameOverTimeout;
let playerMode = 2; // 1 = 1 Player, 2 = 2 Players
const MAX_ENEMIES = 20;

// Input State
const keys = {};

// Entities
class Player {
    constructor(x, y, color, controls, id) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.width = 60;
        this.height = 60;
        this.speed = 5; // Used as max speed
        this.vx = 0;
        this.vy = 0;
        this.acceleration = 100;
        this.friction = 0.92;
        this.rotation = 0;
        this.maxTilt = 0.3; // Radians
        this.color = color;
        this.shape = 'classic';
        this.bullets = [];
        this.lastShot = 0;
        this.shootDelay = 150;
        this.controls = controls;
        this.trail = [];
        this.isAlive = true;
        this.hasSideShooters = false;
        this.sideShooterEndTime = 0;
        this.lives = 3;
        this.maxLives = 3;
        this.invulnerable = false;
        this.invulnerableEndTime = 0;
        this.kills = 0;
        this.hasShield = false;
        this.shieldEndTime = 0;

        // Touch control state (mobile): when touchActive is true, this
        // player follows touchTargetX/Y instead of using keys, and fires
        // continuously while the finger is down.
        this.touchActive = false;
        this.touchId = null;
        this.touchTargetX = x;
        this.touchTargetY = y;
    }

    update(deltaTime) {
        if (!this.isAlive) return;

        // Check if side shooters should expire
        if (this.hasSideShooters && performance.now() > this.sideShooterEndTime) {
            this.hasSideShooters = false;
        }

        // Check if invulnerability should expire
        if (this.invulnerable && performance.now() > this.invulnerableEndTime) {
            this.invulnerable = false;
        }

        // Check if shield should expire
        if (this.hasShield && performance.now() > this.shieldEndTime) {
            this.hasShield = false;
        }

        // Movement Physics
        let dx = 0;
        let dy = 0;
        const maxSpeed = 5.5;

        if (this.touchActive) {
            // Touch control: ease the ship toward the finger position.
            // Using a lerp instead of the keyboard's accel/friction model
            // keeps tracking tight and responsive, the way players expect
            // a "follow my finger" shooter to feel.
            const followLerp = 0.28;
            const prevX = this.x;
            const prevY = this.y;
            this.x += (this.touchTargetX - this.x) * followLerp;
            this.y += (this.touchTargetY - this.y) * followLerp;
            // Derive a pseudo-velocity so the existing tilt/trail effects
            // (which read this.vx/this.vy) still work under touch control.
            this.vx = this.x - prevX;
            this.vy = this.y - prevY;
        } else {
            if (keys[this.controls.up]) dy -= 1;
            if (keys[this.controls.down]) dy += 1;
            if (keys[this.controls.left]) dx -= 1;
            if (keys[this.controls.right]) dx += 1;

            // Normalize Input
            if (dx !== 0 || dy !== 0) {
                const length = Math.sqrt(dx * dx + dy * dy);
                dx /= length;
                dy /= length;

                this.vx += dx * this.acceleration;
                this.vy += dy * this.acceleration;
            }

            // Apply Friction
            this.vx *= this.friction;
            this.vy *= this.friction;

            // Clamp Speed
            const currentSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
            if (currentSpeed > maxSpeed) {
                this.vx = (this.vx / currentSpeed) * maxSpeed;
                this.vy = (this.vy / currentSpeed) * maxSpeed;
            }

            // Apply Velocity
            this.x += this.vx;
            this.y += this.vy;
        }

        // Calculate Tilt logic
        const targetTilt = (this.vx / maxSpeed) * this.maxTilt;
        this.rotation = this.rotation * 0.9 + targetTilt * 0.1; // Smooth interpolation

        // Boundary Checks
        if (this.x < this.width / 2) {
            this.x = this.width / 2;
            this.vx = 0; // consistent bounce/stop
        }
        if (this.x > canvas.width - this.width / 2) {
            this.x = canvas.width - this.width / 2;
            this.vx = 0;
        }
        if (this.y < this.height / 2) {
            this.y = this.height / 2;
            this.vy = 0;
        }
        if (this.y > canvas.height - this.height / 2) {
            this.y = canvas.height - this.height / 2;
            this.vy = 0;
        }

        // Update trail
        this.trail.push({ x: this.x, y: this.y + this.height / 2 });
        if (this.trail.length > 15) {
            this.trail.shift();
        }

        // Shooting (keyboard shoot key OR finger held down on screen)
        if (keys[this.controls.shoot] || this.touchActive) {
            const now = performance.now();
            if (now - this.lastShot > this.shootDelay) {
                // Main bullet
                this.bullets.push({
                    x: this.x,
                    y: this.y - this.height / 2 - 7.5, // Center of bullet (height 15)
                    width: 4,
                    height: 15,
                    speed: 7,
                    color: this.color
                });

                // Side shooter bullets
                if (this.hasSideShooters) {
                    // Left side shooter
                    this.bullets.push({
                        x: this.x - 65,
                        y: this.y + 20 - this.height / 2 - 7.5, // Center of bullet (height 15)
                        width: 4,
                        height: 15,
                        speed: 7,
                        color: this.color
                    });
                    // Right side shooter
                    this.bullets.push({
                        x: this.x + 65,
                        y: this.y + 20 - this.height / 2 - 7.5, // Center of bullet (height 15)
                        width: 4,
                        height: 15,
                        speed: 7,
                        color: this.color
                    });
                    createMuzzleFlash(this.x - 65, this.y + 20, this.color);
                    createMuzzleFlash(this.x + 65, this.y + 20, this.color);
                }

                this.lastShot = now;

                // Add muzzle flash explosion effect
                createMuzzleFlash(this.x, this.y - this.height / 2, this.color);
            }
        }

        // Update Bullets
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.y -= b.speed;
            if (b.y < -50) this.bullets.splice(i, 1);
        }
    }

    draw(ctx) {
        if (!this.isAlive) return;

        // Draw Trail (disabled)
        if (false && this.trail.length > 1 && this.shape !== 'vintage') {
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.shadowBlur = 10;
            ctx.shadowColor = this.color;
            ctx.strokeStyle = this.color;

            for (let i = 0; i < this.trail.length - 1; i++) {
                const p1 = this.trail[i];
                const p2 = this.trail[i + 1];
                const progress = i / this.trail.length;

                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.globalAlpha = Math.max(0, progress * 0.6);
                ctx.lineWidth = this.width * 0.4 * progress;
                ctx.stroke();
            }
            ctx.restore();
        }

        // Draw shield if active
        if (this.hasShield) {
            ctx.save();
            ctx.strokeStyle = '#0af';
            ctx.lineWidth = 3;
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#0af';
            ctx.globalAlpha = 0.6 + Math.sin(performance.now() / 200) * 0.2; // Pulsing effect
            ctx.beginPath();
            ctx.arc(this.x, this.y, 50, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.lineWidth = 2;
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;

        drawPlayerShape(ctx, this.shape, this.color);

        ctx.restore();

        if (this.hasSideShooters) {
            // Left side shooter
            ctx.save();
            ctx.translate(this.x - 65, this.y + 20);
            ctx.scale(0.6, 0.6);
            drawPlayerShape(ctx, this.shape, this.color, this.secondaryColor);
            ctx.restore();

            // Right side shooter
            ctx.save();
            ctx.translate(this.x + 65, this.y + 20);
            ctx.scale(0.6, 0.6);
            drawPlayerShape(ctx, this.shape, this.color);
            ctx.restore();
        }

        // Draw Bullets
        ctx.shadowBlur = 10;
        for (const b of this.bullets) {
            ctx.fillStyle = b.color;
            ctx.shadowColor = b.color;
            ctx.fillRect(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);
        }
    }

    reset(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.rotation = 0;
        this.bullets = [];
        this.trail = [];
        this.isAlive = true;
        this.hasSideShooters = false;
        this.sideShooterEndTime = 0;
        this.lives = 3;
        this.invulnerable = false;
        this.invulnerableEndTime = 0;
        this.kills = 0;
        this.hasShield = false;
        this.shieldEndTime = 0;
        this.touchActive = false;
        this.touchId = null;
        this.touchTargetX = x;
        this.touchTargetY = y;
        // state persists across resets
    }

    activateSideShooters() {
        this.hasSideShooters = true;
        this.sideShooterEndTime = performance.now() + 10000; // 10 seconds
    }

    activateShield() {
        this.hasShield = true;
        this.shieldEndTime = performance.now() + 10000; // 10 seconds
    }

    addLife() {
        if (this.lives < this.maxLives) {
            this.lives++;
            updateLivesDisplay();
        }
    }

    loseLife() {
        this.lives--;
        updateLivesDisplay();
        if (this.lives <= 0) {
            this.isAlive = false;
        } else {
            // Grant temporary invulnerability
            this.invulnerable = true;
            this.invulnerableEndTime = performance.now() + 2000; // 2 seconds
        }
    }
}

let players = [];
let enemies = [];
let particles = [];
let powerUps = [];
let stars = [];
let planets = [];
let enemySpawnTimer = 0;
let enemySpawnInterval = 1600;
let enemiesKilled = 0;
let nextSideShooterAt = 30;
let nextLifeAt = 50;
let nextShieldAt = 20;
let nextBossAt = 100;

// UI Elements
let p1HealthSegments;
let p1KillsEl;
let p1ShieldWrapper, p1ShieldBar;
let p1ShooterWrapper, p1ShooterBar;
let p1LevelEl, p1HpDots;

let p2HealthSegments;
let p2KillsEl;
let p2ShieldWrapper, p2ShieldBar;
let p2ShooterWrapper, p2ShooterBar;
let p2LevelEl, p2HpDots;

let startScreen;
let gameOverScreen;
let pauseScreen;
let pauseBtn;
let livesBoard;
let p2Hud;
let shipPreviewCanvases = {};
// Initialize Players
function initPlayers() {
    players = [
        new Player(canvas.width / 3, canvas.height - 100, '#5D9CEC', {
            up: 'w', down: 's', left: 'a', right: 'd', shoot: ' '
        }, 1),
        new Player(2 * canvas.width / 3, canvas.height - 100, '#ED5565', {
            up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', shoot: 'Enter'
        }, 2)
    ];
}

function initStars() {
    stars = [];
    if (!canvas) return;
    for (let i = 0; i < 150; i++) {
        stars.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 2 + 0.5,
            speed: Math.random() * 3 + 1,
            alpha: Math.random() * 0.5 + 0.3
        });
    }
}

function initPlanets() {
    planets = [];
    if (!canvas) return;
    for (let i = 0; i < 3; i++) {
        let hue = Math.floor(Math.random() * 360);
        planets.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 80 + 40,
            hue: hue,
            color: `hsl(${hue}, 50%, 20%)`,
            speed: Math.random() * 0.3 + 0.8,
            ring: Math.random() > 0.5,
            ringAngle: Math.random() * Math.PI,
        });
    }
}

function drawShipPreview(playerId) {
    const previewCanvas = shipPreviewCanvases[playerId];
    const player = players.find(p => p.id === playerId);
    if (!previewCanvas || !player) return;

    const previewCtx = previewCanvas.getContext('2d');
    const w = previewCanvas.width;
    const h = previewCanvas.height;

    previewCtx.clearRect(0, 0, w, h);
    previewCtx.save();
    previewCtx.fillStyle = 'rgba(5, 5, 10, 0.82)';
    previewCtx.fillRect(0, 0, w, h);

    previewCtx.strokeStyle = 'rgba(255, 106, 0, 0.14)';
    previewCtx.lineWidth = 1;
    for (let x = 20; x < w; x += 20) {
        previewCtx.beginPath();
        previewCtx.moveTo(x, 0);
        previewCtx.lineTo(x, h);
        previewCtx.stroke();
    }
    for (let y = 20; y < h; y += 20) {
        previewCtx.beginPath();
        previewCtx.moveTo(0, y);
        previewCtx.lineTo(w, y);
        previewCtx.stroke();
    }

    previewCtx.translate(w / 2, h / 2 + 10);
    previewCtx.scale(1.35, 1.35);
    drawPlayerShape(previewCtx, player.shape, player.color);
    previewCtx.restore();
}

function updateShipPreviews() {
    players.forEach(player => drawShipPreview(player.id));
}

// Game Initialization
function initGame() {
    try {
        console.log("Initializing Game...");

        canvas = document.getElementById('gameCanvas');
        if (!canvas) throw new Error("Canvas element not found!");
        ctx = canvas.getContext('2d');

        p1HealthSegments = document.getElementById('p1-health-segments');
        p1KillsEl = document.getElementById('p1-kills');
        p1ShieldWrapper = document.getElementById('p1-shield-wrapper');
        p1ShieldBar = document.getElementById('p1-shield-bar');
        p1ShooterWrapper = document.getElementById('p1-shooter-wrapper');
        p1ShooterBar = document.getElementById('p1-shooter-bar');
        p1LevelEl = document.getElementById('p1-level');
        p1HpDots = document.querySelector('#p1-hud .cyber-hp-dots');

        p2HealthSegments = document.getElementById('p2-health-segments');
        p2KillsEl = document.getElementById('p2-kills');
        p2ShieldWrapper = document.getElementById('p2-shield-wrapper');
        p2ShieldBar = document.getElementById('p2-shield-bar');
        p2ShooterWrapper = document.getElementById('p2-shooter-wrapper');
        p2ShooterBar = document.getElementById('p2-shooter-bar');
        p2LevelEl = document.getElementById('p2-level');
        p2HpDots = document.querySelector('#p2-hud .cyber-hp-dots');

        startScreen = document.getElementById('start-screen');
        gameOverScreen = document.getElementById('game-over-screen');
        pauseScreen = document.getElementById('pause-screen');
        pauseBtn = document.getElementById('pause-btn');
        livesBoard = document.getElementById('lives-board');
        p2Hud = document.getElementById('p2-hud');
        shipPreviewCanvases = {
            1: document.getElementById('p1-ship-preview'),
            2: document.getElementById('p2-ship-preview')
        };

        const resumeBtn = document.getElementById('resume-btn');
        const quitBtn = document.getElementById('quit-btn');

        // Resize Canvas
        function resize() {
            const w = window.innerWidth;
            const h = window.innerHeight;

            // On phones, render at a larger internal resolution than the
            // screen actually is, then let CSS scale it back down to fit.
            // This effectively "zooms out", giving a bigger play area to
            // move around in instead of feeling cramped on a small screen.
            // Touch input already converts back via toCanvasCoords().
            const isMobile = w <= 700;
            const playAreaScale = isMobile ? 1.4 : 1;

            canvas.width = w * playAreaScale;
            canvas.height = h * playAreaScale;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';

            if (!isPlaying && players.length > 0) {
                if (playerMode === 1) {
                    players[0].x = canvas.width / 2;
                    players[0].y = canvas.height - 100;
                } else {
                    players[0].x = canvas.width / 3;
                    players[0].y = canvas.height - 100;
                    if (players[1]) {
                        players[1].x = 2 * canvas.width / 3;
                        players[1].y = canvas.height - 100;
                    }
                }
            }
        }
        window.addEventListener('resize', resize);
        resize();

        initStars();
        initPlanets();
        initPlayers(); // Init once to set up objects
        console.log("Players initialized");

        // Input Listeners
        window.addEventListener('keydown', (e) => {
            // Prevent default behavior to stop accidental button clicks or page scrolling with game controls
            if (['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || e.code === 'Space') {
                e.preventDefault();
            }

            keys[e.key] = true;
            // Handle case-insensitive WASD
            if (e.key.length === 1) keys[e.key.toLowerCase()] = true;

            if (e.code === 'Space' || e.key === ' ') keys[' '] = true;
            if (e.code === 'Enter') keys['Enter'] = true;

            if (e.code === 'Space' && !isPlaying && !isGameOver && startScreen && startScreen.classList.contains('active')) {
                startGame();
            }


            // Pause toggle
            if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
                if (isPlaying && !isGameOver) {
                    togglePause();
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            keys[e.key] = false;
            if (e.key.length === 1) keys[e.key.toLowerCase()] = false;
            if (e.code === 'Space' || e.key === ' ') keys[' '] = false;
            if (e.code === 'Enter') keys['Enter'] = false;
        });

        // ─── Touch Controls (mobile) ──────────────────────────────
        // While playing: holding a finger down moves that player's ship
        // toward the finger and fires continuously. In 2-player mode the
        // canvas is split into a left half (Player 1) and right half
        // (Player 2) so two fingers can control both ships independently.
        function toCanvasCoords(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        }

        function pickPlayerForTouch(canvasX) {
            if (playerMode === 1) return players[0];
            return canvasX < canvas.width / 2 ? players[0] : players[1];
        }

        function handleTouchStart(e) {
            if (!isPlaying || isPaused || isGameOver) return;
            for (const touch of Array.from(e.changedTouches)) {
                // Let real UI buttons (pause, etc.) keep working normally.
                if (touch.target && touch.target.closest && touch.target.closest('button')) continue;

                const pos = toCanvasCoords(touch.clientX, touch.clientY);
                const player = pickPlayerForTouch(pos.x);
                if (!player || !player.isAlive || player.touchId !== null) continue;

                player.touchId = touch.identifier;
                player.touchActive = true;
                player.touchTargetX = pos.x;
                player.touchTargetY = pos.y;
                e.preventDefault();
            }
        }

        function handleTouchMove(e) {
            if (!isPlaying || isPaused || isGameOver) return;
            for (const touch of Array.from(e.changedTouches)) {
                const player = players.find(p => p.touchId === touch.identifier);
                if (!player) continue;
                const pos = toCanvasCoords(touch.clientX, touch.clientY);
                player.touchTargetX = pos.x;
                player.touchTargetY = pos.y;
                e.preventDefault();
            }
        }

        function handleTouchEnd(e) {
            for (const touch of Array.from(e.changedTouches)) {
                const player = players.find(p => p.touchId === touch.identifier);
                if (!player) continue;
                player.touchActive = false;
                player.touchId = null;
            }
        }

        window.addEventListener('touchstart', handleTouchStart, { passive: false });
        window.addEventListener('touchmove', handleTouchMove, { passive: false });
        window.addEventListener('touchend', handleTouchEnd, { passive: false });
        window.addEventListener('touchcancel', handleTouchEnd, { passive: false });

        // Customization Logic
        function updateColorUI() {
            // Reset all selected & disabled classes first
            document.querySelectorAll('.color-select').forEach(b => {
                b.classList.remove('selected', 'disabled');
                b.style.opacity = '1';
                b.style.cursor = 'pointer';
            });

            // Mark current choices as selected
            document.querySelector(`.color-select[data-player="1"][data-color="${players[0].color}"]`)?.classList.add('selected');
            if (playerMode === 2) {
                document.querySelector(`.color-select[data-player="2"][data-color="${players[1].color}"]`)?.classList.add('selected');

                // Mark Player 2's chosen color as disabled on Player 1's side
                const p1TakenBtn = document.querySelector(`.color-select[data-player="1"][data-color="${players[1].color}"]`);
                if (p1TakenBtn) {
                    p1TakenBtn.classList.add('disabled');
                    p1TakenBtn.style.opacity = '0.22';
                    p1TakenBtn.style.cursor = 'not-allowed';
                }

                // Mark Player 1's chosen color as disabled on Player 2's side
                const p2TakenBtn = document.querySelector(`.color-select[data-player="2"][data-color="${players[0].color}"]`);
                if (p2TakenBtn) {
                    p2TakenBtn.classList.add('disabled');
                    p2TakenBtn.style.opacity = '0.22';
                    p2TakenBtn.style.cursor = 'not-allowed';
                }
            }
        }

        document.querySelectorAll('.color-select').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const color = e.target.dataset.color;
                const playerId = parseInt(e.target.dataset.player);
                const player = players.find(p => p.id === playerId);
                if (!player) return;

                // Prevent both players from having the same color in 2-player mode (ignore selection)
                if (playerMode === 2) {
                    const otherPlayerId = playerId === 1 ? 2 : 1;
                    const otherPlayer = players.find(p => p.id === otherPlayerId);
                    if (otherPlayer && otherPlayer.color === color) {
                        return; // Ignore selection
                    }
                }

                player.color = color;
                updateColorUI();
                drawShipPreview(playerId);
            });
        });



        document.querySelectorAll('.shape-select').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const shape = e.target.dataset.shape;
                const playerId = parseInt(e.target.dataset.player);

                // Update specific player
                const player = players.find(p => p.id === playerId);
                if (player) {
                    player.shape = shape;
                }

                // Update UI for this player's shape buttons
                document.querySelectorAll(`.shape-select[data-player="${playerId}"]`).forEach(b => b.classList.remove('selected'));
                e.target.classList.add('selected');
                drawShipPreview(playerId);
            });
        });

        // Start/Restart Buttons
        const startBtn = document.getElementById('start-btn');
        if (startBtn) startBtn.addEventListener('click', startGame);

        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) restartBtn.addEventListener('click', resetGame);

        const homeBtn = document.getElementById('home-btn');
        if (homeBtn) homeBtn.addEventListener('click', goHome);

        if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
        if (resumeBtn) resumeBtn.addEventListener('click', togglePause);
        if (quitBtn) quitBtn.addEventListener('click', goHome);

        // Mode Selector Logic
        function setPlayerMode(mode) {
            playerMode = mode;
            document.querySelectorAll('.mode-option').forEach(opt => opt.classList.remove('selected'));

            const selectedOpt = document.getElementById(`mode-${mode}p`);
            if (selectedOpt) selectedOpt.classList.add('selected');

            const p2Panel = document.querySelector('.p2-panel');
            if (playerMode === 1) {
                if (p2Panel) p2Panel.classList.add('inactive');
            } else {
                if (p2Panel) p2Panel.classList.remove('inactive');
            }
            updateColorUI(); // Update taken colors when mode changes
        }

        document.querySelectorAll('.mode-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const opt = e.currentTarget;
                const mode = parseInt(opt.dataset.mode);
                setPlayerMode(mode);
            });
        });

        // Initialize mode
        setPlayerMode(playerMode);

        // Initialize selection UI
        updateColorUI();
        players.forEach(p => {
            document.querySelector(`.shape-select[data-player="${p.id}"][data-shape="${p.shape}"]`)?.classList.add('selected');
        });
        updateShipPreviews();



        console.log("Game initialized successfully");

        // Start game loop immediately for background effects
        lastTime = performance.now();
        if (gameLoopId) cancelAnimationFrame(gameLoopId);
        gameLoopId = requestAnimationFrame(gameLoop);
    } catch (err) {
        console.error("Game Initialization Error:", err);
        alert("Game Init Error: " + err.message);
    }
}

// Wait for DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initGame();
        // Animate Start Screen on load
        if (startScreen && typeof anime !== 'undefined') {
            animateScreenIn(startScreen);
            animateBlackHole();
        }
    });
} else {
    initGame();
    // Animate Start Screen on load if already ready
    if (startScreen && typeof anime !== 'undefined') {
        animateScreenIn(startScreen);
        animateBlackHole();
    }
}

function startGame() {
    try {
        if (!canvas) throw new Error("Canvas not initialized");

        clearTimeout(gameOverTimeout);
        isPlaying = true;
        isGameOver = false;
        isPaused = false;
        if (startScreen) {
            startScreen.classList.remove('active');
            startScreen.classList.add('hidden');
            if (gameOverScreen) gameOverScreen.classList.add('hidden');

            // Reset entities
            if (playerMode === 1) {
                players[0].reset(canvas.width / 2, canvas.height - 100);
                players[1].reset(2 * canvas.width / 3, canvas.height - 100);
                players[1].isAlive = false;
                players[1].lives = 0;

                if (p2Hud) p2Hud.classList.add('hidden');
            } else {
                players[0].reset(canvas.width / 3, canvas.height - 100);
                players[1].reset(2 * canvas.width / 3, canvas.height - 100);

                if (p2Hud) p2Hud.classList.remove('hidden');
            }
            updateLivesDisplay();
            updateKillsDisplay();

            enemies = [];
            particles = [];
            powerUps = [];
            enemiesKilled = 0;
            nextSideShooterAt = 30;
            nextLifeAt = 50;
            nextShieldAt = 20;
            nextBossAt = 100;
            enemySpawnInterval = 1600;

            if (pauseBtn) pauseBtn.classList.remove('hidden');
            if (livesBoard) livesBoard.classList.remove('hidden');

            lastTime = performance.now();
            if (gameLoopId) cancelAnimationFrame(gameLoopId);
            gameLoopId = requestAnimationFrame(gameLoop);
        }
    } catch (e) {
        console.error("Error starting game:", e);
        alert("Error starting game: " + e.message);
    }
}

function resetGame() {
    gameOverScreen.classList.remove('active');
    gameOverScreen.classList.add('hidden');
    if (pauseScreen) {
        pauseScreen.classList.remove('active');
        pauseScreen.classList.add('hidden');
    }
    startGame();
}

function goHome() {
    clearTimeout(gameOverTimeout);
    gameOverScreen.classList.remove('active');
    gameOverScreen.classList.add('hidden');

    startScreen.classList.remove('hidden');
    startScreen.classList.add('active');

    // Animate the start screen elements
    animateScreenIn(startScreen);

    // Hide other screens just in case
    if (pauseScreen) {
        pauseScreen.classList.remove('active');
        pauseScreen.classList.add('hidden');
    }

    isPlaying = false;
    isGameOver = false;
    isPaused = false;
    if (pauseBtn) pauseBtn.classList.add('hidden');
    if (livesBoard) livesBoard.classList.add('hidden');
}

function gameOver() {
    if (isGameOver) return;
    isPlaying = false;
    isGameOver = true;
    // Don't cancel animation frame - let particles continue animating

    // Wait 3 seconds before showing game over screen
    clearTimeout(gameOverTimeout);
    gameOverTimeout = setTimeout(() => {
        gameOverScreen.classList.remove('hidden');
        gameOverScreen.classList.add('active');
        animateScreenIn(gameOverScreen); // Animate Game Over Screen

        if (pauseBtn) pauseBtn.classList.add('hidden');
        // Stop the game loop after showing the screen
        cancelAnimationFrame(gameLoopId);
        isGameOver = false;
    }, 1000);

}

function togglePause() {
    isPaused = !isPaused;
    if (isPaused) {
        pauseScreen.classList.remove('hidden');
        pauseScreen.classList.add('active');
        animateScreenIn(pauseScreen); // Animate Pause Screen
    } else {
        pauseScreen.classList.remove('active');
        pauseScreen.classList.add('hidden');
    }
}

function update(deltaTime) {
    if (isNaN(deltaTime)) deltaTime = 0;
    // Always update Stars and Planets for background movement
    stars.forEach(s => {
        s.y += s.speed * 0.5; // Slower speed in menu/background
        if (s.y > (canvas ? canvas.height : window.innerHeight)) {
            s.y = 0;
            s.x = Math.random() * (canvas ? canvas.width : window.innerWidth);
        }
    });
    planets.forEach(p => {
        p.y += p.speed * 0.5;
        if (p.y > (canvas ? canvas.height : window.innerHeight) + p.size * 2) {
            p.y = -p.size * 2;
            p.x = Math.random() * (canvas ? canvas.width : window.innerWidth);
            let hue = Math.floor(Math.random() * 360);
            p.hue = hue;
            p.color = `hsl(${hue}, 50%, 20%)`;
            p.size = Math.random() * 80 + 40;
            p.speed = Math.random() * 0.3 + 0.8;
            p.ring = Math.random() > 0.5;
            p.ringAngle = Math.random() * Math.PI;
        }
    });

    // Update Particles (always update, even during game over)
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) particles.splice(i, 1);
    }

    if (!isPlaying || isPaused) return;

    // Update Players
    let aliveCount = 0;
    players.forEach(p => {
        p.update(deltaTime);
        if (p.isAlive) aliveCount++;
    });

    if (aliveCount === 0) {
        gameOver();
        return;
    }

    // Spawn Enemies (Only if no Boss is active)
    enemySpawnTimer += deltaTime;
    if (enemySpawnTimer > enemySpawnInterval) {
        const isBossActive = enemies.some(e => e.isBoss);
        if (enemies.length < MAX_ENEMIES && !isBossActive) {
            spawnEnemy();
        }
        enemySpawnTimer = 0;
        if (enemySpawnInterval > 900) enemySpawnInterval -= 5;
    }

    // Update Enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
        // Check for Boss Spawn
        if (enemiesKilled >= nextBossAt && enemies.filter(e => e.isBoss).length === 0) {
            spawnBoss();
            nextBossAt += 100;
        }

        const e = enemies[i];

        // Boss Movement Logic
        if (e.isBoss) {
            if (e.y < 100) {
                e.y += e.speed; // Enter
            } else {
                // Smooth Sine Wave Movement
                const time = performance.now() / 1000; // Time in seconds

                // Horizontal Movement: Wide sweep
                e.x = (canvas.width / 2) + Math.sin(time) * (canvas.width / 3);

                // Vertical Hover: Gentle bobbing
                e.y = 100 + Math.sin(time * 2) * 20;

                // Ensure it stays within bounds (safety)
                e.x = Math.max(e.width / 2, Math.min(canvas.width - e.width / 2, e.x));
            }
        } else {
            e.y += e.speed;
        }

        // Collision with Players
        players.forEach(p => {
            if (p.isAlive && !p.invulnerable && checkCollision(p, e)) {
                if (e.isBoss) {
                    // Boss collision rules (Boss handles damage, player takes damage)
                    if (p.hasShield) {
                        p.hasShield = false;
                        createExplosion(p.x, p.y, '#0af', 25);
                    } else {
                        p.loseLife();
                        createExplosion(p.x, p.y, p.color, 30);
                    }
                    // Boss takes a bit of damage from collision? 
                    // Let's say ramming boss does 5 damage
                    e.health -= 5;
                    createExplosion(e.x + (Math.random() - 0.5) * e.width, e.y + e.height / 2, e.color, 10);

                    if (e.health <= 0) {
                        createExplosion(e.x, e.y, e.color, 100); // Big explosion
                        e.markedForDeletion = true;
                        enemiesKilled++; // Boss counts as kill
                        // Maybe huge score/powerup?
                        spawnPowerUp('life');
                        spawnPowerUp('shield');
                        spawnPowerUp('sideshooter');
                    }
                } else {
                    // Normal Enemy Collision
                    if (p.hasShield) {
                        // Shield absorbs the hit
                        p.hasShield = false;
                        createExplosion(p.x, p.y, '#0af', 25);
                        createExplosion(e.x, e.y, e.color, 15);
                        e.health = 0;
                        e.markedForDeletion = true;
                    } else {
                        createExplosion(p.x, p.y, p.color, 30);
                        p.loseLife();
                        createExplosion(e.x, e.y, e.color, 15);
                        e.health = 0;
                        e.markedForDeletion = true;
                    }
                }
            }
        });


        if (e.markedForDeletion) {
            if (typeof anime !== 'undefined') anime.remove(e);
            enemies.splice(i, 1);
            continue;
        }

        // Collision with Bullets
        for (const p of players) {
            if (!p.isAlive) continue;
            for (let j = p.bullets.length - 1; j >= 0; j--) {
                const b = p.bullets[j];
                if (checkCollision(b, e)) {
                    // Hit effect
                    createExplosion(b.x, b.y, e.color, 5);
                    p.bullets.splice(j, 1);

                    e.health--;

                    if (e.health <= 0) {
                        createExplosion(e.x, e.y, e.color, 20);
                        if (typeof anime !== 'undefined') anime.remove(e); // Cleanup animation
                        enemies.splice(i, 1);
                        enemiesKilled++;
                        p.kills++;
                        updateKillsDisplay();

                        // Spawn side shooter power-up every 30 enemies
                        if (enemiesKilled >= nextSideShooterAt) {
                            spawnPowerUp('sideshooter');
                            nextSideShooterAt += 30;
                        }

                        // Spawn life power-up every 100 enemies
                        if (enemiesKilled >= nextLifeAt) {
                            spawnPowerUp('life');
                            nextLifeAt += 100;
                        }

                        // Spawn shield power-up every 20 enemies
                        if (enemiesKilled >= nextShieldAt) {
                            spawnPowerUp('shield');
                            nextShieldAt += 20;
                        }
                        break; // Enemy dead
                    }
                }
            }
            if (enemies[i] !== e) break; // Enemy was removed
        }

        if (e.y > canvas.height + 50) {
            if (typeof anime !== 'undefined') anime.remove(e);
            enemies.splice(i, 1);
            continue;
        }

        // Enemy (Shooter) Logic
        if (e.isShooter && isPlaying) {
            const now = performance.now();
            if (now - e.lastShot > e.shootDelay) {
                e.lastShot = now;
                // Enemies fire faster as game progresses
                e.shootDelay = Math.max(1000, 2000 - (enemiesKilled * 2));

                e.bullets.push({
                    x: e.x,
                    y: e.y + e.height / 2 + 7.5, // Center of bullet
                    width: 6,
                    height: 15,
                    speed: 6,
                    color: '#ff8800'
                });
                createMuzzleFlash(e.x, e.y + e.height / 2, '#ff8800');
            }
            updateEnemyBullets(e);
        }

        // Boss Shooting Logic: 10 Spreading Shots every 3 seconds (shootDelay = 3000)
        if (e.isBoss && isPlaying) {
            const now = performance.now();
            if (now - e.lastShot > e.shootDelay) {
                e.lastShot = now;

                const baseSpeed = 5.5;
                const angles = Array.from({ length: 10 }, (_, i) => -0.5 + i * (1.0 / 9)); // 10 angles from -0.5 to +0.5 rad

                angles.forEach(angle => {
                    e.bullets.push({
                        x: e.x,
                        y: e.y + e.height / 2 + 10,
                        width: 8,
                        height: 20,
                        vx: baseSpeed * Math.sin(angle),
                        vy: baseSpeed * Math.cos(angle),
                        speed: baseSpeed,
                        color: '#ff0000'
                    });
                });
                createMuzzleFlash(e.x, e.y + e.height / 2, '#ff0000');
            }
            updateEnemyBullets(e);
        }
    }
    // Update Power-ups
    for (let i = powerUps.length - 1; i >= 0; i--) {
        const pu = powerUps[i];
        pu.y += pu.speed;
        pu.rotation += 0.05;

        // Collision with Players
        for (const p of players) {
            if (p.isAlive && checkCollision(p, pu)) {
                if (pu.type === 'sideshooter') {
                    p.activateSideShooters();
                } else if (pu.type === 'life') {
                    p.addLife();
                } else if (pu.type === 'shield') {
                    p.activateShield();
                }
                createExplosion(pu.x, pu.y, pu.color, 20);
                if (typeof anime !== 'undefined') anime.remove(pu);
                powerUps.splice(i, 1);
                break;
            }
        }

        if (pu.y > canvas.height + 50) {
            if (typeof anime !== 'undefined') anime.remove(pu);
            powerUps.splice(i, 1);
        }
    }
}

function updateEnemyBullets(e) {
    for (let bIndex = e.bullets.length - 1; bIndex >= 0; bIndex--) {
        const bullet = e.bullets[bIndex];
        if (bullet.vx !== undefined) {
            bullet.x += bullet.vx;
        }
        if (bullet.vy !== undefined) {
            bullet.y += bullet.vy;
        } else {
            bullet.y += bullet.speed;
        }

        // Check collision with players
        players.forEach(p => {
            if (p.isAlive && !p.invulnerable && checkCollision(bullet, p)) {
                createExplosion(bullet.x, bullet.y, bullet.color, 10);

                if (p.hasShield) {
                    p.hasShield = false;
                    createExplosion(p.x, p.y, '#0af', 15);
                } else {
                    p.loseLife();
                    createExplosion(p.x, p.y, p.color, 20);
                }
                e.bullets.splice(bIndex, 1);
            }
        });

        // Remove off-screen bullets (check bounds for spreading angles)
        if (bullet.y > ((canvas && canvas.height) || window.innerHeight) + 50 ||
            bullet.x < -50 || (canvas && bullet.x > canvas.width + 50)) {
            e.bullets.splice(bIndex, 1);
        }
    }
}


function draw() {
    // Clear the canvas first
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Stars and Planets (background)
    // Draw Planets
    planets.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        // Draw main body
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        // Atmospheric shading
        let gradient = ctx.createRadialGradient(-p.size * 0.3, -p.size * 0.3, p.size * 0.1, 0, 0, p.size);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
        ctx.fillStyle = gradient;
        ctx.fill();

        // Ring
        if (p.ring) {
            ctx.rotate(p.ringAngle);
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size * 2.2, p.size * 0.4, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `hsla(${p.hue}, 20%, 50%, 0.4)`;
            ctx.lineWidth = p.size * 0.15;
            ctx.stroke();
        }
        ctx.restore();
    });

    // Draw Stars
    ctx.fillStyle = '#fcf069ff';
    stars.forEach(s => {
        ctx.globalAlpha = s.alpha;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    if (!isPlaying && !isGameOver) {
        // Subtle overlay during menu
        ctx.fillStyle = 'rgba(5, 5, 10, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }



    // Draw Particles
    for (const p of particles) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = p.color;

        if (p.type === 'shockwave') {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, p.size, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.globalAlpha = p.life;
            ctx.beginPath();
            ctx.arc(0, 0, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // Draw Power-ups
    if (isPlaying || isGameOver) {
        for (const pu of powerUps) {
            ctx.save();
            ctx.translate(pu.x, pu.y);
            ctx.rotate(pu.rotation);

            // Apply Anime.js scale
            if (pu.scale !== undefined) {
                ctx.scale(pu.scale, pu.scale);
            }

            ctx.fillStyle = pu.color;
            ctx.shadowBlur = 10;
            ctx.shadowColor = pu.color;

            // Draw Power-up (Orb design)
            // Outer Ring
            ctx.beginPath();
            ctx.arc(0, 0, 15, 0, Math.PI * 2);
            ctx.strokeStyle = pu.color;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Inner Pulsing Core
            const pulse = 1 + Math.sin(performance.now() / 150) * 0.2;
            ctx.beginPath();
            ctx.arc(0, 0, 8 * pulse, 0, Math.PI * 2);
            ctx.fillStyle = pu.color;
            ctx.fill();

            // Symbol
            ctx.fillStyle = '#fff'; // Contrast color
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            let symbol = '?';
            if (pu.type === 'sideshooter') symbol = '⚡';
            if (pu.type === 'life') symbol = '❤️';
            if (pu.type === 'shield') symbol = '🛡️';
            ctx.fillText(symbol, 0, 1);

            ctx.restore();
        }
    }

    // Draw Players
    if (isPlaying || isGameOver) {
        players.forEach(p => p.draw(ctx));
    }

    // Draw Enemies
    if (isPlaying || isGameOver) {
        for (const e of enemies) {
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.fillStyle = e.color;
            ctx.shadowBlur = 10;
            ctx.shadowColor = e.color;

            // Apply Animation Transforms
            if (e.scale) ctx.scale(e.scale, e.scale);
            if (e.rotation) ctx.rotate(e.rotation);

            // Draw Enemy Shape (Alien Ship)
            ctx.beginPath();
            if (e.isBoss) {
                // Cyber Dragon Mech Boss (Based on User's Winged Mech Sketch)
                const w = e.width;
                const h = e.height;

                // Helper for filled polygons
                const poly = (pts, fillColor, strokeColor, strokeWidth = 1) => {
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) {
                        ctx.lineTo(pts[i].x, pts[i].y);
                    }
                    ctx.closePath();
                    if (fillColor) {
                        ctx.fillStyle = fillColor;
                        ctx.fill();
                    }
                    if (strokeColor) {
                        ctx.strokeStyle = strokeColor;
                        ctx.lineWidth = strokeWidth;
                        ctx.stroke();
                    }
                };

                // Helper for lines
                const line = (pts, strokeColor, lineWidth = 1.5) => {
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) {
                        ctx.lineTo(pts[i].x, pts[i].y);
                    }
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = lineWidth;
                    ctx.stroke();
                };

                // Styles
                const bossColor = e.color || '#ff0000'; // Neon red
                const darkMetal = '#0e0f12';
                const midMetal = '#1f232b';
                const lightMetal = '#39404f';
                const panelLineColor = 'rgba(255, 255, 255, 0.18)';
                const glowGlow = (glowColor, blur = 15) => {
                    ctx.shadowBlur = blur;
                    ctx.shadowColor = glowColor;
                };

                // 1. Ribbed Shoulder Engines (Background details)
                // Left & Right ribbed intakes
                for (let side of [-1, 1]) {
                    // Engine Block background
                    poly([
                        { x: side * w * 0.05, y: -h * 0.1 },
                        { x: side * w * 0.22, y: -h * 0.12 },
                        { x: side * w * 0.22, y: -h * 0.28 },
                        { x: side * w * 0.05, y: -h * 0.25 }
                    ], darkMetal, bossColor, 1);

                    // Draw Ribs
                    ctx.save();
                    glowGlow(bossColor, 5);
                    for (let i = 0; i < 5; i++) {
                        const ry = -h * 0.13 - i * h * 0.03;
                        line([
                            { x: side * w * 0.07, y: ry },
                            { x: side * w * 0.20, y: ry - h * 0.01 }
                        ], bossColor, 2);
                    }
                    ctx.restore();
                }

                // 2. Central Tail / Vertical Stabilizer (Behind body)
                // Main stabilizer pointing up
                poly([
                    { x: -w * 0.03, y: -h * 0.1 },
                    { x: w * 0.03, y: -h * 0.1 },
                    { x: w * 0.015, y: -h * 0.45 },
                    { x: 0, y: -h * 0.72 }, // Tip
                    { x: -w * 0.015, y: -h * 0.45 }
                ], midMetal, bossColor, 1.5);

                // Central crease line
                line([
                    { x: 0, y: -h * 0.1 },
                    { x: 0, y: -h * 0.7 }
                ], panelLineColor, 1);

                // 3. Downward stabilizers / Lower legs
                for (let side of [-1, 1]) {
                    poly([
                        { x: side * w * 0.14, y: h * 0.05 },
                        { x: side * w * 0.26, y: h * 0.08 },
                        { x: side * w * 0.28, y: h * 0.42 }, // outer tip
                        { x: side * w * 0.22, y: h * 0.44 }, // point
                        { x: side * w * 0.08, y: h * 0.20 }
                    ], darkMetal, bossColor, 1.5);

                    // Panel lines inside legs
                    line([
                        { x: side * w * 0.18, y: h * 0.12 },
                        { x: side * w * 0.24, y: h * 0.38 }
                    ], panelLineColor, 1);
                }

                // 4. Center Body / Chassis Pod
                // Large hexagonal/curved central chassis
                poly([
                    { x: -w * 0.15, y: -h * 0.12 },
                    { x: w * 0.15, y: -h * 0.12 },
                    { x: w * 0.26, y: -h * 0.02 },
                    { x: w * 0.22, y: h * 0.14 },
                    { x: 0, y: h * 0.22 },
                    { x: -w * 0.22, y: h * 0.14 },
                    { x: -w * 0.26, y: -h * 0.02 }
                ], darkMetal, bossColor, 2);

                // Internal panel lines on body
                line([
                    { x: -w * 0.1, y: -h * 0.08 },
                    { x: w * 0.1, y: -h * 0.08 }
                ], panelLineColor, 1);
                line([
                    { x: -w * 0.15, y: h * 0.06 },
                    { x: -w * 0.05, y: h * 0.15 }
                ], panelLineColor, 1);
                line([
                    { x: w * 0.15, y: h * 0.06 },
                    { x: w * 0.05, y: h * 0.15 }
                ], panelLineColor, 1);

                // Small horizontal grates/slats above core (matching sketch)
                for (let i = 0; i < 2; i++) {
                    const gy = -h * 0.05 + i * h * 0.03;
                    poly([
                        { x: -w * 0.08, y: gy },
                        { x: w * 0.08, y: gy },
                        { x: w * 0.07, y: gy + h * 0.015 },
                        { x: -w * 0.07, y: gy + h * 0.015 }
                    ], midMetal, bossColor, 1);
                }

                // 5. Pointed Bottom Fuselage & Canopy
                // Fuselage pointing down
                poly([
                    { x: -w * 0.07, y: h * 0.15 },
                    { x: w * 0.07, y: h * 0.15 },
                    { x: w * 0.05, y: h * 0.38 },
                    { x: 0, y: h * 0.62 }, // sharp tip
                    { x: -w * 0.05, y: h * 0.38 }
                ], midMetal, bossColor, 1.5);

                // Central line along nose
                line([
                    { x: 0, y: h * 0.15 },
                    { x: 0, y: h * 0.58 }
                ], panelLineColor, 1);

                // Glowing Cockpit/Canopy (Cyan neon glass)
                ctx.save();
                glowGlow('#0ff', 12);
                poly([
                    { x: 0, y: h * 0.28 },
                    { x: w * 0.03, y: h * 0.35 },
                    { x: 0, y: h * 0.44 },
                    { x: -w * 0.03, y: h * 0.35 }
                ], 'rgba(0, 240, 255, 0.4)', '#0ff', 2);
                ctx.restore();

                // 6. Central Reactor / Core
                // Outer ring
                ctx.beginPath();
                ctx.arc(0, h * 0.06, w * 0.14, 0, Math.PI * 2);
                ctx.fillStyle = darkMetal;
                ctx.fill();
                ctx.strokeStyle = bossColor;
                ctx.lineWidth = 2;
                ctx.stroke();

                // Inner ring
                ctx.beginPath();
                ctx.arc(0, h * 0.06, w * 0.09, 0, Math.PI * 2);
                ctx.fillStyle = midMetal;
                ctx.fill();
                ctx.strokeStyle = bossColor;
                ctx.lineWidth = 1;
                ctx.stroke();

                // Pulsing glowing core (reactor heart)
                const pulse = 0.6 + Math.sin(performance.now() / 180) * 0.4;
                ctx.save();
                glowGlow(bossColor, 20 * pulse);
                ctx.beginPath();
                ctx.arc(0, h * 0.06, w * 0.05, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 0, 0, ${0.4 + pulse * 0.6})`;
                ctx.fill();
                ctx.restore();

                // 7. Massive Mechanical Wings (drawn on top or slightly behind)
                for (let side of [-1, 1]) {
                    // Wing Hinge / Joint connecting wing to chassis
                    poly([
                        { x: side * w * 0.20, y: -h * 0.08 },
                        { x: side * w * 0.28, y: -h * 0.18 },
                        { x: side * w * 0.30, y: -h * 0.10 },
                        { x: side * w * 0.22, y: -h * 0.02 }
                    ], lightMetal, bossColor, 1.5);

                    // Massive Sweeping Wing Polygon
                    poly([
                        { x: side * w * 0.26, y: -h * 0.14 },    // wing root front
                        { x: side * w * 0.36, y: -h * 0.24 },    // elbow joint
                        { x: side * w * 0.62, y: -h * 0.42 },    // mid wing leading edge
                        { x: side * w * 0.95, y: -h * 0.54 },    // outer wing leading tip
                        { x: side * w * 0.98, y: -h * 0.45 },    // wingtip point outer
                        { x: side * w * 0.92, y: -h * 0.34 },    // wingtip inner return
                        { x: side * w * 0.65, y: -h * 0.18 },    // mid trailing edge
                        { x: side * w * 0.42, y: -h * 0.04 },    // inner trailing edge
                        { x: side * w * 0.24, y: -h * 0.02 }     // wing root trailing
                    ], darkMetal, bossColor, 2);

                    // Upper wing panel overlay (adds depth like the sketch)
                    poly([
                        { x: side * w * 0.38, y: -h * 0.25 },
                        { x: side * w * 0.62, y: -h * 0.41 },
                        { x: side * w * 0.88, y: -h * 0.50 },
                        { x: side * w * 0.85, y: -h * 0.40 },
                        { x: side * w * 0.60, y: -h * 0.28 },
                        { x: side * w * 0.38, y: -h * 0.18 }
                    ], midMetal, bossColor, 1);

                    // Glowing wing energy channels (mechanical highlights)
                    ctx.save();
                    glowGlow(bossColor, 8);
                    line([
                        { x: side * w * 0.40, y: -h * 0.22 },
                        { x: side * w * 0.85, y: -h * 0.43 }
                    ], bossColor, 2);
                    ctx.restore();

                    // Wing panel partition lines
                    line([
                        { x: side * w * 0.48, y: -h * 0.32 },
                        { x: side * w * 0.52, y: -h * 0.18 }
                    ], panelLineColor, 1.5);
                    line([
                        { x: side * w * 0.70, y: -h * 0.42 },
                        { x: side * w * 0.72, y: -h * 0.26 }
                    ], panelLineColor, 1.5);
                }
            } else if (e.isShooter) {
                // Twin-spire armored shooter (Based on User Design)
                const w = e.width;
                const h = e.height;
                const hull = '#8d928a';
                const shade = '#53584f';
                const dark = '#11140f';
                const deep = '#050604';
                const highlight = '#c8ccc4';
                const accent = '#ff8800';

                const poly = (pts, color, alpha = 1) => {
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.beginPath();
                    ctx.moveTo(pts[0][0], pts[0][1]);
                    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.restore();
                };

                ctx.shadowBlur = 8;
                ctx.shadowColor = e.color;

                // Outer split armor blades with long lower points.
                poly([[-w * 0.48, -h * 0.04], [-w * 0.33, -h * 0.43], [-w * 0.18, -h * 0.1], [-w * 0.26, h * 0.52], [-w * 0.43, h * 0.36]], hull);
                poly([[w * 0.48, -h * 0.04], [w * 0.33, -h * 0.43], [w * 0.18, -h * 0.1], [w * 0.26, h * 0.52], [w * 0.43, h * 0.36]], hull);
                poly([[-w * 0.39, h * 0.05], [-w * 0.28, h * 0.38], [-w * 0.35, h * 0.31]], dark, 0.82);
                poly([[w * 0.39, h * 0.05], [w * 0.28, h * 0.38], [w * 0.35, h * 0.31]], dark, 0.82);

                // Tall rear spires.
                poly([[-w * 0.22, -h * 0.54], [-w * 0.1, -h * 0.36], [-w * 0.1, h * 0.1], [-w * 0.24, h * 0.22], [-w * 0.28, -h * 0.3]], shade);
                poly([[w * 0.22, -h * 0.54], [w * 0.1, -h * 0.36], [w * 0.1, h * 0.1], [w * 0.24, h * 0.22], [w * 0.28, -h * 0.3]], shade);

                // Central raised hull and split nose.
                poly([[0, -h * 0.43], [w * 0.12, -h * 0.25], [w * 0.1, h * 0.2], [w * 0.04, h * 0.49], [0, h * 0.38], [-w * 0.04, h * 0.49], [-w * 0.1, h * 0.2], [-w * 0.12, -h * 0.25]], hull);
                poly([[0, -h * 0.28], [w * 0.08, -h * 0.18], [w * 0.05, h * 0.2], [0, h * 0.32], [-w * 0.05, h * 0.2], [-w * 0.08, -h * 0.18]], highlight, 0.45);
                poly([[-w * 0.04, h * 0.22], [0, h * 0.34], [w * 0.04, h * 0.22], [0, h * 0.43]], deep, 0.95);

                // Side layered panels and vents.
                poly([[-w * 0.28, -h * 0.08], [-w * 0.18, -h * 0.16], [-w * 0.14, h * 0.28], [-w * 0.24, h * 0.34]], dark, 0.8);
                poly([[w * 0.28, -h * 0.08], [w * 0.18, -h * 0.16], [w * 0.14, h * 0.28], [w * 0.24, h * 0.34]], dark, 0.8);
                poly([[-w * 0.42, -h * 0.2], [-w * 0.32, -h * 0.3], [-w * 0.28, -h * 0.05], [-w * 0.4, h * 0.02]], dark, 0.74);
                poly([[w * 0.42, -h * 0.2], [w * 0.32, -h * 0.3], [w * 0.28, -h * 0.05], [w * 0.4, h * 0.02]], dark, 0.74);
                poly([[-w * 0.44, h * 0.18], [-w * 0.34, h * 0.25], [-w * 0.39, h * 0.38], [-w * 0.48, h * 0.31]], dark, 0.74);
                poly([[w * 0.44, h * 0.18], [w * 0.34, h * 0.25], [w * 0.39, h * 0.38], [w * 0.48, h * 0.31]], dark, 0.74);

                // Edge highlights and orange chevron.
                ctx.strokeStyle = 'rgba(255,255,255,0.28)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(-w * 0.24, -h * 0.5);
                ctx.lineTo(-w * 0.24, h * 0.44);
                ctx.moveTo(w * 0.24, -h * 0.5);
                ctx.lineTo(w * 0.24, h * 0.44);
                ctx.moveTo(0, -h * 0.4);
                ctx.lineTo(0, h * 0.28);
                ctx.stroke();

                ctx.strokeStyle = accent;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(-w * 0.06, h * 0.22);
                ctx.lineTo(0, h * 0.29);
                ctx.lineTo(w * 0.06, h * 0.22);
                ctx.stroke();

                // Small side hardpoints.
                poly([[-w * 0.52, -h * 0.04], [-w * 0.44, -h * 0.1], [-w * 0.4, -h * 0.02], [-w * 0.48, h * 0.04]], shade);
                poly([[w * 0.52, -h * 0.04], [w * 0.44, -h * 0.1], [w * 0.4, -h * 0.02], [w * 0.48, h * 0.04]], shade);
                poly([[-w * 0.54, h * 0.08], [-w * 0.45, h * 0.02], [-w * 0.42, h * 0.12], [-w * 0.5, h * 0.18]], shade);
                poly([[w * 0.54, h * 0.08], [w * 0.45, h * 0.02], [w * 0.42, h * 0.12], [w * 0.5, h * 0.18]], shade);
            } else {
                // Standard Enemy (Armored Drone - Based on User design)
                const w = e.width;
                const h = e.height;

                ctx.rotate(Math.PI); // Rotate 180 degrees to face the player

                const hull = '#8c939d'; // Grey main body
                const dark = '#20252e'; // Dark mechanics
                const accent = e.color || '#ffea00'; // Yellow/gold color signature
                const panel = 'rgba(255, 255, 255, 0.3)';

                // Helper for local polys
                const localPoly = (pts, color, strokeColor, strokeWidth = 1) => {
                    ctx.beginPath();
                    ctx.moveTo(pts[0][0], pts[0][1]);
                    for (let i = 1; i < pts.length; i++) {
                        ctx.lineTo(pts[i][0], pts[i][1]);
                    }
                    ctx.closePath();
                    if (color) {
                        ctx.fillStyle = color;
                        ctx.fill();
                    }
                    if (strokeColor) {
                        ctx.strokeStyle = strokeColor;
                        ctx.lineWidth = strokeWidth;
                        ctx.stroke();
                    }
                };

                const localLine = (pts, strokeColor, strokeWidth = 1.2) => {
                    ctx.beginPath();
                    ctx.moveTo(pts[0][0], pts[0][1]);
                    for (let i = 1; i < pts.length; i++) {
                        ctx.lineTo(pts[i][0], pts[i][1]);
                    }
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = strokeWidth;
                    ctx.stroke();
                };

                // 1. Central Engine Nozzles (between tail columns)
                localPoly([[-w * 0.04, h * 0.15], [w * 0.04, h * 0.15], [w * 0.04, h * 0.32], [-w * 0.04, h * 0.32]], dark, accent, 1);

                // 2. Parallel Tail Columns
                // Left tail column
                localPoly([
                    [-w * 0.15, h * 0.1],
                    [-w * 0.06, h * 0.1],
                    [-w * 0.06, h * 0.65],
                    [-w * 0.15, h * 0.65]
                ], dark, accent, 1.2);
                // Right tail column
                localPoly([
                    [w * 0.06, h * 0.1],
                    [w * 0.15, h * 0.1],
                    [w * 0.15, h * 0.65],
                    [w * 0.06, h * 0.65]
                ], dark, accent, 1.2);

                // 3. Horizontal Stabilizer Feet (L-shapes at bottom of columns)
                // Left stabilizer foot
                localPoly([
                    [-w * 0.15, h * 0.48],
                    [-w * 0.06, h * 0.48],
                    [-w * 0.06, h * 0.68],
                    [-w * 0.32, h * 0.68],
                    [-w * 0.32, h * 0.61],
                    [-w * 0.15, h * 0.58]
                ], accent, 'rgba(0,0,0,0.5)', 1);
                // Right stabilizer foot
                localPoly([
                    [w * 0.06, h * 0.48],
                    [w * 0.15, h * 0.48],
                    [w * 0.15, h * 0.58],
                    [w * 0.32, h * 0.61],
                    [w * 0.32, h * 0.68],
                    [w * 0.06, h * 0.68]
                ], accent, 'rgba(0,0,0,0.5)', 1);

                // 4. Upper Winglets (Swept outward and slightly back)
                // Left Winglet
                localPoly([
                    [-w * 0.12, -h * 0.25],
                    [-w * 0.42, -h * 0.22],
                    [-w * 0.36, -h * 0.10],
                    [-w * 0.15, -h * 0.08]
                ], accent, 'rgba(0,0,0,0.4)', 1);
                // Right Winglet
                localPoly([
                    [w * 0.12, -h * 0.25],
                    [w * 0.42, -h * 0.22],
                    [w * 0.36, -h * 0.10],
                    [w * 0.15, -h * 0.08]
                ], accent, 'rgba(0,0,0,0.4)', 1);

                // 5. Main Wing Panels
                // Left Main Wing
                localPoly([
                    [-w * 0.15, -h * 0.08],
                    [-w * 0.72, h * 0.08],
                    [-w * 0.68, h * 0.18],
                    [-w * 0.15, h * 0.15]
                ], hull, accent, 1.5);
                // Right Main Wing
                localPoly([
                    [w * 0.15, -h * 0.08],
                    [w * 0.72, h * 0.08],
                    [w * 0.68, h * 0.18],
                    [w * 0.15, h * 0.15]
                ], hull, accent, 1.5);
                // Wing accents (Gold/tan trailing edge armor plates)
                // Left wing trailing edge accent
                localPoly([
                    [-w * 0.5, h * 0.12],
                    [-w * 0.72, h * 0.08],
                    [-w * 0.68, h * 0.18],
                    [-w * 0.45, h * 0.16]
                ], accent, 'rgba(0,0,0,0.3)', 1);
                // Right wing trailing edge accent
                localPoly([
                    [w * 0.5, h * 0.12],
                    [w * 0.72, h * 0.08],
                    [w * 0.68, h * 0.18],
                    [w * 0.45, h * 0.16]
                ], accent, 'rgba(0,0,0,0.3)', 1);

                // 6. Central Fuselage and Canopy
                // Main fuselage plate
                localPoly([
                    [0, -h * 0.42],       // Nose tip
                    [w * 0.12, -h * 0.25], // Shoulder
                    [w * 0.15, h * 0.05],  // Waist
                    [w * 0.12, h * 0.22],  // Lower waist
                    [0, h * 0.26],         // Rear center
                    [-w * 0.12, h * 0.22],
                    [-w * 0.15, h * 0.05],
                    [-w * 0.12, -h * 0.25]
                ], hull, accent, 1.8);
                // Gold chest/vent panel near mid-front
                localPoly([
                    [-w * 0.08, h * 0.08],
                    [w * 0.08, h * 0.08],
                    [w * 0.06, h * 0.18],
                    [-w * 0.06, h * 0.18]
                ], accent, 'rgba(0,0,0,0.5)', 1);
                // Cockpit window / canopy
                localPoly([
                    [0, -h * 0.22],
                    [w * 0.06, -h * 0.1],
                    [w * 0.05, h * 0.02],
                    [-w * 0.05, h * 0.02],
                    [-w * 0.06, -h * 0.1]
                ], dark, accent, 1);

                // 7. Panel Lines
                localLine([[0, -h * 0.4], [0, -h * 0.22]], panel, 1);
                localLine([[-w * 0.05, h * 0.05], [-w * 0.05, h * 0.18]], panel, 0.8);
                localLine([[w * 0.05, h * 0.05], [w * 0.05, h * 0.18]], panel, 0.8);
            }

            // Health bar for boss or sturdy enemies
            if (e.maxHealth > 1) {
                const hpPercent = e.health / e.maxHealth;
                ctx.fillStyle = 'red';
                ctx.fillRect(-e.width / 2, -e.height / 2 - 10, e.width, 5);
                ctx.fillStyle = 'green';
                ctx.fillRect(-e.width / 2, -e.height / 2 - 10, e.width * hpPercent, 5);
            }

            ctx.restore();
        }
    }

    // Draw Enemy Bullets
    if (isPlaying || isGameOver) {
        enemies.forEach(e => {
            if (e.bullets && e.bullets.length > 0) {
                ctx.save();
                ctx.shadowBlur = 5;
                e.bullets.forEach(b => {
                    ctx.fillStyle = b.color || '#ff8800';
                    ctx.shadowColor = b.color || '#ff8800';
                    ctx.save();
                    ctx.translate(b.x, b.y);
                    if (b.vx !== undefined && b.vx !== 0) {
                        const angle = Math.atan2(b.vy || b.speed, b.vx) - Math.PI / 2;
                        ctx.rotate(angle);
                    }
                    ctx.fillRect(-b.width / 2, -b.height / 2, b.width, b.height);
                    ctx.restore();
                });
                ctx.restore();
            }
        });
    }
}

function gameLoop(timestamp) {
    try {
        const deltaTime = timestamp - lastTime;
        lastTime = timestamp;

        update(deltaTime);
        updateHUD();
        draw(); // draw always

        // Always continue the loop
        gameLoopId = requestAnimationFrame(gameLoop);
    } catch (e) {
        console.error("Game Loop Error:", e);
        isPlaying = false;
        alert("Game Loop Error: " + e.message);
    }
}

// Helpers
function spawnEnemy() {
    const size = 30 + Math.random() * 20;
    const x = Math.random() * (canvas.width - size) + size / 2;

    // Higher chance to spawn a shooting enemy (starts at 25% and increases with kills)
    const shooterChance = Math.min(0.55, 0.25 + (enemiesKilled / 350));
    const isShooter = Math.random() < shooterChance;
    const shooterType = isShooter ? ['striker', 'invader', 'drone'][Math.floor(Math.random() * 3)] : null;

    enemies.push({
        x: x,
        y: -50,
        width: size,
        height: size,
        speed: isShooter ? (0.5 + Math.random() * 0.3) : (0.7 + Math.random() * 0.9),
        color: isShooter ? '#ff8800' : 'rgba(255, 234, 0, 1)', // Orange for shooters
        isShooter: isShooter,
        shooterType: shooterType,
        health: isShooter ? 5 : 1, // 5 hits for shooter
        maxHealth: isShooter ? 5 : 1,
        lastShot: performance.now(),
        shootDelay: 2000, // 2 seconds
        bullets: [] // Enemies can have bullets too? 
        // To keep it simple, we might spawn a "bullet entity" globally or let the enemy manage it.
        // For now, let's assume we spawn a global enemy bullet.
    });

    // Animate Shooter Enemies
    if (isShooter && typeof anime !== 'undefined') {
        const enemy = enemies[enemies.length - 1];

        // Pulse Effect
        anime({
            targets: enemy,
            scale: [1, 1.2],
            duration: 400,
            direction: 'alternate',
            loop: true,
            easing: 'easeInOutSine'
        });

        // Rocking/Wobble Effect (removed)
        enemy.rotation = 0; // Initialize rotation
    }
}

function spawnBoss() {
    const size = 200;
    const x = canvas.width / 2;

    enemies.push({
        x: x,
        y: -100,
        width: size,
        height: size,
        speed: 1.2, // Faster entry speed
        dx: 1.2, // Horizontal speed
        color: '#ff0000', // Red for boss
        isBoss: true,
        health: 100, // 100 hits
        maxHealth: 100,
        lastShot: performance.now(),
        shootDelay: 3000, // 3 seconds (5 spreading shots)
        bullets: [],
        shotsFired: 0,
        state: 'entering' // entering, fighting
    });
}

function spawnPowerUp(type) {
    const x = Math.random() * (canvas.width - 60) + 30;
    let color = 'rgba(0, 255, 42, 1)'; // Default green for side shooters
    if (type === 'life') color = '#f00'; // Red for life
    if (type === 'shield') color = '#0af'; // Cyan for shield
    powerUps.push({
        x: x,
        y: -50,
        width: 30,
        height: 30,
        speed: 1.2,
        color: color,
        rotation: 0,
        type: type,
        scale: 0 // Initialize scale for animation
    });

    // Add entry and pulse animation
    if (typeof anime !== 'undefined') {
        const puIndex = powerUps.length - 1;
        const pu = powerUps[puIndex];

        anime({
            targets: pu,
            scale: [0, 1.2],
            duration: 800,
            easing: 'easeOutElastic(1, .5)',
            complete: function () {
                // Pulse animation
                anime({
                    targets: pu,
                    scale: [1.2, 0.9],
                    duration: 1000,
                    direction: 'alternate',
                    loop: true,
                    easing: 'easeInOutSine'
                });
            }
        });
    }
}

function createExplosion(x, y, color, count = 15) {
    // Shockwave
    particles.push({
        x: x,
        y: y,
        vx: 0,
        vy: 0,
        life: 1,
        decay: 0.05,
        size: 1,
        maxSize: 50, // Target size for shockwave
        color: color,
        type: 'shockwave'
    });

    // Debris/Sparks
    for (let i = 0; i < count; i++) {
        const speed = Math.random() * 5 + 2;
        const angle = Math.random() * Math.PI * 2;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            decay: 0.01 + Math.random() * 0.03,
            size: 2 + Math.random() * 3,
            color: color,
            type: 'particle'
        });
    }
}

function updateLivesDisplay() {
    players.forEach((player, index) => {
        const segmentsContainer = index === 0 ? p1HealthSegments : p2HealthSegments;
        const levelEl = index === 0 ? p1LevelEl : p2LevelEl;
        const dotsContainer = index === 0 ? p1HpDots : p2HpDots;

        if (!segmentsContainer) return;

        const percentage = player.lives / player.maxLives;

        // Update continuous health bar fill
        const fillBar = document.getElementById(`p${index + 1}-hp-fill`);
        if (fillBar) {
            fillBar.style.width = (percentage * 100) + '%';
        }

        // Toggle state classes for status colors on the health bar container
        segmentsContainer.classList.remove('state-high', 'state-warning', 'state-danger');
        if (percentage > 0.6) {
            segmentsContainer.classList.add('state-high');
        } else if (percentage > 0.3) {
            segmentsContainer.classList.add('state-warning');
        } else {
            segmentsContainer.classList.add('state-danger');
        }

        // Update HP lives display (text-based big value)
        if (dotsContainer) {
            const livesValEl = dotsContainer.querySelector('.hud-big-val');
            if (livesValEl) {
                livesValEl.innerText = String(player.lives).padStart(2, '0');
            }
        }

        // Update Level indicator
        if (levelEl) {
            const level = Math.floor(player.kills / 10) + 1;
            levelEl.innerText = level;
        }
    });
}

function updateHUD() {
    const now = performance.now();

    players.forEach((player, index) => {
        const shieldWrapper = index === 0 ? p1ShieldWrapper : p2ShieldWrapper;
        const shieldBar = index === 0 ? p1ShieldBar : p2ShieldBar;
        const shooterWrapper = index === 0 ? p1ShooterWrapper : p2ShooterWrapper;
        const shooterBar = index === 0 ? p1ShooterBar : p2ShooterBar;

        // Update Shield Timer
        if (player.hasShield) {
            shieldWrapper.style.display = 'block';
            const remaining = player.shieldEndTime - now;
            const percent = Math.max(0, (remaining / 10000) * 100);
            shieldBar.style.width = percent + '%';
        } else {
            shieldWrapper.style.display = 'none';
        }

        // Update Side Shooters Timer
        if (player.hasSideShooters) {
            shooterWrapper.style.display = 'block';
            const remaining = player.sideShooterEndTime - now;
            const percent = Math.max(0, (remaining / 10000) * 100);
            shooterBar.style.width = percent + '%';
        } else {
            shooterWrapper.style.display = 'none';
        }

        // Update Decorative Energy Bar (progress to next Level)
        const energyBar = document.getElementById(`p${index + 1}-energy-bar`);
        if (energyBar) {
            const progress = (player.kills % 10) * 10;
            energyBar.style.width = Math.max(5, progress) + '%';
        }
    });
}

function updateKillsDisplay() {
    p1KillsEl.innerText = players[0].kills;
    p2KillsEl.innerText = players[1].kills;
}

function createMuzzleFlash(x, y, color) {
    // Small explosion effect when shooting
    for (let i = 0; i < 5; i++) {
        const speed = Math.random() * 2 + 1;
        const angle = Math.random() * Math.PI * 2;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            decay: 0.1,
            size: 1 + Math.random() * 2,
            color: color,
            type: 'particle'
        });
    }
}

function checkCollision(rect1, rect2) {
    const r1Left = rect1.x - rect1.width / 2;
    const r1Right = rect1.x + rect1.width / 2;
    const r1Top = rect1.y - rect1.height / 2;
    const r1Bottom = rect1.y + rect1.height / 2;

    const r2Left = rect2.x - rect2.width / 2;
    const r2Right = rect2.x + rect2.width / 2;
    const r2Top = rect2.y - rect2.height / 2;
    const r2Bottom = rect2.y + rect2.height / 2;

    return (
        r1Left < r2Right &&
        r1Right > r2Left &&
        r1Top < r2Bottom &&
        r1Bottom > r2Top
    );
}

function drawPlayerShape(ctx, shape, primary) {
    const p = primary || '#0ff';
    const s = p; // Use primary color for accent as well to remove secondary color effect

    // Multiplier to normalize all shapes to a consistent size
    let sc = 1.0;
    if (shape === 'classic') sc = 0.35; // Normalized scale for the detailed blueprint fighter
    else if (shape === 'fighter') sc = 0.48; // Scaled up size
    else if (shape === 'interceptor') sc = 0.38; // Scaled up size
    else if (shape === 'bomber') sc = 0.34;
    else if (shape === 'speeder') sc = 0.45;
    else if (shape === 'stealth') sc = 0.43;
    else if (shape === 'titan') sc = 0.52; // Heavy class size boost
    else if (shape === 'vintage') sc = 0.38;

    ctx.save();
    ctx.scale(sc, sc);

    // Helper: filled polygon
    function poly(pts, color, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha !== undefined ? alpha : 1;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 / sc; // Maintain consistent line weight
        ctx.stroke();
        ctx.restore();
    }

    // Helper: stroke line
    function line(pts, color, lw) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.strokeStyle = color;
        ctx.lineWidth = (lw || 1.5) / sc; // Maintain consistent line weight
        ctx.stroke();
        ctx.restore();
    }

    // Helper: circle
    function circ(x, y, r, color, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha !== undefined ? alpha : 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
    }

    if (shape === 'classic') {
        // --- CLASSIC: Angular Flying Wing Stealth Bomber (Reference Image Match) ---
        const hull = p; // Chosen color is the major body color
        const dark = '#1a1f28'; // Deep dark panels
        const accent = p; // Player's chosen color for accent highlights
        const panel = 'rgba(255, 255, 255, 0.25)';
        const glass = '#0a0e14';

        ctx.save();
        ctx.shadowBlur = 8 / sc;
        ctx.shadowColor = p;

        // 1. Main Flying Wing Body (trailing edge slants sharply inward)
        poly([
            [0, -70],       // Nose tip
            [12, -45],      // Nose taper
            [30, -20],      // Forward body shoulder
            [90, 30],       // Wingtip leading
            [85, 38],       // Wingtip trailing outer
            [45, 42],       // Trailing edge slants inward sharply
            [18, 48],       // Inner trailing (narrow)
            [8, 55],        // Rear body narrows
            [0, 58],        // Center trailing point
            [-8, 55],
            [-18, 48],
            [-45, 42],
            [-85, 38],
            [-90, 30],
            [-30, -20],
            [-12, -45]
        ], hull);

        // 2. Dark Central Spine (raised body section)
        poly([
            [0, -68],
            [10, -40],
            [14, -10],
            [16, 20],
            [10, 45],
            [5, 55],
            [0, 58],
            [-5, 55],
            [-10, 45],
            [-16, 20],
            [-14, -10],
            [-10, -40]
        ], dark);

        // 3. Wing Surface Detail - Dark panel sections
        // Left wing inner dark panel
        poly([[-18, -5], [-50, 18], [-45, 35], [-18, 25]], dark, 0.6);
        // Left wing outer dark panel
        poly([[-50, 20], [-82, 32], [-75, 42], [-48, 35]], dark, 0.55);
        // Right wing inner dark panel
        poly([[18, -5], [50, 18], [45, 35], [18, 25]], dark, 0.6);
        // Right wing outer dark panel
        poly([[50, 20], [82, 32], [75, 42], [48, 35]], dark, 0.55);

        // 4. Twin Angled Vertical Tail Fins (flanking the tail)
        // Left fin
        poly([[-8, 38], [-14, 30], [-20, 28], [-22, 52], [-16, 55], [-10, 48]], dark);
        line([[-15, 32], [-20, 50]], panel, 0.8);
        line([[-20, 28], [-22, 52]], accent, 1);
        // Right fin
        poly([[8, 38], [14, 30], [20, 28], [22, 52], [16, 55], [10, 48]], dark);
        line([[15, 32], [20, 50]], panel, 0.8);
        line([[20, 28], [22, 52]], accent, 1);

        // 5. Extended Tail Section with Vertical Fin
        // Tail boom extending backward from narrow rear
        poly([[-5, 52], [5, 52], [4, 82], [-4, 82]], dark);
        // Tail hull accent
        poly([[-3, 55], [3, 55], [2, 78], [-2, 78]], hull, 0.7);
        // Vertical tail fin (tall, prominent)
        poly([[-2, 62], [2, 62], [2, 90], [0, 95], [-2, 90]], dark);
        line([[0, 62], [0, 93]], accent, 1.2);
        // Dark horizontal stabilizer at tail (replacing gold)
        poly([[-16, 78], [16, 78], [14, 82], [-14, 82]], dark);
        circ(-15, 80, 1.5, dark, 0.8);
        circ(15, 80, 1.5, dark, 0.8);
        circ(0, 95, 1.8, accent, 0.8);
        // Exhaust glow at tail tip (removed)
        // circ(0, 83, 1.8, accent, 0.85);
        // circ(0, 83, 0.8, '#fff', 0.5);

        // 6. Dark Trailing Edge Accent Strips (following inward slant, replacing gold)
        line([[-85, 36], [-45, 42], [-18, 48]], dark, 1.5);
        line([[85, 36], [45, 42], [18, 48]], dark, 1.5);

        // 7. Cockpit Window (small, near nose)
        poly([[0, -35], [4, -30], [4, -20], [0, -16], [-4, -20], [-4, -30]], glass);
        let canopyGrad = ctx.createLinearGradient(-3, -34, 3, -18);
        canopyGrad.addColorStop(0, '#101820');
        canopyGrad.addColorStop(0.4, '#3a4858');
        canopyGrad.addColorStop(0.6, '#687880');
        canopyGrad.addColorStop(1, '#080c10');
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, -33);
        ctx.bezierCurveTo(3, -30, 3, -20, 0, -18);
        ctx.bezierCurveTo(-3, -20, -3, -30, 0, -33);
        ctx.closePath();
        ctx.fillStyle = canopyGrad;
        ctx.fill();
        ctx.restore();
        line([[0, -33], [0, -18]], 'rgba(255,255,255,0.15)', 0.5);

        // 8. Panel Lines & Surface Detail
        line([[-12, -40], [-88, 32]], panel, 1);
        line([[12, -40], [88, 32]], panel, 1);
        line([[-20, 5], [-78, 36]], panel, 0.8);
        line([[20, 5], [78, 36]], panel, 0.8);
        line([[-16, 30], [-65, 46]], panel, 0.7);
        line([[16, 30], [65, 46]], panel, 0.7);
        line([[-45, 10], [-45, 42]], panel, 0.6);
        line([[45, 10], [45, 42]], panel, 0.6);
        line([[-68, 24], [-68, 44]], panel, 0.6);
        line([[68, 24], [68, 44]], panel, 0.6);
        line([[0, -65], [0, -38]], panel, 0.7);
        line([[0, -14], [0, 55]], panel, 0.6);
        line([[-10, -35], [-14, 10], [-10, 48]], panel, 0.7);
        line([[10, -35], [14, 10], [10, 48]], panel, 0.7);

        // 9. Accent Color Highlights
        circ(0, -68, 2, accent, 0.7);
        circ(0, -68, 1, '#fff', 0.4);
        circ(-60, 35, 1.5, accent, 0.5);
        circ(60, 35, 1.5, accent, 0.5);

        ctx.restore();


    } else if (shape === 'fighter') {
        // --- FIGHTER: Tactical Arrowhead Interceptor (Reference Sketch Match) ---
        const hull = p; // Major color is chosen signature color p
        const dark = '#1a1f26'; // Dark engine/fuselage panels
        const panel = 'rgba(255, 255, 255, 0.45)'; // White panel outlines since body is colored
        const lightPanel = 'rgba(0, 0, 0, 0.3)'; // Dark panel highlight lines

        ctx.save();
        ctx.shadowBlur = 8 / sc;
        ctx.shadowColor = p;

        // 1. Long Pointed Fuselage / Nose Spine
        // Base dark metal underlayer
        poly([[0, -90], [8, -60], [12, -20], [13, 10], [0, 45], [-13, 10], [-12, -20], [-8, -60]], dark);
        // Dark contrast spine decal
        poly([[0, -90], [4, -60], [5, -20], [5, 10], [0, 30], [-5, 10], [-5, -20], [-4, -60]], dark);
        // Central body light grey cover plates (now hull = p)
        poly([[0, -80], [3, -55], [3, -15], [0, 5], [-3, -15], [-3, -55]], hull);

        // 2. Cockpit Canopy (Central long capsule)
        poly([[0, -50], [5, -35], [5, -15], [0, -5], [-5, -15], [-5, -35]], '#090d14');
        let canopyGrad = ctx.createLinearGradient(-4, -45, 4, -10);
        canopyGrad.addColorStop(0, '#1a3040');
        canopyGrad.addColorStop(0.3, '#5c7890');
        canopyGrad.addColorStop(0.6, '#ffffff');
        canopyGrad.addColorStop(1, '#0c1117');
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, -48);
        ctx.bezierCurveTo(4, -45, 4, -12, 0, -8);
        ctx.bezierCurveTo(-4, -12, -4, -45, 0, -48);
        ctx.closePath();
        ctx.fillStyle = canopyGrad;
        ctx.fill();
        ctx.restore();
        // Canopy center panel line
        line([[0, -48], [0, -8]], 'rgba(255, 255, 255, 0.3)', 0.8);

        // 3. Bulky Engine/Shoulder Blocks (Flanking the cockpit)
        for (let side of [-1, 1]) {
            const sx = side * 18;
            // Base shoulder structure
            poly([[side * 6, -18], [sx - side * 4, -18], [sx - side * 10, 5], [sx - side * 6, 25], [side * 10, 25], [side * 6, 5]], dark);
            // Dark contrast accent panel
            poly([[side * 8, -14], [sx - side * 5, -14], [sx - side * 8, 5], [sx - side * 5, 20], [side * 9, 20]], dark);
            // Major color top plate (hull = p)
            poly([[side * 8, -5], [sx - side * 5, 0], [sx - side * 6, 12], [side * 9, 12]], hull);
            // Mechanical detail lines on shoulders
            line([[sx - side * 4, -18], [sx - side * 8, 15]], panel, 0.9);
        }

        // 4. Curved Swept Main Wings
        // Left Wing
        poly([
            [-24, -10],      // Wing root front
            [-55, 2],       // Wing mid-span leading edge
            [-85, 10],      // Wingtip leading point
            [-87, 12],      // Wingtip sharp trailing edge
            [-65, 18],      // Wing mid-span trailing edge
            [-28, 25]       // Wing root rear
        ], hull);
        // Left Wing dark contrast accent decal
        poly([
            [-24, -10],
            [-55, 2],
            [-85, 10],
            [-65, 12],
            [-26, 5]
        ], dark);
        // Left Wing panel cuts
        line([[-24, -2], [-83, 10]], panel, 1);
        line([[-55, 2], [-65, 18]], panel, 0.9);

        // Right Wing
        poly([
            [24, -10],
            [55, 2],
            [85, 10],
            [87, 12],
            [65, 18],
            [28, 25]
        ], hull);
        // Right Wing dark contrast accent decal
        poly([
            [24, -10],
            [55, 2],
            [85, 10],
            [65, 12],
            [26, 5]
        ], dark);
        // Right Wing panel cuts
        line([[24, -2], [83, 10]], panel, 1);
        line([[55, 2], [65, 18]], panel, 0.9);

        // 5. Tail Stabilizers (Swept-back stabilizers pointing outwards)
        poly([[-12, 25], [-45, 58], [-35, 65], [-8, 38]], hull);
        poly([[-35, 50], [-45, 58], [-35, 65], [-27, 57]], dark); // Accent tip
        poly([[12, 25], [45, 58], [35, 65], [8, 38]], hull);
        poly([[35, 50], [45, 58], [35, 65], [27, 57]], dark); // Accent tip

        // 6. Central Engine Exhausts, Nozzles & Rear Spikes
        // Left Nozzle casing
        poly([[-8, 32], [-2, 32], [-1, 55], [-7, 55]], dark);
        // Right Nozzle casing
        poly([[8, 32], [2, 32], [1, 55], [7, 55]], dark);
        // Twin center tail spikes (flaps pointing back)
        poly([[-4, 52], [0, 72], [4, 52]], dark);
        line([[0, 52], [0, 70]], p, 1);
        // Propulsion glow (removed)
        // circ(-5, 55, 4.5, s, 0.85);
        // circ(5, 55, 4.5, s, 0.85);
        // circ(-5, 55, 2, '#fff', 0.6);
        // circ(5, 55, 2, '#fff', 0.6);

        // 7. General Panel Lines & Detailing
        line([[0, -80], [0, -52]], panel, 0.8);
        line([[0, -5], [0, 30]], panel, 0.8);
        circ(0, 20, 2.5, s, 0.45);

        ctx.restore();


    } else if (shape === 'interceptor') {
        // --- INTERCEPTOR: Twin-Blade Heavy Striker (Reference Image Match) ---
        const hull = p; // Major color is chosen signature color p
        const dark = '#111318'; // Dark mechanical contrast
        const metal = '#1c222d'; // Metal accents
        const panel = 'rgba(255, 255, 255, 0.45)'; // White highlighting line since body is colored

        // 1. Structural Truss Struts (Connecting cockpit center, wing roots, and pincers)
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 2.5 / sc;
        // Pincer connections (Now visible light metallic grey/white)
        line([[-6, -15], [-12, -45]], 'rgba(255, 255, 255, 0.45)');
        line([[6, -15], [12, -45]], 'rgba(255, 255, 255, 0.45)');
        line([[-12, 10], [-30, 5]], 'rgba(255, 255, 255, 0.45)');
        line([[12, 10], [30, 5]], 'rgba(255, 255, 255, 0.45)');
        line([[-10, 25], [-22, 10]], 'rgba(255, 255, 255, 0.45)');
        line([[10, 25], [22, 10]], 'rgba(255, 255, 255, 0.45)');
        // Outer mechanical trusses
        line([[-25, 0], [-25, 35]], 'rgba(255, 255, 255, 0.3)', 1.5);
        line([[25, 0], [25, 35]], 'rgba(255, 255, 255, 0.3)', 1.5);
        ctx.restore();

        // 2. Giant Forward Pincer Blades (Left & Right)
        // Left Pincer (Primary body = hull)
        poly([
            [-32, 12],      // base outer
            [-14, 12],      // base inner
            [-10, -35],     // mid inner
            [-7, -120],     // sharp tip
            [-12, -80],     // inner tapering edge
            [-19, -40],     // mid taper outer
            [-29, -15],     // base taper outer
            [-35, 0]        // base outer corner
        ], hull);

        // Left Pincer (Serrated Inner Edge)
        poly([
            [-7, -120],     // tip
            [-7, -112],
            [-9, -112],     // notch 1
            [-8, -102],
            [-10, -102],    // notch 2
            [-9, -92],
            [-11, -92],     // notch 3
            [-10, -82],
            [-12, -82],     // notch 4
            [-11, -72],
            [-13, -72],     // notch 5
            [-12, -62],
            [-14, -62],     // notch 6
            [-13, -30],     // base taper
            [-10, -35]      // inner base
        ], dark);

        // Left Pincer (Color Signature Accent Panel - Outer Blade section -> changed to dark contrast)
        poly([
            [-19, -40],     // mid outer
            [-7, -120],     // tip
            [-12, -80],
            [-15, -60],
            [-22, -35],
            [-26, -20]
        ], dark);

        // Left Pincer White Accent Stripe (Diagonal boundary divider)
        line([[-26, -20], [-22, -35], [-15, -60], [-12, -80], [-7, -120]], 'rgba(255, 255, 255, 0.75)', 1.2);

        // Right Pincer Blade (Mirror)
        // Right Pincer (Primary body = hull)
        poly([
            [32, 12],
            [14, 12],
            [10, -35],
            [7, -120],
            [12, -80],
            [19, -40],
            [29, -15],
            [35, 0]
        ], hull);

        // Right Pincer (Serrated Inner Edge)
        poly([
            [7, -120],
            [7, -112],
            [9, -112],
            [8, -102],
            [10, -102],
            [9, -92],
            [11, -92],
            [10, -82],
            [12, -82],
            [11, -72],
            [13, -72],
            [12, -62],
            [13, -30],
            [10, -35]
        ], dark);

        // Right Pincer (Color Signature Accent Panel - Outer Blade section -> changed to dark contrast)
        poly([
            [19, -40],
            [7, -120],
            [12, -80],
            [15, -60],
            [22, -35],
            [26, -20]
        ], dark);

        // Right Pincer White Accent Stripe (Diagonal boundary divider)
        line([[26, -20], [22, -35], [15, -60], [12, -80], [7, -120]], 'rgba(255, 255, 255, 0.75)', 1.2);

        // 3. Central Spine / Fuselage Core
        poly([
            [0, -55],       // central nose point
            [5, -25],       // nose base
            [9, -15],       // bridge front
            [11, 28],       // cockpit waist
            [0, 50],        // tail joint
            [-11, 28],
            [-9, -15],
            [-5, -25]
        ], hull);

        // Center spine accent & details
        line([[0, -55], [0, -15]], 'rgba(255, 255, 255, 0.7)', 1.2);
        line([[-6, -15], [-7, 10], [-5, 28]], 'rgba(255, 255, 255, 0.35)', 1);
        line([[6, -15], [7, 10], [5, 28]], 'rgba(255, 255, 255, 0.35)', 1);
        circ(0, -42, 2.5, '#ff8800', 0.95); // Glowing amber forward sensor node

        // 4. Dual Canopy Reactors / Glowing Cockpit Pods (Shaded Gold Canopy)
        // Forward reactor core
        poly([[0, -22], [5, -12], [0, -2], [-5, -12]], '#222');
        let reactorGrad = ctx.createLinearGradient(-4, -20, 4, -5);
        reactorGrad.addColorStop(0, '#f80');
        reactorGrad.addColorStop(0.5, '#ffd700');
        reactorGrad.addColorStop(1, '#840');
        circ(0, -12, 3.5, reactorGrad);

        // Main Cockpit Canopy (Gold glass capsule)
        poly([[0, 8], [6, 18], [6, 32], [0, 42], [-6, 32], [-6, 18]], '#222');
        let goldGrad = ctx.createLinearGradient(-5, 10, 5, 40);
        goldGrad.addColorStop(0, '#940');
        goldGrad.addColorStop(0.3, '#f90');
        goldGrad.addColorStop(0.5, '#ff0');
        goldGrad.addColorStop(0.7, '#da2');
        goldGrad.addColorStop(1, '#320');
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, 10);
        ctx.bezierCurveTo(5, 15, 5, 34, 0, 40);
        ctx.bezierCurveTo(-5, 34, -5, 15, 0, 10);
        ctx.closePath();
        ctx.fillStyle = goldGrad;
        ctx.fill();
        ctx.restore();
        // Canopy frame overlay
        line([[0, 10], [0, 40]], 'rgba(0, 0, 0, 0.45)', 0.8);
        line([[-4, 25], [4, 25]], 'rgba(0, 0, 0, 0.3)', 0.8);

        // 5. Mid Wings (Horizontal tabs with triple fire support barrels)
        // Left Mid-Wing (Contrast dark)
        poly([
            [-11, 0],       // body attachment front
            [-46, 0],       // outer wing front
            [-46, 14],      // outer wing rear
            [-11, 14]       // body attachment rear
        ], dark);
        poly([[-28, 2], [-44, 2], [-44, 12], [-28, 12]], metal); // Metal recess
        // 3 gun barrels/nozzles (vertical)
        poly([[-48, -6], [-44, -6], [-44, 18], [-48, 18]], '#333');
        poly([[-42, -6], [-38, -6], [-38, 18], [-42, 18]], '#333');
        poly([[-36, -6], [-32, -6], [-32, 18], [-36, 18]], '#333');
        line([[-46, 0], [-11, 0]], 'rgba(255, 255, 255, 0.3)', 1);

        // Right Mid-Wing (Contrast dark)
        poly([
            [11, 0],
            [46, 0],
            [46, 14],
            [11, 14]
        ], dark);
        poly([[28, 2], [44, 2], [44, 12], [28, 12]], metal);
        // 3 gun barrels/nozzles (vertical)
        poly([[48, -6], [44, -6], [44, 18], [48, 18]], '#333');
        poly([[42, -6], [38, -6], [38, 18], [42, 18]], '#333');
        poly([[36, -6], [32, -6], [32, 18], [36, 18]], '#333');
        line([[46, 0], [11, 0]], 'rgba(255, 255, 255, 0.3)', 1);

        // 6. Rear Swept Wings (Large heavy primary stabilizers)
        // Left Rear Wing
        poly([
            [-11, 28],      // wing root front
            [-55, 45],      // sweep transition
            [-80, 52],      // wingtip corner outer
            [-74, 58],      // wingtip trailing notch
            [-12, 54]       // wing root trailing
        ], hull);
        // Left Wing Signature Color Slash (now dark contrast)
        poly([
            [-55, 45],
            [-80, 52],
            [-76, 56],
            [-53, 49]
        ], dark);
        // Left Rear Wing White Highlight Line
        line([[-11, 35], [-76, 53]], panel, 1.2);

        // Right Rear Wing
        poly([
            [11, 28],
            [55, 45],
            [80, 52],
            [74, 58],
            [12, 54]
        ], hull);
        // Right Wing Signature Color Slash (now dark contrast)
        poly([
            [55, 45],
            [80, 52],
            [76, 56],
            [53, 49]
        ], dark);
        // Right Rear Wing White Highlight Line
        line([[11, 35], [76, 53]], panel, 1.2);

        // 7. Wingtip Vertical Stabilizers (Fences)
        // Left vertical wingtip plate
        poly([
            [-80, 52],      // wingtip connect
            [-84, 25],      // forward vertical stabilizer point
            [-84, 65],      // rear vertical stabilizer point
            [-78, 54]
        ], dark);
        // Left Winglet details (accent color on tip, white highlight line)
        poly([[-83, 30], [-84, 25], [-81, 28]], metal);
        poly([[-83, 60], [-84, 65], [-81, 62]], metal);
        line([[-82, 30], [-82, 60]], 'rgba(255, 255, 255, 0.45)', 1);
        line([[-84, 20], [-84, 70]], s, 2.5); // Wingtip launcher rail
        circ(-84, 20, 2, s, 0.9); // tip sensor node

        // Right vertical wingtip plate
        poly([
            [80, 52],
            [84, 25],
            [84, 65],
            [78, 54]
        ], dark);
        // Right Winglet details
        poly([[83, 30], [84, 25], [81, 28]], metal);
        poly([[83, 60], [84, 65], [81, 62]], metal);
        line([[82, 30], [82, 60]], 'rgba(255, 255, 255, 0.45)', 1);
        line([[84, 20], [84, 70]], s, 2.5);
        circ(84, 20, 2, s, 0.9);

        // 8. Heavy Rear Tail Fins (Forked stabilizers - 3 Spikes total matching image)
        poly([[-11, 48], [-14, 88], [-7, 88], [-3, 48]], hull);
        poly([[11, 48], [14, 88], [7, 88], [3, 48]], hull);
        // Central long tail spike
        poly([[-4, 48], [4, 48], [0, 102]], hull);
        // Accent stripes on tail
        line([[-10, 55], [-12, 80]], 'rgba(255,255,255,0.45)', 1.2);
        line([[10, 55], [12, 80]], 'rgba(255,255,255,0.45)', 1.2);
        line([[0, 48], [0, 96]], 'rgba(255,255,255,0.45)', 1.2);

        // 9. Twin Heavy Engine Assembly (Nacelles & Exhaust Glow)
        // Left Engine Pod (Nacelle)
        poly([[-36, 42], [-22, 42], [-20, 56], [-38, 56]], dark);
        poly([[-35, 56], [-23, 56], [-22, 65], [-36, 65]], '#111'); // Exhaust nozzle
        // circ(-29, 65, 6, s, 0.85); // propulsion glow (removed)
        // circ(-29, 65, 2, '#fff', 0.6);

        // Right Engine Pod (Nacelle)
        poly([[36, 42], [22, 42], [20, 56], [38, 56]], dark);
        poly([[35, 56], [23, 56], [22, 65], [36, 65]], '#111');
        // circ(29, 65, 6, s, 0.85); (removed)
        // circ(29, 65, 2, '#fff', 0.6);


    } else if (shape === 'bomber') {
        // --- BOMBER: wide stealth flying wing ---
        const hull = '#20231f';
        const shade = p;
        const deep = '#10110f';
        const panel = p;

        ctx.save();
        ctx.shadowBlur = 7 / sc;
        ctx.shadowColor = p;

        // Main B-2 style flying wing with the reference's long triangular spread.
        poly([
            [0, -44],
            [62, 5],
            [112, 45],
            [96, 55],
            [52, 24],
            [26, 46],
            [16, 34],
            [0, 52],
            [-16, 34],
            [-26, 46],
            [-52, 24],
            [-96, 55],
            [-112, 45],
            [-62, 5]
        ], hull);

        // Layered wing bands and darker trailing notches.
        poly([[-62, 5], [-106, 43], [-95, 50], [-50, 18]], shade, 0.78);
        poly([[62, 5], [106, 43], [95, 50], [50, 18]], shade, 0.78);
        poly([[-47, 16], [-25, 36], [-34, 43], [-58, 25]], deep, 0.85);
        poly([[47, 16], [25, 36], [34, 43], [58, 25]], deep, 0.85);
        poly([[-86, 38], [-104, 47], [-96, 55], [-78, 46]], panel, 0.55);
        poly([[86, 38], [104, 47], [96, 55], [78, 46]], panel, 0.55);

        // Raised center fuselage and cockpit ridge.
        poly([[0, -44], [14, -30], [18, 34], [0, 52], [-18, 34], [-14, -30]], shade, 0.88);
        poly([[0, -40], [9, -28], [8, -7], [4, 1], [0, 5], [-4, 1], [-8, -7], [-9, -28]], '#090a09', 0.95);
        line([[-10, -29], [-10, 28]], panel, 1);
        line([[10, -29], [10, 28]], panel, 1);
        line([[0, -40], [0, 45]], '#171916', 1.1);

        // Twin intake/engine blocks like the two dark structures in the reference.
        poly([[-28, -5], [-17, -5], [-16, 26], [-30, 30], [-33, 10]], deep);
        poly([[28, -5], [17, -5], [16, 26], [30, 30], [33, 10]], deep);
        poly([[-26, -2], [-18, -2], [-18, 5], [-26, 5]], '#050505', 0.95);
        poly([[26, -2], [18, -2], [18, 5], [26, 5]], '#050505', 0.95);
        line([[-29, 2], [-20, 6]], p, 1.2);
        line([[29, 2], [20, 6]], p, 1.2);

        // Cockpit windows and subtle surface details.
        poly([[-6, -29], [-2, -31], [-2, -24], [-7, -24]], '#050505');
        poly([[6, -29], [2, -31], [2, -24], [7, -24]], '#050505');
        line([[-62, 5], [-28, 31]], p, 1.2);
        line([[62, 5], [28, 31]], p, 1.2);
        line([[-50, 18], [-6, 41]], '#151713', 1);
        line([[50, 18], [6, 41]], '#151713', 1);
        circ(0, 22, 1.8, p, 0.75);

        // Rear exhaust glow (removed)
        // circ(-18, 43, 4, p, 0.55);
        // circ(18, 43, 4, p, 0.55);
        ctx.restore();

    } else if (shape === 'speeder') {
        // --- SPEEDER: needle-wing blackbird ---
        const hull = p;
        const dark = '#101820';
        const glass = '#05070a';
        const panel = '#27313a';

        ctx.save();
        ctx.shadowBlur = 8 / sc;
        ctx.shadowColor = p;

        // Tall central needle fuselage from the reference.
        poly([[0, -76], [9, -56], [12, -8], [9, 38], [4, 66], [0, 78], [-4, 66], [-9, 38], [-12, -8], [-9, -56]], hull);
        poly([[0, -72], [6, -55], [6, -17], [3, -4], [0, 0], [-3, -4], [-6, -17], [-6, -55]], glass, 0.94);
        line([[0, -74], [0, 70]], dark, 1);

        // Broad lower swept wings.
        poly([[-10, -8], [-32, 8], [-55, 52], [-44, 62], [-16, 42], [-7, 18]], hull);
        poly([[10, -8], [32, 8], [55, 52], [44, 62], [16, 42], [7, 18]], hull);
        poly([[-31, 11], [-52, 51], [-42, 56], [-22, 25]], dark, 0.58);
        poly([[31, 11], [52, 51], [42, 56], [22, 25]], dark, 0.58);

        // Side engine nacelles and pointed intake caps.
        poly([[-27, 2], [-17, 2], [-13, 56], [-25, 62], [-32, 49]], hull);
        poly([[27, 2], [17, 2], [13, 56], [25, 62], [32, 49]], hull);
        poly([[-25, -14], [-18, 2], [-29, 2]], hull);
        poly([[25, -14], [18, 2], [29, 2]], hull);
        poly([[-25, 8], [-18, 8], [-17, 46], [-26, 49]], dark, 0.65);
        poly([[25, 8], [18, 8], [17, 46], [26, 49]], dark, 0.65);

        // Lower center body and sharp tail spike.
        poly([[-11, 24], [0, 14], [11, 24], [10, 66], [0, 82], [-10, 66]], dark, 0.82);
        poly([[-6, 29], [0, 22], [6, 29], [5, 62], [0, 70], [-5, 62]], glass, 0.86);
        poly([[-4, 68], [0, 88], [4, 68], [0, 78]], hull);

        // Cockpit windows and panel lines.
        poly([[-4, -44], [-1, -46], [-1, -36], [-5, -36]], '#9fb8b6', 0.5);
        poly([[4, -44], [1, -46], [1, -36], [5, -36]], '#9fb8b6', 0.5);
        line([[-9, -8], [-17, 42]], panel, 1);
        line([[9, -8], [17, 42]], panel, 1);
        line([[-37, 24], [-48, 54]], dark, 1.3);
        line([[37, 24], [48, 54]], dark, 1.3);
        line([[-5, 31], [-8, 61]], p, 1.2);
        line([[5, 31], [8, 61]], p, 1.2);

        // Compact exhaust glow (removed)
        // circ(0, 82, 3.5, p, 0.85);
        // circ(-22, 60, 3.5, p, 0.6);
        // circ(22, 60, 3.5, p, 0.6);
        ctx.restore();

    } else if (shape === 'stealth') {
        // --- STEALTH: Dual Nose-Cone Stealth Striker (Reference Image Match) ---
        const hull = p; // Chosen color is the major body color
        const dark = '#1a1f26'; // Deep dark panels
        const metal = '#2e3542'; // Metallic accent plates
        const panel = 'rgba(255, 255, 255, 0.35)'; // White panel outlines
        const glass = '#0a0d14'; // Cockpit glass

        ctx.save();
        ctx.shadowBlur = 8 / sc;
        ctx.shadowColor = p;

        // 1. Two Long Parallel Nose Cones (extending far forward)
        // Left Nose Cone
        poly([
            [-17, -90],     // Sharp nose tip
            [-5, -90],
            [-5, 38],
            [-17, 38]
        ], hull);
        // Left Nose Cone Dark Panel overlay
        poly([[-14, -68], [-8, -68], [-8, 28], [-14, 28]], dark);
        line([[-11, -68], [-11, 28]], panel, 0.8);

        // Right Nose Cone
        poly([
            [5, -90],       // Sharp nose tip
            [17, -90],
            [17, 38],
            [5, 38]
        ], hull);
        // Right Nose Cone Dark Panel overlay
        poly([[8, -68], [14, -68], [14, 28], [8, 28]], dark);
        line([[11, -68], [11, 28]], panel, 0.8);

        // 2. Central Fuselage Core (between the nose cones)
        poly([
            [-5, -45],
            [5, -45],
            [7, 24],
            [0, 30],
            [-7, 24]
        ], dark);
        // Central body accent panel
        poly([
            [-3, -40],
            [3, -40],
            [4, 18],
            [0, 22],
            [-4, 18]
        ], hull);

        // 3. Cockpit Canopy (on the central fuselage)
        poly([[-3, -15], [3, -15], [3, 10], [-3, 10]], glass);
        let canopyGrad = ctx.createLinearGradient(-3, -14, 3, 8);
        canopyGrad.addColorStop(0, '#0c1822');
        canopyGrad.addColorStop(0.4, '#3a4e5e');
        canopyGrad.addColorStop(0.7, '#7a8e98');
        canopyGrad.addColorStop(1, '#060a0e');
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.bezierCurveTo(3, -12, 3, 5, 0, 8);
        ctx.bezierCurveTo(-3, 5, -3, -12, 0, -14);
        ctx.closePath();
        ctx.fillStyle = canopyGrad;
        ctx.fill();
        ctx.restore();
        line([[0, -14], [0, 8]], 'rgba(255,255,255,0.2)', 0.6);

        // 4. Large Swept-Back Main Wings with Hooked Tips
        // LEFT WING
        poly([
            [-17, -25],     // Wing root leading
            [-72, -10],     // Wingtip leading edge
            [-72, 0],       // Wingtip trailing
            [-17, 20]       // Wing root trailing
        ], hull);
        // Left Wing Tip Hook (forward-swept crescent)
        poly([
            [-72, -10],
            [-86, -10],
            [-86, -20],
            [-80, -22],
            [-72, -12]
        ], dark);
        poly([[-84, -12], [-86, -10], [-84, -18]], hull); // Highlight tip
        // Left Wing dark panel inlay
        poly([[-17, -15], [-68, -8], [-68, -2], [-17, 10]], dark);
        // Left Wing panel lines
        line([[-17, -20], [-70, -9]], panel, 1);
        line([[-17, 5], [-68, -5]], panel, 0.8);

        // RIGHT WING
        poly([
            [17, -25],
            [72, -10],
            [72, 0],
            [17, 20]
        ], hull);
        // Right Wing Tip Hook (forward-swept crescent)
        poly([
            [72, -10],
            [86, -10],
            [86, -20],
            [80, -22],
            [72, -12]
        ], dark);
        poly([[84, -12], [86, -10], [84, -18]], hull);
        // Right Wing dark panel inlay
        poly([[17, -15], [68, -8], [68, -2], [17, 10]], dark);
        // Right Wing panel lines
        line([[17, -20], [70, -9]], panel, 1);
        line([[17, 5], [68, -5]], panel, 0.8);

        // 5. Stabilizers (rear diagonal winglets pointing outward/back)
        // Left Stabilizer
        poly([[-17, 15], [-35, 38], [-30, 42], [-17, 30]], hull);
        poly([[-28, 30], [-35, 38], [-30, 42], [-25, 38]], dark); // Dark tip
        // Right Stabilizer
        poly([[17, 15], [35, 38], [30, 42], [17, 30]], hull);
        poly([[28, 30], [35, 38], [30, 42], [25, 38]], dark);

        // 6. Extremely Long Tail Columns (extending far backward)
        // Left Tail Column
        poly([
            [-14, 20],
            [-10, 20],
            [-10, 110],
            [-14, 110]
        ], hull);
        poly([[-13, 30], [-11, 30], [-11, 105], [-13, 105]], dark); // Dark accent strip
        // Right Tail Column
        poly([
            [10, 20],
            [14, 20],
            [14, 110],
            [10, 110]
        ], hull);
        poly([[11, 30], [13, 30], [13, 105], [11, 105]], dark);

        // 7. Mechanical Detailing & Panel Lines
        line([[0, -45], [0, -18]], panel, 0.8);
        line([[0, 12], [0, 28]], panel, 0.8);
        poly([[-4, 26], [4, 26], [2, 38], [-2, 38]], dark); // Engine nozzle casing

        ctx.restore();

    } else if (shape === 'titan') {
        // --- TITAN: vertical transform fighter ---
        const hull = p;
        const dark = '#05070a';
        const metal = '#161b22';
        const panel = '#2d3640';

        ctx.save();
        ctx.shadowBlur = 9 / sc;
        ctx.shadowColor = p;

        // Tall center torso and cockpit head.
        poly([[0, -74], [12, -60], [15, -38], [8, -22], [0, -16], [-8, -22], [-15, -38], [-12, -60]], hull);
        poly([[0, -68], [7, -58], [5, -43], [0, -37], [-5, -43], [-7, -58]], '#e8eef2', 0.55);
        poly([[-9, -36], [0, -47], [9, -36], [9, -8], [3, 2], [0, 4], [-3, 2], [-9, -8]], dark, 0.95);

        // Shoulder armor and compact chest.
        poly([[-19, -36], [-8, -25], [-10, 6], [-25, 14], [-31, -8]], hull);
        poly([[19, -36], [8, -25], [10, 6], [25, 14], [31, -8]], hull);
        poly([[-10, -9], [0, -15], [10, -9], [8, 25], [0, 36], [-8, 25]], metal, 0.92);
        line([[-7, -5], [-4, 26]], p, 1.2);
        line([[7, -5], [4, 26]], p, 1.2);

        // Large vertical side pods from the reference silhouette.
        poly([[-46, -78], [-34, -76], [-30, -13], [-39, 25], [-51, 18], [-54, -42]], dark);
        poly([[46, -78], [34, -76], [30, -13], [39, 25], [51, 18], [54, -42]], dark);
        poly([[-42, -72], [-36, -70], [-34, -16], [-40, 13], [-46, 8], [-49, -38]], hull, 0.42);
        poly([[42, -72], [36, -70], [34, -16], [40, 13], [46, 8], [49, -38]], hull, 0.42);

        // Outward swept winglets.
        poly([[-53, -30], [-86, -10], [-72, 2], [-49, -4]], hull);
        poly([[53, -30], [86, -10], [72, 2], [49, -4]], hull);
        poly([[-58, -18], [-88, 8], [-63, 5]], dark, 0.85);
        poly([[58, -18], [88, 8], [63, 5]], dark, 0.85);

        // Mechanical arm struts and inner weapon fins.
        line([[-27, -21], [-39, 4]], panel, 3);
        line([[27, -21], [39, 4]], panel, 3);
        line([[-18, -4], [-31, 24]], hull, 2.4);
        line([[18, -4], [31, 24]], hull, 2.4);
        poly([[-25, 17], [-15, 29], [-20, 43], [-31, 29]], dark);
        poly([[25, 17], [15, 29], [20, 43], [31, 29]], dark);

        // Long central lower spine / legs.
        poly([[-7, 25], [0, 38], [7, 25], [8, 84], [0, 112], [-8, 84]], hull);
        poly([[-3, 34], [0, 45], [3, 34], [3, 86], [0, 101], [-3, 86]], dark, 0.88);
        line([[0, 36], [0, 106]], panel, 1);

        // Foot-like rear stabilizers.
        poly([[-9, 84], [-33, 104], [-30, 119], [-5, 103]], hull);
        poly([[9, 84], [33, 104], [30, 119], [5, 103]], hull);
        poly([[-28, 102], [-49, 112], [-31, 114]], dark);
        poly([[28, 102], [49, 112], [31, 114]], dark);

        // Small highlights, vents, and exhaust glow.
        line([[-45, -58], [-39, 12]], p, 1);
        line([[45, -58], [39, 12]], p, 1);
        line([[-13, -33], [-24, 5]], panel, 1);
        line([[13, -33], [24, 5]], panel, 1);
        circ(-8, -52, 1.9, dark, 0.95);
        circ(8, -52, 1.9, dark, 0.95);
        // circ(0, 113, 4.5, p, 0.85); (removed)
        // circ(-30, 118, 3.5, p, 0.55);
        // circ(30, 118, 3.5, p, 0.55);
        ctx.restore();
    } else if (shape === 'vintage') {
        // --- VINTAGE: Steampunk Glider Ship (Reference Image Match) ---
        const hull = '#2b2621'; // Dark metallic bronze/copper
        const shade = '#1c1815'; // Very dark/shaded bronze
        const metal = '#4e4138'; // Medium metal grey/bronze
        const panel = 'rgba(255, 255, 255, 0.45)'; // Semi-transparent white highlights
        const glass = '#0f0a05'; // Dark copper-tinted cockpit backing

        ctx.save();
        ctx.shadowBlur = 8 / sc;
        ctx.shadowColor = p;

        // 1. Long Central Lower Spine / Tail Boom
        poly([[-3, 20], [3, 20], [2, 100], [-2, 100]], hull);
        line([[0, 20], [0, 96]], panel, 1);

        // 2. Tail Gear/Pulley Joint & Fan-Feather Stabilizers (Steampunk bird tail)
        // Draw tail gear outline
        ctx.strokeStyle = p;
        ctx.lineWidth = 1.5 / sc;
        ctx.beginPath();
        ctx.arc(0, 100, 10, 0, Math.PI * 2);
        ctx.stroke();
        // Spokes inside the gear
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
            line([[0, 100], [10 * Math.sin(a), 100 + 10 * Math.cos(a)]], p, 1);
        }
        // Center hub
        circ(0, 100, 3, p);

        // Fan tail stabilizers (feathers) radiating from tail gear
        poly([[0, 100], [-15, 130], [0, 140], [15, 130]], p);
        poly([[0, 100], [-30, 120], [-15, 130]], p, 0.7);
        poly([[0, 100], [30, 120], [15, 130]], p, 0.7);
        // Highlight rib lines for tail feathers
        line([[0, 100], [-30, 120]], 'rgba(255,255,255,0.7)', 1.2);
        line([[0, 100], [-15, 130]], 'rgba(255,255,255,0.7)', 1.2);
        line([[0, 100], [0, 140]], 'rgba(255,255,255,0.7)', 1.2);
        line([[0, 100], [15, 130]], 'rgba(255,255,255,0.7)', 1.2);
        line([[0, 100], [30, 120]], 'rgba(255,255,255,0.7)', 1.2);

        // 3. Central Bird/Insect Fuselage
        poly([[-12, -45], [12, -45], [16, -20], [16, 20], [8, 40], [-8, 40], [-16, 20], [-16, -20]], hull);
        poly([[-8, -40], [8, -40], [11, -20], [11, 15], [6, 30], [-6, 30], [-11, 15], [-11, -20]], shade);

        // Vertical mechanical strip overlays
        poly([[-3, -45], [3, -45], [3, 40], [-3, 40]], metal);
        line([[-3, -45], [-3, 40]], panel, 0.8);
        line([[3, -45], [3, 40]], panel, 0.8);

        // Canopy (Steampunk glass with brass ring)
        poly([[-6, -30], [6, -30], [8, -15], [8, 5], [0, 15], [-8, 5], [-8, -15]], glass);
        let brassGrad = ctx.createLinearGradient(-6, -30, 8, 15);
        brassGrad.addColorStop(0, '#e5a93b'); // Brass gold
        brassGrad.addColorStop(0.5, '#ffd700'); // Glowing gold
        brassGrad.addColorStop(1, '#8b5a2b'); // Dark bronze
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, -28);
        ctx.bezierCurveTo(5.5, -24, 5.5, 0, 0, 10);
        ctx.bezierCurveTo(-5.5, 0, -5.5, -24, 0, -28);
        ctx.closePath();
        ctx.fillStyle = brassGrad;
        ctx.fill();
        ctx.strokeStyle = '#e5a93b';
        ctx.lineWidth = 1.5 / sc;
        ctx.stroke();
        ctx.restore();

        // 4. Large Circular Wing joints (Wheels/Gears)
        for (let side of [-1, 1]) {
            const cx = side * 28;
            const cy = -25;

            // Arched safety brace/guard above the gear wheel
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 2 / sc;
            ctx.beginPath();
            ctx.arc(cx, cy, 16, -Math.PI, 0);
            ctx.stroke();
            ctx.restore();

            // Main joint gear base
            circ(cx, cy, 12, shade);

            // Gear outer ring outline
            ctx.strokeStyle = p;
            ctx.lineWidth = 1.8 / sc;
            ctx.beginPath();
            ctx.arc(cx, cy, 12, 0, Math.PI * 2);
            ctx.stroke();

            // Spokes inside the gear
            for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
                line([[cx, cy], [cx + 12 * Math.sin(a), cy + 12 * Math.cos(a)]], p, 1);
            }

            // Gear center hub
            circ(cx, cy, 4, p);

            // Connective mechanical arm/hinge from body to gear
            poly([[side * 12, -28], [cx, cy - 2], [cx, cy + 2], [side * 12, -22]], metal);
            line([[side * 12, -25], [cx, cy]], panel, 1);
        }

        // 5. Steampunk Glider Wings (Multi-feather panels)
        // Left Glider Wing
        // Rib 1 (Leading Edge)
        poly([[-28, -25], [-110, -25], [-95, -5]], p);
        // Rib 2
        poly([[-28, -25], [-95, -5], [-75, 10]], p, 0.85);
        // Rib 3
        poly([[-28, -25], [-75, 10], [-55, 20]], p, 0.7);
        // Rib 4
        poly([[-28, -25], [-55, 20], [-35, 25]], p, 0.55);

        // Left Wing Highlight Rib Lines
        line([[-28, -25], [-110, -25]], 'rgba(255,255,255,0.85)', 1.5);
        line([[-28, -25], [-95, -5]], 'rgba(255,255,255,0.7)', 1.2);
        line([[-28, -25], [-75, 10]], 'rgba(255,255,255,0.7)', 1.2);
        line([[-28, -25], [-55, 20]], 'rgba(255,255,255,0.7)', 1.2);
        line([[-28, -25], [-35, 25]], 'rgba(255,255,255,0.7)', 1.2);

        // Right Glider Wing (Mirror)
        // Rib 1 (Leading Edge)
        poly([[28, -25], [110, -25], [95, -5]], p);
        // Rib 2
        poly([[28, -25], [95, -5], [75, 10]], p, 0.85);
        // Rib 3
        poly([[28, -25], [75, 10], [55, 20]], p, 0.7);
        // Rib 4
        poly([[28, -25], [55, 20], [35, 25]], p, 0.55);

        // Right Wing Highlight Rib Lines
        line([[28, -25], [110, -25]], 'rgba(255,255,255,0.85)', 1.5);
        line([[28, -25], [95, -5]], 'rgba(255,255,255,0.7)', 1.2);
        line([[28, -25], [75, 10]], 'rgba(255,255,255,0.7)', 1.2);
        line([[28, -25], [55, 20]], 'rgba(255,255,255,0.7)', 1.2);
        line([[28, -25], [35, 25]], 'rgba(255,255,255,0.7)', 1.2);

        ctx.restore();
    }
    ctx.restore();
}


function animateScreenIn(screenElement) {
    if (typeof anime === 'undefined') return;

    // Reset styles for animation
    const title = screenElement.querySelector('h1');
    const contentGroups = screenElement.querySelectorAll('.controls-info, .player-customization, .option-group');
    const buttons = screenElement.querySelectorAll('button:not(.color-select):not(.shape-select)'); // Main buttons
    const rhombus = screenElement.querySelector('.rhombus-container');

    // Animate Rhombus Container if it exists
    if (rhombus) {
        anime({
            targets: rhombus,
            opacity: [0, 1],
            scale: [0.5, 1],
            rotate: [15, 0],
            duration: 1000,
            easing: 'easeOutElastic(1, .6)'
        });
    }

    // Animate Title
    if (title) {
        anime({
            targets: title,
            opacity: [0, 1],
            translateY: [-50, 0],
            scale: [0.8, 1],
            duration: 800,
            easing: 'easeOutElastic(1, .6)',
            delay: 200
        });
    }

    // Animate Content Groups (Info, Customization)
    if (contentGroups.length > 0) {
        anime({
            targets: contentGroups,
            opacity: [0, 1],
            translateY: [30, 0],
            duration: 600,
            easing: 'easeOutCubic',
            delay: anime.stagger(100, { start: 400 })
        });
    }

    // Animate Main Action Buttons
    if (buttons.length > 0) {
        anime({
            targets: buttons,
            opacity: [0, 1],
            translateY: [20, 0],
            scale: [0.5, 1],
            duration: 800,
            easing: 'easeOutElastic(1, .5)',
            delay: anime.stagger(100, { start: 500 })
        });
    }

    // Special staggered entry for color/shape/control options if we want extra detail
    const smallOptions = screenElement.querySelectorAll('.color-select, .shape-select');
    if (smallOptions.length > 0) {
        anime({
            targets: smallOptions,
            opacity: [0, 1],
            scale: [0, 1],
            duration: 400,
            easing: 'easeOutBack',
            delay: anime.stagger(20, { start: 500 })
        });
    }
}

function animateBlackHole() {
    if (typeof anime === 'undefined') return;

    // Gentle floating for the whole container
    anime({
        targets: '.black-hole-container',
        translateY: [-10, 10],
        translateX: [-5, 5],
        duration: 5000,
        direction: 'alternate',
        loop: true,
        easing: 'easeInOutSine'
    });

    // Purple nebula arm — slow clockwise spin
    anime({
        targets: '.nebula-swirl.purple',
        rotate: ['0deg', '360deg'],
        duration: 18000,
        loop: true,
        easing: 'linear'
    });

    // Orange nebula arm — slightly faster counter-clockwise spin
    anime({
        targets: '.nebula-swirl.orange',
        rotate: ['0deg', '-360deg'],
        duration: 13000,
        loop: true,
        easing: 'linear'
    });

    // Photon ring pulsing glow
    anime({
        targets: '.accretion-disk',
        boxShadow: [
            { value: '0 0 0 6px rgba(255,200,60,0.9), 0 0 0 12px rgba(255,140,0,0.5), 0 0 0 22px rgba(255,80,0,0.3), 0 0 50px 20px rgba(255,100,0,0.4), 0 0 90px 40px rgba(200,50,0,0.2)' },
            { value: '0 0 0 8px rgba(255,220,80,1.0), 0 0 0 16px rgba(255,160,0,0.7), 0 0 0 28px rgba(255,100,0,0.5), 0 0 70px 30px rgba(255,120,0,0.6), 0 0 120px 55px rgba(220,70,0,0.3)' }
        ],
        duration: 2500,
        direction: 'alternate',
        loop: true,
        easing: 'easeInOutQuad'
    });

    // Black hole core — subtle breathe + inner glow pulse
    anime({
        targets: '.black-hole',
        scale: [1, 1.05],
        boxShadow: [
            { value: '0 0 0 3px rgba(255,180,40,0.6), 0 0 20px 6px rgba(255,100,0,0.5), inset 0 0 30px rgba(0,0,0,1)' },
            { value: '0 0 0 5px rgba(255,210,60,0.9), 0 0 35px 12px rgba(255,130,0,0.8), inset 0 0 30px rgba(0,0,0,1)' }
        ],
        duration: 2800,
        direction: 'alternate',
        loop: true,
        easing: 'easeInOutSine'
    });

    // Outer gravitational lens — slow pulsing ring
    anime({
        targets: '.event-horizon',
        scale: [1, 1.08],
        opacity: [0.6, 1],
        duration: 4000,
        direction: 'alternate',
        loop: true,
        easing: 'easeInOutSine'
    });
}

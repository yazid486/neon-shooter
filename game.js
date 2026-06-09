let canvas;
let ctx;

// Game State
let gameLoopId;
let lastTime = 0;
let isGameOver = false;
let isPlaying = false;
let isPaused = false;
let gameOverTimeout;

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
        const maxSpeed = 5.5;
        if (currentSpeed > maxSpeed) {
            this.vx = (this.vx / currentSpeed) * maxSpeed;
            this.vy = (this.vy / currentSpeed) * maxSpeed;
        }

        // Apply Velocity
        this.x += this.vx;
        this.y += this.vy;

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

        // Shooting
        if (keys[this.controls.shoot]) {
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

        // Draw Trail
        if (this.trail.length > 1) {
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
let shipPreviewCanvases = {};
// Initialize Players
function initPlayers() {
    players = [
        new Player(canvas.width / 3, canvas.height - 100, '#1c2c48', {
            up: 'w', down: 's', left: 'a', right: 'd', shoot: ' '
        }, 1),
        new Player(2 * canvas.width / 3, canvas.height - 100, '#91211c', {
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
        shipPreviewCanvases = {
            1: document.getElementById('p1-ship-preview'),
            2: document.getElementById('p2-ship-preview')
        };

        const resumeBtn = document.getElementById('resume-btn');
        const quitBtn = document.getElementById('quit-btn');

        // Resize Canvas
        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            if (!isPlaying && players.length > 0) {
                players[0].x = canvas.width / 3;
                players[0].y = canvas.height - 100;
                players[1].x = 2 * canvas.width / 3;
                players[1].y = canvas.height - 100;
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

            if (e.code === 'Space' && !isPlaying && !isGameOver) {
                startGame();
            } else if (e.code === 'Space' && isGameOver) {
                resetGame();
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

        // Customization Logic
        document.querySelectorAll('.color-select').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const color = e.target.dataset.color;
                const playerId = parseInt(e.target.dataset.player);
                const player = players.find(p => p.id === playerId);
                if (player) player.color = color;
                document.querySelectorAll(`.color-select[data-player="${playerId}"]`).forEach(b => b.classList.remove('selected'));
                e.target.classList.add('selected');
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


        // Initialize selection UI
        players.forEach(p => {
            document.querySelector(`.color-select[data-player="${p.id}"][data-color="${p.color}"]`)?.classList.add('selected');
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
            if (startScreen) {
                startScreen.classList.remove('active');
                startScreen.classList.add('hidden');
            }
            if (gameOverScreen) gameOverScreen.classList.add('hidden');

            // Reset entities
            players[0].reset(canvas.width / 3, canvas.height - 100);
            players[1].reset(2 * canvas.width / 3, canvas.height - 100);
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

    // Spawn Enemies
    enemySpawnTimer += deltaTime;
    if (enemySpawnTimer > enemySpawnInterval) {
        spawnEnemy();
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

        // Boss Shooting Logic
        if (e.isBoss && isPlaying) {
            const now = performance.now();
            if (now - e.lastShot > e.shootDelay) {
                e.lastShot = now;
                // 10 shots/sec = 100ms delay. shootDelay set in spawnBoss.

                // Dual cannons
                [-20, 20].forEach(offset => {
                    e.bullets.push({
                        x: e.x + offset,
                        y: e.y + e.height / 2 + 10, // Center of bullet (height 20)
                        width: 8,
                        height: 20,
                        speed: 8,
                        color: '#ff0000'
                    });
                    createMuzzleFlash(e.x + offset, e.y + e.height / 2, '#ff0000');
                });
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
        bullet.y += bullet.speed;

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

        // Remove off-screen bullets
        if (bullet.y > ((canvas && canvas.height) || window.innerHeight) + 50) {
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
                // Apex Fang Dreadnought (Based on User Design)
                const w = e.width;
                const h = e.height;

                // --- 1. Base Structural Hull (Dark Metal) ---
                ctx.fillStyle = '#111';
                ctx.beginPath();
                ctx.moveTo(-w * 0.4, -h * 0.1);
                ctx.lineTo(w * 0.4, -h * 0.1);
                ctx.lineTo(w * 0.45, h * 0.2);
                ctx.lineTo(0, h * 0.45);
                ctx.lineTo(-w * 0.45, h * 0.2);
                ctx.closePath();
                ctx.fill();

                // --- 2. Massive Apex Fangs (Railgun/Claws) ---
                const drawFang = (side) => {
                    ctx.fillStyle = '#1a1a1a';
                    ctx.beginPath();
                    ctx.moveTo(side * w * 0.15, h * 0.1); // Root
                    ctx.lineTo(side * w * 0.35, h * 0.15); // Outer root
                    ctx.lineTo(side * w * 0.5, -h * 0.4);  // Blade mid
                    ctx.lineTo(side * w * 0.3, -h * 0.65); // Sharp point
                    ctx.lineTo(side * w * 0.18, -h * 0.3); // Inner edge
                    ctx.closePath();
                    ctx.fill();
                    ctx.strokeStyle = '#222';
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    // Glowing Blue Energy Rails / Vents
                    ctx.fillStyle = '#08f';
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = '#08f';
                    for (let i = 0; i < 4; i++) {
                        ctx.fillRect(side * w * 0.36 - (side * i * w * 0.03), -h * 0.1 - (i * h * 0.12), side * w * 0.06, h * 0.02);
                    }
                    ctx.shadowBlur = 0;
                };
                drawFang(1);  // Right
                drawFang(-1); // Left

                // --- 3. Heavy Layered Armor (Orange/Brown) ---
                ctx.fillStyle = '#840'; // Burnt Orange
                ctx.beginPath();
                ctx.moveTo(-w * 0.25, -h * 0.2);
                ctx.lineTo(w * 0.25, -h * 0.2);
                ctx.lineTo(w * 0.4, h * 0.1);
                ctx.lineTo(w * 0.2, h * 0.4);
                ctx.lineTo(-w * 0.2, h * 0.4);
                ctx.lineTo(-w * 0.4, h * 0.1);
                ctx.closePath();
                ctx.fill();

                // Central Nose Structure
                ctx.fillStyle = '#520';
                ctx.beginPath();
                ctx.moveTo(-w * 0.06, -h * 0.2);
                ctx.lineTo(w * 0.06, -h * 0.2);
                ctx.lineTo(w * 0.1, h * 0.4);
                ctx.lineTo(-w * 0.1, h * 0.4);
                ctx.closePath();
                ctx.fill();

                // --- 4. Central Core & Bridge ---
                ctx.fillStyle = '#080808';
                ctx.beginPath();
                ctx.arc(0, 0, w * 0.16, 0, Math.PI * 2);
                ctx.fill();

                // Pulsing Energy Heart
                const pulse = 0.5 + Math.sin(performance.now() / 200) * 0.5;
                ctx.fillStyle = `rgba(255, 0, 0, ${0.3 + pulse * 0.7})`;
                ctx.shadowBlur = 20 * pulse;
                ctx.shadowColor = '#f00';
                ctx.beginPath();
                ctx.arc(0, 0, w * 0.08, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 5;

                // Command Bridge Detail
                ctx.fillStyle = '#111';
                ctx.beginPath();
                ctx.ellipse(0, -h * 0.05, w * 0.1, h * 0.04, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#0ff';
                ctx.lineWidth = 1;
                ctx.stroke();
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
                // Standard Enemy (Bat-wing Stealth Drone - Based on User Design)
                const w = e.width;
                const h = e.height;

                ctx.rotate(Math.PI); // Rotate 180 degrees to face the player

                // Main Wing Body (Dark Base)
                ctx.fillStyle = '#111';
                ctx.beginPath();
                ctx.moveTo(0, -h * 0.5); // Nose
                ctx.lineTo(w * 0.12, -h * 0.3); // Shoulder
                ctx.lineTo(w * 0.5, h * 0.1);   // Wing Leading Tip
                ctx.lineTo(w * 0.5, h * 0.35);  // Wing Trailing Tip
                ctx.lineTo(w * 0.35, h * 0.25); // Trailing Notch 1
                ctx.lineTo(w * 0.3, h * 0.5);   // Trailing Notch 2 (Engine pod)
                ctx.lineTo(w * 0.1, h * 0.4);   // Trailing Notch 3
                ctx.lineTo(0, h * 0.45);        // Rear Center

                // Mirror Left
                ctx.lineTo(-w * 0.1, h * 0.4);
                ctx.lineTo(-w * 0.3, h * 0.5);
                ctx.lineTo(-w * 0.35, h * 0.25);
                ctx.lineTo(-w * 0.5, h * 0.35);
                ctx.lineTo(-w * 0.5, h * 0.1);
                ctx.lineTo(-w * 0.12, -h * 0.3);
                ctx.closePath();
                ctx.fill();

                // Neon Glow Edge
                ctx.strokeStyle = e.color;
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Central Ridge / Canopy
                ctx.fillStyle = '#222';
                ctx.beginPath();
                ctx.moveTo(0, -h * 0.45);
                ctx.lineTo(w * 0.12, 0);
                ctx.lineTo(0, h * 0.2);
                ctx.lineTo(-w * 0.12, 0);
                ctx.closePath();
                ctx.fill();

                // Canopy highlight
                ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                ctx.beginPath();
                ctx.moveTo(0, -h * 0.4);
                ctx.lineTo(0, h * 0.15);
                ctx.stroke();

                // Panel Lines
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.beginPath();
                ctx.moveTo(w * 0.15, -h * 0.2);
                ctx.lineTo(w * 0.1, -h * 0.15);
                ctx.moveTo(-w * 0.15, -h * 0.2);
                ctx.lineTo(-w * 0.1, -h * 0.15);
                ctx.stroke();

                // Engine Glows
                ctx.fillStyle = e.color;
                ctx.globalAlpha = 0.6 + Math.sin(performance.now() / 100) * 0.2;
                ctx.beginPath();
                ctx.arc(w * 0.125, h * 0.45, w * 0.05, 0, Math.PI * 2);
                ctx.arc(-w * 0.125, h * 0.45, w * 0.05, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1.0;
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
                ctx.fillStyle = '#ff8800'; // Orange bullets
                ctx.shadowBlur = 5;
                ctx.shadowColor = '#ff8800';
                e.bullets.forEach(b => {
                    ctx.fillRect(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);
                });
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

        if (isPaused) {
            // If paused, we basically just keep looping but don't update logic in the next frame? 
            // Actually, `update()` already checks `!isPlaying` but NOT `isPaused`.
            // Let's modify safe guard in update() or just handle it here?
            // Easiest is to prevent update() call if paused.
        }

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

        // Rocking/Wobble Effect
        enemy.rotation = 0; // Initialize rotation
        anime({
            targets: enemy,
            rotation: [-0.2, 0.2], // Rotate slightly left and right
            duration: 1000,
            direction: 'alternate',
            loop: true,
            easing: 'easeInOutQuad'
        });
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
        shootDelay: 6000, // 6 seconds
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
    if (shape === 'classic') sc = 0.32; // Normalized scale for the detailed blueprint fighter
    else if (shape === 'fighter') sc = 0.42; // Normalized scale for the extra-long fuselage
    else if (shape === 'interceptor') sc = 0.42; // Normalized scale for the extra-long twin blades
    else if (shape === 'bomber') sc = 0.4;
    else if (shape === 'speeder') sc = 0.55;
    else if (shape === 'stealth') sc = 0.6;
    else if (shape === 'titan') sc = 0.46;

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
        // --- CLASSIC: blueprint strike fighter ---
        const hull = p;
        const shade = p;
        const glass = '#07090d';
        const dark = '#171d24';
        const panel = '#89939c';

        ctx.save();
        ctx.shadowBlur = 8 / sc;
        ctx.shadowColor = p;

        // Long pointed nose and main fuselage.
        poly([[0, -86], [10, -58], [14, -18], [12, 46], [6, 82], [0, 94], [-6, 82], [-12, 46], [-14, -18], [-10, -58]], hull);
        poly([[0, -76], [7, -50], [8, -24], [4, -8], [0, -2], [-4, -8], [-8, -24], [-7, -50]], glass, 0.96);
        poly([[-8, -1], [0, -10], [8, -1], [6, 16], [0, 22], [-6, 16]], dark, 0.75);
        line([[0, -84], [0, 90]], panel, 0.9);

        // Forward shoulder wings.
        poly([[-12, -28], [-48, 12], [-42, 36], [-12, 22]], hull);
        poly([[12, -28], [48, 12], [42, 36], [12, 22]], hull);
        line([[-17, -17], [-43, 31]], panel, 1);
        line([[17, -17], [43, 31]], panel, 1);
        poly([[-37, 14], [-45, 31], [-30, 25]], dark, 0.55);
        poly([[37, 14], [45, 31], [30, 25]], dark, 0.55);

        // Large rear swept wings from the reference.
        poly([[-13, 36], [-72, 70], [-106, 124], [-94, 138], [-37, 106], [-19, 80]], hull);
        poly([[13, 36], [72, 70], [106, 124], [94, 138], [37, 106], [19, 80]], hull);
        poly([[-72, 70], [-104, 124], [-94, 132], [-61, 86]], shade, 0.55);
        poly([[72, 70], [104, 124], [94, 132], [61, 86]], shade, 0.55);
        line([[-26, 64], [-93, 130]], panel, 1.1);
        line([[26, 64], [93, 130]], panel, 1.1);
        line([[-62, 96], [-97, 131]], dark, 1.8);
        line([[62, 96], [97, 131]], dark, 1.8);

        // Twin engine blocks and lower center spine.
        poly([[-31, 50], [-12, 52], [-11, 110], [-30, 116], [-38, 86]], dark, 0.9);
        poly([[31, 50], [12, 52], [11, 110], [30, 116], [38, 86]], dark, 0.9);
        poly([[-27, 60], [-15, 61], [-15, 92], [-28, 96]], hull, 0.55);
        poly([[27, 60], [15, 61], [15, 92], [28, 96]], hull, 0.55);
        poly([[-8, 42], [0, 34], [8, 42], [8, 122], [0, 144], [-8, 122]], dark, 0.88);
        poly([[-4, 98], [0, 142], [4, 98], [0, 116]], glass, 0.96);

        // Rear fins and exhaust teeth.
        poly([[-36, 98], [-24, 116], [-26, 136], [-39, 128]], hull);
        poly([[36, 98], [24, 116], [26, 136], [39, 128]], hull);
        line([[-31, 113], [-30, 134]], panel, 1);
        line([[31, 113], [30, 134]], panel, 1);
        for (let i = 0; i < 4; i++) {
            line([[-28 + i * 5, 116], [-30 + i * 5, 127]], p, 1.1);
            line([[28 - i * 5, 116], [30 - i * 5, 127]], p, 1.1);
        }

        // Blueprint panel details.
        line([[-9, 23], [-24, 76], [-20, 111]], panel, 1);
        line([[9, 23], [24, 76], [20, 111]], panel, 1);
        line([[-50, 82], [-88, 122]], panel, 0.8);
        line([[50, 82], [88, 122]], panel, 0.8);
        circ(-8, 28, 2.2, dark, 0.8);
        circ(8, 28, 2.2, dark, 0.8);
        circ(-21, 70, 2.4, p, 0.8);
        circ(21, 70, 2.4, p, 0.8);
        circ(0, 144, 4.5, p, 0.82);
        circ(-21, 132, 4, p, 0.55);
        circ(21, 132, 4, p, 0.55);
        ctx.restore();


    } else if (shape === 'fighter') {
        // --- FIGHTER: Advanced Multi-Role Tactical Jet (Reference Image Match) ---

        // 1. Main Wings (Primary Outline & Fill)
        // Left Wing
        poly([
            [-10, -10],     // Wing root front
            [-50, 15],      // Mid-swept leading edge
            [-42, 22],      // Inner wing indent
            [-66, 22],      // Outer wing forward join
            [-66, 42],      // Outboard pod join
            [-12, 45]       // Wing root trailing edge
        ], p);
        // Right Wing
        poly([
            [10, -10],
            [50, 15],
            [42, 22],
            [66, 22],
            [66, 42],
            [12, 45]
        ], p);

        // Outer Wing Panel & Winglets (Extending from Outboard Pods)
        // Left outer wing
        poly([
            [-74, 20],      // Outer pod attachment
            [-94, 30],      // Wingtip leading tip
            [-94, 40],      // Wingtip trailing tip
            [-74, 42]       // Outer pod rear attachment
        ], p);
        // Right outer wing
        poly([
            [74, 20],
            [94, 30],
            [94, 40],
            [74, 42]
        ], p);
        // Winglets (Vertical tips)
        line([[-94, 25], [-94, 45]], s, 2);
        line([[94, 25], [94, 45]], s, 2);

        // 2. Canards (Forward swept stabilization fins)
        poly([[-8, -35], [-24, -45], [-24, -35], [-10, -25]], p);
        poly([[8, -35], [24, -45], [24, -35], [10, -25]], p);

        // 3. Outboard Engine / Missile Pods
        // Left Outboard Pod
        poly([
            [-70, 0],       // Nose tip
            [-66, 12],      // Body transition
            [-66, 45],      // Engine mount
            [-74, 45],      // Engine mount outer
            [-74, 12]       // Body transition outer
        ], '#111');
        poly([[-68, 5], [-72, 5], [-72, 40], [-68, 40]], p, 0.4); // Neon glow panel on pod
        // Left pod nose cone & nozzle
        poly([[-70, -8], [-66, 0], [-74, 0]], s); // Nose
        poly([[-68, 45], [-72, 45], [-73, 52], [-67, 52]], '#333'); // Nozzle
        
        // Right Outboard Pod
        poly([
            [70, 0],
            [66, 12],
            [66, 45],
            [74, 45],
            [74, 12]
        ], '#111');
        poly([[68, 5], [72, 5], [72, 40], [68, 40]], p, 0.4);
        poly([[70, -8], [66, 0], [74, 0]], s);
        poly([[68, 45], [72, 45], [73, 52], [67, 52]], '#333');

        // 4. Underwing Weapon/Fuel Tanks (White/Grey with details)
        // Left Tank
        poly([
            [-24, 0],       // Tank front point
            [-21, 10],      // Body
            [-21, 55],
            [-24, 60],      // Tank rear point
            [-27, 55],
            [-27, 10]
        ], '#222');
        poly([
            [-24, 5],
            [-22, 12],
            [-22, 50],
            [-24, 55],
            [-26, 50],
            [-26, 12]
        ], '#fff', 0.85);
        // Tank tail fins
        line([[-24, 55], [-29, 62]], '#aaa', 1.5);
        line([[-24, 55], [-19, 62]], '#aaa', 1.5);

        // Right Tank
        poly([
            [24, 0],
            [21, 10],
            [21, 55],
            [24, 60],
            [27, 55],
            [27, 10]
        ], '#222');
        poly([
            [24, 5],
            [22, 12],
            [22, 50],
            [24, 55],
            [26, 50],
            [26, 12]
        ], '#fff', 0.85);
        // Tank tail fins
        line([[24, 55], [29, 62]], '#aaa', 1.5);
        line([[24, 55], [19, 62]], '#aaa', 1.5);

        // 5. Main Fuselage Structure (Overlay on top of wing centers)
        poly([
            [0, -105],      // Nose tip
            [5, -75],       // Nose taper 1
            [8, -50],       // Nose taper 2 (Canard base)
            [12, -20],      // Cockpit area widest
            [10, 15],       // Mid waist indentation
            [14, 45],       // Rear engine deck
            [0, 50],        // Rear center tail joint
            [-14, 45],
            [-10, 15],
            [-12, -20],
            [-8, -50],
            [-5, -75]
        ], p);

        // Dark composite centerline plate
        poly([[0, -85], [5, -45], [7, 30], [0, 42], [-7, 30], [-5, -45]], '#111', 0.9);

        // 6. Canopy (Shaded cockpit dome to match silver gradient look)
        // Canopy casing
        poly([[0, -52], [6, -40], [6, -20], [0, -12], [-6, -20], [-6, -40]], '#222');
        
        // Metallic glass gradient canopy
        let canopyGrad = ctx.createLinearGradient(-5, -45, 5, -15);
        canopyGrad.addColorStop(0, '#333');
        canopyGrad.addColorStop(0.25, '#888');
        canopyGrad.addColorStop(0.5, '#eee');
        canopyGrad.addColorStop(0.75, '#bbb');
        canopyGrad.addColorStop(1, '#222');
        
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, -48);
        ctx.bezierCurveTo(4.5, -44, 4.5, -20, 0, -15);
        ctx.bezierCurveTo(-4.5, -20, -4.5, -44, 0, -48);
        ctx.closePath();
        ctx.fillStyle = canopyGrad;
        ctx.fill();
        ctx.restore();

        // Canopy frame details
        line([[0, -48], [0, -15]], 'rgba(0, 0, 0, 0.4)', 1);
        line([[-4, -30], [4, -30]], 'rgba(0, 0, 0, 0.3)', 1);

        // 7. Twin Rear Stabilizers (Tailplanes)
        poly([[-10, 42], [-32, 75], [-20, 80], [-6, 48]], p);
        poly([[10, 42], [32, 75], [20, 80], [6, 48]], p);

        // 8. Dual Engine Nozzles (Nozzle casing & Exhaust flaps)
        poly([[-10, 45], [-2, 45], [-1, 58], [-11, 58]], '#333');
        poly([[10, 45], [2, 45], [1, 58], [11, 58]], '#333');
        // Nozzle serrations / detail lines
        line([[-6, 45], [-6, 58]], '#111', 1);
        line([[6, 45], [6, 58]], '#111', 1);

        // Engine propulsion glow (Behind nozzle)
        circ(-6, 58, 5, s, 0.85);
        circ(6, 58, 5, s, 0.85);
        circ(-6, 58, 2, '#fff', 0.6);
        circ(6, 58, 2, '#fff', 0.6);

        // 9. Technical Panel Lines / Mechanical Etchings
        // Wing panel lines
        line([[-18, 15], [-45, 20]], 'rgba(255, 255, 255, 0.25)', 0.8);
        line([[18, 15], [45, 20]], 'rgba(255, 255, 255, 0.25)', 0.8);
        line([[-25, 28], [-42, 38]], 'rgba(255, 255, 255, 0.25)', 0.8);
        line([[25, 28], [42, 38]], 'rgba(255, 255, 255, 0.25)', 0.8);

        // Fuselage spine
        line([[0, -80], [0, -52]], 'rgba(255, 255, 255, 0.3)', 0.8);
        line([[0, -12], [0, 35]], 'rgba(255, 255, 255, 0.3)', 0.8);
        
        // Circular center cap details
        circ(0, 10, 3, s, 0.4);


    } else if (shape === 'interceptor') {
        // --- INTERCEPTOR: Twin-Blade Heavy Striker (Reference Image Match) ---

        // 1. Structural Truss Struts (Connecting cockpit center, wing roots, and pincers)
        ctx.save();
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 2.5 / sc;
        // Pincer connections
        line([[-6, -15], [-12, -45]], '#222');
        line([[6, -15], [12, -45]], '#222');
        line([[-12, 10], [-30, 5]], '#222');
        line([[12, 10], [30, 5]], '#222');
        line([[-10, 25], [-22, 10]], '#222');
        line([[10, 25], [22, 10]], '#222');
        // Outer mechanical trusses
        line([[-25, 0], [-25, 35]], '#111', 1.5);
        line([[25, 0], [25, 35]], '#111', 1.5);
        ctx.restore();

        // 2. Giant Forward Pincer Blades (Left & Right)
        // Left Pincer Blade - Outer primary color signature, inner mechanical dark plating
        // Left Pincer (Dark structural base)
        poly([
            [-32, 12],      // base outer
            [-14, 12],      // base inner
            [-10, -35],     // mid inner
            [-7, -120],     // sharp tip
            [-12, -80],     // inner tapering edge
            [-19, -40],     // mid taper outer
            [-29, -15],     // base taper outer
            [-35, 0]        // base outer corner
        ], '#1d222e');

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
        ], '#111');

        // Left Pincer (Color Signature Accent Panel - Outer Blade section)
        poly([
            [-19, -40],     // mid outer
            [-7, -120],     // tip
            [-12, -80],
            [-15, -60],
            [-22, -35],
            [-26, -20]
        ], p);

        // Right Pincer Blade (Mirror)
        // Right Pincer (Dark structural base)
        poly([
            [32, 12],
            [14, 12],
            [10, -35],
            [7, -120],
            [12, -80],
            [19, -40],
            [29, -15],
            [35, 0]
        ], '#1d222e');

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
        ], '#111');

        // Right Pincer (Color Signature Accent Panel - Outer Blade section)
        poly([
            [19, -40],
            [7, -120],
            [12, -80],
            [15, -60],
            [22, -35],
            [26, -20]
        ], p);

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
        ], '#1d222e');

        // Center spine accent
        line([[0, -55], [0, -15]], s, 1.2);
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
        // Left Mid-Wing
        poly([
            [-11, 0],       // body attachment front
            [-46, 0],       // outer wing front
            [-46, 14],      // outer wing rear
            [-11, 14]       // body attachment rear
        ], p);
        poly([[-28, 2], [-44, 2], [-44, 12], [-28, 12]], '#111'); // Dark mechanical recess
        // 3 gun barrels/nozzles (vertical)
        poly([[-48, -6], [-44, -6], [-44, 18], [-48, 18]], '#333');
        poly([[-42, -6], [-38, -6], [-38, 18], [-42, 18]], '#333');
        poly([[-36, -6], [-32, -6], [-32, 18], [-36, 18]], '#333');

        // Right Mid-Wing
        poly([
            [11, 0],
            [46, 0],
            [46, 14],
            [11, 14]
        ], p);
        poly([[28, 2], [44, 2], [44, 12], [28, 12]], '#111');
        // 3 gun barrels/nozzles (vertical)
        poly([[48, -6], [44, -6], [44, 18], [48, 18]], '#333');
        poly([[42, -6], [38, -6], [38, 18], [42, 18]], '#333');
        poly([[36, -6], [32, -6], [32, 18], [36, 18]], '#333');

        // 6. Rear Swept Wings (Large heavy primary stabilizers)
        // Left Rear Wing
        poly([
            [-11, 28],      // wing root front
            [-55, 45],      // sweep transition
            [-80, 52],      // wingtip corner outer
            [-74, 58],      // wingtip trailing notch
            [-12, 54]       // wing root trailing
        ], '#1d222e');
        // Left Wing Signature Color Slash (Orange trailing portion)
        poly([
            [-55, 45],
            [-80, 52],
            [-76, 56],
            [-53, 49]
        ], p);
        
        // Right Rear Wing
        poly([
            [11, 28],
            [55, 45],
            [80, 52],
            [74, 58],
            [12, 54]
        ], '#1d222e');
        // Right Wing Signature Color Slash (Orange trailing portion)
        poly([
            [55, 45],
            [80, 52],
            [76, 56],
            [53, 49]
        ], p);

        // 7. Wingtip Vertical Stabilizers (Fences)
        // Left vertical wingtip plate
        poly([
            [-80, 52],      // wingtip connect
            [-84, 25],      // forward vertical stabilizer point
            [-84, 65],      // rear vertical stabilizer point
            [-78, 54]
        ], '#111');
        line([[-84, 20], [-84, 70]], s, 2.5); // Wingtip launcher rail
        circ(-84, 20, 2, s, 0.9); // tip sensor node

        // Right vertical wingtip plate
        poly([
            [80, 52],
            [84, 25],
            [84, 65],
            [78, 54]
        ], '#111');
        line([[84, 20], [84, 70]], s, 2.5);
        circ(84, 20, 2, s, 0.9);

        // 8. Heavy Rear Tail Fins (Forked stabilizers)
        poly([[-11, 48], [-14, 88], [-7, 88], [-3, 48]], '#1d222e');
        poly([[11, 48], [14, 88], [7, 88], [3, 48]], '#1d222e');
        // Accent stripes on tail
        line([[-10, 55], [-12, 80]], s, 1.2);
        line([[10, 55], [12, 80]], s, 1.2);

        // 9. Twin Heavy Engine Assembly (Nacelles & Exhaust Glow)
        // Left Engine Pod (Nacelle)
        poly([[-36, 42], [-22, 42], [-20, 56], [-38, 56]], '#222');
        poly([[-35, 56], [-23, 56], [-22, 65], [-36, 65]], '#111'); // Exhaust nozzle
        circ(-29, 65, 6, s, 0.85); // propulsion glow
        circ(-29, 65, 2, '#fff', 0.6);

        // Right Engine Pod (Nacelle)
        poly([[36, 42], [22, 42], [20, 56], [38, 56]], '#222');
        poly([[35, 56], [23, 56], [22, 65], [36, 65]], '#111');
        circ(29, 65, 6, s, 0.85);
        circ(29, 65, 2, '#fff', 0.6);


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

        // Rear exhaust glow, small enough to preserve the stealth shape.
        circ(-18, 43, 4, p, 0.55);
        circ(18, 43, 4, p, 0.55);
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

        // Compact exhaust glow.
        circ(0, 82, 3.5, p, 0.85);
        circ(-22, 60, 3.5, p, 0.6);
        circ(22, 60, 3.5, p, 0.6);
        ctx.restore();

    } else if (shape === 'stealth') {
        // --- STEALTH: Raven needle interceptor ---
        const hull = p;
        const shade = p;
        const panel = '#707983';
        const glass = '#0b0d12';
        const dark = '#151a22';

        ctx.save();
        ctx.shadowBlur = 8 / sc;
        ctx.shadowColor = p;

        // Long central fuselage and nose, based on the narrow white body in the reference.
        poly([[0, -58], [12, -20], [8, 30], [4, 58], [0, 70], [-4, 58], [-8, 30], [-12, -20]], hull);
        poly([[0, -48], [8, -24], [6, 15], [0, 34], [-6, 15], [-8, -24]], shade, 0.55);
        line([[0, -58], [0, 68]], p, 0.8);

        // Tall black cockpit canopy.
        poly([[0, -54], [7, -48], [7, -14], [3, -4], [0, 0], [-3, -4], [-7, -14], [-7, -48]], glass, 0.98);
        line([[-5, -48], [-5, -16]], panel, 0.8);
        line([[5, -48], [5, -16]], panel, 0.8);

        // Small forward canards.
        poly([[-12, -30], [-25, -42], [-20, -26], [-11, -18]], hull);
        poly([[12, -30], [25, -42], [20, -26], [11, -18]], hull);
        line([[-23, -40], [-14, -20]], panel, 0.9);
        line([[23, -40], [14, -20]], panel, 0.9);

        // Angular delta wings with hooked rear tips.
        poly([[-8, -8], [-42, -6], [-62, 30], [-54, 54], [-48, 44], [-20, 12]], hull);
        poly([[8, -8], [42, -6], [62, 30], [54, 54], [48, 44], [20, 12]], hull);
        poly([[-42, -6], [-62, 30], [-55, 35], [-38, 2]], shade, 0.65);
        poly([[42, -6], [62, 30], [55, 35], [38, 2]], shade, 0.65);
        poly([[-54, 54], [-48, 44], [-42, 62], [-48, 72]], hull);
        poly([[54, 54], [48, 44], [42, 62], [48, 72]], hull);

        // Wing panel cuts and dark triangular insets.
        line([[-39, -3], [-53, 27], [-48, 44]], dark, 2);
        line([[39, -3], [53, 27], [48, 44]], dark, 2);
        line([[-8, -8], [-20, 12], [-34, 42]], panel, 1);
        line([[8, -8], [20, 12], [34, 42]], panel, 1);
        poly([[-22, 8], [-35, 22], [-18, 18]], dark, 0.65);
        poly([[22, 8], [35, 22], [18, 18]], dark, 0.65);
        line([[-23, 9], [-34, 21]], p, 1.1);
        line([[23, 9], [34, 21]], p, 1.1);

        // Rear spine, twin strakes, and engine column.
        poly([[-8, 24], [-17, 46], [-10, 44], [-5, 30]], hull);
        poly([[8, 24], [17, 46], [10, 44], [5, 30]], hull);
        poly([[-4, 35], [0, 26], [4, 35], [4, 65], [0, 74], [-4, 65]], dark);
        line([[-10, 32], [-11, 58]], panel, 1);
        line([[10, 32], [11, 58]], panel, 1);

        // Compact glowing exhausts.
        circ(0, 73, 4, p, 0.9);
        circ(-10, 58, 3.5, p, 0.6);
        circ(10, 58, 3.5, p, 0.6);
        circ(0, 73, 1.8, '#fff', 0.7);
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
        circ(0, 113, 4.5, p, 0.85);
        circ(-30, 118, 3.5, p, 0.55);
        circ(30, 118, 3.5, p, 0.55);
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

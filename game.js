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
// Input State
const keys = {};

// Entities

// Entities
class Player {
    constructor(x, y, color, controls, id) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.width = 40;
        this.height = 40;
        this.speed = 5; // Used as max speed
        this.vx = 0;
        this.vy = 0;
        this.acceleration = 0.8;
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
        const maxSpeed = 8;
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
                    speed: 10,
                    color: this.color
                });

                // Side shooter bullets
                if (this.hasSideShooters) {
                    // Left side shooter
                    this.bullets.push({
                        x: this.x - 25,
                        y: this.y + 15 - this.height / 2 - 7.5, // Center of bullet (height 15)
                        width: 4,
                        height: 15,
                        speed: 10,
                        color: this.color
                    });
                    // Right side shooter
                    this.bullets.push({
                        x: this.x + 25,
                        y: this.y + 15 - this.height / 2 - 7.5, // Center of bullet (height 15)
                        width: 4,
                        height: 15,
                        speed: 10,
                        color: this.color
                    });
                    createMuzzleFlash(this.x - 25, this.y + 15, this.color);
                    createMuzzleFlash(this.x + 25, this.y + 15, this.color);
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
            ctx.arc(this.x, this.y, 35, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;

        ctx.beginPath();
        drawPlayerShape(ctx, this.shape);

        // Fill with chosen color (solid)
        ctx.fillStyle = this.color;
        ctx.fill();

        ctx.stroke();
        ctx.restore();

        // Draw side shooters if active
        if (this.hasSideShooters) {
            ctx.save();
            ctx.strokeStyle = this.color;
            ctx.shadowBlur = 10;
            ctx.shadowColor = this.color;
            ctx.lineWidth = 1.5;

            // Left side shooter - scaled down version of player ship
            ctx.translate(this.x - 25, this.y + 15); // Moved 15 pixels behind
            ctx.scale(0.4, 0.4); // Scale down to 40% of original size
            ctx.beginPath();
            drawPlayerShape(ctx, this.shape);
            ctx.fillStyle = this.color;
            ctx.fill();
            ctx.stroke();
            ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

            // Right side shooter - scaled down version of player ship
            ctx.translate(this.x + 25, this.y + 15); // Moved 15 pixels behind
            ctx.scale(0.4, 0.4); // Scale down to 40% of original size
            ctx.beginPath();
            drawPlayerShape(ctx, this.shape);
            ctx.fillStyle = this.color;
            ctx.fill();
            ctx.stroke();

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
let enemySpawnInterval = 1000;
let enemiesKilled = 0;
let nextSideShooterAt = 30;
let nextLifeAt = 100;
let nextShieldAt = 20;
let nextBossAt = 150;

// UI Elements
let p1LivesEl;
let p2LivesEl;
let p1KillsEl;
let p2KillsEl;
let startScreen;
let gameOverScreen;
let pauseScreen;
let pauseBtn;
let livesBoard;
// Initialize Players
function initPlayers() {
    players = [
        new Player(canvas.width / 3, canvas.height - 100, '#0044ff', {
            up: 'w', down: 's', left: 'a', right: 'd', shoot: 'x'
        }, 1),
        new Player(2 * canvas.width / 3, canvas.height - 100, '#f00', {
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

// Game Initialization
function initGame() {
    try {
        console.log("Initializing Game...");

        canvas = document.getElementById('gameCanvas');
        if (!canvas) throw new Error("Canvas element not found!");
        ctx = canvas.getContext('2d');

        p1LivesEl = document.getElementById('p1-lives');
        p2LivesEl = document.getElementById('p2-lives');
        p1KillsEl = document.getElementById('p1-kills');
        p2KillsEl = document.getElementById('p2-kills');
        startScreen = document.getElementById('start-screen');
        gameOverScreen = document.getElementById('game-over-screen');
        pauseScreen = document.getElementById('pause-screen');
        pauseBtn = document.getElementById('pause-btn');
        livesBoard = document.getElementById('lives-board');

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

                // Update specific player
                const player = players.find(p => p.id === playerId);
                if (player) {
                    player.color = color;
                }

                // Update UI for this player's color buttons
                document.querySelectorAll(`.color-select[data-player="${playerId}"]`).forEach(b => b.classList.remove('selected'));
                e.target.classList.add('selected');
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



        console.log("Game initialized successfully");
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
        }
    });
} else {
    initGame();
    // Animate Start Screen on load if already ready
    if (startScreen && typeof anime !== 'undefined') {
        animateScreenIn(startScreen);
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
            nextLifeAt = 100;
            nextShieldAt = 20;
            nextBossAt = 150;
            enemySpawnInterval = 1000;

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
    // Update Stars and Planets
    if (isPlaying || isGameOver) {
        stars.forEach(s => {
            s.y += s.speed;
            if (s.y > canvas.height) {
                s.y = 0;
                s.x = Math.random() * canvas.width;
            }
        });
        planets.forEach(p => {
            p.y += p.speed;
            if (p.y > canvas.height + p.size * 2) {
                p.y = -p.size * 2;
                p.x = Math.random() * canvas.width;
                let hue = Math.floor(Math.random() * 360);
                p.hue = hue;
                p.color = `hsl(${hue}, 50%, 20%)`;
                p.size = Math.random() * 80 + 40;
                p.speed = Math.random() * 0.3 + 0.8;
                p.ring = Math.random() > 0.5;
                p.ringAngle = Math.random() * Math.PI;
            }
        });
    }

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
        if (enemySpawnInterval > 700) enemySpawnInterval -= 10;
    }

    // Update Enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
        // Check for Boss Spawn
        if (enemiesKilled >= nextBossAt && enemies.filter(e => e.isBoss).length === 0) {
            spawnBoss();
            nextBossAt += 150;
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
                e.shootDelay = 2000;

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
    // Clear screen with pure black during gameplay or game over, trail effect otherwise
    if (isPlaying || isGameOver) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

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
    } else {
        ctx.fillStyle = 'rgba(5, 5, 5, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (!isPlaying && !isGameOver) return;

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
                // Boss Shape (Menacing Mothership)
                ctx.moveTo(0, -e.height / 2);
                ctx.lineTo(e.width / 2, -e.height / 4);
                ctx.lineTo(e.width / 2, e.height / 4);
                ctx.lineTo(0, e.height / 2);
                ctx.lineTo(-e.width / 2, e.height / 4);
                ctx.lineTo(-e.width / 2, -e.height / 4);
                ctx.closePath();
                ctx.fill();

                // Boss Core
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(0, 0, e.width / 6, 0, Math.PI * 2);
                ctx.fill();
            } else if (e.isShooter) {
                // Unique Shooter Designs
                if (e.shooterType === 'striker') {
                    // Striker: Sharp arrow shape
                    ctx.moveTo(0, e.height / 2);
                    ctx.lineTo(e.width / 2, -e.height / 2);
                    ctx.lineTo(0, -e.height / 4);
                    ctx.lineTo(-e.width / 2, -e.height / 2);
                    ctx.closePath();
                    ctx.fill();

                    // Core
                    ctx.fillStyle = '#fff';
                    ctx.beginPath();
                    ctx.arc(0, 0, 4, 0, Math.PI * 2);
                    ctx.fill();
                } else if (e.shooterType === 'invader') {
                    // Invader: Blocky shape
                    ctx.fillRect(-e.width / 2, -e.height / 4, e.width, e.height / 2);
                    ctx.fillRect(-e.width / 4, -e.height / 2, e.width / 2, e.height);

                    // Eyes
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(-e.width / 3, -e.height / 6, 5, 5);
                    ctx.fillRect(e.width / 3 - 5, -e.height / 6, 5, 5);
                } else {
                    // Drone: Circular mechanical
                    ctx.beginPath();
                    ctx.arc(0, 0, e.width / 2, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(0, -e.height / 2);
                    ctx.lineTo(0, e.height / 2);
                    ctx.moveTo(-e.width / 2, 0);
                    ctx.lineTo(e.width / 2, 0);
                    ctx.stroke();
                }
            } else {
                // Standard Enemy (Hex-Fighter)
                ctx.moveTo(0, e.height / 2);
                ctx.lineTo(e.width / 2, 0);
                ctx.lineTo(e.width / 2, -e.height / 4);
                ctx.lineTo(0, -e.height / 2);
                ctx.lineTo(-e.width / 2, -e.height / 4);
                ctx.lineTo(-e.width / 2, 0);
                ctx.closePath();
                ctx.fill();

                // Enemy Core/Eye
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.beginPath();
                ctx.arc(0, 0, e.width / 6, 0, Math.PI * 2);
                ctx.fill();

                // Engine Glow
                ctx.beginPath();
                ctx.moveTo(-5, -e.height / 2);
                ctx.lineTo(5, -e.height / 2);
                ctx.lineTo(0, -e.height / 2 - 10);
                ctx.fillStyle = e.color;
                ctx.fill();
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
        draw(); // draw always

        if (isPaused) {
            // If paused, we basically just keep looping but don't update logic in the next frame? 
            // Actually, `update()` already checks `!isPlaying` but NOT `isPaused`.
            // Let's modify safe guard in update() or just handle it here?
            // Easiest is to prevent update() call if paused.
        }

        if (isPlaying || isGameOver) {
            gameLoopId = requestAnimationFrame(gameLoop);
        }
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

    // 5% chance to spawn a shooting enemy
    const isShooter = Math.random() < 0.05;
    const shooterType = isShooter ? ['striker', 'invader', 'drone'][Math.floor(Math.random() * 3)] : null;

    enemies.push({
        x: x,
        y: -50,
        width: size,
        height: size,
        speed: isShooter ? (0.8 + Math.random() * 0.5) : (1 + Math.random() * 1.5),
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
        speed: 2, // Faster entry speed
        dx: 2, // Horizontal speed
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
        speed: 2,
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

function updateLivesDisplay() {
    const hearts = ['❤️', '❤️', '❤️'];
    p1LivesEl.innerText = hearts.slice(0, players[0].lives).join('');
    p2LivesEl.innerText = hearts.slice(0, players[1].lives).join('');
}

function updateKillsDisplay() {
    p1KillsEl.innerText = players[0].kills;
    p2KillsEl.innerText = players[1].kills;
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

function drawPlayerShape(ctx, shape) {
    if (shape === 'classic') {
        // Fuselage
        ctx.moveTo(0, -20);
        ctx.lineTo(5, -10);
        ctx.lineTo(5, 10);
        ctx.lineTo(0, 20);
        ctx.lineTo(-5, 10);
        ctx.lineTo(-5, -10);
        ctx.closePath();
        // Wings
        ctx.moveTo(0, -5);
        ctx.lineTo(20, 10);
        ctx.lineTo(20, 15);
        ctx.lineTo(5, 5);
        ctx.moveTo(0, -5);
        ctx.lineTo(-20, 10);
        ctx.lineTo(-20, 15);
        ctx.lineTo(-5, 5);
        // Tail
        ctx.moveTo(0, 15);
        ctx.lineTo(8, 20);
        ctx.lineTo(-8, 20);
    } else if (shape === 'fighter') {
        // Sharp, angular design
        ctx.moveTo(0, -25);
        ctx.lineTo(10, 10);
        ctx.lineTo(25, 15);
        ctx.lineTo(10, 15);
        ctx.lineTo(0, 25);
        ctx.lineTo(-10, 15);
        ctx.lineTo(-25, 15);
        ctx.lineTo(-10, 10);
        ctx.closePath();
    } else if (shape === 'interceptor') {
        // Wide, forward swept wings
        ctx.moveTo(0, -15);
        ctx.lineTo(5, 0);
        ctx.lineTo(25, -10);
        ctx.lineTo(25, 5);
        ctx.lineTo(5, 15);
        ctx.lineTo(0, 20);
        ctx.lineTo(-5, 15);
        ctx.lineTo(-25, 5);
        ctx.lineTo(-25, -10);
        ctx.lineTo(-5, 0);
        ctx.closePath();
    } else if (shape === 'bomber') {
        // Heavy, bulky design
        ctx.moveTo(0, -15);
        ctx.lineTo(10, -10);
        ctx.lineTo(15, 5);
        ctx.lineTo(25, 10);
        ctx.lineTo(25, 20);
        ctx.lineTo(10, 15);
        ctx.lineTo(0, 25);
        ctx.lineTo(-10, 15);
        ctx.lineTo(-25, 20);
        ctx.lineTo(-25, 10);
        ctx.lineTo(-15, 5);
        ctx.lineTo(-10, -10);
        ctx.closePath();
    } else if (shape === 'speeder') {
        // Slim, fast design
        ctx.moveTo(0, -25);
        ctx.lineTo(5, 15);
        ctx.lineTo(10, 20);
        ctx.lineTo(0, 15);
        ctx.lineTo(-10, 20);
        ctx.lineTo(-5, 15);
        ctx.closePath();
    } else if (shape === 'stealth') {
        // Jagged, stealth-bomber look
        ctx.moveTo(0, -25);
        ctx.lineTo(10, 0);
        ctx.lineTo(25, 15);
        ctx.lineTo(15, 15);
        ctx.lineTo(10, 10);
        ctx.lineTo(0, 15);
        ctx.lineTo(-10, 10);
        ctx.lineTo(-15, 15);
        ctx.lineTo(-25, 15);
        ctx.lineTo(-10, 0);
        ctx.closePath();
    } else if (shape === 'titan') {
        // Heavy, battleship cruiser look
        ctx.moveTo(0, -20);
        ctx.lineTo(10, -15);
        ctx.lineTo(10, -5);
        ctx.lineTo(20, 0);
        ctx.lineTo(20, 15);
        ctx.lineTo(10, 25);
        ctx.lineTo(5, 20);
        ctx.lineTo(0, 25); // Center exhaust
        ctx.lineTo(-5, 20);
        ctx.lineTo(-10, 25);
        ctx.lineTo(-20, 15);
        ctx.lineTo(-20, 0);
        ctx.lineTo(-10, -5);
        ctx.lineTo(-10, -15);
        ctx.closePath();
    }
}


function animateScreenIn(screenElement) {
    if (typeof anime === 'undefined') return;

    // Reset styles for animation
    const title = screenElement.querySelector('h1');
    const contentGroups = screenElement.querySelectorAll('.controls-info, .player-customization, .option-group');
    const buttons = screenElement.querySelectorAll('button:not(.color-select):not(.shape-select)'); // Main buttons

    // Animate Title
    if (title) {
        anime({
            targets: title,
            opacity: [0, 1],
            translateY: [-50, 0],
            scale: [0.8, 1],
            duration: 800,
            easing: 'easeOutElastic(1, .6)',
            delay: 100
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
            delay: anime.stagger(100, { start: 300 })
        });
    }

    // Animate Main Action Buttons
    if (buttons.length > 0) {
        anime({
            targets: buttons,
            opacity: [0, 1],
            scale: [0.5, 1],
            duration: 800,
            easing: 'easeOutElastic(1, .5)',
            delay: anime.stagger(100, { start: 600 })
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

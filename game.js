let canvas;
let ctx;

// Game State
let gameLoopId;
let lastTime = 0;
let accumulator = 0;
let isGameOver = false;
let isPlaying = false;
let isPaused = false;
let gameOverTimeout;
let playerMode = 1; // 1 = 1 Player, 2 = 2 Players
// Spawns since the last proximity mine. Widens the mine's spawn odds and
// eventually forces one (see spawnEnemy), so the mine always shows up early.
let minePity = 4;
const MAX_ENEMIES = 20;
// Proximity mine blast radius in px. Shared by the detonation check and the
// mine's on-screen telegraph ring so the warning always matches the hitbox.
const MINE_BLAST_RADIUS = 95;
// Max catch-up physics steps per rendered frame; anything above this is
// dropped to prevent the "spiral of death" after a long frame (GC/lag).
const MAX_SIM_STEPS = 4;

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
        this.shootDelay = 200; // 0.2s per shot - same fast rate for every hull
        this.controls = controls;
        this.trail = [];
        this.isAlive = true;
        this.hasSideShooters = false;
        this.sideShooterEndTime = 0;
        this.hasOverdrive = false;
        this.overdriveEndTime = 0;
        this.lives = 5;
        this.maxLives = 5;
        this.invulnerable = false;
        this.invulnerableEndTime = 0;
        this.kills = 0;
        this.hasShield = false;
        this.shieldEndTime = 0;
        this.shieldActivatedAt = 0; // drives the materialise-in animation
        this.shieldHitAt = 0;       // drives the impact flare + shatter ripple
        this.shieldRadius = 0;      // re-fits smoothly when side shooters appear
        this.empUntil = 0; // EMP drones can completely jam weapons

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

        // Check if overdrive should expire
        if (this.hasOverdrive && performance.now() > this.overdriveEndTime) {
            this.hasOverdrive = false;
            this.shootDelay = 200; // 0.2s per shot - same fast rate for every hull
        }

        // Check if invulnerability should expire
        if (this.invulnerable && performance.now() > this.invulnerableEndTime) {
            this.invulnerable = false;
        }

        // Check if shield should expire. A spent field shatters like a hit one
        // (see absorbShieldHit) so it never just blinks out of existence.
        if (this.hasShield && performance.now() > this.shieldEndTime) {
            this.hasShield = false;
            this.shieldHitAt = performance.now();
            createExplosion(this.x, this.y, '#0af', 12);
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

        // Trail rendering is currently disabled in draw(); skip the per-frame
        // allocations entirely to reduce GC pressure and keep frames smooth.

        // Shooting (keyboard shoot key OR finger held down on screen). EMP
        // drones can completely jam the player's weapons for 5 seconds.
        if ((keys[this.controls.shoot] || this.touchActive) && performance.now() > this.empUntil) {
            const now = performance.now();
            const activeDelay = this.hasOverdrive ? 75 : this.shootDelay;
            if (now - this.lastShot > activeDelay) {
                this.fireWeapon();
                this.lastShot = now;
                // Add muzzle flash explosion effects
                createMuzzleFlash(this.x, this.y - this.height / 2, this.hasOverdrive ? '#ff8c00' : this.color);
                if (this.hasSideShooters) {
                    createMuzzleFlash(this.x - 65, this.y + 20, this.hasOverdrive ? '#ff8c00' : this.color);
                    createMuzzleFlash(this.x + 65, this.y + 20, this.hasOverdrive ? '#ff8c00' : this.color);
                }
            }
        }

        // Update Bullets
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.y -= b.speed;
            if (b.vx) b.x += b.vx;
            if (b.y < -60 || b.x < -60 || b.x > canvas.width + 60) this.bullets.splice(i, 1);
        }
    }

    fireWeapon() {
        const col = this.hasOverdrive ? '#ff8c00' : this.color;
        const muzzleY = this.y - this.height / 2 - 7.5;

        // Main bullet - every hull fires the exact same single shot
        this.bullets.push({
            x: this.x,
            y: muzzleY,
            width: 4,
            height: 15,
            speed: 7,
            color: col,
            damage: 1
        });

        // Side shooter power-up bullets (origin matches the side muzzle flashes at y + 20)
        if (this.hasSideShooters) {
            this.bullets.push({ x: this.x - 65, y: this.y + 20, width: 4, height: 15, speed: 7, color: col, damage: 1 });
            this.bullets.push({ x: this.x + 65, y: this.y + 20, width: 4, height: 15, speed: 7, color: col, damage: 1 });
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

        // Draw shield if active. The field is kept alive for a beat after it
        // breaks so the shatter ripple and impact flare can play out.
        const shieldVisible = this.hasShield ||
            (performance.now() - (this.shieldHitAt || 0)) < SHIELD_IMPACT_MS;
        if (shieldVisible) drawPlayerShield(ctx, this, 'back');

        // EMP jam effect: crackling electric ring around a disabled ship
        if (performance.now() < this.empUntil) {
            ctx.save();
            ctx.strokeStyle = '#ff4dff';
            ctx.shadowColor = '#ff4dff';
            ctx.shadowBlur = 14;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 55) * 0.3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.width * 0.85 + Math.sin(performance.now() / 70) * 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // Soft contact shadow beneath the ship for a grounded, 3D feel
        ctx.save();
        const shadowY = this.y + this.height * 0.32;
        const shadowGrad = ctx.createRadialGradient(this.x, shadowY, 1, this.x, shadowY, this.width * 0.45);
        shadowGrad.addColorStop(0, 'rgba(0,0,0,0.4)');
        shadowGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = shadowGrad;
        ctx.beginPath();
        ctx.ellipse(this.x, shadowY, this.width * 0.45, this.height * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.lineWidth = 2;
        ctx.shadowBlur = 0;
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

        // Near half of the shield dome sits between the camera and the hull
        if (shieldVisible) drawPlayerShield(ctx, this, 'front');

        // Draw Bullets
        ctx.shadowBlur = 10;
        for (const b of this.bullets) {
            ctx.fillStyle = b.color;
            ctx.shadowColor = b.color;
            ctx.fillRect(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);
            // Bright core for piercing beams
            if (b.pierce) {
                ctx.globalAlpha = 0.7;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(b.x - b.width / 4, b.y - b.height / 2, b.width / 2, b.height);
                ctx.globalAlpha = 1;
            }
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
        this.lives = 5;
        this.invulnerable = false;
        this.invulnerableEndTime = 0;
        this.kills = 0;
        this.hasShield = false;
        this.shieldEndTime = 0;
        this.shieldActivatedAt = 0; // drives the materialise-in animation
        this.shieldHitAt = 0;       // drives the impact flare + shatter ripple
        this.shieldRadius = 0;      // re-fits smoothly when side shooters appear
        this.empUntil = 0; // EMP drones can completely jam weapons
        this.hasOverdrive = false;
        this.overdriveEndTime = 0;
        this.shootDelay = 200; // 0.2s per shot - same fast rate for every hull
        this.touchActive = false;
        this.touchId = null;
        this.touchTargetX = x;
        this.touchTargetY = y;
    }

    activateSideShooters() {
        this.hasSideShooters = true;
        this.sideShooterEndTime = performance.now() + 10000; // 10 seconds
    }

    activateShield() {
        this.hasShield = true;
        this.shieldEndTime = performance.now() + 10000; // 10 seconds
        // Replays the materialise-in animation, refreshing an active shield included
        this.shieldActivatedAt = performance.now();
        this.shieldHitAt = 0;
    }

    // A shield soaks exactly one hit, then dies. shieldHitAt drives the impact
    // flare and shatter ripple in drawPlayerShield.
    absorbShieldHit(particleCount = 25) {
        this.hasShield = false;
        this.shieldHitAt = performance.now();
        createExplosion(this.x, this.y, '#0af', particleCount);
    }

    activateOverdrive() {
        this.hasOverdrive = true;
        this.overdriveEndTime = performance.now() + 8000; // 8 seconds of Overdrive
        this.shootDelay = 75; // Fast firing rate!
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

// ---- Player shield field ---------------------------------------------------
// Hexagonal energy dome: materialises on pickup, drains as its timer runs out,
// flickers when it is nearly spent and shatters when it absorbs a hit. Drawn in
// two passes ('back' before the hull, 'front' after it) so the ship sits inside
// the bubble instead of on top of a flat ring.
const SHIELD_ACTIVATE_MS = 450; // materialise-in duration
const SHIELD_IMPACT_MS = 520;   // impact flare / shatter ripple duration
const SHIELD_DURATION_MS = 10000;

function drawPlayerShield(ctx, p, pass) {
    const now = performance.now();
    const dying = !p.hasShield;

    // Materialise-in: the dome snaps out from an oversized, blown-out field
    const born = Math.min(1, Math.max(0, (now - (p.shieldActivatedAt || 0)) / SHIELD_ACTIVATE_MS));
    const appear = 1 - Math.pow(1 - born, 3);

    // Impact flare: 1 on the hit frame, easing to 0 across SHIELD_IMPACT_MS
    const hitAge = now - (p.shieldHitAt || 0);
    const hit = (hitAge >= 0 && hitAge < SHIELD_IMPACT_MS) ? 1 - hitAge / SHIELD_IMPACT_MS : 0;

    // Failing field: flicker over the last stretch so the loss is telegraphed
    const remaining = p.shieldEndTime - now;
    const flicker = (!dying && remaining < 1800) ? 0.45 + 0.55 * Math.abs(Math.sin(now / 45)) : 1;

    // Radius re-fits smoothly when side shooters extend the silhouette
    const target = p.hasSideShooters ? 84 : p.width * 0.92;
    if (pass === 'back') {
        if (!p.shieldRadius) p.shieldRadius = target;
        p.shieldRadius += (target - p.shieldRadius) * 0.12; // advances once per frame
    }
    const R = (p.shieldRadius || target)
        * (1 + Math.sin(now / 260) * 0.015)          // breathing
        * (1.35 - 0.35 * appear)                     // materialise overshoot
        * (1 + hit * 0.06);                          // impact swell
    const alpha = (0.35 + 0.65 * appear) * flicker * (dying ? hit : 1);
    const spin = now / 2600;

    // Rotating hexagon vertices, used for both the cage and the shatter ripple
    const hex = (radius, phase) => {
        const pts = [];
        for (let i = 0; i < 6; i++) {
            const a = spin + phase + (i * Math.PI) / 3;
            pts.push({ x: p.x + Math.cos(a) * radius, y: p.y + Math.sin(a) * radius });
        }
        return pts;
    };
    const path = (pts) => {
        ctx.beginPath();
        pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
        ctx.closePath();
    };

    ctx.save();
    ctx.shadowColor = '#0af';
    ctx.globalAlpha = alpha;

    if (pass === 'back') {
        // 1. Dome volume - soft bubble that thickens toward the rim
        const dome = ctx.createRadialGradient(p.x, p.y, R * 0.25, p.x, p.y, R);
        dome.addColorStop(0, 'rgba(0, 170, 255, 0.04)');
        dome.addColorStop(0.7, 'rgba(0, 170, 255, 0.10)');
        dome.addColorStop(1, `rgba(130, 228, 255, ${0.24 + hit * 0.3})`);
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
        ctx.fillStyle = dome;
        ctx.fill();

        // 2. Geodesic cage: hexagon, counter-turned inner ring, connecting struts
        const outer = hex(R, 0);
        const inner = hex(R * 0.5, 0);
        ctx.shadowBlur = 10;
        ctx.strokeStyle = 'rgba(0, 200, 255, 0.45)';
        ctx.lineWidth = 1.4;
        path(outer); ctx.stroke();
        ctx.strokeStyle = 'rgba(0, 200, 255, 0.22)';
        ctx.lineWidth = 1;
        path(hex(R * 0.78, Math.PI / 6)); ctx.stroke();
        path(inner); ctx.stroke();
        ctx.beginPath();
        outer.forEach((pt, i) => { ctx.moveTo(pt.x, pt.y); ctx.lineTo(inner[i].x, inner[i].y); });
        ctx.stroke();

        // 3. Rim: dim base ring plus a hot arc that drains with the timer
        ctx.shadowBlur = 16;
        ctx.strokeStyle = 'rgba(0, 170, 255, 0.85)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
        ctx.stroke();

        const frac = dying ? 1 : Math.max(0, Math.min(1, remaining / SHIELD_DURATION_MS));
        const endA = -Math.PI / 2 + Math.PI * 2 * frac;
        ctx.shadowBlur = 22;
        ctx.strokeStyle = '#eaf9ff';
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, -Math.PI / 2, endA);
        ctx.stroke();
        if (!dying) {
            // Bright bead at the draining end makes the countdown legible
            ctx.beginPath();
            ctx.arc(p.x + Math.cos(endA) * R, p.y + Math.sin(endA) * R, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }

        // 4. Energy sweep: a comet band chasing around the rim
        const sweep = (now / 900) % (Math.PI * 2);
        ctx.shadowBlur = 18;
        ctx.strokeStyle = 'rgba(127, 220, 255, 0.9)';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, sweep, sweep + 1.25);
        ctx.stroke();

        // 5. Emitter nodes drifting inside the cage
        for (let i = 0; i < 3; i++) {
            const a = sweep + (i * Math.PI * 2) / 3 + 0.7;
            ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(now / 170 + i * 2));
            ctx.beginPath();
            ctx.arc(p.x + Math.cos(a) * R * 0.78, p.y + Math.sin(a) * R * 0.78, 2.4, 0, Math.PI * 2);
            ctx.fillStyle = '#cdf1ff';
            ctx.fill();
        }
        ctx.globalAlpha = alpha;

        // 6. Shatter ripple - hex shockwave thrown off when the field breaks
        if (dying && hit > 0) {
            ctx.globalAlpha = hit * 0.9;
            ctx.shadowBlur = 26;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3.4 * hit + 0.5;
            path(hex(R * (0.8 + (1 - hit) * 0.6), spin * 1.7));
            ctx.stroke();
        }
    } else {
        // Front pass: only the near (lower) half of the dome is between the
        // camera and the hull, so clip to it and redraw brighter
        ctx.beginPath();
        ctx.rect(p.x - R * 1.3, p.y, R * 2.6, R * 1.3);
        ctx.clip();

        ctx.shadowBlur = 12;
        ctx.strokeStyle = 'rgba(0, 210, 255, 0.4)';
        ctx.lineWidth = 1.4;
        path(hex(R, 0));
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0, 210, 255, 0.2)';
        ctx.lineWidth = 1;
        path(hex(R * 0.5, 0));
        ctx.stroke();

        ctx.shadowBlur = 18;
        ctx.strokeStyle = 'rgba(150, 235, 255, 0.8)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
        ctx.stroke();

        // Impact flare washing over the hull at the moment of the hit
        if (hit > 0) {
            ctx.globalAlpha = hit * 0.4;
            ctx.shadowBlur = 30;
            ctx.fillStyle = '#dff6ff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.restore();
}

let players = [];
let enemies = [];
let particles = [];
let powerUps = [];
let singularities = [];
let stars = [];

let glowEnabled = true;

// Global theme state
const THEMES = {
    MONO: {
        name: 'MONO',
        accent: '#ffffff',      // White
        accentAlt: '#9aa0a6'    // Mid Gray
    },
    ACID: {
        name: 'ACID',
        accent: '#39ff14',      // Acid Green
        accentAlt: '#00ffcc'    // Mint
    },
    VULCAN: {
        name: 'VULCAN',
        accent: '#ff2a00',      // Neon Red-Orange
        accentAlt: '#ffcc00'    // Solar Gold
    },
    FROSTBITE: {
        name: 'FROSTBITE',
        accent: '#00f0ff',      // Ice Cyan
        accentAlt: '#7b9cff'    // Glacier Blue
    },
    CARBON: {
        name: 'CARBON',
        accent: '#ffffff',      // Pure White
        accentAlt: '#ff3333'    // Crimson Red
    },
    GLITCH: {
        name: 'GLITCH',
        accent: '#7b2cbf',      // Laser Purple
        accentAlt: '#00f5d4'    // Electric Mint/Teal
    },
    RETRO: {
        name: 'RETRO',
        accent: '#ffaa00',      // Amber Gold
        accentAlt: '#ff5500'    // Warning Orange
    }
};

// Restore the player's saved theme (if any) before the first render.
let currentTheme = localStorage.getItem('neon-shooter-theme') || 'MONO';
if (!THEMES[currentTheme]) currentTheme = 'MONO';

let themeToastTimer = null;
// The theme the player last locked in (click / hotkey / saved). Hover
// previews temporarily retint the UI without moving this marker.
let committedTheme = currentTheme;

function applyTheme(themeKey, opts = {}) {
    const theme = THEMES[themeKey];
    if (!theme) return;

    currentTheme = themeKey;

    // Each theme is a strict two-color palette: --accent (primary) and
    // --accent-alt (secondary). All glows, tints and gradients in the UI are
    // derived from these two via color-mix() in CSS.
    document.body.style.setProperty('--accent', theme.accent);
    document.body.style.setProperty('--accent-alt', theme.accentAlt);

    // Pick a readable foreground (dark vs light) for solid backgrounds of
    // each palette color, so text on filled pills/buttons stays legible even
    // with dark secondary hues (e.g. OCEAN's sapphire #0050ff).
    document.body.style.setProperty('--on-accent', readableOn(theme.accent));
    document.body.style.setProperty('--on-alt', readableOn(theme.accentAlt));

    // For accent -> accent-alt gradient fills, choose the single foreground
    // whose WORST-case contrast across both palette colors is highest, so
    // text stays readable on the whole sweep (mid-gray mixes were ~1:1).
    document.body.style.setProperty('--on-gradient', readableOnGradient(theme.accent, theme.accentAlt));

    // Only a committed pick is saved + shown as active. Hover previews
    // (opts.commit === false) re-tint the UI live without locking it in.
    if (opts.commit !== false) {
        committedTheme = themeKey;
        try { localStorage.setItem('neon-shooter-theme', themeKey); } catch (e) { /* storage unavailable */ }
    }

    // Highlight the committed swatch in the home-screen palette
    document.querySelectorAll('#theme-swatches .theme-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.theme === committedTheme);
    });

    // Optional on-screen confirmation (used by clicks, hotkeys and T)
    if (opts.toast) showThemeToast(theme.name);
}

// Build the compact dot palette from THEMES, so any theme added to the
// table above automatically gets its own dot. Hovering a dot previews it
// live on the whole UI + ship canvases; clicking locks it in.
function buildThemeSwatches() {
    const container = document.getElementById('theme-swatches');
    if (!container) return;
    container.innerHTML = '';
    Object.keys(THEMES).forEach((key, i) => {
        const theme = THEMES[key];
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'theme-swatch';
        swatch.dataset.theme = key;
        swatch.title = theme.name + ' — hover to preview, click to set (hotkey ' + (i + 1) + ')';
        swatch.setAttribute('aria-label', 'Apply ' + theme.name + ' theme (hotkey ' + (i + 1) + ')');
        swatch.innerHTML =
            '<span class="swatch-dot" style="background:' + theme.accent + ';box-shadow:0 0 6px ' + theme.accent + '"></span>';
        swatch.addEventListener('mouseenter', () => applyTheme(key, { commit: false }));
        swatch.addEventListener('mouseleave', () => applyTheme(committedTheme));
        swatch.addEventListener('click', () => {
            stopThemeAutoToggle();
            applyTheme(key, { toast: true });
        });
        container.appendChild(swatch);
    });
}

// Cycle to the next theme (T key) — works on the home screen and mid-game
function cycleTheme() {
    const keys = Object.keys(THEMES);
    const next = keys[(keys.indexOf(currentTheme) + 1) % keys.length];
    applyTheme(next, { toast: true });
}

// Surprise pick from the whole palette (RANDOM button)
function randomTheme() {
    stopThemeAutoToggle();
    const keys = Object.keys(THEMES);
    let pick = keys[Math.floor(Math.random() * keys.length)];
    if (pick === currentTheme && keys.length > 1) {
        pick = keys[(keys.indexOf(pick) + 1) % keys.length];
    }
    applyTheme(pick, { toast: true });
}

// Auto theme toggle state (Home screen only: Up twice to start, Down twice to stop)
let themeAutoToggleTimer = null;
let lastUpPressTime = 0;
let lastDownPressTime = 0;
const THEME_DOUBLE_PRESS_DELAY = 500; // ms threshold for double-tap
const THEME_AUTO_TOGGLE_INTERVAL = 100; // ms per theme switch (rapid cycling)

function isHomeScreenActive() {
    return !isPlaying && !isGameOver && !isPaused &&
        startScreen && startScreen.classList.contains('active') &&
        !startScreen.classList.contains('hidden') &&
        (!pauseScreen || pauseScreen.classList.contains('hidden')) &&
        (!gameOverScreen || gameOverScreen.classList.contains('hidden'));
}

function startThemeAutoToggle() {
    if (!isHomeScreenActive()) return;
    if (themeAutoToggleTimer) {
        clearInterval(themeAutoToggleTimer);
        themeAutoToggleTimer = null;
    }
    // Immediately cycle on the second press for responsive feedback
    cycleTheme();
    themeAutoToggleTimer = setInterval(() => {
        if (!isHomeScreenActive()) {
            stopThemeAutoToggle();
            return;
        }
        cycleTheme();
    }, THEME_AUTO_TOGGLE_INTERVAL);
}

function stopThemeAutoToggle(notify = false) {
    if (themeAutoToggleTimer) {
        clearInterval(themeAutoToggleTimer);
        themeAutoToggleTimer = null;
        if (notify && THEMES[currentTheme]) {
            showThemeToast(THEMES[currentTheme].name);
        }
    }
}

function showThemeToast(name) {
    const toast = document.getElementById('theme-toast');
    if (!toast) return;
    toast.textContent = 'THEME: ' + name;
    toast.classList.add('show');
    clearTimeout(themeToastTimer);
    themeToastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

// Picks near-black or near-white by comparing WCAG contrast ratios against a
// solid-color background, so the foreground with the best legibility wins even
// for saturated mid-brightness hues (e.g. orange needs dark text, not white).
function readableOn(hex) {
    const bgLum = hexLuminance(hex);
    const dark = '#05070c';
    const light = '#f2f7ff';
    const darkContrast = contrastRatio(bgLum, hexLuminance(dark));
    const lightContrast = contrastRatio(bgLum, hexLuminance(light));
    return darkContrast >= lightContrast ? dark : light;
}

// WCAG relative luminance (0..1) of a #rrggbb hex color.
function hexLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.2126 * relLuminance(r) + 0.7152 * relLuminance(g) + 0.0722 * relLuminance(b);
}

// Picks the foreground (near-black or near-white) with the best worst-case
// contrast against BOTH palette colors, for accent -> accent-alt gradients.
function readableOnGradient(hexA, hexB) {
    const lumA = hexLuminance(hexA);
    const lumB = hexLuminance(hexB);
    const dark = '#05070c';
    const light = '#f2f7ff';
    const darkLum = hexLuminance(dark);
    const lightLum = hexLuminance(light);

    const darkWorst = Math.min(contrastRatio(lumA, darkLum), contrastRatio(lumB, darkLum));
    const lightWorst = Math.min(contrastRatio(lumA, lightLum), contrastRatio(lumB, lightLum));
    return darkWorst >= lightWorst ? dark : light;
}

// sRGB channel to WCAG linear-light value (0..1).
function relLuminance(channel) {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function contrastRatio(l1, l2) {
    const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
}

// Global Canvas shadow interceptor for Glow FX Toggle
const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'shadowBlur');
if (desc && desc.set) {
    const originalSet = desc.set;
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'shadowBlur', {
        set: function (val) {
            originalSet.call(this, glowEnabled ? val : 0);
        }
    });
}

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
let p1OverdriveWrapper, p1OverdriveBar;
let p1LevelEl, p1HpDots;

let p2HealthSegments;
let p2KillsEl;
let p2ShieldWrapper, p2ShieldBar;
let p2ShooterWrapper, p2ShooterBar;
let p2OverdriveWrapper, p2OverdriveBar;
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
    // Both players default to the 'classic' hull (set in the Player
    // constructor) until a different one is picked on the start screen.
}

function initStars() {
    stars = [];
    if (!canvas) return;
    for (let i = 0; i < 150; i++) {
        // Three parallax depths: 0 = far, 1 = mid, 2 = near. Far stars are
        // small, dim and slow; near stars are bigger, brighter and faster.
        const roll = Math.random();
        const layer = roll < 0.4 ? 0 : roll < 0.75 ? 1 : 2;
        let size, speed, alpha;
        if (layer === 0) {
            size = Math.random() * 0.8 + 0.4;
            speed = 0.5 + Math.random() * 0.6;
            alpha = Math.random() * 0.3 + 0.2;
        } else if (layer === 1) {
            size = Math.random() * 1.1 + 0.9;
            speed = 1.3 + Math.random() * 0.9;
            alpha = Math.random() * 0.35 + 0.35;
        } else {
            size = Math.random() * 1.8 + 1.7;
            speed = 2.6 + Math.random() * 1.4;
            alpha = Math.random() * 0.4 + 0.55;
        }
        stars.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size,
            speed,
            layer,
            alpha,
            // Pre-computed fill color so the per-frame draw needs no arc paths
            fill: 'rgba(252,240,105,' + alpha.toFixed(2) + ')'
        });
    }
}

// ---------- Background Planets (from planets-demo.html) ----------
let planets = [];

const PLANET_TYPES = [
    { // p1: Sunset gradient + saturn ring
        stops: [[0, '#fff2c4'], [0.35, '#ffcf8f'], [0.6, '#ffab7a'], [0.85, '#f2835c']],
        glow: 'rgba(255, 171, 122, 0.6)', ring: 'rgba(255, 255, 255, 0.55)', moon: null, texture: null
    },
    { // p2: Violet gradient sphere, smooth
        stops: [[0, '#e6f4ff'], [0.3, '#a9c9ff'], [0.6, '#8f7fe0'], [0.9, '#5a4fb0']],
        glow: 'rgba(143, 127, 224, 0.55)', ring: null, moon: null, texture: null
    },
    { // p3: Pale marble swirl
        stops: [[0, '#fbf9ff'], [0.55, '#eee8ff'], [0.9, '#dcd4f7']],
        glow: 'rgba(180, 165, 230, 0.5)', ring: null, moon: null, texture: 'marble'
    },
    { // p4: Magenta/gold split + moon
        stops: [[0, '#fff0c2'], [0.3, '#ffd98f'], [0.6, '#f08fc0'], [0.85, '#9a4fb0']],
        glow: 'rgba(240, 143, 192, 0.55)', ring: null,
        moon: { color1: '#d9f3ff', color2: '#6fb8d9', radiusRatio: 0.2, orbitRxRatio: 1.4, orbitRyRatio: 0.5 },
        texture: null
    },
    { // p5: Star-pattern texture
        stops: [[0, '#fffaf0'], [0.45, '#fff0c2'], [0.8, '#f5d98f']],
        glow: 'rgba(245, 217, 143, 0.55)', ring: null, moon: null, texture: 'stars'
    },
    { // p6: Hex grid texture
        stops: [[0, '#f7ffd9'], [0.4, '#d9f0a0'], [0.75, '#9fdfb0'], [1, '#6fc9c9']],
        glow: 'rgba(159, 223, 176, 0.5)', ring: null, moon: null, texture: 'hex'
    },
    { // p7: Contour ripple lines
        stops: [[0, '#f0fffa'], [0.4, '#a0e8d9'], [0.75, '#5fc9d9'], [1, '#3f8fc9']],
        glow: 'rgba(95, 201, 217, 0.55)', ring: null, moon: null, texture: 'contour'
    },
    { // p8: Soft violet/blue gradient
        stops: [[0, '#f0f0ff'], [0.35, '#c2c2f5'], [0.6, '#9a8fdf'], [0.85, '#6a5fb0']],
        glow: 'rgba(154, 143, 223, 0.55)', ring: null, moon: null, texture: null
    },
    { // p9: Isometric cube texture
        stops: [[0, '#fff8dd'], [0.45, '#ffe2a0'], [0.8, '#e0aa5f']],
        glow: 'rgba(224, 170, 95, 0.55)', ring: null, moon: null, texture: 'cubes'
    },
    { // p10: Pink/gold + rings + moon
        stops: [[0, '#fff2cf'], [0.35, '#ffdf9f'], [0.65, '#f09fd9'], [0.9, '#b06fdf']],
        glow: 'rgba(240, 159, 217, 0.55)', ring: 'rgba(255, 255, 255, 0.5)',
        moon: { color1: '#cfeaff', color2: '#4f8fbf', radiusRatio: 0.16, orbitRxRatio: 1.5, orbitRyRatio: 0.55 },
        texture: 'cubes'
    }
];

function createPlanet(spawnAtTop, existingPlanets = [], targetZone = null) {
    const type = PLANET_TYPES[Math.floor(Math.random() * PLANET_TYPES.length)];
    const radius = 35 + Math.random() * 45;
    const w = canvas ? canvas.width : window.innerWidth;
    const h = canvas ? canvas.height : window.innerHeight;

    // Effective radius considering Saturn rings (1.7x) & moon orbits
    const effectiveRadius = type.ring ? radius * 1.8 : radius * 1.4;

    let bestX = w / 2;
    let bestY = spawnAtTop ? -radius * 2 : h / 2;
    let maxMinDist = -Infinity;

    for (let attempt = 0; attempt < 100; attempt++) {
        let testX, testY;

        if (spawnAtTop) {
            testX = effectiveRadius + Math.random() * Math.max(1, (w - effectiveRadius * 2));
            testY = -effectiveRadius * 2.2 - Math.random() * 500;
        } else if (targetZone) {
            // Natural zone distribution during initial load
            const minX = targetZone.minX * w;
            const maxX = targetZone.maxX * w;
            const minY = targetZone.minY * h;
            const maxY = targetZone.maxY * h;

            testX = minX + Math.random() * (maxX - minX);
            testY = minY + Math.random() * (maxY - minY);
            testX = Math.max(effectiveRadius, Math.min(w - effectiveRadius, testX));
            testY = Math.max(effectiveRadius, Math.min(h - effectiveRadius, testY));
        } else {
            testX = effectiveRadius + Math.random() * Math.max(1, (w - effectiveRadius * 2));
            testY = effectiveRadius + Math.random() * Math.max(1, (h - effectiveRadius * 2));
        }

        let minDistToOthers = Infinity;
        for (const other of existingPlanets) {
            if (!other) continue;
            const otherEff = other.type.ring ? other.radius * 1.8 : other.radius * 1.4;
            const dist = Math.hypot(testX - other.x, testY - other.y);
            const requiredDist = effectiveRadius + otherEff + 100; // 100px generous padding buffer
            const gap = dist - requiredDist;
            if (gap < minDistToOthers) {
                minDistToOthers = gap;
            }
        }

        if (minDistToOthers >= 0 || existingPlanets.length === 0) {
            bestX = testX;
            bestY = testY;
            break;
        }

        if (minDistToOthers > maxMinDist) {
            maxMinDist = minDistToOthers;
            bestX = testX;
            bestY = testY;
        }
    }

    // Parallax depth: smaller planets read as farther away, so they drift
    // slower (and a touch less horizontally) than the big close-up worlds.
    const parallax = 0.4 + (radius / 160) * 1.3;

    const planet = {
        x: bestX,
        y: bestY,
        radius,
        speed: (0.7 + Math.random() * 0.8) * parallax,
        vx: (Math.random() < 0.5 ? -1 : 1) * (0.04 + Math.random() * 0.08) * parallax,
        parallax,
        type,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() * 0.00035 + 0.00015) * (Math.random() < 0.5 ? 1 : -1),
        ringTilt: -0.34 + Math.random() * 0.12,
        moonAngle: Math.random() * Math.PI * 2
    };

    // Bake the planet's expensive visuals (gradients, blur filters, textures)
    // into offscreen sprites once, so the per-frame draw is just drawImage().
    buildPlanetSprites(planet);

    return planet;
}

function initPlanets() {
    planets = [];
    if (!canvas) return;
    // Exactly 2 to 3 planets on screen at once
    const count = 2 + Math.floor(Math.random() * 2);

    const zones = count === 2 ? [
        { minX: 0.1, maxX: 0.45, minY: 0.12, maxY: 0.42 }, // Left-Top
        { minX: 0.55, maxX: 0.9, minY: 0.55, maxY: 0.85 }   // Right-Bottom
    ] : [
        { minX: 0.1, maxX: 0.4, minY: 0.1, maxY: 0.32 },   // Left-Top
        { minX: 0.6, maxX: 0.9, minY: 0.38, maxY: 0.6 },   // Right-Middle
        { minX: 0.15, maxX: 0.5, minY: 0.68, maxY: 0.88 }  // Center/Left-Bottom
    ];

    for (let i = 0; i < count; i++) {
        planets.push(createPlanet(false, planets, zones[i]));
    }
}

// Pre-render a planet's static visuals (aura, halo, sphere shading + texture)
// into two offscreen sprites so the per-frame draw is a cheap drawImage.
// glowSprite is radially symmetric (aura + halo); sphereSprite carries the
// rotating texture/shading and is drawn with ctx.rotate() applied each frame.
function buildPlanetSprites(pl) {
    const { radius, type } = pl;

    // ---- Glow sprite: outer aura + soft core halo (rotation-invariant) ----
    const glowSize = Math.ceil(radius * 4.4);
    const glow = document.createElement('canvas');
    glow.width = glowSize;
    glow.height = glowSize;
    const g = glow.getContext('2d');
    g.translate(glowSize / 2, glowSize / 2);

    const auraGrad = g.createRadialGradient(0, 0, radius * 0.7, 0, 0, radius * 1.75);
    auraGrad.addColorStop(0, type.glow);
    auraGrad.addColorStop(0.35, type.glow);
    auraGrad.addColorStop(0.7, type.glow.replace(/[\d\.]+\)$/, '0.25)'));
    auraGrad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = auraGrad;
    g.beginPath();
    g.arc(0, 0, radius * 1.75, 0, Math.PI * 2);
    g.fill();

    g.save();
    g.shadowColor = type.glow;
    g.shadowBlur = radius * 1.2;
    g.globalAlpha = 0.85;
    g.fillStyle = type.glow;
    g.beginPath();
    g.arc(0, 0, radius * 0.98, 0, Math.PI * 2);
    g.fill();
    g.restore();

    pl.glowSprite = glow;

    // ---- Sphere sprite: shaded sphere + surface texture (rotates each frame) ----
    const sphereSize = Math.ceil(radius * 2.1);
    const sphere = document.createElement('canvas');
    sphere.width = sphereSize;
    sphere.height = sphereSize;
    const c = sphere.getContext('2d');
    c.translate(sphereSize / 2, sphereSize / 2);

    c.beginPath();
    c.arc(0, 0, radius, 0, Math.PI * 2);
    c.clip();

    // Base sphere radial gradient (light source top-left)
    const grad = c.createRadialGradient(
        -radius * 0.35, -radius * 0.35, radius * 0.1,
        0, 0, radius * 1.15
    );
    type.stops.forEach(([stop, color]) => grad.addColorStop(stop, color));
    c.fillStyle = grad;
    c.fillRect(-radius, -radius, radius * 2, radius * 2);

    // Soft inset rim highlight (light source top-left rim)
    const rimGrad = c.createRadialGradient(
        -radius * 0.4, -radius * 0.4, radius * 0.5,
        -radius * 0.4, -radius * 0.4, radius * 1.15
    );
    rimGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    rimGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
    rimGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    c.fillStyle = rimGrad;
    c.fillRect(-radius, -radius, radius * 2, radius * 2);

    // Shadow terminator (dark bottom-right)
    const shadowGrad = c.createRadialGradient(
        radius * 0.35, radius * 0.35, radius * 0.1,
        radius * 0.35, radius * 0.35, radius * 1.3
    );
    shadowGrad.addColorStop(0, 'rgba(0,0,0,0)');
    shadowGrad.addColorStop(1, 'rgba(0,0,0,0.32)');
    c.fillStyle = shadowGrad;
    c.fillRect(-radius, -radius, radius * 2, radius * 2);

    // Surface texture (uses the global ctx helpers, so swap it temporarily)
    if (type.texture) {
        const savedCtx = ctx;
        try {
            ctx = c;
            drawPlanetTexture(type.texture, radius);
        } finally {
            ctx = savedCtx; // Always restore, even if texture drawing throws
        }
    }

    pl.sphereSprite = sphere;
}

function drawPlanet(pl) {
    const { x, y, radius, type } = pl;

    if (!pl.glowSprite || !pl.sphereSprite) buildPlanetSprites(pl);

    ctx.save();
    ctx.translate(x, y);

    // Aura + halo (radially symmetric, no rotation needed)
    ctx.drawImage(pl.glowSprite, -pl.glowSprite.width / 2, -pl.glowSprite.height / 2);

    // Saturn ring (back half)
    if (type.ring) drawPlanetRing(pl, true);

    // Rotating shaded sphere + texture
    ctx.save();
    ctx.rotate(pl.rotation);
    ctx.drawImage(pl.sphereSprite, -pl.sphereSprite.width / 2, -pl.sphereSprite.height / 2);
    ctx.restore();

    // Saturn ring (front half)
    if (type.ring) drawPlanetRing(pl, false);

    // Orbiting Moon
    if (type.moon) {
        const orbitRx = radius * (type.moon.orbitRxRatio || 1.4);
        const orbitRy = radius * (type.moon.orbitRyRatio || 0.5);
        const mx = Math.cos(pl.moonAngle) * orbitRx;
        const my = Math.sin(pl.moonAngle) * orbitRy;
        drawMoon(mx, my, radius * (type.moon.radiusRatio || 0.2), type.moon.color1, type.moon.color2);
    }

    ctx.restore();
}

function drawMoon(mx, my, mr, c1, c2) {
    ctx.save();
    ctx.translate(mx, my);
    ctx.shadowColor = c1 || '#d9f3ff';
    ctx.shadowBlur = mr * 1.2;
    const g = ctx.createRadialGradient(-mr * 0.35, -mr * 0.35, mr * 0.1, 0, 0, mr);
    g.addColorStop(0, c1 || '#d9f3ff');
    g.addColorStop(1, c2 || '#6fb8d9');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawPlanetRing(pl, isBack) {
    const { radius } = pl;
    const rx = radius * 1.7;
    const ry = radius * 0.55;
    ctx.save();
    ctx.shadowColor = pl.type.ring;
    ctx.shadowBlur = radius * 0.3;
    ctx.strokeStyle = pl.type.ring;
    ctx.lineWidth = Math.max(2, radius * 0.09);
    ctx.beginPath();
    if (isBack) {
        ctx.ellipse(0, 0, rx, ry, pl.ringTilt, Math.PI, Math.PI * 2);
    } else {
        ctx.ellipse(0, 0, rx, ry, pl.ringTilt, 0, Math.PI);
    }
    ctx.stroke();
    ctx.restore();
}

function drawPlanetTexture(kind, radius) {
    ctx.save();

    if (kind === 'stars') {
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.5;
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 5;
        if (typeof ctx.filter !== 'undefined') ctx.filter = 'blur(1px)';
        ctx.fillStyle = '#ffffff';
        const step = radius * 0.4;
        for (let gy = -radius; gy <= radius; gy += step) {
            for (let gx = -radius; gx <= radius; gx += step) {
                if (gx * gx + gy * gy > radius * radius * 1.05) continue;
                drawTinyStar(gx, gy, step * 0.22);
            }
        }
    } else if (kind === 'hex') {
        ctx.globalCompositeOperation = 'soft-light';
        ctx.globalAlpha = 0.55;
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 5;
        if (typeof ctx.filter !== 'undefined') ctx.filter = 'blur(1.2px)';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        const s = radius * 0.17;
        for (let row = -7; row <= 7; row++) {
            for (let col = -7; col <= 7; col++) {
                const hx = col * s * 1.5;
                const hy = row * s * 1.73 + (col % 2 ? s * 0.87 : 0);
                if (hx * hx + hy * hy > radius * radius * 1.05) continue;
                drawHexOutline(hx, hy, s * 0.85);
            }
        }
    } else if (kind === 'cubes') {
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.45;
        ctx.shadowColor = '#ffe2a0';
        ctx.shadowBlur = 4;
        if (typeof ctx.filter !== 'undefined') ctx.filter = 'blur(1.2px)';
        ctx.strokeStyle = '#8a5a1f';
        ctx.lineWidth = 1;
        const s = radius * 0.2;
        for (let row = -6; row <= 6; row++) {
            for (let col = -6; col <= 6; col++) {
                const cx = col * s * 1.7 + (row % 2 ? s * 0.85 : 0);
                const cy = row * s * 1.5;
                if (cx * cx + cy * cy > radius * radius * 1.05) continue;
                drawIsoCube(cx, cy, s * 0.8);
            }
        }
    } else if (kind === 'contour') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.35;
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 6;
        if (typeof ctx.filter !== 'undefined') ctx.filter = 'blur(1.5px)';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        for (let r = radius * 0.12; r < radius * 1.6; r += radius * 0.15) {
            ctx.beginPath();
            ctx.arc(-radius * 0.35, -radius * 0.32, r, 0, Math.PI * 2);
            ctx.stroke();
        }
    } else if (kind === 'marble') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 0.25;
        ctx.shadowColor = '#b6a8e0';
        ctx.shadowBlur = 8;
        if (typeof ctx.filter !== 'undefined') ctx.filter = 'blur(2.5px)';
        ctx.fillStyle = '#b6a8e0';
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            const bx = Math.sin(i * 2.1) * radius * 0.5;
            const by = Math.cos(i * 1.7) * radius * 0.5;
            ctx.ellipse(bx, by, radius * 0.55, radius * 0.22, i * 0.6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    if (typeof ctx.filter !== 'undefined') ctx.filter = 'none';
    ctx.restore();
}

function drawTinyStar(cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
        const a1 = (Math.PI / 2) * i;
        const a2 = a1 + Math.PI / 4;
        const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
        const x2 = cx + Math.cos(a2) * r * 0.35, y2 = cy + Math.sin(a2) * r * 0.35;
        if (i === 0) ctx.moveTo(x1, y1); else ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
    }
    ctx.closePath();
    ctx.fill();
}

function drawHexOutline(cx, cy, s) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + Math.cos(a) * s, py = cy + Math.sin(a) * s;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
}

function drawIsoCube(cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s * 0.87, cy - s * 0.5);
    ctx.lineTo(cx + s * 0.87, cy + s * 0.5);
    ctx.lineTo(cx, cy + s);
    ctx.lineTo(cx - s * 0.87, cy + s * 0.5);
    ctx.lineTo(cx - s * 0.87, cy - s * 0.5);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - s);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - s * 0.87, cy - s * 0.5);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + s * 0.87, cy - s * 0.5);
    ctx.stroke();
}

function drawWavyBand(ctx, size, yCenter, width, color, time, freq, amp) {
    ctx.fillStyle = color;
    ctx.beginPath();

    // Draw upper edge of wave
    for (let x = -size; x <= size; x += 5) {
        let y = yCenter + Math.sin(x * freq + time) * amp;
        if (x === -size) ctx.moveTo(x, y - width / 2);
        else ctx.lineTo(x, y - width / 2);
    }
    // Draw lower edge of wave
    for (let x = size; x >= -size; x -= 5) {
        let y = yCenter + Math.sin(x * freq + time) * amp;
        ctx.lineTo(x, y + width / 2);
    }

    ctx.closePath();
    ctx.fill();
}

function drawCurvedBand(ctx, size, y, height, color, curvature = 0.1) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-size * 1.5, y - height / 2 - size * curvature);
    ctx.quadraticCurveTo(0, y - height / 2 + size * curvature * 0.5, size * 1.5, y - height / 2 - size * curvature);
    ctx.lineTo(size * 1.5, y + height / 2 - size * curvature);
    ctx.quadraticCurveTo(0, y + height / 2 + size * curvature * 0.5, -size * 1.5, y + height / 2 - size * curvature);
    ctx.closePath();
    ctx.fill();
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

    // The stage (dark panel + hairline border) is styled in CSS; the canvas
    // stays transparent and only draws the ship, its aura, and its pedestal.
    const glowColor = player.color;

    // Soft radial aura that follows the chosen signature color
    const aura = previewCtx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.62);
    aura.addColorStop(0, glowColor + '2b');
    aura.addColorStop(1, glowColor + '00');
    previewCtx.fillStyle = aura;
    previewCtx.fillRect(0, 0, w, h);

    previewCtx.translate(w / 2, h / 2 + 6);

    // Reflection pad: a soft ellipse + hairline under the ship so it sits on
    // something instead of floating on a flat plane.
    const padY = 58;
    const pad = previewCtx.createRadialGradient(0, padY, 2, 0, padY, 46);
    pad.addColorStop(0, glowColor + '30');
    pad.addColorStop(1, glowColor + '00');
    previewCtx.fillStyle = pad;
    previewCtx.beginPath();
    previewCtx.ellipse(0, padY, 46, 8, 0, 0, Math.PI * 2);
    previewCtx.fill();

    previewCtx.strokeStyle = glowColor + '3a';
    previewCtx.lineWidth = 1;
    previewCtx.beginPath();
    previewCtx.moveTo(-56, padY);
    previewCtx.lineTo(56, padY);
    previewCtx.stroke();

    // Scale dynamically depending on shape to prevent clipping in the 200x200 square
    let previewScale = 1.35;
    if (player.shape === 'falcon' || player.shape === 'titan' || player.shape === 'bomber' || player.shape === '4-wing' || player.shape === 'phantom' || player.shape === 'gunship' || player.shape === 'razor') {
        previewScale = 1.05; // Wider/bulkier ships scaled slightly down to fit comfortably
    } else if (player.shape === 'classic' || player.shape === 'speeder') {
        previewScale = 1.45; // Sleeker ships can be scaled slightly up to fill the square
    }

    previewCtx.scale(previewScale, previewScale);

    // Neon rim glow around the hull for a premium showroom readout
    previewCtx.save();
    previewCtx.shadowColor = glowColor;
    previewCtx.shadowBlur = 14;
    drawPlayerShape(previewCtx, player.shape, player.color);
    previewCtx.restore();

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
        p1OverdriveWrapper = document.getElementById('p1-overdrive-wrapper');
        p1OverdriveBar = document.getElementById('p1-overdrive-bar');
        p1LevelEl = document.getElementById('p1-level');
        p1HpDots = document.querySelector('#p1-hud .cyber-hp-dots');

        p2HealthSegments = document.getElementById('p2-health-segments');
        p2KillsEl = document.getElementById('p2-kills');
        p2ShieldWrapper = document.getElementById('p2-shield-wrapper');
        p2ShieldBar = document.getElementById('p2-shield-bar');
        p2ShooterWrapper = document.getElementById('p2-shooter-wrapper');
        p2ShooterBar = document.getElementById('p2-shooter-bar');
        p2OverdriveWrapper = document.getElementById('p2-overdrive-wrapper');
        p2OverdriveBar = document.getElementById('p2-overdrive-bar');
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

        applyTheme(currentTheme);

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

            // Up pressed twice to auto-toggle themes / Down pressed twice to stop (Home Screen ONLY)
            if (!e.repeat) {
                if (isHomeScreenActive()) {
                    const isUp = (e.key === 'ArrowUp' || e.key === 'Up' || e.code === 'ArrowUp' || e.key === 'w' || e.key === 'W');
                    const isDown = (e.key === 'ArrowDown' || e.key === 'Down' || e.code === 'ArrowDown' || e.key === 's' || e.key === 'S');

                    if (isUp) {
                        lastDownPressTime = 0;
                        const now = performance.now();
                        if (now - lastUpPressTime < THEME_DOUBLE_PRESS_DELAY) {
                            startThemeAutoToggle();
                            lastUpPressTime = 0;
                        } else {
                            lastUpPressTime = now;
                        }
                    } else if (isDown) {
                        lastUpPressTime = 0;
                        const now = performance.now();
                        if (now - lastDownPressTime < THEME_DOUBLE_PRESS_DELAY) {
                            stopThemeAutoToggle(true);
                            lastDownPressTime = 0;
                        } else {
                            lastDownPressTime = now;
                        }
                    } else if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt') {
                        lastUpPressTime = 0;
                        lastDownPressTime = 0;
                    }
                } else {
                    // Not on home screen (in gameplay, pause, or game over) — ensure auto-toggle is inactive
                    stopThemeAutoToggle();
                    lastUpPressTime = 0;
                    lastDownPressTime = 0;
                }
            }

            if (e.code === 'Space' && !isPlaying && !isGameOver && startScreen && startScreen.classList.contains('active')) {
                stopThemeAutoToggle();
                startGame();
            }

            // Pause toggle
            if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
                if (isPlaying && !isGameOver) {
                    stopThemeAutoToggle();
                    togglePause();
                }
            }

            // Theme hotkeys: 1-8 jump straight to a theme, T cycles
            if (e.key === 't' || e.key === 'T') {
                stopThemeAutoToggle();
                cycleTheme();
            } else if (e.key >= '1' && e.key <= '8') {
                stopThemeAutoToggle();
                const themeKeys = Object.keys(THEMES);
                const target = themeKeys[parseInt(e.key, 10) - 1];
                if (target) applyTheme(target, { toast: true });
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

        document.querySelectorAll('.mode-option[data-mode]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const opt = e.currentTarget;
                const mode = parseInt(opt.dataset.mode);
                setPlayerMode(mode);
            });
        });

        // Glow FX toggle binding
        const glowToggle = document.getElementById('glow-toggle');
        if (glowToggle) {
            glowToggle.addEventListener('click', () => {
                glowEnabled = !glowEnabled;

                // Planet sprites bake shadowBlur into the glow sprite, so they
                // must be re-rendered when the GLOW FX setting changes.
                planets.forEach(p => { p.glowSprite = null; });

                if (glowEnabled) {
                    glowToggle.classList.add('selected');
                    glowToggle.innerHTML = '<span class="mode-dot"></span> GLOW FX: ON';
                } else {
                    glowToggle.classList.remove('selected');
                    glowToggle.innerHTML = '<span class="mode-dot"></span> GLOW FX: OFF';
                }
            });
        }

        // Theme console: visual swatches + random button on the home screen
        buildThemeSwatches();
        // Sync the active swatch with the (possibly restored) saved theme
        document.querySelectorAll('#theme-swatches .theme-swatch').forEach(sw => {
            sw.classList.toggle('active', sw.dataset.theme === committedTheme);
        });
        const randomThemeBtn = document.getElementById('theme-random-btn');
        if (randomThemeBtn) randomThemeBtn.addEventListener('click', randomTheme);

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

        stopThemeAutoToggle();
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
            singularities = [];
            enemiesKilled = 0;
            minePity = 4; // a mine is guaranteed within the first three spawns
            nextSideShooterAt = 30;
            nextLifeAt = 50;
            nextShieldAt = 20;
            nextBossAt = 100;
            enemySpawnInterval = 1600;

            if (pauseBtn) pauseBtn.classList.remove('hidden');
            if (livesBoard) livesBoard.classList.remove('hidden');

            accumulator = 0;
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
    stopThemeAutoToggle();
    gameOverScreen.classList.remove('active');
    gameOverScreen.classList.add('hidden');
    if (pauseScreen) {
        pauseScreen.classList.remove('active');
        pauseScreen.classList.add('hidden');
    }
    startGame();
}

function goHome() {
    stopThemeAutoToggle();
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
    stopThemeAutoToggle();
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
    stopThemeAutoToggle();
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
    // Always update Stars for background movement
    stars.forEach(s => {
        s.y += s.speed * 0.5; // Slower speed in menu/background
        if (s.y > (canvas ? canvas.height : window.innerHeight)) {
            s.y = 0;
            s.x = Math.random() * (canvas ? canvas.width : window.innerWidth);
        }
    });

    // Always update Planets (parallax drift on both axes)
    planets.forEach(pl => {
        pl.y += pl.speed;
        if (pl.vx) {
            pl.x += pl.vx;
            // Gentle horizontal drift that bounces off the screen edges
            const plW = canvas ? canvas.width : window.innerWidth;
            const rightEdge = Math.max(pl.radius * 1.5, plW - pl.radius * 1.5);
            if (pl.x < pl.radius * 1.5 || pl.x > rightEdge) pl.vx *= -1;
        }
        pl.rotation += pl.rotSpeed * deltaTime;
        pl.moonAngle += 0.0007 * deltaTime;
    });
    const bgH = canvas ? canvas.height : window.innerHeight;
    for (let i = planets.length - 1; i >= 0; i--) {
        if (planets[i].y - planets[i].radius * 2 > bgH) {
            const remainingPlanets = planets.filter((_, idx) => idx !== i);
            planets.splice(i, 1, createPlanet(true, remainingPlanets));
        }
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

    // Spawn Enemies - time-based with a difficulty ramp: a fresh run sees
    // only ~1 new enemy every 2.5s, and the cadence speeds up as kills pile
    // up (up to 3 per tick at a 350ms floor). The MAX_ENEMIES cap keeps the
    // field at 20 enemies max.
    enemySpawnTimer += deltaTime;
    const spawnInterval = Math.max(350, 2500 - enemiesKilled * 18);
    if (enemySpawnTimer > spawnInterval) {
        enemySpawnTimer = 0;
        const isBossActive = enemies.some(e => e.isBoss);
        if (!isBossActive) {
            const perTick = 1 + Math.min(2, Math.floor(enemiesKilled / 50));
            for (let i = 0; i < perTick; i++) {
                if (enemies.length >= MAX_ENEMIES) break;
                spawnEnemy();
            }
        }
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
                e.x = (canvas.width / 2) + Math.sin(time) * (canvas.width / 2.8);

                // Vertical Hover: deeper, faster bob that presses down the
                // field (never dips below 100 so it can't re-trigger entry)
                e.y = 132 + Math.sin(time * 2.2) * 24;

                // Ensure it stays within bounds (safety)
                e.x = Math.max(e.width / 2, Math.min(canvas.width - e.width / 2, e.x));
            }
        } else if (e.type === 'mine') {
            // Slow drifting mine with a warning blink
            e.y += e.speed;
            e.x += Math.sin(performance.now() / 450 + e.seed) * 0.35;
            e.blink += 1;
            // Proximity detonation when a player drifts too close (blast hits
            // every player inside the radius, not just the first one spotted)
            for (const p of players) {
                if (p.isAlive && !p.invulnerable && Math.hypot(p.x - e.x, p.y - e.y) < MINE_BLAST_RADIUS) {
                    detonateMine(e, MINE_BLAST_RADIUS);
                    break;
                }
            }
        } else if (e.type === 'shielddrone') {
            e.y += e.speed;
            e.shieldAngle += 0.03;
        } else if (e.type === 'empdrone') {
            e.y += e.speed;
            // Charge-up: a ring telegraph grows during the last second before the pulse
            e.empCharge += deltaTime;
            if (e.empCharge >= e.empInterval - 1000) {
                // Ring grows to the exact pulse radius (e.empRadius) so the telegraph is honest
                e.empRing = ((e.empCharge - (e.empInterval - 1000)) / 1000) * e.empRadius;
            }
            if (e.empCharge >= e.empInterval) {
                e.empCharge = 0;
                e.empRing = 0;
                createExplosion(e.x, e.y, '#ff4dff', 14);
                // EMP pulse: completely jams the weapons of every player in range for
                // e.empJamMs (invulnerable respawn players are skipped, like other effects)
                for (const p of players) {
                    if (p.isAlive && !p.invulnerable && Math.hypot(p.x - e.x, p.y - e.y) < e.empRadius) {
                        p.empUntil = performance.now() + e.empJamMs;
                        createExplosion(p.x, p.y, '#ff4dff', 18);
                    }
                }
            }
        } else if (e.type === 'mini') {
            e.y += e.speed;
            e.x += e.vx;
            if (e.x < 20 || e.x > canvas.width - 20) e.vx *= -1;
        } else {
            e.y += e.speed;
        }

        // Collision with Players
        players.forEach(p => {
            if (p.isAlive && !p.invulnerable && !e.detonated && checkCollision(p, e)) {
                if (e.isBoss) {
                    // Boss collision rules (Boss handles damage, player takes damage)
                    if (p.hasShield) {
                        p.absorbShieldHit(25);
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
                        p.absorbShieldHit(25);
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
                    // Shield drones absorb bullets caught by their rotating shield arc
                    if (e.type === 'shielddrone' && shieldDroneBlocks(e, b)) {
                        createExplosion(b.x, b.y, '#00e5ff', 4);
                        p.bullets.splice(j, 1);
                        continue;
                    }

                    // Hit effect
                    createExplosion(b.x, b.y, e.color, 5);
                    if (!b.pierce) p.bullets.splice(j, 1);

                    e.health -= (b.damage || 1);

                    if (e.health <= 0) {
                        createExplosion(e.x, e.y, e.color, 20);
                        if (typeof anime !== 'undefined') anime.remove(e); // Cleanup animation
                        // Splitter drones burst into two mini drones
                        if (e.type === 'splitter') spawnSplitterMinis(e);
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
            // All shooters fire at the same fixed rate: one shot per second
            if (now - e.lastShot > e.shootDelay) {
                e.lastShot = now;

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

        // Boss Shooting Logic: tri-column barrage every ~600ms
        if (e.isBoss && isPlaying) {
            const now = performance.now();
            if (now - e.lastShot > e.shootDelay) {
                e.lastShot = now;
                for (const off of [-22, 0, 22]) {
                    e.bullets.push({
                        x: e.x + off,
                        y: e.y + e.height / 2 + 10,
                        width: 8,
                        height: 22,
                        speed: 6.6,
                        color: '#ff0000'
                    });
                    createMuzzleFlash(e.x + off, e.y + e.height / 2, '#ff0000');
                }
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

    // Update Singularities (gravity wells)
    for (let i = singularities.length - 1; i >= 0; i--) {
        const s = singularities[i];
        s.life -= s.decay;

        // Grow to max radius, then pulse
        if (s.currentRadius < s.maxRadius) {
            s.currentRadius += 1.5;
        } else {
            s.currentRadius = s.maxRadius + Math.sin(performance.now() * s.pulseSpeed) * 4;
        }

        // Pull active enemies and deal damage
        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            const dx = s.x - e.x;
            const dy = s.y - e.y;
            const dist = Math.hypot(dx, dy);

            // Large pull range (320px) and powerful drag (8)
            if (dist < 320) {
                const pullStrength = (1 - dist / 320) * 8;
                e.x += (dx / dist) * pullStrength;
                e.y += (dy / dist) * pullStrength;

                // Damage inside wider event horizon (80px)
                if (dist < 80) {
                    e.health -= 0.18; // Very high damage per frame
                    if (e.health <= 0) {
                        createExplosion(e.x, e.y, e.color, 15);
                        enemies.splice(j, 1);
                        enemiesKilled++;

                        // Attribute kills to the correct owner player
                        const owner = players.find(p => p.id === s.ownerId) || players[0];
                        if (owner) {
                            owner.kills++;
                            owner.specialEnergy = Math.min(owner.maxSpecialEnergy, owner.specialEnergy + 10);
                        }
                        updateKillsDisplay();
                    }
                }
            }
        }

        // Pull enemy bullets
        for (const e of enemies) {
            for (let bIndex = e.bullets.length - 1; bIndex >= 0; bIndex--) {
                const b = e.bullets[bIndex];
                const dx = s.x - b.x;
                const dy = s.y - b.y;
                const dist = Math.hypot(dx, dy);
                if (dist < 180) {
                    const pullStrength = (1 - dist / 180) * 4;
                    if (b.vx !== undefined) {
                        b.vx += (dx / dist) * pullStrength * 0.15;
                    } else {
                        b.vx = (dx / dist) * pullStrength * 0.15;
                    }
                    if (b.vy !== undefined) {
                        b.vy += (dy / dist) * pullStrength * 0.15;
                    } else {
                        b.vy = b.speed + (dy / dist) * pullStrength * 0.15;
                    }

                    // Swallow bullet if too close
                    if (dist < 20) {
                        e.bullets.splice(bIndex, 1);
                    }
                }
            }
        }

        // Swirling particles
        if (Math.random() < 0.4) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 80 + 40;
            particles.push({
                x: s.x + Math.cos(angle) * dist,
                y: s.y + Math.sin(angle) * dist,
                vx: -Math.cos(angle) * 2.5,
                vy: -Math.sin(angle) * 2.5,
                life: 1.0,
                decay: 0.04,
                size: 2,
                color: s.color,
                type: 'particle'
            });
        }

        if (s.life <= 0) {
            createExplosion(s.x, s.y, s.color, 35);
            singularities.splice(i, 1);
        }
    }
} // End update(deltaTime)

function spawnSingularity(startX, startY, ownerId) {
    singularities.push({
        x: startX,
        y: startY !== undefined ? startY : canvas.height / 2,
        currentRadius: 0,
        maxRadius: 60, // Larger visual accretion disk
        life: 1.0,
        decay: 0.0035, // Slightly longer duration (~5 seconds)
        pulseSpeed: 0.15,
        color: '#9400d3',
        ownerId: ownerId !== undefined ? ownerId : 1
    });
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
                    p.absorbShieldHit(15);
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
    // Reset shadow state to prevent glow leakage from gameplay drawing
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // Clear the canvas first
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Far & mid depth stars - drawn behind the planets so the layers separate
    for (const s of stars) {
        if (s.layer === 2) continue;
        ctx.fillStyle = s.fill;
        ctx.fillRect(s.x - s.size, s.y - s.size, s.size * 2, s.size * 2);
    }

    // Draw background Planets (parallax layer)
    planets.forEach(pl => drawPlanet(pl));

    // Near stars drift in front of the planets for extra depth separation
    for (const s of stars) {
        if (s.layer !== 2) continue;
        ctx.fillStyle = s.fill;
        ctx.fillRect(s.x - s.size, s.y - s.size, s.size * 2, s.size * 2);
    }

    if (!isPlaying && !isGameOver) {
        // Subtle overlay during menu
        ctx.fillStyle = 'rgba(5, 5, 10, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }



    // Draw Particles (absolute coords - no per-particle save/translate/restore)
    for (const p of particles) {
        if (p.type === 'shockwave') {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1.0;

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

            // Rotate outer brackets in opposite direction for high-tech effect
            const time = performance.now();
            const oppRot = -pu.rotation * 1.5;

            // Type-specific custom geometric frame
            ctx.strokeStyle = pu.color;
            ctx.lineWidth = 2.5;
            ctx.shadowBlur = 15;
            ctx.shadowColor = pu.color;

            // Semi-transparent base shape background
            ctx.fillStyle = pu.color === '#f00' ? 'rgba(255, 0, 0, 0.15)' :
                pu.color === '#0af' ? 'rgba(0, 170, 255, 0.15)' : 'rgba(0, 255, 42, 0.15)';

            if (pu.type === 'shield') {
                // Hexagonal frame for Shield
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const angle = (i * Math.PI) / 3;
                    const rx = Math.cos(angle) * 18;
                    const ry = Math.sin(angle) * 18;
                    if (i === 0) ctx.moveTo(rx, ry);
                    else ctx.lineTo(rx, ry);
                }
                ctx.closePath();
                ctx.stroke();
                ctx.fill();

                // Draw secondary inner hexagon
                ctx.save();
                ctx.rotate(oppRot * 0.5);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(0, 170, 255, 0.5)';
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const angle = (i * Math.PI) / 3;
                    const rx = Math.cos(angle) * 12;
                    const ry = Math.sin(angle) * 12;
                    if (i === 0) ctx.moveTo(rx, ry);
                    else ctx.lineTo(rx, ry);
                }
                ctx.closePath();
                ctx.stroke();
                ctx.restore();

            } else if (pu.type === 'sideshooter') {
                // Diamond/4-point star frame for Weapon/SideShooter
                ctx.beginPath();
                for (let i = 0; i < 4; i++) {
                    const angle = (i * Math.PI) / 2;
                    const r = i % 2 === 0 ? 20 : 10;
                    const rx = Math.cos(angle) * r;
                    const ry = Math.sin(angle) * r;
                    if (i === 0) ctx.moveTo(rx, ry);
                    else ctx.lineTo(rx, ry);
                }
                ctx.closePath();
                ctx.stroke();
                ctx.fill();

                // Corner crosshairs
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(-22, 0); ctx.lineTo(-16, 0);
                ctx.moveTo(22, 0); ctx.lineTo(16, 0);
                ctx.moveTo(0, -22); ctx.lineTo(0, -16);
                ctx.moveTo(0, 22); ctx.lineTo(0, 16);
                ctx.stroke();

            } else if (pu.type === 'life') {
                // Triangular core shield for Extra Life
                ctx.beginPath();
                for (let i = 0; i < 3; i++) {
                    const angle = (i * Math.PI * 2) / 3 - Math.PI / 2;
                    const rx = Math.cos(angle) * 18;
                    const ry = Math.sin(angle) * 18;
                    if (i === 0) ctx.moveTo(rx, ry);
                    else ctx.lineTo(rx, ry);
                }
                ctx.closePath();
                ctx.stroke();
                ctx.fill();

                // Inner pulsing heart core
                ctx.save();
                ctx.rotate(oppRot * 0.3);
                ctx.strokeStyle = '#ff8888';
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let i = 0; i < 3; i++) {
                    const angle = (i * Math.PI * 2) / 3 - Math.PI / 2;
                    const rx = Math.cos(angle) * 11;
                    const ry = Math.sin(angle) * 11;
                    if (i === 0) ctx.moveTo(rx, ry);
                    else ctx.lineTo(rx, ry);
                }
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            } else {
                // Fallback circular style
                ctx.beginPath();
                ctx.arc(0, 0, 15, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fill();
            }

            // High-tech outer orbit arcs (spinning brackets)
            ctx.save();
            ctx.rotate(oppRot);
            ctx.strokeStyle = pu.color;
            ctx.lineWidth = 1.5;
            // Draw bracket 1
            ctx.beginPath();
            ctx.arc(0, 0, 24, -Math.PI / 4, Math.PI / 4);
            ctx.stroke();
            // Draw bracket 2
            ctx.beginPath();
            ctx.arc(0, 0, 24, Math.PI * 3 / 4, Math.PI * 5 / 4);
            ctx.stroke();
            ctx.restore();

            // Center Symbol Core (bright white/glow text)
            ctx.save();
            ctx.rotate(-pu.rotation); // Keep the symbol upright
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 5;
            ctx.shadowColor = '#ffffff';
            ctx.font = 'bold 13px "Courier New", Courier, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            let symbol = '?';
            if (pu.type === 'sideshooter') symbol = '⚡';
            if (pu.type === 'life') symbol = '❤️';
            if (pu.type === 'shield') symbol = '🛡️';
            ctx.fillText(symbol, 0, 0.5);
            ctx.restore();

            ctx.restore();
        }
    }

    // Draw Singularities (Black holes with glowing accretion disks)
    if (isPlaying || isGameOver) {
        for (const s of singularities) {
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.globalAlpha = s.life;
            ctx.shadowBlur = 25;
            ctx.shadowColor = s.color;

            // Accretion disk
            ctx.strokeStyle = 'rgba(148, 0, 211, 0.45)';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(0, 0, s.currentRadius * 1.4, performance.now() / 100, performance.now() / 100 + Math.PI * 1.5);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(75, 0, 130, 0.6)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, 0, s.currentRadius * 1.1, -performance.now() / 80, -performance.now() / 80 + Math.PI * 1.2);
            ctx.stroke();

            // Event horizon (Black center core with glowing border)
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(0, 0, s.currentRadius * 0.75, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = s.color;
            ctx.lineWidth = 3;
            ctx.stroke();

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
            drawInGameEnemyShip(ctx, e);

            // Health bar for sturdy enemies. The boss uses the fixed
            // screen-space HUD drawn at the end of draw() instead, so its
            // meter is visible the moment the boss arrives on screen.
            if (!e.isBoss && e.maxHealth > 1) {
                const hpPercent = e.health / e.maxHealth;
                ctx.fillStyle = 'red';
                ctx.fillRect(-e.width / 2, -e.height / 2 - 10, e.width, 5);
                ctx.fillStyle = 'green';
                ctx.fillRect(-e.width / 2, -e.height / 2 - 10, e.width * hpPercent, 5);
            }

            ctx.restore();
        }
    }

function _localDrawInGameEnemyShip(ctx, e) {
    if (e.isBoss || e.type === 'boss') {
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

                // 7. Heavy armor plating: bolted plate overlays across the
                //    chassis so the boss reads as layered, riveted armor.
                const rivet = (x, y, r, col = 'rgba(205, 218, 238, 0.65)') => {
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.fillStyle = col;
                    ctx.fill();
                };

                // (a) Cheek/bezel plates flanking the reactor ring
                for (let side of [-1, 1]) {
                    poly([
                        { x: side * w * 0.30, y: -h * 0.055 },
                        { x: side * w * 0.16, y: -h * 0.03 },
                        { x: side * w * 0.15, y: h * 0.035 },
                        { x: side * w * 0.17, y: h * 0.115 },
                        { x: side * w * 0.31, y: h * 0.095 },
                        { x: side * w * 0.34, y: h * 0.02 }
                    ], lightMetal, bossColor, 1.5);
                    poly([
                        { x: side * w * 0.285, y: -h * 0.045 },
                        { x: side * w * 0.185, y: -h * 0.025 },
                        { x: side * w * 0.18, y: h * 0.03 },
                        { x: side * w * 0.29, y: h * 0.065 }
                    ], darkMetal, bossColor, 1);
                    rivet(side * w * 0.30, -h * 0.03, w * 0.012);
                    rivet(side * w * 0.30, h * 0.06, w * 0.012);
                }

                // (b) Angled jaw guards under the reactor, over the fuselage
                for (let side of [-1, 1]) {
                    poly([
                        { x: side * w * 0.16, y: h * 0.13 },
                        { x: side * w * 0.045, y: h * 0.17 },
                        { x: side * w * 0.025, y: h * 0.28 },
                        { x: side * w * 0.115, y: h * 0.24 }
                    ], midMetal, bossColor, 1.5);
                    line([
                        { x: side * w * 0.145, y: h * 0.15 },
                        { x: side * w * 0.055, y: h * 0.245 }
                    ], panelLineColor, 1);
                    rivet(side * w * 0.115, h * 0.215, w * 0.009);
                }

                // (c) Keel plates down the lower fuselage (leave nose seam)
                for (let side of [-1, 1]) {
                    poly([
                        { x: side * w * 0.055, y: h * 0.34 },
                        { x: side * w * 0.015, y: h * 0.345 },
                        { x: side * w * 0.0, y: h * 0.6 },
                        { x: side * w * 0.045, y: h * 0.52 }
                    ], darkMetal, bossColor, 1);
                }

                // (d) Bolted braces over each lower stabilizer leg
                for (let side of [-1, 1]) {
                    poly([
                        { x: side * w * 0.10, y: h * 0.10 },
                        { x: side * w * 0.20, y: h * 0.115 },
                        { x: side * w * 0.235, y: h * 0.26 },
                        { x: side * w * 0.13, y: h * 0.17 }
                    ], lightMetal, bossColor, 1.5);
                    poly([
                        { x: side * w * 0.115, y: h * 0.115 },
                        { x: side * w * 0.185, y: h * 0.125 },
                        { x: side * w * 0.215, y: h * 0.235 }
                    ], midMetal, bossColor, 1);
                    rivet(side * w * 0.21, h * 0.17, w * 0.01);
                    rivet(side * w * 0.13, h * 0.135, w * 0.01);
                }

                // 8. Massive Mechanical Wings (drawn on top or slightly behind)
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

                    // Armored leading-edge blade segments (bolted plating)
                    poly([
                        { x: side * w * 0.40, y: -h * 0.19 },
                        { x: side * w * 0.45, y: -h * 0.245 },
                        { x: side * w * 0.62, y: -h * 0.36 },
                        { x: side * w * 0.58, y: -h * 0.31 }
                    ], lightMetal, bossColor, 1.5);
                    poly([
                        { x: side * w * 0.63, y: -h * 0.365 },
                        { x: side * w * 0.68, y: -h * 0.415 },
                        { x: side * w * 0.88, y: -h * 0.49 },
                        { x: side * w * 0.84, y: -h * 0.44 }
                    ], midMetal, bossColor, 1.5);
                    rivet(side * w * 0.51, -h * 0.285, w * 0.009);
                    rivet(side * w * 0.73, -h * 0.41, w * 0.009);

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

                // 9. Shoulder pauldron armor capping each wing root
                for (let side of [-1, 1]) {
                    poly([
                        { x: side * w * 0.14, y: -h * 0.155 },
                        { x: side * w * 0.30, y: -h * 0.225 },
                        { x: side * w * 0.345, y: -h * 0.125 },
                        { x: side * w * 0.33, y: -h * 0.01 },
                        { x: side * w * 0.21, y: -h * 0.002 },
                        { x: side * w * 0.155, y: -h * 0.09 }
                    ], darkMetal, bossColor, 2);

                    // Inner raised plate
                    poly([
                        { x: side * w * 0.19, y: -h * 0.145 },
                        { x: side * w * 0.27, y: -h * 0.19 },
                        { x: side * w * 0.305, y: -h * 0.125 },
                        { x: side * w * 0.285, y: -h * 0.04 },
                        { x: side * w * 0.21, y: -h * 0.035 }
                    ], midMetal, bossColor, 1);

                    // Corner rivets
                    rivet(side * w * 0.16, -h * 0.13, w * 0.01);
                    rivet(side * w * 0.32, -h * 0.125, w * 0.01);
                    rivet(side * w * 0.31, -h * 0.035, w * 0.01);
                    rivet(side * w * 0.185, -h * 0.10, w * 0.009);

                    // Neon rim along the outer shoulder edge
                    ctx.save();
                    glowGlow(bossColor, 6);
                    line([
                        { x: side * w * 0.16, y: -h * 0.145 },
                        { x: side * w * 0.30, y: -h * 0.22 },
                        { x: side * w * 0.345, y: -h * 0.12 }
                    ], bossColor, 2);
                    ctx.restore();
                }
            } else if (e.type === 'mine') {
                drawMineEnemy(ctx, e);
            } else if (e.type === 'shielddrone') {
                // Shield drone: saucer with a rotating energy shield arc
                const w = e.width;
                const h = e.height;
                const accent = e.color;

                // Rotating shield arc (200 degrees, centered on e.shieldAngle -
                // matches the arc that actually blocks bullets in shieldDroneBlocks)
                ctx.save();
                ctx.shadowBlur = 16;
                ctx.shadowColor = accent;
                ctx.globalAlpha = 0.22;
                ctx.strokeStyle = accent;
                ctx.lineWidth = 8;
                ctx.beginPath();
                ctx.arc(0, 0, Math.max(w, h) * 0.62, e.shieldAngle - 1.745, e.shieldAngle + 1.745);
                ctx.stroke();
                ctx.globalAlpha = 0.9;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(0, 0, Math.max(w, h) * 0.62, e.shieldAngle - 1.745, e.shieldAngle + 1.745);
                ctx.stroke();
                ctx.restore();

                // Saucer hull
                ctx.beginPath();
                ctx.ellipse(0, 0, w * 0.4, h * 0.24, 0, 0, Math.PI * 2);
                ctx.fillStyle = '#123b45';
                ctx.fill();
                ctx.strokeStyle = accent;
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Dome
                ctx.beginPath();
                ctx.arc(0, -h * 0.08, w * 0.16, Math.PI, 0);
                ctx.fillStyle = '#1d6a7a';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Core light
                ctx.beginPath();
                ctx.arc(0, h * 0.05, w * 0.07, 0, Math.PI * 2);
                ctx.fillStyle = '#9ff3ff';
                ctx.fill();

                // Pulsing emitter tips
                for (const side of [-1, 1]) {
                    ctx.beginPath();
                    ctx.arc(side * w * 0.36, 0, w * 0.05, 0, Math.PI * 2);
                    ctx.fillStyle = accent;
                    ctx.fill();
                }
            } else if (e.type === 'empdrone') {
                // EMP disruptor: octahedral jammer with crackling arcs
                const w = e.width;
                const h = e.height;
                const accent = e.color;
                const t = performance.now();

                // Charging telegraph ring (grows during the last second before the pulse)
                if (e.empRing > 0) {
                    ctx.save();
                    ctx.strokeStyle = accent;
                    ctx.shadowColor = accent;
                    ctx.shadowBlur = 12;
                    ctx.globalAlpha = 0.55;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(0, 0, e.empRing, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                }

                // Diamond octahedral hull
                ctx.beginPath();
                ctx.moveTo(0, -h * 0.42);
                ctx.lineTo(w * 0.34, -h * 0.12);
                ctx.lineTo(w * 0.34, h * 0.14);
                ctx.lineTo(0, h * 0.4);
                ctx.lineTo(-w * 0.34, h * 0.14);
                ctx.lineTo(-w * 0.34, -h * 0.12);
                ctx.closePath();
                ctx.fillStyle = '#3a1030';
                ctx.fill();
                ctx.strokeStyle = accent;
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Inner core brightens as it charges toward the pulse
                const chargePct = Math.min(1, e.empCharge / e.empInterval);
                const corePulse = 0.5 + Math.sin(t / 120) * 0.3 + chargePct * 0.3;
                ctx.save();
                ctx.shadowBlur = 18 * corePulse;
                ctx.shadowColor = accent;
                ctx.beginPath();
                ctx.arc(0, 0, w * 0.14, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + corePulse * 0.5).toFixed(2) + ')';
                ctx.fill();
                ctx.restore();

                // Crackling electric arcs along the hull edges
                ctx.save();
                ctx.strokeStyle = accent;
                ctx.shadowColor = accent;
                ctx.shadowBlur = 8;
                ctx.globalAlpha = 0.8;
                ctx.lineWidth = 1.2;
                for (let side = -1; side <= 1; side += 2) {
                    ctx.beginPath();
                    ctx.moveTo(side * w * 0.18, -h * 0.3 + Math.sin(t / 90 + e.seed) * 3);
                    ctx.lineTo(side * w * 0.28, -h * 0.1 + Math.sin(t / 70 + e.seed * 2) * 4);
                    ctx.lineTo(side * w * 0.22, h * 0.05 + Math.sin(t / 110 + e.seed) * 3);
                    ctx.lineTo(side * w * 0.14, h * 0.2 + Math.sin(t / 80 + e.seed * 3) * 3);
                    ctx.stroke();
                }
                ctx.restore();

                // Rotating outer ring segments
                ctx.save();
                ctx.strokeStyle = accent;
                ctx.shadowColor = accent;
                ctx.shadowBlur = 6;
                ctx.globalAlpha = 0.5;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(0, 0, w * 0.52, t / 400, t / 400 + Math.PI * 0.6);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(0, 0, w * 0.52, t / 400 + Math.PI, t / 400 + Math.PI * 1.6);
                ctx.stroke();
                ctx.restore();
            } else if (e.type === 'splitter' || e.type === 'mini') {
                const w = e.width;
                const h = e.height;

                const lp = (pts, fill, stroke, sw = 1) => {
                    ctx.beginPath();
                    ctx.moveTo(pts[0][0], pts[0][1]);
                    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                    ctx.closePath();
                    if (fill) {
                        ctx.fillStyle = fill;
                        ctx.fill();
                    }
                    if (stroke) {
                        ctx.strokeStyle = stroke;
                        ctx.lineWidth = sw;
                        ctx.stroke();
                    }
                };

                if (e.type === 'mini') {
                    // Mini dart released by splitter carriers
                    ctx.rotate(Math.PI);
                    lp([[0, -h * 0.55], [w * 0.14, -h * 0.1], [w * 0.1, h * 0.3], [0, h * 0.38], [-w * 0.1, h * 0.3], [-w * 0.14, -h * 0.1]], '#5d46a0', e.color, 1.2);
                    lp([[-w * 0.08, -h * 0.05], [-w * 0.52, h * 0.18], [-w * 0.44, h * 0.28], [-w * 0.06, h * 0.12]], '#3a2a5c', e.color, 1);
                    lp([[w * 0.08, -h * 0.05], [w * 0.52, h * 0.18], [w * 0.44, h * 0.28], [w * 0.06, h * 0.12]], '#3a2a5c', e.color, 1);
                    ctx.save();
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = e.color;
                    ctx.beginPath();
                    ctx.arc(0, h * 0.34, w * 0.06, 0, Math.PI * 2);
                    ctx.fillStyle = e.color;
                    ctx.fill();
                    ctx.restore();
                } else {
                    // Splitter carrier: hexagonal hull with two detachable mini pods
                    lp([[-w * 0.52, -h * 0.12], [-w * 0.34, -h * 0.22], [-w * 0.3, h * 0.1], [-w * 0.48, h * 0.2]], '#3a2a5c', e.color, 1);
                    lp([[w * 0.52, -h * 0.12], [w * 0.34, -h * 0.22], [w * 0.3, h * 0.1], [w * 0.48, h * 0.2]], '#3a2a5c', e.color, 1);
                    lp([[-w * 0.42, -h * 0.02], [-w * 0.36, -h * 0.06], [-w * 0.33, h * 0.02], [-w * 0.4, h * 0.06]], e.color);
                    lp([[w * 0.42, -h * 0.02], [w * 0.36, -h * 0.06], [w * 0.33, h * 0.02], [w * 0.4, h * 0.06]], e.color);
                    lp([
                        [0, -h * 0.5], [w * 0.32, -h * 0.26], [w * 0.32, h * 0.1],
                        [0, h * 0.34], [-w * 0.32, h * 0.1], [-w * 0.32, -h * 0.26]
                    ], '#4a3678', e.color, 1.5);
                    lp([
                        [0, -h * 0.34], [w * 0.2, -h * 0.18], [w * 0.2, h * 0.04],
                        [0, h * 0.18], [-w * 0.2, h * 0.04], [-w * 0.2, -h * 0.18]
                    ], '#5d46a0', e.color, 1);
                    // Pulsing core
                    const pulse = 0.6 + Math.sin(performance.now() / 160) * 0.4;
                    ctx.save();
                    ctx.shadowBlur = 16 * pulse;
                    ctx.shadowColor = e.color;
                    ctx.beginPath();
                    ctx.arc(0, -h * 0.06, w * 0.09, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + pulse * 0.7).toFixed(2) + ')';
                    ctx.fill();
                    ctx.restore();
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

                ctx.shadowBlur = 0;
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

    // Fixed boss health HUD (screen-space, drawn above the world so the meter
    // is always visible while a boss is alive, including during its entry).
    drawBossHud();
}

function drawBossHud() {
    if (!isPlaying && !isGameOver) return;
    const boss = enemies.find(e => e.isBoss && e.maxHealth > 0);
    if (!boss) return;

    const hpPct = Math.max(0, Math.min(1, boss.health / boss.maxHealth));
    const cw = canvas.width;
    // Keep the meter clear of the corner player HUDs / center pause button.
    const bw = Math.min(520, Math.max(150, cw - 800));
    const bh = 12;
    const bx = (cw - bw) / 2;
    const by = cw < 600 ? 40 : 86;

    const plate = (px, py, pw, ph) => {
        ctx.beginPath();
        ctx.moveTo(px + 5, py);
        ctx.lineTo(px + pw - 5, py);
        ctx.lineTo(px + pw, py + ph);
        ctx.lineTo(px, py + ph);
        ctx.closePath();
    };

    ctx.save();
    ctx.shadowBlur = 0;

    // Soft drop shadow so the plate reads over the starfield
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    plate(bx + 2, by + 3, bw, bh);
    ctx.fill();

    // Outer armored frame
    plate(bx, by, bw, bh);
    ctx.fillStyle = '#14161d';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 40, 40, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Inner track
    plate(bx + 2.5, by + 2.5, bw - 5, bh - 5);
    ctx.fillStyle = '#07080b';
    ctx.fill();

    // Health fill (integrity energy), flickers when critically low
    const fillW = (bw - 5) * hpPct;
    if (fillW > 1) {
        ctx.save();
        if (hpPct < 0.25) {
            ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 90) * 0.45;
        }
        const grad = ctx.createLinearGradient(bx + 2.5, 0, bx + 2.5 + fillW, 0);
        grad.addColorStop(0, '#ff1e2e');
        grad.addColorStop(0.55, '#ff5a36');
        grad.addColorStop(1, '#ff9a3c');
        ctx.fillStyle = grad;
        ctx.shadowColor = '#ff2a2a';
        ctx.shadowBlur = 7;
        const slantFill = Math.max(0, Math.min(4, fillW / 2 - 1));
        ctx.beginPath();
        ctx.moveTo(bx + 2.5 + slantFill, by + 2.5);
        ctx.lineTo(bx + 2.5 + fillW - slantFill, by + 2.5);
        ctx.lineTo(bx + 2.5 + fillW, by + bh - 2.5);
        ctx.lineTo(bx + 2.5, by + bh - 2.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // Armor segment ticks + top bevel highlight
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
        const sx = bx + 2.5 + ((bw - 5) * i) / 10;
        ctx.beginPath();
        ctx.moveTo(sx, by + 4.5);
        ctx.lineTo(sx, by + bh - 3.5);
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.moveTo(bx + 7, by + 3.6);
    ctx.lineTo(bx + bw - 6, by + 3.6);
    ctx.stroke();
    ctx.restore();

    // End rivets
    ctx.fillStyle = 'rgba(212, 222, 238, 0.75)';
    ctx.beginPath();
    ctx.arc(bx + 5, by + bh / 2, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx + bw - 5, by + bh / 2, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Class label above the plate
    ctx.font = '600 10px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = '#ff2a2a';
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(255, 90, 70, 0.95)';
    ctx.fillText('A P E X   F A N G', cw / 2, by - 6);
    ctx.restore();
}

function gameLoop(timestamp) {
    try {
        let deltaTime = timestamp - lastTime;
        lastTime = timestamp;

        // Cap deltaTime to avoid massive catchup updates on tab switch/lag spikes
        if (deltaTime > 100) deltaTime = 100;
        if (isNaN(deltaTime)) deltaTime = 0;

        accumulator += deltaTime;

        const fixedTimeStep = 1000 / 60; // 60Hz physics updates (16.67ms)
        // Guard against the "spiral of death": if a single frame takes very
        // long (GC hitch, tab switch), never run more than MAX_SIM_STEPS
        // catch-up updates per rendered frame - otherwise the game freezes.
        let steps = 0;
        while (accumulator >= fixedTimeStep && steps < MAX_SIM_STEPS) {
            update(fixedTimeStep);
            accumulator -= fixedTimeStep;
            steps++;
        }
        if (steps === MAX_SIM_STEPS) accumulator = 0; // Drop the backlog

        updateHUD();
        draw(); // Draw always

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

    // Every archetype is always in the mix from the very first spawn - no
    // kill-count unlocks (chaos mode). The mine gets the widest band (~1 in 3
    // spawns, vs ~1 in 6 before) and a pity counter widens it further - then
    // forces a mine outright - so a run never goes more than 6 spawns without
    // one. Tuned so mines stay a constant presence rather than an event.
    const mineChance = 0.24 + Math.min(0.10, minePity * 0.05);
    const roll = Math.random();
    let type = null;
    if (minePity >= 6 || roll < mineChance) {
        type = 'mine';
    } else if (roll < mineChance + 0.10) {
        type = 'shielddrone';
    } else if (roll < mineChance + 0.19) {
        type = 'splitter';
    } else if (roll < mineChance + 0.26) {
        type = 'empdrone';
    }
    // Bands above total 50% of spawns at the base mine chance, matching the
    // archRate used to normalise the shooter chance below.
    minePity = (type === 'mine') ? 0 : minePity + 1;
    if (type) {
        enemies.push(createArchetypeEnemy(type, x, size));
        return;
    }        // Higher chance to spawn a shooting enemy (starts at 25% and increases with
    // kills). The archetype roll above claims up to ~52% of spawns, so the
    // shooter chance is scaled up by the non-archetype fraction to keep the
    // shooter frequency close to its pre-archetype level.
    const archRate = 0.50; // Archetypes always claim a fixed 50% share
    const shooterChance = Math.min(0.85, (0.25 + (enemiesKilled / 350)) / (1 - archRate));
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
        shootDelay: 1000, // 1 second - all shooters fire at the same rate
        bullets: []
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

// Builds one of the new enemy archetypes (mine / shield drone / splitter)
function createArchetypeEnemy(type, x, size) {
    const base = {
        x: x,
        y: -50,
        width: size,
        height: size,
        color: '#ffffff',
        health: 1,
        maxHealth: 1,
        bullets: [],
        type: type,
        seed: Math.random() * Math.PI * 2
    };

    if (type === 'mine') {
        return Object.assign(base, {
            width: size * 0.9,
            height: size * 0.9,
            speed: 0.45 + Math.random() * 0.3,
            color: '#ff3b5c',
            blink: 0,
            // Preview dummies never set this, so the telegraph ring only shows
            // up on live mines in the play field.
            blastRadius: MINE_BLAST_RADIUS
        });
    }
    if (type === 'shielddrone') {
        return Object.assign(base, {
            width: size * 0.9,
            height: size * 0.9,
            speed: 0.5 + Math.random() * 0.25,
            color: '#00e5ff',
            health: 3,
            maxHealth: 3,
            shieldAngle: Math.random() * Math.PI * 2
        });
    }
    if (type === 'splitter') {
        return Object.assign(base, {
            speed: 0.7 + Math.random() * 0.4,
            color: '#9b6bff',
            health: 2,
            maxHealth: 2
        });
    }
    if (type === 'empdrone') {
        return Object.assign(base, {
            width: size * 0.85,
            height: size * 0.85,
            speed: 0.5 + Math.random() * 0.2,
            color: '#ff4dff',
            health: 4,
            maxHealth: 4,
            empCharge: 0,
            empInterval: 4000,
            empRadius: 240,   // Pulse/jam radius - the telegraph ring always matches this
            empJamMs: 8000,   // How long a hit player's weapons stay jammed
            empRing: 0,
            seed: Math.random() * Math.PI * 2
        });
    }
    return base;
}

// Splitters burst into two fast mini drones when destroyed
function spawnSplitterMinis(e) {
    for (let side = -1; side <= 1; side += 2) {
        enemies.push({
            x: e.x + side * 8,
            y: e.y,
            width: e.width * 0.5,
            height: e.height * 0.5,
            speed: 1.3 + Math.random() * 0.5,
            vx: side * (1.2 + Math.random() * 0.6),
            color: '#b78cff',
            type: 'mini',
            health: 1,
            maxHealth: 1,
            bullets: [],
            seed: Math.random() * Math.PI * 2
        });
    }
}

// Mine proximity blast: damages EVERY player inside the blast radius (shields absorb one hit)
function detonateMine(e, radius) {
    createExplosion(e.x, e.y, e.color, 45);
    for (const p of players) {
        if (!p.isAlive || p.invulnerable) continue;
        if (Math.hypot(p.x - e.x, p.y - e.y) > radius) continue;
        if (p.hasShield) {
            p.absorbShieldHit(25);
        } else {
            p.loseLife();
            createExplosion(p.x, p.y, p.color, 30);
        }
    }
    e.detonated = true;
    e.markedForDeletion = true;
    if (typeof anime !== 'undefined') anime.remove(e);
}

// Shield drones absorb bullets that hit their rotating shield arc (~200 degrees)
function shieldDroneBlocks(e, b) {
    const ang = Math.atan2(b.y - e.y, b.x - e.x);
    let rel = ang - e.shieldAngle;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    return Math.abs(rel) < 1.745;
}

function spawnBoss() {
    const size = 200;
    const x = canvas.width / 2;

    enemies.push({
        x: x,
        y: -100,
        width: size,
        height: size,
        speed: 1.6, // Entry speed
        dx: 1.6, // Horizontal speed
        color: '#ff0000', // Red for boss
        isBoss: true,
        health: 170, // 170 hits
        maxHealth: 170,
        lastShot: performance.now(),
        shootDelay: 600, // Faster tri-shot barrage cadence
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
        // Tied directly to lives remaining: full lives = blue, 2 left = yellow, 1 left = red
        segmentsContainer.classList.remove('state-high', 'state-warning', 'state-danger');
        if (player.lives >= player.maxLives) {
            segmentsContainer.classList.add('state-high');
        } else if (player.lives >= player.maxLives - 1) {
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
    // Skip all DOM writes unless actively playing (menu/pause screens don't
    // need the per-frame timer bars, avoiding needless style/layout work).
    if (!isPlaying || isPaused) return;

    const now = performance.now();

    players.forEach((player, index) => {
        const shieldWrapper = index === 0 ? p1ShieldWrapper : p2ShieldWrapper;
        const shieldBar = index === 0 ? p1ShieldBar : p2ShieldBar;
        const shooterWrapper = index === 0 ? p1ShooterWrapper : p2ShooterWrapper;
        const shooterBar = index === 0 ? p1ShooterBar : p2ShooterBar;
        const overdriveWrapper = index === 0 ? p1OverdriveWrapper : p2OverdriveWrapper;
        const overdriveBar = index === 0 ? p1OverdriveBar : p2OverdriveBar;

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

        // Update Overdrive Timer
        if (player.hasOverdrive) {
            overdriveWrapper.style.display = 'block';
            const remaining = player.overdriveEndTime - now;
            const percent = Math.max(0, (remaining / 8000) * 100);
            overdriveBar.style.width = percent + '%';
        } else {
            overdriveWrapper.style.display = 'none';
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

// --- 3D Shading Helpers ---
// Parse a hex (#rgb/#rrggbb/#rrggbbaa) or rgb()/rgba() color string into components.
function parseColorToRGBA(color) {
    if (typeof color !== 'string') return { r: 255, g: 255, b: 255, a: 1 };
    const c = color.trim();
    if (c[0] === '#') {
        let hex = c.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            hex = hex.split('').map(ch => ch + ch).join('');
        }
        const num = parseInt(hex.slice(0, 6), 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        return { r, g, b, a };
    }
    const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
    if (m) {
        return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
    }
    return { r: 255, g: 255, b: 255, a: 1 };
}

// Lighten (amt > 0) or darken (amt < 0) an already-parsed color, roughly -1..1
function shadeColor(rgba, amt) {
    const clamp = v => Math.max(0, Math.min(255, v));
    let r, g, b;
    if (amt >= 0) {
        r = clamp(rgba.r + (255 - rgba.r) * amt);
        g = clamp(rgba.g + (255 - rgba.g) * amt);
        b = clamp(rgba.b + (255 - rgba.b) * amt);
    } else {
        r = clamp(rgba.r * (1 + amt));
        g = clamp(rgba.g * (1 + amt));
        b = clamp(rgba.b * (1 + amt));
    }
    return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${rgba.a})`;
}

function drawPlayerShape(ctx, shape, primary) {
    const p = primary || '#0ff';
    const s = p; // Use primary color for accent as well to remove secondary color effect

    // Multiplier to normalize all shapes to a consistent size
    let sc = 1.0;
    if (shape === 'classic') sc = 0.35; // Normalized scale for the detailed blueprint fighter
    else if (shape === 'fighter') sc = 0.38; // Scaled to accommodate new longer needle-nose profile
    else if (shape === 'interceptor') sc = 0.38; // Scaled up size
    else if (shape === 'bomber') sc = 0.44;
    else if (shape === 'speeder') sc = 0.45;
    else if (shape === 'stealth') sc = 0.43;
    else if (shape === 'titan') sc = 0.52; // Heavy class size boost
    else if (shape === 'vintage') sc = 0.38;
    else if (shape === '4-wing') sc = 0.40;
    else if (shape === 'falcon') sc = 0.38;
    else if (shape === 'phantom') sc = 0.38;
    else if (shape === 'gunship') sc = 0.38;
    else if (shape === 'razor') sc = 0.38;

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

        // 3D bevel shading: simulate a light source from the upper-left so
        // every panel has a highlight edge and a shadowed edge like a
        // beveled/extruded surface instead of a flat silhouette fill.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < pts.length; i++) {
            const px = pts[i][0], py = pts[i][1];
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
        }
        const spanX = (maxX - minX) || 1;
        const spanY = (maxY - minY) || 1;
        const base = parseColorToRGBA(color);
        const grad = ctx.createLinearGradient(
            minX - spanX * 0.2, minY - spanY * 0.2,
            maxX + spanX * 0.2, maxY + spanY * 0.2
        );
        grad.addColorStop(0, shadeColor(base, 0.4));
        grad.addColorStop(0.45, shadeColor(base, 0.05));
        grad.addColorStop(1, shadeColor(base, -0.4));
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = shadeColor(base, -0.55);
        ctx.lineWidth = 1 / sc; // Maintain consistent line weight
        ctx.stroke();

        // Thin highlight along the upper-left rim to sell the bevel edge
        ctx.globalAlpha = (alpha !== undefined ? alpha : 1) * 0.5;
        ctx.strokeStyle = shadeColor(base, 0.55);
        ctx.lineWidth = 0.6 / sc;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
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
        if (r > 1.1) {
            // Glossy 3D bead: bright highlight top-left, dark rim bottom-right
            const base = parseColorToRGBA(color);
            const grad = ctx.createRadialGradient(
                x - r * 0.35, y - r * 0.35, Math.max(r * 0.05, 0.01),
                x, y, r
            );
            grad.addColorStop(0, shadeColor(base, 0.6));
            grad.addColorStop(0.6, shadeColor(base, 0.05));
            grad.addColorStop(1, shadeColor(base, -0.35));
            ctx.fillStyle = grad;
        } else {
            ctx.fillStyle = color; // tiny rivets stay flat, gradient adds no value at this size
        }
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
        ctx.shadowBlur = 0;
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
        // --- FIGHTER: Stealth Delta Interceptor (Reference Image Match) ---
        const dark = '#15171c'; // Deep mechanical charcoal
        const metal = '#5a626a'; // Medium metallic grey
        const lightMetal = '#8b939c'; // Light gray accents

        ctx.save();
        ctx.shadowBlur = 0;
        ctx.shadowColor = p;

        // 1. Long Pointed Nose (Stealth needle-profile, narrowed)
        poly([[0, -100], [-6, -60], [-6, -40], [6, -40], [6, -60]], dark);
        poly([[0, -95], [-3, -60], [-3, -40], [0, -35], [3, -40], [3, -60]], '#22252c'); // Inner facet
        line([[0, -98], [0, -35]], p, 1.2); // Glowing center laser line

        // Symmetrical grey metal collar armor plates behind nose
        poly([[-6, -60], [-9, -35], [-6, -35]], metal);
        poly([[6, -60], [9, -35], [6, -35]], metal);

        // 2. Canard Forewings (Fore Canards, matching small angled shapes in diagram)
        // Left Canard
        poly([[-6, -30], [-24, -20], [-20, -10], [-6, -15]], '#2a2e38');
        poly([[-6, -30], [-24, -20], [-22, -18]], p, 0.85); // Glowing leading edge
        poly([[-24, -20], [-20, -10], [-21, -12], [-23, -18]], '#ffffff'); // White tip plate
        circ(-20, -18, 1, 'rgba(255,255,255,0.4)'); // Joint rivet

        // Right Canard
        poly([[6, -30], [24, -20], [20, -10], [6, -15]], '#2a2e38');
        poly([[6, -30], [24, -20], [22, -18]], p, 0.85);
        poly([[24, -20], [20, -10], [21, -12], [23, -18]], '#ffffff');
        circ(20, -18, 1, 'rgba(255,255,255,0.4)');

        // 3. Central Slender Torso & Parallel Ridges (Double lanes running down body, narrowed)
        poly([[-8, -20], [8, -20], [12, 75], [-12, 75]], dark);

        // Symmetrical side engine housings
        poly([[-16, 0], [-10, 0], [-10, 75], [-16, 75]], '#22252c');
        poly([[10, 0], [16, 0], [16, 75], [10, 75]], '#22252c');
        poly([[-15, 5], [-11, 5], [-11, 70], [-15, 70]], metal);
        poly([[11, 5], [15, 5], [15, 70], [11, 70]], metal);
        circ(-13, 10, 1, 'rgba(255,255,255,0.4)');
        circ(13, 10, 1, 'rgba(255,255,255,0.4)');

        // Symmetrical loops/wires on the engine casing base
        line([[-13, 45], [-13, 55], [-15, 50]], 'rgba(255, 255, 255, 0.4)', 1);
        line([[13, 45], [13, 55], [14, 50]], 'rgba(255, 255, 255, 0.4)', 1);

        // Symmetrical Air Intake throats on the shoulder roots
        poly([[-16, 0], [-10, 0], [-10, -5], [-16, -5]], '#0d1117'); // Left Intake throat
        line([[-16, -5], [-10, -5]], p, 1.2); // Glowing intake lip
        poly([[16, 0], [10, 0], [10, -5], [16, -5]], '#0d1117'); // Right Intake throat
        line([[16, -5], [10, -5]], p, 1.2);

        // Symmetrical double parallel lanes
        poly([[-6, -10], [-2, -10], [-2, 75], [-6, 75]], '#3a3f47');
        line([[-4, -10], [-4, 75]], p, 1.2); // Left neon track

        poly([[2, -10], [6, -10], [6, 75], [2, 75]], '#3a3f47');
        line([[4, -10], [4, 75]], p, 1.2); // Right neon track

        // Central Cowl Hexagonal armor hatch
        poly([[-4, -10], [4, -10], [5, -4], [0, 0], [-5, -4]], metal);

        // Cockpit canopy housing
        poly([[0, -38], [4.5, -25], [4.5, -12], [0, -4], [-4.5, -12], [-4.5, -25]], '#0d1117');
        poly([[0, -35], [3.5, -25], [3.5, -14], [0, -6]], p, 0.4); // Tinted canopy windshield
        line([[0, -38], [0, -4]], 'rgba(255, 255, 255, 0.4)', 0.8);

        // 4. Large Stealth Delta Wings (Swept back, medium size, with white wingtip plates)
        // Left Wing
        poly([[-16, 10], [-72, 55], [-74, 62], [-16, 60]], '#15171c'); // Base wing body
        poly([[-18, 20], [-68, 53], [-65, 58], [-18, 56]], '#2a2e38'); // Infill plate
        poly([[-16, 10], [-72, 55], [-73, 58], [-68, 58], [-48, 45], [-16, 25]], p, 0.6); // Glowing wing deck
        line([[-16, 10], [-72, 55]], p, 1.25); // Wing leading edge glow line
        poly([[-74, 52], [-74, 65], [-71, 62], [-71, 54]], '#ffffff'); // Vertical white wingtip border plate
        line([[-30, 20], [-30, 58]], 'rgba(255, 255, 255, 0.12)', 0.8); // Panel lines
        line([[-50, 35], [-50, 58]], 'rgba(255, 255, 255, 0.12)', 0.8);
        poly([[-74, 62], [-16, 60], [-16, 61.5], [-74, 63.5]], '#ffffff'); // White back margin line
        poly([[-16, 10], [-72, 55], [-73, 53], [-16, 8]], '#ffffff'); // White leading edge trim

        // Right Wing
        poly([[16, 10], [72, 55], [74, 62], [16, 60]], '#15171c');
        poly([[18, 20], [68, 53], [65, 58], [18, 56]], '#2a2e38');
        poly([[16, 10], [72, 55], [73, 58], [68, 58], [48, 45], [16, 25]], p, 0.6);
        line([[16, 10], [72, 55]], p, 1.25);
        poly([[74, 52], [74, 65], [71, 62], [71, 54]], '#ffffff');
        line([[30, 20], [30, 58]], 'rgba(255, 255, 255, 0.12)', 0.8);
        line([[50, 35], [50, 58]], 'rgba(255, 255, 255, 0.12)', 0.8);
        poly([[74, 62], [16, 60], [16, 61.5], [74, 63.5]], '#ffffff');
        poly([[16, 10], [72, 55], [73, 53], [16, 8]], '#ffffff');

        // Symmetrical Hydraulic Actuator Pistons (Engine Flank to Main Wing root)
        line([[-16, 40], [-26, 42]], 'rgba(255, 255, 255, 0.45)', 1.5);
        circ(-16, 40, 1.2, '#8b939c');
        circ(-26, 42, 1.2, '#8b939c');
        line([[16, 40], [26, 42]], 'rgba(255, 255, 255, 0.45)', 1.5);
        circ(16, 40, 1.2, '#8b939c');
        circ(26, 42, 1.2, '#8b939c');

        // 5. Spiked Back (Symmetrical four sharp vertical spikes pointing straight down)
        // Left Inner Spike
        poly([[-8, 60], [-12, 97], [-9, 97], [-6, 60]], '#2a2e38');
        poly([[-12, 90], [-12, 97], [-9, 97], [-9, 90]], '#ffffff'); // White tip plate
        line([[-8, 60], [-12, 97]], p, 1);

        // Right Inner Spike
        poly([[8, 60], [12, 97], [9, 97], [6, 60]], '#2a2e38');
        poly([[12, 90], [12, 97], [9, 97], [9, 90]], '#ffffff');
        line([[8, 60], [12, 97]], p, 1);

        // Left Outer Spike
        poly([[-26, 60], [-30, 92], [-26, 92], [-22, 60]], '#2a2e38');
        poly([[-30, 85], [-30, 92], [-26, 92], [-26, 85]], '#ffffff'); // White tip plate
        line([[-26, 60], [-30, 92]], p, 1);

        // Right Outer Spike
        poly([[26, 60], [30, 92], [26, 92], [22, 60]], '#2a2e38');
        poly([[30, 85], [30, 92], [26, 92], [26, 85]], '#ffffff');
        line([[26, 60], [30, 92]], p, 1);

        // Symmetrical engine exhaust ports
        circ(-13, 72, 2.2, p, 0.85);
        circ(13, 72, 2.2, p, 0.85);

        // 6. Central Engine Nozzle & Core Spike (Slimmer)
        poly([[-4, 75], [4, 75], [0, 108]], '#13151a'); // Engine tail cone casing
        line([[0, 75], [0, 105]], p, 1.5); // Glowing center spike

        // 7. General Detailing
        circ(0, 30, 2.0, p, 0.7); // Glowing reactor node

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
        ctx.shadowBlur = 0;
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
        ctx.shadowBlur = 0;
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

        // Neon accents use the player's chosen color so the stealth hull
        // picks up visible color along its edges, tips and exhausts.
        const accent = p;
        const time = performance.now() / 1000;
        const pulse = 0.55 + Math.sin(time * 5) * 0.35;   // slow energy throb

        ctx.save();
        ctx.shadowBlur = 0;
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
        // Nose cone energy tips + accent spines
        circ(-11, -90, 1.8, accent, pulse);
        circ(11, -90, 1.8, accent, pulse);
        line([[-11, -84], [-11, 28]], accent, 0.6);
        line([[11, -84], [11, 28]], accent, 0.6);

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
        const accentRGB = parseColorToRGBA(accent);
        let canopyGrad = ctx.createLinearGradient(-3, -14, 3, 8);
        canopyGrad.addColorStop(0, '#0c1822');
        canopyGrad.addColorStop(0.4, shadeColor(accentRGB, -0.25));
        canopyGrad.addColorStop(0.7, shadeColor(accentRGB, 0.2));
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
        line([[-17, -24], [-72, -10]], accent, 1.2);   // accent leading edge
        circ(-86, -15, 1.7, accent, pulse);            // wingtip hook beacon

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
        line([[17, -24], [72, -10]], accent, 1.2);    // accent leading edge
        circ(86, -15, 1.7, accent, pulse);            // wingtip hook beacon

        // 5. Stabilizers (rear diagonal winglets pointing outward/back)
        // Left Stabilizer
        poly([[-17, 15], [-35, 38], [-30, 42], [-17, 30]], hull);
        poly([[-28, 30], [-35, 38], [-30, 42], [-25, 38]], dark); // Dark tip
        circ(-35, 38, 1.5, accent, pulse);            // stabilizer tip beacon
        // Right Stabilizer
        poly([[17, 15], [35, 38], [30, 42], [17, 30]], hull);
        poly([[28, 30], [35, 38], [30, 42], [25, 38]], dark);
        circ(35, 38, 1.5, accent, pulse);             // stabilizer tip beacon

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

        // 6b. Tail column exhaust glow + flickering plumes
        const flick = 0.8 + Math.sin(time * 40) * 0.2;
        function tailFlame(x) {
            const len = 14 * flick;
            const fg = ctx.createLinearGradient(x, 110, x, 110 + len);
            fg.addColorStop(0, '#ffffff');
            fg.addColorStop(0.4, accent);
            fg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = fg;
            ctx.beginPath();
            ctx.moveTo(x - 2, 110);
            ctx.lineTo(x + 2, 110);
            ctx.lineTo(x + 0.8, 110 + len);
            ctx.lineTo(x - 0.8, 110 + len);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        tailFlame(-12);
        tailFlame(12);
        circ(-12, 112, 2.4, accent, 0.75);
        circ(12, 112, 2.4, accent, 0.75);

        // 7. Mechanical Detailing & Panel Lines
        line([[0, -45], [0, -18]], panel, 0.8);
        line([[0, 12], [0, 28]], panel, 0.8);
        poly([[-4, 26], [4, 26], [2, 38], [-2, 38]], dark); // Engine nozzle casing
        line([[-3, -40], [3, -40]], accent, 1.0);   // accent fuselage line
        circ(0, 38, 1.8, accent, pulse);            // engine nozzle glow

        ctx.restore();

    } else if (shape === 'titan') {
        // --- TITAN: vertical transform fighter ---
        const hull = p;
        const dark = '#05070a';
        const metal = '#161b22';
        const panel = '#2d3640';

        ctx.save();
        ctx.shadowBlur = 0;
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
        const panel = 'rgba(128, 128, 128, 0.45)'; // Semi-transparent grey highlights
        const glass = '#0f0a05'; // Dark copper-tinted cockpit backing

        ctx.save();
        ctx.shadowBlur = 0;
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
        line([[0, 100], [-30, 120]], 'rgba(128,128,128,0.7)', 1.2);
        line([[0, 100], [-15, 130]], 'rgba(128,128,128,0.7)', 1.2);
        line([[0, 100], [0, 140]], 'rgba(128,128,128,0.7)', 1.2);
        line([[0, 100], [15, 130]], 'rgba(128,128,128,0.7)', 1.2);
        line([[0, 100], [30, 120]], 'rgba(128,128,128,0.7)', 1.2);

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
            ctx.strokeStyle = 'rgba(128, 128, 128, 0.6)';
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
        // Wings enlarged ~1.35x by scaling every rib tip outward from the
        // wing root at (+/-28, -25), keeping the feathers attached to the body.
        // Left Glider Wing
        // Rib 1 (Leading Edge)
        poly([[-28, -25], [-139, -25], [-118, 2]], p);
        // Rib 2
        poly([[-28, -25], [-118, 2], [-91, 22]], p, 0.85);
        // Rib 3
        poly([[-28, -25], [-91, 22], [-64, 36]], p, 0.7);
        // Rib 4
        poly([[-28, -25], [-64, 36], [-37, 43]], p, 0.55);

        // Left Wing Highlight Rib Lines
        line([[-28, -25], [-139, -25]], 'rgba(128,128,128,0.85)', 1.5);
        line([[-28, -25], [-118, 2]], 'rgba(128,128,128,0.7)', 1.2);
        line([[-28, -25], [-91, 22]], 'rgba(128,128,128,0.7)', 1.2);
        line([[-28, -25], [-64, 36]], 'rgba(128,128,128,0.7)', 1.2);
        line([[-28, -25], [-37, 43]], 'rgba(128,128,128,0.7)', 1.2);

        // Right Glider Wing (Mirror)
        // Rib 1 (Leading Edge)
        poly([[28, -25], [139, -25], [118, 2]], p);
        // Rib 2
        poly([[28, -25], [118, 2], [91, 22]], p, 0.85);
        // Rib 3
        poly([[28, -25], [91, 22], [64, 36]], p, 0.7);
        // Rib 4
        poly([[28, -25], [64, 36], [37, 43]], p, 0.55);

        // Right Wing Highlight Rib Lines
        line([[28, -25], [139, -25]], 'rgba(128,128,128,0.85)', 1.5);
        line([[28, -25], [118, 2]], 'rgba(128,128,128,0.7)', 1.2);
        line([[28, -25], [91, 22]], 'rgba(128,128,128,0.7)', 1.2);
        line([[28, -25], [64, 36]], 'rgba(128,128,128,0.7)', 1.2);
        line([[28, -25], [37, 43]], 'rgba(128,128,128,0.7)', 1.2);

        ctx.restore();
    } else if (shape === '4-wing') {
        // --- 4-WING: Heavy Fighter with X-wing Configuration (Reference Image Match) ---
        const hull = p;
        const dark = '#15171c'; // Deep charcoal/black
        const metal = '#5a626a'; // Medium metallic grey
        const lightMetal = '#8b939c'; // Light gray accents
        const glass = '#0d1117'; // Cockpit backing glass
        const panel = 'rgba(255, 255, 255, 0.35)';

        ctx.save();
        ctx.shadowBlur = 0;
        ctx.shadowColor = p;

        // LEFT UPPER WING (Straight out wing with vertical tip blades, thickened, primary color, made longer)
        poly([[-26, -33], [-102, -37], [-102, -51], [-26, -55]], p);
        poly([[-102, -37], [-107, -37], [-107, -100], [-102, -100]], p); // Upper blade fin (pointing up)
        poly([[-102, -51], [-107, -51], [-107, -15], [-102, -15]], p); // Lower blade fin (pointing down)
        poly([[-103, -90], [-106, -90], [-106, -30], [-103, -30]], metal); // Wingtip metal plate
        line([[-26, -44], [-102, -44]], p, 1.8); // Glowing wing edge
        poly([[-35, -48], [-92, -48], [-92, -40], [-35, -40]], 'rgba(255, 255, 255, 0.25)'); // Panel highlight

        // RIGHT UPPER WING (Straight out wing with vertical tip blades, thickened, primary color, made longer)
        poly([[26, -33], [102, -37], [102, -51], [26, -55]], p);
        poly([[102, -37], [107, -37], [107, -100], [102, -100]], p);
        poly([[102, -51], [107, -51], [107, -15], [102, -15]], p);
        poly([[103, -90], [106, -90], [106, -30], [103, -30]], metal);
        line([[26, -44], [102, -44]], p, 1.8);
        poly([[35, -48], [92, -48], [92, -40], [35, -40]], 'rgba(255, 255, 255, 0.25)');

        // LEFT LOWER WING (Swept down wing with pointed hook, thickened, primary color, made longer)
        poly([[-20, -15], [-92, 20], [-92, 52], [-20, 15]], p);
        poly([[-92, 20], [-97, 20], [-101, 95], [-96, 98], [-92, 52]], p); // Lower wingtip hook
        poly([[-93, 25], [-96, 25], [-99, 85], [-96, 87], [-93, 49]], metal); // Hook inner panel
        line([[-22, 0], [-90, 36]], p, 1.8); // Glowing wing edge
        poly([[-30, 0], [-82, 22], [-82, 42], [-30, 10]], 'rgba(255, 255, 255, 0.25)'); // Panel highlight

        // RIGHT LOWER WING (Swept down wing with pointed hook, thickened, primary color, made longer)
        poly([[20, -15], [92, 20], [92, 52], [20, 15]], p);
        poly([[92, 20], [97, 20], [101, 95], [96, 98], [92, 52]], p);
        poly([[93, 25], [96, 25], [99, 85], [96, 87], [93, 49]], metal);
        line([[22, 0], [90, 36]], p, 1.8);
        poly([[30, 0], [82, 22], [82, 42], [30, 10]], 'rgba(255, 255, 255, 0.25)');

        // 2. Massive Engine Pods / Shoulders (Dark cylinders with horizontal seams)
        // Left Pod
        poly([[-26, -42], [-14, -42], [-10, 20], [-26, 20]], '#22252c');
        poly([[-26, -42], [-20, -42], [-18, 15], [-24, 15]], metal); // Outer grey accent plating
        line([[-26, -30], [-14, -30]], '#121418', 2);
        line([[-26, -10], [-12, -10]], '#121418', 2);
        line([[-26, 10], [-10, 10]], '#121418', 2);

        // Right Pod
        poly([[14, -42], [26, -42], [26, 20], [10, 20]], '#22252c');
        poly([[20, -42], [26, -42], [24, 15], [18, 15]], metal);
        line([[14, -30], [26, -30]], '#121418', 2);
        line([[12, -10], [26, -10]], '#121418', 2);
        line([[10, 10], [26, 10]], '#121418', 2);

        // Symmetrical hydraulic actuator pistons linking engine pod to wings (moved forward)
        line([[-26, -20], [-45, -23]], metal, 2.5);
        line([[26, -20], [45, -23]], metal, 2.5);
        circ(-26, -20, 2.2, p);
        circ(26, -20, 2.2, p);

        // 3. Circular Energy Intakes/Glow Rings (Positioned at lower wing roots, moved forward)
        // Left Energy Ring
        circ(-20, -7, 9, p, 0.45);
        circ(-20, -7, 6, '#000000');
        circ(-20, -7, 4, p, 0.9);

        // Right Energy Ring
        circ(20, -7, 9, p, 0.45);
        circ(20, -7, 6, '#000000');
        circ(20, -7, 4, p, 0.9);

        // Symmetrical grey crescent safety braces over the energy rings (moved forward)
        ctx.save();
        ctx.strokeStyle = lightMetal;
        ctx.lineWidth = 1.8 / sc;
        ctx.beginPath();
        ctx.arc(-20, -7, 13.5, -Math.PI, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(20, -7, 13.5, -Math.PI, 0);
        ctx.stroke();
        ctx.restore();

        // 4. Center Fuselage Wishbone (Grey Wishbone overlay that splits at the bottom)
        poly([[0, -50], [-9, -48], [-9, 15], [0, 22], [9, 15], [9, -48]], metal);
        poly([[0, -50], [-4, -48], [-4, 15], [0, 20]], lightMetal, 0.5);

        // Symmetrical glowing neon seams running along the wishbone legs
        line([[-9, -48], [-9, 15], [-22, 70]], p, 1.2);
        line([[9, -48], [9, 15], [22, 70]], p, 1.2);

        // Wishbone diagonal legs extending outwards/downwards
        poly([[-9, 10], [-22, 70], [-16, 72], [-5, 20]], metal);
        poly([[9, 10], [22, 70], [16, 72], [5, 20]], metal);

        // 5. Dynamic Center Strip & Cockpit
        poly([[-4, -30], [4, -30], [5, 10], [-5, 10]], p);
        line([[0, -30], [0, 10]], 'rgba(255, 255, 255, 0.5)', 1.2);

        poly([[-5, -45], [5, -45], [7, -32], [-7, -32]], glass);
        line([[-4, -40], [4, -40]], p, 1.2);

        // Nose Cone Tip Highlight
        poly([[0, -50], [-9, -48], [9, -48]], lightMetal);

        // 6. Structural Tail Spurs & Fine Detailing (Shifted to sides of engine body, straight slanted outward)
        // Symmetrical Inner Spurs
        poly([[-24, 20], [-20, 20], [-36, 110], [-40, 110]], p);
        poly([[20, 20], [24, 20], [40, 110], [36, 110]], p);

        // Symmetrical Outer Spurs
        poly([[-36, 20], [-32, 20], [-50, 112], [-54, 112]], dark);
        poly([[32, 20], [36, 20], [54, 112], [50, 112]], dark);

        ctx.restore();
    } else if (shape === 'falcon') {
        // --- FALCON: Symmetrical Mechanical Bird (Reference Image Match - Extended Wing) ---
        const dark = '#1a1d24'; // Deep charcoal/black
        const metal = '#5a626a'; // Medium metallic grey
        const lightMetal = '#8b939c'; // Light gray accents

        ctx.save();
        ctx.shadowBlur = 0;
        ctx.shadowColor = p;

        // 1. Central Mechanical Torso/Fuselage & Neck Collar (Widened for a bulkier look)
        poly([[-12, -35], [12, -35], [18, -15], [18, 5], [12, 25], [-12, 25], [-18, 5], [-18, -15]], '#13151a'); // Dark torso frame

        // Symmetrical shoulder shroud panels
        poly([[-12, -35], [-18, -30], [-18, -10], [-10, -10]], '#3a3f47');
        poly([[12, -35], [18, -30], [18, -10], [10, -10]], '#3a3f47');

        // Symmetrical flank panel overlays (gray metal)
        poly([[-18, -15], [-10, -15], [-8, 15], [-12, 25], [-16, 10]], metal);
        poly([[18, -15], [10, -15], [8, 15], [12, 25], [16, 10]], metal);

        // Raised Central Keel (cyber center deck)
        poly([[-6, -30], [6, -30], [7, 15], [-7, 15]], '#22252c');
        poly([[-3, -30], [3, -30], [4, 10], [-4, 10]], p, 0.45);
        line([[0, -30], [0, 15]], p, 1.5);

        // Transverse mechanical slots (glowing neon lines)
        line([[-6, -10], [6, -10]], p, 1);
        line([[-5, 5], [5, 5]], p, 1);

        // Neck Collar brace
        poly([[-8, -42], [8, -42], [10, -35], [-10, -35]], metal);
        line([[-7, -38], [7, -38]], 'rgba(255,255,255,0.4)', 0.8);

        // Head and Beak/Nose (Faceted mechanical bird head)
        poly([[-11, -50], [11, -50], [13, -35], [-13, -35]], '#22252c'); // Skull base
        poly([[-13, -35], [-7, -35], [-5, -48], [-11, -48]], metal); // Left crown plate
        poly([[7, -35], [13, -35], [11, -48], [5, -48]], metal); // Right crown plate
        poly([[-7, -35], [7, -35], [5, -48], [-5, -48]], '#3a3f47'); // Center head crest

        // Symmetrical glowing neon eyes matching player signature color
        poly([[-10, -48], [-5, -48], [-6, -40], [-11, -40]], p, 0.85); // Left eye
        poly([[5, -48], [10, -48], [11, -40], [6, -40]], p, 0.85); // Right eye

        // Beak Tip
        poly([[0, -68], [-7, -50], [7, -50]], p); // Beak tip in player color
        line([[0, -68], [0, -50]], 'rgba(255, 255, 255, 0.5)', 1.2);

        // 2. Parallel Truss Tail Boom & Forked Stabilizer (Widened, longer tail)
        // Draw the two parallel structural columns of the tail boom (flared outwards near the body)
        poly([[-11, 25], [-7, 25], [-2, 132], [-5, 132]], metal);
        poly([[7, 25], [11, 25], [5, 132], [2, 132]], metal);

        // Symmetrical neon highlights on the tail boom lines
        line([[-9, 25], [-3.5, 132]], p, 1.2);
        line([[9, 25], [3.5, 132]], p, 1.2);

        // Cross-member structural links (truss layout adjusted for flared width)
        poly([[-9, 43], [9, 43], [9, 46], [-9, 46]], metal);
        poly([[-7, 68], [7, 68], [7, 71], [-7, 71]], metal);
        poly([[-5, 93], [5, 93], [5, 96], [-5, 96]], metal);
        poly([[-4, 118], [4, 118], [4, 121], [-4, 121]], metal);

        // Forked tail stabilizers (Symmetrical outer points + short center needle, detailed layering)
        // Left Fin
        poly([[-3, 132], [-20, 159], [-12, 159], [-1, 132]], '#181a20'); // Dark base
        poly([[-2.5, 134], [-17, 156], [-11, 156], [-1.2, 134]], metal); // Grey inner panel
        line([[-3, 132], [-20, 159]], p, 1.2); // Glowing edge

        // Right Fin
        poly([[3, 132], [20, 159], [12, 159], [1, 132]], '#181a20');
        poly([[2.5, 134], [17, 156], [11, 156], [1.2, 134]], metal);
        line([[3, 132], [20, 159]], p, 1.2);

        // Center needle stabilizer
        poly([[0, 132], [-4, 144], [4, 144]], metal); // Central base
        line([[0, 132], [0, 150]], p, 1.2); // Glowing center spike

        // Joint hinge plates
        circ(-3, 132, 2.2, p);
        circ(3, 132, 2.2, p);

        // 3. Symmetrical Mechanical Wings (High Fidelity - Symmetrical Mechanical Bird Matching Reference Image - Premium Animated Variant)
        function drawMechanicalWing(side) {
            ctx.save();
            ctx.shadowBlur = 0; // Performance optimization

            const ledAlpha = 0.55 + Math.sin(performance.now() / 150) * 0.25;

            // Define premium linear gradients for metal textures
            const innerMetalGrad = ctx.createLinearGradient(side * 18, -25, side * 48, -37);
            innerMetalGrad.addColorStop(0, '#5a626a');
            innerMetalGrad.addColorStop(0.4, '#8b939c');
            innerMetalGrad.addColorStop(0.7, '#4a5058');
            innerMetalGrad.addColorStop(1, '#2d3139');

            const outerMetalGrad = ctx.createLinearGradient(side * 48, -37, side * 128, -66);
            outerMetalGrad.addColorStop(0, '#3a3f47');
            outerMetalGrad.addColorStop(0.3, '#8b939c');
            outerMetalGrad.addColorStop(0.6, '#5a626a');
            outerMetalGrad.addColorStop(1, '#1e2127');

            // --- Joint and Structural Anchors ---
            // Shoulder attachment: side * 18, -15 (on the side of the torso)
            // Elbow joint: side * 48, -32 (higher, sweeping up-out)
            // Outer wing tip: side * 125, -60 (the furthest, highest point of the structural spar)

            // A. Symmetrical Inner Wing Shroud Panel & Rivet Grid (Torso attachment shroud)
            poly([[side * 18, -15], [side * 28, -8], [side * 25, 12], [side * 14, 5]], '#1a1d24');
            poly([[side * 19, -12], [side * 26, -7], [side * 24, 8], [side * 16, 3]], innerMetalGrad);
            // Pulsing status LED ports
            circ(side * 18, 0, 1.4, p, ledAlpha);
            circ(side * 21, 2, 1.4, p, ledAlpha);
            circ(side * 18, 4, 1.4, p, ledAlpha);
            circ(side * 21, 6, 1.4, p, ledAlpha);

            // B. Hydraulic Piston Cylinder and Rod under the inner spar
            // Dark outer cylinder (Thicker for bulkier look)
            line([[side * 20, -10], [side * 36, -18]], '#1a1d24', 9.5);
            // Silver inner piston rod
            line([[side * 34, -17], [side * 44, -22]], '#c0c5ce', 6.0);
            // Piston mount highlights (pulsing)
            line([[side * 20, -10], [side * 36, -18]], p, 1.8 * ledAlpha);
            circ(side * 20, -10, 5.0, metal);
            circ(side * 44, -22, 3.8, metal);

            // C. Inner Spar (Shoulder to Elbow)
            // Main dark carbon frame (Widened vertically for bulkier look)
            poly([[side * 18, -28], [side * 48, -41], [side * 45, -11], [side * 18, -2]], '#1a1d24');
            // Metallic insert plates (With gradient)
            poly([[side * 22, -24], [side * 46, -37], [side * 44, -13], [side * 22, -5]], innerMetalGrad);
            // Light metal highlight stripe
            line([[side * 24, -18], [side * 44, -25]], lightMetal, 3.2);
            // Triangular mechanical weight-reduction cutout
            poly([[side * 30, -19], [side * 36, -22], [side * 34, -15]], '#13151a');

            // D. Secondary Linkage Bar Overlay
            line([[side * 22, -13], [side * 45, -28]], '#3a3f47', 8.5);
            line([[side * 22, -13], [side * 45, -28]], innerMetalGrad, 4.2);
            circ(side * 22, -13, 6.5, '#1a1d24');
            circ(side * 22, -13, 3.5, p, ledAlpha);
            circ(side * 45, -28, 6.5, '#1a1d24');
            circ(side * 45, -28, 3.5, p, ledAlpha);

            // E. Elbow Joint & Triangular Bracket (Connecting inner and outer wing spars)
            // Triangular link plate (dark charcoal steel - Enlarged for bulkiness)
            poly([[side * 40, -42], [side * 55, -34], [side * 43, -9]], '#2d3139');
            // Rivets/Pivot Bolts (Enlarged bolts with glowing center pins)
            circ(side * 40, -42, 5.5, metal);
            circ(side * 40, -42, 3.0, p, ledAlpha);
            circ(side * 55, -34, 5.5, metal);
            circ(side * 55, -34, 3.0, p, ledAlpha);
            circ(side * 43, -9, 5.5, metal);
            circ(side * 43, -9, 3.0, p, ledAlpha);

            // F. Outer Spar (Elbow to Tip)
            // Main tapered dark carbon frame (Widened vertically)
            poly([[side * 48, -41], [side * 128, -70], [side * 123, -34], [side * 45, -8]], '#1a1d24');
            // Metallic insert plates (With gradient)
            poly([[side * 52, -37], [side * 123, -65], [side * 119, -38], [side * 50, -12]], outerMetalGrad);
            // Glowing energy seam running along the spar center (Thicker glow)
            line([[side * 54, -25], [side * 120, -51]], p, 3.2 * ledAlpha);
            // Light metal leading edge plate
            line([[side * 50, -35], [side * 126, -64]], lightMetal, 4.0);
            // Symmetrical weight-reduction slots in the outer spar (Enlarged)
            poly([[side * 64, -30], [side * 74, -33], [side * 72, -27], [side * 63, -24]], '#1a1d24');
            poly([[side * 84, -37], [side * 94, -40], [side * 92, -34], [side * 83, -31]], '#1a1d24');
            poly([[side * 102, -44], [side * 110, -47], [side * 108, -41], [side * 101, -38]], '#1a1d24');

            // G. Outer Spar Linkage Overlay Bar (as seen in outer wing part of image)
            line([[side * 48, -37], [side * 80, -50]], '#3a3f47', 7.0);
            line([[side * 48, -37], [side * 80, -50]], outerMetalGrad, 3.5);
            circ(side * 80, -50, 5.5, '#1a1d24');
            circ(side * 80, -50, 3.0, p, ledAlpha);

            // H. Secondary Mounting Rail Parallel to Outer Spar
            line([[side * 42, -22], [side * 115, -46]], '#1a1d24', 7.5);
            line([[side * 42, -22], [side * 115, -46]], outerMetalGrad, 3.8);

            // I. Overlapping Mechanical Feathers & Connecting Strut Web (With animated wave pulse)
            const numFeathers = 9;
            for (let i = 0; i < numFeathers; i++) {
                const t = i / (numFeathers - 1);

                // Spar point
                const sparX = side * (48 * (1 - t) + 128 * t);
                const sparY = -37 * (1 - t) - 66 * t;

                // Base along the secondary mounting rail
                const bx = side * (42 * (1 - t) + 115 * t);
                const by = -22 * (1 - t) - 46 * t;

                // --- Strut Web / Truss Structure between Main Spar and Secondary Rail ---
                // Vertical strut
                line([[sparX, sparY], [bx, by]], metal, 4.0);
                line([[sparX, sparY], [sparX + (bx - sparX) * 0.5, sparY + (by - sparY) * 0.5]], p, 1.8 * ledAlpha);
                // Diagonal strut
                if (i < numFeathers - 1) {
                    const nextT = (i + 1) / (numFeathers - 1);
                    const nextRailX = side * (42 * (1 - nextT) + 115 * nextT);
                    const nextRailY = -22 * (1 - nextT) - 46 * nextT;
                    line([[sparX, sparY], [nextRailX, nextRailY]], '#1a1d24', 3.0);
                    line([[sparX, sparY], [nextRailX, nextRailY]], lightMetal, 1.5);
                }

                // Feather socket with glow insert
                circ(bx, by, 5.2, '#1a1d24');
                circ(bx, by, 2.8, metal);
                circ(bx, by, 1.5, p, ledAlpha);

                // Feather length (increases from innermost to outermost - Enlarged for bulkier wing span)
                const len = 46 + t * 50;

                // Feather angles for the left wing (side === -1), ranging from pointing down-left to up-left
                const startAngle = 1.95;
                const endAngle = 3.25;
                const A = startAngle + t * (endAngle - startAngle);
                const angle = side === -1 ? A : Math.PI - A;

                // Calculate tip coordinates
                const tx = bx + len * Math.cos(angle);
                const ty = by + len * Math.sin(angle);

                // Feather direction vector and normalized vector
                const dx = tx - bx;
                const dy = ty - by;
                const ux = dx / len;
                const uy = dy / len;

                // Perpendicular vector pointing inwards/upwards (towards next feather to overlap correctly)
                const px = -uy * side;
                const py = ux * side;

                // Base width and tip width for the feather blade
                const wBase = 18.5;
                const wTip = 11.0;

                // --- 1. Outer Dark Blade Casing (Angled and tapered at the tip) ---
                const p1 = [bx, by];
                const p2 = [tx, ty];
                const p3 = [bx + dx * 0.92 + px * wTip, by + dy * 0.92 + py * wTip];
                const p4 = [bx + px * wBase, by + py * wBase];
                poly([p1, p2, p3, p4], '#1a1d24', 0.98);

                // --- 2. Inner Glowing Accent Panel (Player neon color - Animated flow wave) ---
                const inset = 2.5;
                const ip1 = [bx + dx * 0.12 + px * inset, by + dy * 0.12 + py * inset];
                const ip2 = [bx + dx * 0.88 + px * inset, by + dy * 0.88 + py * inset];
                const ip3 = [bx + dx * 0.82 + px * (wTip - inset), by + dy * 0.82 + py * (wTip - inset)];
                const ip4 = [bx + dx * 0.12 + px * (wBase - inset), by + dy * 0.12 + py * (wBase - inset)];

                // Animated energy flow wave running down the wing feathers sequentially
                const wavePhase = performance.now() / 220 - i * 0.45;
                const featherPulse = 0.74 + Math.sin(wavePhase) * 0.18;

                poly([ip1, ip2, ip3, ip4], p, featherPulse * 0.92);

                // --- 3. Spine Highlight Line (White-hot core line) ---
                line([[bx + dx * 0.15, by + dy * 0.15], [bx + dx * 0.80, by + dy * 0.80]], 'rgba(255, 255, 255, 0.48)', 1.2 * featherPulse);
            }

            ctx.restore();
        }

        drawMechanicalWing(-1); // Left Wing
        drawMechanicalWing(1);  // Right Wing

        ctx.restore();
    } else if (shape === 'phantom') {
        // --- PHANTOM: Sleek Mecha Fighter (Redesigned to match reference blueprint) ---
        const hull = p;
        const dark = '#0b0e14';
        const metal = '#1c222c';
        const lightMetal = '#4a5568';
        const glass = '#060a12';
        const panel = 'rgba(255, 255, 255, 0.35)';

        // Neon detailing is painted entirely in the player's chosen color,
        // so every glow, beacon and energy line matches the ship exactly.
        const accent = p;
        const time = performance.now() / 1000;
        const pulse = 0.6 + Math.sin(time * 5) * 0.35;   // slow energy throb
        const flick = 0.8 + Math.sin(time * 40) * 0.2;   // engine flicker

        ctx.save();
        ctx.shadowBlur = 0;
        ctx.shadowColor = p;

        // 0. Soft energy aura behind the hull (accent-tinted under-glow)
        ctx.save();
        ctx.globalAlpha = 0.16;
        const auraGrad = ctx.createRadialGradient(0, 4, 4, 0, 4, 130);
        auraGrad.addColorStop(0, accent);
        auraGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(0, 4, 130, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 0b. Animated two-tone exhaust flames behind the engine nacelles
        function exhaustFlame(ex, w) {
            const len = 30 * (flick + Math.sin(time * 55 + ex) * 0.06);
            const fg = ctx.createLinearGradient(ex, 68, ex, 68 + len);
            fg.addColorStop(0, '#ffffff');
            fg.addColorStop(0.3, p);
            fg.addColorStop(0.75, accent);
            fg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.shadowColor = accent;
            ctx.shadowBlur = 9;
            ctx.fillStyle = fg;
            ctx.beginPath();
            ctx.moveTo(ex - w, 68);
            ctx.lineTo(ex + w, 68);
            ctx.lineTo(ex + w * 0.35, 68 + len);
            ctx.lineTo(ex - w * 0.35, 68 + len);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        exhaustFlame(-27, 4.5);
        exhaustFlame(27, 4.5);

        // 1. Primary Upper Wings (Swept blade pair + steeper outer tip blades)
        // Left Upper Wing
        poly([[-18, -22], [-135, 11], [-128, 32], [-18, 36]], hull);
        poly([[-18, -15], [-129, 13], [-123, 30], [-18, 30]], dark);
        line([[-18, -22], [-135, 11]], p, 2.2);
        line([[-135, 11], [-128, 32]], accent, 1.8);      // accent tip edge
        line([[-20, 0], [-131, 9]], accent, 0.8);         // energy sweep line
        line([[-126, 13], [-135, 11]], '#ffffff', 1.5);
        circ(-135, 11, 2.3, accent, pulse);               // glowing wingtip
        // Outer tip blade (sharp angle, layered wing tip)
        poly([[-100, 10], [-148, 34], [-144, 42], [-96, 16]], dark);
        poly([[-102, 11], [-142, 33], [-139, 38], [-98, 13]], hull, 0.7);
        line([[-100, 10], [-148, 34]], p, 1.6);
        line([[-148, 34], [-144, 42]], accent, 1.2);
        circ(-148, 34, 1.8, accent, pulse);               // outer blade beacon
        // Right Upper Wing
        poly([[18, -22], [135, 11], [128, 32], [18, 36]], hull);
        poly([[18, -15], [129, 13], [123, 30], [18, 30]], dark);
        line([[18, -22], [135, 11]], p, 2.2);
        line([[135, 11], [128, 32]], accent, 1.8);        // accent tip edge
        line([[20, 0], [131, 9]], accent, 0.8);           // energy sweep line
        line([[126, 13], [135, 11]], '#ffffff', 1.5);
        circ(135, 11, 2.3, accent, pulse);                // glowing wingtip
        // Outer tip blade (sharp angle, layered wing tip)
        poly([[100, 10], [148, 34], [144, 42], [96, 16]], dark);
        poly([[102, 11], [142, 33], [139, 38], [98, 13]], hull, 0.7);
        line([[100, 10], [148, 34]], p, 1.6);
        line([[148, 34], [144, 42]], accent, 1.2);
        circ(148, 34, 1.8, accent, pulse);                // outer blade beacon

        // 1a. Upper wing inner inlay glow edges (player color)
        line([[-18, -15], [-129, 13]], accent, 0.7);
        line([[18, -15], [129, 13]], accent, 0.7);

        // 1b. Upper wing mechanical detailing (panel seams, cutout slots, root plates)
        // Left wing seams
        line([[-30, -16], [-129, 13]], panel, 0.7);
        line([[-28, 6], [-123, 25]], panel, 0.6);
        poly([[-55, 0], [-63, 3], [-59, 8]], metal);      // weight cutout
        poly([[-88, 13], [-96, 16], [-92, 21]], metal);   // weight cutout
        poly([[-28, -20], [-36, -15], [-30, -9]], metal); // root reinforcement
        // Right wing seams
        line([[30, -16], [129, 13]], panel, 0.7);
        line([[28, 6], [123, 25]], panel, 0.6);
        poly([[55, 0], [63, 3], [59, 8]], metal);         // weight cutout
        poly([[88, 13], [96, 16], [92, 21]], metal);      // weight cutout
        poly([[28, -20], [36, -15], [30, -9]], metal);    // root reinforcement

        // 2. Secondary Middle Wings (Sharply swept second fin pair)
        // Left Middle Wing
        poly([[-20, 2], [-128, 62], [-118, 71], [-20, 44]], hull);
        poly([[-24, 8], [-120, 63], [-114, 69], [-24, 38]], metal);
        line([[-20, 22], [-122, 66]], panel, 1.0);
        line([[-18, 4], [-124, 58]], accent, 0.9);        // accent sweep
        circ(-128, 62, 1.9, accent, pulse);               // wingtip beacon
        // Right Middle Wing
        poly([[20, 2], [128, 62], [118, 71], [20, 44]], hull);
        poly([[24, 8], [120, 63], [114, 69], [24, 38]], metal);
        line([[20, 22], [122, 66]], panel, 1.0);
        line([[18, 4], [124, 58]], accent, 0.9);          // accent sweep
        circ(128, 62, 1.9, accent, pulse);                // wingtip beacon

        // 2a. Middle wing inlay edge glows (player color)
        line([[-24, 8], [-120, 63]], accent, 0.7);
        line([[24, 8], [120, 63]], accent, 0.7);
        line([[-22, 26], [-118, 69]], accent, 0.6);       // trailing inlay edge
        line([[22, 26], [118, 69]], accent, 0.6);

        // 2b. Missile hardpoints under the middle wings
        // Left hardpoint
        line([[-88, 50], [-88, 68]], metal, 2.0);         // pylon (hangs below wing)
        poly([[-92, 60], [-84, 60], [-86, 74], [-90, 74]], metal); // missile body
        line([[-92, 60], [-84, 60]], panel, 0.8);         // pylon cap
        circ(-88, 74, 1.5, accent, pulse);                // missile tip glow
        circ(-88, 74, 0.6, '#ffffff', 0.6);
        // Right hardpoint
        line([[88, 50], [88, 68]], metal, 2.0);           // pylon (hangs below wing)
        poly([[92, 60], [84, 60], [86, 74], [90, 74]], metal); // missile body
        line([[92, 60], [84, 60]], panel, 0.8);           // pylon cap
        circ(88, 74, 1.5, accent, pulse);                 // missile tip glow
        circ(88, 74, 0.6, '#ffffff', 0.6);

        // 2c. Missile body accent stripes (player color)
        line([[-90, 64], [-86, 64]], accent, 0.8);
        line([[90, 64], [86, 64]], accent, 0.8);
        line([[-90, 68], [-86, 68]], accent, 0.6);
        line([[90, 68], [86, 68]], accent, 0.6);

        // 3. Lower Winglets with Notched Teeth (Sharply angled serrated winglet pair)
        // Left Lower Winglet
        poly([[-20, 25], [-70, 67], [-64, 75], [-54, 69], [-48, 73], [-36, 65], [-20, 48]], dark);
        poly([[-22, 28], [-65, 65], [-61, 71], [-52, 66], [-46, 69], [-34, 62], [-22, 45]], hull, 0.75);
        line([[-20, 25], [-70, 67]], p, 1.8);
        circ(-70, 67, 1.9, accent, pulse);                // winglet tip beacon
        line([[-48, 73], [-36, 65]], accent, 0.9);        // accent notch edge
        // Right Lower Winglet
        poly([[20, 25], [70, 67], [64, 75], [54, 69], [48, 73], [36, 65], [20, 48]], dark);
        poly([[22, 28], [65, 65], [61, 71], [52, 66], [46, 69], [34, 62], [22, 45]], hull, 0.75);
        line([[20, 25], [70, 67]], p, 1.8);
        circ(70, 67, 1.9, accent, pulse);                 // winglet tip beacon
        line([[48, 73], [36, 65]], accent, 0.9);          // accent notch edge

        // 3b. Winglet teeth accent edges (player color)
        line([[-54, 69], [-48, 73]], accent, 0.8);
        line([[54, 69], [48, 73]], accent, 0.8);
        line([[-36, 65], [-20, 48]], accent, 0.6);
        line([[36, 65], [20, 48]], accent, 0.6);

        // 4. Dual Thruster Nacelles & Heavy Engine Casing
        // Left Engine Nacelle
        poly([[-34, 15], [-20, 15], [-18, 70], [-36, 70]], metal);
        poly([[-32, 20], [-22, 20], [-20, 65], [-34, 65]], dark);
        line([[-34, 15], [-20, 15]], accent, 1.2);        // accent top edge
        line([[-34, 30], [-20, 30]], lightMetal, 2.0);
        line([[-34, 42], [-20, 42]], accent, 1.8);        // accent rib
        line([[-34, 54], [-20, 54]], lightMetal, 2.0);
        line([[-34, 36], [-20, 36]], accent, 1.0);        // accent rib
        line([[-34, 48], [-20, 48]], accent, 1.0);        // accent rib
        circ(-27, 68, 4.5, p, 0.85);
        circ(-27, 68, 2.7, accent, 0.9);                 // accent exhaust core
        circ(-27, 68, 1.2, '#ffffff', 0.85);             // white-hot center
        // Right Engine Nacelle
        poly([[34, 15], [20, 15], [18, 70], [36, 70]], metal);
        poly([[32, 20], [22, 20], [20, 65], [34, 65]], dark);
        line([[34, 15], [20, 15]], accent, 1.2);         // accent top edge
        line([[34, 30], [20, 30]], lightMetal, 2.0);
        line([[34, 42], [20, 42]], accent, 1.8);         // accent rib
        line([[34, 54], [20, 54]], lightMetal, 2.0);
        line([[34, 36], [20, 36]], accent, 1.0);         // accent rib
        line([[34, 48], [20, 48]], accent, 1.0);         // accent rib
        circ(27, 68, 4.5, p, 0.85);
        circ(27, 68, 2.7, accent, 0.9);                  // accent exhaust core
        circ(27, 68, 1.2, '#ffffff', 0.85);              // white-hot center

        // 4b. Nacelle riveted side seams
        line([[-33, 22], [-33, 62]], panel, 0.7);        // left seam
        circ(-35, 22, 0.8, '#ffffff', 0.3);
        circ(-35, 34, 0.8, '#ffffff', 0.3);
        circ(-35, 46, 0.8, '#ffffff', 0.3);
        circ(-35, 58, 0.8, '#ffffff', 0.3);
        line([[33, 22], [33, 62]], panel, 0.7);          // right seam
        circ(35, 22, 0.8, '#ffffff', 0.3);
        circ(35, 34, 0.8, '#ffffff', 0.3);
        circ(35, 46, 0.8, '#ffffff', 0.3);
        circ(35, 58, 0.8, '#ffffff', 0.3);

        // 5. Split Tail Skirts / Rear Armor Skirts with V-Notch
        // Left Tail Skirt
        poly([[-18, 52], [-26, 96], [-20, 88], [-14, 96], [-8, 62]], hull);
        poly([[-16, 56], [-23, 90], [-20, 84], [-15, 90], [-10, 64]], dark);
        line([[-18, 52], [-26, 96]], p, 1.5);
        line([[-14, 96], [-8, 62]], p, 1.2);
        line([[-22, 72], [-18, 86]], accent, 1.0);       // accent skirt panel
        circ(-26, 96, 1.6, accent, pulse);               // tail tip beacon
        // Right Tail Skirt
        poly([[18, 52], [26, 96], [20, 88], [14, 96], [8, 62]], hull);
        poly([[16, 56], [23, 90], [20, 84], [15, 90], [10, 64]], dark);
        line([[18, 52], [26, 96]], p, 1.5);
        line([[14, 96], [8, 62]], p, 1.2);
        line([[22, 72], [18, 86]], accent, 1.0);        // accent skirt panel
        circ(26, 96, 1.6, accent, pulse);                // tail tip beacon

        // 5a. Tail skirt accent edge glows (player color)
        line([[-17, 60], [-23, 90]], accent, 0.8);
        line([[17, 60], [23, 90]], accent, 0.8);
        line([[-14, 96], [-20, 88]], accent, 0.7);       // V-notch inner edge
        line([[14, 96], [20, 88]], accent, 0.7);

        // 5b. Center dorsal tail fin filling the V-notch between skirts
        poly([[-6, 40], [6, 40], [8, 92], [0, 100], [-8, 92]], hull);
        poly([[-4, 44], [4, 44], [5, 88], [0, 94], [-5, 88]], dark);
        line([[0, 44], [0, 94]], accent, 1.0);           // glowing fin spine
        circ(0, 100, 1.8, accent, pulse);                // fin tip beacon
        circ(0, 100, 0.7, '#ffffff', 0.6);

        // 5c. Dorsal fin accent edge glows (player color)
        line([[-6, 44], [-8, 90]], accent, 0.7);
        line([[6, 44], [8, 90]], accent, 0.7);

        // 6. Central Fuselage Core, Flanking Blades & Long Faceted Nose Needle
        // Long Nose Cone Spike (elongated needle, faceted panels)
        poly([[0, -108], [9, -60], [13, -34], [0, -24], [-13, -34], [-9, -60]], hull);
        poly([[0, -104], [5, -58], [8, -34], [0, -27], [-8, -34], [-5, -58]], dark);
        line([[0, -106], [0, -30]], '#ffffff', 1.4);
        circ(0, -110, 2.2, accent, pulse);                // glowing nose tip
        line([[0, -104], [0, -34]], accent, 0.7);         // accent spine line

        // 6a. Nose facet paneling (angular seams) + accent edge lines
        line([[-9, -56], [9, -56]], panel, 0.6);
        line([[-11, -40], [11, -40]], panel, 0.6);
        line([[0, -104], [4, -70]], panel, 0.5);
        line([[0, -104], [-4, -70]], panel, 0.5);
        line([[2, -100], [9, -58], [13, -34]], accent, 0.8);
        line([[-2, -100], [-9, -58], [-13, -34]], accent, 0.8);

        // Flanking Inner Nose Blades
        poly([[-12, -65], [-20, -42], [-10, -40]], metal);
        line([[-12, -65], [-20, -42]], p, 1.2);
        line([[-12, -65], [-16, -52]], accent, 0.8);     // accent blade edge
        poly([[12, -65], [20, -42], [10, -40]], metal);
        line([[12, -65], [20, -42]], p, 1.2);
        line([[12, -65], [16, -52]], accent, 0.8);       // accent blade edge

        // Nose cannon barrels (twin guns flanking the nose spike)
        poly([[-14, -34], [-8, -34], [-9, -16], [-15, -16]], metal);
        line([[-14, -34], [-15, -16]], p, 1.0);           // gun barrel edge
        circ(-11.5, -16, 1.3, p, 0.9);                    // muzzle
        circ(-11.5, -16, 0.6, '#ffffff', 0.7);
        poly([[14, -34], [8, -34], [9, -16], [15, -16]], metal);
        line([[14, -34], [15, -16]], p, 1.0);             // gun barrel edge
        circ(11.5, -16, 1.3, p, 0.9);                     // muzzle
        circ(11.5, -16, 0.6, '#ffffff', 0.7);

        // Canopy Windshield
        poly([[0, -56], [7, -44], [7, -28], [0, -20], [-7, -28], [-7, -44]], glass);
        const accentRGB = parseColorToRGBA(accent);
        let canopyGrad = ctx.createLinearGradient(-6, -54, 6, -22);
        canopyGrad.addColorStop(0, '#0a1420');
        canopyGrad.addColorStop(0.35, shadeColor(accentRGB, -0.3));
        canopyGrad.addColorStop(0.7, shadeColor(accentRGB, 0.2));
        canopyGrad.addColorStop(1, '#080d16');
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, -54);
        ctx.bezierCurveTo(6, -44, 6, -28, 0, -22);
        ctx.bezierCurveTo(-6, -28, -6, -44, 0, -54);
        ctx.closePath();
        ctx.fillStyle = canopyGrad;
        ctx.fill();
        ctx.strokeStyle = p;
        ctx.lineWidth = 1.2 / sc;
        ctx.stroke();
        ctx.restore();
        line([[0, -54], [0, -22]], 'rgba(255, 255, 255, 0.45)', 0.8);
        line([[3, -50], [5.5, -36]], accent, 1.1);        // accent canopy sheen

        // Diamond Chest Deck Armor & Sensor Ports
        poly([[0, -18], [16, 2], [0, 22], [-16, 2]], metal);
        poly([[0, -14], [12, 2], [0, 18], [-12, 2]], dark);
        circ(0, -4, 3.6, accent, 0.3);                   // accent sensor halo
        circ(0, 10, 3.6, accent, 0.3);
        circ(0, -4, 2.5, p, 0.95);
        circ(0, 10, 2.5, p, 0.95);
        circ(0, -4, 1.0, '#ffffff');
        circ(0, 10, 1.0, '#ffffff');
        line([[-16, 2], [0, 22], [16, 2]], p, 1.5);
        line([[-8, 2], [0, 12], [8, 2]], accent, 1.0);   // accent deck line

        // 6b. Chest deck greebles (flanking rivets & vent slats)
        line([[-6, -10], [6, -10]], accent, 0.7);         // accent deck line
        circ(-6, -8, 0.8, '#ffffff', 0.35);
        circ(6, -8, 0.8, '#ffffff', 0.35);
        circ(-5, 14, 0.8, '#ffffff', 0.35);
        circ(5, 14, 0.8, '#ffffff', 0.35);
        line([[-12, 0], [-8, 0]], panel, 0.6);
        line([[8, 0], [12, 0]], panel, 0.6);

        ctx.restore();
    } else if (shape === 'gunship') {
        // --- GUNSHIP: Heavy Assault Strike Craft ---
        // Compact, muscular assault craft with a slitted armored skull snout,
        // a glowing teardrop canopy, armored pod shoulders with white identification
        // stripes, swept charcoal delta wings and dual plasma exhaust jets.
        //
        // Livery follows the shared roster scheme: the player's chosen color is the
        // body paint over deep charcoal panels, trimmed with white markings.
        const hull = p;
        const hullRGB = parseColorToRGBA(p);
        const hullLight = shadeColor(hullRGB, 0.45); // pale tint for the skull mask
        const hullShade = shadeColor(hullRGB, 0.2);
        const plate = '#2a2e38'; // secondary charcoal plate (cowl / canards)
        const darkMetal = '#111318';
        const midMetal = '#1c222d';
        const panel = 'rgba(255, 255, 255, 0.35)';
        const pAlpha = a => `rgba(${hullRGB.r | 0}, ${hullRGB.g | 0}, ${hullRGB.b | 0}, ${a})`;

        ctx.save();

        // 1. Dual High-Intensity Plasma Exhaust Jets
        for (const ex of [-23, 23]) {
            ctx.save();

            const flameGrad = ctx.createLinearGradient(ex, 30, ex, 82);
            flameGrad.addColorStop(0, '#ffffff');
            flameGrad.addColorStop(0.2, p);
            flameGrad.addColorStop(0.65, pAlpha(0.45));
            flameGrad.addColorStop(1, pAlpha(0));
            ctx.beginPath();
            ctx.moveTo(ex - 5.5, 30);
            ctx.lineTo(ex + 5.5, 30);
            ctx.lineTo(ex, 82);
            ctx.closePath();
            ctx.fillStyle = flameGrad;
            ctx.fill();

            // Inner hot white laser core
            ctx.beginPath();
            ctx.moveTo(ex - 2, 30);
            ctx.lineTo(ex + 2, 30);
            ctx.lineTo(ex, 60);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
        }

        // 2. Swept Charcoal Delta Wings (behind engine pods)
        for (const side of [-1, 1]) {
            // Main delta wing blade
            poly([
                [side * 24, -10],
                [side * 56, 12],
                [side * 52, 28],
                [side * 24, 22]
            ], darkMetal);

            poly([
                [side * 26, -6],
                [side * 52, 12],
                [side * 48, 24],
                [side * 26, 20]
            ], midMetal, 0.8);

            line([
                [side * 24, -10],
                [side * 56, 12]
            ], p, 1.8);

            line([
                [side * 56, 12],
                [side * 52, 28]
            ], '#ffffff', 1.2);

            // Wing panel rib
            line([
                [side * 36, 0],
                [side * 42, 20]
            ], panel, 0.8);
        }

        // 3. Central Rear Exhaust Shroud & Keel Vents
        poly([
            [-10, 16],
            [10, 16],
            [8, 38],
            [-8, 38]
        ], darkMetal);

        // Louvered horizontal vents
        for (let y = 20; y <= 34; y += 4.5) {
            line([[-6, y], [6, y]], midMetal, 1.2);
            line([[-4, y + 1], [4, y + 1]], p, 0.8);
        }

        // 4. Twin Heavy Engine Nacelles / Sponson Pods (Left & Right)
        for (const side of [-1, 1]) {
            // Main Pod Outer Shell (Coral/Salmon)
            poly([
                [side * 14, -22],
                [side * 25, -28],
                [side * 34, -14],
                [side * 34, 18],
                [side * 29, 32],
                [side * 17, 32],
                [side * 14, 14]
            ], hull);

            // Forward intake cap & rear exhaust nozzle collar
            poly([
                [side * 18, -27],
                [side * 27, -27],
                [side * 29, -18],
                [side * 17, -18]
            ], darkMetal);

            poly([
                [side * 18, 28],
                [side * 28, 28],
                [side * 27, 34],
                [side * 19, 34]
            ], darkMetal);

            // Distinctive White Identification Stripe (from Image 1!)
            poly([
                [side * 16, -2],
                [side * 34, -2],
                [side * 34, 6],
                [side * 16, 6]
            ], '#ffffff');

            line([
                [side * 16, -2],
                [side * 34, -2]
            ], 'rgba(0, 0, 0, 0.35)', 1);
            line([
                [side * 16, 6],
                [side * 34, 6]
            ], 'rgba(0, 0, 0, 0.35)', 1);

            // Dark intake cutout slot on inner flank
            poly([
                [side * 16, 10],
                [side * 24, 10],
                [side * 23, 20],
                [side * 16, 18]
            ], darkMetal, 0.7);

            // Pod panel lines & highlight accents
            line([
                [side * 17, -22],
                [side * 32, -12]
            ], 'rgba(255, 255, 255, 0.4)', 1);
            line([
                [side * 33, -12],
                [side * 33, 16]
            ], p, 1.2);
        }

        // 5. Central Carapace & Cheek Canard Mandibles
        // Lower center chassis
        poly([
            [-14, -14],
            [14, -14],
            [15, 18],
            [0, 24],
            [-15, 18]
        ], hull);

        // Charcoal upper cowl wrapping the canopy collar
        poly([
            [-13, -24],
            [13, -24],
            [16, -6],
            [14, 12],
            [-14, 12],
            [-16, -6]
        ], plate);

        // Cheek canard mandibles (curved forward fins)
        for (const side of [-1, 1]) {
            poly([
                [side * 12, -32],
                [side * 24, -18],
                [side * 21, -6],
                [side * 12, -14]
            ], plate);

            line([
                [side * 12, -32],
                [side * 24, -18]
            ], '#ffffff', 1.2);
            line([
                [side * 24, -18],
                [side * 21, -6]
            ], p, 1);
        }

        // 6. Pale Armored Skull Snout / Visor Mask
        poly([
            [0, -60],
            [11, -50],
            [13, -34],
            [8, -24],
            [0, -28],
            [-8, -24],
            [-13, -34],
            [-11, -50]
        ], hullLight);

        // Shaded underplates on the mask
        poly([
            [0, -56],
            [8, -48],
            [9, -36],
            [0, -32],
            [-9, -36],
            [-8, -48]
        ], hullShade);

        // Dark slitted ventilation teeth / mask vents
        line([[0, -54], [0, -38]], darkMetal, 1.6);
        line([[-6, -45], [-8, -38]], darkMetal, 1.4);
        line([[6, -45], [8, -38]], darkMetal, 1.4);

        // Mask outer edge highlights & nose sensor
        line([[0, -60], [11, -50]], '#ffffff', 1.4);
        line([[0, -60], [-11, -50]], '#ffffff', 1.4);
        circ(0, -56, 1.8, p, 0.9);
        circ(0, -56, 0.8, '#ffffff', 0.8);

        // 7. Glowing Tinted Cockpit Gem/Canopy
        const canopyY = -6;
        const canopyGrad = ctx.createLinearGradient(0, canopyY - 14, 0, canopyY + 12);
        canopyGrad.addColorStop(0, '#0a1420');
        canopyGrad.addColorStop(0.35, shadeColor(hullRGB, -0.25));
        canopyGrad.addColorStop(0.75, shadeColor(hullRGB, -0.5));
        canopyGrad.addColorStop(1, '#05080f');

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, canopyY, 8.5, 12.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = canopyGrad;
        ctx.fill();
        ctx.strokeStyle = p;
        ctx.lineWidth = 1.2 / sc;
        ctx.stroke();

        // White specular reflection crescent arc
        ctx.beginPath();
        ctx.ellipse(-2.5, canopyY - 4, 3.5, 6, -0.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fill();
        ctx.restore();

        ctx.restore();
    } else if (shape === 'razor') {
        // --- RAZOR: Needle Interceptor ---
        // Long needle fuselage with a lighter dorsal spine, a glowing teardrop
        // canopy, swept multi-layer razor wings with white leading edges, and
        // ribbed mid-wing engine nacelles feeding the triple plasma exhausts.
        //
        // Livery follows the shared roster scheme: the player's chosen color is the
        // body paint over deep charcoal panels, trimmed with white markings.
        const hull = p;
        const hullRGB = parseColorToRGBA(p);
        const hullLight = shadeColor(hullRGB, 0.45);
        const hullDeep = shadeColor(hullRGB, -0.45);
        const fleet = '#1a1f28'; // wing blades / deep hull panels
        const fleetDark = '#111318';
        const fleetDeep = '#0b0e14';
        const darkMetal = '#20293a';
        const white = '#ffffff';
        const whiteMid = 'rgba(255, 255, 255, 0.5)';
        const panel = 'rgba(255, 255, 255, 0.35)';
        const pAlpha = a => `rgba(${hullRGB.r | 0}, ${hullRGB.g | 0}, ${hullRGB.b | 0}, ${a})`;

        ctx.save();

        // 1. Triple High-Intensity Plasma Exhaust Jets (Center + Dual Mid-Wing Pods)
        const engines = [
            { x: 0, y: 32, len: 62, w: 5 },
            { x: -22, y: 34, len: 44, w: 4 },
            { x: 22, y: 34, len: 44, w: 4 }
        ];

        for (const eng of engines) {
            ctx.save();

            const flameGrad = ctx.createLinearGradient(eng.x, eng.y, eng.x, eng.y + eng.len);
            flameGrad.addColorStop(0, '#ffffff');
            flameGrad.addColorStop(0.2, p);
            flameGrad.addColorStop(0.65, pAlpha(0.45));
            flameGrad.addColorStop(1, pAlpha(0));
            ctx.beginPath();
            ctx.moveTo(eng.x - eng.w, eng.y);
            ctx.lineTo(eng.x + eng.w, eng.y);
            ctx.lineTo(eng.x, eng.y + eng.len);
            ctx.closePath();
            ctx.fillStyle = flameGrad;
            ctx.fill();

            // Inner hot white laser core
            ctx.beginPath();
            ctx.moveTo(eng.x - eng.w * 0.4, eng.y);
            ctx.lineTo(eng.x + eng.w * 0.4, eng.y);
            ctx.lineTo(eng.x, eng.y + eng.len * 0.65);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
        }

        // 2. Swept-Back Multi-Layered Razor Wing Blades (Matching Reference Image)
        for (const side of [-1, 1]) {
            // Bottom blade layer — longest, swept farthest back, very sharp tip
            poly([
                [side * 20, 10],
                [side * 30, 6],
                [side * 72, 48],
                [side * 68, 52],
                [side * 22, 30]
            ], fleetDeep);

            // Middle blade layer — slightly shorter, offset upward
            poly([
                [side * 18, 2],
                [side * 28, -2],
                [side * 64, 34],
                [side * 58, 40],
                [side * 20, 20]
            ], fleetDark);

            // Top blade layer — shortest, sharpest, forward-positioned
            poly([
                [side * 16, -4],
                [side * 26, -8],
                [side * 54, 22],
                [side * 48, 28],
                [side * 18, 12]
            ], fleet);

            // Glowing player-color + white leading-edge bands on each blade
            line([
                [side * 30, 6],
                [side * 72, 48]
            ], whiteMid, 1.6);

            line([
                [side * 28, -2],
                [side * 64, 34]
            ], p, 1.8);

            line([
                [side * 26, -8],
                [side * 54, 22]
            ], p, 1.6);

            // Blade tip accent — bright edge on the outermost tip
            line([
                [side * 72, 48],
                [side * 68, 52]
            ], white, 1.2);

            line([
                [side * 64, 34],
                [side * 58, 40]
            ], whiteMid, 1.1);

            // Panel seam + rivet on the middle blade
            line([
                [side * 34, 8],
                [side * 50, 28]
            ], panel, 0.7);
            circ(side * 46, 20, 0.9, whiteMid, 0.8);
        }

        // 3. Central Rear Fuselage, Dorsal Spine & Aft Wedge
        poly([
            [-12, -8],
            [12, -8],
            [13, 22],
            [7, 34],
            [-7, 34],
            [-13, 22]
        ], hull);

        // White flank stripes sweeping into the tail
        for (const side of [-1, 1]) {
            poly([
                [side * 11, -2],
                [side * 13, 6],
                [side * 12, 26],
                [side * 8, 32],
                [side * 7, 18]
            ], whiteMid, 0.95);
            line([[side * 8, 30], [side * 12, 24]], white, 1.1);
        }

        // Center nozzle housing with a glowing ring
        poly([
            [-6, 26],
            [6, 26],
            [5, 34],
            [-5, 34]
        ], darkMetal);
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = p;
        ctx.strokeStyle = hullLight;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(0, 30, 5.2, 2.4, 0, 0, Math.PI * 2);
        ctx.stroke();
        circ(0, 30, 2.2, white, 0.95);
        ctx.restore();

        // 4. Inner Leading-Edge Struts + Forward Canard Fins
        for (const side of [-1, 1]) {
            poly([
                [side * 13, -20],
                [side * 27, -6],
                [side * 25, 6],
                [side * 13, -4]
            ], hullLight);

            line([
                [side * 13, -20],
                [side * 27, -6]
            ], whiteMid, 1.6);
            line([
                [side * 25, 6],
                [side * 13, -4]
            ], hullDeep, 1.1);

            // Slim charcoal canard ahead of the wing, white leading edge, sharp tip
            poly([
                [side * 8, -44],
                [side * 15, -38],
                [side * 26, -22],
                [side * 22, -19],
                [side * 9, -36]
            ], fleetDark);
            line([
                [side * 8, -44],
                [side * 26, -22]
            ], whiteMid, 1.4);
            line([
                [side * 26, -22],
                [side * 22, -19]
            ], white, 1.0);
        }

        // 5. Mid-Wing Ribbed Engine Nacelles (charcoal shell, glowing nozzle)
        for (const side of [-1, 1]) {
            // Main cylindrical nacelle body
            poly([
                [side * 17, -10],
                [side * 27, -10],
                [side * 28, 24],
                [side * 16, 24]
            ], fleetDark);

            // Forward dark intake cap
            poly([
                [side * 18, -16],
                [side * 26, -16],
                [side * 27, -10],
                [side * 17, -10]
            ], darkMetal);

            // Rear dark exhaust nozzle
            poly([
                [side * 17, 24],
                [side * 27, 24],
                [side * 26, 34],
                [side * 18, 34]
            ], darkMetal);

            // Player-color rib bands down the nacelle
            for (const bandY of [-2, 8, 16]) {
                poly([
                    [side * 17, bandY],
                    [side * 27, bandY],
                    [side * 27, bandY + 4],
                    [side * 17, bandY + 4]
                ], hull, 0.9);
            }

            line([
                [side * 17, -10],
                [side * 17, 24]
            ], whiteMid, 1.1);
            line([
                [side * 27, -10],
                [side * 27, 24]
            ], p, 1.2);

            // Glow ring on the rear nozzle
            ctx.save();
            ctx.shadowBlur = 10;
            ctx.shadowColor = p;
            ctx.strokeStyle = hullLight;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.ellipse(side * 22, 26, 5.4, 2.2, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // 6. Elongated Needle Nose with white flashes
        poly([
            [0, -88],
            [7, -70],
            [11, -48],
            [14, -24],
            [13, -8],
            [0, -2],
            [-13, -8],
            [-14, -24],
            [-11, -48],
            [-7, -70]
        ], hull);

        // Lighter dorsal spine, white flank stripes and an accent pinstripe
        poly([
            [0, -84],
            [5, -66],
            [8, -44],
            [9, -16],
            [0, -6],
            [-9, -16],
            [-8, -44],
            [-5, -66]
        ], hullLight, 0.9);
        for (const side of [-1, 1]) {
            line([[side * 6, -62], [side * 9, -20]], white, 1.3);
            line([[side * 4, -74], [side * 4, -62]], hullDeep, 0.8);
        }

        // White identification stencil and tail numbers on the nose
        poly([
            [6, -56],
            [11, -56],
            [10, -42],
            [6, -42]
        ], whiteMid);

        line([[7, -36], [12, -36]], white, 1.4);
        line([[7, -32], [12, -32]], white, 1.4);

        // Nose panel lines, white nose flash & tip sensor
        line([[0, -84], [0, -30]], panel, 0.9);
        line([[0, -88], [7, -70]], white, 1.6);
        line([[0, -88], [-7, -70]], white, 1.6);
        circ(0, -84, 2.0, p, 0.9);
        circ(0, -84, 0.9, '#ffffff', 0.8);

        // 7. Sleek Oval Glowing Cockpit Canopy
        const canopyY = -6;
        const canopyGrad = ctx.createLinearGradient(0, canopyY - 14, 0, canopyY + 12);
        canopyGrad.addColorStop(0, '#0a1420');
        canopyGrad.addColorStop(0.35, shadeColor(hullRGB, -0.25));
        canopyGrad.addColorStop(0.75, shadeColor(hullRGB, -0.5));
        canopyGrad.addColorStop(1, '#05080f');

        // Dark cockpit collar ringed with white trim
        poly([
            [-10, -18],
            [10, -18],
            [11, 4],
            [0, 10],
            [-11, 4]
        ], darkMetal);
        line([[-10, -18], [-11, 4], [0, 10], [11, 4], [10, -18]], white, 1.2);

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, canopyY, 8.0, 12.0, 0, 0, Math.PI * 2);
        ctx.fillStyle = canopyGrad;
        ctx.fill();
        ctx.strokeStyle = p;
        ctx.lineWidth = 1.2 / sc;
        ctx.stroke();

        // White specular reflection crescent arc
        ctx.beginPath();
        ctx.ellipse(-2.5, canopyY - 4, 3.2, 5.5, -0.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fill();
        ctx.restore();

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

// =========================================
// ENEMY PREVIEW MODAL
// =========================================

const ENEMY_DATABASE = [
    {
        id: 'drone',
        name: 'ARMORED DRONE',
        type: 'drone',
        color: '#ffea00',
        shape: 'drone',
        hp: 1,
        speed: 'Fast',
        threat: 'Basic',
        tip: 'Standard fodder. Quick but fragile. Use them to practice your aim.'
    },
    {
        id: 'mine',
        name: 'MINE',
        type: 'mine',
        color: '#ff3b5c',
        shape: 'mine',
        hp: 1,
        speed: 'Slow',
        threat: 'Lateral',
        tip: 'Plasma warhead held inside a spinning magnetic containment field. The dashed ring marks its exact blast radius - shoot it down from outside the ring.'
    },
    {
        id: 'shielddrone',
        name: 'SHIELD DRONE',
        type: 'shielddrone',
        color: '#00e5ff',
        shape: 'shielddrone',
        hp: 3,
        speed: 'Medium',
        threat: 'Armored',
        tip: 'Protected by a shield. Requires multiple hits to break through. Prioritize these.'
    },
    {
        id: 'splitter',
        name: 'SPLITTER',
        type: 'splitter',
        color: '#9b6bff',
        shape: 'splitter',
        hp: 2,
        speed: 'Fast',
        threat: 'Splitting',
        tip: 'On destruction, splits into smaller fragments. Clear them quickly before they swarm.'
    },
    {
        id: 'empdrone',
        name: 'EMP DRONE',
        type: 'empdrone',
        color: '#ff4dff',
        shape: 'empdrone',
        hp: 4,
        speed: 'Medium',
        threat: 'Critical',
        tip: 'Emits EMP pulses that jam your weapons. High priority target. Avoid its blast radius.'
    },
    {
        id: 'shooter',
        name: 'STRIKER SHOOTER',
        type: 'shooter',
        color: '#ff8800',
        shape: 'shooter',
        hp: 5,
        speed: 'Medium',
        threat: 'Shooter',
        tip: 'Twin-spire aggressive shooter. Fires directed orange plasma bolts target-locked on players. Fast reaction recommended.'
    },
    {
        id: 'boss',
        name: 'APEX FANG DREADNOUGHT',
        type: 'boss',
        color: '#ff0055',
        shape: 'boss',
        hp: 50,
        speed: 'Heavy',
        threat: 'Boss Apex',
        tip: 'Gargantuan Cyber Dragon Mech Dreadnought. Spawns every 100 kills. Unveils tri-column plasma barrages & sweeping laser pulses.'
    }
];

let enemyModalActive = false;
let enemyCanvasContext = null;
let enemyPreviewCanvases = {};

function initEnemyPreview() {
    const modal = document.getElementById('enemy-preview-modal');
    const btn = document.getElementById('enemy-preview-btn');
    const closeBtn = document.getElementById('enemy-modal-close');
    const body = document.getElementById('enemy-modal-body');
    
    if (!modal || !btn || !closeBtn || !body) return;
    
    body.innerHTML = '';
    
    // Build enemy cards with canvas elements
    ENEMY_DATABASE.forEach(enemy => {
        const card = document.createElement('div');
        card.className = 'enemy-card';
        card.dataset.type = enemy.type;
        
        const canvas = document.createElement('canvas');
        canvas.className = 'enemy-card-canvas';
        canvas.width = 160;
        canvas.height = 100;
        canvas.dataset.enemyId = enemy.id;
        enemyPreviewCanvases[enemy.id] = canvas;
        
        card.innerHTML = `
            <div class="enemy-card-name">${enemy.name}</div>
            <div class="enemy-card-canvas-wrap"></div>
            <div class="enemy-card-info">
                <div class="enemy-card-info-item">
                    <span class="enemy-card-info-label">HP</span>
                    <span class="enemy-card-info-value danger">${enemy.hp}</span>
                </div>
                <div class="enemy-card-info-item">
                    <span class="enemy-card-info-label">SPD</span>
                    <span class="enemy-card-info-value">${enemy.speed}</span>
                </div>
                <div class="enemy-card-info-item">
                    <span class="enemy-card-info-label">TYPE</span>
                    <span class="enemy-card-info-value">${enemy.threat}</span>
                </div>
                <div class="enemy-card-info-item">
                    <span class="enemy-card-info-label">SIG</span>
                    <span class="enemy-card-info-value" style="color:${enemy.color}">${enemy.color}</span>
                </div>
            </div>
            <div class="enemy-card-tip">${enemy.tip}</div>
        `;
        
        const wrap = card.querySelector('.enemy-card-canvas-wrap');
        if (wrap) wrap.appendChild(canvas);
        else card.appendChild(canvas);
        
        body.appendChild(card);
    });
    
    // Draw initial enemy previews
    drawAllEnemyPreviews();
    
    // Draw enemy preview in the button
    drawButtonEnemyPreview();
    
    // Button click to open modal
    btn.addEventListener('click', () => {
        openEnemyModal();
    });
    
    // Close button
    closeBtn.addEventListener('click', () => {
        closeEnemyModal();
    });
    
    // Click outside to close
    modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('enemy-modal-bg') || e.target.classList.contains('enemy-modal')) {
            closeEnemyModal();
        }
    });
    
    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && enemyModalActive) {
            closeEnemyModal();
        }
    });
}

let enemyPreviewAnimId = null;

function previewAnimationLoop() {
    if (!enemyModalActive) return;
    drawAllEnemyPreviews();
    enemyPreviewAnimId = requestAnimationFrame(previewAnimationLoop);
}

function openEnemyModal() {
    const modal = document.getElementById('enemy-preview-modal');
    if (!modal) return;
    
    enemyModalActive = true;
    modal.classList.remove('hidden');
    modal.classList.add('active');
    
    if (enemyPreviewAnimId) cancelAnimationFrame(enemyPreviewAnimId);
    enemyPreviewAnimId = requestAnimationFrame(previewAnimationLoop);
}

function closeEnemyModal() {
    const modal = document.getElementById('enemy-preview-modal');
    if (!modal) return;
    
    enemyModalActive = false;
    if (enemyPreviewAnimId) {
        cancelAnimationFrame(enemyPreviewAnimId);
        enemyPreviewAnimId = null;
    }
    modal.classList.add('hidden');
    modal.classList.remove('active');
}

// Proximity mine: a plasma warhead suspended inside rotating magnetic
// containment rings, with a dashed telegraph ring drawn at the exact blast
// radius so the danger zone is always readable.
// Shared by the play field and the enemy codex previews (previews pass no
// blastRadius, so the telegraph ring only appears in-game).
function drawMineEnemy(ctx, e) {
    const r = Math.min(e.width, e.height) * 0.5;
    if (r <= 0) return;
    const accent = e.color || '#ff3b5c';
    const t = performance.now();
    const seed = e.seed || 0;

    // 1. Blast-radius telegraph: faint, always on, and honest about the hitbox
    if (e.blastRadius) {
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.12 + Math.sin(t / 800) * 0.04;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.setLineDash([7, 10]);
        ctx.lineDashOffset = -t / 110;
        ctx.beginPath();
        ctx.arc(0, 0, e.blastRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    const pulse = 0.86 + Math.sin(t / 300 + seed) * 0.14; // plasma breathing
    const coreR = r * 0.5 * pulse;

    // Containment rings: two ellipses spinning on different axes. Each is split
    // into a far half (behind the plasma) and a near half (in front of it) so
    // the core reads as a sphere held inside a 3D field.
    const rings = [
        { rx: r * 1.02, ry: r * 0.30, rot: t / 1300, phase: t / 620 },
        { rx: r * 0.30, ry: r * 1.02, rot: -t / 1700, phase: -t / 540 }
    ];
    for (const ring of rings) {
        // Screen-space y of an ellipse point at parametric angle a is
        // R * sin(a + phi), so its far half (y < 0) spans (PI - phi, 2PI - phi).
        ring.phi = Math.atan2(ring.rx * Math.sin(ring.rot), ring.ry * Math.cos(ring.rot));
        ring.at = (a) => ({
            x: ring.rx * Math.cos(a) * Math.cos(ring.rot) - ring.ry * Math.sin(a) * Math.sin(ring.rot),
            y: ring.rx * Math.cos(a) * Math.sin(ring.rot) + ring.ry * Math.sin(a) * Math.cos(ring.rot)
        });
    }

    const ringArc = (ring, near) => {
        const start = near ? -ring.phi : Math.PI - ring.phi;
        const glow = Math.max(1.6, r * 0.09);
        const filament = Math.max(0.8, r * 0.035);
        ctx.save();
        ctx.shadowBlur = near ? 12 : 5;
        ctx.shadowColor = accent;
        ctx.globalAlpha = near ? 0.5 : 0.2;
        ctx.strokeStyle = accent;
        ctx.lineWidth = glow;
        ctx.beginPath();
        ctx.ellipse(0, 0, ring.rx, ring.ry, ring.rot, start, start + Math.PI);
        ctx.stroke();
        // White-hot filament running down the middle of the field band
        ctx.globalAlpha = near ? 0.95 : 0.32;
        ctx.strokeStyle = '#ffe3ea';
        ctx.lineWidth = filament;
        ctx.beginPath();
        ctx.ellipse(0, 0, ring.rx, ring.ry, ring.rot, start, start + Math.PI);
        ctx.stroke();
        ctx.restore();
    };

    const ringNodes = (ring, near) => {
        for (let k = 0; k < 3; k++) {
            const p = ring.at(ring.phase + k * (Math.PI * 2) / 3);
            if ((p.y > 0) !== near) continue;
            ctx.save();
            ctx.shadowBlur = near ? 10 : 3;
            ctx.shadowColor = accent;
            ctx.globalAlpha = near ? 0.95 : 0.3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(1.2, r * (near ? 0.11 : 0.07)), 0, Math.PI * 2);
            ctx.fillStyle = near ? '#fff2f5' : accent;
            ctx.fill();
            ctx.restore();
        }
    };

    for (const ring of rings) { ringArc(ring, false); ringNodes(ring, false); }

    // 2. Plasma core - white-hot center bleeding into the mine's accent color
    ctx.save();
    ctx.shadowBlur = 20 * pulse;
    ctx.shadowColor = accent;
    const core = ctx.createRadialGradient(-coreR * 0.28, -coreR * 0.3, coreR * 0.04, 0, 0, coreR);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.32, '#ffd3dd');
    core.addColorStop(0.68, accent);
    core.addColorStop(1, 'rgba(84, 8, 26, 0.92)');
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();
    ctx.restore();

    // Churning currents inside the core, clipped to the sphere
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.clip();
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
        const drift = t / (430 + i * 150) + i * 2.1;
        ctx.globalAlpha = 0.2 + i * 0.07;
        ctx.strokeStyle = '#fff6f8';
        ctx.lineWidth = Math.max(0.8, r * (0.03 + i * 0.012));
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.001; a += 0.3) {
            const rr = coreR * (0.45 + 0.48 * (0.5 + 0.5 * Math.sin(a * 3 + drift)));
            const px = Math.cos(a) * rr;
            const py = Math.sin(a) * rr;
            if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
    }
    ctx.restore();

    // 3. Containment anchors bolted around the core at the diagonals
    const anchorR = r * 0.72;
    for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * (Math.PI / 2);
        ctx.save();
        ctx.translate(Math.cos(a) * anchorR, Math.sin(a) * anchorR);
        ctx.rotate(a);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
            const ha = (k / 6) * Math.PI * 2;
            const hx = Math.cos(ha) * r * 0.17;
            const hy = Math.sin(ha) * r * 0.12;
            if (k === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fillStyle = '#1a0b13';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.save();
        ctx.shadowBlur = 9;
        ctx.shadowColor = accent;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1, r * 0.055), 0, Math.PI * 2);
        ctx.fillStyle = '#ffd8e1';
        ctx.fill();
        ctx.restore();
        ctx.restore();
    }

    // 4. Field lines arcing off the anchors, flaring out past the rings
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10;
    ctx.shadowColor = accent;
    for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * (Math.PI / 2);
        const inner = r * 0.74;
        const outer = r * 1.0;
        const steps = 6;
        ctx.globalAlpha = 0.55 + Math.sin(t / 130 + i) * 0.35;
        ctx.strokeStyle = i % 2 ? '#ffffff' : '#ffb3c2';
        ctx.lineWidth = Math.max(0.9, r * 0.05);
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
            const f = s / steps;
            const rr = inner + (outer - inner) * f;
            // Jitter tapers to zero at both ends so the arc stays attached
            const jitter = Math.sin(t / 85 + i * 2.7 + s * 3.4) * r * 0.11 * Math.sin(f * Math.PI);
            const px = Math.cos(a) * rr - Math.sin(a) * jitter;
            const py = Math.sin(a) * rr + Math.cos(a) * jitter;
            if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }
    ctx.restore();

    // 5. Near halves of the containment rings pass in front of the core
    for (const ring of rings) { ringArc(ring, true); ringNodes(ring, true); }
}

// Exact In-Game Ship Visual Render Implementation
function drawInGameEnemyShip(ctx, e) {
    if (e.isBoss || e.type === 'boss') {
        const w = e.width;
        const h = e.height;

        const poly = (pts, fillColor, strokeColor, strokeWidth = 1) => {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.closePath();
            if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
            if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; ctx.stroke(); }
        };

        const line = (pts, strokeColor, lineWidth = 1.5) => {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        };

        const rivet = (rx, ry, radius = 2) => {
            ctx.save();
            ctx.beginPath();
            ctx.arc(rx, ry, radius, 0, Math.PI * 2);
            ctx.fillStyle = '#050608';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
            ctx.restore();
        };

        const bossColor = e.color || '#ff0000';
        const darkMetal = '#0e0f12';
        const midMetal = '#1f232b';
        const lightMetal = '#39404f';
        const panelLineColor = 'rgba(255, 255, 255, 0.18)';
        const glowGlow = (glowColor, blur = 15) => {
            ctx.shadowBlur = blur;
            ctx.shadowColor = glowColor;
        };

        // 1. Ribbed Shoulder Engines
        for (let side of [-1, 1]) {
            poly([
                { x: side * w * 0.05, y: -h * 0.1 },
                { x: side * w * 0.22, y: -h * 0.12 },
                { x: side * w * 0.22, y: -h * 0.28 },
                { x: side * w * 0.05, y: -h * 0.25 }
            ], darkMetal, bossColor, 1);

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

        // 2. Central Tail / Vertical Stabilizer
        poly([
            { x: -w * 0.03, y: -h * 0.1 },
            { x: w * 0.03, y: -h * 0.1 },
            { x: w * 0.015, y: -h * 0.45 },
            { x: 0, y: -h * 0.72 },
            { x: -w * 0.015, y: -h * 0.45 }
        ], midMetal, bossColor, 1.5);

        line([
            { x: 0, y: -h * 0.1 },
            { x: 0, y: -h * 0.7 }
        ], panelLineColor, 1);

        // 3. Downward stabilizers
        for (let side of [-1, 1]) {
            poly([
                { x: side * w * 0.14, y: h * 0.05 },
                { x: side * w * 0.26, y: h * 0.08 },
                { x: side * w * 0.28, y: h * 0.42 },
                { x: side * w * 0.22, y: h * 0.44 },
                { x: side * w * 0.08, y: h * 0.20 }
            ], darkMetal, bossColor, 1.5);

            line([
                { x: side * w * 0.18, y: h * 0.12 },
                { x: side * w * 0.24, y: h * 0.38 }
            ], panelLineColor, 1);
        }

        // 4. Center Body Chassis Pod
        poly([
            { x: -w * 0.15, y: -h * 0.12 },
            { x: w * 0.15, y: -h * 0.12 },
            { x: w * 0.26, y: -h * 0.02 },
            { x: w * 0.22, y: h * 0.14 },
            { x: 0, y: h * 0.22 },
            { x: -w * 0.22, y: h * 0.14 },
            { x: -w * 0.26, y: -h * 0.02 }
        ], darkMetal, bossColor, 2);

        poly([
            { x: -w * 0.11, y: -h * 0.08 },
            { x: w * 0.11, y: -h * 0.08 },
            { x: w * 0.19, y: 0 },
            { x: w * 0.16, y: h * 0.10 },
            { x: 0, y: h * 0.16 },
            { x: -w * 0.16, y: h * 0.10 },
            { x: -w * 0.19, y: 0 }
        ], midMetal, bossColor, 1);

        // 5. Central Cockpit Visor & Core
        poly([
            { x: -w * 0.07, y: -h * 0.04 },
            { x: w * 0.07, y: -h * 0.04 },
            { x: w * 0.11, y: h * 0.02 },
            { x: 0, y: h * 0.09 },
            { x: -w * 0.11, y: h * 0.02 }
        ], lightMetal, bossColor, 1);

        const pulse = 0.5 + Math.sin(performance.now() / 150) * 0.5;
        ctx.save();
        glowGlow(bossColor, 20 * pulse);
        poly([
            { x: -w * 0.05, y: -h * 0.02 },
            { x: w * 0.05, y: -h * 0.02 },
            { x: w * 0.08, y: h * 0.02 },
            { x: 0, y: h * 0.07 },
            { x: -w * 0.08, y: h * 0.02 }
        ], bossColor, bossColor, 1);
        ctx.restore();

        // 6. Dual Railguns / Heavy Shoulder Cannons
        for (let side of [-1, 1]) {
            poly([
                { x: side * w * 0.08, y: -h * 0.20 },
                { x: side * w * 0.14, y: -h * 0.20 },
                { x: side * w * 0.13, y: -h * 0.55 },
                { x: side * w * 0.09, y: -h * 0.55 }
            ], darkMetal, bossColor, 1.5);

            poly([
                { x: side * w * 0.095, y: -h * 0.24 },
                { x: side * w * 0.125, y: -h * 0.24 },
                { x: side * w * 0.12, y: -h * 0.52 },
                { x: side * w * 0.10, y: -h * 0.52 }
            ], lightMetal, bossColor, 1);

            ctx.save();
            glowGlow(bossColor, 8);
            line([
                { x: side * w * 0.11, y: -h * 0.55 },
                { x: side * w * 0.11, y: -h * 0.62 }
            ], bossColor, 2);
            ctx.restore();
        }

        // 7. Layered Chest Armor Plating & Rivets
        for (let side of [-1, 1]) {
            poly([
                { x: side * w * 0.10, y: h * 0.10 },
                { x: side * w * 0.20, y: h * 0.115 },
                { x: side * w * 0.235, y: h * 0.26 },
                { x: side * w * 0.13, y: h * 0.17 }
            ], lightMetal, bossColor, 1.5);
            poly([
                { x: side * w * 0.115, y: h * 0.115 },
                { x: side * w * 0.185, y: h * 0.125 },
                { x: side * w * 0.215, y: h * 0.235 }
            ], midMetal, bossColor, 1);
            rivet(side * w * 0.21, h * 0.17, w * 0.01);
            rivet(side * w * 0.13, h * 0.135, w * 0.01);
        }

        // 8. Massive Mechanical Wings
        for (let side of [-1, 1]) {
            poly([
                { x: side * w * 0.20, y: -h * 0.08 },
                { x: side * w * 0.28, y: -h * 0.18 },
                { x: side * w * 0.30, y: -h * 0.10 },
                { x: side * w * 0.22, y: -h * 0.02 }
            ], lightMetal, bossColor, 1.5);

            poly([
                { x: side * w * 0.26, y: -h * 0.14 },
                { x: side * w * 0.36, y: -h * 0.24 },
                { x: side * w * 0.62, y: -h * 0.42 },
                { x: side * w * 0.95, y: -h * 0.54 },
                { x: side * w * 0.98, y: -h * 0.45 },
                { x: side * w * 0.92, y: -h * 0.34 },
                { x: side * w * 0.65, y: -h * 0.18 },
                { x: side * w * 0.42, y: -h * 0.04 },
                { x: side * w * 0.24, y: -h * 0.02 }
            ], darkMetal, bossColor, 2);

            poly([
                { x: side * w * 0.38, y: -h * 0.25 },
                { x: side * w * 0.62, y: -h * 0.41 },
                { x: side * w * 0.88, y: -h * 0.50 },
                { x: side * w * 0.85, y: -h * 0.40 },
                { x: side * w * 0.60, y: -h * 0.28 },
                { x: side * w * 0.38, y: -h * 0.18 }
            ], midMetal, bossColor, 1);

            poly([
                { x: side * w * 0.40, y: -h * 0.19 },
                { x: side * w * 0.45, y: -h * 0.245 },
                { x: side * w * 0.62, y: -h * 0.36 },
                { x: side * w * 0.58, y: -h * 0.31 }
            ], lightMetal, bossColor, 1.5);
            poly([
                { x: side * w * 0.63, y: -h * 0.365 },
                { x: side * w * 0.68, y: -h * 0.415 },
                { x: side * w * 0.88, y: -h * 0.49 },
                { x: side * w * 0.84, y: -h * 0.44 }
            ], midMetal, bossColor, 1.5);
            rivet(side * w * 0.51, -h * 0.285, w * 0.009);
            rivet(side * w * 0.73, -h * 0.41, w * 0.009);

            ctx.save();
            glowGlow(bossColor, 8);
            line([
                { x: side * w * 0.40, y: -h * 0.22 },
                { x: side * w * 0.85, y: -h * 0.43 }
            ], bossColor, 2);
            ctx.restore();

            line([
                { x: side * w * 0.48, y: -h * 0.32 },
                { x: side * w * 0.52, y: -h * 0.18 }
            ], panelLineColor, 1.5);
            line([
                { x: side * w * 0.70, y: -h * 0.42 },
                { x: side * w * 0.72, y: -h * 0.26 }
            ], panelLineColor, 1.5);
        }

        // 9. Shoulder pauldron armor
        for (let side of [-1, 1]) {
            poly([
                { x: side * w * 0.14, y: -h * 0.155 },
                { x: side * w * 0.30, y: -h * 0.225 },
                { x: side * w * 0.345, y: -h * 0.125 },
                { x: side * w * 0.33, y: -h * 0.01 },
                { x: side * w * 0.21, y: -h * 0.002 },
                { x: side * w * 0.155, y: -h * 0.09 }
            ], darkMetal, bossColor, 2);

            poly([
                { x: side * w * 0.19, y: -h * 0.145 },
                { x: side * w * 0.27, y: -h * 0.19 },
                { x: side * w * 0.305, y: -h * 0.125 },
                { x: side * w * 0.285, y: -h * 0.04 },
                { x: side * w * 0.21, y: -h * 0.035 }
            ], midMetal, bossColor, 1);

            rivet(side * w * 0.16, -h * 0.13, w * 0.01);
            rivet(side * w * 0.32, -h * 0.125, w * 0.01);
            rivet(side * w * 0.31, -h * 0.035, w * 0.01);
            rivet(side * w * 0.185, -h * 0.10, w * 0.009);

            ctx.save();
            glowGlow(bossColor, 6);
            line([
                { x: side * w * 0.16, y: -h * 0.145 },
                { x: side * w * 0.30, y: -h * 0.22 },
                { x: side * w * 0.345, y: -h * 0.12 }
            ], bossColor, 2);
            ctx.restore();
        }
    } else if (e.isShooter || e.type === 'shooter') {
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

        ctx.shadowBlur = 10;
        ctx.shadowColor = e.color || accent;

        poly([[-w * 0.48, -h * 0.04], [-w * 0.33, -h * 0.43], [-w * 0.18, -h * 0.1], [-w * 0.26, h * 0.52], [-w * 0.43, h * 0.36]], hull);
        poly([[w * 0.48, -h * 0.04], [w * 0.33, -h * 0.43], [w * 0.18, -h * 0.1], [w * 0.26, h * 0.52], [w * 0.43, h * 0.36]], hull);
        poly([[-w * 0.39, h * 0.05], [-w * 0.28, h * 0.38], [-w * 0.35, h * 0.31]], dark, 0.82);
        poly([[w * 0.39, h * 0.05], [w * 0.28, h * 0.38], [w * 0.35, h * 0.31]], dark, 0.82);

        poly([[-w * 0.22, -h * 0.54], [-w * 0.1, -h * 0.36], [-w * 0.1, h * 0.1], [-w * 0.24, h * 0.22], [-w * 0.28, -h * 0.3]], shade);
        poly([[w * 0.22, -h * 0.54], [w * 0.1, -h * 0.36], [w * 0.1, h * 0.1], [w * 0.24, h * 0.22], [w * 0.28, -h * 0.3]], shade);

        poly([[0, -h * 0.43], [w * 0.12, -h * 0.25], [w * 0.1, h * 0.2], [w * 0.04, h * 0.49], [0, h * 0.38], [-w * 0.04, h * 0.49], [-w * 0.1, h * 0.2], [-w * 0.12, -h * 0.25]], hull);
        poly([[0, -h * 0.28], [w * 0.08, -h * 0.18], [w * 0.05, h * 0.2], [0, h * 0.32], [-w * 0.05, h * 0.2], [-w * 0.08, -h * 0.18]], highlight, 0.45);
        poly([[-w * 0.04, h * 0.22], [0, h * 0.34], [w * 0.04, h * 0.22], [0, h * 0.43]], deep, 0.95);

        poly([[-w * 0.28, -h * 0.08], [-w * 0.18, -h * 0.16], [-w * 0.14, h * 0.28], [-w * 0.24, h * 0.34]], dark, 0.8);
        poly([[w * 0.28, -h * 0.08], [w * 0.18, -h * 0.16], [w * 0.14, h * 0.28], [w * 0.24, h * 0.34]], dark, 0.8);
        poly([[-w * 0.42, -h * 0.2], [-w * 0.32, -h * 0.3], [-w * 0.28, -h * 0.05], [-w * 0.4, h * 0.02]], dark, 0.74);
        poly([[w * 0.42, -h * 0.2], [w * 0.32, -h * 0.3], [w * 0.28, -h * 0.05], [w * 0.4, h * 0.02]], dark, 0.74);
        poly([[-w * 0.44, h * 0.18], [-w * 0.34, h * 0.25], [-w * 0.39, h * 0.38], [-w * 0.48, h * 0.31]], dark, 0.74);
        poly([[w * 0.44, h * 0.18], [w * 0.34, h * 0.25], [w * 0.39, h * 0.38], [w * 0.48, h * 0.31]], dark, 0.74);

        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-w * 0.24, -h * 0.5); ctx.lineTo(-w * 0.24, h * 0.44);
        ctx.moveTo(w * 0.24, -h * 0.5); ctx.lineTo(w * 0.24, h * 0.44);
        ctx.moveTo(0, -h * 0.4); ctx.lineTo(0, h * 0.28);
        ctx.stroke();

        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-w * 0.06, h * 0.22); ctx.lineTo(0, h * 0.29); ctx.lineTo(w * 0.06, h * 0.22);
        ctx.stroke();

        poly([[-w * 0.52, -h * 0.04], [-w * 0.44, -h * 0.1], [-w * 0.4, -h * 0.02], [-w * 0.48, h * 0.04]], shade);
        poly([[w * 0.52, -h * 0.04], [w * 0.44, -h * 0.1], [w * 0.4, -h * 0.02], [w * 0.48, h * 0.04]], shade);
        poly([[-w * 0.54, h * 0.08], [-w * 0.45, h * 0.02], [-w * 0.42, h * 0.12], [-w * 0.5, h * 0.18]], shade);
        poly([[w * 0.54, h * 0.08], [w * 0.45, h * 0.02], [w * 0.42, h * 0.12], [w * 0.5, h * 0.18]], shade);
    } else if (e.type === 'mine') {
        drawMineEnemy(ctx, e);
    } else if (e.type === 'shielddrone') {
        // Biomechanical Alien Guardian with Shield Projectors & Kinetic Barrier (Image 2)
        const w = e.width;
        const h = e.height;
        const accent = e.color || '#00e5ff';
        const t = performance.now();

        const poly = (pts, fillColor, strokeColor, strokeWidth = 1) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
            if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; ctx.stroke(); }
        };

        const line = (pts, strokeColor, lineWidth = 1) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        };

        const titaniumWhite = '#e6edf2';
        const titaniumMid = '#b4c0cc';
        const titaniumDark = '#5c6b7a';
        const darkChassis = '#11161d';
        const panelLine = 'rgba(255, 255, 255, 0.25)';

        // 1. Rear Stabilizer Horns (Upper pointing prongs at [-w*0.18, -h*0.46] and [w*0.18, -h*0.46])
        for (let side of [-1, 1]) {
            poly([
                [side * w * 0.08, -h * 0.15],
                [side * w * 0.14, -h * 0.35],
                [side * w * 0.18, -h * 0.46], // Horn needle tip
                [side * w * 0.22, -h * 0.30],
                [side * w * 0.18, -h * 0.10]
            ], titaniumDark, darkChassis, 1);

            poly([
                [side * w * 0.11, -h * 0.18],
                [side * w * 0.16, -h * 0.35],
                [side * w * 0.18, -h * 0.44],
                [side * w * 0.19, -h * 0.28]
            ], titaniumMid, accent, 0.8);
        }

        // 2. Central Cranial Dome / Carapace (Alien helmet curved plate)
        ctx.beginPath();
        ctx.moveTo(-w * 0.32, -h * 0.05);
        ctx.bezierCurveTo(-w * 0.32, -h * 0.38, w * 0.32, -h * 0.38, w * 0.32, -h * 0.05);
        ctx.bezierCurveTo(w * 0.25, h * 0.12, -w * 0.25, h * 0.12, -w * 0.32, -h * 0.05);
        ctx.closePath();
        ctx.fillStyle = titaniumMid;
        ctx.fill();
        ctx.strokeStyle = darkChassis;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Inner lighter carapace dome
        ctx.beginPath();
        ctx.moveTo(-w * 0.24, -h * 0.06);
        ctx.bezierCurveTo(-w * 0.24, -h * 0.30, w * 0.24, -h * 0.30, w * 0.24, -h * 0.06);
        ctx.bezierCurveTo(w * 0.18, h * 0.06, -w * 0.18, h * 0.06, -w * 0.24, -h * 0.06);
        ctx.closePath();
        ctx.fillStyle = titaniumWhite;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Central spine groove & air intake louvers
        line([[0, -h * 0.32], [0, h * 0.04]], darkChassis, 1.5);
        for (let i = 0; i < 3; i++) {
            const vy = -h * 0.22 + i * h * 0.07;
            line([[-w * 0.06, vy], [w * 0.06, vy]], darkChassis, 1.2);
            line([[-w * 0.04, vy + 1.5], [w * 0.04, vy + 1.5]], accent, 1);
        }

        // 3. Outer Swept Guard Cowlings (Curved outer armor wings)
        for (let side of [-1, 1]) {
            poly([
                [side * w * 0.26, -h * 0.18],
                [side * w * 0.42, -h * 0.10],
                [side * w * 0.48, h * 0.15],
                [side * w * 0.40, h * 0.32], // Lower outer tip
                [side * w * 0.33, h * 0.30],
                [side * w * 0.36, h * 0.16],
                [side * w * 0.26, 0]
            ], titaniumDark, darkChassis, 1.5);

            poly([
                [side * w * 0.30, -h * 0.12],
                [side * w * 0.42, -h * 0.04],
                [side * w * 0.44, h * 0.16],
                [side * w * 0.37, h * 0.26],
                [side * w * 0.33, h * 0.15],
                [side * w * 0.27, -h * 0.02]
            ], titaniumWhite, panelLine, 1);
        }

        // 4. Inner Forward Fangs / Mandibles (Curving forward toward the player)
        for (let side of [-1, 1]) {
            poly([
                [side * w * 0.18, h * 0.02],
                [side * w * 0.22, h * 0.16],
                [side * w * 0.18, h * 0.36],
                [side * w * 0.12, h * 0.52], // Needle fang tip
                [side * w * 0.09, h * 0.38],
                [side * w * 0.11, h * 0.18],
                [side * w * 0.08, h * 0.04]
            ], titaniumWhite, darkChassis, 1.5);

            poly([
                [side * w * 0.16, h * 0.06],
                [side * w * 0.18, h * 0.20],
                [side * w * 0.15, h * 0.36],
                [side * w * 0.12, h * 0.48],
                [side * w * 0.11, h * 0.36],
                [side * w * 0.12, h * 0.20]
            ], titaniumMid, accent, 0.8);
        }

        // 5. Central Shield Projector Hub & Lenses (In the concave bay between the fangs)
        poly([
            [-w * 0.14, h * 0.02],
            [w * 0.14, h * 0.02],
            [w * 0.12, h * 0.18],
            [-w * 0.12, h * 0.18]
        ], darkChassis, accent, 1.2);

        // Projector Lenses (3 lenses in a curved array)
        const lenses = [
            { x: -w * 0.08, y: h * 0.10, r: w * 0.045 },
            { x: 0, y: h * 0.12, r: w * 0.055 },
            { x: w * 0.08, y: h * 0.10, r: w * 0.045 }
        ];

        const pulse = 0.7 + Math.sin(t / 140) * 0.3;
        for (let lens of lenses) {
            ctx.beginPath();
            ctx.arc(lens.x, lens.y, lens.r, 0, Math.PI * 2);
            ctx.fillStyle = '#081018';
            ctx.fill();
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.save();
            ctx.shadowBlur = 10 * pulse;
            ctx.shadowColor = accent;
            ctx.beginPath();
            ctx.arc(lens.x, lens.y, lens.r * 0.65, 0, Math.PI * 2);
            ctx.fillStyle = accent;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(lens.x, lens.y, lens.r * 0.3, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
        }

        // 6. Dynamic Rotating Kinetic Energy Shield Barrier
        // Rotates around the alien guardian ship centered at (0, 0), matching the in-game collision arc (200 degrees = 3.49 radians)
        const shieldAng = (e.shieldAngle !== undefined) ? e.shieldAngle : (t * 0.0022);
        const shieldR = Math.max(w, h) * 0.66;
        const arcHalfSpan = 1.745; // Exactly matches shieldDroneBlocks in-game hit detection (200 degrees)
        const startAng = shieldAng - arcHalfSpan;
        const endAng = shieldAng + arcHalfSpan;

        ctx.save();

        // (a) Broad diffused ambient glow aura
        ctx.shadowBlur = 22 * pulse;
        ctx.shadowColor = accent;
        ctx.globalAlpha = 0.22 * pulse;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.arc(0, 0, shieldR, startAng, endAng);
        ctx.stroke();

        // (b) Vibrant plasma barrier ribbon
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, shieldR, startAng, endAng);
        ctx.stroke();

        // (c) Intense white-hot superconducting core line
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, shieldR, startAng, endAng);
        ctx.stroke();

        // (d) Orbiting kinetic barrier emitter nodes along the moving arc
        const nodeStep = 0.45;
        for (let off = -arcHalfSpan + 0.2; off <= arcHalfSpan - 0.2; off += nodeStep) {
            const ang = shieldAng + off;
            const sx = Math.cos(ang) * shieldR;
            const sy = Math.sin(ang) * shieldR;

            // Outer node glow
            ctx.save();
            ctx.shadowBlur = 10;
            ctx.shadowColor = accent;
            ctx.beginPath();
            ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = accent;
            ctx.fill();

            // Diamond/circular white core
            ctx.beginPath();
            ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
        }

        // (e) High-energy shield tips / flare brackets at both ends of the rotating arc
        for (let tipAng of [startAng, endAng]) {
            const tx = Math.cos(tipAng) * shieldR;
            const ty = Math.sin(tipAng) * shieldR;
            ctx.save();
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#ffffff';
            ctx.beginPath();
            ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
        }

        // (f) Dynamic energy spark arcing between the moving shield barrier and projector hub
        const sparkAng = shieldAng + Math.sin(t / 120) * 0.8;
        const spx = Math.cos(sparkAng) * shieldR;
        const spy = Math.sin(sparkAng) * shieldR;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.12);
        ctx.lineTo(spx * 0.5 + Math.sin(t / 80) * 4, spy * 0.5 + Math.cos(t / 80) * 4);
        ctx.lineTo(spx, spy);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();

    } else if (e.type === 'empdrone') {
        // Blocky Heavy Assault Disruption Mech (Image 1)
        const w = e.width;
        const h = e.height;
        const accent = e.color || '#ff4dff';
        const t = performance.now();

        const poly = (pts, fillColor, strokeColor, strokeWidth = 1) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
            if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; ctx.stroke(); }
        };

        const line = (pts, strokeColor, lineWidth = 1) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        };

        const navyDark = '#1c2833';
        const navyMid = '#2e4053';
        const navyLight = '#34495e';
        const panelGray = '#95a5a6';
        const panelLight = '#d5dbdb';
        const darkMetal = '#0f141a';

        // 0. Active Spherical EMP Disruption Field (Ambient Aura, Expanding Shockwaves & Magnetic Flux Rings)
        const empFieldR = (e.empRing && e.empRing > 0) ? Math.max(e.empRing, Math.max(w, h) * 0.78) : Math.max(w, h) * 0.78;
        const corePulse = 0.6 + Math.sin(t / 110) * 0.4;
        const coreY = h * 0.28;

        ctx.save();
        // (a) Diffuse Spherical Electromagnetic Disruption Aura
        const fieldGrad = ctx.createRadialGradient(0, coreY, w * 0.1, 0, coreY, empFieldR);
        fieldGrad.addColorStop(0, 'rgba(255, 77, 255, 0.20)');
        fieldGrad.addColorStop(0.45, 'rgba(160, 40, 255, 0.09)');
        fieldGrad.addColorStop(0.85, 'rgba(0, 229, 255, 0.04)');
        fieldGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.beginPath();
        ctx.arc(0, coreY, empFieldR, 0, Math.PI * 2);
        ctx.fillStyle = fieldGrad;
        ctx.fill();

        // (b) Continuously Expanding Concentric EMP Shockwave Waves
        for (let i = 0; i < 3; i++) {
            const waveProg = ((t / 1300) + i * 0.333) % 1;
            const waveR = w * 0.18 + waveProg * (empFieldR - w * 0.18);
            const waveAlpha = Math.sin(waveProg * Math.PI) * 0.55 * corePulse;
            ctx.save();
            ctx.shadowBlur = 10 * waveAlpha;
            ctx.shadowColor = accent;
            ctx.globalAlpha = waveAlpha;
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1.8 * (1 - waveProg * 0.4);
            ctx.beginPath();
            ctx.arc(0, coreY, waveR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // (c) Dual Counter-Rotating Magnetic Flux Ellipses
        ctx.save();
        ctx.globalAlpha = 0.35 * corePulse;
        ctx.shadowBlur = 8;
        ctx.shadowColor = accent;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(0, coreY, empFieldR * 0.95, empFieldR * 0.40, t * 0.0018, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#00e5ff';
        ctx.beginPath();
        ctx.ellipse(0, coreY, empFieldR * 0.95, empFieldR * 0.40, -t * 0.0014 + 1.1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.restore();

        // 1. Transverse Connecting Bridge Struts (Behind pods and chassis)
        poly([
            [-w * 0.36, -h * 0.16],
            [w * 0.36, -h * 0.16],
            [w * 0.36, -h * 0.06],
            [-w * 0.36, -h * 0.06]
        ], navyDark, darkMetal, 1.2);

        poly([
            [-w * 0.38, h * 0.08],
            [w * 0.38, h * 0.08],
            [w * 0.38, h * 0.22],
            [-w * 0.38, h * 0.22]
        ], navyDark, darkMetal, 1.2);

        // High-voltage ribbed generator coils in the bridge gaps
        for (let side of [-1, 1]) {
            for (let i = 0; i < 4; i++) {
                const rx = side * (w * 0.15 + i * w * 0.04);
                line([[rx, h * 0.10], [rx, h * 0.20]], panelGray, 1.2);
            }
        }

        // 2. Dual Massive Outer Sponsons / Armored Pods (Left & Right)
        for (let side of [-1, 1]) {
            poly([
                [side * w * 0.20, -h * 0.44],
                [side * w * 0.44, -h * 0.44],
                [side * w * 0.48, -h * 0.34],
                [side * w * 0.48, h * 0.24],
                [side * w * 0.38, h * 0.44], // Tapered lower tip
                [side * w * 0.22, h * 0.42],
                [side * w * 0.20, h * 0.24]
            ], navyMid, darkMetal, 1.8);

            poly([
                [side * w * 0.22, -h * 0.40],
                [side * w * 0.42, -h * 0.40],
                [side * w * 0.45, -h * 0.32],
                [side * w * 0.45, h * 0.22],
                [side * w * 0.36, h * 0.38],
                [side * w * 0.23, h * 0.38]
            ], navyLight, 'rgba(255,255,255,0.15)', 1);

            // Light gray rectangular accent insert (from Image 1 sketch)
            poly([
                [side * w * 0.22, -h * 0.08],
                [side * w * 0.47, -h * 0.08],
                [side * w * 0.47, h * 0.12],
                [side * w * 0.22, h * 0.12]
            ], panelGray, darkMetal, 1);

            line([
                [side * w * 0.24, -h * 0.06],
                [side * w * 0.45, -h * 0.06]
            ], panelLight, 1);

            line([
                [side * w * 0.33, -h * 0.38],
                [side * w * 0.33, -h * 0.10]
            ], darkMetal, 1);
            line([
                [side * w * 0.33, h * 0.14],
                [side * w * 0.33, h * 0.36]
            ], darkMetal, 1);

            // Top pod engine/sensor intake
            poly([
                [side * w * 0.25, -h * 0.44],
                [side * w * 0.39, -h * 0.44],
                [side * w * 0.39, -h * 0.40],
                [side * w * 0.25, -h * 0.40]
            ], darkMetal, accent, 1);
        }

        // 3. Central Chassis & Rear Thruster Block
        for (let side of [-1, 1]) {
            poly([
                [side * w * 0.03, -h * 0.34],
                [side * w * 0.12, -h * 0.34],
                [side * w * 0.11, -h * 0.44], // Nozzle exhaust
                [side * w * 0.03, -h * 0.44]
            ], darkMetal, navyLight, 1.2);

            line([
                [side * w * 0.04, -h * 0.435],
                [side * w * 0.10, -h * 0.435]
            ], accent, 1.5);
        }

        poly([
            [-w * 0.12, -h * 0.30],
            [w * 0.12, -h * 0.30],
            [w * 0.15, -h * 0.08],
            [w * 0.16, h * 0.12],
            [w * 0.14, h * 0.30],
            [0, h * 0.36],
            [-w * 0.14, h * 0.30],
            [-w * 0.16, h * 0.12],
            [-w * 0.15, -h * 0.08]
        ], navyMid, darkMetal, 1.5);

        poly([
            [-w * 0.08, -h * 0.18],
            [w * 0.08, -h * 0.18],
            [w * 0.08, h * 0.05],
            [0, h * 0.10],
            [-w * 0.08, h * 0.05]
        ], panelGray, darkMetal, 1);

        // 4. Rounded Cockpit / Sensor Head (Facing forward towards player at +h*0.44)
        poly([
            [-w * 0.12, h * 0.18],
            [-w * 0.15, h * 0.28],
            [-w * 0.08, h * 0.44],
            [w * 0.08, h * 0.44],
            [w * 0.15, h * 0.28],
            [w * 0.12, h * 0.18]
        ], navyLight, darkMetal, 1.5);

        poly([
            [-w * 0.08, h * 0.22],
            [-w * 0.06, h * 0.40],
            [w * 0.06, h * 0.40],
            [w * 0.08, h * 0.22]
        ], panelLight, darkMetal, 1);

        // 5. Central EMP Pulsing Core / Emitter Eye
        ctx.save();
        ctx.shadowBlur = 18 * corePulse;
        ctx.shadowColor = accent;
        ctx.beginPath();
        ctx.arc(0, h * 0.31, w * 0.055, 0, Math.PI * 2);
        ctx.fillStyle = darkMetal;
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, h * 0.31, w * 0.04, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, h * 0.31, w * 0.02, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();

        // 6. High-Voltage EMP Lightning Arcs & Field Containment Perimeter
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = 10 * corePulse;

        // (a) Crackling Radial Lightning Arcs arcing out from the drone to the EMP field boundary
        const numBolts = 6;
        for (let b = 0; b < numBolts; b++) {
            const baseAng = (b / numBolts) * Math.PI * 2 + Math.sin(t / 160 + b * 2) * 0.35;
            const rStart = w * 0.26;
            const rEnd = empFieldR * (0.82 + Math.sin(t / 75 + b * 3) * 0.18);
            const rMid = (rStart + rEnd) * 0.52;
            const midOff = (Math.sin(t / 50 + b * 4) - 0.5) * 0.4;

            const x1 = Math.cos(baseAng) * rStart;
            const y1 = coreY + Math.sin(baseAng) * rStart;
            const xMid = Math.cos(baseAng + midOff) * rMid;
            const yMid = coreY + Math.sin(baseAng + midOff) * rMid;
            const x2 = Math.cos(baseAng) * rEnd;
            const y2 = coreY + Math.sin(baseAng) * rEnd;

            ctx.strokeStyle = (b % 2 === 0) ? accent : '#00e5ff';
            ctx.lineWidth = 1.4;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(xMid, yMid);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            // Ionization discharge spark at the tip of the lightning bolt
            ctx.beginPath();
            ctx.arc(x2, y2, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }

        // (b) Internal pod-to-pod arcs
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.8;
        for (let side of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(side * w * 0.14, -h * 0.08 + Math.sin(t / 80 + (e.seed || 1)) * 3);
            ctx.lineTo(side * w * 0.20, -h * 0.02 + Math.sin(t / 60 + (e.seed || 1) * 2) * 4);
            ctx.lineTo(side * w * 0.22, h * 0.08 + Math.sin(t / 100 + (e.seed || 1)) * 3);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(side * w * 0.14, h * 0.15 + Math.sin(t / 90 + (e.seed || 2)) * 3);
            ctx.lineTo(side * w * 0.21, h * 0.22 + Math.sin(t / 70 + (e.seed || 2) * 3) * 4);
            ctx.stroke();
        }

        // (c) Outer Rotating Spherical Field Boundary Reticle
        ctx.globalAlpha = 0.65 * corePulse;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -t * 0.02;
        ctx.beginPath();
        ctx.arc(0, coreY, empFieldR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]); // Reset dash

        // (d) Field Perimeter Sensor Nodes
        for (let a = 0; a < 4; a++) {
            const nodeAng = (a / 4) * Math.PI * 2 + (t * 0.001);
            const nx = Math.cos(nodeAng) * empFieldR;
            const ny = coreY + Math.sin(nodeAng) * empFieldR;
            ctx.beginPath();
            ctx.arc(nx, ny, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = '#00e5ff';
            ctx.fill();
        }

        ctx.restore();

    } else if (e.type === 'splitter' || e.type === 'mini') {
        // Ultra-Sleek Needle-Point Star Interceptor (Image 3)
        const w = e.width;
        const h = e.height;
        const accent = e.color || '#9b6bff';
        const t = performance.now();

        const poly = (pts, fillColor, strokeColor, strokeWidth = 1) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
            if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; ctx.stroke(); }
        };

        const line = (pts, strokeColor, lineWidth = 1) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        };

        const chromeLight = '#f1f5f9';
        const chromeMid = '#cbd5e1';
        const chromeDark = '#64748b';
        const darkChassis = '#1e293b';
        const carbonBlack = '#0f172a';
        const panelLine = 'rgba(255, 255, 255, 0.2)';

        if (e.type === 'mini') {
            // Mini Fragment Dart: Needle dart sharing the needle-point star silhouette
            poly([
                [0, h * 0.52], // Needle tip
                [w * 0.12, h * 0.15],
                [w * 0.36, -h * 0.35], // Swept delta wing tip
                [w * 0.22, -h * 0.38],
                [w * 0.08, -h * 0.15],
                [w * 0.06, -h * 0.36], // Twin tail prong
                [0, -h * 0.20],
                [-w * 0.06, -h * 0.36],
                [-w * 0.08, -h * 0.15],
                [-w * 0.22, -h * 0.38],
                [-w * 0.36, -h * 0.35],
                [-w * 0.12, h * 0.15]
            ], chromeMid, darkChassis, 1.2);

            ctx.save();
            ctx.shadowBlur = 8;
            ctx.shadowColor = accent;
            line([[0, -h * 0.10], [0, h * 0.25]], accent, 1.5);
            ctx.restore();
        } else {
            // Full Splitter: Ultra-sleek razor star / needle interceptor (Image 3)

            // 1. Swept-Back Main Outer Delta Wings (Lower Star Arms)
            for (let side of [-1, 1]) {
                poly([
                    [side * w * 0.12, -h * 0.02],
                    [side * w * 0.28, -h * 0.22],
                    [side * w * 0.52, -h * 0.48], // Razor wing tip
                    [side * w * 0.44, -h * 0.42],
                    [side * w * 0.34, -h * 0.15],
                    [side * w * 0.20, -h * 0.25],
                    [side * w * 0.14, -h * 0.36],
                    [side * w * 0.08, -h * 0.30],
                    [side * w * 0.08, -h * 0.10]
                ], chromeMid, darkChassis, 1.5);

                poly([
                    [side * w * 0.14, -h * 0.06],
                    [side * w * 0.26, -h * 0.20],
                    [side * w * 0.46, -h * 0.42],
                    [side * w * 0.40, -h * 0.36],
                    [side * w * 0.22, -h * 0.12]
                ], chromeLight, panelLine, 1);

                line([
                    [side * w * 0.22, -h * 0.22],
                    [side * w * 0.34, -h * 0.32]
                ], chromeDark, 1);
            }

            // 2. Twin Trailing Tail Prongs
            for (let side of [-1, 1]) {
                poly([
                    [side * w * 0.02, -h * 0.18],
                    [side * w * 0.08, -h * 0.28],
                    [side * w * 0.08, -h * 0.42], // Sharp tail prong tip
                    [side * w * 0.04, -h * 0.38],
                    [0, -h * 0.24]
                ], chromeDark, darkChassis, 1.2);
            }

            // 3. Exposed Ribbed Central Spine & Engine Core (Vertebrae between wings)
            poly([
                [-w * 0.08, -h * 0.22],
                [w * 0.08, -h * 0.22],
                [w * 0.10, h * 0.05],
                [-w * 0.10, h * 0.05]
            ], carbonBlack, darkChassis, 1.5);

            const corePulse = 0.7 + Math.sin(t / 120) * 0.3;
            ctx.save();
            ctx.shadowBlur = 10 * corePulse;
            ctx.shadowColor = accent;
            for (let i = 0; i < 4; i++) {
                const ry = -h * 0.18 + i * h * 0.065;
                poly([
                    [-w * 0.06, ry],
                    [w * 0.06, ry],
                    [w * 0.05, ry + h * 0.03],
                    [-w * 0.05, ry + h * 0.03]
                ], chromeDark, accent, 1);

                ctx.beginPath();
                ctx.arc(0, ry + h * 0.015, 2, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
            }
            ctx.restore();

            // 4. Swept-Forward Canard Wings (Upper Star Arms flared outward)
            for (let side of [-1, 1]) {
                poly([
                    [side * w * 0.08, h * 0.02],
                    [side * w * 0.18, -h * 0.04],
                    [side * w * 0.44, h * 0.14], // Canard wing tip
                    [side * w * 0.40, h * 0.19],
                    [side * w * 0.18, h * 0.14],
                    [side * w * 0.08, h * 0.16]
                ], chromeMid, darkChassis, 1.5);

                poly([
                    [side * w * 0.10, h * 0.04],
                    [side * w * 0.20, -h * 0.02],
                    [side * w * 0.40, h * 0.14],
                    [side * w * 0.20, h * 0.12]
                ], chromeLight, panelLine, 1);

                line([
                    [side * w * 0.40, h * 0.12],
                    [side * w * 0.44, h * 0.18]
                ], accent, 1.5);
            }

            // 5. Extreme Needle Nose (From mid-body to razor tip at [0, h*0.56])
            poly([
                [-w * 0.10, h * 0.04],
                [-w * 0.08, h * 0.20],
                [-w * 0.04, h * 0.38],
                [0, h * 0.56], // Needle sharp nose tip!
                [w * 0.04, h * 0.38],
                [w * 0.08, h * 0.20],
                [w * 0.10, h * 0.04]
            ], chromeMid, darkChassis, 1.8);

            poly([
                [-w * 0.09, h * 0.06],
                [-w * 0.07, h * 0.20],
                [-w * 0.03, h * 0.38],
                [0, h * 0.54],
                [0, h * 0.06]
            ], chromeLight, 'transparent', 0);

            poly([
                [0, h * 0.06],
                [0, h * 0.54],
                [w * 0.03, h * 0.38],
                [w * 0.07, h * 0.20],
                [w * 0.09, h * 0.06]
            ], chromeDark, 'transparent', 0);

            line([[0, 0], [0, h * 0.54]], darkChassis, 1.2);

            // Diamond Cockpit / Targeting Sensor Slit
            poly([
                [0, h * 0.24],
                [w * 0.035, h * 0.30],
                [0, h * 0.36],
                [-w * 0.035, h * 0.30]
            ], carbonBlack, accent, 1);

            ctx.save();
            ctx.shadowBlur = 6;
            ctx.shadowColor = accent;
            ctx.beginPath();
            ctx.arc(0, h * 0.30, 2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();

            // 6. High-Energy Cleavage / Fracture Lines
            ctx.save();
            ctx.shadowBlur = 8 * corePulse;
            ctx.shadowColor = accent;
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1.2;
            for (let side of [-1, 1]) {
                line([
                    [side * w * 0.08, h * 0.05],
                    [side * w * 0.18, -h * 0.08],
                    [side * w * 0.28, -h * 0.20]
                ], accent, 1.2);
            }
            ctx.restore();
        }
    } else {
        const w = e.width;
        const h = e.height;

        ctx.rotate(Math.PI);

        const hull = '#8c939d';
        const dark = '#20252e';
        const accent = e.color || '#ffea00';
        const panel = 'rgba(255, 255, 255, 0.3)';

        const localPoly = (pts, color, strokeColor, strokeWidth = 1) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            if (color) { ctx.fillStyle = color; ctx.fill(); }
            if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; ctx.stroke(); }
        };

        const localLine = (pts, strokeColor, strokeWidth = 1.2) => {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();
        };

        localPoly([[-w * 0.04, h * 0.15], [w * 0.04, h * 0.15], [w * 0.04, h * 0.32], [-w * 0.04, h * 0.32]], dark, accent, 1);
        localPoly([[-w * 0.15, h * 0.1], [-w * 0.06, h * 0.1], [-w * 0.06, h * 0.65], [-w * 0.15, h * 0.65]], dark, accent, 1.2);
        localPoly([[w * 0.06, h * 0.1], [w * 0.15, h * 0.1], [w * 0.15, h * 0.65], [w * 0.06, h * 0.65]], dark, accent, 1.2);
        localPoly([[-w * 0.15, h * 0.48], [-w * 0.06, h * 0.48], [-w * 0.06, h * 0.68], [-w * 0.32, h * 0.68], [-w * 0.32, h * 0.61], [-w * 0.15, h * 0.58]], accent, 'rgba(0,0,0,0.5)', 1);
        localPoly([[w * 0.06, h * 0.48], [w * 0.15, h * 0.48], [w * 0.15, h * 0.58], [w * 0.32, h * 0.61], [w * 0.32, h * 0.68], [w * 0.06, h * 0.68]], accent, 'rgba(0,0,0,0.5)', 1);
        localPoly([[-w * 0.12, -h * 0.25], [-w * 0.42, -h * 0.22], [-w * 0.36, -h * 0.10], [-w * 0.15, -h * 0.08]], accent, 'rgba(0,0,0,0.4)', 1);
        localPoly([[w * 0.12, -h * 0.25], [w * 0.42, -h * 0.22], [w * 0.36, -h * 0.10], [w * 0.15, -h * 0.08]], accent, 'rgba(0,0,0,0.4)', 1);
        localPoly([[-w * 0.15, -h * 0.08], [-w * 0.72, h * 0.08], [-w * 0.68, h * 0.18], [-w * 0.15, h * 0.15]], hull, accent, 1.5);
        localPoly([[w * 0.15, -h * 0.08], [w * 0.72, h * 0.08], [w * 0.68, h * 0.18], [w * 0.15, h * 0.15]], hull, accent, 1.5);
        localPoly([[-w * 0.5, h * 0.12], [-w * 0.72, h * 0.08], [-w * 0.68, h * 0.18], [-w * 0.45, h * 0.16]], accent, 'rgba(0,0,0,0.3)', 1);
        localPoly([[w * 0.5, h * 0.12], [w * 0.72, h * 0.08], [w * 0.68, h * 0.18], [w * 0.45, h * 0.16]], accent, 'rgba(0,0,0,0.3)', 1);
        localPoly([[0, -h * 0.42], [w * 0.12, -h * 0.25], [w * 0.15, h * 0.05], [w * 0.12, h * 0.22], [0, h * 0.26], [-w * 0.12, h * 0.22], [-w * 0.15, h * 0.05], [-w * 0.12, -h * 0.25]], hull, accent, 1.8);
        localPoly([[-w * 0.08, h * 0.08], [w * 0.08, h * 0.08], [w * 0.06, h * 0.18], [-w * 0.06, h * 0.18]], accent, 'rgba(0,0,0,0.5)', 1);
        localPoly([[0, -h * 0.22], [w * 0.06, -h * 0.1], [w * 0.05, h * 0.02], [-w * 0.05, h * 0.02], [-w * 0.06, -h * 0.1]], dark, accent, 1);
        localLine([[0, -h * 0.4], [0, -h * 0.22]], panel, 1);
        localLine([[-w * 0.05, h * 0.05], [-w * 0.05, h * 0.18]], panel, 0.8);
        localLine([[w * 0.05, h * 0.05], [w * 0.05, h * 0.18]], panel, 0.8);
    }
}

function drawEnemyPreview(ctx, enemy) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    // Background grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
    for (let y = 0; y < h; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }
    
    const cx = w / 2;
    const cy = h / 2;
    
    ctx.save();
    ctx.translate(cx, cy);
    
    const isBoss = enemy.type === 'boss' || enemy.shape === 'boss';
    const isShooter = enemy.type === 'shooter' || enemy.shape === 'shooter';
    
    const now = performance.now();
    const dummy = {
        width: isBoss ? 160 : (isShooter ? 70 : 55),
        height: isBoss ? 160 : (isShooter ? 70 : 55),
        color: enemy.color,
        isBoss: isBoss,
        isShooter: isShooter,
        type: enemy.type,
        shape: enemy.shape,
        seed: 1,
        blink: 5 + (now / 120),
        empRing: 0,
        empCharge: 0,
        empInterval: 3000,
        shieldAngle: (now * 0.0024)
    };
    
    ctx.shadowColor = enemy.color;
    ctx.shadowBlur = isBoss ? 22 : 14;
    
    if (isBoss) {
        ctx.translate(0, 5);
        ctx.scale(0.38, 0.38);
    } else if (isShooter) {
        ctx.scale(0.85, 0.85);
    } else if (enemy.type === 'drone') {
        ctx.scale(0.9, 0.9);
    } else if (enemy.type === 'empdrone') {
        ctx.scale(0.72, 0.72);
    } else if (enemy.type === 'shielddrone') {
        ctx.scale(0.76, 0.76);
    } else {
        ctx.scale(0.85, 0.85);
    }
    
    drawInGameEnemyShip(ctx, dummy);
    
    ctx.restore();
}

function drawAllEnemyPreviews() {
    ENEMY_DATABASE.forEach(enemy => {
        const domCanvas = document.querySelector(`.enemy-card[data-type="${enemy.type}"] .enemy-card-canvas`);
        const canvas = domCanvas || enemyPreviewCanvases[enemy.id];
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        drawEnemyPreview(ctx, enemy);
    });
}

// Initialize enemy preview on startup
function initEnemyPreviewOnLoad() {
    // Small delay to ensure DOM is ready
    setTimeout(initEnemyPreview, 100);
}

// Call initialization if DOM is already ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initEnemyPreviewOnLoad();
} else {
    document.addEventListener('DOMContentLoaded', initEnemyPreviewOnLoad);
}

// Draw mini enemy preview in the button (first enemy type as preview)
function drawButtonEnemyPreview() {
    const btn = document.getElementById('enemy-preview-btn');
    if (!btn) return;
    
    // Get or create the preview container
    let container = btn.querySelector('.enemy-design-preview');
    if (!container) {
        container = document.createElement('span');
        container.className = 'enemy-design-preview';
        const label = btn.querySelector('.enemy-label');
        if (label) {
            label.parentNode.insertBefore(container, label);
        } else {
            btn.prepend(container);
        }
    }
    
    // Clear any existing canvas and create a fresh one
    const existingCanvas = container.querySelector('canvas');
    if (existingCanvas) existingCanvas.remove();
    
    // Create mini canvas (smaller for compact button)
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    container.appendChild(canvas);
    
    // Draw first enemy (Armored Drone) as preview
    const ctx = canvas.getContext('2d');
    const previewEnemy = ENEMY_DATABASE[0]; // First enemy type
    drawMiniEnemyPreview(ctx, previewEnemy);
}

function drawMiniEnemyPreview(ctx, enemy) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    ctx.save();
    ctx.translate(w / 2, h / 2);
    
    const isBoss = enemy.type === 'boss' || enemy.shape === 'boss';
    const isShooter = enemy.type === 'shooter' || enemy.shape === 'shooter';
    
    const dummy = {
        width: isBoss ? 160 : (isShooter ? 70 : 55),
        height: isBoss ? 160 : (isShooter ? 70 : 55),
        color: enemy.color,
        isBoss: isBoss,
        isShooter: isShooter,
        type: enemy.type,
        shape: enemy.shape,
        seed: 1,
        blink: 5,
        empRing: 0,
        empCharge: 0,
        empInterval: 3000,
        shieldAngle: Math.PI / 4
    };
    
    ctx.shadowColor = enemy.color;
    ctx.shadowBlur = 6;
    
    if (isBoss) {
        ctx.scale(0.18, 0.18);
    } else if (isShooter) {
        ctx.scale(0.4, 0.4);
    } else {
        ctx.scale(0.45, 0.45);
    }
    
    drawInGameEnemyShip(ctx, dummy);
    
    ctx.restore();
}


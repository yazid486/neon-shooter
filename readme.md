<div align="center">

# 🌌 Neon Shooter

**A Cyberpunk Space Arcade Experience with 2-Player Local Co-op & Mobile Support**

**HTML5 · CSS3 · JavaScript · Canvas API · Anime.js**

</div>

---

**Neon Shooter** is an adrenaline-fueled, vertical-scrolling space shooter with a striking retro-cyberpunk aesthetic. Control distinct, highly-customizable spacecrafts and battle your way through progressively challenging waves of enemies, survive intensive bullet hells, and defeat gargantuan bosses — all while navigating a neon-drenched interface powered entirely by client-side web technologies.

---

## ✨ Key Features

- 🎮 **Flexible Game Modes**
  - **Single Player Mode** — Play solo to test your reflexes and climb the kill counter.
  - **Local 2-Player Co-op** — Team up on the same screen (keyboard or touch) for coordinated space combat.

- 🚀 **Deep Ship Customization (Hangar)**
  - **13 Hull Types**: Classic, Fighter, Interceptor, Bomber, Speeder, Stealth, Titan, Vintage, 4-Wing, Falcon, Phantom, Gunship, and Razor — each with a unique hand-drawn vector silhouette featuring 3D bevel shading, panel lines, and cockpit details.
  - **28 Color Signatures**: Choose from an extended palette of vibrant neon and deep tones per player.
  - **Live Ship Previews**: Ships render in real-time on interactive canvas previews inside the hangar, complete with aura glow and reflection pad.

- 👾 **Diverse Enemy Archetypes**
  - **Standard Scouts** — Fast-moving geometric enemies that descend through the field.
  - **Shooter Enemies (Strikers / Invaders / Drones)** — Armored ships that fire orange energy rounds at players. Spawn chance increases with kills.
  - **Proximity Mines** 💣 — Slow-drifting mines with a blinking warning telegraph. Detonate when a player enters the blast radius (95 px), damaging every player caught in the zone.
  - **Shield Drones** 🛡️ — Protected by a rotating ~200° energy arc that deflects incoming bullets. Requires flanking to destroy (3 HP).
  - **Splitter Drones** ✂️ — Purple enemies that burst into two fast mini-drones upon death (2 HP).
  - **EMP Drones** ⚡ — Magenta drones that periodically fire an EMP pulse (240 px radius), completely jamming a player's weapons for 8 seconds. A charge-up telegraph ring warns of the incoming pulse (4 HP).
  - **Cyber Dragon Mech (Boss)** 🐉 — A massive boss (170 HP) that spawns every 100 kills. Features sine-wave sweeping movement, a tri-column barrage attack every 600 ms, and drops triple power-ups (Life + Shield + Side Shooter) on defeat.

- ⚡ **Power-Up System**
  - **Side Shooters ⚡** — Deploys two auxiliary wing drones that triple your firepower for 10 seconds. Spawns every 30 kills.
  - **Energy Shield 🛡️** — Envelops the hull in a hexagonal geodesic energy dome that absorbs one hit, with a materialise-in animation, draining timer arc, energy sweep, and shatter ripple on break. Lasts 10 seconds. Spawns every 20 kills.
  - **Extra Life ❤️** — Restores one ship life (up to the 5-life cap). Spawns every 100 kills.
  - **Overdrive 🔥** — Supercharges fire rate (75 ms between shots vs. the normal 200 ms) for 8 seconds.

- 🌀 **Gravity Well / Singularity System**
  - Black hole projectiles with animated accretion disks that pull enemies inward (320 px range) and destroy them inside the event horizon (80 px). Also deflects enemy bullets.

- 🌌 **Premium Visual FX**
  - **Parallax Starfield** — Three-layer depth-separated stars (far/mid/near) drifting at different speeds.
  - **Background Planets** — 10 procedurally-generated planet types with per-planet offscreen sprite baking, Saturn rings, orbiting moons, and surface textures (marble, stars, hex grid, contour lines, isometric cubes).
  - **Particle Engine** — Canvas-based thruster particles, muzzle flashes, shockwave rings, and colorful debris explosions.
  - **Glow FX Toggle** — Enable or disable canvas shadow-blur neon glow effects for performance on lower-end devices.
  - **Anime.js Animations** — Smooth entry, pulse, and elastic scaling on power-ups and shooter enemies.

- 🎨 **7 Switchable Cyber Themes**
  - **Mono** (White / Mid Gray) · **Acid** (Acid Green / Mint) · **Vulcan** (Neon Red-Orange / Solar Gold) · **Frostbite** (Ice Cyan / Glacier Blue) · **Carbon** (Pure White / Crimson Red) · **Glitch** (Laser Purple / Electric Mint) · **Retro** (Amber Gold / Warning Orange)
  - Each theme is a strict two-color palette (`--accent` / `--accent-alt`) with derived CSS `color-mix()` tokens. Readable foreground colors are auto-computed via WCAG contrast ratio analysis.
  - **Live preview on hover**, lock on click, cycle with `T`, jump with `1`–`7`, randomize with the 🎲 button, or auto-cycle with double-tap `↑↑` (stop with `↓↓`).
  - Theme preference is persisted in `localStorage`.

- 📱 **Mobile & Touch Support**
  - Independent touch zones for 2-player mode (left half = P1, right half = P2).
  - Finger-tracking ship movement with smooth lerp follow and auto-fire while finger is down.
  - Zoomed-out play area on mobile (1.4× internal canvas resolution) for more room to maneuver.
  - Touch-action and overscroll-behavior CSS rules prevent accidental scrolling/zooming during gameplay.

- 🖥️ **Polished UI / UX**
  - **Sci-Fi Home Screen** — Launch console layout with perspective grid floor, planet backdrop, system-status topbar, mission data readout, and a hangar vessel configuration panel.
  - **Cyber HUD** — Slanted health bars with state-based coloring (blue → yellow → red), lives counter, kill tracker, level indicator, and animated power-up timer bars.
  - **Threat Database Modal** — Browse all enemy archetypes with live canvas previews from the home screen.
  - **Pause & Game Over Screens** — HUD cluster panels with animated sine-wave displays, spinning ring icons, and hex-panel side modules.

---

## 🕹️ Controls

### ⌨️ Keyboard

| Action | Player 1 | Player 2 | Global |
| :--- | :---: | :---: | :---: |
| **Move** | `W` `A` `S` `D` | `Arrow Keys` | — |
| **Fire** | `Space` | `Enter` | — |
| **Pause / Resume** | — | — | `P` or `Escape` |
| **Cycle Theme** | — | — | `T` |
| **Jump to Theme** | — | — | `1` – `7` |
| **Auto-Toggle Themes** | `W` × 2 | `↑` × 2 | — |
| **Stop Auto-Toggle** | `S` × 2 | `↓` × 2 | — |

### 📱 Touch / Mobile

- **Drag** anywhere in your half of the screen — the ship tracks your finger.
- **Auto-fire** is active while your finger is held down.
- In 1-Player mode, the full screen controls Player 1.

---

## 🧩 Tech Stack & Tools

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Structure** | HTML5 | Semantic layout, Canvas element, HUD overlay panels |
| **Styling** | CSS3 (Vanilla) | Theming via CSS custom properties & `color-mix()`, glassmorphism HUD, `clip-path` shapes, keyframe animations, responsive design, touch-action control |
| **Typography** | Google Fonts — [Orbitron](https://fonts.google.com/specimen/Orbitron), [Outfit](https://fonts.google.com/specimen/Outfit) | Sci-fi display headings and body text |
| **Rendering** | Canvas 2D API | All gameplay rendering — ships, enemies, bullets, particles, planets, starfield, shields |
| **Animation** | [Anime.js](https://animejs.com/) v3.2.1 (CDN) | Elastic power-up entry, shooter enemy pulse, and smooth scaling transitions |
| **Game Loop** | `requestAnimationFrame` | Fixed-timestep physics with accumulator, capped at 4 sim steps per frame to prevent spiral-of-death |
| **Persistence** | `localStorage` | Theme preference saved across sessions |
| **Accessibility** | WCAG Contrast Utilities | Auto-computed readable foreground colors (`readableOn`, `readableOnGradient`) for every theme |

**No build tools, no bundler, no framework** — the game runs as a pure static site. Just open `index.html` in any modern browser.

---

## 📂 Project Structure

```
neon-shooter/
├── index.html    ← Entry point: canvas, HUD overlay, home/pause/game-over screens
├── style.css     ← 3,600+ lines: theme tokens, HUD layout, animations, responsive rules
├── game.js       ← 8,400+ lines: Player class, enemy AI, collision, rendering, planet system
└── README.md     ← This file
```

---

## 🚀 Quick Start

1. **Clone or download** this repository.
2. Verify all files are in the same folder:
   - `index.html`
   - `game.js`
   - `style.css`
3. **Open `index.html`** directly in a web browser (Chrome, Firefox, Edge, Safari).
4. Select your game mode, configure your hull and color signature in the hangar, and click **INITIALIZE**.
5. Survive the neon grid! 🛸

---

## ⚙️ Game Mechanics

| Mechanic | Detail |
| :--- | :--- |
| **Lives** | 5 per player (max 5). 2-second invulnerability on respawn. |
| **Difficulty Ramp** | Spawn interval shrinks from 2.5 s → 350 ms floor as kills increase. Up to 3 enemies per spawn tick at higher kill counts. |
| **Enemy Cap** | Max 20 enemies on screen at once. |
| **Boss Trigger** | Every 100 kills (no boss duplicates). |
| **Mine Pity** | If no mine has spawned in 6 consecutive waves, the next spawn is forced to be a mine. |
| **Shooter Scaling** | Shooter enemy chance starts at 25% and climbs toward 85% of non-archetype spawns. |
| **Collision** | AABB rectangle overlap detection for all entities. |
| **Physics** | Acceleration + friction model for keyboard; lerp follow for touch. Speed clamped at 5.5 px/frame. |

---

<div align="center">
  <b>Good luck, Pilots! 🛸</b>
</div>
<div align="center">
  
# 🌌 Neon Shooter
**A Cyberpunk Space Arcade Experience with 2-Player Local Co-op & Mobile Support**
  
![HTML5](https://img.shields.io/badge/html5-%23E34F26.svg?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/css3-%231572B6.svg?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)
![Anime.js](https://img.shields.io/badge/Anime.js-181818?style=for-the-badge)

</div>

---

**Neon Shooter** is an adrenaline-fueled, vertical-scrolling space shooter with a striking retro-cyberpunk aesthetic. Control distinct, highly-customizable spacecrafts and battle your way through progressively challenging waves of geometric enemies, survive intensive bullet hells, and defeat gargantuan bosses, all while navigating a neon-drenched interface.

---

## ✨ Key Features

- 🎮 **Flexible Game Modes**
  - **Single Player Mode** - Play solo to test your reflexes and claim the high score.
  - **Local 2-Player Co-op** - Connect with a partner on the same screen (keyboard or touch) for coordinated space combat.
- 🚀 **Deep Ship Customization**
  - **8 Hull Types**: Choose from Classic, Fighter, Interceptor, Bomber, Speeder, Stealth, Titan, and Vintage (Steampunk Glider) shapes.
  - **12 Color Signatures**: Match your style with an expanded palette of 12 vibrant neon presets.
  - **Interactive Previews**: Ship previews dynamically render on vector grids in the customize hangar.
- 👾 **Diverse Threat Profiles & Boss Encounters**
  - **Stealth Drones**: Fast-moving geometric scouts.
  - **Armored Shooters**: Twin-spire ships that target you with orange energy rounds, firing faster as game time increases.
  - **Apex Fang Dreadnought (Boss)**: A giant boss that spawns every 100 kills. Featuring a heavy armor plating overlay, glowing railguns, sine-wave sweeping patterns, and a pulsing core. Drops triple power-ups upon defeat.
- ⚡ **Dynamic HUD & Combat Systems**
  - **Slanted Cyber HUD**: Real-time level progress, kill counters, lives display, and energy levels.
  - **State-Based Health Indicators**: Health bars shift colors dynamically (blue/cyan for high, gold/yellow for warning, and red for danger).
  - **Symmetrical HUD Layout**: Mirrored controls and stats for Player 1 and Player 2.
- 🔋 **Power-Up Items**
  - **Side Shooters (⚡)**: Deploys auxiliary wing drones for 10 seconds.
  - **Invincibility Shield (🛡️)**: Envelops the hull in a pulsing energy shield for 10 seconds.
  - **Extra Life (❤️)**: Restores a ship shell to your status board.
- 🌌 **Premium Visual FX & Optimization**
  - **Gravity Well Core**: A fully-animated black hole swirl with a swirling event horizon and accretion disk centered on the startup screen.
  - **Vector Particulate Engines**: High-performance canvas-based thruster particles, muzzle flashes, and colorful shockwave explosions powered by **Anime.js** animations.
  - **Glow FX Performance Toggle**: Easily enable or disable high-fidelity neon glow effects to optimize performance across all systems and mobile devices.

---

## 🕹️ Controls Mapping

### Keyboard Layout
| Action | Player 1 (Blue/Custom) | Player 2 (Red/Custom) | Global / System |
| :--- | :---: | :---: | :---: |
| **Move Up** | `W` | `Up Arrow` | - |
| **Move Down** | `S` | `Down Arrow` | - |
| **Move Left** | `A` | `Left Arrow` | - |
| **Move Right**| `D` | `Right Arrow` | - |
| **Fire Weapon**| `Space` | `Enter` / `Return` | - |
| **Pause/Menu**| - | - | `P` or `ESC` |

### 📱 Mobile & Touchscreen Controls
- **Independent Touch Zones**: When running in 2-Player mode, the screen splits vertically. The left half controls Player 1, and the right half controls Player 2.
- **Directional Drag**: Touch anywhere in your player's half of the screen; the ship will smoothly glide to track your finger position.
- **Auto-Fire**: Ships automatically fire continuously while a finger is pressed down.

---

## 📂 Architecture & Files

- 📄 [index.html](file:///c:/Users/YAZID/OneDrive/Desktop/yazid/game/neon%20shooter/index.html) - Main entrypoint containing the responsive canvas structure, CSS-slanted Cyber HUD components, and screen panels.
- 🎨 [style.css](file:///c:/Users/YAZID/OneDrive/Desktop/yazid/game/neon%20shooter/style.css) - Global rules, screen positioning, canvas sizing, retro background grid elements, and typography styling.
- 📊 [cyber_bar.css](file:///c:/Users/YAZID/OneDrive/Desktop/yazid/game/neon%20shooter/cyber_bar.css) - Specialized styling for the slanted player health bars, power-up cooldown meters, and glowing player status indicators.
- ⚙️ [game.js](file:///c:/Users/YAZID/OneDrive/Desktop/yazid/game/neon%20shooter/game.js) - Core game logic containing the main loop, [Player](file:///c:/Users/YAZID/OneDrive/Desktop/yazid/game/neon%20shooter/game.js#L18) controllers, movement physics, boundary collision detection, and Anime.js transition bindings.

---

## 🚀 Quick Start (Local Run)

1. Clone or download this project workspace.
2. Verify all files are in the same folder:
   - [index.html](file:///c:/Users/YAZID/OneDrive/Desktop/yazid/game/neon%20shooter/index.html)
   - [game.js](file:///c:/Users/YAZID/OneDrive/Desktop/yazid/game/neon%20shooter/game.js)
   - [style.css](file:///c:/Users/YAZID/OneDrive/Desktop/yazid/game/neon%20shooter/style.css)
   - [cyber_bar.css](file:///c:/Users/YAZID/OneDrive/Desktop/yazid/game/neon%20shooter/cyber_bar.css)
3. Open [index.html](file:///c:/Users/YAZID/OneDrive/Desktop/yazid/game/neon%20shooter/index.html) directly in a web browser.
4. Select game mode, configure your hull style and color signature, click **INITIALIZE**, and survive the neon grid!

---

<div align="center">
  <i>"A Typography Experiment 02 * Logotype Brute"</i><br>
  <b>Good luck, Pilots! 🛸</b>
</div>

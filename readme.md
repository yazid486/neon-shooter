<div align="center">
  
# 🌌 Neon Shooter
**A Cyberpunk 2-Player Co-op Space Arcade Experience**
  
![HTML5](https://img.shields.io/badge/html5-%23E34F26.svg?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/css3-%231572B6.svg?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)
![Anime.js](https://img.shields.io/badge/Anime.js-181818?style=for-the-badge)

</div>

---

**Neon Shooter** is an adrenaline-fueled 2-player vertical scrolling space shooter with a striking retro-cyberpunk aesthetic. Take control of distinct, highly-customizable spacecrafts and battle your way through progressively challenging waves of geometric enemies, all while navigating a neon-drenched UI and surviving bullet hells!

## ✨ Key Features

- 🎮 **Local 2-Player Co-op** - Grab a friend and play simultaneously on the same keyboard!
- 🚀 **Deep Customization** - Choose from 7 unique Hull Types (Classic, Fighter, Interceptor, Bomber, Speeder, Stealth, Titan) and 7 curated sci-fi color signatures (Olive Green, Dark Blue, Crimson Red, Gold/Tan, Warm Cream, Slate Blue, Tangerine Orange).
- 👾 **Dynamic Waves & Boss Fights** - Survive swarms of geometric enemies, dodge sniper fire from shooters, and prepare for epic Boss encounters every 100 kills.
- ⚡ **Slanted Cyber HUD & Power-Ups** - An immersive slanted logotype HUD tracks your level, kills, power-up durations, and health. The health bar dynamically shifts colors based on status (blue/cyan for high, gold/yellow for warning, and red for danger), backed by a mirrored symmetrical layout for Player 2. Power-ups include Side Shooters, Extra Lives, and Invincibility Shields.
- 🎆 **Stunning Neon Visuals** - Built with HTML5 Canvas and CSS variables for gorgeous glowing particles, explosions, and smooth UI animations powered by **Anime.js**.

---

## 🕹️ Controls Mapping

| Action | Player 1 (Blue/Custom) | Player 2 (Red/Custom) | Global / System |
| :--- | :---: | :---: | :---: |
| **Move Up** | `W` | `Up Arrow` | - |
| **Move Down** | `S` | `Down Arrow` | - |
| **Move Left** | `A` | `Left Arrow` | - |
| **Move Right**| `D` | `Right Arrow` | - |
| **Fire Weapon**| `Space` | `Enter` / `Return` | - |
| **Pause/Menu**| - | - | `P` or `ESC` |

---

## 📂 Architecture & Files

- 📄 `index.html` - The core application entry point. Houses the Canvas element and the slanted Cyberpunk HUD overlay.
- 🎨 `style.css` - Global stylings, screen layout handling, background grids, glowing typographies, and animations.
- 📊 `cyber_bar.css` - Specialized styles handling the slanted continuous health bars, power-up timers, lives displays, and player tag indicators.
- ⚙️ `game.js` - The engine of the game! Contains the game loop, physics, collision detection routines, entity management, controls, and canvas rendering logic.

---

## 🚀 How to Play (Quick Start)

1. **Clone or Download** the repository to your local machine.
2. Ensure you have the 4 main project files (`index.html`, `style.css`, `cyber_bar.css`, `game.js`) in the same folder.
3. Simply **open `index.html`** in any modern web browser.
4. Customize your hull types and colors on the Start Screen.
5. Click **INITIALIZE** and survive the neon onslaught!

---

<div align="center">
  <i>"A Typography Experiment 02 * Logotype Brute"</i><br>
  <b>Happy Surviving, Pilots! 🛸</b>
</div>

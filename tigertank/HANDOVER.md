# Handover: Tiger Tank Autonomous Play

**Status as of 2026-09-28**: v30 is the latest iteration. It has **regressed** compared to v29 in the most recent run (3 kills, 69 deaths, died at tick 131). The core control loop has a turn-in-place bug that needs fixing before further heuristic improvements will help.

This document is for whoever picks this up next. Read it before touching the code.

---

## What this is

A Playwright-based autonomous AI that plays "Tiger Tank" — a YouTube Playables HTML5 top-down tank shooter. All decisions are driven by runtime state introspection of the Laya.js scene graph. No image recognition, no ML model — pure heuristics.

The game URL: `https://393088398809336751.playables.usercontent.goog/v/assets/index.html`

## How to run

```bash
cd /tmp
node play_tigertank30.js
```

Requirements:
- Node.js (tested with v22)
- Playwright at `/import/ml-sc-scratch1/chenw/CodeGuru/node_modules/playwright`
- Chromium at `/usr/bin/chromium-browser`
- Bun v1.3.14 (optional, for faster iteration)

The script:
1. Launches headless Chromium with `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --use-gl=swiftshader`
2. Mocks the YouTube Playables game API (`gameApi.audioControl`, `saveData`, `loadData`, etc.)
3. Navigates to the game, waits 7s for load
4. Triggers `dt.onStartGame()` to skip the menu
5. Hides the battle UI overlay, sets `bControl = true` on the role
6. Runs a 200-tick autonomous play loop (350ms per tick)
7. Logs position, rotation, HP, enemy data, and action to stdout
8. Saves screenshots every 20 ticks to `/tmp/tigertank_300_tick{N}.png`

## Architecture

### Game object hierarchy (Laya.js)

| Class | Role | Key properties |
|-------|------|----------------|
| `dt` | GameUI / Garage | `onStartGame()` |
| `ht` | Mission / Gameplay | `role`, `battleUI`, `gScene`, `bControl`, `onKeyDown`, `onKeyUp` |
| `bt` | BattleUI (overlay) | `visible`, `alpha`, children include `Me` sprites |
| `it` | gScene (game scene) | `enemyArr`, `friendArr`, `objArr`, `bulletArr` |
| `Me` | Sprite (overlay image) | `width >= 1000` identifies the full-screen overlay |
| `ot` | Enemy vehicle | `bEnemy: true`, `hp: 120-150`, `tmpPos`, `rotation` |
| Player tank | T-26 | `bRole: true`, `bEnemy: false`, `hp: 180`, `maxHP: 180` |

### Key game state locations

- **Player position**: `role.tmpPos.x`, `role.tmpPos.y`
- **Player rotation**: `role.rotation` (degrees)
- **Player HP**: `role.hp`, `role.maxHP`
- **Player move state**: `role.moveState` (0=idle, 1=moving), `role.turnState` (-1=left, 0=idle, 1=right)
- **Enemies**: `gScene.enemyArr` (array of `ot` objects)
- **Bullets**: `gScene.bulletArr` — **always empty**, bullets are not findable in any inspected array
- **Game state**: `mission.curState` ("W" = playing), `mission.bPause`

### Input mechanism

The game listens for keyboard events on the canvas AND on `mission.onKeyDown`. Both must fire for `moveState` to change:

```javascript
const evt = new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', keyCode: 87, which: 87, bubbles: true, cancelable: true });
canvas.dispatchEvent(evt);
if (typeof mission.onKeyDown === 'function') mission.onKeyDown(evt);
```

Key codes: W=87, A=65, S=83, D=68, Space=32, Enter=13, R=82.

### Firing

```javascript
if (typeof role.fire === 'function') role.fire();
```

No cooldown observed — can be called every tick.

## What works

- **Scene graph traversal**: `findType(node, typeName, depth)` walks `_children`/`children` recursively to find objects by constructor name.
- **Enemy detection**: `gScene.enemyArr` reliably returns 5 enemy `ot` objects with position, HP, and rotation.
- **Keyboard input**: Canvas dispatch + `mission.onKeyDown` triggers movement.
- **Firing**: `role.fire()` works.
- **Kill tracking**: Comparing enemy IDs between ticks detects eliminations.
- **HP-based retreat**: Triggering retreat when HP drops below threshold prevents some deaths.
- **Pre-emptive dodge**: Detecting enemies facing the player (dot product of forward vector and player-relative vector) and strafing perpendicular.
- **8-direction safest retreat**: Projecting 150px in each of 8 directions and scoring by enemy proximity picks the safest escape route.

## What's broken (priorities for next person)

### 1. CRITICAL: Turn-in-place loop

**Symptom**: Tank rotates between -60° and -75° for 100+ ticks without ever driving forward. Position barely changes.

**Root cause**: The angle-to-target never converges below the 15° threshold needed to start driving. The tank keeps choosing `approach-turn` because the target angle keeps shifting (enemies are moving) and the tank's rotation overshoots/undershoots.

**Where to look**: `play_tigertank30.js` lines 267-298 (the target selection and kite logic).

**Suggested fix**: 
- Add a "commit to turn" state — once you start turning toward a target, keep turning until you're within 5° before switching to drive.
- Or: use `role.moveTo(x, y)` instead of manual keyboard control — the game engine may handle approach better than the heuristic.
- Or: reduce the turn threshold from 15° to 30° so the tank starts driving sooner (accepting imperfect aim).

### 2. Respawn doesn't work

**Symptom**: Tank dies, "TAP TO CONTINUE" appears, but canvas-center click + Space/Enter/R keys don't respawn it.

**What was tried**:
- `MouseEvent('mousedown'/'mouseup'/'click')` at canvas center
- `KeyboardEvent` for Space, Enter, R, Escape
- Scene tree walk looking for sprites with text matching /TAP|CONTINUE|RESTART|RESPAWN|RETRY|PLAY/i
- Calling `buttonSprite.onClick()` directly

**Where to look**: `play_tigertank30.js` lines 339-383 (the respawn block).

**Suggested fix**:
- Inspect the death screen more carefully — find the actual button sprite and its click handler.
- Try `PointerEvent` instead of `MouseEvent`.
- Try dispatching on `document` instead of `canvas`.
- Check if the game uses a different input system (touch events? pointer events?).

### 3. Bullets are invisible

**Symptom**: `gScene.bulletArr` is always empty. `gScene.objArr` only contains `ot` objects. No way to dodge actual bullets.

**Workaround in v30**: Pre-emptive dodge via enemy facing detection (dot product).

**Suggested fix**:
- Walk the full scene graph looking for any object with `bEnemy` or `bRole` flags and a `speed` property.
- Check if bullets are stored in a different scene or layer.
- Check if bullets are pooled/recycled and look for inactive ones.

### 4. No arena awareness

**Symptom**: Tank can drive into walls and get stuck in corners. The 8-direction safest retreat doesn't account for map edges.

**Suggested fix**:
- Read arena bounds from `gScene` or the tiled map.
- Add a wall penalty to the 8-direction scoring (penalize directions approaching arena edges).
- Or: detect when the tank hasn't moved for N ticks and trigger an "unstuck" maneuver (reverse + turn).

### 5. Stochastic performance

**Symptom**: Results vary significantly run-to-run. v30 survived 200 ticks in one run and died at 131 in another.

**Suggested fix**:
- Run each version 5-10 times and report median/mean kills and survival time.
- Add a `--runs N` flag to the script.
- Track per-enemy spawn positions to understand variance sources.

## Recommended next steps (in order)

1. **Fix the turn loop** — this is the blocker. Without it, nothing else matters.
2. **Fix respawn** — without respawn, every death is permanent.
3. **Add arena bounds** — prevents corner traps.
4. **Run multiple trials** — get reliable metrics.
5. **Then** add more sophisticated heuristics (enemy fire-rate detection, damage prediction, etc.).

## File layout

```
tigertank/
├── README.md                    # This file's companion — results and findings
├── HANDOVER.md                  # This file
├── play_tigertank.js            # v1: initial exploration
├── play_tigertank2.js … 24.js   # Iterative exploration
├── play_tigertank25.js          # Deep scene walk for enemies
├── play_tigertank26.js          # First autonomous loop
├── play_tigertank27.js          # Dodging + retreat
├── play_tigertank28.js          # Bullet search (failed)
├── play_tigertank29.js          # 50% retreat threshold
├── play_tigertank30.js          # Latest: 70% retreat, pre-emptive dodge, 8-dir retreat
└── screenshots/
    └── v30/                     # Screenshots from v30 runs
```

## Repo

- Fork: `https://github.com/snova-chenw/DriveLikeAHuman`
- Upstream PR: #1 (open)
- Branch: `main`

## Contact

Original author: snova-chenw (Chen Wei). This work was done as part of the DriveLikeAHuman project exploring autonomous game-playing heuristics.

# Tiger Tank Autonomous Play Scripts

Playwright-based autonomous AI for the YouTube Playables top-down tank shooter
"Tiger Tank" (`https://393088398809336751.playables.usercontent.goog/v/assets/index.html`).

All gameplay decisions are driven by runtime state introspection of the Laya.js
scene graph — no image recognition.

## Files

| Script | Purpose |
|--------|---------|
| `play_tigertank.js` … `play_tigertank24.js` | Earlier exploration iterations |
| `play_tigertank25.js` | Deep scene-graph walk to find enemies via `bEnemy` property |
| `play_tigertank26.js` | First autonomous play loop using `gScene.enemyArr` |
| `play_tigertank27.js` | Added dodging, retreat, HP-based kill tracking |
| `play_tigertank28.js` | Deep walk for bullets; stripped serialization to primitives |
| `play_tigertank29.js` | Raised retreat threshold to 50% HP; better respawn attempts |
| `play_tigertank30.js` | 70% HP retreat, pre-emptive dodge via enemy facing, 8-dir safest retreat, kite 450-550, strafe-fire |

Screenshots from each run are stored under `screenshots/v{N}/`.

## Key findings

- Game engine: Laya.js 2.x WebGL
- Player tank T-26: `bControl: false` during loading, `bRole: true`, `bEnemy: false`, hp ~180/maxHP 180
- Enemy vehicles type `ot` with `bEnemy: true`, hp 120-150
- Enemies stored in `gScene.enemyArr` (array of `ot` objects)
- gScene keys: `objArr` (contains ot objects only), `enemyArr` (5 enemies), `friendArr` (5 friends), `bulletArr` (0 — empty)
- Canvas KeyboardEvent dispatch + `mission.onKeyDown(evt)` together triggers moveState=1
- Role methods: `role.fire()`, `role.moveTo(x,y)`, `role.maxHP`, `role.hp`
- Bullets NOT found in bulletArr (0 length) or objArr (only ot objects)
- Game state: `curState: "W"`, `bPause: false`
- Damage is applied in discrete chunks (per bullet hit), not continuously — HP drops in steps of ~42 HP

## Results progression

| Version | Kills | Deaths | Died at tick | Notes |
|---------|-------|--------|--------------|-------|
| v26 | 1 | 0 | survived 60 | too passive |
| v27 | 2 | 1 | 94 | |
| v28 | 4 | 1 | 48 | too aggressive |
| v29 | 4 | 1 | 92 | |
| **v30** | **3** | **69** | **131** | **turn loop broken — see HANDOVER.md** |

## v30 detailed results (latest run, 2026-09-28)

- **Kills**: 3 (enemies #4, #3, #2 eliminated)
- **Deaths**: 69 ticks dead (died at tick 131, never respawned)
- **Final HP**: 0/180
- **Final position**: (835, 2084) — barely moved from spawn (163, 2084)
- **Action breakdown**:
  - `approach-turn`: 41 ticks (spinning in place)
  - `RETREAT-turn`: 23 ticks (spinning in place)
  - `approach-drive`: only 3 ticks
  - `DEAD`: 69 ticks
- **HP trajectory**: 180 → 138 (tick 97) → 96 (tick 108) → 45 (tick 120) → 0 (tick 131)
- **Respawn attempts**: 4 (ticks 133, 138, 150, 170) — all failed

### v30 regression analysis

v30 added 7 heuristics over v29 but **regressed** in this run. Root causes:

1. **Turn-in-place loop**: The tank rotated between -60° and -75° for 100+ ticks without ever converging on a target. The angle-to-target never dropped below the 15° threshold needed to start driving forward.
2. **HP dropped in chunks**: Damage is per-bullet (~42 HP per hit), not continuous. By the time the 70% retreat threshold triggered at tick 108, the tank had already taken 84 HP of damage while "approaching" without closing distance.
3. **Respawn completely failed**: All 4 respawn attempts (canvas-center click + Space/Enter/R keys) failed to activate the "TAP TO CONTINUE" button.
4. **Stochastic variance**: A prior session's log showed v30 surviving all 200 ticks. The heuristics are not robust — performance varies heavily with enemy spawn positions and AI behavior.

See `HANDOVER.md` for the full diagnosis and recommended next steps.

## Open problems

- **Turn loop bug (CRITICAL)**: Tank spins in place instead of closing distance. Must be fixed before any retreat/dodge heuristics can be effective.
- **Respawn**: game shows "TAP TO CONTINUE" but canvas-center click doesn't activate it. Tried: mousedown/mouseup/click events, Space/Enter/R keys, scene-tree walk for button sprites.
- **Bullets**: not detectable in any inspected array (`gScene.bulletArr` always empty, `gScene.objArr` only contains ot objects). v30 works around this with enemy-facing detection for pre-emptive dodging.
- **Arena bounds**: tank has no awareness of map edges. v30's 8-direction safest retreat can drive the tank into walls/corners.
- **Stochastic performance**: results vary significantly run-to-run due to random enemy spawns and AI behavior. Need multiple runs to get reliable metrics.

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

## Results progression

| Version | Kills | Died at tick |
|---------|-------|--------------|
| v26 | 1 | survived all 60 ticks (too passive) |
| v27 | 2 | 94 |
| v28 | 4 | 48 (too aggressive) |
| v29 | 4 | 92 |

## Open problems

- Respawn: game shows "TAP TO CONTINUE" but canvas-center click doesn't activate it
- Bullets: not detectable in any inspected array
- Tank still dies around tick 48-94 even with retreat logic

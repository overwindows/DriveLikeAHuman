# Experiments Log

This document tracks all experiments run on the Tiger Tank autonomous AI. Each entry describes what was tried, what was expected, what happened, and what to try next.

---

## How to use this document

1. **Before starting an experiment**: Add a new section below with the date, hypothesis, and method
2. **After running**: Fill in the results, observations, and conclusions
3. **When iterating**: Add follow-up experiments that build on previous results

---

## Experiment template

```markdown
### EXP-NNN: [Short title]
**Date**: YYYY-MM-DD
**Author**: [your name]
**Version**: v[N]
**Hypothesis**: What you expected to happen
**Method**: What you changed and why
**Results**: 
- Kills: X
- Deaths: Y
- Died at tick: Z
- Notable observations
**Conclusion**: What you learned
**Next steps**: What to try next
```

---

## Experiment history

### EXP-001: v26 — First autonomous play loop
**Date**: 2026-09-25
**Author**: snova-chenw
**Version**: v26
**Hypothesis**: Simple nearest-enemy targeting with no retreat will produce at least 1 kill
**Method**: Used `gScene.enemyArr` to find enemies, drove toward nearest, fired when close
**Results**:
- Kills: 1
- Deaths: 0
- Survived all 60 ticks (too passive)
**Conclusion**: Tank was too cautious — never closed distance on enemies
**Next steps**: Add retreat logic and dodge

### EXP-002: v27 — Dodging and retreat
**Date**: 2026-09-26
**Author**: snova-chenw
**Version**: v27
**Hypothesis**: Adding dodge and retreat will improve survival
**Method**: Added bullet-based dodge (failed — bullets unfindable), added 30% HP retreat
**Results**:
- Kills: 2
- Deaths: 1
- Died at tick 94
**Conclusion**: Retreat helped but tank still took lethal damage during approach
**Next steps**: Raise retreat threshold, add pre-emptive dodge

### EXP-003: v28 — Aggressive play
**Date**: 2026-09-27
**Author**: snova-chenw
**Version**: v28
**Hypothesis**: Lower retreat threshold (30%) will let tank kill more before retreating
**Method**: Lowered retreat to 30%, kept aggressive kite range (250-700)
**Results**:
- Kills: 4
- Deaths: 1
- Died at tick 48 (too aggressive)
**Conclusion**: Tank killed more but died faster — retreat threshold too low
**Next steps**: Find middle ground

### EXP-004: v29 — Balanced retreat
**Date**: 2026-09-27
**Author**: snova-chenw
**Version**: v29
**Hypothesis**: 50% retreat threshold balances kills and survival
**Method**: Raised retreat to 50%, added bullet search (still failed), improved respawn
**Results**:
- Kills: 4
- Deaths: 1
- Died at tick 92
**Conclusion**: Better balance, but tank still dies from burst damage during turn phase
**Next steps**: Add pre-emptive dodging to avoid damage during approach

### EXP-005: v30 — Pre-emptive dodge and 8-dir retreat
**Date**: 2026-09-28
**Author**: snova-chenw
**Version**: v30
**Hypothesis**: Pre-emptive dodge (enemy facing detection) + 8-direction safest retreat will prevent burst damage deaths
**Method**: Added 7 heuristics:
1. 70% HP retreat threshold (raised from 50%)
2. Pre-emptive dodge via enemy facing (dot product > 0.5)
3. 8-direction safest retreat (score by enemy proximity)
4. Multi-enemy dodge (facingCount >= 2)
5. Kite range 400-550 (tightened from 250-700)
6. Strafe-fire pattern (alternate a/d while firing)
7. Respawn button walk (scene tree search)
**Results** (latest run):
- Kills: 3
- Deaths: 69
- Died at tick 131
- Action breakdown: 41 approach-turn, 23 RETREAT-turn, 3 approach-drive, 69 DEAD
**Conclusion**: **REGRESSION**. Tank got stuck in turn-in-place loop. Rotation oscillated between -60° and -75° for 100+ ticks without converging on target. The added complexity made the control loop worse.
**Next steps**: 
1. Fix turn loop — add "commit to turn" state or use `role.moveTo(x,y)` instead of manual keyboard
2. Fix respawn — current approach doesn't work
3. Add arena bounds — prevent corner traps
4. Run multiple trials — single-run results are unreliable

---

## Open hypotheses to test

### H1: `role.moveTo(x, y)` is more reliable than manual keyboard control
**Rationale**: The game engine may handle approach logic better than our heuristic. If `moveTo` works, we can simplify the control loop significantly.
**Test**: Replace keyboard dispatch with `role.moveTo(target.x, target.y)` and measure kills/survival.

### H2: Arena bounds can be read from gScene or tiledMap
**Rationale**: The 8-direction safest retreat drives the tank into walls. If we know arena bounds, we can add wall penalties.
**Test**: Run `npm run explore` and look for width/height/tiledMap/gridSize properties on gScene or its parents.

### H3: Bullets are stored in a different scene or layer
**Rationale**: `gScene.bulletArr` is always empty, but bullets clearly exist (we take damage). They might be in a separate scene or pooled.
**Test**: Walk the full scene graph looking for objects with `bEnemy` or `bRole` flags and a `speed` property.

### H4: Respawn requires a specific input sequence
**Rationale**: Canvas-center click + Space/Enter/R doesn't work. Maybe the game expects a touch event, or a specific click on a button sprite.
**Test**: Try `PointerEvent`, dispatch on `document` instead of `canvas`, or find the actual button sprite and call its click handler directly.

### H5: Damage is per-bullet and predictable
**Rationale**: HP drops in chunks of ~42 HP. If we know enemy fire rate and damage, we can time retreats perfectly.
**Test**: Track per-enemy HP changes and correlate with player HP drops to measure DPS.

### H6: Enemy AI has predictable patterns
**Rationale**: Enemies might always move toward the player, or patrol in fixed patterns. If predictable, we can exploit their behavior.
**Test**: Log enemy positions over time and look for patterns.

---

## Metrics to track

For each experiment, record:

| Metric | Why it matters |
|--------|----------------|
| Kills | Primary objective |
| Deaths | Survival (lower is better) |
| Died at tick | How long the tank survived |
| Final HP | How close to death |
| Final position | Where the tank ended up |
| Action distribution | What the tank spent time doing |
| HP trajectory | When damage was taken |
| Enemy HP changes | Which enemies were damaged when |

---

## Statistical significance

**Single-run results are unreliable.** Enemy spawns and AI behavior are random. Always run at least 3-5 trials before drawing conclusions.

Recommended workflow:
1. Make a change
2. Run `node run_all.js 5` (5 trials per version)
3. Compare with `npm run compare`
4. Only commit changes that show consistent improvement across runs

---

## Ideas backlog

- [ ] Fix turn-in-place loop (use moveTo or commit-to-turn state)
- [ ] Fix respawn (try PointerEvent, document.dispatchEvent, button sprite click)
- [ ] Add arena bounds awareness
- [ ] Find bullets in scene graph
- [ ] Measure enemy DPS empirically
- [ ] Add enemy fire-rate detection
- [ ] Implement predictive dodging (where bullets will be, not where they are)
- [ ] Add power-up detection and collection
- [ ] Implement friend AI coordination (5 friends in friendArr)
- [ ] Try different kite patterns (circle-strafe, figure-8)
- [ ] Add damage prediction to time retreats
- [ ] Implement "commit to target" state (don't switch targets mid-engage)

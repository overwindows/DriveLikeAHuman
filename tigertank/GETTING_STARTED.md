# Getting Started

Zero-to-running guide for the Tiger Tank autonomous play project. Follow these steps in order.

---

## 1. Prerequisites

You need:
- **Node.js 18+** (tested with v22)
- **Chromium browser** (or Chrome)
- **Linux/macOS** (Windows may work but untested)

Check your versions:
```bash
node --version    # should be v18+
which chromium    # or: which chromium-browser, which google-chrome
```

If you don't have Chromium:
```bash
# Ubuntu/Debian
sudo apt install chromium-browser

# macOS
brew install --cask chromium

# Or use Playwright's bundled Chromium
npx playwright install chromium
```

---

## 2. Install dependencies

```bash
cd tigertank
npm install
```

This installs Playwright. If the install fails, try:
```bash
npm install --legacy-peer-deps
```

---

## 3. Run your first experiment

```bash
npm run run
```

This runs `play_tigertank30.js` (the latest version). You should see:
- Browser launches (headless)
- Game loads after ~7 seconds
- Tank starts moving autonomously
- Logs appear every tick showing position, HP, enemies, action
- Screenshots saved to `/tmp/tigertank_300_tick{N}.png`

The run takes ~70 seconds (200 ticks × 350ms).

---

## 4. Understand the output

Each tick logs a line like:
```
Tick 42: pos=(810,2076) rot=-71 hp=180/180(100%) ms=0 ts=-1 enemies=[#0:91hp@1542 #1:120hp@1517 #2:120hp@2500] facing=0 safest=E(0) action=approach-turn (d=1517)
```

| Field | Meaning |
|-------|---------|
| `Tick 42` | Tick number (0-199) |
| `pos=(810,2076)` | Tank position (x, y) in game coordinates |
| `rot=-71` | Tank rotation in degrees |
| `hp=180/180(100%)` | Current HP / max HP (percentage) |
| `ms=0` | moveState (0=idle, 1=moving) |
| `ts=-1` | turnState (-1=left, 0=idle, 1=right) |
| `enemies=[...]` | Up to 3 enemies: `#id:hp@distance` |
| `facing=0` | Number of enemies facing the tank |
| `safest=E(0)` | Safest retreat direction (score) |
| `action=approach-turn` | What the tank decided to do |

At the end you'll see:
```
=== TOTAL KILLS: 3 ===
=== DEATHS: 69 ===
```

---

## 5. Run multiple versions for comparison

```bash
# Run each version once
npm run run:all

# Run each version 3 times (recommended for statistical significance)
node run_all.js 3
```

This creates:
- `results/runs.csv` — summary table
- `results/v{N}_run{M}_{timestamp}.log` — full logs

View results:
```bash
npm run compare
```

Example output:
```
Version | Runs | Avg Kills | Avg Deaths | Avg Died@Tick | Best Kills | Worst Kills
--------|------|-----------|------------|---------------|------------|------------
v26     | 3    | 1.0       | 0.0        | N/A           | 1          | 1
v27     | 3    | 2.0       | 1.0        | 94            | 2          | 2
v28     | 3    | 4.0       | 1.0        | 48            | 4          | 4
v29     | 3    | 4.0       | 1.0        | 92            | 4          | 4
v30     | 3    | 3.0       | 69.0       | 131           | 3          | 3
```

---

## 6. Explore the game scene

Before modifying heuristics, understand what's available:

```bash
npm run explore
```

This dumps the full scene graph structure:
- All mission methods and properties
- All role methods, properties, and current state
- All gScene arrays and their contents
- A sample enemy with its available properties

Use this to discover new game state you can exploit (e.g., enemy fire rates, arena bounds, power-up locations).

---

## 7. Modify heuristics

To create a new version:

1. **Copy the latest version:**
   ```bash
   cp play_tigertank30.js play_tigertank31.js
   ```

2. **Edit the heuristic logic** in the `page.evaluate()` callback (the big function that runs each tick). Key sections:
   - **Target selection** (~line 230): which enemy to attack
   - **Dodge logic** (~line 182): when to strafe
   - **Retreat logic** (~line 252): when to run away
   - **Kite range** (~line 287): optimal attack distance

3. **Add to run_all.js:**
   ```javascript
   const VERSIONS = ['v26', 'v27', 'v28', 'v29', 'v30', 'v31'];
   ```

4. **Add npm script in package.json:**
   ```json
   "run:v31": "node play_tigertank31.js"
   ```

5. **Test:**
   ```bash
   npm run run:v31
   ```

6. **Compare:**
   ```bash
   node run_all.js 3
   npm run compare
   ```

---

## 8. Common modifications

### Change retreat threshold

In the tick callback, find:
```javascript
if (hpPct < 0.70 && nearestDist < 900) {
  target = null; // retreat mode
}
```

Change `0.70` to a different value (0.5 = retreat at 50% HP, 0.3 = very aggressive).

### Change kite range

Find:
```javascript
if (targetDist < 400) {
  // back up
} else if (targetDist > 550) {
  // approach
} else {
  // fire and strafe
}
```

Adjust 400 and 550 to change the optimal attack distance.

### Add a new heuristic

Example: dodge when any enemy is within 300px regardless of facing:

```javascript
// Add this after the facing detection block
let closeEnemyDodge = null;
for (const e of enemyData) {
  const dx = roleX - e.x, dy = roleY - e.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < 300) {
    // Strafe perpendicular to enemy→player vector
    const px = -dy, py = dx;
    closeEnemyDodge = px > 0 ? 'right' : 'left';
    break;
  }
}

// In the action priority chain, add:
if (closeEnemyDodge) {
  keyToPress = closeEnemyDodge === 'left' ? 'a' : 'd';
  action = `CLOSE-DODGE ${closeEnemyDodge}`;
}
```

---

## 9. Debugging tips

### View a screenshot mid-run

Screenshots are saved every 20 ticks to `/tmp/tigertank_300_tick{N}.png`. Open them to see what the tank is doing.

### Pause and inspect

Add this to your script to pause execution and open DevTools:

```javascript
// After setup, before the play loop
await page.pause();  // Opens Playwright Inspector
```

### Log everything

Change the log condition in the tick loop:
```javascript
// Log every tick (not just every 3rd)
if (true) {
  console.log(`Tick ${tick}: ...`);
}
```

### Check if the game is still running

```javascript
// Add to the tick callback
if (!mission || !role) {
  return { error: 'game objects lost', tick };
}
```

---

## 10. Troubleshooting

### "chromium-browser: command not found"

Edit the script and change the `executablePath`:
```javascript
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',  // or wherever Chrome is
  // ...
});
```

Or remove `executablePath` to use Playwright's bundled Chromium:
```javascript
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```

### "playwright: not found"

```bash
npm install playwright
# or
npm install --legacy-peer-deps
```

### Game doesn't load / hangs on black screen

The game might have updated. Check:
1. Is the URL still valid? `https://393088398809336751.playables.usercontent.goog/v/assets/index.html`
2. Are the API mocks still correct? Run `npm run explore` to see what the game expects.
3. Is the 7-second wait enough? Try increasing to 10000ms.

### Tank doesn't move

Check:
1. Is `bControl = true` being set? (look for the setInterval in setup)
2. Are keyboard events being dispatched? (check console for errors)
3. Is the canvas focused? (the script calls `canvas.focus()` and `canvas.tabIndex = 0`)

### Respawn doesn't work

This is a known issue. See `HANDOVER.md` for what was tried and suggested fixes.

---

## 11. Next steps

Once you're comfortable:
1. Read `HANDOVER.md` for the prioritized bug list
2. Read `TECHNIQUES.md` for the full manipulation toolkit
3. Read `EXPERIMENTS.md` for experiment tracking
4. Pick a bug from HANDOVER.md and try to fix it
5. Run `node run_all.js 5` to validate your fix statistically
6. Document your changes in `EXPERIMENTS.md`

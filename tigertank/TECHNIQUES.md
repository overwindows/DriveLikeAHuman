# Techniques: Manipulating the Tiger Tank HTML Game

This document describes the specific skills, tricks, and reverse-engineering techniques used to autonomously play "Tiger Tank" — a YouTube Playables HTML5 game built on Laya.js 2.x. These techniques generalize to any Laya.js game and most HTML5 canvas games.

---

## 1. Browser Automation with Playwright

### Launch configuration

```javascript
const { chromium } = require('playwright');

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium-browser',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader'  // software WebGL for headless rendering
  ]
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
```

**Why these flags:**
- `--no-sandbox` / `--disable-setuid-sandbox`: required when running as root in containers
- `--disable-dev-shm-usage`: avoids shared memory issues in Docker
- `--use-gl=swiftshader`: software WebGL renderer — necessary because headless Chromium has no GPU

### Console and error capture

```javascript
const consoleMsgs = [];
const pageErrors = [];

page.on('console', m => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => pageErrors.push(String(e)));
```

This captures all `console.log` from the page (including from injected scripts) and any uncaught exceptions.

---

## 2. Mocking the YouTube Playables API

The game expects a `window.gameApi` object with specific methods. Without mocking, the game hangs waiting for API responses.

### Route interception (network-level)

```javascript
await page.route('**/game_api/v1*', async route => {
  const url = route.request().url();
  let body = '{}';
  if (url.includes('audioControl')) body = JSON.stringify({ audioControl: { mute: false, volume: 1 } });
  else if (url.includes('saveData')) body = JSON.stringify({ saveData: { data: '{}', updatedAt: 0 } });
  else if (url.includes('loadData')) body = JSON.stringify({ loadData: { data: '{}' } });
  else if (url.includes('playerInfo')) body = JSON.stringify({ playerInfo: { id: 'p1', name: 'Player' } });
  else if (url.includes('adState')) body = JSON.stringify({ adState: { available: false } });
  else if (url.includes('environment')) body = JSON.stringify({ environment: { platform: 'WEB', locale: 'en-US' } });
  await route.fulfill({ status: 200, contentType: 'application/json', body });
});
```

### Object injection (in-page)

```javascript
await page.addInitScript(() => {
  const noop = () => {};
  const makePromise = (val) => Promise.resolve(val);
  window.gameApi = {
    audioControl: (cfg) => makePromise({ audioControl: cfg || { mute: false, volume: 1 } }),
    saveData: (d) => makePromise({ saveData: { data: d?.data || '{}', updatedAt: Date.now() } }),
    loadData: () => makePromise({ loadData: { data: '{}' } }),
    playerInfo: () => makePromise({ playerInfo: { id: 'p1', name: 'Player' } }),
    adState: () => makePromise({ adState: { available: false } }),
    environment: () => makePromise({ environment: { platform: 'WEB', locale: 'en-US' } }),
    onAudioFocus: noop, onVisibilityChange: noop, onPause: noop, onResume: noop,
    showAd: () => makePromise({ adShown: false }),
    logEvent: noop, reportError: noop
  };
  window.YT = window.YT || { Game: { onReady: noop, save: noop, load: noop } };
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
```

**Key insight**: YouTube Playables games check `document.visibilityState` and pause if it's `'hidden'`. Forcing it to `'visible'` prevents auto-pause.

---

## 3. Scene Graph Traversal (Laya.js)

Laya.js uses a display tree similar to Flash/ActionScript. Every visual element is a `Sprite` node with `_children` (or `children`) array.

### Finding nodes by constructor name

```javascript
function findType(node, typeName, depth = 0) {
  if (depth > 10) return null;  // prevent infinite recursion
  if (node.constructor.name === typeName) return node;
  const kids = node._children || node.children || [];
  for (const k of kids) {
    const r = findType(k, typeName, depth + 1);
    if (r) return r;
  }
  return null;
}
```

### Safe property access

Laya.js objects throw on missing properties. Always wrap in try/catch:

```javascript
const safeGet = (obj, key) => {
  try { return obj[key]; }
  catch(e) { return null; }
};
```

### Circular reference protection

When walking the scene graph, use a `WeakSet` to avoid infinite loops:

```javascript
const visited = new WeakSet();
function walk(node, depth) {
  if (depth > 8 || !node || typeof node !== 'object') return;
  if (visited.has(node)) return;
  try { visited.add(node); } catch(e) { return; }
  // ... process node
  const kids = node._children || node.children || [];
  for (const k of kids) walk(k, depth + 1);
}
```

---

## 4. Game State Introspection

### Finding the game root

```javascript
const stage = window.Laya.stage;
const children = stage._children || stage.children || [];
```

### Triggering game start

The game has a menu screen with a "Start" button. Find the `dt` (GameUI) node and call its method:

```javascript
for (const c of children) {
  const dt = findType(c, 'dt');
  if (dt) { dt.onStartGame(); return; }
}
```

### Hiding UI overlays

The battle UI overlay blocks the game view. Find it and hide:

```javascript
const battleUI = safeGet(mission, 'battleUI');
if (battleUI) {
  battleUI.visible = false;
  battleUI.alpha = 0;
  // Also hide the full-screen "Me" sprite
  const kids = battleUI._children || battleUI.children || [];
  for (const k of kids) {
    if (k.constructor.name === 'Me' && k.width >= 1000) k.visible = false;
  }
}
```

### Enabling player control

The game disables player control during loading. Force it on:

```javascript
const role = safeGet(mission, 'role');
if (role) role.bControl = true;
mission.bControl = true;

// Keep it on — the game periodically resets it
setInterval(() => {
  try { if (role) role.bControl = true; mission.bControl = true; } catch(e) {}
}, 200);
```

---

## 5. Input Injection

### Keyboard events

The game listens for keyboard events on the canvas AND on `mission.onKeyDown`. Both must fire:

```javascript
const keyMap = {
  w: { key: 'w', code: 'KeyW', keyCode: 87 },
  a: { key: 'a', code: 'KeyA', keyCode: 65 },
  s: { key: 's', code: 'KeyS', keyCode: 83 },
  d: { key: 'd', code: 'KeyD', keyCode: 68 }
};

const k = keyMap[keyToPress];
const evt = new KeyboardEvent('keydown', {
  key: k.key,
  code: k.code,
  keyCode: k.keyCode,
  which: k.keyCode,
  bubbles: true,
  cancelable: true
});
canvas.dispatchEvent(evt);
if (typeof mission.onKeyDown === 'function') mission.onKeyDown(evt);
```

**Critical**: You must dispatch on the canvas AND call `mission.onKeyDown` directly. The game uses both pathways.

### Key release

Always release keys after each tick to prevent stuck keys:

```javascript
for (const key of ['w', 'a', 's', 'd']) {
  const code = key === 'w' ? 'KeyW' : key === 'a' ? 'KeyA' : key === 's' ? 'KeyS' : 'KeyD';
  const keyCode = key === 'w' ? 87 : key === 'a' ? 65 : key === 's' ? 83 : 68;
  const evt = new KeyboardEvent('keyup', {
    key, code, keyCode, which: keyCode,
    bubbles: true, cancelable: true
  });
  canvas.dispatchEvent(evt);
  if (typeof mission.onKeyUp === 'function') mission.onKeyUp(evt);
}
```

### Mouse events (for respawn buttons)

```javascript
const rect = canvas.getBoundingClientRect();
const cx = rect.left + rect.width / 2;
const cy = rect.top + rect.height / 2;

for (const type of ['mousedown', 'mouseup', 'click']) {
  canvas.dispatchEvent(new MouseEvent(type, {
    clientX: cx, clientY: cy,
    bubbles: true, cancelable: true,
    button: 0
  }));
}
```

---

## 6. Reading Game State

### Player state

```javascript
const rolePos = safeGet(role, 'tmpPos');
const roleX = rolePos?.x || 0;
const roleY = rolePos?.y || 0;
const roleRot = safeGet(role, 'rotation') || 0;  // degrees
const roleHP = safeGet(role, 'hp');
const roleMaxHP = safeGet(role, 'maxHP') || 180;
const moveState = safeGet(role, 'moveState');  // 0=idle, 1=moving
const turnState = safeGet(role, 'turnState');  // -1=left, 0=idle, 1=right
```

### Enemy state

```javascript
const gScene = safeGet(role, 'gScene') || safeGet(mission, 'gScene');
const enemyArr = safeGet(gScene, 'enemyArr');

for (let i = 0; i < enemyArr.length; i++) {
  const e = enemyArr[i];
  const pos = safeGet(e, 'tmpPos');
  const hp = safeGet(e, 'hp');
  if (pos && hp > 0) {
    // Enemy is alive
    console.log(`Enemy ${i}: pos=(${pos.x}, ${pos.y}), hp=${hp}, rot=${e.rotation}`);
  }
}
```

### Firing

```javascript
if (typeof role.fire === 'function') role.fire();
```

No cooldown observed — can be called every tick.

---

## 7. Heuristic AI Patterns

### Target selection

```javascript
// Find nearest enemy
let nearest = null, nearestDist = Infinity;
for (const e of enemyData) {
  const dx = e.x - roleX, dy = e.y - roleY;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < nearestDist) { nearestDist = dist; nearest = e; }
}

// Find most wounded
let mostWounded = null, lowestHPPct = 1;
for (const e of enemyData) {
  const pct = e.hp / 150;  // enemy max HP is ~150
  if (pct < lowestHPPct) { lowestHPPct = pct; mostWounded = e; }
}

// Priority: wounded > nearest
if (mostWounded && lowestHPPct < 0.5) target = mostWounded;
else target = nearest;
```

### Angle calculation

```javascript
const dx = target.x - roleX;
const dy = target.y - roleY;
const angle = Math.atan2(dy, dx) * 180 / Math.PI;
let angleDiff = angle - roleRot;
while (angleDiff > 180) angleDiff -= 360;
while (angleDiff < -180) angleDiff += 360;
// angleDiff > 0 → turn right (press 'd')
// angleDiff < 0 → turn left (press 'a')
```

### Pre-emptive dodge (enemy facing detection)

Detect enemies aiming at you and strafe perpendicular:

```javascript
let facingCount = 0;
let closestFacing = null, closestFacingDist = Infinity;

for (const e of enemyData) {
  const dx = roleX - e.x, dy = roleY - e.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist > 600) continue;  // only care about nearby enemies

  const eRad = e.rotation * Math.PI / 180;
  const fwdX = Math.cos(eRad), fwdY = Math.sin(eRad);
  const dot = (fwdX * dx + fwdY * dy) / dist;

  if (dot > 0.5) {  // enemy facing within ~60° of player
    facingCount++;
    if (dist < closestFacingDist) {
      closestFacingDist = dist;
      closestFacing = { x: e.x, y: e.y, dx, dy, dist };
    }
  }
}

if (facingCount >= 1 && closestFacing) {
  // Perpendicular to enemy→player vector
  const px = -closestFacing.dy, py = closestFacing.dx;
  const d1 = Math.sqrt((roleX + px*100 - closestFacing.x)**2 + (roleY + py*100 - closestFacing.y)**2);
  const d2 = Math.sqrt((roleX - px*100 - closestFacing.x)**2 + (roleY - py*100 - closestFacing.y)**2);
  const dodgeDir = d1 > d2 ? 'right' : 'left';
}
```

### 8-direction safest retreat

Score each of 8 directions by enemy proximity:

```javascript
const dirs = [];
for (let i = 0; i < 8; i++) {
  const a = (i * 45) * Math.PI / 180;
  dirs.push({
    dx: Math.cos(a), dy: Math.sin(a),
    name: ['E','NE','N','NW','W','SW','S','SE'][i]
  });
}

let safestDir = null, safestScore = Infinity;
for (const d of dirs) {
  let score = 0;
  const projX = roleX + d.dx * 150;  // project 150px in this direction
  const projY = roleY + d.dy * 150;
  for (const e of enemyData) {
    const edx = projX - e.x, edy = projY - e.y;
    const ed = Math.sqrt(edx*edx + edy*edy);
    if (ed < 500) score += (500 - ed);  // closer = more dangerous
  }
  if (score < safestScore) { safestScore = score; safestDir = d; }
}
```

### Kite pattern (strafe while firing)

```javascript
if (targetDist >= 400 && targetDist <= 550) {
  if (Math.abs(angleDiff) > 15) {
    // Aim first
    keyToPress = angleDiff > 0 ? 'd' : 'a';
  } else {
    // Fire and strafe
    shouldFire = true;
    keyToPress = strafeDir > 0 ? 'a' : 'd';  // alternate each tick
  }
}
```

---

## 8. Kill Tracking

Track enemy IDs across ticks to detect eliminations:

```javascript
const currentIds = new Set(tickResult.enemies.map(e => e.id));
for (const prevId of Object.keys(lastEnemyHPs)) {
  if (!currentIds.has(parseInt(prevId))) {
    totalKills++;
    console.log(`KILL! Enemy ${prevId} eliminated. Total: ${totalKills}`);
    delete lastEnemyHPs[prevId];
  }
}
for (const e of tickResult.enemies) {
  lastEnemyHPs[e.id] = e.hp;
}
```

---

## 9. Debugging Techniques

### Expose game objects globally

Store references on `window` for easy access from DevTools:

```javascript
window.__mission = mission;
window.__role = role;
window.__canvas = canvas;
```

### Deep object exploration

Dump all keys of an object to understand its structure:

```javascript
const keys = Object.keys(mission);
const methods = keys.filter(k => typeof mission[k] === 'function');
const respawnMethods = methods.filter(k => /respawn|revive|spawn|restart|reset|dead|death|gameover|over/i.test(k));
```

### Screenshot at intervals

```javascript
if (tick % 20 === 0) {
  await page.screenshot({ path: `/tmp/tigertank_300_tick${tick}.png` });
}
```

### Inspect gScene arrays

```javascript
const gScene = safeGet(role, 'gScene');
for (const key of Object.keys(gScene)) {
  const val = gScene[key];
  if (Array.isArray(val)) {
    console.log(`${key}: length=${val.length}, firstType=${val[0]?.constructor?.name}`);
  }
}
```

---

## 10. Common Pitfalls

1. **Forgetting to release keys**: Keys stay "pressed" across ticks if you don't send keyup events. Always release all keys at the end of each tick.

2. **Not calling both canvas.dispatchEvent AND mission.onKeyDown**: The game uses both pathways. Missing either one means no movement.

3. **Assuming bullets are findable**: `gScene.bulletArr` is always empty in this game. Use enemy-facing detection instead.

4. **Not handling the death screen**: When HP hits 0, the game shows "TAP TO CONTINUE". You need to click the canvas center or press Space/Enter to respawn.

5. **Ignoring bControl resets**: The game periodically sets `bControl = false`. Use `setInterval` to keep it true.

6. **Trusting single-run results**: Enemy spawns and AI behavior are random. Run each version 5-10 times for reliable metrics.

7. **Not hiding the battle UI overlay**: The `Me` sprite (width >= 1000) covers the entire canvas. Set `visible = false` and `alpha = 0`.

---

## 11. Generalizing to Other Games

These techniques work for most HTML5 canvas games:

1. **Identify the engine**: Look for global objects (`window.Laya`, `window.Phaser`, `window.PIXI`, `window.createjs`).
2. **Find the game root**: Usually `window.Laya.stage`, `window.game`, or `window.phaserGame`.
3. **Traverse the scene graph**: Walk `_children`/`children` recursively, looking for objects by constructor name or properties.
4. **Find the player object**: Look for objects with `bPlayer`, `isPlayer`, `controlled`, or similar flags.
5. **Identify input handlers**: Check if the game uses `addEventListener('keydown')`, `onKeyDown` methods, or input objects.
6. **Mock external APIs**: Any `fetch` calls to game services need to be intercepted or stubbed.
7. **Inject input**: Dispatch synthetic events on the canvas AND call any direct handler methods.

The same approach works for Phaser games (use `game.scene.scenes`), PIXI games (walk `stage.children`), and CreateJS games (walk `stage.children`).

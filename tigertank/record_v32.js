// record_v32.js — Run v32 heuristic with video recording
const { chromium } = require('/nvmedata/chenw/CodeGuru/node_modules/playwright');
const fs = require('fs');

const VIDEO_DIR = '/nvmedata/chenw/DriveLikeAHuman/tigertank/videos';
fs.mkdirSync(VIDEO_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader']
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } }
  });
  const page = await ctx.newPage();

  // Mock YouTube Playables API
  await page.addInitScript(() => {
    const noop = () => {};
    const makePromise = (val) => Promise.resolve(val);
    window.gameApi = {
      audioControl: (cfg) => makePromise({audioControl: cfg || {mute: false, volume: 1}}),
      saveData: (d) => makePromise({saveData: {data: d?.data || '{}', updatedAt: Date.now()}}),
      loadData: () => makePromise({loadData: {data: '{}'}}),
      playerInfo: () => makePromise({playerInfo: {id: 'p1', name: 'Player'}}),
      adState: () => makePromise({adState: {available: false}}),
      environment: () => makePromise({environment: {platform: 'WEB', locale: 'en-US'}}),
      onAudioFocus: noop, onVisibilityChange: noop, onPause: noop, onResume: noop,
      showAd: () => makePromise({adShown: false}),
      logEvent: noop, reportError: noop
    };
    window.YT = window.YT || {Game: {onReady: noop, save: noop, load: noop}};
    Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true});
  });

  await page.route('**/game_api/v1*', async route => {
    const url = route.request().url();
    let body = '{}';
    if (url.includes('audioControl')) body = '{"audioControl":{"mute":false,"volume":1}}';
    else if (url.includes('saveData')) body = '{"saveData":{"data":"{}","updatedAt":0}}';
    else if (url.includes('loadData')) body = '{"loadData":{"data":"{}"}}';
    else if (url.includes('playerInfo')) body = '{"playerInfo":{"id":"p1","name":"Player"}}';
    else if (url.includes('adState')) body = '{"adState":{"available":false}}';
    else if (url.includes('environment')) body = '{"environment":{"platform":"WEB","locale":"en-US"}}';
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });

  const GAME_URL = 'https://393088398809336751.playables.usercontent.goog/v/assets/index.html';
  console.log('Navigating...');
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000);

  // Start game
  await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const children = stage._children || stage.children || [];
    for (const c of children) {
      const dt = findType(c, 'dt');
      if (dt) { dt.onStartGame(); return; }
    }
  });
  console.log('Start game triggered');
  await page.waitForTimeout(3000);

  // Setup
  await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };
    const children = stage._children || stage.children || [];
    let mission = null;
    for (const c of children) { mission = findType(c, 'ht'); if (mission) break; }
    if (!mission) return;
    const battleUI = safeGet(mission, 'battleUI');
    if (battleUI) { battleUI.visible = false; battleUI.alpha = 0; }
    const role = safeGet(mission, 'role');
    if (role) role.bControl = true;
    mission.bControl = true;
    setInterval(() => { try { if (role) role.bControl = true; mission.bControl = true; } catch(e) {} }, 200);
    window.__mission = mission;
    window.__role = role;
    window.__canvas = document.querySelector('canvas');
  });
  console.log('Setup done. Recording...');

  // Run v32 logic inline (simplified version)
  let kills = 0, deaths = 0, bulletsFired = 0;
  let strafeDir = 1, strafeHoldTicks = 0;
  let commitTarget = null, commitTicks = 0;
  let lastFireTick = 0;

  for (let tick = 0; tick < 200; tick++) {
    const result = await page.evaluate(({ tickNum, strafeDir, strafeHoldTicks, commitTargetId, commitTicks, lastFireTick }) => {
      const mission = window.__mission;
      const role = window.__role;
      const canvas = window.__canvas;
      if (!mission || !role) return { error: 'no mission/role' };

      const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };
      const rolePos = safeGet(role, 'tmpPos');
      const roleX = rolePos?.x || 0;
      const roleY = rolePos?.y || 0;
      const roleRot = safeGet(role, 'rotation') || 0;
      const roleHP = safeGet(role, 'hp');
      const roleMaxHP = safeGet(role, 'maxHP') || 180;

      const gScene = safeGet(role, 'gScene') || safeGet(mission, 'gScene');
      let enemies = [];
      if (gScene) {
        const enemyArr = safeGet(gScene, 'enemyArr');
        if (Array.isArray(enemyArr)) enemies = enemyArr;
      }

      const enemyData = [];
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        try {
          const pos = safeGet(e, 'tmpPos');
          const hp = safeGet(e, 'hp');
          if (pos && hp > 0) {
            const dx = pos.x - roleX, dy = pos.y - roleY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            enemyData.push({ id: i, x: pos.x, y: pos.y, hp, dist, rotation: safeGet(e, 'rotation') || 0 });
          }
        } catch(e) {}
      }

      let nearest = null, nearestDist = Infinity;
      for (const e of enemyData) {
        if (e.dist < nearestDist) { nearestDist = e.dist; nearest = e; }
      }

      // Retreat check
      const hpPct = roleHP / roleMaxHP;
      let shouldRetreat = false;
      if (enemyData.length >= 3 && hpPct < 0.6) shouldRetreat = true;
      else if (enemyData.length === 2 && hpPct < 0.45) shouldRetreat = true;
      else if (enemyData.length === 1 && hpPct < 0.3) shouldRetreat = true;

      let keyToPress = null;
      let shouldFire = false;
      let action = 'idle';

      if (shouldRetreat && nearest) {
        const dx = roleX - nearest.x, dy = roleY - nearest.y;
        const retreatAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        let angleDiff = ((retreatAngle - roleRot + 540) % 360) - 180;
        if (Math.abs(angleDiff) > 15) {
          keyToPress = angleDiff > 0 ? 'd' : 'a';
          action = `retreat-turn (aDiff=${Math.round(angleDiff)})`;
        } else {
          keyToPress = 'w';
          action = 'retreat-drive';
        }
      } else if (nearest) {
        const dx = nearest.x - roleX, dy = nearest.y - roleY;
        const targetAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        let angleDiff = ((targetAngle - roleRot + 540) % 360) - 180;

        // Commit to turn
        if (commitTargetId === nearest.id && commitTicks < 8) {
          commitTicks++;
        } else {
          commitTargetId = nearest.id;
          commitTicks = 0;
        }

        if (Math.abs(angleDiff) > 10) {
          keyToPress = angleDiff > 0 ? 'd' : 'a';
          action = `aim-turn (aDiff=${Math.round(angleDiff)}, d=${Math.round(nearestDist)})`;
        } else {
          if (strafeHoldTicks <= 0) {
            strafeDir = -strafeDir;
            strafeHoldTicks = 2 + Math.floor(Math.random() * 3);
          }
          strafeHoldTicks--;
          const canFire = (tickNum - lastFireTick) >= 2;
          if (canFire && nearestDist < 800) {
            shouldFire = true;
            action = `FIRE+STRAFE (d=${Math.round(nearestDist)})`;
          } else {
            keyToPress = strafeDir > 0 ? 'a' : 'd';
            action = `strafe (d=${Math.round(nearestDist)})`;
          }
        }
      }

      if (keyToPress) {
        const keyMap = { w: { key: 'w', code: 'KeyW', keyCode: 87 }, a: { key: 'a', code: 'KeyA', keyCode: 65 }, s: { key: 's', code: 'KeyS', keyCode: 83 }, d: { key: 'd', code: 'KeyD', keyCode: 68 } };
        const k = keyMap[keyToPress];
        const evt = new KeyboardEvent('keydown', { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true });
        canvas.dispatchEvent(evt);
        if (typeof mission.onKeyDown === 'function') mission.onKeyDown(evt);
      }
      if (shouldFire) {
        if (typeof role.fire === 'function') role.fire();
      }

      return {
        hp: roleHP, kills: 0, enemyCount: enemyData.length,
        nearestDist: nearestDist, action, fired: shouldFire,
        strafeDir, strafeHoldTicks, commitTargetId, commitTicks
      };
    }, { tickNum: tick, strafeDir, strafeHoldTicks, commitTargetId: commitTarget, commitTicks, lastFireTick });

    if (result.error) break;

    // Update state
    if (result.fired) { lastFireTick = tick; bulletsFired++; }
    strafeDir = result.strafeDir;
    strafeHoldTicks = result.strafeHoldTicks;
    commitTarget = result.commitTargetId;
    commitTicks = result.commitTicks;

    if (tick % 20 === 0) {
      console.log(`Tick ${tick}: HP=${result.hp?.toFixed(0)} enemies=${result.enemyCount} action=${result.action}`);
    }

    await page.waitForTimeout(350);

    // Release keys
    await page.evaluate(() => {
      const canvas = window.__canvas;
      if (!canvas) return;
      for (const key of ['w', 'a', 's', 'd']) {
        const evt = new KeyboardEvent('keyup', { key, code: 'Key' + key.toUpperCase(), keyCode: key.charCodeAt(0), which: key.charCodeAt(0), bubbles: true, cancelable: true });
        canvas.dispatchEvent(evt);
      }
    });
  }

  console.log(`\n=== TOTAL KILLS: ${kills} ===`);
  console.log(`=== DEATHS: ${deaths} ===`);
  console.log(`=== BULLETS FIRED: ${bulletsFired} ===`);

  await browser.close();
  console.log('Done. Video saved to', VIDEO_DIR);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

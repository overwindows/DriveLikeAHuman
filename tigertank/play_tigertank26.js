// play_tigertank26.js — Full autonomous play: find enemies via gScene.enemyArr, drive, fire
const { chromium } = require('/import/ml-sc-scratch1/chenw/CodeGuru/node_modules/playwright');

const GAME_URL = 'https://393088398809336751.playables.usercontent.goog/v/assets/index.html';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader']
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const consoleMsgs = [];
  const pageErrors = [];

  page.on('console', m => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => pageErrors.push(String(e)));

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

  console.log('Navigating...');
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000);

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

  // Setup: hide overlay, persistent bControl, store refs
  const setupResult = await page.evaluate(() => {
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
    for (const c of children) {
      mission = findType(c, 'ht');
      if (mission) break;
    }
    if (!mission) return { error: 'no mission' };

    const battleUI = safeGet(mission, 'battleUI');
    if (battleUI) {
      battleUI.visible = false;
      battleUI.alpha = 0;
      const kids = battleUI._children || battleUI.children || [];
      for (const k of kids) {
        if (k.constructor.name === 'Me' && k.width >= 1000) k.visible = false;
      }
    }
    const role = safeGet(mission, 'role');
    if (role) role.bControl = true;
    mission.bControl = true;
    setInterval(() => {
      try { if (role) role.bControl = true; mission.bControl = true; } catch(e) {}
    }, 100);

    const canvas = document.querySelector('canvas');
    if (canvas) { canvas.focus(); canvas.tabIndex = 0; }

    window.__mission = mission;
    window.__role = role;
    window.__canvas = canvas;

    return {
      rolePos: role ? { x: safeGet(role, 'tmpPos')?.x, y: safeGet(role, 'tmpPos')?.y } : null,
      roleHP: safeGet(role, 'hp'),
      gSceneKeys: Object.keys(safeGet(mission, 'gScene') || {}).slice(0, 40)
    };
  });
  console.log('SETUP:', JSON.stringify(setupResult, null, 2));

  await page.waitForTimeout(1000);

  // AUTONOMOUS PLAY LOOP
  console.log('\n=== AUTONOMOUS PLAY LOOP ===');
  let totalKills = 0;
  let lastEnemyCount = 0;

  for (let tick = 0; tick < 60; tick++) {
    const tickResult = await page.evaluate(() => {
      const mission = window.__mission;
      const role = window.__role;
      const canvas = window.__canvas;
      if (!mission || !role) return { error: 'no mission/role' };

      const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };

      // Get role position
      const rolePos = safeGet(role, 'tmpPos');
      const roleX = rolePos?.x || 0;
      const roleY = rolePos?.y || 0;
      const roleRot = safeGet(role, 'rotation') || 0;
      const roleHP = safeGet(role, 'hp');

      // Find enemies via gScene.enemyArr
      const gScene = safeGet(role, 'gScene') || safeGet(mission, 'gScene');
      let enemies = [];
      if (gScene) {
        const enemyArr = safeGet(gScene, 'enemyArr');
        if (Array.isArray(enemyArr)) enemies = enemyArr;
      }

      // Get enemy data
      const enemyData = [];
      for (const e of enemies) {
        try {
          const pos = safeGet(e, 'tmpPos');
          const hp = safeGet(e, 'hp');
          const type = e.constructor?.name;
          if (pos && hp > 0) {
            enemyData.push({ type, x: pos.x, y: pos.y, hp });
          }
        } catch(e) {}
      }

      // Find nearest
      let nearest = null;
      let nearestDist = Infinity;
      for (const e of enemyData) {
        const dx = e.x - roleX;
        const dy = e.y - roleY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = e;
        }
      }

      // Decide action
      let action = 'idle';
      let keyToPress = null;
      if (nearest) {
        const dx = nearest.x - roleX;
        const dy = nearest.y - roleY;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        let angleDiff = angle - roleRot;
        while (angleDiff > 180) angleDiff -= 360;
        while (angleDiff < -180) angleDiff += 360;

        if (nearestDist < 600) {
          // Close enough - fire
          action = `fire (dist=${Math.round(nearestDist)}, angleDiff=${Math.round(angleDiff)})`;
        } else if (Math.abs(angleDiff) > 20) {
          // Need to turn
          keyToPress = angleDiff > 0 ? 'd' : 'a';
          action = `turn ${angleDiff > 0 ? 'right' : 'left'} (angleDiff=${Math.round(angleDiff)})`;
        } else {
          // Drive forward
          keyToPress = 'w';
          action = `drive (dist=${Math.round(nearestDist)})`;
        }
      }

      // Execute action
      if (keyToPress) {
        const keyMap = { w: { key: 'w', code: 'KeyW', keyCode: 87 }, a: { key: 'a', code: 'KeyA', keyCode: 65 }, d: { key: 'd', code: 'KeyD', keyCode: 68 } };
        const k = keyMap[keyToPress];
        const evt = new KeyboardEvent('keydown', { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true });
        canvas.dispatchEvent(evt);
        if (typeof mission.onKeyDown === 'function') mission.onKeyDown(evt);
      } else if (action.startsWith('fire')) {
        if (typeof role.fire === 'function') role.fire();
      }

      return {
        rolePos: { x: Math.round(roleX), y: Math.round(roleY) },
        rotation: Math.round(roleRot),
        moveState: safeGet(role, 'moveState'),
        turnState: safeGet(role, 'turnState'),
        hp: roleHP,
        enemyCount: enemyData.length,
        nearest: nearest ? { type: nearest.type, x: Math.round(nearest.x), y: Math.round(nearest.y), hp: nearest.hp, dist: Math.round(nearestDist) } : null,
        action
      };
    });

    // Track kills
    if (tickResult.enemyCount !== undefined) {
      if (lastEnemyCount > tickResult.enemyCount) {
        totalKills += (lastEnemyCount - tickResult.enemyCount);
        console.log(`  >>> KILL! Total kills: ${totalKills}`);
      }
      lastEnemyCount = tickResult.enemyCount;
    }

    console.log(`Tick ${tick}: pos=(${tickResult.rolePos?.x},${tickResult.rolePos?.y}) rot=${tickResult.rotation} ms=${tickResult.moveState} ts=${tickResult.turnState} hp=${tickResult.hp} enemies=${tickResult.enemyCount} nearest=${tickResult.nearest ? `${tickResult.nearest.type}@(${tickResult.nearest.x},${tickResult.nearest.y}) hp=${tickResult.nearest.hp} d=${tickResult.nearest.dist}` : 'none'} action=${tickResult.action}`);

    // Release keys
    await page.evaluate(() => {
      const canvas = window.__canvas;
      const mission = window.__mission;
      for (const key of ['w', 'a', 'd']) {
        const code = key === 'w' ? 'KeyW' : key === 'a' ? 'KeyA' : 'KeyD';
        const keyCode = key === 'w' ? 87 : key === 'a' ? 65 : 68;
        const evt = new KeyboardEvent('keyup', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true });
        canvas.dispatchEvent(evt);
        if (typeof mission.onKeyUp === 'function') mission.onKeyUp(evt);
      }
    });

    await page.waitForTimeout(400);

    // Screenshot every 5 ticks
    if (tick % 5 === 0) {
      await page.screenshot({ path: `/tmp/tigertank_170_tick${tick}.png` });
    }
  }

  await page.screenshot({ path: '/tmp/tigertank_171_final.png' });

  console.log(`\n=== TOTAL KILLS: ${totalKills} ===`);
  console.log('\n=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

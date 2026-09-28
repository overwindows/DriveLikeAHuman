// play_tigertank24.js — Autonomous play: find enemies, drive toward them, fire
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

  // Setup: hide overlay, persistent bControl, focus canvas, store refs
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
    const results = [];
    const children = stage._children || stage.children || [];
    let mission = null;
    for (const c of children) {
      mission = findType(c, 'ht');
      if (mission) break;
    }
    if (!mission) return ['no mission'];

    const battleUI = safeGet(mission, 'battleUI');
    if (battleUI) {
      battleUI.visible = false;
      battleUI.alpha = 0;
      const kids = battleUI._children || battleUI.children || [];
      for (const k of kids) {
        if (k.constructor.name === 'Me' && k.width >= 1000) k.visible = false;
      }
      results.push('overlay hidden');
    }

    const role = safeGet(mission, 'role');
    if (role) {
      role.bControl = true;
      results.push('role.bControl=true');
    }
    mission.bControl = true;
    results.push('mission.bControl=true');

    setInterval(() => {
      try {
        if (role) role.bControl = true;
        mission.bControl = true;
      } catch(e) {}
    }, 100);

    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.focus();
      canvas.tabIndex = 0;
      results.push('canvas focused');
    }

    window.__mission = mission;
    window.__role = role;
    window.__canvas = canvas;

    // Explore mission structure to find enemies
    const explore = {};
    try {
      const keys = Object.keys(mission);
      explore.missionKeys = keys.slice(0, 50);
    } catch(e) { explore.missionKeys = `error: ${e.message}`; }

    try {
      const roleKeys = role ? Object.keys(role) : [];
      explore.roleKeys = roleKeys.slice(0, 80);
    } catch(e) { explore.roleKeys = `error: ${e.message}`; }

    // Look for arrays/collections that might contain enemies
    const collections = [];
    for (const key of Object.keys(mission)) {
      try {
        const val = mission[key];
        if (Array.isArray(val) && val.length > 0) {
          collections.push({ key, length: val.length, firstType: val[0]?.constructor?.name });
        } else if (val && typeof val === 'object' && val.constructor) {
          // Check if it has a children-like array
          const kids = val._children || val.children || val.list || val.arr;
          if (Array.isArray(kids) && kids.length > 0) {
            collections.push({ key: key + '._children', length: kids.length, firstType: kids[0]?.constructor?.name });
          }
        }
      } catch(e) {}
    }
    explore.collections = collections;

    results.push(JSON.stringify(explore).slice(0, 2000));
    return results;
  });
  console.log('SETUP:', JSON.stringify(setupResult, null, 2));

  await page.waitForTimeout(1000);

  // Now do autonomous play loop
  console.log('\n=== AUTONOMOUS PLAY LOOP ===');
  for (let tick = 0; tick < 30; tick++) {
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

      // Find enemies - look for arrays/collections in mission
      let enemies = [];
      const tryArrays = ['enemies', 'enemyList', 'targets', 'units', 'roles', 'actors', 'tanks', 'vehicles', 'aiList', 'npcList'];
      for (const key of tryArrays) {
        try {
          const arr = mission[key];
          if (Array.isArray(arr) && arr.length > 0) {
            enemies = arr;
            break;
          }
        } catch(e) {}
      }

      // Also search gScene
      if (enemies.length === 0) {
        try {
          const gScene = mission.gScene || mission.scene || mission.map;
          if (gScene) {
            for (const key of ['enemies', 'units', 'actors', 'roles', 'list', 'children']) {
              try {
                const arr = gScene[key];
                if (Array.isArray(arr) && arr.length > 0) {
                  enemies = arr;
                  break;
                }
              } catch(e) {}
            }
          }
        } catch(e) {}
      }

      // Get enemy positions
      const enemyData = [];
      for (const e of enemies.slice(0, 10)) {
        try {
          const pos = safeGet(e, 'tmpPos') || safeGet(e, 'pos') || safeGet(e, 'x') !== undefined ? { x: e.x, y: e.y } : null;
          const hp = safeGet(e, 'hp');
          const type = e.constructor?.name;
          if (pos) enemyData.push({ type, x: pos.x, y: pos.y, hp });
        } catch(e) {}
      }

      // Calculate distance to nearest enemy
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
      if (nearest) {
        const dx = nearest.x - roleX;
        const dy = nearest.y - roleY;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const roleRot = safeGet(role, 'rotation') || 0;
        let angleDiff = angle - roleRot;
        while (angleDiff > 180) angleDiff -= 360;
        while (angleDiff < -180) angleDiff += 360;

        if (nearestDist < 800) {
          // Close enough - fire
          action = `fire (dist=${Math.round(nearestDist)}, angleDiff=${Math.round(angleDiff)})`;
        } else if (Math.abs(angleDiff) > 15) {
          // Need to turn
          action = `turn ${angleDiff > 0 ? 'right' : 'left'} (angleDiff=${Math.round(angleDiff)})`;
        } else {
          // Drive forward
          action = `drive (dist=${Math.round(nearestDist)})`;
        }
      }

      // Execute action via canvas dispatch
      if (action.startsWith('drive')) {
        const evt = new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', keyCode: 87, which: 87, bubbles: true, cancelable: true });
        canvas.dispatchEvent(evt);
        if (typeof mission.onKeyDown === 'function') mission.onKeyDown(evt);
      } else if (action.startsWith('turn right')) {
        const evt = new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', keyCode: 68, which: 68, bubbles: true, cancelable: true });
        canvas.dispatchEvent(evt);
        if (typeof mission.onKeyDown === 'function') mission.onKeyDown(evt);
      } else if (action.startsWith('turn left')) {
        const evt = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, bubbles: true, cancelable: true });
        canvas.dispatchEvent(evt);
        if (typeof mission.onKeyDown === 'function') mission.onKeyDown(evt);
      } else if (action.startsWith('fire')) {
        if (typeof role.fire === 'function') role.fire();
      }

      return {
        tick: window.__tick || 0,
        rolePos: { x: Math.round(roleX), y: Math.round(roleY) },
        rotation: Math.round(safeGet(role, 'rotation') || 0),
        moveState: safeGet(role, 'moveState'),
        bControl: safeGet(role, 'bControl'),
        enemyCount: enemyData.length,
        nearest: nearest ? { type: nearest.type, x: Math.round(nearest.x), y: Math.round(nearest.y), hp: nearest.hp, dist: Math.round(nearestDist) } : null,
        action
      };
    });

    console.log(`Tick ${tick}:`, JSON.stringify(tickResult));

    // Release keys after a short hold
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

    await page.waitForTimeout(500);

    // Screenshot every 5 ticks
    if (tick % 5 === 0) {
      await page.screenshot({ path: `/tmp/tigertank_150_tick${tick}.png` });
    }
  }

  await page.screenshot({ path: '/tmp/tigertank_151_final.png' });

  console.log('\n=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

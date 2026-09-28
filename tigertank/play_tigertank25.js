// play_tigertank25.js — Deep exploration to find enemies via bEnemy property
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

  // Hide overlay, set bControl, explore deeply
  const exploreResult = await page.evaluate(() => {
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

    // Hide overlay
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

    window.__mission = mission;
    window.__role = role;
    window.__canvas = document.querySelector('canvas');

    // Deep exploration: find all objects with bEnemy=true
    const enemies = [];
    const allObjects = [];
    const visited = new WeakSet();

    function walk(node, depth=0, path='') {
      if (depth > 50 || !node || typeof node !== 'object') return;
      if (visited.has(node)) return;
      try { visited.add(node); } catch(e) { return; }

      const type = node.constructor?.name;
      const bEnemy = safeGet(node, 'bEnemy');
      const hp = safeGet(node, 'hp');
      const tmpPos = safeGet(node, 'tmpPos');
      const bRole = safeGet(node, 'bRole');

      if (bEnemy === true && tmpPos) {
        enemies.push({
          type, path,
          x: tmpPos.x, y: tmpPos.y,
          hp, bRole,
          rotation: safeGet(node, 'rotation') || safeGet(node, '_rotation')
        });
      }

      // Collect interesting objects
      if (type && (type === 'o' || type === 'ot' || type === 'nt' || type === 'st' || type === 'i' || type === 'it')) {
        allObjects.push({ type, path, depth, hasChildren: (node._children || node.children || []).length });
      }

      const kids = node._children || node.children || [];
      for (const k of kids) {
        walk(k, depth+1, path + '/' + type);
      }
    }

    walk(mission, 0, 'mission');

    // Also explore gScene specifically
    const gScene = safeGet(mission, 'gScene');
    let gSceneInfo = null;
    if (gScene) {
      gSceneInfo = {
        type: gScene.constructor.name,
        keys: Object.keys(gScene).slice(0, 80),
        childrenCount: (gScene._children || gScene.children || []).length,
        childrenTypes: (gScene._children || gScene.children || []).map(c => c.constructor.name)
      };
    }

    // Explore role's gScene reference
    let roleGScene = null;
    if (role) {
      roleGScene = safeGet(role, 'gScene');
      if (roleGScene) {
        roleGScene = {
          type: roleGScene.constructor.name,
          keys: Object.keys(roleGScene).slice(0, 80),
          childrenCount: (roleGScene._children || roleGScene.children || []).length,
          childrenTypes: (roleGScene._children || roleGScene.children || []).map(c => c.constructor.name)
        };
      }
    }

    return {
      enemies,
      enemyCount: enemies.length,
      allObjects: allObjects.slice(0, 50),
      gSceneInfo,
      roleGScene,
      rolePos: role ? { x: safeGet(role, 'tmpPos')?.x, y: safeGet(role, 'tmpPos')?.y } : null
    };
  });

  console.log('EXPLORE RESULT:', JSON.stringify(exploreResult, null, 2));

  await page.screenshot({ path: '/tmp/tigertank_160_explore.png' });

  console.log('\n=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

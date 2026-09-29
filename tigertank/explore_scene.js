// explore_scene.js — Interactive scene graph explorer
// Usage: node explore_scene.js
//
// This script launches the game, waits for it to load, and dumps the full
// scene graph structure to help you understand what objects are available
// and what properties they have. Use this when adding new heuristics.

const { chromium } = require('playwright');

const GAME_URL = 'https://393088398809336751.playables.usercontent.goog/v/assets/index.html';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader']
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  page.on('console', m => console.log(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => console.log(`[ERROR] ${e}`));

  // Mock game API
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

  console.log('Navigating to game...');
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000);

  console.log('Triggering game start...');
  await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth = 0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth + 1); if (r) return r; }
      return null;
    }
    const children = stage._children || stage.children || [];
    for (const c of children) {
      const dt = findType(c, 'dt');
      if (dt) { dt.onStartGame(); return; }
    }
  });
  await page.waitForTimeout(3000);

  console.log('\n=== EXPLORING SCENE GRAPH ===\n');

  const exploration = await page.evaluate(() => {
    const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };
    const stage = window.Laya.stage;
    const children = stage._children || stage.children || [];

    function findType(node, typeName, depth = 0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth + 1); if (r) return r; }
      return null;
    }

    let mission = null;
    for (const c of children) {
      mission = findType(c, 'ht');
      if (mission) break;
    }
    if (!mission) return { error: 'no mission found' };

    const role = safeGet(mission, 'role');
    const gScene = safeGet(role, 'gScene') || safeGet(mission, 'gScene');

    // Dump mission keys
    const missionKeys = Object.keys(mission);
    const missionMethods = missionKeys.filter(k => typeof mission[k] === 'function');
    const missionProps = missionKeys.filter(k => typeof mission[k] !== 'function');

    // Dump role keys
    const roleKeys = role ? Object.keys(role) : [];
    const roleMethods = roleKeys.filter(k => typeof role[k] === 'function');
    const roleProps = roleKeys.filter(k => typeof role[k] !== 'function');

    // Dump gScene arrays
    const gSceneArrays = {};
    if (gScene) {
      for (const key of Object.keys(gScene)) {
        const val = gScene[key];
        if (Array.isArray(val)) {
          gSceneArrays[key] = {
            length: val.length,
            types: [...new Set(val.map(o => o?.constructor?.name).filter(Boolean))]
          };
        }
      }
    }

    // Dump role properties with values
    const roleState = {};
    if (role) {
      for (const key of ['hp', 'maxHP', 'rotation', 'moveState', 'turnState', 'bControl', 'bRole', 'bEnemy', 'speed', 'damage']) {
        try {
          const v = role[key];
          roleState[key] = typeof v === 'object' ? `[${v?.constructor?.name}]` : v;
        } catch(e) {
          roleState[key] = 'ERROR';
        }
      }
      const pos = safeGet(role, 'tmpPos');
      roleState.tmpPos = pos ? { x: pos.x, y: pos.y } : null;
    }

    // Sample enemy
    let enemySample = null;
    if (gScene) {
      const enemyArr = safeGet(gScene, 'enemyArr');
      if (Array.isArray(enemyArr) && enemyArr.length > 0) {
        const e = enemyArr[0];
        const ePos = safeGet(e, 'tmpPos');
        enemySample = {
          type: e.constructor.name,
          hp: safeGet(e, 'hp'),
          rotation: safeGet(e, 'rotation'),
          pos: ePos ? { x: ePos.x, y: ePos.y } : null,
          keys: Object.keys(e).slice(0, 30)
        };
      }
    }

    return {
      mission: {
        keys: missionKeys.length,
        methods: missionMethods.length,
        methodNames: missionMethods.slice(0, 50),
        props: missionProps.slice(0, 30)
      },
      role: {
        keys: roleKeys.length,
        methods: roleMethods.length,
        methodNames: roleMethods.slice(0, 50),
        props: roleProps.slice(0, 30),
        state: roleState
      },
      gSceneArrays,
      enemySample
    };
  });

  console.log(JSON.stringify(exploration, null, 2));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

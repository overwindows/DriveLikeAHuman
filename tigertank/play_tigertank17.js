// play_tigertank17.js — Find loading screen as child of mission, get role methods
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

  // Find loading screen as child of mission, get role methods
  const inspect = await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const safeGet = (obj, key) => {
      try { return obj[key]; } catch(e) { return `[error: ${e.message}]`; }
    };
    const getMethodsSafe = (obj) => {
      try {
        const proto = Object.getPrototypeOf(obj);
        const methods = [];
        for (const k of Object.getOwnPropertyNames(proto)) {
          if (k === 'constructor') continue;
          try {
            if (typeof proto[k] === 'function') methods.push(k);
          } catch(e) {}
        }
        return methods;
      } catch(e) { return [`error: ${e.message}`]; }
    };

    const children = stage._children || stage.children || [];
    const result = { stageChildren: children.length, found: {} };
    for (const c of children) {
      const mission = findType(c, 'ht');
      if (mission) {
        result.found.mission = true;
        // List ALL children of mission with their types
        const missionKids = mission._children || mission.children || [];
        result.found.missionChildCount = missionKids.length;
        const childTypes = {};
        for (const k of missionKids) {
          const tn = k.constructor.name;
          if (!childTypes[tn]) childTypes[tn] = 0;
          childTypes[tn]++;
        }
        result.found.missionChildTypes = childTypes;
        // Get role methods safely
        const role = safeGet(mission, 'role');
        if (role) {
          result.found.roleMethods = getMethodsSafe(role);
          result.found.roleBControl = safeGet(role, 'bControl');
          result.found.roleBEnemy = safeGet(role, 'bEnemy');
          result.found.roleName = safeGet(role, 'name');
          result.found.roleHP = safeGet(role, 'hp');
          result.found.roleMaxHP = safeGet(role, 'maxHP');
          result.found.roleSpeed = safeGet(role, 'speed');
          result.found.roleMaxSpeed = safeGet(role, 'maxSpeed');
          result.found.roleMoveState = safeGet(role, 'moveState');
          result.found.roleTurnState = safeGet(role, 'turnState');
        }
        // Get battleUI methods
        const battleUI = safeGet(mission, 'battleUI');
        if (battleUI) {
          result.found.battleUIMethods = getMethodsSafe(battleUI);
        }
        // Get gScene methods
        const gScene = safeGet(mission, 'gScene');
        if (gScene) {
          result.found.gSceneMethods = getMethodsSafe(gScene);
        }
        // Get indicator methods
        const indicator = safeGet(mission, 'indicator');
        if (indicator) {
          result.found.indicatorMethods = getMethodsSafe(indicator);
        }
      }
    }
    return result;
  });
  console.log('INSPECT:', JSON.stringify(inspect, null, 2));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

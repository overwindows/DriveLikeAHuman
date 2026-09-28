// play_tigertank16.js — Deep inspect mission subsystems to find loading mechanism
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

  // Deep inspect mission subsystems
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
    const safeDescribe = (obj, depth=0) => {
      if (depth > 3) return '[deep]';
      if (obj === null || obj === undefined) return obj;
      if (typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return `[array len=${obj.length}]`;
      const result = {};
      for (const k of Object.keys(obj)) {
        if (k.startsWith('_')) continue;
        try {
          const v = obj[k];
          if (typeof v === 'function') result[k] = '[function]';
          else if (typeof v === 'object' && v !== null) result[k] = safeDescribe(v, depth+1);
          else result[k] = v;
        } catch(e) { result[k] = `[error]`; }
      }
      return result;
    };
    const getMethods = (obj) => {
      try {
        const proto = Object.getPrototypeOf(obj);
        const methods = [];
        for (const k of Object.getOwnPropertyNames(proto)) {
          if (typeof proto[k] === 'function' && k !== 'constructor') methods.push(k);
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
        // Inspect gScene (type 'it')
        const gScene = safeGet(mission, 'gScene');
        if (gScene) {
          result.found.gScene = {
            type: gScene.constructor.name,
            props: safeDescribe(gScene),
            methods: getMethods(gScene)
          };
        }
        // Inspect indicator (type 'Me')
        const indicator = safeGet(mission, 'indicator');
        if (indicator) {
          result.found.indicator = {
            type: indicator.constructor.name,
            props: safeDescribe(indicator),
            methods: getMethods(indicator)
          };
        }
        // Inspect battleUI (type 'bt')
        const battleUI = safeGet(mission, 'battleUI');
        if (battleUI) {
          result.found.battleUI = {
            type: battleUI.constructor.name,
            props: safeDescribe(battleUI),
            methods: getMethods(battleUI)
          };
        }
        // Inspect recTarget
        const recTarget = safeGet(mission, 'recTarget');
        if (recTarget) {
          result.found.recTarget = {
            type: recTarget.constructor.name,
            props: safeDescribe(recTarget),
            methods: getMethods(recTarget)
          };
        }
        // Inspect role
        const role = safeGet(mission, 'role');
        if (role) {
          result.found.role = {
            type: role.constructor.name,
            props: safeDescribe(role),
            methods: getMethods(role)
          };
        }
        // Inspect player
        const player = safeGet(mission, 'player');
        if (player) {
          result.found.player = {
            type: player.constructor.name,
            props: safeDescribe(player),
            methods: getMethods(player)
          };
        }
        // Inspect enemy
        const enemy = safeGet(mission, 'enemy');
        if (enemy) {
          result.found.enemy = {
            type: enemy.constructor.name,
            props: safeDescribe(enemy),
            methods: getMethods(enemy)
          };
        }
        // All mission props
        result.found.missionAllProps = safeDescribe(mission);
        result.found.missionMethods = getMethods(mission);
      }
    }
    return result;
  });
  console.log('INSPECT:', JSON.stringify(inspect, null, 2));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

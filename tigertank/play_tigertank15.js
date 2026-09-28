// play_tigertank15.js — Inspect mission methods and force load completion
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

  // Inspect mission methods and try calling onLoadEnd
  const missionInspect = await page.evaluate(() => {
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
      const mission = findType(c, 'ht');
      if (mission) {
        const result = { found: true };
        // Get mission methods safely
        try {
          const proto = Object.getPrototypeOf(mission);
          const protoMethods = [];
          for (const k of Object.getOwnPropertyNames(proto)) {
            if (typeof proto[k] === 'function' && k !== 'constructor') protoMethods.push(k);
          }
          result.missionMethods = protoMethods;
        } catch(e) { result.missionMethodsError = String(e); }
        // Get mission props
        const props = {};
        for (const k of Object.keys(mission)) {
          if (k.startsWith('_')) continue;
          try {
            const v = mission[k];
            if (typeof v === 'function') props[k] = '[function]';
            else if (typeof v === 'object' && v !== null) props[k] = Array.isArray(v) ? `[array len=${v.length}]` : `[object ${v.constructor?.name}]`;
            else props[k] = v;
          } catch(e) { props[k] = `[error]`; }
        }
        result.missionProps = props;
        return result;
      }
    }
    return { found: false };
  });
  console.log('MISSION INSPECT:', JSON.stringify(missionInspect, null, 2));

  // Try calling mission.onLoadEnd() to force completion
  const forceLoad = await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const children = stage._children || stage.children || [];
    const results = [];
    for (const c of children) {
      const mission = findType(c, 'ht');
      if (mission) {
        // Try calling onLoadEnd
        try {
          if (typeof mission.onLoadEnd === 'function') {
            mission.onLoadEnd();
            results.push('called mission.onLoadEnd()');
          }
        } catch(e) { results.push(`onLoadEnd error: ${e.message}`); }
        // Try calling init
        try {
          if (typeof mission.init === 'function') {
            mission.init();
            results.push('called mission.init()');
          }
        } catch(e) { results.push(`init error: ${e.message}`); }
        // Try setting bPause
        try {
          mission.bPause = false;
          results.push('set bPause=false');
        } catch(e) { results.push(`bPause error: ${e.message}`); }
        return { success: true, results };
      }
    }
    return { success: false, error: 'mission not found' };
  });
  console.log('FORCE LOAD:', JSON.stringify(forceLoad, null, 2));

  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/tigertank_100_after_mission_force.png' });

  // Check state after force
  const afterForce = await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const children = stage._children || stage.children || [];
    const result = { stageChildren: children.length, found: {} };
    for (const c of children) {
      const mission = findType(c, 'ht');
      if (mission) {
        result.found.mission = true;
        result.found.bPause = mission.bPause;
        result.found.hasPlayer = !!mission.player;
        result.found.hasEnemy = !!mission.enemy;
        result.found.hasRole = !!mission.role;
        if (mission.role) {
          result.found.roleBControl = mission.role.bControl;
          result.found.roleBEnemy = mission.role.bEnemy;
          result.found.roleName = mission.role.name;
        }
      }
    }
    return result;
  });
  console.log('AFTER FORCE:', JSON.stringify(afterForce, null, 2));

  console.log('\n=== CONSOLE (last 30) ===');
  consoleMsgs.slice(-30).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

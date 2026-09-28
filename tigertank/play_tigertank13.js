// play_tigertank13.js — Force loading completion and inspect role methods
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

  // Inspect loading screen (Tt) and find progress mechanism
  const loadingInfo = await page.evaluate(() => {
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
      const loading = findType(c, 'Tt');
      if (loading) {
        result.found.loading = true;
        const safeGet = (obj, key) => {
          try { return obj[key]; } catch(e) { return `[error: ${e.message}]`; }
        };
        const props = {};
        for (const k of Object.keys(loading)) {
          if (k.startsWith('_')) continue;
          try {
            const v = loading[k];
            if (typeof v === 'function') props[k] = '[function]';
            else if (typeof v === 'object' && v !== null) props[k] = Array.isArray(v) ? `[array len=${v.length}]` : `[object ${v.constructor?.name}]`;
            else props[k] = v;
          } catch(e) { props[k] = `[error]`; }
        }
        result.found.loadingProps = props;
        try {
          const proto = Object.getPrototypeOf(loading);
          const protoMethods = [];
          for (const k of Object.getOwnPropertyNames(proto)) {
            if (typeof proto[k] === 'function' && k !== 'constructor') protoMethods.push(k);
          }
          result.found.loadingMethods = protoMethods;
        } catch(e) { result.found.loadingMethodsError = String(e); }
      }
    }
    return result;
  });
  console.log('LOADING INFO:', JSON.stringify(loadingInfo, null, 2));

  // Try to force loading completion by setting progress to 100
  const forceResult = await page.evaluate(() => {
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
      const loading = findType(c, 'Tt');
      if (loading) {
        const results = [];
        // Try common progress property names
        for (const prop of ['progress', 'curProgress', 'loadProgress', 'percent', 'curPercent', 'value']) {
          try {
            if (loading[prop] !== undefined) {
              loading[prop] = 1;
              results.push(`set ${prop}=1`);
            }
          } catch(e) { results.push(`set ${prop} error: ${e.message}`); }
        }
        // Try calling methods
        for (const m of ['onLoadEnd', 'onComplete', 'onProgress', 'setProgress', 'finishLoad', 'complete']) {
          try {
            if (typeof loading[m] === 'function') {
              loading[m](1);
              results.push(`called ${m}(1)`);
            }
          } catch(e) { results.push(`call ${m} error: ${e.message}`); }
        }
        return { success: true, results };
      }
    }
    return { success: false, error: 'Tt not found' };
  });
  console.log('FORCE RESULT:', JSON.stringify(forceResult, null, 2));

  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/tigertank_90_after_force.png' });

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
      const loading = findType(c, 'Tt');
      const mission = findType(c, 'ht');
      if (loading) result.found.loading = true;
      if (mission) {
        result.found.mission = true;
        const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return `[error]`; } };
        result.found.missionProps = {
          bPause: safeGet(mission, 'bPause'),
          hasRole: !!safeGet(mission, 'role'),
          hasPlayer: !!safeGet(mission, 'player'),
          hasEnemy: !!safeGet(mission, 'enemy')
        };
        const role = safeGet(mission, 'role');
        if (role) {
          result.found.roleBControl = safeGet(role, 'bControl');
          result.found.roleBEnemy = safeGet(role, 'bEnemy');
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

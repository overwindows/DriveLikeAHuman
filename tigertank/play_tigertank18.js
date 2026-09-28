// play_tigertank18.js — Find loading screen anywhere in stage tree
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

  // Deep search entire stage tree for loading-related nodes
  const search = await page.evaluate(() => {
    const stage = window.Laya.stage;
    const safeGet = (obj, key) => {
      try { return obj[key]; } catch(e) { return null; }
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
      } catch(e) { return []; }
    };

    // Find all nodes with text containing "loading" or "load"
    const loadingNodes = [];
    const progressNodes = [];
    const allTypes = {};

    function walk(node, depth=0, path='') {
      if (depth > 30) return;
      if (!node) return;
      const tn = node.constructor.name;
      if (!allTypes[tn]) allTypes[tn] = { count: 0, maxDepth: 0 };
      allTypes[tn].count++;
      if (depth > allTypes[tn].maxDepth) allTypes[tn].maxDepth = depth;

      // Check for text content
      try {
        if (node.text && typeof node.text === 'string') {
          const t = node.text.toLowerCase();
          if (t.includes('load') || t.includes('initial') || t.includes('resource')) {
            loadingNodes.push({ type: tn, text: node.text, depth, path });
          }
        }
      } catch(e) {}

      // Check for progress properties
      try {
        for (const p of ['progress', 'curProgress', 'loadProgress', 'percent', 'curPercent', 'value', 'nProgress', 'loadPercent', 'loaded', 'total', 'count', 'remain']) {
          const v = safeGet(node, p);
          if (v !== null && v !== undefined && typeof v !== 'function' && typeof v !== 'object') {
            progressNodes.push({ type: tn, prop: p, value: v, depth, path });
          }
        }
      } catch(e) {}

      const kids = node._children || node.children || [];
      for (const k of kids) {
        walk(k, depth+1, path + '/' + tn);
      }
    }

    const children = stage._children || stage.children || [];
    for (const c of children) {
      walk(c, 0, '');
    }

    return {
      allTypes,
      loadingNodes: loadingNodes.slice(0, 30),
      progressNodes: progressNodes.slice(0, 30)
    };
  });
  console.log('SEARCH:', JSON.stringify(search, null, 2));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

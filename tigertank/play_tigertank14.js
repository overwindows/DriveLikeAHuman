// play_tigertank14.js — Deep search for loading screen and force completion
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

  // Deep search for loading screen with depth 30
  const deepSearch = await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findAllTypes(node, typeName, depth=0, maxDepth=30, results=[]) {
      if (depth > maxDepth) return results;
      if (node && node.constructor && node.constructor.name === typeName) {
        results.push({ node, depth, path: getPath(node) });
      }
      const kids = node._children || node.children || [];
      for (const k of kids) { findAllTypes(k, typeName, depth+1, maxDepth, results); }
      return results;
    }
    function getPath(node) {
      const path = [];
      let cur = node;
      while (cur && cur !== stage) {
        path.unshift(cur.constructor.name);
        cur = cur.parent || cur._parent;
      }
      return path.join(' > ');
    }
    const children = stage._children || stage.children || [];
    const result = { stageChildren: children.length, types: {} };
    // Find all unique constructor names in tree
    function collectTypes(node, depth=0, maxDepth=30, types={}) {
      if (depth > maxDepth) return types;
      if (node && node.constructor && node.constructor.name) {
        const name = node.constructor.name;
        if (!types[name]) types[name] = { count: 0, maxDepth: 0 };
        types[name].count++;
        if (depth > types[name].maxDepth) types[name].maxDepth = depth;
      }
      const kids = node._children || node.children || [];
      for (const k of kids) { collectTypes(k, depth+1, maxDepth, types); }
      return types;
    }
    for (const c of children) {
      const types = collectTypes(c);
      for (const [name, info] of Object.entries(types)) {
        if (!result.types[name]) result.types[name] = { count: 0, maxDepth: 0 };
        result.types[name].count += info.count;
        if (info.maxDepth > result.types[name].maxDepth) result.types[name].maxDepth = info.maxDepth;
      }
    }
    return result;
  });
  console.log('DEEP SEARCH:', JSON.stringify(deepSearch, null, 2));

  // Find loading screen by looking for any node with progress-related properties
  const loadingSearch = await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findByProp(node, propNames, depth=0, maxDepth=30, results=[]) {
      if (depth > maxDepth) return results;
      if (node) {
        for (const p of propNames) {
          try {
            if (node[p] !== undefined && typeof node[p] !== 'function') {
              results.push({ type: node.constructor.name, prop: p, value: node[p], depth });
              break;
            }
          } catch(e) {}
        }
      }
      const kids = node._children || node.children || [];
      for (const k of kids) { findByProp(k, propNames, depth+1, maxDepth, results); }
      return results;
    }
    const children = stage._children || stage.children || [];
    const result = [];
    for (const c of children) {
      const found = findByProp(c, ['progress', 'curProgress', 'loadProgress', 'percent', 'curPercent', 'value', 'nProgress', 'loadPercent']);
      result.push(...found);
    }
    return result;
  });
  console.log('LOADING SEARCH:', JSON.stringify(loadingSearch, null, 2));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

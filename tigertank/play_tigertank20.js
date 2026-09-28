// play_tigertank20.js — Find and hide loading overlay
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

  // Find all top-level nodes and their zOrder
  const topLevel = await page.evaluate(() => {
    const stage = window.Laya.stage;
    const children = stage._children || stage.children || [];
    const result = [];
    for (const c of children) {
      result.push({
        type: c.constructor.name,
        visible: c.visible,
        zOrder: c.zOrder,
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
        alpha: c.alpha,
        scaleX: c.scaleX,
        scaleY: c.scaleY
      });
    }
    return result;
  });
  console.log('TOP LEVEL:', JSON.stringify(topLevel, null, 2));

  // Find the loading overlay - it's likely a full-screen node on top
  // Search for nodes that cover the full screen (1280x800)
  const overlaySearch = await page.evaluate(() => {
    const stage = window.Laya.stage;
    const safeGet = (obj, key) => {
      try { return obj[key]; } catch(e) { return null; }
    };
    const results = [];

    function walk(node, depth=0, path='') {
      if (depth > 30) return;
      if (!node) return;
      try {
        const w = safeGet(node, 'width');
        const h = safeGet(node, 'height');
        const x = safeGet(node, 'x');
        const y = safeGet(node, 'y');
        const visible = safeGet(node, 'visible');
        const alpha = safeGet(node, 'alpha');
        const zOrder = safeGet(node, 'zOrder');

        // Check if this node covers most of the screen
        if (w && h && w >= 1000 && h >= 600 && visible !== false && alpha > 0) {
          results.push({
            type: node.constructor.name,
            width: w, height: h, x, y,
            visible, alpha, zOrder,
            depth, path,
            hasChildren: (node._children || node.children || []).length
          });
        }
      } catch(e) {}

      const kids = node._children || node.children || [];
      for (const k of kids) {
        walk(k, depth+1, path + '/' + node.constructor.name);
      }
    }

    const children = stage._children || stage.children || [];
    for (const c of children) {
      walk(c, 0, '');
    }
    return results;
  });
  console.log('OVERLAY SEARCH:', JSON.stringify(overlaySearch, null, 2));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

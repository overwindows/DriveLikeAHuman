// play_tigertank8.js — Bypass broken click handler by calling dt.onStartGame() directly
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
  await page.screenshot({ path: '/tmp/tigertank_50_garage.png' });

  // Find dt (GameUI) and call onStartGame directly
  const startResult = await page.evaluate(() => {
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
      if (dt) {
        try {
          dt.onStartGame();
          return { success: true, message: 'Called dt.onStartGame()' };
        } catch(e) {
          return { success: false, error: String(e) };
        }
      }
    }
    return { success: false, error: 'dt not found' };
  });
  console.log('START GAME:', JSON.stringify(startResult));

  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/tigertank_51_after_start.png' });

  // Check what's on stage now
  const stageState = await page.evaluate(() => {
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
      if (mission) result.found.mission = true;
    }
    return result;
  });
  console.log('STAGE STATE:', JSON.stringify(stageState));

  console.log('\n=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

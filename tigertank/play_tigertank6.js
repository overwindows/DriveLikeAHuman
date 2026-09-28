// play_tigertank6.js — Stub more APIs, capture console/network errors, try mouse.down/up sequence
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
  const failedRequests = [];

  page.on('console', m => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('requestfailed', r => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));

  // Stub gameApi with broader surface
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

  // Inject stubs BEFORE page scripts run
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
    // Force user-gesture flag
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  console.log('Navigating...');
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/tigertank_20_title.png' });

  // Probe canvas state
  const probe = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({
      w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight,
      hasGL: !!c.getContext('webgl') || !!c.getContext('webgl2')
    }));
    return { canvases, bodyText: document.body.innerText.slice(0, 200) };
  });
  console.log('PROBE:', JSON.stringify(probe));

  // Try mouse.down/up sequence at Play Game button (640, 450)
  console.log('Attempting mouse.down/up at (640, 450)...');
  await page.mouse.move(640, 450);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/tigertank_21_after_downup.png' });

  // Try Enter key
  console.log('Pressing Enter...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/tigertank_22_after_enter.png' });

  // Try Space
  console.log('Pressing Space...');
  await page.keyboard.press('Space');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/tigertank_23_after_space.png' });

  // Try clicking center of canvas with full click sequence
  console.log('Clicking (640, 500)...');
  await page.mouse.move(640, 500);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/tigertank_24_after_center.png' });

  console.log('\n=== CONSOLE (last 30) ===');
  consoleMsgs.slice(-30).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));
  console.log('\n=== FAILED REQUESTS ===');
  failedRequests.slice(0, 20).forEach(r => console.log(r));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

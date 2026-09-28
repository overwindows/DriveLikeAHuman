// play_tigertank11.js — Wait for loading to complete and inspect role/player
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

  // Trigger start game
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

  // Wait longer for loading to complete
  console.log('Waiting 30s for loading...');
  await page.waitForTimeout(30000);
  await page.screenshot({ path: '/tmp/tigertank_70_after_long_load.png' });

  // Inspect mission and role
  const inspect = await page.evaluate(() => {
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
        result.found.missionProps = {
          bPause: mission.bPause,
          totalNum: mission.totalNum,
          killNum: mission.killNum,
          hasRole: !!mission.role,
          hasGScene: !!mission.gScene,
          hasBattleUI: !!mission.battleUI,
          hasIndicator: !!mission.indicator
        };
        if (mission.role) {
          const role = mission.role;
          const roleProps = {};
          for (const k of Object.keys(role)) {
            if (k.startsWith('_')) continue;
            const v = role[k];
            if (typeof v === 'function') roleProps[k] = '[function]';
            else if (typeof v === 'object' && v !== null) roleProps[k] = Array.isArray(v) ? `[array len=${v.length}]` : '[object]';
            else roleProps[k] = v;
          }
          result.found.roleProps = roleProps;
          const proto = Object.getPrototypeOf(role);
          const protoMethods = [];
          for (const k of Object.getOwnPropertyNames(proto)) {
            if (typeof proto[k] === 'function' && k !== 'constructor') protoMethods.push(k);
          }
          result.found.roleMethods = protoMethods;
        }
      }
    }
    return result;
  });
  console.log('INSPECT:', JSON.stringify(inspect, null, 2));

  console.log('\n=== CONSOLE (last 30) ===');
  consoleMsgs.slice(-30).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

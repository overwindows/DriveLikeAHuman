// play_tigertank7.js — Click Battle button to start gameplay
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
  page.on('requestfailed', r => failedRequests.push(`${r.url().split('/').pop()} :: ${r.failure()?.errorText}`));

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
  await page.waitForTimeout(7000); // Wait for splash → garage transition
  await page.screenshot({ path: '/tmp/tigertank_40_garage.png' });

  // Find the Battle button position
  const battleBtn = await page.evaluate(() => {
    const stage = window.Laya.stage;
    const children = stage._children || stage.children || [];
    // Find dt (GameUI) in the tree
    function findGameUI(node) {
      if (node.constructor.name === 'dt') return node;
      const kids = node._children || node.children || [];
      for (const k of kids) {
        const r = findGameUI(k);
        if (r) return r;
      }
      return null;
    }
    let gameUI = null;
    for (const c of children) { gameUI = findGameUI(c); if (gameUI) break; }
    if (!gameUI) return { error: 'GameUI not found', stageChildren: children.length };

    // Find the Battle button (St type, large, at bottom center)
    const gameUIChildren = gameUI._children || gameUI.children || [];
    const buttons = gameUIChildren.filter(c => c.constructor.name === 'St').map(c => ({
      x: c.x, y: c.y, w: c.width, h: c.height,
      centerX: c.x + c.width/2, centerY: c.y + c.height/2
    }));

    return { gameUIPos: { x: gameUI.x, y: gameUI.y, w: gameUI.width, h: gameUI.height }, buttons };
  });
  console.log('BATTLE BTN:', JSON.stringify(battleBtn));

  // Click the Battle button (largest St button at bottom)
  if (battleBtn.buttons && battleBtn.buttons.length > 0) {
    // The Battle button is the largest one at the bottom
    const battle = battleBtn.buttons.sort((a, b) => b.w * b.h - a.w * a.h)[0];
    console.log(`Clicking Battle at (${battle.centerX}, ${battle.centerY})...`);
    await page.mouse.click(battle.centerX, battle.centerY);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/tigertank_41_after_battle_click.png' });

    // Check what's on stage now
    const afterClick = await page.evaluate(() => {
      const stage = window.Laya.stage;
      function findType(node, typeName, depth=0) {
        if (depth > 10) return null;
        if (node.constructor.name === typeName) return node;
        const kids = node._children || node.children || [];
        for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
        return null;
      }
      const children = stage._children || stage.children || [];
      const result = {};
      for (const c of children) {
        const loading = findType(c, 'Tt');
        const mission = findType(c, 'ht');
        if (loading) result.loadingFound = true;
        if (mission) result.missionFound = true;
      }
      result.stageChildren = children.length;
      return result;
    });
    console.log('AFTER CLICK:', JSON.stringify(afterClick));

    // Wait more for loading to complete
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/tigertank_42_gameplay.png' });

    // Check again
    const gameplay = await page.evaluate(() => {
      const stage = window.Laya.stage;
      function findType(node, typeName, depth=0) {
        if (depth > 10) return null;
        if (node.constructor.name === typeName) return node;
        const kids = node._children || node.children || [];
        for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
        return null;
      }
      const children = stage._children || stage.children || [];
      const result = {};
      for (const c of children) {
        const mission = findType(c, 'ht');
        if (mission) {
          result.missionFound = true;
          result.hasRole = !!mission.role;
          result.hasGScene = !!mission.gScene;
          result.bPause = mission.bPause;
        }
      }
      return result;
    });
    console.log('GAMEPLAY:', JSON.stringify(gameplay));
  }

  console.log('\n=== CONSOLE (last 15) ===');
  consoleMsgs.slice(-15).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));
  console.log('\n=== FAILED REQUESTS ===');
  failedRequests.slice(0, 10).forEach(r => console.log(r));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

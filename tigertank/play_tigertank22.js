// play_tigertank22.js — Hide overlay, set bControl, drive tank with WASD and fire
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

  // Hide loading overlay and set bControl=true
  await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const safeGet = (obj, key) => {
      try { return obj[key]; } catch(e) { return null; }
    };
    const children = stage._children || stage.children || [];
    for (const c of children) {
      const mission = findType(c, 'ht');
      if (mission) {
        const battleUI = safeGet(mission, 'battleUI');
        if (battleUI) {
          battleUI.visible = false;
          battleUI.alpha = 0;
          const kids = battleUI._children || battleUI.children || [];
          for (const k of kids) {
            if (k.constructor.name === 'Me' && k.width >= 1000) k.visible = false;
          }
        }
        const role = safeGet(mission, 'role');
        if (role) role.bControl = true;
        mission.bControl = true;
      }
    }
  });
  console.log('Overlay hidden, bControl=true');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/tigertank_130_gameplay_start.png' });

  // Now drive the tank - try keyboard input via page.keyboard
  console.log('Driving forward (W)...');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: '/tmp/tigertank_131_after_w.png' });

  // Check position after W
  const posAfterW = await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const safeGet = (obj, key) => {
      try { return obj[key]; } catch(e) { return `[error]`; }
    };
    const children = stage._children || stage.children || [];
    for (const c of children) {
      const mission = findType(c, 'ht');
      if (mission) {
        const role = safeGet(mission, 'role');
        if (role) {
          return {
            tmpPos: safeGet(role, 'tmpPos'),
            moveState: safeGet(role, 'moveState'),
            turnState: safeGet(role, 'turnState'),
            rotation: safeGet(role, 'rotation'),
            oldRotation: safeGet(role, 'oldRotation'),
            bControl: safeGet(role, 'bControl')
          };
        }
      }
    }
    return null;
  });
  console.log('POS AFTER W:', JSON.stringify(posAfterW, null, 2));

  // Try turning with A
  console.log('Turning left (A)...');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyA');
  await page.screenshot({ path: '/tmp/tigertank_132_after_a.png' });

  // Try firing with J
  console.log('Firing (J)...');
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/tigertank_133_after_j.png' });

  // Also try calling role.fire() directly
  const fireResult = await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const safeGet = (obj, key) => {
      try { return obj[key]; } catch(e) { return null; }
    };
    const children = stage._children || stage.children || [];
    for (const c of children) {
      const mission = findType(c, 'ht');
      if (mission) {
        const role = safeGet(mission, 'role');
        if (role && typeof role.fire === 'function') {
          try { role.fire(); return 'fired'; } catch(e) { return `error: ${e.message}`; }
        }
      }
    }
    return 'no role';
  });
  console.log('FIRE RESULT:', fireResult);

  // Drive more
  console.log('Driving forward again (W)...');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: '/tmp/tigertank_134_driving.png' });

  // Final state
  const finalState = await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const safeGet = (obj, key) => {
      try { return obj[key]; } catch(e) { return `[error]`; }
    };
    const children = stage._children || stage.children || [];
    for (const c of children) {
      const mission = findType(c, 'ht');
      if (mission) {
        const role = safeGet(mission, 'role');
        if (role) {
          return {
            tmpPos: safeGet(role, 'tmpPos'),
            moveState: safeGet(role, 'moveState'),
            turnState: safeGet(role, 'turnState'),
            rotation: safeGet(role, 'rotation'),
            oldRotation: safeGet(role, 'oldRotation'),
            bControl: safeGet(role, 'bControl'),
            hp: safeGet(role, 'hp')
          };
        }
      }
    }
    return null;
  });
  console.log('FINAL STATE:', JSON.stringify(finalState, null, 2));

  console.log('\n=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

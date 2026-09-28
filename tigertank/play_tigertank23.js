// play_tigertank23.js — Dispatch keyboard events directly to canvas + persistent bControl
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

  // Hide overlay and set up persistent bControl + keyboard dispatch
  const setupResult = await page.evaluate(() => {
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
    const results = [];
    const children = stage._children || stage.children || [];
    let mission = null;
    for (const c of children) {
      mission = findType(c, 'ht');
      if (mission) break;
    }
    if (!mission) return ['no mission found'];

    // Hide loading overlay
    const battleUI = safeGet(mission, 'battleUI');
    if (battleUI) {
      battleUI.visible = false;
      battleUI.alpha = 0;
      const kids = battleUI._children || battleUI.children || [];
      for (const k of kids) {
        if (k.constructor.name === 'Me' && k.width >= 1000) k.visible = false;
      }
      results.push('overlay hidden');
    }

    // Set bControl=true on role and mission
    const role = safeGet(mission, 'role');
    if (role) {
      role.bControl = true;
      results.push('role.bControl=true');
    }
    mission.bControl = true;
    results.push('mission.bControl=true');

    // Keep bControl=true every 100ms
    setInterval(() => {
      try {
        if (role) role.bControl = true;
        mission.bControl = true;
      } catch(e) {}
    }, 100);
    results.push('bControl keeper started');

    // Find the canvas element
    const canvas = document.querySelector('canvas');
    if (canvas) {
      results.push(`canvas found: ${canvas.width}x${canvas.height}`);
      // Focus the canvas
      canvas.focus();
      canvas.tabIndex = 0;
      results.push('canvas focused');
    } else {
      results.push('no canvas found');
    }

    // Store mission reference for later use
    window.__mission = mission;
    window.__role = role;

    return results;
  });
  console.log('SETUP:', JSON.stringify(setupResult, null, 2));

  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/tigertank_140_setup.png' });

  // Get initial position
  const posBefore = await page.evaluate(() => {
    const role = window.__role;
    if (!role) return null;
    const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };
    return {
      tmpPos: safeGet(role, 'tmpPos'),
      moveState: safeGet(role, 'moveState'),
      turnState: safeGet(role, 'turnState'),
      rotation: safeGet(role, 'rotation'),
      bControl: safeGet(role, 'bControl')
    };
  });
  console.log('POS BEFORE:', JSON.stringify(posBefore, null, 2));

  // Try dispatching keyboard events directly to canvas
  console.log('Dispatching KeyW down to canvas...');
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const mission = window.__mission;

    // Method 1: Dispatch synthetic KeyboardEvent to canvas
    const evtDown = new KeyboardEvent('keydown', {
      key: 'w', code: 'KeyW', keyCode: 87, which: 87,
      bubbles: true, cancelable: true
    });
    canvas.dispatchEvent(evtDown);

    // Method 2: Also try calling mission.onKeyDown directly
    if (mission && typeof mission.onKeyDown === 'function') {
      try { mission.onKeyDown(evtDown); } catch(e) { console.log('onKeyDown error:', e.message); }
    }
  });
  await page.waitForTimeout(2000);

  // Check position after W
  const posAfterW = await page.evaluate(() => {
    const role = window.__role;
    if (!role) return null;
    const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };
    return {
      tmpPos: safeGet(role, 'tmpPos'),
      moveState: safeGet(role, 'moveState'),
      turnState: safeGet(role, 'turnState'),
      rotation: safeGet(role, 'rotation'),
      bControl: safeGet(role, 'bControl')
    };
  });
  console.log('POS AFTER W (canvas dispatch):', JSON.stringify(posAfterW, null, 2));

  // Release W
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const mission = window.__mission;
    const evtUp = new KeyboardEvent('keyup', {
      key: 'w', code: 'KeyW', keyCode: 87, which: 87,
      bubbles: true, cancelable: true
    });
    canvas.dispatchEvent(evtUp);
    if (mission && typeof mission.onKeyUp === 'function') {
      try { mission.onKeyUp(evtUp); } catch(e) {}
    }
  });

  // Try page.keyboard approach too
  console.log('Trying page.keyboard.down KeyW...');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');

  const posAfterPageKB = await page.evaluate(() => {
    const role = window.__role;
    if (!role) return null;
    const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };
    return {
      tmpPos: safeGet(role, 'tmpPos'),
      moveState: safeGet(role, 'moveState'),
      turnState: safeGet(role, 'turnState'),
      rotation: safeGet(role, 'rotation'),
      bControl: safeGet(role, 'bControl')
    };
  });
  console.log('POS AFTER page.keyboard W:', JSON.stringify(posAfterPageKB, null, 2));

  // Try calling mission.onKeyDown with string 'w'
  console.log('Trying mission.onKeyDown("w")...');
  await page.evaluate(() => {
    const mission = window.__mission;
    if (mission && typeof mission.onKeyDown === 'function') {
      try { mission.onKeyDown('w'); } catch(e) { console.log('onKeyDown(w) error:', e.message); }
    }
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const mission = window.__mission;
    if (mission && typeof mission.onKeyUp === 'function') {
      try { mission.onKeyUp('w'); } catch(e) {}
    }
  });

  const posAfterStrW = await page.evaluate(() => {
    const role = window.__role;
    if (!role) return null;
    const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };
    return {
      tmpPos: safeGet(role, 'tmpPos'),
      moveState: safeGet(role, 'moveState'),
      turnState: safeGet(role, 'turnState'),
      rotation: safeGet(role, 'rotation'),
      bControl: safeGet(role, 'bControl')
    };
  });
  console.log('POS AFTER mission.onKeyDown("w"):', JSON.stringify(posAfterStrW, null, 2));

  // Try calling role methods directly
  console.log('Trying role.moveTo(4000, 1500)...');
  await page.evaluate(() => {
    const role = window.__role;
    if (role && typeof role.moveTo === 'function') {
      try { role.moveTo(4000, 1500); } catch(e) { console.log('moveTo error:', e.message); }
    }
  });
  await page.waitForTimeout(3000);

  const posAfterMoveTo = await page.evaluate(() => {
    const role = window.__role;
    if (!role) return null;
    const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };
    return {
      tmpPos: safeGet(role, 'tmpPos'),
      moveState: safeGet(role, 'moveState'),
      turnState: safeGet(role, 'turnState'),
      rotation: safeGet(role, 'rotation'),
      bControl: safeGet(role, 'bControl')
    };
  });
  console.log('POS AFTER role.moveTo:', JSON.stringify(posAfterMoveTo, null, 2));

  // Try firing
  console.log('Firing...');
  await page.evaluate(() => {
    const role = window.__role;
    if (role && typeof role.fire === 'function') {
      try { role.fire(); } catch(e) { console.log('fire error:', e.message); }
    }
  });
  await page.waitForTimeout(1000);

  await page.screenshot({ path: '/tmp/tigertank_141_after_all_attempts.png' });

  console.log('\n=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

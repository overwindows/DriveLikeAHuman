// play_tigertank19.js — Force bControl=true and try driving the tank
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

  // Force bControl=true and try driving the tank
  const forceResult = await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const safeGet = (obj, key) => {
      try { return obj[key]; } catch(e) { return `[error: ${e.message}]`; }
    };
    const results = [];
    const children = stage._children || stage.children || [];
    for (const c of children) {
      const mission = findType(c, 'ht');
      if (mission) {
        const role = safeGet(mission, 'role');
        if (role) {
          // Force bControl=true
          try {
            role.bControl = true;
            results.push('set role.bControl=true');
          } catch(e) { results.push(`bControl error: ${e.message}`); }

          // Try calling role.fire()
          try {
            if (typeof role.fire === 'function') {
              role.fire();
              results.push('called role.fire()');
            }
          } catch(e) { results.push(`fire error: ${e.message}`); }

          // Try calling role.moveTo()
          try {
            if (typeof role.moveTo === 'function') {
              role.moveTo(3000, 3500);
              results.push('called role.moveTo(3000, 3500)');
            }
          } catch(e) { results.push(`moveTo error: ${e.message}`); }

          // Try calling role.changeState
          try {
            if (typeof role.changeState === 'function') {
              role.changeState(1);
              results.push('called role.changeState(1)');
            }
          } catch(e) { results.push(`changeState error: ${e.message}`); }

          // Try calling role.update
          try {
            if (typeof role.update === 'function') {
              role.update();
              results.push('called role.update()');
            }
          } catch(e) { results.push(`update error: ${e.message}`); }

          // Check role state after
          results.push(`role.bControl=${safeGet(role, 'bControl')}`);
          results.push(`role.moveState=${safeGet(role, 'moveState')}`);
          results.push(`role.turnState=${safeGet(role, 'turnState')}`);
        }

        // Also try calling mission.onKeyDown with W key
        try {
          if (typeof mission.onKeyDown === 'function') {
            mission.onKeyDown('KeyW');
            results.push('called mission.onKeyDown("KeyW")');
          }
        } catch(e) { results.push(`onKeyDown error: ${e.message}`); }

        // Try calling mission.onKeyUp
        try {
          if (typeof mission.onKeyUp === 'function') {
            mission.onKeyUp('KeyW');
            results.push('called mission.onKeyUp("KeyW")');
          }
        } catch(e) { results.push(`onKeyUp error: ${e.message}`); }
      }
    }
    return results;
  });
  console.log('FORCE RESULT:', JSON.stringify(forceResult, null, 2));

  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/tigertank_110_after_force_control.png' });

  // Check state after
  const afterState = await page.evaluate(() => {
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
    const result = {};
    for (const c of children) {
      const mission = findType(c, 'ht');
      if (mission) {
        const role = safeGet(mission, 'role');
        if (role) {
          result.roleBControl = safeGet(role, 'bControl');
          result.roleMoveState = safeGet(role, 'moveState');
          result.roleTurnState = safeGet(role, 'turnState');
          result.roleHP = safeGet(role, 'hp');
          result.roleTmpPos = safeGet(role, 'tmpPos');
        }
        result.missionBControl = safeGet(mission, 'bControl');
        result.missionBControl2 = safeGet(mission, 'bControl');
      }
    }
    return result;
  });
  console.log('AFTER STATE:', JSON.stringify(afterState, null, 2));

  console.log('\n=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

// play_tigertank21.js — Hide loading overlay and force bControl=true
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

  // Hide loading overlay and force bControl=true
  const hideResult = await page.evaluate(() => {
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
    const results = [];
    const children = stage._children || stage.children || [];
    for (const c of children) {
      const mission = findType(c, 'ht');
      if (mission) {
        // Find and hide the loading overlay nodes
        const battleUI = safeGet(mission, 'battleUI');
        if (battleUI) {
          try {
            battleUI.visible = false;
            results.push('set battleUI.visible=false');
          } catch(e) { results.push(`battleUI.visible error: ${e.message}`); }
          try {
            battleUI.alpha = 0;
            results.push('set battleUI.alpha=0');
          } catch(e) { results.push(`battleUI.alpha error: ${e.message}`); }
        }

        // Find the Me overlay child of battleUI
        const battleUIKids = (battleUI && (battleUI._children || battleUI.children || [])) || [];
        for (const k of battleUIKids) {
          if (k.constructor.name === 'Me' && k.width >= 1000) {
            try {
              k.visible = false;
              results.push('set Me overlay.visible=false');
            } catch(e) { results.push(`Me overlay.visible error: ${e.message}`); }
          }
        }

        // Force bControl=true on role
        const role = safeGet(mission, 'role');
        if (role) {
          try {
            role.bControl = true;
            results.push('set role.bControl=true');
          } catch(e) { results.push(`bControl error: ${e.message}`); }
        }

        // Also try setting mission.bControl if it exists
        try {
          mission.bControl = true;
          results.push('set mission.bControl=true');
        } catch(e) { results.push(`mission.bControl error: ${e.message}`); }
      }
    }
    return results;
  });
  console.log('HIDE RESULT:', JSON.stringify(hideResult, null, 2));

  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/tigertank_120_hidden_overlay.png' });

  // Check state
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
        const battleUI = safeGet(mission, 'battleUI');
        if (battleUI) {
          result.battleUIVisible = safeGet(battleUI, 'visible');
          result.battleUIAlpha = safeGet(battleUI, 'alpha');
        }
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

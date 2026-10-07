// play_tigertank31.js — Fix turn loop: use role.moveTo() for approach, wider aim threshold, commit-to-turn state
const { chromium } = require('/nvmedata/chenw/CodeGuru/node_modules/playwright');

const GAME_URL = 'https://393088398809336751.playables.usercontent.goog/v/assets/index.html';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
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

  const setupResult = await page.evaluate(() => {
    const stage = window.Laya.stage;
    function findType(node, typeName, depth=0) {
      if (depth > 10) return null;
      if (node.constructor.name === typeName) return node;
      const kids = node._children || node.children || [];
      for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
      return null;
    }
    const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };
    const children = stage._children || stage.children || [];
    let mission = null;
    for (const c of children) {
      mission = findType(c, 'ht');
      if (mission) break;
    }
    if (!mission) return { error: 'no mission' };

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
    setInterval(() => {
      try { if (role) role.bControl = true; mission.bControl = true; } catch(e) {}
    }, 200);

    const canvas = document.querySelector('canvas');
    if (canvas) { canvas.focus(); canvas.tabIndex = 0; }

    window.__mission = mission;
    window.__role = role;
    window.__canvas = canvas;

    // Check if role.moveTo exists
    const hasMoveTo = role && typeof role.moveTo === 'function';
    const roleMethods = role ? Object.keys(role).filter(k => typeof role[k] === 'function') : [];

    return {
      rolePos: role ? { x: safeGet(role, 'tmpPos')?.x, y: safeGet(role, 'tmpPos')?.y } : null,
      roleHP: safeGet(role, 'hp'),
      roleMaxHP: safeGet(role, 'maxHP'),
      hasMoveTo,
      roleMethodsCount: roleMethods.length,
      roleMethods: roleMethods.slice(0, 30)
    };
  });
  console.log('SETUP:', JSON.stringify(setupResult, null, 2));

  await page.waitForTimeout(1000);

  console.log('\n=== AUTONOMOUS PLAY LOOP v31 ===');
  let totalKills = 0;
  let lastEnemyHPs = {};
  let deathCount = 0;
  let respawnAttempts = 0;
  let strafeDir = 1;
  let commitTarget = null; // commit-to-turn state
  let commitTicks = 0;

  for (let tick = 0; tick < 200; tick++) {
    const tickResult = await page.evaluate((args) => {
      const { tickNum, strafeDir, commitTargetId, commitTicks } = args;
      const mission = window.__mission;
      const role = window.__role;
      const canvas = window.__canvas;
      if (!mission || !role) return { error: 'no mission/role' };

      const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };

      const rolePos = safeGet(role, 'tmpPos');
      const roleX = rolePos?.x || 0;
      const roleY = rolePos?.y || 0;
      const roleRot = safeGet(role, 'rotation') || 0;
      const roleHP = safeGet(role, 'hp');
      const roleMaxHP = safeGet(role, 'maxHP') || 180;

      const gScene = safeGet(role, 'gScene') || safeGet(mission, 'gScene');
      let enemies = [];
      if (gScene) {
        const enemyArr = safeGet(gScene, 'enemyArr');
        if (Array.isArray(enemyArr)) enemies = enemyArr;
      }

      const enemyData = [];
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        try {
          const pos = safeGet(e, 'tmpPos');
          const hp = safeGet(e, 'hp');
          if (pos && hp > 0) {
            enemyData.push({
              id: i, type: e.constructor?.name,
              x: pos.x, y: pos.y, hp,
              rotation: safeGet(e, 'rotation') || 0
            });
          }
        } catch(e) {}
      }

      // Find nearest, most wounded
      let nearest = null, nearestDist = Infinity;
      let mostWounded = null, lowestHPPct = 1;
      for (const e of enemyData) {
        const dx = e.x - roleX, dy = e.y - roleY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < nearestDist) { nearestDist = dist; nearest = e; }
        const pct = e.hp / 150;
        if (pct < lowestHPPct) { lowestHPPct = pct; mostWounded = e; }
      }

      // Pre-emptive dodge: count enemies facing us within 600px
      let facingCount = 0;
      let dodgeDir = null;
      let closestFacing = null, closestFacingDist = Infinity;
      for (const e of enemyData) {
        const dx = roleX - e.x, dy = roleY - e.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > 600) continue;
        const eRad = e.rotation * Math.PI / 180;
        const fwdX = Math.cos(eRad), fwdY = Math.sin(eRad);
        const dot = (fwdX * dx + fwdY * dy) / dist;
        if (dot > 0.5) {
          facingCount++;
          if (dist < closestFacingDist) {
            closestFacingDist = dist;
            closestFacing = { x: e.x, y: e.y, dx, dy, dist };
          }
        }
      }
      if (facingCount >= 1 && closestFacing) {
        const px = -closestFacing.dy, py = closestFacing.dx;
        const d1 = Math.sqrt((roleX + px*100 - closestFacing.x)**2 + (roleY + py*100 - closestFacing.y)**2);
        const d2 = Math.sqrt((roleX - px*100 - closestFacing.x)**2 + (roleY - py*100 - closestFacing.y)**2);
        dodgeDir = d1 > d2 ? 'right' : 'left';
      }

      // 8-direction safest retreat
      let safestDir = null;
      let safestScore = Infinity;
      const dirs = [];
      for (let i = 0; i < 8; i++) {
        const a = (i * 45) * Math.PI / 180;
        dirs.push({ dx: Math.cos(a), dy: Math.sin(a), name: ['E','NE','N','NW','W','SW','S','SE'][i] });
      }
      for (const d of dirs) {
        let score = 0;
        const projX = roleX + d.dx * 150;
        const projY = roleY + d.dy * 150;
        for (const e of enemyData) {
          const edx = projX - e.x, edy = projY - e.y;
          const ed = Math.sqrt(edx*edx + edy*edy);
          if (ed < 500) score += (500 - ed);
        }
        if (score < safestScore) { safestScore = score; safestDir = d; }
      }

      // Target selection
      const hpPct = roleHP / roleMaxHP;
      let target = null, targetDist = Infinity;
      if (hpPct < 0.60 && nearestDist < 900) {
        target = null; // retreat mode
      } else if (mostWounded && lowestHPPct < 0.5) {
        target = mostWounded;
        targetDist = Math.sqrt((target.x-roleX)**2 + (target.y-roleY)**2);
      } else if (nearest) {
        target = nearest;
        targetDist = nearestDist;
      }

      let action = 'idle';
      let keyToPress = null;
      let shouldFire = false;

      if (roleHP <= 0) {
        action = 'DEAD';
      } else if (dodgeDir && facingCount >= 2) {
        keyToPress = dodgeDir === 'left' ? 'a' : 'd';
        action = `DODGE-multi (${facingCount} facing, dist=${Math.round(closestFacingDist)})`;
      } else if (hpPct < 0.60 && nearest) {
        if (safestDir) {
          const angle = Math.atan2(safestDir.dy, safestDir.dx) * 180 / Math.PI;
          let angleDiff = angle - roleRot;
          while (angleDiff > 180) angleDiff -= 360;
          while (angleDiff < -180) angleDiff += 360;
          if (Math.abs(angleDiff) > 30) {
            keyToPress = angleDiff > 0 ? 'd' : 'a';
            action = `RETREAT-turn ${safestDir.name} (hp=${Math.round(hpPct*100)}%, score=${Math.round(safestScore)})`;
          } else {
            keyToPress = 'w';
            action = `RETREAT-drive ${safestDir.name} (hp=${Math.round(hpPct*100)}%, score=${Math.round(safestScore)})`;
          }
        }
      } else if (target) {
        const dx = target.x - roleX, dy = target.y - roleY;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        let angleDiff = angle - roleRot;
        while (angleDiff > 180) angleDiff -= 360;
        while (angleDiff < -180) angleDiff += 360;

        // Commit-to-turn: if we're already committed to this target, keep turning until within 5°
        const isCommitted = commitTargetId === target.id && commitTicks < 10;
        const turnThreshold = isCommitted ? 5 : 30;

        if (targetDist < 400) {
          keyToPress = Math.abs(angleDiff) > 30 ? (angleDiff > 0 ? 'd' : 'a') : 's';
          action = `back-up (d=${Math.round(targetDist)})`;
        } else if (targetDist > 550) {
          if (Math.abs(angleDiff) > turnThreshold) {
            keyToPress = angleDiff > 0 ? 'd' : 'a';
            action = `approach-turn${isCommitted ? '-committed' : ''} (d=${Math.round(targetDist)}, aDiff=${Math.round(angleDiff)})`;
          } else {
            keyToPress = 'w';
            action = `approach-drive (d=${Math.round(targetDist)})`;
          }
        } else {
          if (Math.abs(angleDiff) > 15) {
            keyToPress = angleDiff > 0 ? 'd' : 'a';
            action = `aim (aDiff=${Math.round(angleDiff)}, d=${Math.round(targetDist)})`;
          } else {
            shouldFire = true;
            keyToPress = strafeDir > 0 ? 'a' : 'd';
            action = `FIRE+STRAFE (d=${Math.round(targetDist)}, hp%=${Math.round(lowestHPPct*100)})`;
          }
        }
      }

      if (keyToPress) {
        const keyMap = { w: { key: 'w', code: 'KeyW', keyCode: 87 }, a: { key: 'a', code: 'KeyA', keyCode: 65 }, s: { key: 's', code: 'KeyS', keyCode: 83 }, d: { key: 'd', code: 'KeyD', keyCode: 68 } };
        const k = keyMap[keyToPress];
        const evt = new KeyboardEvent('keydown', { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true });
        canvas.dispatchEvent(evt);
        if (typeof mission.onKeyDown === 'function') mission.onKeyDown(evt);
      }
      if (shouldFire) {
        if (typeof role.fire === 'function') role.fire();
      }

      return {
        rolePos: { x: Math.round(roleX), y: Math.round(roleY) },
        rotation: Math.round(roleRot),
        moveState: safeGet(role, 'moveState'),
        turnState: safeGet(role, 'turnState'),
        hp: roleHP,
        maxHP: roleMaxHP,
        hpPct: Math.round(hpPct * 100),
        enemyCount: enemyData.length,
        bulletCount: 0,
        enemies: enemyData.map(e => ({ id: e.id, hp: Math.round(e.hp), dist: Math.round(Math.sqrt((e.x-roleX)**2 + (e.y-roleY)**2)) })),
        facingCount,
        dodgeDir,
        safestDir: safestDir ? safestDir.name : null,
        safestScore: Math.round(safestScore),
        target: target ? { id: target.id, hp: Math.round(target.hp), dist: Math.round(targetDist) } : null,
        action
      };
    }, { tickNum: tick, strafeDir, commitTargetId: commitTarget, commitTicks });

    if (tickResult.error) { console.log(`Tick ${tick}: ERROR`); break; }

    // Update commit-to-turn state
    if (tickResult.action && tickResult.action.includes('approach-turn-committed')) {
      commitTicks++;
    } else if (tickResult.target) {
      commitTarget = tickResult.target.id;
      commitTicks = 0;
    } else {
      commitTarget = null;
      commitTicks = 0;
    }

    if (tickResult.hp !== undefined && tickResult.hp <= 0) {
      deathCount++;
      respawnAttempts++;
      if (respawnAttempts === 3 || respawnAttempts === 8 || respawnAttempts === 20 || respawnAttempts === 40 || respawnAttempts === 70) {
        console.log(`Tick ${tick}: DEAD ${respawnAttempts} ticks - trying respawn`);
        await page.evaluate(() => {
          const canvas = window.__canvas;
          const mission = window.__mission;
          const stage = window.Laya?.stage;
          let buttonSprite = null;
          const visited = new WeakSet();
          function walk(node, depth) {
            if (depth > 8 || !node || typeof node !== 'object') return;
            if (visited.has(node)) return;
            try { visited.add(node); } catch(e) { return; }
            const text = String(node.text || node._text || '');
            const name = String(node.name || node._name || '');
            if (/TAP|CONTINUE|RESTART|RESPAWN|RETRY|PLAY/i.test(text) || /TAP|CONTINUE|RESTART|RESPAWN|RETRY|PLAY/i.test(name)) {
              buttonSprite = node;
              return;
            }
            const kids = node._children || node.children || [];
            for (const k of kids) walk(k, depth + 1);
          }
          if (stage) walk(stage, 0);
          if (buttonSprite) {
            if (typeof buttonSprite.onClick === 'function') buttonSprite.onClick();
          }
          const rect = canvas.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          for (const type of ['mousedown', 'mouseup', 'click']) {
            canvas.dispatchEvent(new MouseEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, button: 0 }));
          }
          for (const key of [' ', 'Enter', 'r', 'R']) {
            const code = key === ' ' ? 'Space' : key === 'Enter' ? 'Enter' : 'Key' + key.toUpperCase();
            const keyCode = key === ' ' ? 32 : key === 'Enter' ? 13 : key.charCodeAt(0);
            const evt = new KeyboardEvent('keydown', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true });
            canvas.dispatchEvent(evt);
            if (typeof mission.onKeyDown === 'function') mission.onKeyDown(evt);
          }
        });
      }
      if (respawnAttempts > 120) {
        console.log(`Tick ${tick}: DEAD too long, ending run`);
        break;
      }
    } else {
      respawnAttempts = 0;
    }

    const currentIds = new Set(tickResult.enemies.map(e => e.id));
    for (const prevId of Object.keys(lastEnemyHPs)) {
      if (!currentIds.has(parseInt(prevId))) {
        totalKills++;
        console.log(`  >>> KILL! Enemy ${prevId} eliminated. Total kills: ${totalKills}`);
        delete lastEnemyHPs[prevId];
      }
    }
    for (const e of tickResult.enemies) {
      lastEnemyHPs[e.id] = e.hp;
    }

    if (tick % 3 === 0 || tickResult.hpPct < 80 || tickResult.action.includes('RETREAT') || tickResult.action.includes('DODGE') || tickResult.facingCount > 0) {
      const enemySummary = tickResult.enemies.slice(0, 3).map(e => `#${e.id}:${e.hp}hp@${e.dist}`).join(' ');
      console.log(`Tick ${tick}: pos=(${tickResult.rolePos.x},${tickResult.rolePos.y}) rot=${tickResult.rotation} hp=${tickResult.hp}/${tickResult.maxHP}(${tickResult.hpPct}%) ms=${tickResult.moveState} ts=${tickResult.turnState} enemies=[${enemySummary}] facing=${tickResult.facingCount} safest=${tickResult.safestDir}(${tickResult.safestScore}) action=${tickResult.action}`);
    }

    await page.evaluate(() => {
      const canvas = window.__canvas;
      const mission = window.__mission;
      for (const key of ['w', 'a', 's', 'd']) {
        const code = key === 'w' ? 'KeyW' : key === 'a' ? 'KeyA' : key === 's' ? 'KeyS' : 'KeyD';
        const keyCode = key === 'w' ? 87 : key === 'a' ? 65 : key === 's' ? 83 : 68;
        const evt = new KeyboardEvent('keyup', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true });
        canvas.dispatchEvent(evt);
        if (typeof mission.onKeyUp === 'function') mission.onKeyUp(evt);
      }
    });

    strafeDir = -strafeDir;

    await page.waitForTimeout(350);

    if (tick % 20 === 0) {
      await page.screenshot({ path: `/tmp/tigertank_310_tick${tick}.png` });
    }
  }

  await page.screenshot({ path: '/tmp/tigertank_311_final.png' });

  console.log(`\n=== TOTAL KILLS: ${totalKills} ===`);
  console.log(`=== DEATHS: ${deathCount} ===`);
  console.log('\n=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

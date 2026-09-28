// play_tigertank27.js — Enhanced autonomous play: dodging, respawn, turret aim, HP-based kills
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

  // Setup + deep exploration
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
    }, 100);

    const canvas = document.querySelector('canvas');
    if (canvas) { canvas.focus(); canvas.tabIndex = 0; }

    window.__mission = mission;
    window.__role = role;
    window.__canvas = canvas;

    // Deep exploration: find turret, bullet, respawn properties
    const roleKeys = role ? Object.keys(role) : [];
    const turretKeys = roleKeys.filter(k => /turret|tower|gun|barrel|cannon/i.test(k));
    const moveKeys = roleKeys.filter(k => /move|speed|vel|dir|rot|turn|fire|bullet|hp|control|state/i.test(k));

    // Explore gScene
    const gScene = safeGet(role, 'gScene') || safeGet(mission, 'gScene');
    let gSceneKeys = [];
    let bulletSample = null;
    let enemySample = null;
    if (gScene) {
      gSceneKeys = Object.keys(gScene);
      const bulletArr = safeGet(gScene, 'bulletArr');
      if (Array.isArray(bulletArr) && bulletArr.length > 0) {
        const b = bulletArr[0];
        bulletSample = {
          type: b.constructor.name,
          keys: Object.keys(b),
          tmpPos: safeGet(b, 'tmpPos'),
          rotation: safeGet(b, 'rotation'),
          speed: safeGet(b, 'speed'),
          vel: safeGet(b, 'vel'),
          vx: safeGet(b, 'vx'),
          vy: safeGet(b, 'vy'),
          owner: safeGet(b, 'owner')?.constructor?.name,
          bEnemy: safeGet(b, 'bEnemy'),
          bRole: safeGet(b, 'bRole')
        };
      }
      const enemyArr = safeGet(gScene, 'enemyArr');
      if (Array.isArray(enemyArr) && enemyArr.length > 0) {
        const e = enemyArr[0];
        enemySample = {
          type: e.constructor.name,
          keys: Object.keys(e).slice(0, 60),
          rotation: safeGet(e, 'rotation'),
          turretRotation: safeGet(e, 'turretRotation'),
          towerRotation: safeGet(e, 'towerRotation'),
          gunRotation: safeGet(e, 'gunRotation'),
          barrelRotation: safeGet(e, 'barrelRotation'),
          cannonRotation: safeGet(e, 'cannonRotation')
        };
      }
    }

    // Look for respawn / death methods
    const missionKeys = Object.keys(mission);
    const respawnKeys = missionKeys.filter(k => /respawn|revive|spawn|restart|reset|dead|death/i.test(k));
    const roleMethods = roleKeys.filter(k => typeof role[k] === 'function');

    return {
      rolePos: role ? { x: safeGet(role, 'tmpPos')?.x, y: safeGet(role, 'tmpPos')?.y } : null,
      roleHP: safeGet(role, 'hp'),
      roleKeysCount: roleKeys.length,
      turretKeys,
      moveKeys: moveKeys.slice(0, 30),
      gSceneKeys: gSceneKeys.slice(0, 60),
      bulletSample,
      enemySample,
      respawnKeys,
      roleMethodsCount: roleMethods.length,
      roleMethods: roleMethods.slice(0, 40)
    };
  });
  console.log('SETUP+EXPLORE:', JSON.stringify(setupResult, null, 2));

  await page.waitForTimeout(1000);

  // AUTONOMOUS PLAY LOOP v27
  console.log('\n=== AUTONOMOUS PLAY LOOP v27 ===');
  let totalKills = 0;
  let lastEnemyHPs = {}; // track enemy id -> hp for kill detection
  let enemyIdCounter = 0;
  let lastEnemyList = [];
  let deathCount = 0;
  let respawnWaitTicks = 0;

  for (let tick = 0; tick < 120; tick++) {
    const tickResult = await page.evaluate(() => {
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
      const roleMaxHP = safeGet(role, 'maxHp') || safeGet(role, 'hpMax') || 180;

      // Find turret rotation
      const turretRot = safeGet(role, 'turretRotation') ?? safeGet(role, 'towerRotation') ?? safeGet(role, 'gunRotation') ?? safeGet(role, 'barrelRotation') ?? safeGet(role, 'cannonRotation') ?? roleRot;

      // Get gScene
      const gScene = safeGet(role, 'gScene') || safeGet(mission, 'gScene');
      let enemies = [];
      let bullets = [];
      if (gScene) {
        const enemyArr = safeGet(gScene, 'enemyArr');
        if (Array.isArray(enemyArr)) enemies = enemyArr;
        const bulletArr = safeGet(gScene, 'bulletArr');
        if (Array.isArray(bulletArr)) bullets = bulletArr;
      }

      // Enemy data with stable IDs (use object reference as key)
      const enemyData = [];
      const enemyRefs = new Map();
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        try {
          const pos = safeGet(e, 'tmpPos');
          const hp = safeGet(e, 'hp');
          const type = e.constructor?.name;
          if (pos && hp > 0) {
            const id = i; // use index as stable id within tick
            enemyRefs.set(e, id);
            enemyData.push({ id, type, x: pos.x, y: pos.y, hp, rotation: safeGet(e, 'rotation') || 0, turretRotation: safeGet(e, 'turretRotation') || safeGet(e, 'towerRotation') || safeGet(e, 'gunRotation') || safeGet(e, 'rotation') || 0 });
          }
        } catch(e) {}
      }

      // Bullet data
      const bulletData = [];
      for (const b of bullets) {
        try {
          const pos = safeGet(b, 'tmpPos');
          if (!pos) continue;
          const bEnemy = safeGet(b, 'bEnemy');
          const bRole = safeGet(b, 'bRole');
          // velocity: try multiple property names
          const vx = safeGet(b, 'vx') ?? safeGet(b, 'velX') ?? safeGet(b, 'speedX');
          const vy = safeGet(b, 'vy') ?? safeGet(b, 'velY') ?? safeGet(b, 'speedY');
          const speed = safeGet(b, 'speed');
          const rot = safeGet(b, 'rotation');
          // If no vx/vy, compute from rotation+speed
          let bvX = vx, bvY = vy;
          if ((bvX === null || bvX === undefined) && rot !== null && speed) {
            bvX = Math.cos(rot * Math.PI / 180) * speed;
            bvY = Math.sin(rot * Math.PI / 180) * speed;
          }
          bulletData.push({ x: pos.x, y: pos.y, vx: bvX, vy: bvY, bEnemy, bRole, rot });
        } catch(e) {}
      }

      // Find nearest enemy
      let nearest = null;
      let nearestDist = Infinity;
      for (const e of enemyData) {
        const dx = e.x - roleX;
        const dy = e.y - roleY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = e;
        }
      }

      // Find most wounded enemy (lowest HP%)
      let mostWounded = null;
      let lowestHPPct = 1;
      for (const e of enemyData) {
        const pct = e.hp / 150; // enemy max hp ~150
        if (pct < lowestHPPct) {
          lowestHPPct = pct;
          mostWounded = e;
        }
      }

      // DODGE: find incoming bullets (bEnemy=true, heading toward us)
      let dodgeDir = null; // 'left' or 'right'
      let closestBullet = null;
      let closestBulletDist = Infinity;
      for (const b of bulletData) {
        if (!b.bEnemy) continue; // only dodge enemy bullets
        const dx = roleX - b.x;
        const dy = roleY - b.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > 500) continue; // too far to worry
        // Check if bullet is heading toward us
        if (b.vx !== null && b.vx !== undefined && b.vy !== null && b.vy !== undefined) {
          const bulletSpeed = Math.sqrt(b.vx*b.vx + b.vy*b.vy);
          if (bulletSpeed < 0.1) continue;
          // Dot product: positive means bullet moving toward us
          const dot = (b.vx * dx + b.vy * dy) / (bulletSpeed * dist);
          if (dot > 0.3 && dist < closestBulletDist) {
            closestBulletDist = dist;
            closestBullet = { ...b, dist, dot };
          }
        }
      }
      if (closestBullet) {
        // Dodge perpendicular to bullet direction
        const bx = closestBullet.vx, by = closestBullet.vy;
        // Perpendicular vectors: (-by, bx) and (by, -bx)
        // Pick the one that moves us away from bullet
        const perp1x = -by, perp1y = bx;
        const perp2x = by, perp2y = -bx;
        const dx1 = roleX + perp1x * 100 - roleX;
        const dy1 = roleY + perp1y * 100 - roleY;
        const dx2 = roleX + perp2x * 100 - roleX;
        const dy2 = roleY + perp2y * 100 - roleY;
        // Pick direction that increases distance from bullet origin
        const d1 = Math.sqrt((roleX + perp1x*100 - closestBullet.x)**2 + (roleY + perp1y*100 - closestBullet.y)**2);
        const d2 = Math.sqrt((roleX + perp2x*100 - closestBullet.x)**2 + (roleY + perp2y*100 - closestBullet.y)**2);
        dodgeDir = d1 > d2 ? 'right' : 'left';
      }

      // Decide target: prefer most wounded if <40% HP, else nearest
      let target = null;
      let targetDist = Infinity;
      if (mostWounded && lowestHPPct < 0.4) {
        target = mostWounded;
        targetDist = Math.sqrt((target.x-roleX)**2 + (target.y-roleY)**2);
      } else if (nearest) {
        target = nearest;
        targetDist = nearestDist;
      }

      // Decide action
      let action = 'idle';
      let keyToPress = null;
      let shouldFire = false;

      if (roleHP <= 0) {
        action = 'DEAD - waiting for respawn';
      } else if (dodgeDir) {
        // Priority 1: dodge incoming bullet
        keyToPress = dodgeDir === 'left' ? 'a' : 'd';
        action = `DODGE ${dodgeDir} (bullet dist=${Math.round(closestBulletDist)})`;
      } else if (target) {
        const dx = target.x - roleX;
        const dy = target.y - roleY;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        let angleDiff = angle - roleRot;
        while (angleDiff > 180) angleDiff -= 360;
        while (angleDiff < -180) angleDiff += 360;

        // Turret aim diff
        let turretAngleDiff = angle - turretRot;
        while (turretAngleDiff > 180) turretAngleDiff -= 360;
        while (turretAngleDiff < -180) turretAngleDiff += 360;

        // Optimal engagement range: 400-700
        if (targetDist < 300) {
          // Too close - back up while turning to face
          keyToPress = Math.abs(angleDiff) > 30 ? (angleDiff > 0 ? 'd' : 'a') : 's';
          action = `retreat (dist=${Math.round(targetDist)})`;
        } else if (targetDist > 900) {
          // Too far - approach
          if (Math.abs(angleDiff) > 20) {
            keyToPress = angleDiff > 0 ? 'd' : 'a';
            action = `approach-turn (d=${Math.round(targetDist)}, aDiff=${Math.round(angleDiff)})`;
          } else {
            keyToPress = 'w';
            action = `approach-drive (d=${Math.round(targetDist)})`;
          }
        } else {
          // Good range - aim and fire
          if (Math.abs(turretAngleDiff) > 15) {
            // Need to aim turret - if turret rotates with body, turn body
            keyToPress = turretAngleDiff > 0 ? 'd' : 'a';
            action = `aim (tDiff=${Math.round(turretAngleDiff)}, d=${Math.round(targetDist)})`;
          } else {
            // Turret aimed - fire
            shouldFire = true;
            action = `FIRE (d=${Math.round(targetDist)}, tDiff=${Math.round(turretAngleDiff)}, hp%=${Math.round(lowestHPPct*100)})`;
          }
        }
      }

      // Execute action
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
        turretRotation: Math.round(turretRot),
        moveState: safeGet(role, 'moveState'),
        turnState: safeGet(role, 'turnState'),
        hp: roleHP,
        maxHP: roleMaxHP,
        enemyCount: enemyData.length,
        bulletCount: bulletData.length,
        enemies: enemyData.map(e => ({ id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), hp: Math.round(e.hp), dist: Math.round(Math.sqrt((e.x-roleX)**2 + (e.y-roleY)**2)) })),
        incomingBullet: closestBullet ? { dist: Math.round(closestBulletDist), dot: closestBullet.dot.toFixed(2) } : null,
        target: target ? { id: target.id, hp: Math.round(target.hp), dist: Math.round(targetDist) } : null,
        action
      };
    });

    if (tickResult.error) {
      console.log(`Tick ${tick}: ERROR ${tickResult.error}`);
      break;
    }

    // Detect death
    if (tickResult.hp !== undefined && tickResult.hp <= 0) {
      deathCount++;
      respawnWaitTicks++;
      if (respawnWaitTicks > 30) {
        console.log(`Tick ${tick}: DEAD for ${respawnWaitTicks} ticks - trying to respawn`);
        // Try to trigger respawn by clicking or pressing key
        await page.evaluate(() => {
          const canvas = window.__canvas;
          const mission = window.__mission;
          // Try space/enter to respawn
          for (const key of [' ', 'Enter', 'r', 'R']) {
            const code = key === ' ' ? 'Space' : key === 'Enter' ? 'Enter' : 'Key' + key.toUpperCase();
            const keyCode = key === ' ' ? 32 : key === 'Enter' ? 13 : key.charCodeAt(0);
            const evt = new KeyboardEvent('keydown', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true });
            canvas.dispatchEvent(evt);
            if (typeof mission.onKeyDown === 'function') mission.onKeyDown(evt);
          }
        });
      }
    } else {
      respawnWaitTicks = 0;
    }

    // HP-based kill detection: track each enemy's HP, kill when it disappears or HP drops to 0
    const currentEnemyKeys = new Set(tickResult.enemies.map(e => `${e.id}-${e.x}-${e.y}`));
    for (const e of tickResult.enemies) {
      const key = `${e.id}`;
      if (lastEnemyHPs[key] !== undefined && lastEnemyHPs[key] > e.hp + 50) {
        // Big HP drop - likely we damaged them significantly
      }
      lastEnemyHPs[key] = e.hp;
    }
    // Detect kills: enemies that were in last list but not in current
    const currentIds = new Set(tickResult.enemies.map(e => e.id));
    for (const prevId of Object.keys(lastEnemyHPs)) {
      if (!currentIds.has(parseInt(prevId))) {
        totalKills++;
        console.log(`  >>> KILL! Enemy ${prevId} eliminated. Total kills: ${totalKills}`);
        delete lastEnemyHPs[prevId];
      }
    }

    // Log every 3 ticks or on important events
    if (tick % 3 === 0 || tickResult.incomingBullet || tickResult.hp !== undefined && tickResult.hp < 150) {
      const enemySummary = tickResult.enemies.slice(0, 3).map(e => `#${e.id}:${e.hp}hp@${e.dist}`).join(' ');
      console.log(`Tick ${tick}: pos=(${tickResult.rolePos.x},${tickResult.rolePos.y}) rot=${tickResult.rotation} tr=${tickResult.turretRotation} hp=${tickResult.hp}/${tickResult.maxHP} ms=${tickResult.moveState} ts=${tickResult.turnState} bullets=${tickResult.bulletCount} enemies=[${enemySummary}] dodge=${tickResult.incomingBullet ? `YES(${tickResult.incomingBullet.dist})` : 'no'} action=${tickResult.action}`);
    }

    // Release keys
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

    await page.waitForTimeout(350);

    // Screenshot every 10 ticks
    if (tick % 10 === 0) {
      await page.screenshot({ path: `/tmp/tigertank_180_tick${tick}.png` });
    }
  }

  await page.screenshot({ path: '/tmp/tigertank_181_final.png' });

  console.log(`\n=== TOTAL KILLS: ${totalKills} ===`);
  console.log(`=== DEATHS: ${deathCount} ===`);
  console.log('\n=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

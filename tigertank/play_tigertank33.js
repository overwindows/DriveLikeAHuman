// play_tigertank33.js — Optimized heuristic: bullet dodging, predictive aim, adaptive retreat, smart strafe
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

    return {
      rolePos: role ? { x: safeGet(role, 'tmpPos')?.x, y: safeGet(role, 'tmpPos')?.y } : null,
      roleHP: safeGet(role, 'hp'),
      roleMaxHP: safeGet(role, 'maxHP')
    };
  });
  console.log('SETUP:', JSON.stringify(setupResult, null, 2));

  await page.waitForTimeout(1000);

  console.log('\n=== AUTONOMOUS PLAY LOOP v33 ===');
  let totalKills = 0;
  let lastEnemyHPs = {};
  let deathCount = 0;
  let respawnAttempts = 0;
  let strafeDir = 1;
  let strafeHoldTicks = 0;
  let commitTarget = null;
  let commitTicks = 0;
  let commitRetreatDir = null;
  let commitRetreatTicks = 0;
  let lastFireTick = 0;
  let bulletsFired = 0;

  for (let tick = 0; tick < 200; tick++) {
    const tickResult = await page.evaluate((args) => {
      let { tickNum, strafeDir, strafeHoldTicks, commitTargetId, commitTicks, commitRetreatDirName, commitRetreatTicks, lastFireTick } = args;
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
      let bullets = [];
      if (gScene) {
        const enemyArr = safeGet(gScene, 'enemyArr');
        if (Array.isArray(enemyArr)) enemies = enemyArr;
        const objArr = safeGet(gScene, 'objArr');
        if (Array.isArray(objArr)) {
          for (const o of objArr) {
            const t = o?.constructor?.name;
            if (t === 'st' || t === 'nt' || t === 'bullet' || t === 'Bullet') {
              bullets.push(o);
            }
          }
        }
      }

      const enemyData = [];
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        try {
          const pos = safeGet(e, 'tmpPos');
          const hp = safeGet(e, 'hp');
          if (pos && hp > 0) {
            const dx = pos.x - roleX, dy = pos.y - roleY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const eRad = (safeGet(e, 'rotation') || 0) * Math.PI / 180;
            const fwdX = Math.cos(eRad), fwdY = Math.sin(eRad);
            const facingDot = dist > 0 ? (fwdX * (-dx) + fwdY * (-dy)) / dist : 0;
            enemyData.push({
              id: i, type: e.constructor?.name,
              x: pos.x, y: pos.y, hp,
              rotation: safeGet(e, 'rotation') || 0,
              dx, dy, dist, facingDot
            });
          }
        } catch(e) {}
      }

      // Bullet data with velocity estimation
      const bulletData = [];
      for (const b of bullets) {
        try {
          const pos = safeGet(b, 'tmpPos');
          if (!pos) continue;
          const bEnemy = safeGet(b, 'bEnemy');
          const vx = safeGet(b, 'vx');
          const vy = safeGet(b, 'vy');
          const speed = safeGet(b, 'speed');
          const rot = safeGet(b, 'rotation');
          let bvX = vx, bvY = vy;
          if ((bvX === null || bvX === undefined) && rot !== null && rot !== undefined && speed) {
            bvX = Math.cos(rot * Math.PI / 180) * speed;
            bvY = Math.sin(rot * Math.PI / 180) * speed;
          }
          bulletData.push({ x: pos.x, y: pos.y, vx: bvX, vy: bvY, bEnemy, rot });
        } catch(e) {}
      }

      // Find nearest, most wounded, lowest threat
      let nearest = null, nearestDist = Infinity;
      let mostWounded = null, lowestHPPct = 1;
      let highestThreat = null, highestThreatScore = -Infinity;
      for (const e of enemyData) {
        if (e.dist < nearestDist) { nearestDist = e.dist; nearest = e; }
        const pct = e.hp / 150;
        if (pct < lowestHPPct) { lowestHPPct = pct; mostWounded = e; }
        // Threat = close + facing us + high HP
        const threatScore = (e.facingDot > 0.3 ? 100 : 0) + (1000 - e.dist) / 10 + e.hp / 5;
        if (threatScore > highestThreatScore) { highestThreatScore = threatScore; highestThreat = e; }
      }

      // BULLET DODGING: find incoming bullets and dodge
      let bulletDodgeDir = null;
      let closestIncomingBullet = null, closestIncomingDist = Infinity;
      for (const b of bulletData) {
        if (!b.bEnemy) continue;
        const dx = roleX - b.x, dy = roleY - b.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > 350) continue;
        if (b.vx !== null && b.vx !== undefined && b.vy !== null && b.vy !== undefined) {
          const bulletSpeed = Math.sqrt(b.vx*b.vx + b.vy*b.vy);
          if (bulletSpeed < 0.1) continue;
          const dot = (b.vx * dx + b.vy * dy) / (bulletSpeed * dist);
          if (dot > 0.5 && dist < closestIncomingDist) {
            closestIncomingDist = dist;
            closestIncomingBullet = { ...b, dist, dot };
          }
        }
      }
      if (closestIncomingBullet) {
        const bx = closestIncomingBullet.vx, by = closestIncomingBullet.vy;
        const perp1x = -by, perp1y = bx;
        const perp2x = by, perp2y = -bx;
        const d1 = Math.sqrt((roleX + perp1x*100 - closestIncomingBullet.x)**2 + (roleY + perp1y*100 - closestIncomingBullet.y)**2);
        const d2 = Math.sqrt((roleX - perp2x*100 - closestIncomingBullet.x)**2 + (roleY - perp2y*100 - closestIncomingBullet.y)**2);
        bulletDodgeDir = d1 > d2 ? 'right' : 'left';
      }

      // Pre-emptive dodge: count enemies facing us within 600px
      let facingCount = 0;
      let dodgeDir = null;
      let closestFacing = null, closestFacingDist = Infinity;
      for (const e of enemyData) {
        if (e.dist > 600) continue;
        if (e.facingDot > 0.5) {
          facingCount++;
          if (e.dist < closestFacingDist) {
            closestFacingDist = e.dist;
            closestFacing = e;
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
          // Extra penalty if moving toward a facing enemy
          if (e.facingDot > 0.5 && ed < 400) score += 200;
        }
        if (score < safestScore) { safestScore = score; safestDir = d; }
      }

      // ADAPTIVE retreat threshold: lower when more enemies
      const hpPct = roleHP / roleMaxHP;
      const enemyCount = enemyData.length;
      let retreatThreshold = 0.50;
      if (enemyCount >= 4) retreatThreshold = 0.65;
      else if (enemyCount >= 3) retreatThreshold = 0.58;
      else if (enemyCount <= 1) retreatThreshold = 0.35;

      // Target selection: prefer highest threat if healthy, most wounded if low HP
      let target = null, targetDist = Infinity;
      if (hpPct < retreatThreshold && nearestDist < 900) {
        target = null; // retreat mode
      } else if (mostWounded && lowestHPPct < 0.4) {
        target = mostWounded;
        targetDist = Math.sqrt((target.x-roleX)**2 + (target.y-roleY)**2);
      } else if (highestThreat) {
        target = highestThreat;
        targetDist = Math.sqrt((target.x-roleX)**2 + (target.y-roleY)**2);
      } else if (nearest) {
        target = nearest;
        targetDist = nearestDist;
      }

      let action = 'idle';
      let keyToPress = null;
      let shouldFire = false;

      // Fire rate limit: max 1 bullet per 2 ticks
      const canFire = (tickNum - lastFireTick) >= 2;

      if (roleHP <= 0) {
        action = 'DEAD';
      } else if (bulletDodgeDir) {
        // PRIORITY 1: dodge incoming bullets
        keyToPress = bulletDodgeDir === 'left' ? 'a' : 'd';
        action = `BULLET-DODGE ${bulletDodgeDir} (dist=${Math.round(closestIncomingDist)})`;
      } else if (dodgeDir && facingCount >= 2) {
        keyToPress = dodgeDir === 'left' ? 'a' : 'd';
        action = `DODGE-multi (${facingCount} facing, dist=${Math.round(closestFacingDist)})`;
      } else if (hpPct < retreatThreshold && nearest) {
        // Retreat with commit-to-direction
        let retreatDir = safestDir;
        if (commitRetreatDirName && commitRetreatTicks < 15) {
          const committed = dirs.find(d => d.name === commitRetreatDirName);
          if (committed) retreatDir = committed;
        }
        if (retreatDir) {
          const angle = Math.atan2(retreatDir.dy, retreatDir.dx) * 180 / Math.PI;
          let angleDiff = angle - roleRot;
          while (angleDiff > 180) angleDiff -= 360;
          while (angleDiff < -180) angleDiff += 360;
          if (Math.abs(angleDiff) > 30) {
            keyToPress = angleDiff > 0 ? 'd' : 'a';
            action = `RETREAT-turn ${retreatDir.name} (hp=${Math.round(hpPct*100)}%, score=${Math.round(safestScore)})`;
          } else {
            keyToPress = 'w';
            action = `RETREAT-drive ${retreatDir.name} (hp=${Math.round(hpPct*100)}%, score=${Math.round(safestScore)})`;
          }
        }
      } else if (target) {
        // PREDICTIVE AIM: lead the target based on relative motion
        const dx = target.x - roleX, dy = target.y - roleY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        // Estimate target velocity from rotation (tanks move forward in facing direction)
        const targetSpeed = 2.5; // estimated tank speed
        const targetVx = Math.cos(target.rotation * Math.PI / 180) * targetSpeed;
        const targetVy = Math.sin(target.rotation * Math.PI / 180) * targetSpeed;
        // Time of flight estimate (bullet speed ~8 units/tick)
        const bulletSpeed = 8;
        const tof = dist / bulletSpeed;
        // Predict target position
        const predX = target.x + targetVx * tof;
        const predY = target.y + targetVy * tof;
        const angle = Math.atan2(predY - roleY, predX - roleX) * 180 / Math.PI;
        let angleDiff = angle - roleRot;
        while (angleDiff > 180) angleDiff -= 360;
        while (angleDiff < -180) angleDiff += 360;

        const isCommitted = commitTargetId === target.id && commitTicks < 10;
        const turnThreshold = isCommitted ? 5 : 30;

        if (targetDist < 350) {
          keyToPress = Math.abs(angleDiff) > 30 ? (angleDiff > 0 ? 'd' : 'a') : 's';
          action = `back-up (d=${Math.round(targetDist)})`;
        } else if (targetDist > 600) {
          if (Math.abs(angleDiff) > turnThreshold) {
            keyToPress = angleDiff > 0 ? 'd' : 'a';
            action = `approach-turn${isCommitted ? '-committed' : ''} (d=${Math.round(targetDist)}, aDiff=${Math.round(angleDiff)})`;
          } else {
            keyToPress = 'w';
            action = `approach-drive (d=${Math.round(targetDist)})`;
          }
        } else {
          if (Math.abs(angleDiff) > 12) {
            keyToPress = angleDiff > 0 ? 'd' : 'a';
            action = `aim (aDiff=${Math.round(angleDiff)}, d=${Math.round(targetDist)})`;
          } else {
            // SMART STRAFE: hold direction for 3-5 ticks before switching
            if (strafeHoldTicks <= 0) {
              strafeDir = -strafeDir;
              strafeHoldTicks = 3 + Math.floor(Math.random() * 3);
            }
            if (canFire) {
              shouldFire = true;
              action = `FIRE+STRAFE (d=${Math.round(targetDist)}, hp%=${Math.round(lowestHPPct*100)})`;
            } else {
              keyToPress = strafeDir > 0 ? 'a' : 'd';
              action = `STRAFE-only (cooldown, d=${Math.round(targetDist)})`;
            }
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
        bulletCount: bulletData.length,
        enemies: enemyData.map(e => ({ id: e.id, hp: Math.round(e.hp), dist: Math.round(e.dist), facing: e.facingDot.toFixed(2) })),
        facingCount,
        incomingBullet: closestIncomingBullet ? { dist: Math.round(closestIncomingDist) } : null,
        safestDir: safestDir ? safestDir.name : null,
        target: target ? { id: target.id, hp: Math.round(target.hp), dist: Math.round(targetDist) } : null,
        action,
        strafeDir,
        strafeHoldTicks,
        fired: shouldFire
      };
    }, { tickNum: tick, strafeDir, strafeHoldTicks, commitTargetId: commitTarget, commitTicks, commitRetreatDirName: commitRetreatDir, commitRetreatTicks, lastFireTick });

    if (tickResult.error) { console.log(`Tick ${tick}: ERROR`); break; }

    // Update state
    if (tickResult.fired) { lastFireTick = tick; bulletsFired++; }
    if (tickResult.strafeHoldTicks !== undefined) strafeHoldTicks = tickResult.strafeHoldTicks;
    if (tickResult.strafeDir !== undefined) strafeDir = tickResult.strafeDir;

    if (tickResult.action && tickResult.action.includes('approach-turn-committed')) {
      commitTicks++;
    } else if (tickResult.target) {
      commitTarget = tickResult.target.id;
      commitTicks = 0;
    } else {
      commitTarget = null;
      commitTicks = 0;
    }

    if (tickResult.action && tickResult.action.includes('RETREAT')) {
      if (commitRetreatDir === tickResult.safestDir) {
        commitRetreatTicks++;
      } else {
        commitRetreatDir = tickResult.safestDir;
        commitRetreatTicks = 0;
      }
    } else {
      commitRetreatDir = null;
      commitRetreatTicks = 0;
    }

    if (tickResult.hp !== undefined && tickResult.hp <= 0) {
      deathCount++;
      respawnAttempts++;
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

    if (tick % 3 === 0 || tickResult.hpPct < 80 || tickResult.action.includes('RETREAT') || tickResult.action.includes('DODGE') || tickResult.action.includes('BULLET') || tickResult.facingCount > 0) {
      const enemySummary = tickResult.enemies.slice(0, 3).map(e => `#${e.id}:${e.hp}hp@${e.dist}f${e.facing}`).join(' ');
      console.log(`Tick ${tick}: pos=(${tickResult.rolePos.x},${tickResult.rolePos.y}) rot=${tickResult.rotation} hp=${tickResult.hp}/${tickResult.maxHP}(${tickResult.hpPct}%) ms=${tickResult.moveState} ts=${tickResult.turnState} bullets=${tickResult.bulletCount} enemies=[${enemySummary}] facing=${tickResult.facingCount} incoming=${tickResult.incomingBullet ? `YES(${tickResult.incomingBullet.dist})` : 'no'} action=${tickResult.action}`);
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

    await page.waitForTimeout(350);

    if (tick % 20 === 0) {
      await page.screenshot({ path: `/tmp/tigertank_330_tick${tick}.png` });
    }
  }

  await page.screenshot({ path: '/tmp/tigertank_331_final.png' });

  console.log(`\n=== TOTAL KILLS: ${totalKills} ===`);
  console.log(`=== DEATHS: ${deathCount} ===`);
  console.log(`=== BULLETS FIRED: ${bulletsFired} ===`);
  console.log('\n=== CONSOLE (last 20) ===');
  consoleMsgs.slice(-20).forEach(m => console.log(m));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

"""State extractor for Tiger Tank game.

Injects a JavaScript function into the game page that reads the scene graph
and returns a 24-feature observation vector plus raw state for reward computation.
"""

# JavaScript function injected via page.evaluate()
# Returns: {obs: [40 floats], raw: {role: {...}, enemies: [...], ...}}
EXTRACT_STATE_JS = """
() => {
    const mission = window.__mission;
    const role = window.__role;
    if (!mission || !role) return {error: 'no mission/role'};

    const safeGet = (obj, key) => { try { return obj[key]; } catch(e) { return null; } };

    const rolePos = safeGet(role, 'tmpPos');
    const roleX = rolePos?.x || 0;
    const roleY = rolePos?.y || 0;
    const roleRot = safeGet(role, 'rotation') || 0;
    const roleHP = safeGet(role, 'hp');
    const roleMaxHP = safeGet(role, 'maxHP') || 180;
    const moveState = safeGet(role, 'moveState');
    const turnState = safeGet(role, 'turnState');

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
                const dx = pos.x - roleX;
                const dy = pos.y - roleY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                const eRad = (safeGet(e, 'rotation') || 0) * Math.PI / 180;
                const fwdX = Math.cos(eRad);
                const fwdY = Math.sin(eRad);
                const facingDot = dist > 0 ? (fwdX * (-dx) + fwdY * (-dy)) / dist : 0;
                enemyData.push({
                    id: i,
                    x: pos.x,
                    y: pos.y,
                    hp: hp,
                    rotation: safeGet(e, 'rotation') || 0,
                    dx: dx,
                    dy: dy,
                    dist: dist,
                    facingDot: facingDot
                });
            }
        } catch(e) {}
    }

    // Sort by distance (nearest first)
    enemyData.sort((a, b) => a.dist - b.dist);

    // Pad to 5 enemies
    while (enemyData.length < 5) {
        enemyData.push({id: -1, x: 0, y: 0, hp: 0, rotation: 0, dx: 0, dy: 0, dist: 0, facingDot: 0});
    }

    // Map boundaries (5120x5120 arena - read from tiledMap)
    const tiledMap = safeGet(gScene, 'tiledMap');
    const mapW = (tiledMap && tiledMap.mapWidth) ? tiledMap.mapWidth : 5120;
    const mapH = (tiledMap && tiledMap.mapHeight) ? tiledMap.mapHeight : 5120;

    // Build 40-feature observation vector
    // Normalize: positions / 2000, rotation / 180, hp / 180, dist / 1000
    const obs = [
        roleX / 2000.0,
        roleY / 2000.0,
        roleRot / 180.0,
        roleHP / 180.0,
        roleMaxHP / 180.0,
        (moveState || 0) / 1.0,
        (turnState || 0) / 1.0
    ];
    for (let i = 0; i < 5; i++) {
        const e = enemyData[i];
        obs.push(e.dx / 1000.0);
        obs.push(e.dy / 1000.0);
        obs.push(e.hp / 150.0);
        obs.push(e.rotation / 180.0);
        obs.push(e.facingDot);
    }

    // Boundary distances (4 features)
    obs.push(roleX / mapW);              // dist to left wall
    obs.push((mapW - roleX) / mapW);     // dist to right wall
    obs.push(roleY / mapH);              // dist to top wall
    obs.push((mapH - roleY) / mapH);     // dist to bottom wall

    // Nearby obstacles: friendly tanks and objects within 400px (12 features)
    const nearbyObstacles = [];
    const friendArr = safeGet(gScene, 'friendArr');
    if (Array.isArray(friendArr)) {
        for (const f of friendArr) {
            try {
                const fPos = safeGet(f, 'tmpPos');
                const fHp = safeGet(f, 'hp');
                if (fPos && fHp > 0) {
                    const dx = fPos.x - roleX;
                    const dy = fPos.y - roleY;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist < 400) {
                        nearbyObstacles.push({dx, dy, dist});
                    }
                }
            } catch(e) {}
        }
    }
    const objArr = safeGet(gScene, 'objArr');
    if (Array.isArray(objArr)) {
        for (const o of objArr) {
            try {
                const oPos = safeGet(o, 'tmpPos') || safeGet(o, '_pos');
                const oHp = safeGet(o, 'hp');
                if (oPos && (oHp === undefined || oHp > 0)) {
                    const dx = oPos.x - roleX;
                    const dy = oPos.y - roleY;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist < 400) {
                        nearbyObstacles.push({dx, dy, dist});
                    }
                }
            } catch(e) {}
        }
    }
    nearbyObstacles.sort((a, b) => a.dist - b.dist);

    // Add nearest 3 obstacles (12 features: dx, dy, dist, type_flag)
    for (let i = 0; i < 3; i++) {
        const ob = nearbyObstacles[i];
        if (ob) {
            obs.push(ob.dx / 400.0);
            obs.push(ob.dy / 400.0);
            obs.push(ob.dist / 400.0);
            obs.push(1.0);  // obstacle present flag
        } else {
            obs.push(0, 0, 1.0, 0);  // padding
        }
    }

    // Teammate positions: nearest 3 friends (12 features: dx, dy, dist, hp_ratio)
    // Encourages collaboration - tank should stay near teammates, not retreat alone
    const friendData = [];
    if (Array.isArray(friendArr)) {
        for (const f of friendArr) {
            try {
                const fPos = safeGet(f, 'tmpPos');
                const fHp = safeGet(f, 'hp');
                const fMaxHp = safeGet(f, 'maxHP') || 180;
                if (fPos && fHp > 0) {
                    const dx = fPos.x - roleX;
                    const dy = fPos.y - roleY;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    friendData.push({dx, dy, dist, hpRatio: fHp / fMaxHp});
                }
            } catch(e) {}
        }
    }
    friendData.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < 3; i++) {
        const fr = friendData[i];
        if (fr) {
            obs.push(fr.dx / 2000.0);
            obs.push(fr.dy / 2000.0);
            obs.push(fr.dist / 2000.0);
            obs.push(fr.hpRatio);
        } else {
            obs.push(0, 0, 1.0, 0);  // padding
        }
    }

    // Line-of-sight to nearest enemy (1 feature)
    let lineOfSight = 1.0;
    if (enemyData.length > 0 && enemyData[0].hp > 0) {
        const nearestEnemy = enemyData[0];
        const ex = nearestEnemy.x;
        const ey = nearestEnemy.y;
        if (Array.isArray(friendArr)) {
            for (const f of friendArr) {
                try {
                    const fPos = safeGet(f, 'tmpPos');
                    const fHp = safeGet(f, 'hp');
                    if (fPos && fHp > 0) {
                        const t = ((fPos.x - roleX) * (ex - roleX) + (fPos.y - roleY) * (ey - roleY)) /
                                  ((ex - roleX) * (ex - roleX) + (ey - roleY) * (ey - roleY));
                        if (t > 0.1 && t < 0.9) {
                            const projX = roleX + t * (ex - roleX);
                            const projY = roleY + t * (ey - roleY);
                            const perpDist = Math.sqrt((fPos.x - projX)**2 + (fPos.y - projY)**2);
                            if (perpDist < 100) {
                                lineOfSight = 0.0;
                                break;
                            }
                        }
                    }
                } catch(e) {}
            }
        }
    }
    obs.push(lineOfSight);

    // Facing count: enemies facing player within 600px
    let facingCount = 0;
    let closestFacingDist = 1000;
    for (const e of enemyData) {
        if (e.hp <= 0 || e.dist > 600) continue;
        if (e.facingDot > 0.5) {
            facingCount++;
            if (e.dist < closestFacingDist) closestFacingDist = e.dist;
        }
    }
    obs.push(facingCount / 5.0);
    obs.push(closestFacingDist / 1000.0);

    // Count my bullets (bEnemy=false means player bullet)
    let myBulletCount = 0;
    let enemyBulletCount = 0;
    const bulletArr = safeGet(gScene, 'bulletArr');
    if (Array.isArray(bulletArr)) {
        for (const b of bulletArr) {
            const bEnemy = safeGet(b, 'bEnemy');
            if (bEnemy === false) myBulletCount++;
            else if (bEnemy === true) enemyBulletCount++;
        }
    }
    obs.push(myBulletCount / 10.0);
    obs.push(enemyBulletCount / 10.0);

    // Enemy bullets heading toward player (for dodge behavior)
    const enemyBullets = [];
    if (Array.isArray(bulletArr)) {
        for (const b of bulletArr) {
            if (!safeGet(b, 'bEnemy')) continue;  // skip player bullets
            const bx = safeGet(b, 'x') || 0;
            const by = safeGet(b, 'y') || 0;
            const dx = bx - roleX;
            const dy = by - roleY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > 800) continue;  // only nearby bullets matter

            const bRot = safeGet(b, 'rotation') || 0;
            const bRad = bRot * Math.PI / 180;
            const bvx = Math.cos(bRad);
            const bvy = Math.sin(bRad);
            const toPlayerX = -dx;
            const toPlayerY = -dy;
            const headingDot = dist > 0 ? (bvx * toPlayerX + bvy * toPlayerY) / dist : 0;

            // Time to impact (approximate, bullet speed ~660 px/s)
            const tti = headingDot > 0.7 ? dist / 660 : 999;

            enemyBullets.push({dx, dy, dist, headingDot, tti});
        }
    }
    // Sort by time-to-impact (most urgent first)
    enemyBullets.sort((a, b) => a.tti - b.tti);

    // Add nearest 3 enemy bullets (15 features)
    for (let i = 0; i < 3; i++) {
        const b = enemyBullets[i];
        if (b) {
            obs.push(b.dx / 1000.0);
            obs.push(b.dy / 1000.0);
            obs.push(b.dist / 1000.0);
            obs.push(b.headingDot);
            obs.push(Math.min(b.tti, 2.0) / 2.0);
        } else {
            obs.push(0, 0, 1.0, 0, 1.0);  // padding
        }
    }

    // Total kills (player + team combined)
    const totalKills = safeGet(mission, 'killNum') || 0;

    // Check if any enemy has locked on to the player
    let enemyLocked = false;
    let enemyFireCDs = [];
    if (Array.isArray(enemies)) {
        for (const e of enemies) {
            const turret = safeGet(e, 'turret');
            if (turret) {
                const bLock = safeGet(turret, 'bLock');
                const fireCD = safeGet(turret, 'fireCD');
                if (bLock) enemyLocked = true;
                if (fireCD !== null && fireCD !== undefined) {
                    enemyFireCDs.push(Math.round(fireCD));
                }
            }
        }
    }

    return {
        obs: obs,
        raw: {
            role: {
                x: roleX, y: roleY, rotation: roleRot,
                hp: roleHP, maxHP: roleMaxHP,
                moveState: moveState, turnState: turnState
            },
            enemies: enemyData.slice(0, 5).map(e => ({
                id: e.id, x: e.x, y: e.y, hp: e.hp,
                rotation: e.rotation, dist: e.dist, facingDot: e.facingDot
            })),
            myBulletCount: myBulletCount,
            enemyBulletCount: enemyBulletCount,
            enemyBullets: enemyBullets.slice(0, 3),
            enemyLocked: enemyLocked,
            enemyFireCDs: enemyFireCDs,
            nearbyObstacles: nearbyObstacles.slice(0, 3),
            lineOfSight: lineOfSight,
            totalKills: totalKills,
            aliveFriends: friendArr ? friendArr.filter(f => f.hp > 0).length : 0,
            aliveEnemies: enemies ? enemies.filter(e => e.hp > 0).length : 0,
            friendHps: friendArr ? friendArr.map(f => ({id: f.id || 0, hp: f.hp || 0, maxHP: f.maxHP || 180})) : []
        }
    };
}
"""

# JavaScript function to dispatch a key event
DISPATCH_KEY_JS = """
(key, eventType) => {
    const canvas = window.__canvas;
    const mission = window.__mission;
    const keyMap = {
        'w': {key: 'w', code: 'KeyW', keyCode: 87},
        'a': {key: 'a', code: 'KeyA', keyCode: 65},
        's': {key: 's', code: 'KeyS', keyCode: 83},
        'd': {key: 'd', code: 'KeyD', keyCode: 68}
    };
    const k = keyMap[key];
    if (!k) return;
    const evt = new KeyboardEvent(eventType, {
        key: k.key, code: k.code, keyCode: k.keyCode,
        which: k.keyCode, bubbles: true, cancelable: true
    });
    canvas.dispatchEvent(evt);
    if (eventType === 'keydown' && typeof mission.onKeyDown === 'function') {
        mission.onKeyDown(evt);
    } else if (eventType === 'keyup' && typeof mission.onKeyUp === 'function') {
        mission.onKeyUp(evt);
    }
}
"""

# JavaScript function to fire
FIRE_JS = """
() => {
    const role = window.__role;
    if (role && typeof role.fire === 'function') {
        role.fire();
        return true;
    }
    return false;
}
"""

# JavaScript function to release all keys
RELEASE_ALL_KEYS_JS = """
() => {
    const canvas = window.__canvas;
    const mission = window.__mission;
    for (const key of ['w', 'a', 's', 'd']) {
        const code = key === 'w' ? 'KeyW' : key === 'a' ? 'KeyA' : key === 's' ? 'KeyS' : 'KeyD';
        const keyCode = key === 'w' ? 87 : key === 'a' ? 65 : key === 's' ? 83 : 68;
        const evt = new KeyboardEvent('keyup', {
            key: key, code: code, keyCode: keyCode,
            which: keyCode, bubbles: true, cancelable: true
        });
        canvas.dispatchEvent(evt);
        if (typeof mission.onKeyUp === 'function') mission.onKeyUp(evt);
    }
}
"""

# JavaScript function to setup the game (navigate, start, hide UI)
SETUP_GAME_JS = """
(showUI) => {
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
    if (!mission) return {error: 'no mission'};

    const battleUI = safeGet(mission, 'battleUI');
    if (battleUI) {
        if (!showUI) {
            battleUI.visible = false;
            battleUI.alpha = 0;
            const kids = battleUI._children || battleUI.children || [];
            for (const k of kids) {
                if (k.constructor.name === 'Me' && k.width >= 1000) k.visible = false;
            }
        } else {
            // Force-show radar and battleUI, then keep re-showing every 2s
            // (game may re-hide them during scene transitions)
            battleUI.visible = true;
            battleUI.alpha = 1;
            const kids = battleUI._children || battleUI.children || [];
            for (const k of kids) {
                if (k.constructor.name === 'Me' && k.width >= 1000) {
                    k.visible = true;
                    k.alpha = 1;
                }
            }
            setInterval(() => {
                try {
                    battleUI.visible = true;
                    battleUI.alpha = 1;
                    const ks = battleUI._children || battleUI.children || [];
                    for (const k of ks) {
                        if (k.constructor.name === 'Me' && k.width >= 1000) {
                            k.visible = true;
                            k.alpha = 1;
                        }
                    }
                } catch(e) {}
            }, 2000);
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
        rolePos: role ? {x: safeGet(role, 'tmpPos')?.x, y: safeGet(role, 'tmpPos')?.y} : null,
        roleHP: safeGet(role, 'hp'),
        roleMaxHP: safeGet(role, 'maxHP')
    };
}
"""

# JavaScript function to trigger start game
START_GAME_JS = """
() => {
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
        if (dt) { dt.onStartGame(); return true; }
    }
    return false;
}
"""

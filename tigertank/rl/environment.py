"""Gymnasium environment for Tiger Tank game.

Wraps a Playwright browser session as a Gymnasium env for RL training.
"""

import asyncio
import json
import os
import sqlite3
import time
from datetime import datetime
import numpy as np
from typing import Optional, Tuple, Dict, Any

try:
    import gymnasium as gym
    from gymnasium import spaces
except ImportError:
    import gym
    from gym import spaces

from playwright.sync_api import sync_playwright, Browser, Page, BrowserContext

from state_extractor import (
    EXTRACT_STATE_JS,
    DISPATCH_KEY_JS,
    FIRE_JS,
    RELEASE_ALL_KEYS_JS,
    SETUP_GAME_JS,
    START_GAME_JS,
)


GAME_URL = "https://393088398809336751.playables.usercontent.goog/v/assets/index.html"

# Action mapping: action index -> list of (key, event_type) or fire
# 18 actions: 10 movement-only + 8 move+fire combinations (strafe-while-firing)
ACTION_MAP = {
    0: [],  # no-op
    1: [('w', 'keydown')],  # forward
    2: [('a', 'keydown')],  # turn left
    3: [('s', 'keydown')],  # backward
    4: [('d', 'keydown')],  # turn right
    5: [('w', 'keydown'), ('a', 'keydown')],  # forward + left
    6: [('w', 'keydown'), ('d', 'keydown')],  # forward + right
    7: [('s', 'keydown'), ('a', 'keydown')],  # backward + left
    8: [('s', 'keydown'), ('d', 'keydown')],  # backward + right
    9: ["fire"],  # fire (stationary)
    # Move + fire combinations (strafe-while-firing)
    10: [('w', 'keydown'), "fire"],  # forward + fire
    11: [('a', 'keydown'), "fire"],  # turn left + fire
    12: [('s', 'keydown'), "fire"],  # backward + fire
    13: [('d', 'keydown'), "fire"],  # turn right + fire
    14: [('w', 'keydown'), ('a', 'keydown'), "fire"],  # forward + left + fire
    15: [('w', 'keydown'), ('d', 'keydown'), "fire"],  # forward + right + fire
    16: [('s', 'keydown'), ('a', 'keydown'), "fire"],  # backward + left + fire
    17: [('s', 'keydown'), ('d', 'keydown'), "fire"],  # backward + right + fire
}


class TigerTankEnv(gym.Env):
    """Gymnasium environment for Tiger Tank game."""

    metadata = {"render_modes": []}

    def __init__(
        self,
        headless: bool = True,
        max_ticks: int = 200,
        tick_ms: int = 350,
        chrome_path: Optional[str] = None,
        rank: int = 0,
        record_video: bool = False,
        video_dir: str = "./videos",
        show_ui: bool = False,
    ):
        super().__init__()

        self.observation_space = spaces.Box(
            low=-1.0, high=1.0, shape=(80,), dtype=np.float32
        )
        self.action_space = spaces.Discrete(18)

        self._headless = headless
        self._max_ticks = max_ticks
        self._tick_ms = tick_ms
        self._chrome_path = chrome_path
        self._rank = rank
        self._record_video = record_video
        self._video_dir = video_dir
        self._show_ui = show_ui

        # SQLite logging (inspired by scenario.py pattern)
        self._db_path = None
        self._db_conn = None

        # Playwright state
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._ctx: Optional[BrowserContext] = None
        self._page: Optional[Page] = None

        if chrome_path is None:
            chrome_path = self._find_browser()

        # Episode state
        self._tick_count = 0
        self._prev_hp = 180
        self._prev_enemy_hps: Dict[int, float] = {}
        self._total_kills = 0
        self._my_kills = 0  # kills attributed to player (not team)
        self._total_damage_dealt = 0.0
        self._bullets_fired = 0
        self._episode_reward = 0.0
        self._episode_id = 0
        self._prev_my_bullet_count = 0
        self._prev_total_kills = 0
        self._stuck_counter = 0
        self._prev_pos_for_stuck = None
        self._friendly_damage_dealt = 0.0

    @staticmethod
    def _find_browser():
        """Locate an installed Chromium-family executable across OSes."""
        import shutil, os
        candidates = [
            os.environ.get("CHROME_PATH"),
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ]
        for c in candidates:
            if c and os.path.exists(c):
                return c
        # Fall back to shutil resolution
        for name in ("google-chrome", "chromium", "chromium-browser", "msedge", "chrome"):
            p = shutil.which(name)
            if p:
                return p
        raise RuntimeError("No Chromium-family browser found. Set CHROME_PATH.")

    def _launch_browser(self):
        """Launch Playwright browser and navigate to game."""
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(
            executable_path=self._chrome_path,
            headless=self._headless,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=swiftshader",
            ],
        )
        ctx_kwargs = {"viewport": {"width": 1280, "height": 720}}
        if self._record_video:
            os.makedirs(self._video_dir, exist_ok=True)
            ctx_kwargs["record_video_dir"] = self._video_dir
            ctx_kwargs["record_video_size"] = {"width": 1280, "height": 720}
        self._ctx = self._browser.new_context(**ctx_kwargs)
        self._page = self._ctx.new_page()

        # Mock YouTube Playables API
        self._page.add_init_script("""
            const noop = () => {};
            const makePromise = (val) => Promise.resolve(val);
            window.gameApi = {
                audioControl: (cfg) => makePromise({audioControl: cfg || {mute: false, volume: 1}}),
                saveData: (d) => makePromise({saveData: {data: d?.data || '{}', updatedAt: Date.now()}}),
                loadData: () => makePromise({loadData: {data: '{}'}}),
                playerInfo: () => makePromise({playerInfo: {id: 'p1', name: 'Player'}}),
                adState: () => makePromise({adState: {available: false}}),
                environment: () => makePromise({environment: {platform: 'WEB', locale: 'en-US'}}),
                onAudioFocus: noop, onVisibilityChange: noop, onPause: noop, onResume: noop,
                showAd: () => makePromise({adShown: false}),
                logEvent: noop, reportError: noop
            };
            window.YT = window.YT || {Game: {onReady: noop, save: noop, load: noop}};
        """)

        # Mock game_api network calls
        def handle_route(route):
            url = route.request.url
            body = "{}"
            if "audioControl" in url:
                body = '{"audioControl": {"mute": false, "volume": 1}}'
            elif "saveData" in url:
                body = '{"saveData": {"data": "{}", "updatedAt": 0}}'
            elif "loadData" in url:
                body = '{"loadData": {"data": "{}"}}'
            elif "playerInfo" in url:
                body = '{"playerInfo": {"id": "p1", "name": "Player"}}'
            elif "adState" in url:
                body = '{"adState": {"available": false}}'
            elif "environment" in url:
                body = '{"environment": {"platform": "WEB", "locale": "en-US"}}'
            route.fulfill(status=200, content_type="application/json", body=body)

        self._page.route("**/game_api/v1*", handle_route)

    def _navigate_and_start(self):
        """Navigate to game and trigger start."""
        # Use reload to ensure fresh page load (goto on same URL may not reload)
        try:
            self._page.goto(GAME_URL, wait_until="domcontentloaded", timeout=30000)
        except Exception:
            self._page.reload(wait_until="domcontentloaded", timeout=30000)
        self._page.wait_for_timeout(10000)

        # Trigger start game - retry with longer waits
        started = False
        for attempt in range(5):
            started = self._page.evaluate(f"({START_GAME_JS})()")
            if started:
                break
            self._page.wait_for_timeout(2000)
        if not started:
            raise RuntimeError("Failed to trigger start game")

        self._page.wait_for_timeout(5000)

        # Setup game (hide UI, enable control) - retry
        setup_result = None
        for attempt in range(5):
            setup_result = self._page.evaluate(f"({SETUP_GAME_JS})()", self._show_ui)
            if "error" not in setup_result:
                break
            self._page.wait_for_timeout(2000)
        if setup_result is None or "error" in setup_result:
            raise RuntimeError(f"Setup failed: {setup_result.get('error', 'unknown') if setup_result else 'no result'}")

        return setup_result

    def _init_db(self):
        """Initialize SQLite database for episode logging."""
        os.makedirs("./logs", exist_ok=True)
        self._db_path = f"./logs/episode_rank{self._rank}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        if os.path.exists(self._db_path):
            os.remove(self._db_path)
        self._db_conn = sqlite3.connect(self._db_path)
        cur = self._db_conn.cursor()
        cur.execute(
            """CREATE TABLE IF NOT EXISTS tickINFO(
                tick INT,
                role_x REAL, role_y REAL, role_rot REAL,
                role_hp REAL, role_maxhp REAL,
                move_state INT, turn_state INT,
                action INT, reward REAL,
                enemy1_x REAL, enemy1_y REAL, enemy1_hp REAL, enemy1_dist REAL,
                enemy2_x REAL, enemy2_y REAL, enemy2_hp REAL, enemy2_dist REAL,
                enemy3_x REAL, enemy3_y REAL, enemy3_hp REAL, enemy3_dist REAL,
                PRIMARY KEY (tick));"""
        )
        cur.execute(
            """CREATE TABLE IF NOT EXISTS episodeINFO(
                episode_id INT PRIMARY KEY,
                total_ticks INT,
                total_kills INT,
                my_kills INT,
                total_reward REAL,
                final_hp REAL,
                died INT);"""
        )
        self._db_conn.commit()

    def _log_tick(self, tick, action, reward, raw):
        """Log per-tick state to SQLite."""
        if not self._db_conn:
            return
        role = raw.get("role", {})
        enemies = raw.get("enemies", [])
        e1 = enemies[0] if len(enemies) > 0 else {}
        e2 = enemies[1] if len(enemies) > 1 else {}
        e3 = enemies[2] if len(enemies) > 2 else {}
        cur = self._db_conn.cursor()
        cur.execute(
            """INSERT INTO tickINFO VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                tick,
                role.get("x", 0), role.get("y", 0), role.get("rotation", 0),
                role.get("hp", 0), role.get("maxHP", 180),
                role.get("moveState", 0), role.get("turnState", 0),
                action, reward,
                e1.get("x", 0), e1.get("y", 0), e1.get("hp", 0), e1.get("dist", 0),
                e2.get("x", 0), e2.get("y", 0), e2.get("hp", 0), e2.get("dist", 0),
                e3.get("x", 0), e3.get("y", 0), e3.get("hp", 0), e3.get("dist", 0),
            ),
        )
        self._db_conn.commit()

    def _log_episode(self, episode_id, ticks, kills, my_kills, total_reward, final_hp, died):
        """Log episode summary to SQLite."""
        if not self._db_conn:
            return
        cur = self._db_conn.cursor()
        cur.execute(
            """INSERT INTO episodeINFO VALUES (?,?,?,?,?,?,?)""",
            (episode_id, ticks, kills, my_kills, total_reward, final_hp, int(died)),
        )
        self._db_conn.commit()

    def reset(
        self, seed: Optional[int] = None, options: Optional[Dict[str, Any]] = None
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Reset the environment and return initial observation."""
        super().reset(seed=seed)

        if self._page is not None:
            # Subsequent resets: close browser and re-launch for clean state
            self.close()
        self._launch_browser()

        self._navigate_and_start()

        # Reset episode state
        self._tick_count = 0
        self._prev_hp = 180
        self._prev_enemy_hps = {}
        self._total_kills = 0
        self._my_kills = 0
        self._total_damage_dealt = 0.0
        self._bullets_fired = 0
        self._episode_reward = 0.0
        self._episode_id += 1
        self._prev_my_bullet_count = 0
        self._prev_total_kills = 0
        self._stuck_counter = 0
        self._prev_pos_for_stuck = None
        self._friendly_damage_dealt = 0.0

        # Init SQLite logging
        self._init_db()

        # Get initial observation
        state = self._page.evaluate(f"({EXTRACT_STATE_JS})()")
        if "error" in state:
            raise RuntimeError(f"State extraction failed: {state['error']}")

        obs = np.array(state["obs"], dtype=np.float32)
        info = {"raw": state.get("raw", {})}

        return obs, info

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        """Take one action in the environment."""
        self._tick_count += 1

        # Execute action
        action_spec = ACTION_MAP.get(action, [])
        for item in action_spec:
            if item == "fire":
                self._page.evaluate(FIRE_JS)
                self._bullets_fired += 1
            else:
                key, event_type = item
                self._page.evaluate(f"({DISPATCH_KEY_JS})({json.dumps(key)}, {json.dumps(event_type)})")

        # Wait for tick
        self._page.wait_for_timeout(self._tick_ms)

        # Release all keys
        self._page.evaluate(f"({RELEASE_ALL_KEYS_JS})()")

        # Read new state
        state = self._page.evaluate(f"({EXTRACT_STATE_JS})()")
        if "error" in state:
            # Game crashed or page closed
            obs = np.zeros(80, dtype=np.float32)
            return obs, -10.0, True, False, {"error": state["error"]}

        obs = np.array(state["obs"], dtype=np.float32)
        raw = state.get("raw", {})
        role = raw.get("role", {})
        role["nearbyObstacles"] = raw.get("nearbyObstacles", [])
        enemies = raw.get("enemies", [])
        my_bullet_count = raw.get("myBulletCount", 0)
        total_kills = raw.get("totalKills", 0)
        enemy_bullets = raw.get("enemyBullets", [])
        enemy_locked = raw.get("enemyLocked", False)
        alive_friends = raw.get("aliveFriends", 5)
        alive_enemies = raw.get("aliveEnemies", 5)

        # Compute reward
        reward = self._compute_reward(role, enemies, my_bullet_count, total_kills, enemy_bullets, enemy_locked, alive_friends, alive_enemies, raw=raw)
        self._episode_reward += reward

        # Log to SQLite
        self._log_tick(self._tick_count, action, reward, raw)

        # Check termination
        terminated = False
        truncated = False

        # Death
        if role.get("hp", 0) <= 0:
            terminated = True
            reward -= 10.0

        # Max ticks
        if self._tick_count >= self._max_ticks:
            truncated = True

        # Log episode summary
        if terminated or truncated:
            self._log_episode(
                self._episode_id,
                self._tick_count,
                self._total_kills,
                self._my_kills,
                self._episode_reward,
                role.get("hp", 0),
                terminated,
            )

        info = {
            "raw": raw,
            "ticks": self._tick_count,
            "kills": self._total_kills,
            "my_kills": self._my_kills,
            "bullets_fired": self._bullets_fired,
        }

        return obs, reward, terminated, truncated, info

    def _compute_reward(self, role: Dict, enemies: list, my_bullet_count: int = 0, total_kills: int = 0, enemy_bullets: list = None, enemy_locked: bool = False, alive_friends: int = 5, alive_enemies: int = 5, raw: Dict = None) -> float:
        """Compute reward for current step with damage-dealt signal, engagement bonus, and bullet-dodge penalty."""
        reward = 0.0

        current_hp = role.get("hp", 0)
        max_hp = role.get("maxHP", 180)

        # Damage taken
        hp_delta = self._prev_hp - current_hp
        if hp_delta > 0:
            reward -= hp_delta * 0.5  # -0.5 per HP lost
        self._prev_hp = current_hp

        # Kill detection with damage-dealt reward
        current_enemy_ids = {e["id"]: e["hp"] for e in enemies if e["id"] >= 0}
        new_kills = 0
        damage_dealt = 0.0
        for eid, prev_hp in self._prev_enemy_hps.items():
            if eid not in current_enemy_ids:
                # Enemy removed (killed by someone)
                new_kills += 1
                self._total_kills += 1
            elif current_enemy_ids[eid] < prev_hp:
                # Enemy damaged - primary learning signal
                damage = prev_hp - current_enemy_ids[eid]
                damage_dealt += damage
                self._total_damage_dealt += damage
        self._prev_enemy_hps = current_enemy_ids

        # Reward damage dealt (encourages aggressive play)
        if damage_dealt > 0:
            reward += damage_dealt * 0.5  # +0.5 per HP dealt to enemies

        # Kill bonus (simplified - flat reward per kill)
        if new_kills > 0:
            reward += new_kills * 25.0  # flat bonus per kill
            # Attribute kills if we had bullets in flight
            if my_bullet_count > 0:
                self._my_kills += min(new_kills, 1)

        # Update bullet tracking
        self._prev_my_bullet_count = my_bullet_count
        self._prev_total_kills = total_kills

        # Wasted bullet penalty: bullet fired but disappeared without hitting enemy
        # This penalizes shooting at walls/obstacles/ground
        if self._prev_my_bullet_count > my_bullet_count and my_bullet_count == 0:
            # A bullet disappeared - check if it hit an enemy (damage_dealt > 0)
            if damage_dealt == 0 and new_kills == 0:
                reward -= 0.3  # wasted shot penalty

        # Survival bonus (scaled by HP%)
        hp_pct = current_hp / max_hp if max_hp > 0 else 0
        reward += 0.05 * hp_pct

        # Team win bonus: big reward when all enemies eliminated
        if alive_enemies == 0 and alive_friends > 0:
            reward += 50.0  # team win!

        # Team loss penalty: when all friends dead but enemies remain
        if alive_friends == 0 and alive_enemies > 0:
            reward -= 30.0  # team lost

        # Survival-to-end bonus: reward for being alive when teammates are dying
        # Encourages tank to stay alive as long as possible
        if alive_friends < 5 and current_hp > 0:
            reward += 0.1 * (5 - alive_friends)  # bonus per fallen teammate while still alive

        # Engagement bonus: reward being close to enemies (within enemy view range 1200px)
        # This is critical - enemies only fire when player is within 1200px
        if enemies:
            min_dist = min(e.get("dist", 9999) for e in enemies)
            if min_dist < 1200:
                # Strong bonus for being in combat range
                reward += 0.08 * (1 - min_dist / 1200)
            if 300 < min_dist < 700:
                # Extra bonus for optimal firing range
                reward += 0.05
            elif min_dist < 200:
                # Small penalty for being too close (collision risk)
                reward -= 0.02

        # Obstacle collision penalty: penalize being too close to obstacles
        # This teaches the tank to avoid driving into houses/rocks/walls
        nearby_obs = role.get("nearbyObstacles", []) if isinstance(role, dict) else []
        for ob in nearby_obs:
            ob_dist = ob.get("dist", 999)
            if ob_dist < 80:
                reward -= 0.05  # too close to obstacle
            elif ob_dist < 150:
                reward -= 0.02  # getting close

        # Facing bonus: encourage keeping enemies in view
        if enemies:
            nearest = min(enemies, key=lambda e: e.get("dist", 9999))
            if nearest.get("dist", 9999) < 800:
                # Reward for facing toward nearest enemy
                role_facing_enemy = -nearest.get("facingDot", 0)  # invert: enemy facing player -> player facing enemy
                reward += 0.02 * role_facing_enemy

        # Bullet-dodge penalty: penalize being near incoming enemy bullets
        if enemy_bullets:
            for b in enemy_bullets:
                tti = b.get("tti", 999)
                if tti < 0.5:
                    # Strong penalty for being in bullet trajectory
                    reward -= 0.5 * (0.5 - tti) / 0.5

        # Enemy lock-on warning: when enemy has locked on, encourage evasive action
        if enemy_locked:
            reward -= 0.02  # small pressure to dodge when targeted

        # Stuck detection: penalize if tank hasn't moved significantly
        cur_pos = (role.get("x", 0), role.get("y", 0))
        if self._prev_pos_for_stuck is not None:
            dx_move = cur_pos[0] - self._prev_pos_for_stuck[0]
            dy_move = cur_pos[1] - self._prev_pos_for_stuck[1]
            move_dist = (dx_move * dx_move + dy_move * dy_move) ** 0.5
            if move_dist < 5:  # barely moved
                self._stuck_counter += 1
            else:
                self._stuck_counter = 0
        self._prev_pos_for_stuck = cur_pos
        if self._stuck_counter > 10:
            reward -= 0.05 * min(self._stuck_counter - 10, 20)  # escalating stuck penalty

        # Friendly-fire penalty: detect damage to teammates
        if not hasattr(self, '_prev_friend_hps'):
            self._prev_friend_hps = {}
        friend_hps = raw.get("friendHps", []) if isinstance(raw, dict) else []
        current_friend_hps = {fh.get("id", i): fh.get("hp", 0) for i, fh in enumerate(friend_hps)}
        friendly_damage = 0.0
        for fid, prev_hp in self._prev_friend_hps.items():
            if fid in current_friend_hps:
                cur_hp = current_friend_hps[fid]
                if cur_hp < prev_hp:
                    friendly_damage += (prev_hp - cur_hp)
        self._prev_friend_hps = current_friend_hps
        if friendly_damage > 0:
            reward -= friendly_damage * 1.5  # strong penalty for friendly fire
            self._friendly_damage_dealt += friendly_damage

        # Time penalty (encourages decisive action)
        reward -= 0.01

        return reward

    def close(self):
        """Close browser and cleanup."""
        try:
            if self._db_conn:
                self._db_conn.close()
        except Exception:
            pass
        try:
            if self._page:
                self._page.close()
        except Exception:
            pass
        try:
            if self._ctx:
                self._ctx.close()
                # Videos are saved when context closes
        except Exception:
            pass
        try:
            if self._browser:
                self._browser.close()
        except Exception:
            pass
        try:
            if self._playwright:
                self._playwright.stop()
        except Exception:
            pass

        self._page = None
        self._ctx = None
        self._browser = None
        self._playwright = None
        self._db_conn = None

    def __del__(self):
        self.close()


def make_env(rank: int = 0, **kwargs):
    """Factory function for creating env instances (for SubprocVecEnv)."""

    def _init():
        return TigerTankEnv(rank=rank, **kwargs)

    return _init


if __name__ == "__main__":
    # Smoke test: run 1 episode with random actions
    print("Creating environment...")
    env = TigerTankEnv(headless=True, max_ticks=20)

    print("Resetting...")
    obs, info = env.reset()
    print(f"Initial obs shape: {obs.shape}")
    print(f"Initial obs: {obs}")

    total_reward = 0.0
    for step in range(20):
        action = env.action_space.sample()
        obs, reward, terminated, truncated, info = env.step(action)
        total_reward += reward
        print(
            f"Step {step}: action={action} reward={reward:.3f} "
            f"hp={info['raw']['role']['hp']} kills={info['kills']}"
        )
        if terminated or truncated:
            print(f"Episode ended at step {step}")
            break

    print(f"\nTotal reward: {total_reward:.3f}")
    print(f"Total kills: {info['kills']}")
    print(f"Ticks survived: {info['ticks']}")

    env.close()
    print("Done.")

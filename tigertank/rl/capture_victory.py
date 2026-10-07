"""Capture victory screen for star analysis.

Runs the game with a strong model, tries to get a victory (all enemies killed),
and captures the victory screen with stars.
"""

import os
import sys
import json
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from environment import TigerTankEnv


def main():
    model_path = sys.argv[1] if len(sys.argv) > 1 else None
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "./gameover_capture"
    os.makedirs(out_dir, exist_ok=True)

    model = None
    if model_path:
        from stable_baselines3 import PPO
        print(f"Loading model from {model_path}...")
        model = PPO.load(model_path)

    env = TigerTankEnv(headless=True, max_ticks=300)
    obs, info = env.reset()
    print("Game started. Waiting for victory...")

    for tick in range(300):
        if model:
            action, _ = model.predict(obs, deterministic=True)
            action = int(action)
        else:
            action = env.action_space.sample()

        obs, reward, terminated, truncated, info = env.step(action)

        if tick % 20 == 0:
            alive_enemies = info['raw'].get('aliveEnemies', '?')
            print(f"  Tick {tick}: HP={info['raw']['role']['hp']:.0f}, "
                  f"kills={info.get('kills', 0)}, alive_enemies={alive_enemies}, reward={reward:.2f}")

        # Check if victory screen appeared
        try:
            vt_info = env._page.evaluate("""
                () => {
                    const stage = window.Laya.stage;
                    function findType(node, typeName, depth=0) {
                        if (depth > 10) return null;
                        if (node.constructor.name === typeName) return node;
                        const kids = node._children || node.children || [];
                        for (const k of kids) { const r = findType(k, typeName, depth+1); if (r) return r; }
                        return null;
                    }
                    const vt = findType(stage, 'Vt');
                    if (!vt || !vt.visible) return null;

                    // Find the result banner
                    function findInParent(parent, typeName, depth=0) {
                        if (depth > 5) return null;
                        const kids = parent._children || parent.children || [];
                        for (const k of kids) {
                            if (k.constructor.name === typeName) return k;
                            const r = findInParent(k, typeName, depth+1);
                            if (r) return r;
                        }
                        return null;
                    }
                    const cNode = findInParent(vt, 'c');
                    let bannerSkin = null;
                    if (cNode) {
                        const oNode = findInParent(cNode, 'o');
                        if (oNode) bannerSkin = oNode.skin;
                    }
                    return { vtVisible: true, bannerSkin: bannerSkin };
                }
            """)
            if vt_info and vt_info.get('bannerSkin'):
                skin = vt_info['bannerSkin']
                print(f"  Tick {tick}: Game over screen detected! banner={skin}")
                env._page.wait_for_timeout(3000)  # wait for animation
                suffix = "victory" if "shengli" in skin else "defeat"
                screenshot_path = os.path.join(out_dir, f"{suffix}_tick{tick}.png")
                env._page.screenshot(path=screenshot_path, full_page=False)
                print(f"  Screenshot saved: {screenshot_path}")
                break
        except Exception as e:
            print(f"  Tick {tick}: Error: {e}")

        if terminated:
            print(f"  Tick {tick}: Tank died")
            break
        if truncated:
            print(f"  Tick {tick}: Max ticks")
            break

    env.close()
    print(f"\nDone. Outputs in {out_dir}/")


if __name__ == "__main__":
    main()

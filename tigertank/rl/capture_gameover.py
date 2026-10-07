"""Capture game-over screen for analysis.

Runs the Tiger Tank game with a trained model, waits for game over,
takes a screenshot, and dumps the scene graph so we can identify
the victory/defeat panel's class name and properties.
"""

import os
import sys
import json
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from environment import TigerTankEnv
from state_extractor import EXTRACT_STATE_JS


# JS to dump the full scene graph at game over
DUMP_SCENE_GRAPH_JS = """
() => {
    const stage = window.Laya.stage;
    const result = {children: []};

    function dumpNode(node, depth) {
        if (depth > 8) return null;
        const out = {
            type: node.constructor ? node.constructor.name : 'unknown',
            visible: node.visible,
            alpha: node.alpha,
            x: node.x, y: node.y,
            width: node.width, height: node.height,
        };
        // Capture interesting properties
        const interesting = ['text', 'label', 'src', 'skin', 'url',
            'curState', 'bWin', 'bLose', 'bOver', 'bEnd', 'bGameOver',
            'starCount', 'stars', 'result', 'resultType', 'winType',
            'score', 'killNum', 'deadNum', 'time', 'timeLeft',
            'bVisible', 'bShow', 'bActive'];
        for (const k of interesting) {
            try {
                if (node[k] !== undefined && node[k] !== null && node[k] !== '') {
                    out[k] = typeof node[k] === 'object' ? JSON.stringify(node[k]) : node[k];
                }
            } catch(e) {}
        }
        // Capture own enumerable properties (first 30)
        try {
            const ownKeys = Object.keys(node).slice(0, 30);
            for (const k of ownKeys) {
                if (!(k in out)) {
                    try {
                        const v = node[k];
                        if (typeof v !== 'function' && typeof v !== 'object') {
                            out['_' + k] = v;
                        } else if (v === null) {
                            out['_' + k] = null;
                        }
                    } catch(e) {}
                }
            }
        } catch(e) {}
        const kids = node._children || node.children || [];
        if (kids.length > 0 && depth < 6) {
            out.children = kids.map(c => dumpNode(c, depth + 1)).filter(Boolean);
        }
        return out;
    }

    const topKids = stage._children || stage.children || [];
    result.children = topKids.map(c => dumpNode(c, 0)).filter(Boolean);
    result.mission = window.__mission ? {
        type: window.__mission.constructor.name,
        curState: window.__mission.curState,
        killNum: window.__mission.killNum,
        deadNum: window.__mission.deadNum,
        ownKeys: Object.keys(window.__mission).slice(0, 50)
    } : null;
    return result;
}
"""


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
    print("Game started. Waiting for game over...")

    game_over_detected = False
    screenshot_path = None
    scene_graph_path = None

    for tick in range(300):
        if model:
            action, _ = model.predict(obs, deterministic=True)
            action = int(action)
        else:
            action = env.action_space.sample()

        obs, reward, terminated, truncated, info = env.step(action)

        if tick % 20 == 0:
            print(f"  Tick {tick}: HP={info['raw']['role']['hp']:.0f}, "
                  f"kills={info.get('kills', 0)}, reward={reward:.2f}")

        # Check if game over screen appeared (mission.curState changes)
        try:
            cur_state = env._page.evaluate("() => window.__mission ? window.__mission.curState : null")
            if cur_state is not None and cur_state != 0 and cur_state != 'playing':
                print(f"  Tick {tick}: Game over detected! curState={cur_state}")
                game_over_detected = True
                # Wait a moment for the screen to fully render
                env._page.wait_for_timeout(2000)
                # Take screenshot
                screenshot_path = os.path.join(out_dir, f"gameover_tick{tick}.png")
                env._page.screenshot(path=screenshot_path, full_page=False)
                print(f"  Screenshot saved: {screenshot_path}")
                # Dump scene graph
                scene_graph = env._page.evaluate(f"({DUMP_SCENE_GRAPH_JS})()")
                scene_graph_path = os.path.join(out_dir, f"scene_graph_tick{tick}.json")
                with open(scene_graph_path, 'w') as f:
                    json.dump(scene_graph, f, indent=2, default=str)
                print(f"  Scene graph saved: {scene_graph_path}")
                break
        except Exception as e:
            print(f"  Tick {tick}: Error checking game state: {e}")

        if terminated:
            print(f"  Tick {tick}: Tank died (HP=0)")
            # Still try to capture the defeat screen
            env._page.wait_for_timeout(2000)
            screenshot_path = os.path.join(out_dir, f"defeat_tick{tick}.png")
            env._page.screenshot(path=screenshot_path, full_page=False)
            print(f"  Screenshot saved: {screenshot_path}")
            scene_graph = env._page.evaluate(f"({DUMP_SCENE_GRAPH_JS})()")
            scene_graph_path = os.path.join(out_dir, f"scene_graph_defeat_tick{tick}.json")
            with open(scene_graph_path, 'w') as f:
                json.dump(scene_graph, f, indent=2, default=str)
            print(f"  Scene graph saved: {scene_graph_path}")
            break

        if truncated:
            print(f"  Tick {tick}: Max ticks reached")
            break

    env.close()
    print(f"\nDone. Outputs in {out_dir}/")
    if screenshot_path:
        print(f"  Screenshot: {screenshot_path}")
    if scene_graph_path:
        print(f"  Scene graph: {scene_graph_path}")


if __name__ == "__main__":
    main()

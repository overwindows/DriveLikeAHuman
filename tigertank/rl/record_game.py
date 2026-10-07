"""Record a game playthrough as video.

Usage:
    python record_game.py                    # random actions, 1 episode
    python record_game.py --model MODEL.zip  # trained model
    python record_game.py --episodes 3       # multiple episodes
"""

import os
import sys
import argparse
import time

import numpy as np

from environment import TigerTankEnv


def record(
    model_path: str = None,
    n_episodes: int = 1,
    max_ticks: int = 200,
    video_dir: str = "./videos",
    deterministic: bool = True,
):
    """Record game playthrough(s) as video."""

    os.makedirs(video_dir, exist_ok=True)

    model = None
    if model_path:
        from stable_baselines3 import PPO
        print(f"Loading model from {model_path}...")
        model = PPO.load(model_path)

    for ep in range(n_episodes):
        print(f"\n=== Recording Episode {ep + 1}/{n_episodes} ===")
        env = TigerTankEnv(
            headless=True,
            max_ticks=max_ticks,
            record_video=True,
            video_dir=video_dir,
            show_ui=True,
        )

        obs, info = env.reset()
        print(f"  Started. Recording to {video_dir}/")

        total_reward = 0.0
        for tick in range(max_ticks):
            if model:
                action, _ = model.predict(obs, deterministic=deterministic)
                action = int(action)
            else:
                action = env.action_space.sample()

            obs, reward, terminated, truncated, info = env.step(action)
            total_reward += reward

            if tick % 20 == 0:
                print(
                    f"  Tick {tick}: HP={info['raw']['role']['hp']:.0f}, "
                    f"kills={info.get('kills', 0)}, reward={reward:.2f}"
                )

            if terminated:
                print(f"  Tick {tick}: DIED")
                break
            if truncated:
                print(f"  Tick {tick}: Episode ended (max ticks)")
                break

        print(f"  Final: {info['ticks']} ticks, {info.get('kills', 0)} kills, "
              f"HP={info['raw']['role']['hp']:.0f}, reward={total_reward:.2f}")

        env.close()
        print(f"  Video saved.")

    # List recorded videos
    print(f"\n=== Recorded videos in {video_dir}/ ===")
    for f in sorted(os.listdir(video_dir)):
        path = os.path.join(video_dir, f)
        size_mb = os.path.getsize(path) / (1024 * 1024)
        print(f"  {f} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Record Tiger Tank game")
    parser.add_argument("--model", type=str, default=None, help="Path to trained model")
    parser.add_argument("--episodes", type=int, default=1)
    parser.add_argument("--max-ticks", type=int, default=200)
    parser.add_argument("--video-dir", type=str, default="./videos")
    parser.add_argument("--stochastic", action="store_true")
    args = parser.parse_args()

    record(
        model_path=args.model,
        n_episodes=args.episodes,
        max_ticks=args.max_ticks,
        video_dir=args.video_dir,
        deterministic=not args.stochastic,
    )

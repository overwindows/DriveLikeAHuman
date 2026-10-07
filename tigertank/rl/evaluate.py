"""Evaluate a trained PPO model on Tiger Tank game."""

import os
import sys
import csv
import argparse
from datetime import datetime

import numpy as np
from stable_baselines3 import PPO

from environment import TigerTankEnv


def evaluate(
    model_path: str,
    n_episodes: int = 10,
    max_ticks: int = 200,
    deterministic: bool = True,
    output_csv: str = "results/rl_runs.csv",
):
    """Evaluate trained model over multiple episodes."""

    if not os.path.exists(model_path):
        print(f"Error: model not found at {model_path}")
        sys.exit(1)

    print(f"Loading model from {model_path}...")
    model = PPO.load(model_path)

    print(f"Running {n_episodes} episodes (max {max_ticks} ticks each)...")

    results = []
    for ep in range(n_episodes):
        print(f"\n=== Episode {ep + 1}/{n_episodes} ===")
        env = TigerTankEnv(headless=True, max_ticks=max_ticks)
        obs, info = env.reset()

        total_reward = 0.0
        kills = 0
        deaths = 0
        final_hp = 180
        final_pos = (0, 0)
        died_at_tick = None

        for tick in range(max_ticks):
            action, _states = model.predict(obs, deterministic=deterministic)
            action = int(action)
            obs, reward, terminated, truncated, info = env.step(action)
            total_reward += reward

            if terminated:
                deaths += 1
                died_at_tick = tick + 1
                break
            if truncated:
                break

        kills = info.get("kills", 0)
        final_hp = info["raw"]["role"]["hp"]
        final_pos = (info["raw"]["role"]["x"], info["raw"]["role"]["y"])

        result = {
            "episode": ep + 1,
            "ticks": info["ticks"],
            "kills": kills,
            "deaths": deaths,
            "died_at_tick": died_at_tick,
            "final_hp": final_hp,
            "final_pos_x": final_pos[0],
            "final_pos_y": final_pos[1],
            "total_reward": total_reward,
        }
        results.append(result)

        print(
            f"  Ticks: {result['ticks']}, Kills: {kills}, Deaths: {deaths}, "
            f"Final HP: {final_hp}, Reward: {total_reward:.2f}"
        )

        env.close()

    # Summary
    print("\n=== SUMMARY ===")
    avg_kills = np.mean([r["kills"] for r in results])
    avg_deaths = np.mean([r["deaths"] for r in results])
    avg_ticks = np.mean([r["ticks"] for r in results])
    avg_reward = np.mean([r["total_reward"] for r in results])
    survival_rate = np.mean([1 - r["deaths"] for r in results])

    print(f"Average kills: {avg_kills:.2f}")
    print(f"Average deaths: {avg_deaths:.2f}")
    print(f"Average ticks survived: {avg_ticks:.1f}")
    print(f"Average reward: {avg_reward:.2f}")
    print(f"Survival rate: {survival_rate * 100:.1f}%")

    # Save to CSV
    os.makedirs(os.path.dirname(output_csv) or ".", exist_ok=True)
    file_exists = os.path.exists(output_csv)
    with open(output_csv, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp"] + list(results[0].keys()))
        if not file_exists:
            writer.writeheader()
        for r in results:
            writer.writerow({"timestamp": datetime.now().isoformat(), **r})

    print(f"\nResults saved to {output_csv}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate PPO on Tiger Tank")
    parser.add_argument("model", type=str, help="Path to trained model")
    parser.add_argument("--episodes", type=int, default=10)
    parser.add_argument("--max-ticks", type=int, default=200)
    parser.add_argument("--stochastic", action="store_true", help="Use stochastic actions")
    parser.add_argument("--output", type=str, default="results/rl_runs.csv")
    args = parser.parse_args()

    evaluate(
        model_path=args.model,
        n_episodes=args.episodes,
        max_ticks=args.max_ticks,
        deterministic=not args.stochastic,
        output_csv=args.output,
    )

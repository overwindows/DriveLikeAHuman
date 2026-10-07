"""Thorough environment test: run multiple episodes with random actions."""

import sys
import time
import numpy as np

from environment import TigerTankEnv


def test_env(n_episodes=3, max_ticks=100):
    """Run multiple episodes and report stats."""
    print(f"Testing environment: {n_episodes} episodes, max {max_ticks} ticks each")
    print("=" * 60)

    env = TigerTankEnv(headless=True, max_ticks=max_ticks)

    all_rewards = []
    all_kills = []
    all_ticks = []
    all_final_hp = []

    for ep in range(n_episodes):
        print(f"\n--- Episode {ep + 1}/{n_episodes} ---")
        t0 = time.time()

        obs, info = env.reset()
        print(f"  Reset OK. Obs shape: {obs.shape}, dtype: {obs.dtype}")
        print(f"  Obs range: [{obs.min():.3f}, {obs.max():.3f}]")
        print(f"  Role HP: {info['raw']['role']['hp']}, Enemies: {len(info['raw']['enemies'])}")

        total_reward = 0.0
        action_counts = {}
        errors = 0

        for tick in range(max_ticks):
            action = env.action_space.sample()
            action_counts[action] = action_counts.get(action, 0) + 1

            try:
                obs, reward, terminated, truncated, info = env.step(action)
                total_reward += reward
            except Exception as e:
                errors += 1
                print(f"  ERROR at tick {tick}: {e}")
                if errors > 3:
                    print("  Too many errors, aborting episode")
                    break
                continue

            if terminated:
                print(f"  Tick {tick}: DIED (reward={reward:.2f})")
                break
            if truncated:
                print(f"  Tick {tick}: TRUNCATED (max ticks reached)")
                break

        elapsed = time.time() - t0
        kills = info.get("kills", 0)
        final_hp = info["raw"]["role"]["hp"]
        ticks_survived = info["ticks"]

        print(f"  Result: {ticks_survived} ticks, {kills} kills, HP={final_hp}, reward={total_reward:.2f}")
        print(f"  Time: {elapsed:.1f}s ({elapsed/ticks_survived:.2f}s/tick)")
        print(f"  Action distribution: {action_counts}")
        print(f"  Errors: {errors}")

        all_rewards.append(total_reward)
        all_kills.append(kills)
        all_ticks.append(ticks_survived)
        all_final_hp.append(final_hp)

    env.close()

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Episodes:       {n_episodes}")
    print(f"Avg ticks:      {np.mean(all_ticks):.1f} ± {np.std(all_ticks):.1f}")
    print(f"Avg kills:      {np.mean(all_kills):.2f} ± {np.std(all_kills):.2f}")
    print(f"Avg final HP:   {np.mean(all_final_hp):.1f} ± {np.std(all_final_hp):.1f}")
    print(f"Avg reward:     {np.mean(all_rewards):.2f} ± {np.std(all_rewards):.2f}")
    print(f"Total kills:    {sum(all_kills)}")
    print(f"Survival rate:  {sum(1 for h in all_final_hp if h > 0)}/{n_episodes}")

    # Sanity checks
    print("\nSANITY CHECKS:")
    obs_check = obs.shape == (32,) and obs.dtype == np.float32
    print(f"  Obs shape correct (32,): {'PASS' if obs_check else 'FAIL'}")
    print(f"  At least 1 episode completed: {'PASS' if max(all_ticks) > 10 else 'FAIL'}")
    print(f"  No crashes: {'PASS' if all(t > 0 for t in all_ticks) else 'FAIL'}")

    return all_rewards, all_kills, all_ticks


if __name__ == "__main__":
    n_eps = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    max_t = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    test_env(n_episodes=n_eps, max_ticks=max_t)

"""PPO training script for Tiger Tank game.

Trains a PPO agent using stable-baselines3 with parallel browser environments.
"""

import os
import sys
import argparse
from datetime import datetime

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import (
    EvalCallback,
    CheckpointCallback,
    BaseCallback,
)
from stable_baselines3.common.monitor import Monitor
import torch

from environment import make_env, TigerTankEnv


class TickerCallback(BaseCallback):
    """Custom callback to log episode stats."""

    def __init__(self, verbose=0):
        super().__init__(verbose)
        self.episode_rewards = []
        self.episode_kills = []
        self.episode_lengths = []

    def _on_step(self) -> bool:
        # Check for completed episodes in vec env
        if "episode" in self.locals.get("infos", [{}])[0]:
            info = self.locals["infos"][0]["episode"]
            self.episode_rewards.append(info["r"])
            self.episode_lengths.append(info["l"])
            if self.verbose > 0:
                print(
                    f"Episode done: reward={info['r']:.2f} "
                    f"length={info['l']} kills={self.locals['infos'][0].get('kills', 0)}"
                )
        return True


def train(
    total_timesteps: int = 100_000,
    n_envs: int = 4,
    learning_rate: float = 3e-4,
    n_steps: int = 4096,
    batch_size: int = 64,
    n_epochs: int = 10,
    gamma: float = 0.99,
    gae_lambda: float = 0.95,
    clip_range: float = 0.2,
    ent_coef: float = 0.01,
    save_dir: str = "./models",
    log_dir: str = "./tb_logs",
    resume_from: str = None,
    max_ticks: int = 100,
):
    """Train PPO agent on Tiger Tank environment."""

    os.makedirs(save_dir, exist_ok=True)
    os.makedirs(log_dir, exist_ok=True)

    print(f"Creating {n_envs} environments (sequential, single-process)...")
    # Use single env to avoid subprocess crashes with Playwright
    # For multiple envs, we'd need async Playwright API
    env = make_env(rank=0, max_ticks=max_ticks)()
    env = Monitor(env)

    if resume_from and os.path.exists(resume_from):
        print(f"Resuming from {resume_from}")
        model = PPO.load(resume_from, env=env)
    else:
        print("Creating new PPO model...")
        model = PPO(
            "MlpPolicy",
            env,
            learning_rate=learning_rate,
            n_steps=n_steps,
            batch_size=batch_size,
            n_epochs=n_epochs,
            gamma=gamma,
            gae_lambda=gae_lambda,
            clip_range=lambda progress: 0.2 - 0.1 * progress,
            ent_coef=lambda progress: 0.05 - 0.045 * progress,
            verbose=1,
            tensorboard_log=log_dir,
            device="cuda" if torch.cuda.is_available() else "cpu",
            policy_kwargs={
                "net_arch": dict(pi=[64, 64], vf=[128, 128])
            },
        )

    # Callbacks
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    checkpoint_callback = CheckpointCallback(
        save_freq=max(10000 // n_envs, 1),
        save_path=save_dir,
        name_prefix=f"tigertank_ppo_{timestamp}",
    )

    ticker_callback = TickerCallback(verbose=1)

    print(f"Starting training for {total_timesteps} timesteps...")
    print(f"Tensorboard log: tensorboard --logdir {log_dir}")

    try:
        model.learn(
            total_timesteps=total_timesteps,
            callback=[checkpoint_callback, ticker_callback],
        )
    except KeyboardInterrupt:
        print("\nTraining interrupted by user.")

    # Save final model
    final_path = os.path.join(save_dir, f"tigertank_ppo_{timestamp}_final")
    model.save(final_path)
    print(f"Model saved to {final_path}")

    env.close()
    return model


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train PPO on Tiger Tank")
    parser.add_argument("--timesteps", type=int, default=100_000)
    parser.add_argument("--n-envs", type=int, default=4)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--save-dir", type=str, default="./models")
    parser.add_argument("--log-dir", type=str, default="./tb_logs")
    parser.add_argument("--resume", type=str, default=None)
    parser.add_argument("--max-ticks", type=int, default=100)
    args = parser.parse_args()

    train(
        total_timesteps=args.timesteps,
        n_envs=args.n_envs,
        learning_rate=args.lr,
        save_dir=args.save_dir,
        log_dir=args.log_dir,
        resume_from=args.resume,
        max_ticks=args.max_ticks,
    )

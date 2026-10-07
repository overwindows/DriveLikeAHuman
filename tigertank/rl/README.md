# Tiger Tank RL Framework

Reinforcement learning framework for the Tiger Tank game (YouTube Playables, Laya.js 2.x WebGL).

## Overview

This framework trains a PPO agent to play the Tiger Tank game using:
- **State**: 24-feature vector (player + 5 nearest enemies)
- **Actions**: 10 discrete actions (WASD combinations + fire)
- **Reward**: kills (+10), deaths (-10), damage taken (-0.5/HP), survival bonus (+0.01/tick)
- **Algorithm**: PPO via stable-baselines3

## Files

- `state_extractor.py` — JavaScript functions injected into the game page to read state and dispatch actions
- `environment.py` — Gymnasium environment wrapping a Playwright browser session
- `train.py` — PPO training loop with parallel browser instances
- `evaluate.py` — Run trained policy and log metrics
- `requirements.txt` — Python dependencies

## Installation

```bash
# Activate conda env (PyTorch 2.12.1 already installed)
conda activate codeguru

# Install RL dependencies
pip install -r requirements.txt

# Install Playwright browsers (if not already)
playwright install chromium
```

## Usage

### Smoke test (1 episode, random actions)

```bash
python environment.py
```

### Train

```bash
# Default: 100k timesteps, 4 parallel envs
python train.py

# Custom
python train.py --timesteps 50000 --n-envs 2 --lr 1e-4

# Resume from checkpoint
python train.py --resume models/tigertank_ppo_xxx_final.zip
```

Monitor training with tensorboard:
```bash
tensorboard --logdir tb_logs
```

### Evaluate

```bash
# Run 10 episodes with trained model
python evaluate.py models/tigertank_ppo_xxx_final.zip

# Custom
python evaluate.py models/tigertank_ppo_xxx_final.zip --episodes 20 --max-ticks 200
```

## State Vector (32 features)

```
[roleX, roleY, roleRot, roleHP, roleMaxHP, moveState, turnState,
 enemy1_dx, enemy1_dy, enemy1_hp, enemy1_rot, enemy1_facingDot,
 enemy2_dx, enemy2_dy, enemy2_hp, enemy2_rot, enemy2_facingDot,
 enemy3_dx, enemy3_dy, enemy3_hp, enemy3_rot, enemy3_facingDot,
 enemy4_dx, enemy4_dy, enemy4_hp, enemy4_rot, enemy4_facingDot,
 enemy5_dx, enemy5_dy, enemy5_hp, enemy5_rot, enemy5_facingDot]
```

7 player features + 5 enemies × 5 features = 32 total. All values normalized to roughly [-1, 1]. Missing enemies are zero-padded.

## Action Space (10 discrete)

| Index | Action |
|-------|--------|
| 0 | no-op |
| 1 | W (forward) |
| 2 | A (turn left) |
| 3 | S (backward) |
| 4 | D (turn right) |
| 5 | W+A (forward + left) |
| 6 | W+D (forward + right) |
| 7 | S+A (backward + left) |
| 8 | S+D (backward + right) |
| 9 | fire |

## Reward Function

```
+10.0   per enemy kill
-10.0   per death
-0.5    per HP lost
+0.05   per damage dealt to enemy
+0.01   per tick alive (survival bonus)
-0.001  per tick alive (time penalty)
-0.02   per bullet fired (ammo conservation)
```

## Performance Notes

- Each episode: ~70 seconds (200 ticks × 350ms)
- 4 parallel envs: ~4x speedup
- 100k timesteps ≈ 2.5 hours with 4 envs
- Recommended: start with 10k timesteps to verify learning, then scale up

## Comparison to Heuristic Baseline

The best heuristic bot (v32) achieves:
- 4 kills, 0 deaths over 200 ticks
- Final HP: 151/180

Target for RL agent: match or exceed these metrics.

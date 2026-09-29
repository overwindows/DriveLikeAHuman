# Tiger Tank Autonomous Play — Documentation Index

Welcome! This directory contains everything you need to understand, run, modify, and extend the autonomous tank AI.

## Start here (in order)

1. **[GETTING_STARTED.md](GETTING_STARTED.md)** — Zero-to-running guide. Install deps, run your first experiment, understand the output.
2. **[README.md](README.md)** — Results progression, key findings, open problems.
3. **[HANDOVER.md](HANDOVER.md)** — Project context, architecture, prioritized bugs for next contributor.
4. **[TECHNIQUES.md](TECHNIQUES.md)** — How to manipulate the HTML game (Playwright, scene graph, input injection, heuristics).
5. **[EXPERIMENTS.md](EXPERIMENTS.md)** — Experiment log template, history of all experiments, open hypotheses.

## Quick reference

### Run commands

```bash
npm install              # Install Playwright
npm run run              # Run latest version (v30)
npm run run:v29          # Run a specific version
npm run run:all          # Run all versions once
node run_all.js 5        # Run all versions 5 times each
npm run compare          # View results summary
npm run explore          # Dump scene graph structure
```

### File layout

```
tigertank/
├── INDEX.md              # This file
├── GETTING_STARTED.md    # Setup + first run
├── README.md             # Results + findings
├── HANDOVER.md           # Context + prioritized bugs
├── TECHNIQUES.md         # Game manipulation skills
├── EXPERIMENTS.md        # Experiment log + hypotheses
├── package.json          # npm scripts + dependencies
├── run_all.js            # Multi-version runner
├── compare_results.js    # Results summarizer
├── explore_scene.js      # Scene graph explorer
├── play_tigertank.js     # v1: initial exploration
├── play_tigertank2-24.js # Iterative exploration
├── play_tigertank25.js   # Deep scene walk for enemies
├── play_tigertank26.js   # First autonomous loop
├── play_tigertank27.js   # Dodging + retreat
├── play_tigertank28.js   # Bullet search (failed)
├── play_tigertank29.js   # 50% retreat threshold
├── play_tigertank30.js   # Latest: 70% retreat, pre-emptive dodge
├── results/              # Experimental results
│   ├── README.md         # Results directory docs
│   ├── runs.csv          # Summary of all runs
│   └── *.log             # Full logs from each run
└── screenshots/          # Screenshots from runs
    └── v30/              # Latest version screenshots
```

### Current status (as of 2026-09-28)

- **Latest version**: v30
- **Latest results**: 3 kills, 69 deaths, died at tick 131 (regression from v29)
- **Critical bug**: Turn-in-place loop — tank spins without closing distance
- **Next priority**: Fix turn loop, then respawn, then arena bounds

### For new contributors

1. Read GETTING_STARTED.md and run `npm run run` to see it work
2. Read HANDOVER.md to understand what needs fixing
3. Read TECHNIQUES.md to learn the manipulation toolkit
4. Pick a bug from HANDOVER.md and try to fix it
5. Document your work in EXPERIMENTS.md
6. Run `node run_all.js 5` to validate statistically

# makefun-token-radar-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Tihandukcapil/makefun-token-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Tihandukcapil/makefun-token-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar v3 ranks the 196 pre-token protocols in the snapshot by what their launch would be worth, and shows how to farm each one. The implied value starts from a size curve fitted at runtime on the 128 protocols whose token already trades (log market cap on log TVL), then adds a sector shift per category, capped seven-day growth and age at half weight, and launch odds from a logistic fit. The dashboard shows the board, a detail view with a farm plan and verdict math for every protocol, a live view of 24 tokens that already trade, and the backtest ladder that proves the full model beats a flat multiple on leave-one-out.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=ks2r30ft&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

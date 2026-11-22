# makefun-token-radar-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Tihandukcapil/makefun-token-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Tihandukcapil/makefun-token-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar that prices every protocol that records no token by what its launch would be worth. The value is a least-squares size curve fitted on the protocols that already trade — log market cap on log TVL — with a fitted shift per category and growth and age at half their fitted weight, validated blind by leave-one-out and older-to-newer backtests and printed with a leave-one-out range. Each row carries launch odds from a logistic fit, an airdrop slice and a net-of-fees verdict, and a concrete farm plan with what it costs and how long it takes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=ks2r30ft&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

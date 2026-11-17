# makefun-gta6-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/kanashit12/makefun-gta6-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/kanashit12/makefun-gta6-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecast GTA VI's launch-day Twitch viewers hour by hour: a Node 22 program that reads the first hour's Twitch viewer count and forecasts hours 2–24 as five quantiles each, learned from the launch-day shapes of 37 past big game launches.

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=zpdmg1p9&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>

## Model

`main.ts` (Node 22, standard library only, no network, deterministic) reads
each case in `/input/<id>.in` and writes `/output/<id>.out`: for hours 2–24
of GTA VI's release day (UTC), five quantiles (5/25/50/75/95%) of the Twitch
viewers in the "Grand Theft Auto VI" category, scored by pinball loss on the
log scale.

Anchor on hour 1's print `p1`, then learn the launch-day shape from the
case's own `comparables` — hourly Twitch counts of 37 past big game launches:

- per hour `h`, `lr_h = ln(v_h / v_1)` across launches; the **median** is the
  typical launch-day shape (dip in the small hours, jumps at the US East
  05:00 UTC and US West 08:00 UTC midnight unlocks, build into the evening);
- the **MAD-based spread** of `lr_h` (×1.25, floored at 0.20, capped at 1.10)
  is the honest per-hour uncertainty;
- quantiles are lognormal: `q_tau(h) = p1 * exp(median_lr[h] + z_tau * sigma[h])`.

The GTA VI category's own pre-release history (the "before release"
comparable, day_start = the 2026-08-27 premiere) is excluded — it is not a
launch day. If no comparable is usable, the forecast falls back to the house
baseline shape (flat median, σ = 0.15·√(h−1)).

This beats the house baseline, which assumes every hour stays at `p1`: real
launch days climb several-fold from hour 1 as the world unlocks, and the
log-scale pinball loss charges the flat median the full log miss every hour.

## Local validation (`dev/`)

`dev/validate.mjs` runs leave-one-out over the kit's comparables (each launch
as a pseudo-case, trained on the other 36) plus format/determinism/timing
checks on the kit's practice cases and synthetic final-like cases:

| | model | house baseline |
|---|---|---|
| LOO mean pinball loss (34 launches) | **0.5965** | 0.6930 |
| typical miss | 127.7% | 144.5% |
| 90% coverage | 0.862 | 0.671 (honest ≈ 0.90) |

Format: 23 rows × 5 quantiles, monotone, finite, in (0, 1e9] — PASS on all
7 test cases. Deterministic (two runs byte-identical). ~20 ms/case (limit
8 s). `dev/sweep.mjs` is the parameter sweep that picked the constants
(no shrinkage, σ scale 1.25, all launches — a console-only filter scored
worse).

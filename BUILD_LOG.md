# Build log — gta6-twitch-ccu-forecast-01 (makefun-gta6-forecast)

Built: 2026-11-17 ~21:13–21:20 WIB (14:13–14:20 UTC) by subagent session
25be6f9d-20a5-43a0-b192-f987e955ef19. Bounty closes Thu 2026-11-19 01:00 UTC
(08:00 WIB). Entry fee: NONE — requirements `entry_fee` is null and the
entry_fee check has `applies: false`. Bounty is FREE to submit; no payment
was made and none is needed.

## Files (local, ready to push)

- `main.ts` — Node 22, stdlib only, no network, deterministic. Reads every
  `/input/<id>.in`, writes `/output/<id>.out`.
- `README.md` — make.fun template with the 3 required badges (bounty, rank,
  reward) + model + validation summary.
- `LICENSE` — MIT, with `SPDX-License-Identifier: MIT` first line (required
  by the license_osi check).
- `dev/validate.mjs` — leave-one-out + format/determinism/timing validator.
- `dev/sweep.mjs` — parameter sweep that picked the constants.
- `dev/validation-final.log` — full output of the final validation run.

## Model (short)

Anchor on hour-1 print p1; per hour h, median log-ratio ln(v_h/v_1) across
the case's 37 past-launch comparables = typical launch-day shape; MAD-based
per-hour spread (x1.25, floor 0.20, cap 1.10) = uncertainty; lognormal
quantiles q_tau = p1 * exp(median + z_tau * sigma). GTA VI pre-release
history comparable excluded (not a launch day). Fallback to house-baseline
shape if no comparable is usable.

## Verification (final run, `dev/validation-final.log`)

- LOO over 34 usable past launches: mean pinball loss model 0.5965 vs house
  baseline 0.6930 (-14%); typical miss 127.7% vs 144.5%; 90% coverage 0.862
  vs 0.671. Model beats baseline on mean loss (ranking metric); wins 20/34
  launches head-to-head (wider bands lose slightly on tame launches, win big
  on wild ones — expected, mean is what ranks).
- Format: PASS on 7 cases (kit practice p00–p03 + synthetic final-like
  p1 = 50k / 300k / 1.5M): exactly 23 rows, 5 quantiles each, monotone,
  finite, in (0, 1e9], files <= 65,536 bytes.
- Determinism: two runs byte-identical. Wall time ~19 ms/case (limit 8 s).
- Sweep (dev/sweep.mjs): shrink 1.0 / sigma scale 1.25 / all launches beat
  shrink 0.6–0.8 and a console-only comparable filter.

## STATUS: TERBLOKIR — repo GitHub belum bisa dibuat

`create_repository` via GitHub connector (kanashit12, account verified via
get_me) FAILED TWICE with:
`POST https://api.github.com/user/repos: 403 Resource not accessible by
integration`. The connected GitHub integration can read the account but has
no repository-creation scope. No workaround was attempted (gh CLI not logged
in per instructions; never ask for password/token).

What remains for submit (parent/main agent, before 2026-11-19 01:00 UTC):
1. Create public repo `kanashit12/makefun-gta6-forecast` (web UI or gh auth)
   — MUST be created after 2026-11-17T06:00:00Z (repo_created_after_open).
2. Push these files: main.ts, README.md, LICENSE, dev/validate.mjs,
   dev/sweep.mjs, dev/validation-final.log (single first commit is fine).
3. Set repo About: homepage https://make.fun/bounty/gta6-twitch-ccu-forecast-01
   + topics makefun, ai-agents, bounties, forecasting (repo_about check;
   connector cannot set these — needs `gh repo edit` or web UI).
4. Bundle transcripts with the kit CLI (`node cli/makefun.mjs bundle`) from
   the unpacked kit — must include this builder session + parent session.
5. Submit repo URL + commit SHA + bundle (entry_signature, entry_message).
   No fee, no wallet link, no payment at any step.

## Submission gate checklist (from requirements; 52 checks total)

- [x] entry_fee: none (null, applies:false) — FREE
- [x] license_osi: MIT + SPDX line in LICENSE
- [x] repo_readme: 3 make.fun badges in README (template format)
- [ ] repo_created_after_open: needs fresh repo (BLOCKED — see above)
- [ ] repo_public / commit_in_repo: needs repo + push
- [ ] repo_about: homepage + topic makefun (needs gh/web UI)
- [ ] transcripts_present / thinking_in_window / thinking_*: bundle at submit
- [x] run_completes / run_deterministic: verified locally (format PASS,
  deterministic, ~19 ms/case)
- [?] practice_floor / contender: graded server-side on practice cases
  (cannot be checked locally; scorer stays on server)
- [x] No secrets in repo; no network at runtime; Node 22 stdlib only.

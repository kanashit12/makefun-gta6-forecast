// Forecast GTA VI's launch-day Twitch viewers hour by hour.
//
// Entry for make.fun bounty gta6-twitch-ccu-forecast-01.
// Node 22, standard library only, no network, deterministic.
//
// Method
// ------
// The case gives one anchor: hour 1's print p1 (the mean Twitch viewers in
// the GTA VI category, 00:00-01:00 UTC on release day). Everything else the
// program knows about launch-day shapes comes from the case's own
// `comparables`: hourly Twitch category counts of 37 past big game launches,
// each spanning 14 days before to 3 days after its release day.
//
// For every comparable launch we take its release day (UTC), read its hour-1
// viewers v1 and its viewers v_h in hours 2..24, and form the log ratio
// lr_h = ln(v_h / v_1). Across launches, the median of lr_h is the typical
// launch-day shape (viewers dip in the small hours, jump at the US East
// (05:00 UTC) and US West (08:00 UTC) midnight unlocks, and build into the
// evening), and the spread of lr_h across launches is the honest
// uncertainty for that hour. Quantiles are lognormal around that shape:
//
//   q_tau(h) = p1 * exp(median_lr[h] + z_tau * sigma[h])
//
// with z the standard-normal quantiles at 0.05/0.25/0.5/0.75/0.95 and sigma[h]
// the MAD-based spread of lr_h across launches (scaled 1.25x: the raw MAD
// spread under-covers in leave-one-out scoring), floored so the band is never
// narrower than the house baseline's early spread and capped so a wild hour
// cannot blow the band up.
//
// Why this beats the house baseline: the baseline says every hour stays at
// p1 with a widening symmetric spread. Real launch days do not stay flat:
// hour 1 (00:00-01:00 UTC) is before most of the world has unlocked, so the
// median launch climbs several-fold into the US daytime/evening, and the
// pinball loss on the log scale punishes a flat median by the full log miss
// at every hour. The comparables' shape removes most of that systematic miss
// while the per-hour spread keeps the 90% band honest.
//
// The GTA VI category's own pre-release history (the "before release"
// comparable, whose day_start is the 2026-08-27 premiere, not a launch) is
// excluded from the shape: it is not a launch day.
//
// Fallbacks: if no comparable yields a usable release day, the forecast falls
// back to the house baseline shape (flat median, sigma 0.15*sqrt(h-1)).
// A missing or non-positive hour-1 print is treated as 1 viewer, as the
// rules' invalid-case scoring does.
//
// Output: /output/<id>.out, one JSON object {"hours":[{"hour":h,
// "q":[q05,q25,q50,q75,q95]}]} for hours 2..24, quantiles rounded to 2
// decimals, non-decreasing, each in (0, 1e9].

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];
/** Hours to forecast. */
const HOURS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

/** Shrinkage of the median log-ratio toward 0 (flat). Set to 1.0 (no
 *  shrinkage): leave-one-out scoring over the comparables found the raw
 *  median beats shrunk versions (0.6/0.8), and with 34+ launches the
 *  median is stable enough not to need it. */
const SHRINK = 1.0;
/** Floor / cap for the per-hour log spread across launches. */
const SIGMA_MIN = 0.2;
const SIGMA_MAX = 1.1;
/** The MAD-based spread slightly under-covers (LOO 90% coverage ~0.81 at
 *  scale 1.0); 1.25 brings coverage to ~0.86 and lowers LOO pinball loss. */
const SIGMA_SCALE = 1.25;
/** A comparable only counts if its hour-1 print is at least this many
 *  viewers; tiny categories have noisy, unrepresentative ratios. */
const MIN_V1 = 1000;
/** A comparable only counts if it has at least this many of hours 2..24. */
const MIN_HOURS = 18;

/** Baseline fallback spread, as in the house baseline. */
const BASELINE_SIGMA = 0.15;

interface HourlyPoint {
  from: string;
  viewers: number;
  channels?: number | null;
  reads?: number;
}

interface Comparable {
  name: string;
  day_start: string;
  hourly: HourlyPoint[];
}

interface Case {
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables?: Comparable[];
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** x rounded to 2 decimals (half up), matching the house baseline's output. */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Learn the launch-day shape from the case's comparables.
 * Returns, per forecast hour, { mu, sigma } of the log ratio to hour 1,
 * or null when no comparable is usable (caller falls back to the baseline).
 */
function learnShape(comparables: Comparable[] | undefined): Map<number, { mu: number; sigma: number }> | null {
  if (!comparables) return null;
  // log ratios per hour across usable launches
  const perHour = new Map<number, number[]>();
  for (const h of HOURS) perHour.set(h, []);

  let usable = 0;
  for (const comp of comparables) {
    // The GTA VI category's own pre-release history is not a launch day.
    if (/grand theft auto vi/i.test(comp.name) && /before release/i.test(comp.name)) continue;
    if (!comp.day_start || !Array.isArray(comp.hourly)) continue;
    const start = Date.parse(comp.day_start);
    if (!Number.isFinite(start)) continue;
    const byHour = new Map<number, number>();
    for (const p of comp.hourly) {
      if (!p || typeof p.viewers !== 'number' || !(p.viewers > 0)) continue;
      const t = Date.parse(p.from);
      if (!Number.isFinite(t)) continue;
      const h = Math.round((t - start) / 3600000) + 1;
      if (h >= 1 && h <= 24 && !byHour.has(h)) byHour.set(h, p.viewers);
    }
    const v1 = byHour.get(1);
    if (v1 === undefined || v1 < MIN_V1) continue;
    let have = 0;
    for (const h of HOURS) if (byHour.has(h)) have++;
    if (have < MIN_HOURS) continue;
    usable++;
    const logV1 = Math.log(v1);
    for (const h of HOURS) {
      const v = byHour.get(h);
      if (v !== undefined) perHour.get(h)!.push(Math.log(v) - logV1);
    }
  }
  if (usable < 5) return null;

  const shape = new Map<number, { mu: number; sigma: number }>();
  for (const h of HOURS) {
    const xs = perHour.get(h)!;
    if (xs.length < 5) continue;
    const med = median(xs);
    const mad = median(xs.map((x) => Math.abs(x - med)));
    const sigma = clamp(1.4826 * mad * SIGMA_SCALE, SIGMA_MIN, SIGMA_MAX);
    shape.set(h, { mu: SHRINK * med, sigma });
  }
  return shape.size >= 18 ? shape : null;
}

function forecastCase(c: Case): Array<{ hour: number; q: number[] }> {
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`case asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error('case has no hour-1 print');
  const p1 = Math.max(1, first.viewers);
  const logP1 = Math.log(p1);

  const shape = learnShape(c.comparables);
  const rows: Array<{ hour: number; q: number[] }> = [];
  for (const h of c.forecast.map((f) => f.hour)) {
    const s = shape?.get(h);
    const mu = s ? s.mu : 0;
    const sigma = s ? s.sigma : BASELINE_SIGMA * Math.sqrt(h - 1);
    let prev = 0;
    const q = Z.map((z) => {
      const v = clamp(round2(Math.exp(logP1 + mu + z * sigma)), 0.01, 1000000000);
      // Enforce non-decreasing quantiles after rounding.
      const out = Math.max(v, prev);
      prev = out;
      return out;
    });
    rows.push({ hour: h, q });
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}

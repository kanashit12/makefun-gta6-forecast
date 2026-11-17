// Parameter sweep for the shape model (dev only). Replicates main.ts math
// in-process over the LOO pseudo-cases and sweeps SHRINK x SIGMA_SCALE x
// SIGMA_MIN x comparable filter (all vs console-only vs PS/Xbox-only).
import { readFileSync } from 'node:fs';

const KIT = '/tmp/gta6kit/gta6-twitch-ccu-forecast-01-kit';
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const HOURS = Array.from({ length: 23 }, (_, i) => i + 2);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const pinball = (y, q, tau) => { const d = Math.log(Math.max(1, y)) - Math.log(q); return 2 * Math.max(tau * d, (tau - 1) * d); };

const kitCase = JSON.parse(readFileSync(KIT + '/input/p00.in', 'utf8'));
const launches = kitCase.comparables.filter((c) => !/grand theft auto vi/i.test(c.name));
function releaseDay(comp) {
  const start = Date.parse(comp.day_start);
  const byHour = new Map();
  for (const p of comp.hourly) {
    if (!p || typeof p.viewers !== 'number' || !(p.viewers > 0)) continue;
    const h = Math.round((Date.parse(p.from) - start) / 3600000) + 1;
    if (h >= 1 && h <= 24 && !byHour.has(h)) byHour.set(h, p.viewers);
  }
  return byHour;
}
const days = launches.map((c) => ({ name: c.name, platforms: c.platforms || '', byHour: releaseDay(c) }))
  .filter((d) => { const v1 = d.byHour.get(1); let have = 0; for (const h of HOURS) if (d.byHour.has(h)) have++; return v1 !== undefined && v1 >= 1000 && have >= 18; });
console.log(`LOO launches: ${days.length}`);

function learn(train, { shrink, sigMin, sigMax, sigScale }) {
  const perHour = new Map(HOURS.map((h) => [h, []]));
  for (const d of train) {
    const logV1 = Math.log(d.byHour.get(1));
    for (const h of HOURS) { const v = d.byHour.get(h); if (v !== undefined) perHour.get(h).push(Math.log(v) - logV1); }
  }
  const shape = new Map();
  for (const h of HOURS) {
    const xs = perHour.get(h);
    if (xs.length < 5) continue;
    const med = median(xs);
    const mad = median(xs.map((x) => Math.abs(x - med)));
    shape.set(h, { mu: shrink * med, sigma: clamp(1.4826 * mad * sigScale, sigMin, sigMax) });
  }
  return shape;
}
function score(shape, d) {
  const v1 = d.byHour.get(1);
  let loss = 0, cnt = 0, cov = 0;
  for (const h of HOURS) {
    const y = d.byHour.get(h);
    if (y === undefined) continue;
    const s = shape.get(h);
    const mu = s ? s.mu : 0;
    const sig = s ? s.sigma : 0.15 * Math.sqrt(h - 1);
    const q = Z.map((z) => clamp(Math.round(v1 * Math.exp(mu + z * sig) * 100) / 100, 0.01, 1e9));
    for (let j = 0; j < 5; j++) loss += pinball(y, q[j], LEVELS[j]);
    if (q[0] <= y && y <= q[4]) cov++;
    cnt++;
  }
  return { loss: loss / (cnt * 5), cov: cov / cnt };
}
function baselineLoss(d) {
  const v1 = d.byHour.get(1);
  let loss = 0, cnt = 0;
  for (const h of HOURS) {
    const y = d.byHour.get(h);
    if (y === undefined) continue;
    const q = Z.map((z) => Math.round(v1 * Math.exp(z * 0.15 * Math.sqrt(h - 1)) * 100) / 100);
    for (let j = 0; j < 5; j++) loss += pinball(y, q[j], LEVELS[j]);
    cnt++;
  }
  return loss / (cnt * 5);
}
const baseMean = days.reduce((a, d) => a + baselineLoss(d), 0) / days.length;
console.log(`baseline LOO mean: ${baseMean.toFixed(4)}`);

const filters = {
  all: () => true,
  'no-PC': (d) => !/\bPC\b/.test(d.platforms),
  'console-sony-nin': (d) => /PS5|PS4|Switch/.test(d.platforms) && !/\bPC\b/.test(d.platforms),
};
for (const [fname, f] of Object.entries(filters)) {
  const pool = days.filter(f);
  console.log(`\nfilter ${fname}: ${pool.length} launches in pool`);
  for (const shrink of [0.6, 0.8, 1.0]) {
    for (const sigScale of [1.0, 1.25, 1.5]) {
      for (const sigMin of [0.2, 0.3]) {
        let tot = 0, cov = 0, wins = 0;
        for (const d of days) {
          const train = pool.filter((t) => t !== d);
          const shape = learn(train, { shrink, sigMin, sigMax: 1.1, sigScale });
          const r = score(shape, d);
          tot += r.loss; cov += r.cov;
          if (r.loss < baselineLoss(d)) wins++;
        }
        console.log(`  shrink=${shrink} sigScale=${sigScale} sigMin=${sigMin}: loss=${(tot / days.length).toFixed(4)} cov=${(cov / days.length).toFixed(3)} wins=${wins}/${days.length}`);
      }
    }
  }
}

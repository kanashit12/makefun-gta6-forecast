// Local validation for main.ts (dev only; not part of the graded entry).
// 1. Leave-one-out over the kit's comparables: each past launch becomes a
//    pseudo-case (hour-1 print known, hours 2..24 to forecast), trained on
//    the other launches. Scores pinball loss on the log scale vs the house
//    baseline (flat median, sigma 0.15*sqrt(h-1)).
// 2. Format checks on the real kit practice cases + synthetic final-like
//    cases: 23 rows, 5 quantiles, monotone, finite, (0, 1e9], <= 65536 bytes.
// 3. Determinism (two runs byte-identical) and wall time (limit 8 s/case).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KIT = '/tmp/gta6kit/gta6-twitch-ccu-forecast-01-kit';
const DIR = new URL('.', import.meta.url).pathname;
const WORK = join(DIR, '..');
const MAIN = join(WORK, 'main.ts');
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const HOURS = Array.from({ length: 23 }, (_, i) => i + 2);

const pinball = (y, q, tau) => {
  const d = Math.log(Math.max(1, y)) - Math.log(q);
  return 2 * Math.max(tau * d, (tau - 1) * d);
};

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

function runMain(inputDir, outputDir) {
  const t0 = process.hrtime.bigint();
  execFileSync('node', [MAIN], {
    env: { ...process.env, MAKEFUN_INPUT_DIR: inputDir, MAKEFUN_OUTPUT_DIR: outputDir },
    stdio: 'pipe',
  });
  return Number(process.hrtime.bigint() - t0) / 1e6; // ms
}

function checkFormat(outPath, id) {
  const problems = [];
  const raw = readFileSync(outPath, 'utf8');
  if (raw.length > 65536) problems.push('over 65536 bytes');
  let obj;
  try { obj = JSON.parse(raw); } catch { return [`${id}: not JSON`]; }
  if (Object.keys(obj).length !== 1 || !Array.isArray(obj.hours)) problems.push('must have exactly one key "hours" (array)');
  else {
    if (obj.hours.length !== 23) problems.push(`hours.length=${obj.hours.length}`);
    const seen = new Set();
    for (const row of obj.hours) {
      if (Object.keys(row).length !== 2 || typeof row.hour !== 'number' || !Array.isArray(row.q)) { problems.push(`bad row shape ${JSON.stringify(row)}`); continue; }
      seen.add(row.hour);
      if (row.q.length !== 5) problems.push(`hour ${row.hour}: q.length=${row.q.length}`);
      for (let j = 0; j < row.q.length; j++) {
        const v = row.q[j];
        if (!Number.isFinite(v) || v <= 0 || v > 1e9) problems.push(`hour ${row.hour}: q[${j}]=${v} out of range`);
        if (j > 0 && v < row.q[j - 1]) problems.push(`hour ${row.hour}: not non-decreasing`);
      }
    }
    for (const h of HOURS) if (!seen.has(h)) problems.push(`missing hour ${h}`);
  }
  return problems.map((p) => `${id}: ${p}`);
}

// ---------- 1. Leave-one-out over comparables ----------
const kitCase = JSON.parse(readFileSync(join(KIT, 'input/p00.in'), 'utf8'));
const launches = kitCase.comparables.filter((c) => !/grand theft auto vi/i.test(c.name));
const gtaHist = kitCase.comparables.find((c) => /grand theft auto vi/i.test(c.name));
console.log(`comparables: ${launches.length} launches (+ GTA target-history)`);

const looIn = join(DIR, 'loo-input');
const looOut = join(DIR, 'loo-output');
rmSync(looIn, { recursive: true, force: true });
rmSync(looOut, { recursive: true, force: true });
mkdirSync(looIn, { recursive: true });

const actuals = new Map(); // id -> Map hour->viewers
const cases = [];
launches.forEach((comp, i) => {
  const byHour = releaseDay(comp);
  const v1 = byHour.get(1);
  if (v1 === undefined || v1 < 1000) { console.log(`  skip ${comp.name}: v1=${v1}`); return; }
  let have = 0; for (const h of HOURS) if (byHour.has(h)) have++;
  if (have < 18) { console.log(`  skip ${comp.name}: only ${have}/23 hours`); return; }
  const id = `loo-${String(i).padStart(2, '0')}`;
  const dayStart = comp.day_start;
  const startMs = Date.parse(dayStart);
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const pseudo = {
    schema: 'makefun/twitch-ccu-case/v1',
    id,
    game: { name: comp.name, twitch_id: '0' },
    day_start: dayStart,
    checkpoint: iso(startMs + 3600000),
    levels: LEVELS,
    known: [{ hour: 1, from: dayStart, until: iso(startMs + 3600000), viewers: v1, channels: 0, reads: 1 }],
    forecast: HOURS.map((h) => ({ hour: h, from: iso(startMs + (h - 1) * 3600000), until: iso(startMs + h * 3600000) })),
    history: [], history_hourly: [], streams: null, categories_hourly: null,
    comparables: [...launches.filter((c) => c !== comp), gtaHist],
    notes: `LOO pseudo-case for ${comp.name}`,
  };
  writeFileSync(join(looIn, `${id}.in`), JSON.stringify(pseudo));
  actuals.set(id, byHour);
  cases.push({ id, name: comp.name, v1 });
});
console.log(`LOO pseudo-cases: ${cases.length}`);

const ms = runMain(looIn, looOut);
console.log(`main.ts on ${cases.length} LOO cases: ${ms.toFixed(0)} ms total (${(ms / cases.length).toFixed(1)} ms/case)`);

let myLoss = 0, baseLoss = 0, n = 0, myMiss = 0, baseMiss = 0, myCov = 0, baseCov = 0;
const perCase = [];
for (const { id, name, v1 } of cases) {
  const out = JSON.parse(readFileSync(join(looOut, `${id}.out`), 'utf8'));
  const byHour = actuals.get(id);
  let ml = 0, bl = 0, cnt = 0, mm = 0, bm = 0, mc = 0, bc = 0;
  for (const row of out.hours) {
    const y = byHour.get(row.hour);
    if (y === undefined) continue;
    for (let j = 0; j < 5; j++) ml += pinball(y, row.q[j], LEVELS[j]);
    const bq = Z.map((z) => Math.round(v1 * Math.exp(z * 0.15 * Math.sqrt(row.hour - 1)) * 100) / 100);
    for (let j = 0; j < 5; j++) bl += pinball(y, bq[j], LEVELS[j]);
    mm += Math.abs(Math.log(y) - Math.log(row.q[2]));
    bm += Math.abs(Math.log(y) - Math.log(v1));
    if (row.q[0] <= y && y <= row.q[4]) mc++;
    if (bq[0] <= y && y <= bq[4]) bc++;
    cnt++;
  }
  ml /= (cnt * 5); bl /= (cnt * 5);
  mm /= cnt; bm /= cnt; mc /= cnt; bc /= cnt;
  perCase.push({ name, v1, myLoss: ml, baseLoss: bl });
  myLoss += ml; baseLoss += bl; myMiss += mm; baseMiss += bm; myCov += mc; baseCov += bc; n++;
}
myLoss /= n; baseLoss /= n; myMiss /= n; baseMiss /= n; myCov /= n; baseCov /= n;
console.log(`\nLOO mean pinball loss: model=${myLoss.toFixed(4)}  baseline=${baseLoss.toFixed(4)}  (baseline practice ~0.387)`);
console.log(`typical miss: model=${(100 * (Math.exp(myMiss) - 1)).toFixed(1)}%  baseline=${(100 * (Math.exp(baseMiss) - 1)).toFixed(1)}%`);
console.log(`90% coverage: model=${myCov.toFixed(3)}  baseline=${baseCov.toFixed(3)} (honest ~0.90)`);
console.log(`model beats baseline on ${perCase.filter((c) => c.myLoss < c.baseLoss).length}/${n} launches`);
const worst = [...perCase].sort((a, b) => b.myLoss - a.myLoss).slice(0, 5);
console.log('worst model cases:', worst.map((c) => `${c.name} ${c.myLoss.toFixed(3)} vs base ${c.baseLoss.toFixed(3)}`).join(' | '));

// ---------- 2. Format checks: kit practice + synthetic final-like ----------
const fmtIn = join(DIR, 'fmt-input');
const fmtOut1 = join(DIR, 'fmt-output1');
const fmtOut2 = join(DIR, 'fmt-output2');
for (const d of [fmtIn, fmtOut1, fmtOut2]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }
// kit practice cases
for (const id of ['p00', 'p01', 'p02', 'p03']) {
  writeFileSync(join(fmtIn, `${id}.in`), readFileSync(join(KIT, 'input', `${id}.in`)));
}
// synthetic final-like cases: hour-1 prints 50k / 300k / 1.5M, comparables from p00
const synthP1 = [50000, 300000, 1500000];
synthP1.forEach((p1, i) => {
  const base = JSON.parse(readFileSync(join(KIT, 'input/p00.in'), 'utf8'));
  base.id = `syn-${i}`;
  base.game = { name: 'Grand Theft Auto VI', twitch_id: '1867279146' };
  base.day_start = '2026-11-19T00:00:00Z';
  base.checkpoint = '2026-11-19T01:00:00Z';
  base.known = [{ hour: 1, from: '2026-11-19T00:00:00Z', until: '2026-11-19T01:00:00Z', viewers: p1, channels: 5000, reads: 60 }];
  base.forecast = HOURS.map((h) => ({ hour: h, from: `2026-11-19T${String(h - 1).padStart(2, '0')}:00:00Z`, until: `2026-11-19T${String(h).padStart(2, '0')}:00:00Z` }));
  base.history = []; base.history_hourly = []; base.streams = []; base.categories_hourly = [];
  writeFileSync(join(fmtIn, `syn-${i}.in`), JSON.stringify(base));
});
const t1 = runMain(fmtIn, fmtOut1);
const t2 = runMain(fmtIn, fmtOut2);
const files = readdirSync(fmtIn).map((f) => f.slice(0, -3)).sort();
let problems = [];
for (const id of files) problems.push(...checkFormat(join(fmtOut1, `${id}.out`), id));
// determinism
for (const id of files) {
  if (readFileSync(join(fmtOut1, `${id}.out`), 'utf8') !== readFileSync(join(fmtOut2, `${id}.out`), 'utf8')) {
    problems.push(`${id}: NOT deterministic (two runs differ)`);
  }
}
console.log(`\nformat check on ${files.length} cases (${files.join(', ')}): ${problems.length ? 'FAIL' : 'PASS'}`);
problems.forEach((p) => console.log('  ' + p));
console.log(`wall time: run1 ${t1.toFixed(0)} ms / run2 ${t2.toFixed(0)} ms for ${files.length} cases (limit 8000 ms/case)`);
const syn = JSON.parse(readFileSync(join(fmtOut1, 'syn-1.out'), 'utf8'));
console.log('sample syn-1 (p1=300k) hours 2/6/9/18/24 medians:',
  [2, 6, 9, 18, 24].map((h) => `h${h}=${syn.hours.find((r) => r.hour === h).q[2]}`).join(' '));
console.log('sample syn-1 hour 9 quantiles:', JSON.stringify(syn.hours.find((r) => r.hour === 9).q));

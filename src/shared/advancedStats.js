import { chiSqPValue, normCdf, normInv } from "./statsCore.js";

/** O'Brien-Fleming efficacy boundaries (approximate) at looks t_k = k/K */
export function obrienFlemingBoundaries(looks, alpha) {
  const zFinal = normInv(1 - alpha / 2);
  return looks.map((t) => ({
    t,
    z: zFinal / Math.sqrt(t),
    p: 2 * (1 - normCdf(zFinal / Math.sqrt(t))),
  }));
}

/** Pocock-style constant boundary (approximate, equal spending) */
export function pocockBoundary(looks, alpha) {
  const K = looks.length;
  const z = normInv(1 - alpha / (2 * Math.log(K + 1)));
  return looks.map((t) => ({ t, z, p: 2 * (1 - normCdf(z)) }));
}

/** Two-sample Poisson rate comparison (normal approximation on rates) */
export function poissonRateTest(e1, exp1, e2, exp2, alpha, twoSided) {
  if (exp1 <= 0 || exp2 <= 0 || e1 < 0 || e2 < 0) return null;
  const r1 = e1 / exp1;
  const r2 = e2 / exp2;
  const se = Math.sqrt(r1 / exp1 + r2 / exp2);
  const z = se > 0 ? (r2 - r1) / se : 0;
  const pRaw = twoSided ? 2 * (1 - normCdf(Math.abs(z))) : 1 - normCdf(z);
  const zCi = normInv(1 - alpha / 2);
  const ciLo = r2 - r1 - zCi * se;
  const ciHi = r2 - r1 + zCi * se;
  const relUplift = r1 > 0 ? r2 / r1 - 1 : null;
  return { r1, r2, z, pRaw, ciLo, ciHi, relUplift, se };
}

/** Kaplan-Meier survival curve from (time, atRisk, events) rows */
export function kaplanMeier(rows) {
  const sorted = [...rows].filter((r) => r.time >= 0).sort((a, b) => a.time - b.time);
  let s = 1;
  const curve = [{ time: 0, survival: 1, atRisk: sorted[0]?.atRisk ?? 0 }];
  for (const row of sorted) {
    const d = Math.min(row.events, row.atRisk);
    if (row.atRisk > 0) s *= 1 - d / row.atRisk;
    curve.push({ time: row.time, survival: s, atRisk: row.atRisk, events: d });
  }
  return curve;
}

/** Log-rank chi-square (two groups, binned intervals) */
export function logRankTest(intervals) {
  let chi = 0;
  let df = 0;
  for (const row of intervals) {
    const { cEvents, cAtRisk, vEvents, vAtRisk } = row;
    const n1 = cAtRisk, n2 = vAtRisk;
    const d1 = cEvents, d2 = vEvents;
    const n = n1 + n2;
    const d = d1 + d2;
    if (n <= 0 || d <= 0) continue;
    const e1 = (n1 * d) / n;
    const e2 = (n2 * d) / n;
    if (e1 > 0) chi += ((d1 - e1) ** 2) / e1;
    if (e2 > 0) chi += ((d2 - e2) ** 2) / e2;
    df += 1;
  }
  const pRaw = df > 0 ? chiSqPValue(chi, 1) : null;
  return { chi, pRaw, df: 1 };
}

/** Benjamini-Hochberg FDR adjustment */
export function benjaminiHochberg(pvals, q) {
  const m = pvals.length;
  if (m === 0) return [];
  const indexed = pvals.map((p, i) => ({ p: Math.min(1, Math.max(0, p)), i }));
  indexed.sort((a, b) => a.p - b.p);
  let maxAdj = 0;
  const adj = new Array(m);
  for (let k = m - 1; k >= 0; k--) {
    const rank = k + 1;
    const val = (indexed[k].p * m) / rank;
    maxAdj = Math.max(maxAdj, val);
    adj[indexed[k].i] = Math.min(1, maxAdj);
  }
  const rejected = adj.map((a) => a <= q);
  const numRejected = rejected.filter(Boolean).length;
  const fdrEstimate = numRejected > 0 ? q : 0;
  const tdrEstimate = numRejected > 0 ? Math.max(0, 1 - fdrEstimate) : null;
  return { adj, rejected, numRejected, fdrEstimate, tdrEstimate };
}

/** Beta-Binomial posterior for conversion rate */
export function betaPosterior(alpha, beta, successes, trials) {
  const a = alpha + successes;
  const b = beta + trials - successes;
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
  return { a, b, mean, variance, sd: Math.sqrt(variance) };
}

/** Monte Carlo P(variant > control) for Beta-Binomial */
export function probVariantBetter(priorA, priorB, cSucc, cTrials, vSucc, vTrials, samples = 20000) {
  const postC = betaPosterior(priorA.a, priorA.b, cSucc, cTrials);
  const postV = betaPosterior(priorB.a, priorB.b, vSucc, vTrials);
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const pc = betaSample(postC.a, postC.b);
    const pv = betaSample(postV.a, postV.b);
    if (pv > pc) wins++;
  }
  const prob = wins / samples;
  const relSamples = [];
  for (let i = 0; i < Math.min(samples, 5000); i++) {
    const pc = betaSample(postC.a, postC.b);
    const pv = betaSample(postV.a, postV.b);
    if (pc > 0) relSamples.push(pv / pc - 1);
  }
  relSamples.sort((a, b) => a - b);
  const lo = relSamples[Math.floor(relSamples.length * 0.025)] ?? null;
  const hi = relSamples[Math.floor(relSamples.length * 0.975)] ?? null;
  return { prob, postC, postV, relCiLo: lo, relCiHi: hi };
}

function betaSample(a, b) {
  const x = gammaSample(a);
  const y = gammaSample(b);
  return x / (x + y);
}

function gammaSample(shape) {
  if (shape < 1) return gammaSample(shape + 1) * Math.random() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function randn() {
  const u = Math.random() || 1e-10;
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

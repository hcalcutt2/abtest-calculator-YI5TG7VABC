import { mulberry32 } from "./detectorDemo.js";
import { normCdf } from "./statsCore.js";
import { typeErrorRates } from "./conceptStats.js";

export { typeErrorRates };

function normalSample(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function binomial(rng, n, p) {
  let c = 0;
  for (let i = 0; i < n; i++) if (rng() < p) c++;
  return c;
}

/** Two-sided p-value for difference in proportions (no effect assumed for sim) */
export function propTestP(c1, n1, c2, n2) {
  if (n1 < 1 || n2 < 1) return 1;
  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pool = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = Math.abs(p2 - p1) / se;
  return 2 * (1 - normCdf(z));
}

const MAX_P_TESTS = 30;

/** Fixed pool of null A/B tests; first `numTests` are the ones you "ran" */
export function generateNullTests(seed, nPerArm = 800) {
  const rng = mulberry32(seed);
  const pTrue = 0.05;
  return Array.from({ length: MAX_P_TESTS }, (_, id) => {
    const c1 = binomial(rng, nPerArm, pTrue);
    const c2 = binomial(rng, nPerArm, pTrue);
    const p = propTestP(c1, nPerArm, c2, nPerArm);
    return {
      id,
      c1,
      c2,
      n: nPerArm,
      rate1: c1 / nPerArm,
      rate2: c2 / nPerArm,
      p,
      calledWinner: p < 0.05,
    };
  });
}

export function falseWinnerRisk(numTests, alpha = 0.05) {
  return 1 - Math.pow(1 - alpha, numTests);
}

/** Simpson's paradox: control wins mobile; variant wins desktop; variant wins combined */
export const SIMPSON_SEGMENTS = [
  {
    id: "mobile",
    label: "Mobile visitors",
    control: { conv: 24, visitors: 40 },
    variant: { conv: 6, visitors: 60 },
  },
  {
    id: "desktop",
    label: "Desktop visitors",
    control: { conv: 6, visitors: 960 },
    variant: { conv: 60, visitors: 940 },
  },
];

export function simpsonTotals(segments) {
  const control = segments.reduce(
    (a, s) => ({ conv: a.conv + s.control.conv, visitors: a.visitors + s.control.visitors }),
    { conv: 0, visitors: 0 },
  );
  const variant = segments.reduce(
    (a, s) => ({ conv: a.conv + s.variant.conv, visitors: a.visitors + s.variant.visitors }),
    { conv: 0, visitors: 0 },
  );
  return { control, variant };
}

export function rate({ conv, visitors }) {
  return visitors > 0 ? conv / visitors : 0;
}

/** Seeded Bernoulli sequence for law of large numbers */
export function generateBernoulliSequence(seed, length = 5000, pTrue = 0.1) {
  const rng = mulberry32(seed);
  const flips = [];
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const hit = rng() < pTrue ? 1 : 0;
    sum += hit;
    flips.push({ i: i + 1, hit, running: sum / (i + 1) });
  }
  return { flips, pTrue };
}

/** Power grid: 100 items with fixed scores, classify by cutoff from confidence */
export function generatePowerPopulation(seed, nPositive = 25) {
  const rng = mulberry32(seed);
  const nTotal = 100;
  const indices = Array.from({ length: nTotal }, (_, i) => i);
  for (let i = nTotal - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const pos = new Set(indices.slice(0, nPositive));
  return Array.from({ length: nTotal }, (_, id) => ({
    id,
    isPositive: pos.has(id),
    score: pos.has(id) ? 2 + normalSample(rng) : normalSample(rng),
  }));
}

/** Standard error of a sample proportion */
export function proportionSe(p, n) {
  if (!(p > 0 && p < 1) || n < 1) return 0;
  return Math.sqrt((p * (1 - p)) / n);
}

/** Rough share of re-runs where variant rate ≤ control rate (Monte Carlo) */
export function variantLosesShare(seed, p1, p2, n, runs = 400) {
  const rng = mulberry32(seed);
  let lose = 0;
  for (let i = 0; i < runs; i++) {
    const r1 = binomial(rng, n, p1) / n;
    const r2 = binomial(rng, n, p2) / n;
    if (r2 <= r1) lose++;
  }
  return lose / runs;
}

export function simulateRateRuns(seed, p, n, runs = 120) {
  const rng = mulberry32(seed + Math.floor(p * 10000) + n);
  return Array.from({ length: runs }, () => binomial(rng, n, p) / n);
}

export function classifyPower(items, surePct) {
  const x = Math.min(95, Math.max(5, surePct)) / 100;
  const cutoff = 1 + 0.5 * Math.log((4 * x) / (1 - x));
  let detected = 0;
  let missed = 0;
  const classified = items.map((item) => {
    const sayYes = item.score >= cutoff;
    let outcome;
    if (item.isPositive && sayYes) {
      outcome = "detected";
      detected++;
    } else if (item.isPositive && !sayYes) {
      outcome = "missed";
      missed++;
    } else if (!item.isPositive && sayYes) {
      outcome = "falseAlarm";
    } else {
      outcome = "quiet";
    }
    return { ...item, sayYes, outcome };
  });
  const nPos = items.filter((i) => i.isPositive).length;
  const power = nPos > 0 ? detected / nPos : 0;
  return { classified, cutoff, detected, missed, power, nPos };
}

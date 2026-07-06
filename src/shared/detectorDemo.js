/** Seeded detector demo — fixed population, posterior-mapped cutoff */

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const BASE_RATE = 20;
export const POPULATION_SIZE = 100;

/** Posterior threshold: say yes when ≥ surePct confident (20% base rate, N(0,1) vs N(2,1)) */
export function cutoffFromSurePct(surePct) {
  const x = Math.min(95, Math.max(5, surePct)) / 100;
  return 1 + 0.5 * Math.log((4 * x) / (1 - x));
}

export function generatePopulation(seed, nPositive = BASE_RATE, nTotal = POPULATION_SIZE) {
  const rng = mulberry32(seed);
  const indices = Array.from({ length: nTotal }, (_, i) => i);
  for (let i = nTotal - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const positiveIds = new Set(indices.slice(0, nPositive));
  return Array.from({ length: nTotal }, (_, id) => {
    const isPositive = positiveIds.has(id);
    const score = isPositive ? 2 + normalSample(rng) : normalSample(rng);
    return { id, isPositive, score };
  });
}

export function classifyPopulation(items, surePct) {
  const cutoff = cutoffFromSurePct(surePct);
  const counts = { hit: 0, miss: 0, falseAlarm: 0, correctPass: 0 };
  const classified = items.map((item) => {
    const sayYes = item.score >= cutoff;
    let outcome;
    if (item.isPositive && sayYes) {
      outcome = "hit";
      counts.hit++;
    } else if (item.isPositive && !sayYes) {
      outcome = "miss";
      counts.miss++;
    } else if (!item.isPositive && sayYes) {
      outcome = "falseAlarm";
      counts.falseAlarm++;
    } else {
      outcome = "correctPass";
      counts.correctPass++;
    }
    return { ...item, sayYes, outcome };
  });
  return { classified, cutoff, counts };
}

/** Histogram bins for score strip (fixed domain) */
export function scoreHistogram(items, cutoff, binCount = 40, lo = -2.5, hi = 5) {
  const bins = Array.from({ length: binCount }, () => ({ neg: 0, pos: 0 }));
  const step = (hi - lo) / binCount;
  items.forEach((item) => {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((item.score - lo) / step)));
    if (item.isPositive) bins[idx].pos++;
    else bins[idx].neg++;
  });
  return { bins, lo, hi, step, cutoff };
}

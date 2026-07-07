/** PMF/PDF helpers and metadata for distribution-type teaching */

import { normalPdf } from "./conceptStats.js";
import { mulberry32 } from "./detectorDemo.js";

function factorial(n) {
  if (n <= 1) return 1;
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function binomialCoeff(n, k) {
  if (k < 0 || k > n) return 0;
  return factorial(n) / (factorial(k) * factorial(n - k));
}

export function bernoulliPmf(p, k) {
  if (k === 0) return 1 - p;
  if (k === 1) return p;
  return 0;
}

export function binomialPmf(n, p, k) {
  if (k < 0 || k > n) return 0;
  return binomialCoeff(n, k) * p ** k * (1 - p) ** (n - k);
}

export function poissonPmf(lambda, k) {
  if (k < 0 || !Number.isFinite(lambda) || lambda <= 0) return 0;
  return (lambda ** k * Math.exp(-lambda)) / factorial(k);
}

export function exponentialPdf(x, rate) {
  if (x < 0 || rate <= 0) return 0;
  return rate * Math.exp(-rate * x);
}

export function logNormalPdf(x, mu, sigma) {
  if (x <= 0 || sigma <= 0) return 0;
  const z = (Math.log(x) - mu) / sigma;
  return Math.exp(-z * z / 2) / (x * sigma * Math.sqrt(2 * Math.PI));
}

/** Same interpolation as the main calculator revenue capping */
export function percentile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function winsorizeComparison(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const cap95 = percentile(sorted, 0.95);
  const cap99 = percentile(sorted, 0.99);
  const capped95 = samples.map((v) => Math.min(v, cap95));
  const capped99 = samples.map((v) => Math.min(v, cap99));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const clipped = (cap) => samples.filter((v) => v > cap).length;
  return {
    raw: samples,
    capped95,
    capped99,
    cap95,
    cap99,
    meanRaw: mean(samples),
    mean95: mean(capped95),
    mean99: mean(capped99),
    clipped95: clipped(cap95),
    clipped99: clipped(cap99),
  };
}

export function uniformPdf(x, a, b) {
  if (b <= a) return 0;
  return x >= a && x <= b ? 1 / (b - a) : 0;
}

export const DISTRIBUTION_TYPES = [
  {
    id: "normal",
    family: "continuous",
    title: "Normal (Gaussian)",
    plainName: "Bell-shaped · typical session behaviour",
    tag: "Continuous · symmetric",
    definition: "Most sessions cluster near a typical value; fewer sit far above or below — like time on page once you have enough traffic.",
    example: "Average minutes on page across thousands of sessions; small wiggles in daily conversion once sample size is large",
    abNote: "Daily conversion rate, bounce rate, and click-through often look roughly bell-shaped when you plot many repeat samples — that is why large-sample tests work.",
    params: [
      { key: "sigma", label: "How spread out sessions are (σ)", min: 0.4, max: 2, step: 0.1, default: 1 },
    ],
    xLabel: "Minutes on page (from typical)",
  },
  {
    id: "uniform",
    family: "continuous",
    title: "Uniform",
    plainName: "Flat · every value equally likely",
    tag: "Continuous · no peak",
    definition: "Any value in the range is equally likely — no “typical” session length or scroll depth.",
    example: "Unrealistic baseline: if every scroll depth between 0% and 100% were equally common",
    abNote: "Real site metrics rarely look flat — use this as a contrast to skewed revenue or clustered conversion counts.",
    params: [],
    xLabel: "Scroll depth (%)",
  },
  {
    id: "exponential",
    family: "continuous",
    title: "Exponential",
    plainName: "Quick drop-off · time until next event",
    tag: "Continuous · many short, few long",
    definition: "Lots of short gaps, occasional long ones — common for waits and time-until-something-happens.",
    example: "Seconds until the next click, scroll, or bounce on a landing page",
    abNote: "Time between interactions, time until exit, and gaps between orders often taper off like this rather than forming a bell curve.",
    params: [
      { key: "rate", label: "How quickly users act (higher = shorter waits)", min: 0.3, max: 2.5, step: 0.1, default: 1 },
    ],
    xLabel: "Seconds until next interaction",
  },
  {
    id: "lognormal",
    family: "continuous",
    title: "Log-normal (revenue)",
    plainName: "Skewed order values · whale orders",
    tag: "Continuous · many small baskets, rare big spenders",
    definition: "Most orders sit at everyday basket sizes; a thin tail of whale orders stretches revenue averages upward.",
    example: "Individual order totals, revenue per visitor (RPV), average order value (AOV)",
    abNote: "Revenue metrics are almost always skewed. The main calculator can cap whale orders at the 95th or 99th percentile before testing RPV or AOV.",
    params: [
      { key: "sigma", label: "Whale tail heaviness (σ)", min: 0.45, max: 1.35, step: 0.05, default: 0.85 },
    ],
    xLabel: "Order value (£)",
  },
  {
    id: "bernoulli",
    family: "discrete",
    title: "Bernoulli",
    plainName: "One visitor · one yes/no outcome",
    tag: "Discrete · convert or not",
    definition: "Each visitor either did the thing or did not — one trial, two outcomes.",
    example: "Did this session convert? Bounce in under 10 seconds? Click the hero CTA?",
    abNote: "Every conversion test starts here: one Bernoulli trial per visitor. Stack thousands together and you get binomial counts.",
    params: [
      { key: "p", label: "Conversion rate (per visitor)", min: 0.02, max: 0.5, step: 0.01, default: 0.08 },
    ],
    xLabel: "Converted? (0 = no, 1 = yes)",
  },
  {
    id: "binomial",
    family: "discrete",
    title: "Binomial",
    plainName: "Count of conversions in N visitors",
    tag: "Discrete · whole-number counts",
    definition: "How many successes you get when the same yes/no chance repeats across a fixed number of visitors or sessions.",
    example: "12 purchases out of 150 sessions; 8 add-to-carts out of 200 product views",
    abNote: "Total conversions in an A/B cell, add-to-cart counts, or form submits in a fixed traffic slice are binomial.",
    params: [
      { key: "n", label: "Visitors (or sessions) in the slice", min: 5, max: 60, step: 1, default: 30 },
      { key: "p", label: "Conversion rate per visitor", min: 0.02, max: 0.35, step: 0.01, default: 0.08 },
    ],
    xLabel: "Conversions (count)",
  },
  {
    id: "poisson",
    family: "discrete",
    title: "Poisson",
    plainName: "Event counts in a window",
    tag: "Discrete · orders, clicks, chats",
    definition: "How many times something happens in a fixed interval when events are independent with a known average rate.",
    example: "Orders per hour, live-chat opens per day, CTA clicks per 1,000 page views",
    abNote: "Use for rate-style counts — not yes/no per visitor. Compare average orders or clicks between variants with Poisson-style tests.",
    params: [
      { key: "lambda", label: "Average events per interval (λ)", min: 0.5, max: 16, step: 0.5, default: 4 },
    ],
    xLabel: "Events counted",
  },
];

export function defaultParams(dtype) {
  const out = {};
  dtype.params.forEach((p) => { out[p.key] = p.default; });
  return out;
}

export function pmfOrPdf(typeId, params, x) {
  switch (typeId) {
    case "normal":
      return normalPdf(x, 0, params.sigma ?? 1);
    case "uniform":
      return uniformPdf(x, 0, 10);
    case "exponential":
      return exponentialPdf(x, params.rate ?? 1);
    case "lognormal":
      return logNormalPdf(x, 3.2, params.sigma ?? 0.85);
    case "bernoulli":
      return bernoulliPmf(params.p ?? 0.1, Math.round(x));
    case "binomial":
      return binomialPmf(Math.round(params.n ?? 10), params.p ?? 0.1, Math.round(x));
    case "poisson":
      return poissonPmf(params.lambda ?? 4, Math.round(x));
    default:
      return 0;
  }
}

export function discreteSupport(typeId, params) {
  switch (typeId) {
    case "bernoulli":
      return [0, 1];
    case "binomial": {
      const n = Math.round(params.n ?? 10);
      return Array.from({ length: n + 1 }, (_, i) => i);
    }
    case "poisson": {
      const lambda = params.lambda ?? 4;
      const maxK = Math.min(30, Math.ceil(lambda + 4 * Math.sqrt(lambda)));
      return Array.from({ length: maxK + 1 }, (_, i) => i);
    }
    default:
      return [];
  }
}

export function continuousDomain(typeId, params) {
  switch (typeId) {
    case "normal": {
      const s = params.sigma ?? 1;
      return { lo: -3.5 * s, hi: 3.5 * s };
    }
    case "uniform":
      return { lo: 0, hi: 10 };
    case "exponential":
      return { lo: 0, hi: 5 / (params.rate ?? 1) + 1 };
    case "lognormal": {
      const s = params.sigma ?? 0.85;
      return { lo: 0, hi: Math.exp(3.2 + 3.8 * s) };
    }
    default:
      return { lo: 0, hi: 10 };
  }
}

export function curvePoints(typeId, params) {
  if (DISTRIBUTION_TYPES.find((t) => t.id === typeId)?.family === "discrete") {
    const xs = discreteSupport(typeId, params);
    return xs.map((x) => ({ x, y: pmfOrPdf(typeId, params, x) }));
  }
  const { lo, hi } = continuousDomain(typeId, params);
  const steps = 140;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = lo + (i / steps) * (hi - lo);
    pts.push({ x, y: pmfOrPdf(typeId, params, x) });
  }
  return pts;
}

function normalSample(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function sampleFrom(typeId, params, count, seed) {
  const rng = mulberry32(seed);
  const out = [];
  switch (typeId) {
    case "normal":
      for (let i = 0; i < count; i++) out.push(normalSample(rng) * (params.sigma ?? 1));
      break;
    case "uniform":
      for (let i = 0; i < count; i++) out.push(rng() * 10);
      break;
    case "exponential":
      for (let i = 0; i < count; i++) out.push(-Math.log(1 - rng()) / (params.rate ?? 1));
      break;
    case "lognormal": {
      const s = params.sigma ?? 0.85;
      for (let i = 0; i < count; i++) out.push(Math.exp(3.2 + s * normalSample(rng)));
      break;
    }
    case "bernoulli":
      for (let i = 0; i < count; i++) out.push(rng() < (params.p ?? 0.1) ? 1 : 0);
      break;
    case "binomial": {
      const n = Math.round(params.n ?? 10);
      const p = params.p ?? 0.1;
      for (let i = 0; i < count; i++) {
        let s = 0;
        for (let j = 0; j < n; j++) if (rng() < p) s++;
        out.push(s);
      }
      break;
    }
    case "poisson": {
      const lambda = params.lambda ?? 4;
      for (let i = 0; i < count; i++) {
        let k = 0;
        let prod = Math.exp(-lambda);
        let sum = prod;
        const u = rng();
        while (u > sum) {
          k++;
          prod *= lambda / k;
          sum += prod;
        }
        out.push(k);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

export function histogramContinuous(samples, binCount, lo, hi) {
  const bins = Array.from({ length: binCount }, () => 0);
  const step = (hi - lo) / binCount;
  samples.forEach((v) => {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((v - lo) / step)));
    bins[idx]++;
  });
  return { bins, lo, hi, step, max: Math.max(1, ...bins) };
}

import React, { useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTip, ResponsiveContainer,
} from "recharts";

/* ════════════════════════════════════════════════════════════════
   ECLIPSE · A/B/n Test Calculator
   Spec: PRE_TEST (sample size & duration) + POST_TEST (CVR + revenue)
   Frequentist only · Holm–Bonferroni · chi-square SRM · WCAG 2.2 AA
   ════════════════════════════════════════════════════════════════ */

/* ─────────────────────────── Stats engine ─────────────────────── */

// Error function (Abramowitz & Stegun 7.1.26, |err| < 1.5e-7)
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) * t + 0.254829592) * t) *
      Math.exp(-x * x);
  return s * y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

// Inverse standard normal CDF (Acklam's algorithm)
function normInv(p) {
  if (p <= 0 || p >= 1) return NaN;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
    138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= ph) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// log Gamma (Lanczos)
function logGamma(x) {
  const g = [76.180091729471, -86.505320329416, 24.01409824083,
    -1.23173957245, 0.0012086509738, -0.000005395239];
  let xx = x, y = x, tmp = x + 5.5;
  tmp -= (xx + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log(2.506628274631 * ser / xx);
}

// Regularised lower incomplete gamma P(a, x) — for chi-square CDF
function lowerRegGamma(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // series
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 300; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // continued fraction for Q, then P = 1 − Q (Lentz)
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  return 1 - q;
}
const chiSqPValue = (x, df) => Math.max(0, Math.min(1, 1 - lowerRegGamma(df / 2, x / 2)));

// Regularised incomplete beta I_x(a,b) — for Student-t CDF
function betacf(a, b, x) {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}
function ibeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? (bt * betacf(a, b, x)) / a
    : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
function tCdf(t, df) {
  const x = df / (df + t * t);
  const p = 0.5 * ibeta(df / 2, 0.5, x);
  return t > 0 ? 1 - p : p;
}
// t quantile via bisection on tCdf
function tInv(p, df) {
  let lo = -200, hi = 200;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Holm–Bonferroni: returns adjusted p-values, same order as input
function holmAdjust(pvals) {
  const m = pvals.length;
  if (m <= 1) return pvals.slice();
  const idx = pvals.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const adj = new Array(m);
  let running = 0;
  idx.forEach(([p, orig], rank) => {
    const v = Math.min(1, (m - rank) * p);
    running = Math.max(running, v);
    adj[orig] = running;
  });
  return adj;
}

// Two-proportion z-test (variant vs control). Unpooled SE for both z and CI to match displayed formulas.
function twoPropTest(c1, n1, c2, n2, alpha, twoSided) {
  const p1 = c1 / n1, p2 = c2 / n2;
  const seA = Math.sqrt(p1 * (1 - p1) / n1);
  const seB = Math.sqrt(p2 * (1 - p2) / n2);
  const seDiff = Math.sqrt(seA * seA + seB * seB);
  const z = seDiff > 0 ? (p2 - p1) / seDiff : 0;
  const pRaw = twoSided ? 2 * (1 - normCdf(Math.abs(z))) : 1 - normCdf(z);

  // CI on relative uplift via log-ratio delta method (two-sided at 1−alpha)
  let ciLo = null, ciHi = null;
  if (p1 > 0 && p2 > 0) {
    const seLog = Math.sqrt((1 - p1) / (n1 * p1) + (1 - p2) / (n2 * p2));
    const zq = normInv(1 - alpha / 2);
    const lr = Math.log(p2 / p1);
    ciLo = Math.exp(lr - zq * seLog) - 1;
    ciHi = Math.exp(lr + zq * seLog) - 1;
  }

  // Per-variant CVR confidence intervals (absolute)
  const zCi = normInv(1 - alpha / 2);
  const ciA = [p1 - zCi * seA, p1 + zCi * seA];
  const ciB = [p2 - zCi * seB, p2 + zCi * seB];
  return {
    p1, p2, n1, n2,
    absUplift: p2 - p1,
    relUplift: p1 > 0 ? p2 / p1 - 1 : null,
    z, pRaw, ciLo, ciHi, seA, seB, seDiff,
    ciA, ciB,
  };
}

// Non-inferiority test for proportions (variant vs control).
// marginRel: acceptable relative drop, e.g. 0.01 = "no more than 1% worse".
// H0: variant is worse than control by more than the margin. Reject H0 => non-inferior.
// One-sided by construction. Uses unpooled SE on the shifted difference.
function nonInferiorityTest(c1, n1, c2, n2, marginRel, alpha) {
  const p1 = c1 / n1, p2 = c2 / n2;
  const margin = p1 * marginRel;            // absolute margin in proportion units
  const threshold = p1 - margin;            // variant must beat this
  const se = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2);
  // z for the one-sided test that p2 > threshold
  const z = se > 0 ? (p2 - threshold) / se : 0;
  const pRaw = 1 - normCdf(z);              // small p => reject H0 => non-inferior
  // one-sided lower confidence bound on the absolute difference (p2 - p1)
  const zq = normInv(1 - alpha);
  const diff = p2 - p1;
  const lowerBound = diff - zq * se;        // if lowerBound > -margin => non-inferior
  const upperBound = diff + zq * se;        // if upperBound < -margin => confidently worse
  return { p1, p2, margin, threshold, z, pRaw, lowerBound, upperBound, diff,
           relDiff: p1 > 0 ? p2 / p1 - 1 : null };
}

// Welch's t-test (variant vs control) from summary stats
function welchTest(m1, s1, n1, m2, s2, n2, alpha, twoSided) {
  const v1 = (s1 * s1) / n1, v2 = (s2 * s2) / n2;
  const se = Math.sqrt(v1 + v2);
  const t = se > 0 ? (m2 - m1) / se : 0;
  const df = se > 0
    ? Math.pow(v1 + v2, 2) /
      ((v1 * v1) / (n1 - 1) + (v2 * v2) / (n2 - 1))
    : 1;
  const pRaw = twoSided ? 2 * (1 - tCdf(Math.abs(t), df)) : 1 - tCdf(t, df);
  let ciLo = null, ciHi = null;
  if (m1 > 0 && m2 > 0) {
    const seLog = Math.sqrt(v1 / (m1 * m1) + v2 / (m2 * m2));
    const tq = tInv(1 - alpha / 2, df);
    const lr = Math.log(m2 / m1);
    ciLo = Math.exp(lr - tq * seLog) - 1;
    ciHi = Math.exp(lr + tq * seLog) - 1;
  }
  // Per-variant mean confidence intervals (each arm's own mean ± t*SE_mean)
  const seM1 = Math.sqrt(v1), seM2 = Math.sqrt(v2);
  const tqA = tInv(1 - alpha / 2, Math.max(1, n1 - 1));
  const tqB = tInv(1 - alpha / 2, Math.max(1, n2 - 1));
  const ciMeanA = [m1 - tqA * seM1, m1 + tqA * seM1];
  const ciMeanB = [m2 - tqB * seM2, m2 + tqB * seM2];
  return {
    m1, m2,
    absUplift: m2 - m1,
    relUplift: m1 > 0 ? m2 / m1 - 1 : null,
    t, df, pRaw, ciLo, ciHi, ciMeanA, ciMeanB,
  };
}

// Additional days needed to detect the OBSERVED effect at current traffic rate
function additionalDaysNeeded({ pA, pVar, nPerArm, daysRun, alphaAdj, power, twoTailed }) {
  const rel = pA > 0 ? pVar / pA - 1 : 0;
  if (rel <= 0) return { reachable: false, reason: "not-winning" };
  const nReq = requiredNPerArm(pA, rel, alphaAdj, power, twoTailed);
  if (!isFinite(nReq)) return { reachable: false, reason: "infeasible" };
  if (nReq <= nPerArm) return { reachable: true, moreDays: 0, nReq };
  const daily = nPerArm / daysRun;
  return { reachable: true, moreDays: Math.ceil((nReq - nPerArm) / daily), nReq };
}

// Sample size per arm (§2.2), alpha already multiplicity-adjusted
function requiredNPerArm(p1, mdeRel, alphaAdj, power, twoSided) {
  const p2 = p1 * (1 + mdeRel);
  if (p2 >= 1 || p2 <= 0 || p1 <= 0) return Infinity;
  const za = normInv(twoSided ? 1 - alphaAdj / 2 : 1 - alphaAdj);
  const zb = normInv(power);
  const pBar = (p1 + p2) / 2;
  const num = Math.pow(
    za * Math.sqrt(2 * pBar * (1 - pBar)) +
    zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2);
  return Math.ceil(num / Math.pow(p2 - p1, 2));
}

// Smallest detectable relative MDE for a given n per arm (bisection)
function detectableMde(p1, nAvail, alphaAdj, power, twoSided) {
  if (nAvail < 2) return null;
  let lo = 0.0005, hi = 10;
  if (requiredNPerArm(p1, hi, alphaAdj, power, twoSided) > nAvail) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (requiredNPerArm(p1, mid, alphaAdj, power, twoSided) > nAvail) lo = mid;
    else hi = mid;
  }
  return hi;
}

// SRM: chi-square goodness of fit vs intended allocation (§5)
function srmCheck(counts, allocPcts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let chi = 0;
  counts.forEach((obs, i) => {
    const exp = total * (allocPcts[i] / 100);
    if (exp > 0) chi += Math.pow(obs - exp, 2) / exp;
  });
  const df = counts.length - 1;
  const p = chiSqPValue(chi, df);
  return { chi, df, p, flagged: p < 0.01 };
}

/* ──────────────────────── Formatting (§8.4) ───────────────────── */

const fmtInt = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString("en-GB") : "—";
const fmtPct = (x, dp = 2) => Number.isFinite(x) ? `${(x * 100).toFixed(dp)}%` : "—";
const fmtSignedPct = (x, dp = 2) =>
  Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(dp)}%` : "—";
const fmtP = (p) => !Number.isFinite(p) ? "—" : p < 0.0001 ? "< 0.0001" : p.toFixed(4);
const fmtMoney = (x, dp = 2) =>
  Number.isFinite(x) ? x.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "—";

/* ─────────────────────── Export helpers ───────────────────────── */

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv(rows) {
  // rows: array of arrays. Escape quotes/commas.
  return rows.map(r => r.map(cell => {
    const s = cell == null ? "" : String(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");
}

const stamp = () => new Date().toISOString().slice(0, 10);

// Load jsPDF once, on demand
let _jspdfPromise = null;
function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (_jspdfPromise) return _jspdfPromise;
  _jspdfPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => reject(new Error("Couldn't load the PDF library — check your connection."));
    document.head.appendChild(s);
  });
  return _jspdfPromise;
}

async function exportPdf(title, sections) {
  // sections: [{ heading, lines: [string] }]
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const M = 48; let y = M;
  const page = doc.internal.pageSize;
  const nl = (h) => { y += h; if (y > page.getHeight() - M) { doc.addPage(); y = M; } };

  // Draw Logo
  const brandColor = [220, 0, 74];
  doc.setDrawColor(...brandColor);
  doc.setFillColor(...brandColor);
  // Simple eclipse icon: a circle
  doc.circle(M + 10, y + 10, 10, "F");
  // A white cutout to make it look like an eclipse
  doc.setFillColor(255, 255, 255);
  doc.circle(M + 14, y + 10, 8, "F");

  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(...brandColor);
  doc.text("eclipse", M + 28, y + 16); nl(32);

  doc.setTextColor(28, 19, 40); doc.setFontSize(14);
  doc.text(title, M, y); nl(10);
  doc.setDrawColor(233, 230, 240); doc.line(M, y, page.getWidth() - M, y); nl(20);
  sections.forEach(sec => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(74, 55, 135);
    doc.text(sec.heading, M, y); nl(16);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(40, 36, 48);
    sec.lines.forEach(line => {
      const wrapped = doc.splitTextToSize(line, page.getWidth() - 2 * M);
      wrapped.forEach(w => { doc.text(w, M, y); nl(15); });
    });
    nl(8);
  });
  doc.setFontSize(8.5); doc.setTextColor(140, 140, 150);
  doc.text(`Generated ${new Date().toLocaleString("en-GB")}`, M, page.getHeight() - 28);
  doc.save(`eclipse-${title.toLowerCase().replace(/[^a-z]+/g, "-")}-${stamp()}.pdf`);
}

function ExportButtons({ onCsv, onPdf }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="export-row">
      <button type="button" className="btn-export" onClick={onCsv}>
        <span aria-hidden="true">⤓</span> CSV
      </button>
      <button type="button" className="btn-export" disabled={pdfBusy}
        onClick={async () => {
          setErr(""); setPdfBusy(true);
          try { await onPdf(); } catch (e) { setErr(e.message); }
          setPdfBusy(false);
        }}>
        <span aria-hidden="true">⤓</span> {pdfBusy ? "Preparing…" : "PDF"}
      </button>
      {err && <span className="export-err" role="alert">{err}</span>}
    </div>
  );
}

/* ─────────────────── Educational copy (§7.1) ──────────────────── */

const EXPLAINERS = {
  pvalue: {
    label: "What is a p-value?",
    body: "If there were truly no difference between the variant and control, the p-value is the chance you'd still see a gap at least this large just from randomness. Smaller means harder to explain by chance. Example: p = 0.0300 means a gap this big would appear about 3 times in 100 even if nothing had really changed.",
  },
  confidence: {
    label: "What does the confidence level mean?",
    body: "Confidence protects you from shipping a fluke. It sets how sure you need to be before calling a variant a winner. At 95%, you accept a 1-in-20 risk of declaring a winner when the variant actually does nothing — meaning you'd roll out a change that won't deliver, and any revenue forecast built on it falls flat. At 99% that risk drops to 1-in-100 but you need more traffic to get there; at 90% it rises to 1-in-10. 95% is the standard business trade-off; use 99% when a wrong call is expensive to reverse.",
  },
  power: {
    label: "What is statistical power?",
    lead: "Power is your protection against missing a winner — the chance your test spots a real improvement instead of coming back flat.",
    bullets: [
      "70% power: a 3-in-10 chance a genuine winner looks like nothing. Fastest, but riskiest.",
      "80% power: a 1-in-5 chance of missing a real winner. The usual business trade-off.",
      "90% power: only a 1-in-10 chance of missing it, but needs more visitors and a longer test.",
    ],
    foot: "Higher power means you're less likely to scrap a change that was actually working — at the cost of more traffic.",
  },
  mde: {
    label: "What is the minimum detectable effect?",
    body: "The smallest uplift worth detecting, expressed as a percentage of your current rate (a relative uplift). Example: a 10% MDE on a 2.00% baseline conversion rate means designing the test to detect a move from 2.00% to 2.20%. Smaller MDEs need much more traffic.",
  },
  srm: {
    label: "What is a sample ratio mismatch?",
    body: "When traffic doesn't split the way the experiment was set up to split it — for example, you planned 50/50 but on very large numbers got a split too lopsided to be random. It's usually caused by a setup problem: redirect bugs, bot filtering that treats variants differently, or lost tracking. When it happens, the groups may not be comparable, so results are unreliable. This check uses a chi-square test against your planned split, so it works for any number of variants and for unequal splits.",
  },
  tailed: {
    label: "One-tailed vs two-tailed — which should I use?",
    body: "A two-tailed test asks 'is the variant different — better or worse?'. A one-tailed test asks only 'is the variant better?'. Use one-tailed only when a decrease would be acted on exactly the same way as no change at all. If a drop would worry you, that's a two-tailed question. The default here is two-tailed.",
  },
  holm: {
    label: "Why do extra variants need a correction?",
    body: "Every variant compared against control is another opportunity for a fluke result. With 3 variants that's 3 comparisons, so the chance of at least one false alarm rises well above your chosen level. The Holm–Bonferroni correction raises the bar for each comparison so the overall false-alarm rate stays where you set it. It's applied automatically here whenever you test more than one variant.",
  },
  ztest: {
    label: "What is a z-test?",
    body: "The test used for comparing proportions — counts out of totals, like conversion rate. Example: 190 conversions from 10,000 visitors vs 230 from 10,000. It asks whether a gap between two rates is bigger than randomness alone would explain.",
  },
  ttest: {
    label: "What is a t-test?",
    body: "The test used for comparing averages of continuous values, like revenue per visitor (£1.84 vs £2.01). This calculator uses Welch's version, which allows the two groups to vary by different amounts — the safer choice for revenue data.",
  },
  metrics: {
    label: "CVR, RPV and AOV — definitions",
    body: "CVR (conversion rate) = conversions ÷ visitors. RPV (revenue per visitor) = total revenue ÷ all visitors, including those who bought nothing. AOV (average order value) = total revenue ÷ orders, so it only looks at buyers.",
  },
  confpct: {
    label: "What does the confidence % mean?",
    body: "It's how close the result is to being statistically significant — calculated as 100% minus the p-value. A result at 95% confidence has cleared the usual significance bar. Important: this is NOT the chance the variant will win. A variant at 70% confidence hasn't 'won 70% of the time' — it just hasn't yet gathered enough evidence to be called significant. Use it as a progress reading, not a probability of success.",
  },
  aovrpv: {
    label: "Why can AOV and RPV disagree?",
    body: "AOV only counts people who purchased. A variant that persuades extra people to make small purchases pushes conversion and revenue per visitor up while pulling average order value down. RPV reflects the full effect on every visitor, which is why it's usually the primary revenue metric.",
  },
  mdeabs: {
    label: "Relative vs absolute — what's the difference?",
    body: "Relative uplift is expressed as a percentage of your baseline; absolute uplift is the change in percentage points. Example: a 10% relative uplift on a 2.00% baseline is the same as a 0.20 percentage-point absolute change (2.00% → 2.20%). This calculator uses relative as the input because it's how most teams describe a target ('a 10% lift'); the absolute equivalent is shown so you can sense-check it.",
  },
  noninf: {
    label: "What is a non-inferiority test?",
    body: "Most tests ask 'is the variant better?'. A non-inferiority test asks the opposite: 'can I be confident the variant is NOT meaningfully worse?'. You'd use it when you want to ship a change for some other reason — simpler code, lower cost, a nicer design — and just need to confirm it doesn't hurt conversion by more than an amount you can live with. You set that amount as the margin. Example: a 1% margin means you'll accept the variant as long as you're confident it isn't more than 1% (relative) below control.",
  },
  winsorize: {
    label: "What is capping outliers?",
    body: "Revenue data often contains 'whales' — a few customers who spend 10x or 100x more than the average. These outliers can skew your results and make a variant look like a winner just because one person made a huge purchase. Capping (Winsorizing) replaces these extreme values with a lower threshold (the 99th percentile), making your statistical test more robust and reliable.",
  },
};

/* ─────────────────────── Shared UI pieces ─────────────────────── */

function Explainer({ id, inline }) {
  const [open, setOpen] = useState(false);
  const e = EXPLAINERS[id];
  if (!e) return null;
  return (
    <div className={`explainer ${inline ? "explainer-inline" : ""}`}>
      <button
        type="button"
        className="explainer-toggle"
        aria-expanded={open}
        aria-controls={`exp-${id}-${inline ? "i" : "b"}`}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true" className="exp-ring">?</span>
        <span className="exp-label">{e.label}</span>
      </button>
      {open && (
        <div id={`exp-${id}-${inline ? "i" : "b"}`} className="explainer-body">
          {e.body && <span>{e.body}</span>}
          {e.lead && <p className="exp-lead">{e.lead}</p>}
          {e.bullets && (
            <ul className="exp-bullets">
              {e.bullets.map((b, j) => <li key={j}>{b}</li>)}
            </ul>
          )}
          {e.foot && <p className="exp-foot">{e.foot}</p>}
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {hint && <div className="field-hint">{hint}</div>}
      {children}
      {error && <div className="field-error" role="alert">{error}</div>}
    </div>
  );
}

function Verdict({ kind, txtOverride }) {
  const map = {
    winner: { txt: "Significant winner", icon: "▲", cls: "v-win" },
    loser: { txt: "Significant loser", icon: "▼", cls: "v-lose" },
    ns: { txt: "Not significant", icon: "○", cls: "v-ns" },
  };
  const v = map[kind];
  return (
    <span className={`verdict ${v.cls}`}>
      <span aria-hidden="true" className="verdict-icon">{v.icon}</span>
      {txtOverride || v.txt}
    </span>
  );
}

function SegControl({ legend, options, value, onChange, name, explainerId }) {
  return (
    <fieldset className="seg">
      <legend className="seg-legend">{legend}</legend>
      <div className="seg-row" role="radiogroup" aria-label={legend}>
        {options.map((o) => (
          <label key={o.value} className={`seg-opt ${value === o.value ? "seg-on" : ""}`}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
      {explainerId && <Explainer id={explainerId} inline />}
    </fieldset>
  );
}

function EclipseWordmark() {
  return (
    <div className="brand" role="img" aria-label="Eclipse">
      <svg className="brand-logo" viewBox="0 0 342.86 100" height="34" aria-hidden="true">
        <path d="M 260.14 80.73 L 254.14 80.73 L 253.92 79.85 L 248.80 79.85 L 248.58 78.96 L 247.03 78.96 L 246.80 78.08 L 245.25 78.08 L 245.03 77.20 L 243.47 77.20 L 243.36 76.43 L 242.47 76.21 L 241.47 74.56 L 239.91 74.56 L 239.80 73.79 L 238.91 73.57 L 238.91 72.03 L 237.13 70.93 L 237.13 69.38 L 236.24 69.16 L 236.24 67.62 L 235.35 67.40 L 235.35 65.86 L 234.46 65.64 L 234.46 64.10 L 236.13 63.99 L 236.35 63.11 L 238.80 63.11 L 239.02 62.22 L 242.36 62.22 L 242.58 61.34 L 245.03 61.34 L 245.25 60.46 L 246.03 60.57 L 246.03 62.11 L 246.91 62.33 L 246.91 63.88 L 248.69 64.98 L 248.69 66.52 L 249.47 66.63 L 249.58 67.40 L 250.36 67.51 L 250.58 68.39 L 252.14 68.39 L 252.36 69.27 L 254.81 69.27 L 255.03 70.15 L 259.26 70.15 L 259.48 69.27 L 261.92 69.27 L 262.92 67.62 L 263.70 67.51 L 263.81 66.74 L 265.59 65.64 L 265.59 60.57 L 264.81 60.46 L 264.70 59.69 L 263.92 59.58 L 263.81 58.81 L 263.04 58.70 L 261.92 56.94 L 259.48 56.94 L 259.26 56.06 L 257.70 56.06 L 257.48 55.18 L 255.03 55.18 L 254.81 54.30 L 252.36 54.30 L 252.14 53.41 L 249.69 53.41 L 249.47 52.53 L 247.92 52.53 L 247.69 51.65 L 246.14 51.65 L 245.91 50.77 L 244.36 50.77 L 243.25 49.01 L 241.69 49.01 L 241.47 48.13 L 240.69 48.02 L 240.69 46.48 L 239.91 46.37 L 239.80 45.59 L 238.02 44.49 L 238.02 42.07 L 237.13 41.85 L 237.13 37.67 L 236.24 37.44 L 236.24 35.02 L 237.13 34.80 L 237.13 30.62 L 238.02 30.40 L 238.02 28.85 L 238.91 28.63 L 238.91 27.09 L 239.80 26.87 L 239.80 26.21 L 240.58 26.10 L 240.69 25.33 L 241.47 25.22 L 241.58 24.45 L 242.36 24.34 L 243.47 22.58 L 245.03 22.58 L 245.25 21.70 L 246.80 21.70 L 247.03 20.81 L 249.47 20.81 L 249.69 19.93 L 257.48 19.93 L 257.70 19.05 L 258.37 19.05 L 258.59 19.93 L 263.70 19.93 L 263.92 20.81 L 265.48 20.81 L 265.70 21.70 L 267.26 21.70 L 267.48 22.58 L 269.04 22.58 L 269.26 23.46 L 270.82 23.46 L 271.04 24.34 L 272.71 25.33 L 272.71 26.87 L 273.49 26.98 L 273.60 27.75 L 275.38 28.85 L 275.38 30.40 L 276.26 30.62 L 276.26 32.16 L 277.15 32.38 L 277.04 34.03 L 275.49 34.03 L 275.26 34.91 L 272.82 34.91 L 272.60 35.79 L 269.26 35.79 L 269.04 36.67 L 265.70 36.67 L 265.48 35.79 L 264.70 35.68 L 264.70 34.14 L 263.92 34.03 L 262.92 32.38 L 262.03 32.16 L 261.92 31.39 L 260.37 31.39 L 260.14 30.51 L 253.25 30.51 L 253.03 31.39 L 251.47 31.39 L 251.25 32.27 L 249.58 32.38 L 249.58 34.80 L 248.69 35.02 L 248.69 37.44 L 249.58 37.67 L 249.58 39.21 L 250.36 39.32 L 250.47 40.09 L 251.25 40.20 L 252.36 41.96 L 253.92 41.96 L 254.14 42.84 L 256.59 42.84 L 256.81 43.72 L 259.26 43.72 L 259.48 44.60 L 261.92 44.60 L 262.15 45.48 L 263.70 45.48 L 263.92 46.37 L 266.37 46.37 L 266.59 47.25 L 268.15 47.25 L 268.37 48.13 L 269.93 48.13 L 270.04 48.90 L 270.82 49.01 L 271.93 50.77 L 273.49 50.77 L 273.71 51.65 L 275.38 52.64 L 275.38 54.19 L 276.26 54.41 L 276.26 55.95 L 277.15 56.17 L 277.15 57.71 L 278.04 57.93 L 278.04 67.40 L 277.15 67.62 L 277.15 70.04 L 276.26 70.26 L 276.26 71.81 L 275.49 71.92 L 275.38 72.69 L 274.60 72.80 L 274.37 73.68 L 273.71 73.68 L 273.49 74.56 L 272.82 74.56 L 271.82 76.21 L 270.93 76.43 L 270.82 77.20 L 269.26 77.20 L 269.04 78.08 L 267.48 78.08 L 267.26 78.96 L 264.81 78.96 L 264.59 79.85 L 260.37 79.85 L 260.14 80.73 Z M 100.06 80.73 L 92.27 80.73 L 92.05 79.85 L 87.83 79.85 L 87.60 78.96 L 84.27 78.96 L 84.05 78.08 L 82.49 78.08 L 82.27 77.20 L 80.71 77.20 L 80.49 76.32 L 78.93 76.32 L 77.82 74.56 L 76.26 74.56 L 76.15 73.79 L 75.38 73.68 L 75.26 72.91 L 74.49 72.80 L 73.49 71.15 L 71.71 70.04 L 71.60 69.27 L 70.82 69.16 L 70.82 67.62 L 69.04 66.52 L 69.04 64.98 L 68.15 64.76 L 68.15 63.22 L 67.26 63.00 L 67.26 60.57 L 66.37 60.35 L 66.37 57.93 L 65.48 57.71 L 65.48 53.52 L 64.59 53.30 L 64.59 47.36 L 65.48 47.14 L 65.48 42.07 L 66.37 41.85 L 66.37 39.43 L 67.26 39.21 L 67.26 36.78 L 68.15 36.56 L 68.15 35.02 L 69.04 34.80 L 69.04 33.26 L 70.82 32.16 L 70.82 30.62 L 71.60 30.51 L 71.71 29.74 L 72.60 29.52 L 72.60 28.85 L 73.37 28.74 L 73.49 27.97 L 74.26 27.86 L 75.38 26.10 L 76.93 26.10 L 77.04 25.33 L 77.82 25.22 L 78.93 23.46 L 81.38 23.46 L 81.60 22.58 L 83.16 22.58 L 83.38 21.70 L 84.94 21.70 L 85.16 20.81 L 87.60 20.81 L 87.83 19.93 L 104.50 19.93 L 104.72 20.81 L 107.17 20.81 L 107.39 21.70 L 109.84 21.70 L 110.06 22.58 L 111.62 22.58 L 111.84 23.46 L 113.40 23.46 L 114.51 25.22 L 116.06 25.22 L 117.18 26.98 L 117.84 26.98 L 117.95 27.75 L 119.73 28.85 L 119.73 29.52 L 121.51 30.62 L 121.51 32.16 L 122.40 32.38 L 122.40 33.92 L 123.29 34.14 L 123.29 35.68 L 124.18 35.90 L 124.07 36.67 L 122.51 36.67 L 122.29 37.56 L 120.73 37.56 L 120.51 38.44 L 118.95 38.44 L 118.73 39.32 L 116.29 39.32 L 116.06 40.20 L 114.51 40.20 L 114.40 40.97 L 113.62 41.08 L 113.40 40.20 L 111.84 40.20 L 111.73 39.43 L 109.95 38.33 L 109.84 36.67 L 108.28 36.67 L 108.17 35.90 L 106.50 34.91 L 106.28 34.03 L 104.72 34.03 L 104.50 33.15 L 102.95 33.15 L 102.72 32.27 L 100.28 32.27 L 100.06 31.39 L 92.27 31.39 L 92.05 32.27 L 89.61 32.27 L 89.38 33.15 L 87.83 33.15 L 87.60 34.03 L 86.05 34.03 L 84.94 35.79 L 83.38 35.79 L 83.27 36.56 L 81.49 37.67 L 81.49 39.21 L 80.60 39.43 L 80.60 40.97 L 79.71 41.19 L 79.71 42.73 L 78.82 42.95 L 78.82 45.37 L 77.93 45.59 L 77.93 54.19 L 78.82 54.41 L 78.82 57.71 L 79.71 57.93 L 79.71 59.47 L 81.49 60.57 L 81.49 62.11 L 83.16 63.11 L 83.38 63.99 L 84.05 63.99 L 84.27 64.87 L 85.83 64.87 L 86.94 66.63 L 88.49 66.63 L 88.72 67.51 L 91.16 67.51 L 91.38 68.39 L 100.94 68.39 L 101.17 67.51 L 103.61 67.51 L 103.84 66.63 L 105.39 66.63 L 105.61 65.75 L 107.17 65.75 L 107.28 64.98 L 108.06 64.87 L 108.17 64.10 L 108.95 63.99 L 109.06 63.22 L 110.84 62.11 L 110.95 61.34 L 111.73 61.23 L 111.73 59.69 L 112.51 59.58 L 112.73 58.70 L 115.18 58.70 L 115.40 59.58 L 117.84 59.58 L 118.07 60.46 L 119.62 60.46 L 119.84 61.34 L 122.29 61.34 L 122.51 62.22 L 124.18 62.33 L 124.18 64.76 L 123.29 64.98 L 123.29 66.52 L 122.40 66.74 L 122.40 68.28 L 121.62 68.39 L 120.51 70.15 L 119.84 70.15 L 119.73 70.93 L 118.95 71.04 L 118.84 71.81 L 118.07 71.92 L 117.95 72.69 L 117.18 72.80 L 116.06 74.56 L 114.51 74.56 L 113.40 76.32 L 111.84 76.32 L 111.62 77.20 L 110.06 77.20 L 109.84 78.08 L 107.39 78.08 L 107.17 78.96 L 104.72 78.96 L 104.50 79.85 L 100.28 79.85 L 100.06 80.73 Z M 316.18 80.73 L 308.39 80.73 L 308.17 79.85 L 303.06 79.85 L 302.83 78.96 L 299.50 78.96 L 299.28 78.08 L 297.72 78.08 L 297.50 77.20 L 295.94 77.20 L 295.72 76.32 L 294.16 76.32 L 293.94 75.44 L 292.38 75.44 L 292.27 74.67 L 291.38 74.45 L 290.38 72.80 L 288.72 72.69 L 288.72 71.15 L 287.94 71.04 L 287.72 70.15 L 287.05 70.15 L 286.94 69.38 L 285.16 68.28 L 285.16 66.74 L 283.38 65.64 L 283.38 64.10 L 282.49 63.88 L 282.49 61.45 L 281.60 61.23 L 281.60 58.81 L 280.71 58.59 L 280.71 55.29 L 279.82 55.07 L 279.82 45.59 L 280.71 45.37 L 280.71 41.19 L 281.60 40.97 L 281.60 38.55 L 282.49 38.33 L 282.49 36.78 L 283.38 36.56 L 283.38 35.02 L 284.27 34.80 L 284.27 33.26 L 285.16 33.04 L 285.16 31.50 L 285.94 31.39 L 286.05 30.62 L 286.83 30.51 L 287.94 28.74 L 288.72 28.63 L 288.72 27.97 L 289.49 27.86 L 289.61 27.09 L 290.38 26.98 L 291.50 25.22 L 293.05 25.22 L 294.16 23.46 L 295.72 23.46 L 295.94 22.58 L 297.50 22.58 L 297.72 21.70 L 300.17 21.70 L 300.39 20.81 L 302.83 20.81 L 303.06 19.93 L 318.84 19.93 L 319.07 20.81 L 322.40 20.81 L 322.62 21.70 L 324.18 21.70 L 324.40 22.58 L 325.96 22.58 L 326.18 23.46 L 327.74 23.46 L 327.96 24.34 L 329.52 24.34 L 329.63 25.11 L 330.41 25.22 L 330.52 25.99 L 331.30 26.10 L 331.41 26.87 L 333.19 27.97 L 333.30 28.74 L 333.96 28.74 L 334.19 29.63 L 334.85 29.63 L 334.96 30.40 L 335.74 30.51 L 335.85 31.28 L 337.63 32.38 L 337.63 33.92 L 338.52 34.14 L 338.52 35.68 L 339.41 35.90 L 339.41 37.44 L 340.30 37.67 L 340.30 40.97 L 341.19 41.19 L 341.19 44.49 L 342.08 44.71 L 341.97 54.30 L 293.16 54.41 L 293.16 56.83 L 294.05 57.05 L 294.05 59.47 L 295.83 60.57 L 295.83 62.11 L 296.72 62.33 L 296.72 63.00 L 297.50 63.11 L 297.61 63.88 L 298.39 63.99 L 298.50 64.76 L 299.28 64.87 L 300.39 66.63 L 301.95 66.63 L 302.17 67.51 L 304.61 67.51 L 304.84 68.39 L 307.28 68.39 L 307.50 69.27 L 316.18 69.27 L 316.40 68.39 L 319.73 68.39 L 319.96 67.51 L 322.40 67.51 L 323.51 65.75 L 325.07 65.75 L 325.29 64.87 L 325.96 64.87 L 326.18 63.99 L 327.85 63.00 L 327.96 62.22 L 329.52 62.22 L 329.74 60.46 L 330.52 60.57 L 330.63 61.34 L 332.18 61.34 L 332.41 62.22 L 333.96 62.22 L 335.08 63.99 L 336.63 63.99 L 336.85 64.87 L 338.41 64.87 L 338.52 65.64 L 339.41 65.86 L 339.41 68.28 L 338.63 68.39 L 338.52 69.16 L 336.74 70.26 L 336.74 70.93 L 335.85 71.15 L 335.85 71.81 L 334.96 72.03 L 334.96 72.69 L 334.19 72.80 L 333.07 74.56 L 331.52 74.56 L 330.41 76.32 L 328.85 76.32 L 328.63 77.20 L 327.07 77.20 L 326.85 78.08 L 324.40 78.08 L 324.18 78.96 L 321.73 78.96 L 321.51 79.85 L 316.40 79.85 L 316.18 80.73 Z M 11.12 72.80 L 10.45 72.80 L 10.23 71.92 L 8.56 71.81 L 8.56 70.26 L 7.78 70.15 L 6.67 68.39 L 5.89 68.28 L 5.89 66.74 L 4.11 65.64 L 4.11 64.10 L 3.22 63.88 L 3.22 61.45 L 2.33 61.23 L 2.33 58.81 L 1.45 58.59 L 1.45 54.41 L 0.56 54.19 L 0.56 47.36 L 1.45 47.14 L 1.45 42.07 L 2.33 41.85 L 2.33 38.55 L 3.22 38.33 L 3.22 36.78 L 4.11 36.56 L 4.11 35.02 L 5.00 34.80 L 5.00 33.26 L 6.78 32.16 L 6.78 30.62 L 7.56 30.51 L 7.67 29.74 L 8.56 29.52 L 9.56 27.86 L 10.23 27.86 L 10.45 26.98 L 12.12 27.97 L 12.23 42.84 L 13.01 42.73 L 13.01 41.19 L 13.90 40.97 L 13.90 39.43 L 14.67 39.32 L 15.79 37.56 L 16.56 37.44 L 16.56 35.90 L 17.34 35.79 L 17.57 34.91 L 19.12 34.91 L 19.34 34.03 L 20.01 34.03 L 20.23 44.60 L 48.47 44.60 L 48.58 42.95 L 47.69 42.73 L 47.69 40.31 L 46.80 40.09 L 46.80 38.55 L 45.03 37.44 L 45.03 35.90 L 44.25 35.79 L 43.14 34.03 L 41.58 34.03 L 40.47 32.27 L 38.02 32.27 L 37.80 31.39 L 35.35 31.39 L 35.13 30.51 L 27.35 30.51 L 27.13 31.39 L 23.79 31.39 L 23.57 32.27 L 22.01 32.27 L 21.79 33.15 L 20.23 33.15 L 20.12 20.93 L 22.68 20.81 L 22.90 19.93 L 29.79 19.93 L 30.02 19.05 L 30.68 19.05 L 30.91 19.93 L 38.69 19.93 L 38.91 20.81 L 41.36 20.81 L 41.58 21.70 L 44.02 21.70 L 44.25 22.58 L 45.80 22.58 L 46.03 23.46 L 47.58 23.46 L 48.69 25.22 L 50.25 25.22 L 50.36 25.99 L 52.14 27.09 L 52.14 27.75 L 52.92 27.86 L 53.14 28.74 L 53.81 28.74 L 53.92 29.52 L 54.70 29.63 L 55.81 31.39 L 56.59 31.50 L 56.59 33.04 L 57.48 33.26 L 57.48 34.80 L 59.26 35.90 L 59.26 38.33 L 60.14 38.55 L 60.14 40.97 L 61.03 41.19 L 61.03 46.26 L 61.92 46.48 L 61.92 52.42 L 61.03 52.64 L 61.03 54.19 L 21.12 54.30 L 21.01 55.07 L 20.12 55.29 L 20.01 65.75 L 19.34 65.75 L 18.23 63.99 L 16.56 63.88 L 16.56 62.33 L 15.79 62.22 L 15.68 61.45 L 13.90 60.35 L 13.90 58.81 L 13.01 58.59 L 13.01 57.05 L 12.23 56.94 L 12.12 71.81 L 11.34 71.92 L 11.12 72.80 Z M 182.77 99.23 L 171.43 99.23 L 171.21 98.35 L 169.54 97.36 L 169.54 22.69 L 170.43 22.47 L 170.54 20.81 L 181.88 20.81 L 181.99 24.23 L 182.88 24.45 L 182.88 27.75 L 183.66 27.86 L 183.77 27.09 L 185.44 26.10 L 185.66 25.22 L 187.22 25.22 L 188.33 23.46 L 189.88 23.46 L 190.11 22.58 L 191.66 22.58 L 191.88 21.70 L 193.44 21.70 L 193.66 20.81 L 196.11 20.81 L 196.33 19.93 L 211.23 19.93 L 211.45 20.81 L 213.90 20.81 L 214.12 21.70 L 216.56 21.70 L 216.79 22.58 L 218.34 22.58 L 219.46 24.34 L 221.01 24.34 L 221.23 25.22 L 222.90 26.21 L 223.01 26.98 L 224.57 26.98 L 224.68 27.75 L 225.57 27.97 L 225.57 29.52 L 226.35 29.63 L 226.57 30.51 L 228.24 31.50 L 228.24 33.04 L 229.13 33.26 L 229.13 34.80 L 230.02 35.02 L 230.02 36.56 L 230.91 36.78 L 230.91 38.33 L 231.80 38.55 L 231.80 40.97 L 232.68 41.19 L 232.68 45.37 L 233.57 45.59 L 233.57 54.19 L 232.68 54.41 L 232.68 58.59 L 231.80 58.81 L 231.80 61.23 L 230.91 61.45 L 230.91 63.88 L 230.02 64.10 L 230.02 65.64 L 228.24 66.74 L 228.24 68.28 L 227.46 68.39 L 227.35 69.16 L 226.57 69.27 L 226.46 70.04 L 224.68 71.15 L 224.68 72.69 L 223.79 72.91 L 223.68 73.68 L 222.12 73.68 L 222.01 74.45 L 221.23 74.56 L 220.12 76.32 L 218.57 76.32 L 218.34 77.20 L 216.79 77.20 L 216.56 78.08 L 214.12 78.08 L 213.90 78.96 L 212.34 78.96 L 212.12 79.85 L 207.00 79.85 L 206.78 80.73 L 199.89 80.73 L 199.67 79.85 L 195.44 79.85 L 195.22 78.96 L 192.77 78.96 L 192.55 78.08 L 190.99 78.08 L 190.77 77.20 L 189.22 77.20 L 188.10 75.44 L 186.55 75.44 L 186.44 74.67 L 184.66 73.57 L 184.55 72.80 L 182.99 72.80 L 182.77 99.23 Z M 206.89 68.28 L 207.00 67.51 L 209.45 67.51 L 209.67 66.63 L 211.23 66.63 L 211.45 65.75 L 213.01 65.75 L 213.12 64.98 L 213.90 64.87 L 214.12 63.99 L 214.79 63.99 L 214.90 63.22 L 216.68 62.11 L 216.68 60.57 L 218.45 59.47 L 218.45 57.93 L 219.34 57.71 L 219.34 54.41 L 220.23 54.19 L 220.23 45.59 L 219.34 45.37 L 219.34 42.95 L 218.45 42.73 L 218.45 41.19 L 217.57 40.97 L 217.57 39.43 L 216.68 39.21 L 216.68 37.67 L 215.01 37.56 L 214.79 36.67 L 214.12 36.67 L 214.01 35.90 L 212.23 34.80 L 212.12 34.03 L 210.56 34.03 L 210.34 33.15 L 208.78 33.15 L 208.56 32.27 L 206.11 32.27 L 205.89 31.39 L 198.11 31.39 L 197.89 32.27 L 194.55 32.27 L 194.33 33.15 L 192.77 33.15 L 191.66 34.91 L 190.11 34.91 L 189.99 35.68 L 189.22 35.79 L 189.11 36.56 L 188.33 36.67 L 187.22 38.44 L 186.44 38.55 L 186.44 40.09 L 184.66 41.19 L 184.66 43.61 L 183.77 43.83 L 183.77 47.14 L 182.88 47.36 L 182.88 52.42 L 183.77 52.64 L 183.77 56.83 L 184.66 57.05 L 184.66 58.59 L 185.55 58.81 L 185.55 60.35 L 186.44 60.57 L 186.44 61.23 L 187.33 61.45 L 187.33 62.11 L 188.22 62.33 L 188.22 63.00 L 188.99 63.11 L 189.11 63.88 L 189.88 63.99 L 190.99 65.75 L 192.55 65.75 L 192.77 66.63 L 194.33 66.63 L 194.55 67.51 L 197.00 67.51 L 197.22 68.39 L 206.89 68.28 Z M 36.02 80.73 L 28.24 80.73 L 28.02 79.85 L 22.01 79.85 L 21.79 78.96 L 20.23 78.96 L 20.12 66.74 L 21.79 66.63 L 22.01 67.51 L 23.57 67.51 L 23.79 68.39 L 27.13 68.39 L 27.35 69.27 L 36.02 69.27 L 36.24 68.39 L 39.58 68.39 L 39.80 67.51 L 41.36 67.51 L 41.58 66.63 L 43.14 66.63 L 44.25 64.87 L 45.80 64.87 L 45.91 64.10 L 47.69 63.00 L 47.69 61.45 L 48.47 61.34 L 48.69 60.46 L 50.25 60.46 L 50.47 61.34 L 52.03 61.34 L 52.25 62.22 L 53.81 62.22 L 54.92 63.99 L 56.48 63.99 L 57.59 65.75 L 59.26 65.86 L 59.26 67.40 L 58.37 67.62 L 58.37 69.16 L 57.59 69.27 L 57.48 70.04 L 56.70 70.15 L 56.59 70.93 L 55.81 71.04 L 55.70 71.81 L 54.92 71.92 L 53.81 73.68 L 53.14 73.68 L 52.92 74.56 L 51.36 74.56 L 50.25 76.32 L 48.69 76.32 L 48.47 77.20 L 46.91 77.20 L 46.69 78.08 L 44.25 78.08 L 44.02 78.96 L 41.58 78.96 L 41.36 79.85 L 36.24 79.85 L 36.02 80.73 Z M 328.74 44.49 L 328.74 42.07 L 327.85 41.85 L 327.85 40.31 L 326.96 40.09 L 326.96 38.55 L 326.07 38.33 L 326.07 36.78 L 325.18 36.56 L 325.18 35.90 L 324.29 35.68 L 323.29 34.03 L 321.73 34.03 L 320.62 32.27 L 318.18 32.27 L 317.95 31.39 L 315.51 31.39 L 315.29 30.51 L 307.50 30.51 L 307.28 31.39 L 303.95 31.39 L 303.72 32.27 L 302.17 32.27 L 301.95 33.15 L 300.39 33.15 L 300.28 33.92 L 299.50 34.03 L 299.39 34.80 L 298.61 34.91 L 298.50 35.68 L 297.72 35.79 L 296.61 37.56 L 295.83 37.67 L 295.83 39.21 L 294.94 39.43 L 294.94 40.97 L 294.05 41.19 L 294.05 42.73 L 293.16 42.95 L 293.27 44.60 L 328.74 44.49 Z M 162.31 78.96 L 149.08 78.85 L 149.08 21.81 L 149.86 21.70 L 150.08 20.81 L 162.42 20.93 L 162.31 78.96 Z M 162.31 13.77 L 149.08 13.66 L 149.19 0.55 L 162.42 0.66 L 162.31 13.77 Z M 140.97 78.96 L 127.74 78.85 L 127.85 0.55 L 141.08 0.66 L 140.97 78.96 Z" fill="var(--pink)" fillRule="evenodd" />
      </svg>
    </div>
  );
}

/* ─────────────── Allocation editor (default 100/n) ────────────── */

function AllocationEditor({ alloc, setAlloc, labels, idPrefix }) {
  const sum = alloc.reduce((a, b) => a + (Number(b) || 0), 0);
  const bad = Math.abs(sum - 100) > 0.5;
  return (
    <div className="alloc">
      <div className="alloc-grid">
        {alloc.map((v, i) => (
          <div key={i} className="alloc-cell">
            <label className="field-label" htmlFor={`${idPrefix}-alloc-${i}`}>{labels[i]} %</label>
            <input
              id={`${idPrefix}-alloc-${i}`}
              className="input"
              type="number" min="0" max="100" step="0.1"
              value={v}
              onChange={(e) => {
                const next = alloc.slice();
                next[i] = e.target.value;
                setAlloc(next);
              }}
            />
          </div>
        ))}
      </div>
      {bad && (
        <div className="field-error" role="alert">
          Allocation must add up to 100% — currently {sum.toFixed(1)}%.
        </div>
      )}
    </div>
  );
}

const equalSplit = (k) =>
  Array.from({ length: k }, () => Math.round((100 / k) * 100) / 100);

// Variant labels: control is Variant A, challengers B, C, D… (industry standard A/B/n).
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const variantLabelFull = (i) => i === 0 ? "Variant A (Control)" : `Variant ${LETTERS[i]}`;
const makeLabels = (k) => Array.from({ length: k }, (_, i) => variantLabelFull(i));

/* ──────────────── Traffic split check banner (§5) ─────────────── */

function SrmBanner({ srm }) {
  if (!srm) return null;
  if (!srm.flagged) {
    return (
      <div className="srm-ok" role="status">
        <span aria-hidden="true" className="srm-tick">✓</span> Traffic split looks healthy
      </div>
    );
  }
  return (
    <div className="srm-bad" role="alert">
      <strong>Your traffic didn't split the way it was planned.</strong>
      <p>
        This is known as a sample ratio mismatch. It usually points to a setup issue rather than
        user behaviour — common causes are redirect bugs, bot filtering that treats variants
        differently, or lost tracking on one variant. The groups may not be comparable, so the
        results below may be unreliable. Worth checking the implementation before acting on them.
      </p>
      <Explainer id="srm" />
    </div>
  );
}

/* ──────────── Variant-count stepper (control + variants) ──────── */

function VariantStepper({ k, setVariantCount, idBase }) {
  // k = total number of variants including Variant A (the control). Minimum 2 (A + B).
  const list = Array.from({ length: k }, (_, i) => LETTERS[i]).join(", ");
  return (
    <Field
      label="How many variants? (including control)"
      htmlFor={idBase}
      hint={`Variant A is your control. Testing: ${list}.`}
    >
      <div className="stepper">
        <button type="button" className="btn-step" onClick={() => setVariantCount(k - 1)}
          aria-label="Remove a variant" disabled={k <= 2}>−</button>
        <input id={idBase} className="input input-k" type="number" min="2" max="8" value={k}
          onChange={(e) => setVariantCount(Number(e.target.value) || 2)}
          aria-label="Number of variants including control" />
        <button type="button" className="btn-step" onClick={() => setVariantCount(k + 1)}
          aria-label="Add a variant" disabled={k >= 8}>+</button>
      </div>
    </Field>
  );
}

/* ─────────────────────── PRE_TEST mode (§2) ───────────────────── */

function PreTest({ confidence, twoTailed }) {
  const [baseline, setBaseline] = useState("");
  const [mde, setMde] = useState("");
  const [traffic, setTraffic] = useState("");
  const [period, setPeriod] = useState("week"); // day | week | month
  const [power, setPower] = useState(0.8);
  const [k, setK] = useState(2);
  const [alloc, setAlloc] = useState(equalSplit(2));
  const [calculated, setCalculated] = useState(false);

  const labels = useMemo(
    () => makeLabels(k),
    [k]
  );

  const setVariantCount = (next) => {
    const kk = Math.max(2, Math.min(8, next));
    setK(kk);
    setAlloc(equalSplit(kk));
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setCalculated(false); },
    [baseline, mde, traffic, period, power, k, alloc, confidence, twoTailed]);

  const errors = {};
  const p1 = Number(baseline) / 100;
  const mdeRel = Number(mde) / 100;
  const trafficNum = Number(traffic);
  const perWeekFactor = period === "day" ? 7 : period === "month" ? 12 / 52 : 1;
  const wk = trafficNum * perWeekFactor; // visitors per week, internal
  const mdeAbs = p1 * mdeRel; // absolute (proportion) equivalent for display
  if (!(p1 > 0 && p1 < 1)) errors.baseline = "Enter a baseline conversion rate between 0 and 100 (exclusive).";
  if (!(mdeRel > 0)) errors.mde = "Enter a relative uplift greater than 0.";
  else if (p1 * (1 + mdeRel) >= 1) errors.mde = "Baseline plus this uplift would exceed 100% — lower one of them.";
  if (!(trafficNum > 0)) errors.traffic = "Enter a number of visitors greater than 0.";
  const allocSum = alloc.reduce((a, b) => a + (Number(b) || 0), 0);
  const allocOk = Math.abs(allocSum - 100) <= 0.5 && alloc.every((a) => Number(a) > 0);

  const alpha = 1 - confidence;
  const comparisons = k - 1;
  const alphaAdj = alpha / Math.max(1, comparisons);

  const inputsValid = Object.keys(errors).length === 0 && allocOk;
  let result = null;
  if (calculated && inputsValid) {
    const nPerArm = requiredNPerArm(p1, mdeRel, alphaAdj, power, twoTailed);
    const minAllocFrac = Math.min(...alloc.map((a) => Number(a) / 100));
    const weeks = Math.max(1, Math.ceil(nPerArm / (wk * minAllocFrac)));
    const chart = [];
    for (let w = 1; w <= 12; w++) {
      const nAvail = Math.floor(wk * minAllocFrac * w);
      const d = detectableMde(p1, nAvail, alphaAdj, power, twoTailed);
      chart.push({ week: w, mde: d != null ? +(d * 100).toFixed(2) : null });
    }
    result = { nPerArm, total: nPerArm * k, weeks, chart };
  }

  return (
    <div className="two-col">
      <section className="panel" aria-labelledby="pre-h">
        <h2 id="pre-h" className="panel-title">Plan your test</h2>

        <Field label="Baseline conversion rate (%)" htmlFor="pre-baseline" error={errors.baseline}
          hint="Your current conversion rate, before the test.">
          <input id="pre-baseline" className="input" type="number" min="0" max="100" step="0.01" placeholder="e.g. 2.0"
            value={baseline} onChange={(e) => setBaseline(e.target.value)} />
        </Field>

        <Field
          label="Minimum detectable effect (relative uplift, %)"
          htmlFor="pre-mde"
          hint="The smallest uplift worth detecting, relative to your baseline."
          error={errors.mde}
        >
          <input id="pre-mde" className="input" type="number" min="0" step="0.1" placeholder="e.g. 10"
            value={mde} onChange={(e) => setMde(e.target.value)} />
          {!errors.mde && !errors.baseline && mdeRel > 0 && (
            <div className="derived-line">
              = <strong>{fmtPct(mdeAbs)}</strong> absolute ({fmtPct(p1)} → {fmtPct(p1 * (1 + mdeRel))})
            </div>
          )}
        </Field>
        <Explainer id="mde" />
        <Explainer id="mdeabs" />

        <Field label="Visitors (all variants combined)" htmlFor="pre-traffic" error={errors.traffic}>
          <div className="traffic-row">
            <input id="pre-traffic" className="input" type="number" min="1" step="1" placeholder="e.g. 50,000"
              value={traffic} onChange={(e) => setTraffic(e.target.value)} />
            <select className="input select" value={period} aria-label="Traffic period"
              onChange={(e) => setPeriod(e.target.value)}>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </div>
        </Field>

        <VariantStepper k={k} setVariantCount={setVariantCount} idBase="pre-k" />
        {k >= 3 && (
          <p className="note">
            Testing {comparisons} variants against control — the sample sizes below already include
            the correction this needs, so the duration estimate is honest for a multi-variant test.
          </p>
        )}
        {k >= 3 && <Explainer id="holm" />}

        <Field label="Traffic split (defaults to equal)" htmlFor={undefined}>
          <AllocationEditor alloc={alloc} setAlloc={setAlloc} labels={labels} idPrefix="pre" />
        </Field>

        <SegControl
          legend="Statistical power"
          name="power"
          value={power}
          onChange={setPower}
          explainerId="power"
          options={[
            { value: 0.7, label: "70%" },
            { value: 0.8, label: "80%" },
            { value: 0.9, label: "90%" },
          ]}
        />

        <button type="button" className="btn-calc"
          onClick={() => setCalculated(true)} disabled={!inputsValid}>
          Calculate
        </button>
      </section>

      <section className="panel results" aria-live="polite" aria-labelledby="pre-r">
        <div className="results-head">
          <h2 id="pre-r" className="panel-title">What you'll need</h2>
          <div className="test-chip">
            Z-test · {twoTailed ? "two-tailed" : "one-tailed"} · {Math.round(confidence * 100)}% confidence · {Math.round(power * 100)}% power
          </div>
        </div>
        <Explainer id="ztest" inline />
        {result && (
          <ExportButtons
            onCsv={() => {
              const rows = [
                ["Eclipse — Test planning", ""],
                ["Generated", new Date().toLocaleString("en-GB")],
                [],
                ["Inputs", ""],
                ["Baseline conversion rate", `${baseline}%`],
                ["Minimum detectable effect (relative)", `${mde}%`],
                ["Absolute equivalent", `${fmtPct(mdeAbs)} (${fmtPct(p1)} -> ${fmtPct(p1*(1+mdeRel))})`],
                ["Visitors", `${traffic} ${period === "day" ? "per day" : period === "month" ? "per month" : "per week"}`],
                ["Variants (incl. control)", k],
                ["Confidence level", `${Math.round(confidence*100)}%`],
                ["Statistical power", `${Math.round(power*100)}%`],
                ["Tails", twoTailed ? "Two-tailed" : "One-tailed"],
                [],
                ["Results", ""],
                ["Visitors required per variant", result.nPerArm],
                ["Total visitors required", result.total],
                ["Estimated duration (weeks)", result.weeks],
                [],
                ["Detectable relative uplift by duration", ""],
                ["Weeks", ...result.chart.map(c => c.week)],
                ["Detectable uplift %", ...result.chart.map(c => c.mde ?? "")],
              ];
              downloadBlob(toCsv(rows), `eclipse-planning-${stamp()}.csv`, "text/csv");
            }}
            onPdf={() => exportPdf("Test planning", [
              { heading: "Inputs", lines: [
                `Baseline conversion rate: ${baseline}%`,
                `Minimum detectable effect (relative): ${mde}%  (= ${fmtPct(mdeAbs)} absolute, ${fmtPct(p1)} to ${fmtPct(p1*(1+mdeRel))})`,
                `Visitors: ${traffic} ${period === "day" ? "per day" : period === "month" ? "per month" : "per week"}`,
                `Variants (incl. control): ${k}`,
                `Confidence: ${Math.round(confidence*100)}%   Power: ${Math.round(power*100)}%   ${twoTailed ? "Two-tailed" : "One-tailed"}`,
              ]},
              { heading: "Results", lines: [
                `Visitors required per variant: ${fmtInt(result.nPerArm)}`,
                `Total visitors required: ${fmtInt(result.total)}`,
                `Estimated duration: ${result.weeks} ${result.weeks === 1 ? "week" : "weeks"}`,
              ]},
              { heading: "Detectable relative uplift by duration", lines:
                result.chart.map(c => `Week ${c.week}: ${c.mde != null ? c.mde + "%" : "—"}`) },
            ])}
          />
        )}
        {!result && <p className="empty">Fill in the inputs above and press Calculate to see required sample sizes and duration.</p>}
        {result && (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-label">Visitors per variant</div>
                <div className="stat-num">{fmtInt(result.nPerArm)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Total visitors</div>
                <div className="stat-num">{fmtInt(result.total)}</div>
              </div>
              <div className="stat stat-hero">
                <div className="stat-label">Estimated duration</div>
                <div className="stat-num">{result.weeks} {result.weeks === 1 ? "week" : "weeks"}</div>
              </div>
            </div>
            {result.weeks < 2 && (
              <p className="note">
                This plan completes in under 2 weeks. Behaviour varies across the week
                (weekday vs weekend, pay cycles) — running at least 1–2 full weeks is recommended
                regardless.
              </p>
            )}
            <h3 className="sub-title">Detectable uplift by duration</h3>
            <p className="field-hint">
              How small a relative uplift this traffic can reliably detect if you run for longer.
            </p>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={result.chart} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="#EFE8F3" strokeDasharray="2 4" />
                  <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#6E5A7A" }}
                    label={{ value: "Weeks", position: "insideBottom", offset: -2, fontSize: 12, fill: "#6E5A7A" }} />
                  <YAxis tick={{ fontSize: 12, fill: "#6E5A7A" }} unit="%" width={48} />
                  <ChartTip formatter={(v) => [`${v}%`, "Detectable relative uplift"]}
                    labelFormatter={(w) => `${w} week${w === 1 ? "" : "s"}`} />
                  <Line type="monotone" dataKey="mde" stroke="#5B2A86" strokeWidth={2.5}
                    dot={{ r: 3.5, fill: "#E4014E", stroke: "#fff", strokeWidth: 1.5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <table className="mini-table">
              <caption className="sr-only">Detectable relative uplift by number of weeks</caption>
              <thead>
                <tr><th scope="col">Weeks</th>{result.chart.map((r) => <th scope="col" key={r.week}>{r.week}</th>)}</tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Uplift</th>
                  {result.chart.map((r) => (
                    <td key={r.week}>{r.mde != null ? `${r.mde}%` : "—"}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

/* Expandable "show the working" detail — z-test internals + distribution chart */
function DistributionChart({ comparisons }) {
  // Each comparison: { name, p1, p2, seA, seB }. Draw normal sampling distributions.
  const normalPdf = (x, mu, s) => Math.exp(-0.5 * ((x - mu) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
  let lo = Infinity, hi = -Infinity;
  comparisons.forEach(c => {
    lo = Math.min(lo, c.p1 - 4 * c.seA, c.p2 - 4 * c.seB);
    hi = Math.max(hi, c.p1 + 4 * c.seA, c.p2 + 4 * c.seB);
  });
  const N = 80;
  const data = [];
  for (let i = 0; i <= N; i++) {
    const x = lo + (hi - lo) * i / N;
    const row = { x: +(x * 100).toFixed(4) };
    // control curve once (from first comparison's p1/seA)
    row.control = normalPdf(x, comparisons[0].p1, comparisons[0].seA);
    comparisons.forEach((c, j) => { row[`v${j}`] = normalPdf(x, c.p2, c.seB); });
    data.push(row);
  }
  const palette = ["#DC004A", "#4A3787", "#6441C3", "#157347", "#B8920A", "#0C447C", "#A32D2D"];
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#EFE8F3" strokeDasharray="2 4" />
          <XAxis dataKey="x" tick={{ fontSize: 11, fill: "#6B6478" }} unit="%"
            tickFormatter={(v) => v.toFixed(2)} minTickGap={28} />
          <YAxis hide />
          <ChartTip
            formatter={(val, key) => [Math.round(val), key === "control" ? "Variant A (Control)" : "Variant"]}
            labelFormatter={(x) => `CVR ${(+x).toFixed(3)}%`} />
          <Line type="monotone" dataKey="control" stroke="#9A93A8" strokeWidth={2} dot={false} isAnimationActive={false} name="Variant A (Control)" />
          {comparisons.map((c, j) => (
            <Line key={j} type="monotone" dataKey={`v${j}`} stroke={palette[(j + 1) % palette.length]}
              strokeWidth={2} dot={false} isAnimationActive={false} name={c.name} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="chart-caption">
        Expected spread of each variant's true conversion rate. The more the curves overlap, the harder it is to tell them apart — wide separation is what makes a result significant.
      </p>
    </div>
  );
}

function DetailedStats({ comparisons, confidence, twoTailed }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="detail-wrap">
      <button type="button" className="detail-toggle" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {open ? "Hide the statistics" : "Show the statistics behind this"}
      </button>
      {open && (
        <div className="detail-card">
          <h4 className="detail-title">Expected distributions</h4>
          <DistributionChart comparisons={comparisons} />
          <h4 className="detail-title">The numbers</h4>
          <div className="detail-table-wrap">
            <table className="detail-table">
              <thead>
                <tr>
                  <th scope="col">Comparison</th>
                  <th scope="col">Std error A</th>
                  <th scope="col">Std error</th>
                  <th scope="col">Std error of diff</th>
                  <th scope="col">Z-score</th>
                  <th scope="col">p-value</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((c) => (
                  <tr key={c.name}>
                    <th scope="row">{c.name} vs A</th>
                    <td>{c.seA.toFixed(5)}</td>
                    <td>{c.seB.toFixed(5)}</td>
                    <td>{c.seDiff.toFixed(5)}</td>
                    <td>{c.z.toFixed(4)}</td>
                    <td>{fmtP(c.pAdj)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="detail-formula">
            Z-score = (CR<sub>variant</sub> − CR<sub>A</sub>) / SE<sub>difference</sub> ·
            SE<sub>difference</sub> = √(SE<sub>A</sub>² + SE<sub>variant</sub>²) ·
            {twoTailed ? " two-tailed" : " one-tailed"} at {Math.round(confidence * 100)}% confidence
          </p>
        </div>
      )}
    </div>
  );
}

function ResultCard({ name, baseLabel, varLabel, baseVal, varVal,
  relUplift, pRaw, pAdj, corrected, ciBase, ciVar, baseCiLabel, varCiLabel,
  confidence, twoTailed, ciFmt, addDays, metricNoun = "performed", meaningOverride, zScore }) {
  const alpha = 1 - confidence;
  const decisionP = corrected ? pAdj : pRaw;
  const sig = Number.isFinite(decisionP) && decisionP < alpha;
  let kind = "ns";
  if (sig && relUplift != null) {
    if (relUplift > 0) kind = "winner";
    else kind = twoTailed ? "loser" : "ns";
  }
  const confPct = Math.round(confidence * 100);
  const confValue = Number.isFinite(decisionP) ? Math.min(99.9, (1 - decisionP) * 100) : null;
  const fmtCi = ciFmt || ((lo, hi) => `${fmtPct(lo)} – ${fmtPct(hi)}`);

  const who = name.split(" vs ")[0];
  const meaning = meaningOverride || (
    kind === "winner"
      ? `The difference is large enough to be a real effect, not random fluctuation — ${who} ${metricNoun} better than Variant A.`
      : kind === "loser"
      ? `The difference is large enough to be a real effect, not random fluctuation — ${who} ${metricNoun} worse than Variant A.`
      : `There's not enough evidence yet to be sure this is a real difference — it could still be random fluctuation.`);

  return (
    <article className={`result-card-v2 v2-${kind}`}>
      <div className="v2-header">
        <div className="v2-verdict-wrap">
          <Verdict kind={kind} />
          <h4 className="v2-title">{name}</h4>
        </div>
        <div className="v2-conf-pill">
          <span className="v2-conf-val">{confValue != null ? `${confValue.toFixed(1)}%` : "—"}</span>
          <span className="v2-conf-label">Confidence</span>
        </div>
      </div>

      <p className="v2-meaning">{meaning}</p>

      <div className="v2-metrics">
        <div className="v2-metric-main">
          <div className="v2-m-label">Relative Uplift</div>
          <div className={`v2-m-val ${relUplift >= 0 ? 'text-win' : 'text-lose'}`}>
            {fmtSignedPct(relUplift)}
          </div>
        </div>
        <div className="v2-metric-grid">
          <div className="v2-m-item">
            <span className="v2-m-i-label">{baseLabel || "Control"}</span>
            <span className="v2-m-i-val">{baseVal}</span>
          </div>
          <div className="v2-m-item">
            <span className="v2-m-i-label">{varLabel || "Variant"}</span>
            <span className="v2-m-i-val">{varVal}</span>
          </div>
        </div>
      </div>

      <div className="v2-details">
        <div className="v2-d-row">
          <div className="v2-d-col">
            <span className="v2-d-label">p-value</span>
            <span className="v2-d-val">{fmtP(pRaw)} {corrected && <small>(adj)</small>}</span>
          </div>
          <div className="v2-d-col">
            <span className="v2-d-label">{zScore?.label || "Z-score"}</span>
            <span className="v2-d-val">{zScore?.value != null ? zScore.value.toFixed(4) : "—"}</span>
          </div>
          {ciBase && (
            <div className="v2-d-col">
              <span className="v2-d-label">{baseCiLabel || "Control"} ({confPct}% CI)</span>
              <span className="v2-d-val">{fmtCi(ciBase[0], ciBase[1])}</span>
            </div>
          )}
          {ciVar && (
            <div className="v2-d-col">
              <span className="v2-d-label">{varCiLabel || "Variant"} ({confPct}% CI)</span>
              <span className="v2-d-val">{fmtCi(ciVar[0], ciVar[1])}</span>
            </div>
          )}
        </div>
      </div>

      {addDays && !sig && (
        <div className="v2-footer">
          <p className="result-days">
            {addDays.reachable
              ? (addDays.moreDays === 0
                  ? "Enough data has now been collected for this effect size."
                  : `At the current traffic rate, about ${fmtInt(addDays.moreDays)} more day${addDays.moreDays === 1 ? "" : "s"} would be needed to confirm an uplift this size (80% power).`)
              : (addDays.reason === "not-winning"
                  ? "This variant isn't currently ahead of Variant A, so more time won't make it a winner."
                  : "An uplift this small is impractical to confirm with realistic traffic.")}
          </p>
        </div>
      )}
    </article>
  );
}

function NonInfCard({ name, p1, p2, relDiff, marginRel, upperBound, margin, pRaw, confidence }) {
  const confPct = Math.round(confidence * 100);
  const confirmed = pRaw < 1 - confidence;
  // verdict: confirmed non-inferior / worse than margin / inconclusive
  let kind, verdictTxt;
  if (confirmed) {
    kind = "winner"; verdictTxt = "Non-inferiority confirmed";
  } else if (upperBound < -margin) {
    kind = "loser"; verdictTxt = "Worse than the margin";
  } else {
    kind = "ns"; verdictTxt = "Not confirmed";
  }

  const meaning = confirmed
    ? `At the ${confPct}% confidence level, you can be confident ${name} is not worse than control by more than your ${fmtPct(marginRel)} margin.`
    : (kind === "loser"
        ? `${name} appears to be worse than control by more than your ${fmtPct(marginRel)} margin.`
        : `Not enough evidence to confirm ${name} stays within your ${fmtPct(marginRel)} margin. This doesn't mean it's worse — only that the data can't rule out a drop bigger than the margin.`);

  return (
    <article className={`result-card-v2 v2-${kind}`}>
      <div className="v2-header">
        <div className="v2-verdict-wrap">
          <Verdict kind={kind === 'winner' ? 'winner' : kind === 'loser' ? 'loser' : 'ns'} 
                   txtOverride={verdictTxt} />
          <h4 className="v2-title">{name}</h4>
        </div>
        <div className="v2-conf-pill">
          <span className="v2-conf-val">{fmtPct(1 - pRaw, 1)}</span>
          <span className="v2-conf-label">Confidence</span>
        </div>
      </div>

      <p className="v2-meaning">{meaning}</p>

      <div className="v2-metrics">
        <div className="v2-metric-main">
          <div className="v2-m-label">Relative Difference</div>
          <div className={`v2-m-val ${relDiff >= 0 ? 'text-win' : 'text-lose'}`}>
            {fmtSignedPct(relDiff)}
          </div>
        </div>
        <div className="v2-metric-grid">
          <div className="v2-m-item">
            <span className="v2-m-i-label">Control CVR</span>
            <span className="v2-m-i-val">{fmtPct(p1)}</span>
          </div>
          <div className="v2-m-item">
            <span className="v2-m-i-label">Variant CVR</span>
            <span className="v2-m-i-val">{fmtPct(p2)}</span>
          </div>
        </div>
      </div>

      <div className="v2-details">
        <div className="v2-d-row">
          <div className="v2-d-col">
            <span className="v2-d-label">Acceptable Margin</span>
            <span className="v2-d-val">−{fmtPct(marginRel)}</span>
          </div>
          <div className="v2-d-col">
            <span className="v2-d-label">p-value</span>
            <span className="v2-d-val">{fmtP(pRaw)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ─────────────── POST_TEST · Conversion rate (§3) ─────────────── */

function PostCvr({ confidence, twoTailed, k, rows, setRows, alloc, setAlloc, setVariantCount, durationDays, setDurationDays }) {
  const labels = makeLabels(k);
  const [question, setQuestion] = useState("better"); // "better" | "noninf"
  const [marginPct, setMarginPct] = useState("1");     // non-inferiority margin, relative %
  const marginRel = Number(marginPct) / 100;
  const isNonInf = question === "noninf";
  const [calculated, setCalculated] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setCalculated(false); },
    [rows, alloc, question, marginPct, k, confidence, twoTailed, durationDays]);

  const parsed = rows.map((r) => ({ v: Number(r.visitors), c: Number(r.conversions) }));
  const rowErrors = parsed.map(({ v, c }, i) => {
    if (rows[i].visitors === "" && rows[i].conversions === "") return "Enter visitors and conversions.";
    if (!(Number.isInteger(v) && v > 0)) return "Visitors must be a whole number greater than 0.";
    if (!(Number.isInteger(c) && c >= 0)) return "Conversions must be a whole number of 0 or more.";
    if (c > v) return "Conversions can't exceed visitors.";
    return null;
  });
  const allocSum = alloc.reduce((a, b) => a + (Number(b) || 0), 0);
  const allocOk = Math.abs(allocSum - 100) <= 0.5 && alloc.every((a) => Number(a) > 0);
  const inputsValid = rowErrors.every((e) => e == null) && allocOk;
  const ready = calculated && inputsValid;

  let srm = null, results = null, noninfResults = null;
  if (ready) {
    srm = srmCheck(parsed.map((r) => r.v), alloc.map(Number));
    const alpha = 1 - confidence;
    const ctrl = parsed[0];
    if (isNonInf) {
      noninfResults = parsed.slice(1).map((r, i) => ({
        name: labels[i + 1],
        ...nonInferiorityTest(ctrl.c, ctrl.v, r.c, r.v, marginRel, alpha),
      }));
    } else {
      const tests = parsed.slice(1).map((r) =>
        twoPropTest(ctrl.c, ctrl.v, r.c, r.v, alpha, twoTailed));
      const adj = holmAdjust(tests.map((t) => t.pRaw));
      results = tests.map((t, i) => ({ ...t, pAdj: adj[i], name: labels[i + 1] }));
    }
  }

  const corrected = k >= 3;
  const days = Number(durationDays);

  // Additional days to reach significance for each non-significant, positive-trending variant
  if (results && Number.isInteger(days) && days > 0) {
    const alpha = 1 - confidence;
    const alphaAdj = corrected ? alpha / (k - 1) : alpha;
    results = results.map((r) => {
      const decisionP = corrected ? r.pAdj : r.pRaw;
      if (decisionP < alpha) return r; // already significant
      const nPerArm = (r.n1 + r.n2) / 2;
      const est = additionalDaysNeeded({
        pA: r.p1, pVar: r.p2, nPerArm, daysRun: days, alphaAdj, power: 0.8, twoTailed,
      });
      return { ...r, addDays: est };
    });
  }

  return (
    <div className="two-col">
      <section className="panel" aria-labelledby="cvr-h">
        <h2 id="cvr-h" className="panel-title">Enter your test data</h2>
        <p className="field-hint">Raw counts only — conversion rates are calculated for you.</p>

        <VariantStepper k={k} setVariantCount={setVariantCount} idBase="cvr-k" />

        <SegControl
          legend="What are you testing for?"
          name="question"
          value={question}
          onChange={setQuestion}
          options={[
            { value: "better", label: "Is the variant better?" },
            { value: "noninf", label: "Is it not worse?" },
          ]}
        />
        {isNonInf && (
          <>
            <Field label="Acceptable margin (relative drop you can live with, %)" htmlFor="cvr-margin"
              hint="Example: 1% means you'll accept the variant as long as it isn't more than 1% below control.">
              <input id="cvr-margin" className="input" type="number" min="0" step="0.1"
                value={marginPct} onChange={(e) => setMarginPct(e.target.value)} />
            </Field>
            <Explainer id="noninf" />
          </>
        )}

        {rows.map((r, i) => {
          const v = Number(r.visitors), c = Number(r.conversions);
          const cvr = Number.isInteger(v) && v > 0 && Number.isInteger(c) && c >= 0 && c <= v ? c / v : null;
          return (
            <div className="arm-row" key={i}>
              <h3 className="arm-name"><span className="avatar-dot" aria-hidden="true">{LETTERS[i]}</span>{labels[i]}</h3>
              <div className="arm-grid">
                <Field label="Visitors" htmlFor={`cvr-v-${i}`}>
                  <input id={`cvr-v-${i}`} className="input" type="number" min="1" step="1" placeholder="Visitors"
                    value={r.visitors}
                    onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, visitors: e.target.value } : x))} />
                </Field>
                <Field label="Conversions" htmlFor={`cvr-c-${i}`}>
                  <input id={`cvr-c-${i}`} className="input" type="number" min="0" step="1" placeholder="Conversions"
                    value={r.conversions}
                    onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, conversions: e.target.value } : x))} />
                </Field>
                <div className="field">
                  <span className="field-label">Conversion rate</span>
                  <output className="cvr-readout num" htmlFor={`cvr-v-${i} cvr-c-${i}`}>
                    {cvr != null ? fmtPct(cvr) : "—"}
                  </output>
                </div>
              </div>
              {rowErrors[i] && <div className="field-error" role="alert">{rowErrors[i]}</div>}
            </div>
          );
        })}

        <Field label="Planned traffic split (for the traffic split check)" htmlFor={undefined}
          hint="Defaults to an equal split — change it if your experiment was set up with an unequal split.">
          <AllocationEditor alloc={alloc} setAlloc={setAlloc} labels={labels} idPrefix="cvr" />
        </Field>
        <Explainer id="srm" />

        <Field label="Test duration in days (optional)" htmlFor="cvr-days">
          <input id="cvr-days" className="input" type="number" min="1" step="1"
            value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
        </Field>

        <button type="button" className="btn-calc"
          onClick={() => setCalculated(true)} disabled={!inputsValid}>
          Calculate
        </button>
      </section>

      <section className="panel results" aria-live="polite" aria-labelledby="cvr-r">
        <div className="results-head">
          <h2 id="cvr-r" className="panel-title">{isNonInf ? "Non-inferiority results" : "Z-test results"}</h2>
          <div className="test-chip">
            {isNonInf
              ? `One-tailed · ${Math.round(confidence * 100)}% confidence · ${fmtPct(marginRel)} margin`
              : `${twoTailed ? "Two-tailed" : "One-tailed"} · ${Math.round(confidence * 100)}% confidence${corrected ? " · corrected for multiple variants" : ""}`}
          </div>
        </div>
        <Explainer id={isNonInf ? "noninf" : "ztest"} inline />
        {ready && (
          <ExportButtons
            onCsv={() => {
              const head = [
                ["Eclipse — Conversion rate analysis", ""],
                ["Generated", new Date().toLocaleString("en-GB")],
                ["Test type", isNonInf ? `Non-inferiority (margin ${fmtPct(marginRel)})` : `Z-test, ${twoTailed ? "two-tailed" : "one-tailed"}${corrected ? ", Holm-Bonferroni corrected" : ""}`],
                ["Confidence", `${Math.round(confidence*100)}%`],
                ["SRM check", srm ? (srm.flagged ? `Flagged (p=${fmtP(srm.p)})` : `Healthy (p=${fmtP(srm.p)})`) : ""],
                [],
                ["Variant", "Visitors", "Conversions", "CVR"],
                ...parsed.map((r, i) => [labels[i], r.v, r.c, fmtPct(r.c / r.v)]),
                [],
              ];
              const body = isNonInf
                ? [["Comparison", "Margin", "Relative diff", "Verdict"],
                   ...noninfResults.map(r => [`${r.name} vs Variant A`, `-${fmtPct(marginRel)}`, fmtSignedPct(r.relDiff),
                     (r.pRaw < 1 - confidence) ? "Non-inferiority confirmed" : (r.upperBound < -r.margin ? "Worse than margin" : "Not confirmed")])]
                : [["Comparison", "Rel. uplift", "p-value", corrected ? "p (corrected)" : "", "Confidence", "Variant CVR CI", "Verdict"],
                   ...results.map(r => {
                     const dp = corrected ? r.pAdj : r.pRaw;
                     return [`${r.name} vs Variant A`, fmtSignedPct(r.relUplift), fmtP(r.pRaw),
                       corrected ? fmtP(r.pAdj) : "",
                       `${Math.min(99.9, (1 - dp) * 100).toFixed(1)}%`,
                       (r.ciB ? `${fmtPct(r.ciB[0])} to ${fmtPct(r.ciB[1])}` : ""),
                       (dp < 1 - confidence) ? (r.relUplift > 0 ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant"];
                   })];
              downloadBlob(toCsv([...head, ...body]), `eclipse-cvr-${stamp()}.csv`, "text/csv");
            }}
            onPdf={() => {
              const currentResults = results;
              const currentNoninfResults = noninfResults;
              const currentParsed = parsed;
              const currentLabels = labels;
              exportPdf("Conversion rate analysis", [
                { heading: "Setup", lines: [
                  isNonInf ? `Non-inferiority test, margin ${fmtPct(marginRel)}` : `Z-test, ${twoTailed ? "two-tailed" : "one-tailed"}${corrected ? ", Holm-Bonferroni corrected" : ""}`,
                  `Confidence: ${Math.round(confidence*100)}%`,
                  srm ? (srm.flagged ? `SRM check: FLAGGED (p=${fmtP(srm.p)}) — results may be unreliable` : `SRM check: healthy (p=${fmtP(srm.p)})`) : "",
                ].filter(Boolean)},
                { heading: "Data", lines: currentParsed.map((r, i) => `${currentLabels[i]}: ${fmtInt(r.v)} visitors, ${fmtInt(r.c)} conversions (CVR ${fmtPct(r.c/r.v)})`) },
                { heading: "Results", lines: isNonInf
                  ? currentNoninfResults?.map(r => `${r.name} vs Variant A: relative diff ${fmtSignedPct(r.relDiff)} — ${(r.pRaw < 1 - confidence) ? "Non-inferiority confirmed" : (r.upperBound < -r.margin ? "Worse than margin" : "Not confirmed")}`)
                  : currentResults?.map(r => { const dp = corrected ? r.pAdj : r.pRaw; return `${r.name} vs Variant A: ${fmtSignedPct(r.relUplift)} uplift, p=${fmtP(r.pRaw)}${corrected ? ` (corrected ${fmtP(r.pAdj)})` : ""}, ${Math.min(99.9,(1-dp)*100).toFixed(1)}% confidence — ${(dp < 1 - confidence) ? (r.relUplift > 0 ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant"}`; }) },
              ]);
            }}
          />
        )}
        {!ready && <p className="empty">Fill in your test data above and press Calculate to see results.</p>}
        {ready && (
          <>
            <SrmBanner srm={srm} />
            {Number.isInteger(days) && days > 0 && days < 14 && (
              <p className="note">
                This test ran fewer than 2 weeks. Behaviour varies across the week
                (weekday vs weekend, pay cycles); results from short windows may not generalise.
              </p>
            )}
            <div className={srm && srm.flagged ? "dimmed" : ""}>
              {isNonInf
                ? noninfResults.map((r) => (
                    <NonInfCard
                      key={r.name}
                      name={r.name}
                      p1={r.p1} p2={r.p2} relDiff={r.relDiff}
                      marginRel={marginRel} lowerBound={r.lowerBound} upperBound={r.upperBound}
                      margin={r.margin} pRaw={r.pRaw} confidence={confidence}
                    />
                  ))
                : results.map((r) => (
                    <ResultCard
                      key={r.name}
                      name={`${r.name} vs Variant A (Control)`}
                      baseLabel="Variant A (Control) Conversion Rate" varLabel={`${r.name} Conversion Rate`}
                      baseVal={fmtPct(r.p1)} varVal={fmtPct(r.p2)}
                      relUplift={r.relUplift}
                      pRaw={r.pRaw} pAdj={r.pAdj} corrected={corrected}
                      ciBase={r.ciA} ciVar={r.ciB}
                      baseCiLabel="Variant A Conversion Rate" varCiLabel={`${r.name} Conversion Rate`}
                      addDays={r.addDays}
                      confidence={confidence} twoTailed={twoTailed}
                      metricNoun="converted"
                      zScore={{ label: "Z-score", value: r.z }}
                    />
                  ))}
            </div>
            {!isNonInf && (
              <DetailedStats
                comparisons={results.map(r => ({
                  name: r.name, p1: r.p1, p2: r.p2,
                  seA: r.seA, seB: r.seB, seDiff: r.seDiff, z: r.z, pAdj: r.pAdj,
                }))}
                confidence={confidence} twoTailed={twoTailed}
              />
            )}
            {!isNonInf && <Explainer id="pvalue" />}
            {!isNonInf && <Explainer id="confpct" />}
            {!isNonInf && corrected && <Explainer id="holm" />}
          </>
        )}
      </section>
    </div>
  );
}

/* ─────────────── POST_TEST · Revenue RPV & AOV (§4) ───────────── */

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
};
const percentile = (sorted, q) => {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};
const skewness = (a) => {
  if (a.length < 3) return 0;
  const m = mean(a), s = sd(a);
  if (s === 0) return 0;
  const n = a.length;
  return (n / ((n - 1) * (n - 2))) * a.reduce((acc, x) => acc + Math.pow((x - m) / s, 3), 0);
};

// RPV mean/sd derived from order revenues + visitor count (non-buyers = implied zeros)
function rpvStats(orders, visitors) {
  const sumX  = orders.reduce((a, b) => a + b, 0);
  const sumX2 = orders.reduce((a, b) => a + b * b, 0);
  const m = sumX / visitors;
  const variance = Math.max(0, (sumX2 - visitors * m * m) / (visitors - 1));
  return { m, s: Math.sqrt(variance), n: visitors };
}

// Parse a revenue file: accepts a single revenue column, or two columns (ID + revenue).
// Tolerates a header row, currency symbols, thousand-separators, tab/semicolon/comma delimiters.
function parseRevenueFile(text) {
  const values = [], errors = [];
  let firstDataSeen = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    // Split by tab or semicolon first; if neither, try comma; if neither, try space
    let cells = line.split(/[\t;]+/);
    if (cells.length === 1) cells = line.split(',');
    if (cells.length === 1) cells = line.split(/\s+/);
    // Use last cell as revenue candidate
    let cell = cells[cells.length - 1].trim().replace(/[£$€\s]/g, '');
    // Strip thousand-separators only when format looks numeric-with-commas
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cell)) cell = cell.replace(/,/g, '');
    const v = Number(cell);
    if (cell === '' || !Number.isFinite(v)) {
      if (!firstDataSeen) return; // header row — skip silently
      if (errors.length < 8) errors.push(`Row ${i + 1}: "${cells[cells.length - 1].trim()}" is not a number.`);
      return;
    }
    if (v < 0) {
      if (errors.length < 8) errors.push(`Row ${i + 1}: revenue can't be negative.`);
      firstDataSeen = true; return;
    }
    firstDataSeen = true;
    values.push(v);
  });
  return { values, errors };
}

function PostRevenue({ confidence, twoTailed, k, rows, alloc, setAlloc, setVariantCount, durationDays, setDurationDays }) {
  const labels = makeLabels(k);

  // Per-variant local state: visitor/conversion overrides, file parse result, file name
  const [visitorOverrides, setVisitorOverrides] = useState(Array(8).fill(''));
  const [convOverrides, setConvOverrides]       = useState(Array(8).fill(''));
  const [fileParsed, setFileParsed]             = useState(Array(8).fill(null)); // {values,errors,name}
  const [winsorize, setWinsorize]               = useState(false);
  const [calculated, setCalculated]             = useState(false);
  const fileRefs = useRef(Array.from({ length: 8 }, () => null));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setCalculated(false); },
    [visitorOverrides, convOverrides, fileParsed, winsorize, alloc, k, confidence, twoTailed, durationDays, rows]);

  // Effective visitors/conversions per variant: override takes priority, then CVR tab value
  const effectiveVisitors = labels.map((_, i) => {
    const ov = visitorOverrides[i];
    if (ov !== '') return ov;
    return rows[i] ? rows[i].visitors : '';
  });
  const effectiveConversions = labels.map((_, i) => {
    const ov = convOverrides[i];
    if (ov !== '') return ov;
    return rows[i] ? rows[i].conversions : '';
  });

  // Parse results
  const armData = labels.map((nm, i) => {
    const fp = fileParsed[i];
    const vRaw = effectiveVisitors[i];
    const visitors = Number(vRaw);
    const visitorsOk = Number.isInteger(visitors) && visitors > 0;
    const orders = fp ? fp.values : [];
    const orderCount = orders.length;
    const convRaw = effectiveConversions[i];
    const convNum = Number(convRaw);
    const convEntered = convRaw !== '' && Number.isInteger(convNum) && convNum > 0;

    // Cross-check: file orders vs conversions from CVR tab
    let mismatch = null;
    if (convEntered && orderCount > 0 && orderCount !== convNum) {
      if (orderCount > convNum)
        mismatch = `The file contains ${fmtInt(orderCount)} orders but ${fmtInt(convNum)} conversions are recorded above. This could mean a wrong date range, duplicate orders, or multiple purchases per visitor.`;
      else
        mismatch = `The file contains ${fmtInt(orderCount)} orders but ${fmtInt(convNum)} conversions are recorded above. Some orders may be missing from the export, or your conversion definition doesn't map 1:1 to individual orders.`;
    }

    let visitorsError = null;
    if (vRaw === '') visitorsError = 'Enter visitors — needed for revenue per visitor.';
    else if (!visitorsOk) visitorsError = 'Visitors must be a whole number greater than 0.';
    else if (orderCount > visitors) visitorsError = `More orders (${fmtInt(orderCount)}) than visitors (${fmtInt(visitors)}) — check the visitor count.`;

    return { name: nm, visitors, visitorsOk: !visitorsError, visitorsError,
             orders, orderCount, fp, mismatch };
  });

  const allFilesLoaded = armData.every(a => a.orderCount >= 2);
  const allVisitorsOk  = armData.every(a => a.visitorsOk);
  const allocSum = alloc.reduce((a, b) => a + (Number(b) || 0), 0);
  const allocOk  = Math.abs(allocSum - 100) <= 0.5;
  const inputsValid = allFilesLoaded && allVisitorsOk && allocOk;
  const ready = calculated && inputsValid;

  let analysis = null;
  if (ready) {
    const allOrders  = armData.flatMap(a => a.orders);
    const sortedAll  = [...allOrders].sort((a, b) => a - b);
    const p99        = percentile(sortedAll, 0.99);
    const skewFlag   = armData.some(a => {
      const srt = [...a.orders].sort((x,y) => x - y);
      const ap99 = percentile(srt, 0.99);
      return (ap99 > 0 && srt[srt.length-1] > 10*ap99) || skewness(a.orders) > 5;
    });
    const cappedOrders = winsorize
      ? armData.map(a => a.orders.map(x => Math.min(x, p99)))
      : armData.map(a => a.orders);

    const alpha    = 1 - confidence;
    const armStats = armData.map((a, i) => ({
      name:    a.name,
      rpv:     rpvStats(cappedOrders[i], a.visitors),
      aov:     { m: mean(cappedOrders[i]), s: sd(cappedOrders[i]), n: cappedOrders[i].length },
    }));

    const ctrl = armStats[0];
    const buildMetric = key => {
      const pairs = armStats.slice(1).map(a =>
        ({ name: a.name, ...welchTest(ctrl[key].m, ctrl[key].s, ctrl[key].n,
                                      a[key].m,    a[key].s,    a[key].n, alpha, twoTailed) }));
      const adj = holmAdjust(pairs.map(p => p.pRaw));
      return pairs.map((p, i) => ({ ...p, pAdj: adj[i] }));
    };

    analysis = {
      skewFlag, p99, armStats,
      srm: srmCheck(armData.map(a => a.visitors), alloc.map(Number)),
      rpv: buildMetric('rpv'),
      aov: buildMetric('aov'),
    };
  }

  const onFile = (i, file) => {
    const reader = new FileReader();
    reader.onload = e => {
      const { values, errors } = parseRevenueFile(e.target.result);
      setFileParsed(prev => { const n=[...prev]; n[i]={ values, errors, name: file.name }; return n; });
    };
    reader.readAsText(file);
  };

  const corrected = k >= 3;
  const days = Number(durationDays);

  return (
    <div className="two-col">
      <section className="panel" aria-labelledby="rev-h">
        <h2 id="rev-h" className="panel-title">Order revenue data</h2>

        <VariantStepper k={k} setVariantCount={setVariantCount} idBase="rev-k" />

        <Field label="Planned traffic split" htmlFor={undefined}
          hint="Defaults to an equal split — change it if your experiment used an unequal split (e.g. 30/70).">
          <AllocationEditor alloc={alloc} setAlloc={setAlloc} labels={labels} idPrefix="rev" />
        </Field>
        <Explainer id="srm" />

        <h3 className="block-title">Traffic & Conversions per variant</h3>
        <p className="field-hint">Pulled from the Conversion rate tab if entered there — edit here to fix mismatches with your files.</p>
        <div className="traffic-block-v2">
          {armData.map((a, i) => (
            <div key={i} className="traffic-arm">
              <div className="traffic-arm-name">{a.name}</div>
              <div className="traffic-arm-fields">
                <Field label="Visitors" htmlFor={`rev-vis-${i}`}>
                  <input
                    id={`rev-vis-${i}`}
                    className="input"
                    type="number" min="1" step="1"
                    value={effectiveVisitors[i]}
                    onChange={e => setVisitorOverrides(prev => { const n=[...prev]; n[i]=e.target.value; return n; })}
                  />
                </Field>
                <Field label="Conversions" htmlFor={`rev-conv-${i}`}>
                  <input
                    id={`rev-conv-${i}`}
                    className="input"
                    type="number" min="0" step="1"
                    value={effectiveConversions[i]}
                    onChange={e => setConvOverrides(prev => { const n=[...prev]; n[i]=e.target.value; return n; })}
                  />
                </Field>
              </div>
              {a.visitorsError && <div className="field-error" role="alert">{a.visitorsError}</div>}
            </div>
          ))}
        </div>

        <div className="data-privacy">
          <span aria-hidden="true" className="privacy-icon">🔒</span>
          Files are processed entirely in your browser. No data is sent to any server or stored anywhere.
        </div>

        <h3 className="block-title">Order revenue file per variant</h3>
        {armData.map((a, i) => (
          <div className="arm-row" key={i}>
            <h3 className="arm-name">
              <span className="avatar-dot" aria-hidden="true">{LETTERS[i]}</span>
              {a.name}
              <span className="arm-orders">{a.orderCount > 0 ? `${fmtInt(a.orderCount)} orders` : ''}</span>
            </h3>

            <div className="upload-zone" role="group" aria-label={`Order revenue file for ${a.name}`}>
              <input
                ref={el => fileRefs.current[i] = el}
                type="file" accept=".csv,.txt,text/csv,text/plain"
                className="sr-only"
                id={`rev-file-${i}`}
                aria-describedby={`rev-file-hint-${i}`}
                onChange={e => e.target.files && e.target.files[0] && onFile(i, e.target.files[0])}
              />
              <label htmlFor={`rev-file-${i}`} className={`upload-label ${a.fp ? 'upload-label-filled' : ''}`}>
                <span className="upload-icon" aria-hidden="true">{a.fp ? '📄' : '⬆'}</span>
                <span className="upload-cta">{a.fp ? a.fp.name : 'Choose file'}</span>
                <span className="upload-sub">{a.fp ? `${fmtInt(a.orderCount)} orders detected — click to replace` : 'CSV or text file'}</span>
              </label>
              <div id={`rev-file-hint-${i}`} className="upload-fmt">
                One row per transaction · order value in the last column · header row and transaction ID column both fine
              </div>
            </div>

            {a.fp && a.fp.errors.length > 0 && (
              <div className="field-error" role="alert">
                {a.fp.errors.map((e, j) => <div key={j}>{e}</div>)}
              </div>
            )}

            {a.mismatch && (
              <div className="mismatch-warn" role="alert">{a.mismatch}</div>
            )}
          </div>
        ))}

        {analysis && analysis.skewFlag && (
          <div className="note outlier-note" role="status">
            <div className="outlier-header">
              Order revenue data is heavily skewed or has extreme outliers — a few large orders may dominate the averages.
              <Explainer id="winsorize" inline />
            </div>
            <label className="check-row">
              <input type="checkbox" checked={winsorize}
                onChange={e => setWinsorize(e.target.checked)} />
              Cap order value outliers at the 99th percentile ({fmtMoney(analysis.p99)})
            </label>
          </div>
        )}
        {analysis && !analysis.skewFlag && (
          <div className="outlier-wrap">
            <div className="outlier-header">
              <label className="check-row">
                <input type="checkbox" checked={winsorize}
                  onChange={e => setWinsorize(e.target.checked)} />
                Cap order value outliers at the 99th percentile (optional)
              </label>
              <Explainer id="winsorize" inline />
            </div>
          </div>
        )}

        <Field label="Test duration in days (optional)" htmlFor="rev-days">
          <input id="rev-days" className="input" type="number" min="1" step="1"
            value={durationDays} onChange={e => setDurationDays(e.target.value)} />
        </Field>

        <button type="button" className="btn-calc"
          onClick={() => setCalculated(true)} disabled={!inputsValid}>
          Calculate
        </button>
      </section>

      <section className="panel results" aria-live="polite" aria-labelledby="rev-r">
        <div className="results-head">
          <h2 id="rev-r" className="panel-title">Revenue results</h2>
          <div className="test-chip">
            {twoTailed ? 'Two-tailed' : 'One-tailed'} · {Math.round(confidence * 100)}% confidence
            {corrected ? ' · corrected for multiple variants' : ''}
            {winsorize ? ' · outliers capped' : ''}
          </div>
        </div>
        <Explainer id="ttest" inline />
        <Explainer id="metrics" inline />
        {analysis && (
          <ExportButtons
            onCsv={() => {
              const rows = [
                ["Eclipse — Revenue analysis", ""],
                ["Generated", new Date().toLocaleString("en-GB")],
                ["Test type", `Welch's t-test, ${twoTailed ? "two-tailed" : "one-tailed"}${corrected ? ", Holm-Bonferroni corrected" : ""}${winsorize ? ", outliers capped at 99th pct" : ""}`],
                ["Confidence", `${Math.round(confidence*100)}%`],
                ["SRM check", analysis.srm ? (analysis.srm.flagged ? `Flagged (p=${fmtP(analysis.srm.p)})` : `Healthy (p=${fmtP(analysis.srm.p)})`) : ""],
                [],
                ["Variant", "Visitors", "Orders", "RPV", "AOV"],
                ...analysis.armStats.map(a => [a.name, a.rpv.n, a.aov.n, fmtMoney(a.rpv.m), fmtMoney(a.aov.m)]),
                [],
                ["Revenue per visitor", "", "", "", ""],
                ["Comparison", "Rel. uplift", "p-value", `${Math.round(confidence*100)}% CI`, "Verdict"],
                ...analysis.rpv.map(r => [`${r.name} vs Variant A`, fmtSignedPct(r.relUplift), fmtP(r.pAdj),
                  (r.ciLo!=null?`${fmtSignedPct(r.ciLo)} to ${fmtSignedPct(r.ciHi)}`:""),
                  (r.pAdj < 1 - confidence) ? (r.relUplift > 0 ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant"]),
                [],
                ["Average order value", "", "", "", ""],
                ["Comparison", "Rel. uplift", "p-value", `${Math.round(confidence*100)}% CI`, "Verdict"],
                ...analysis.aov.map(r => [`${r.name} vs Variant A`, fmtSignedPct(r.relUplift), fmtP(r.pAdj),
                  (r.ciLo!=null?`${fmtSignedPct(r.ciLo)} to ${fmtSignedPct(r.ciHi)}`:""),
                  (r.pAdj < 1 - confidence) ? (r.relUplift > 0 ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant"]),
              ];
              downloadBlob(toCsv(rows), `eclipse-revenue-${stamp()}.csv`, "text/csv");
            }}
            onPdf={() => {
              const currentAnalysis = analysis;
              if (!currentAnalysis) return;
              exportPdf("Revenue analysis", [
                { heading: "Setup", lines: [
                  `Welch's t-test, ${twoTailed ? "two-tailed" : "one-tailed"}${corrected ? ", Holm-Bonferroni corrected" : ""}${winsorize ? ", outliers capped at 99th percentile" : ""}`,
                  `Confidence: ${Math.round(confidence*100)}%`,
                  currentAnalysis.srm ? (currentAnalysis.srm.flagged ? `SRM check: FLAGGED (p=${fmtP(currentAnalysis.srm.p)})` : `SRM check: healthy (p=${fmtP(currentAnalysis.srm.p)})`) : "",
                ].filter(Boolean)},
                { heading: "Data", lines: currentAnalysis.armStats.map(a => `${a.name}: ${fmtInt(a.rpv.n)} visitors, ${fmtInt(a.aov.n)} orders, RPV ${fmtMoney(a.rpv.m)}, AOV ${fmtMoney(a.aov.m)}`) },
                { heading: "Revenue per visitor", lines: currentAnalysis.rpv.map(r =>
                  `${r.name} vs Variant A: ${fmtSignedPct(r.relUplift)}, p=${fmtP(r.pAdj)} — ${(r.pAdj < 1 - confidence) ? (r.relUplift > 0 ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant"}`) },
                { heading: "Average order value", lines: currentAnalysis.aov.map(r =>
                  `${r.name} vs Variant A: ${fmtSignedPct(r.relUplift)}, p=${fmtP(r.pAdj)} — ${(r.pAdj < 1 - confidence) ? (r.relUplift > 0 ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant"}`) },
              ]);
            }}
          />
        )}
        {!analysis && <p className="empty">Add your data above and press Calculate to see revenue per visitor and average order value results.</p>}
        {analysis && (
          <>
            <SrmBanner srm={analysis.srm} />
            {Number.isInteger(days) && days > 0 && days < 14 && (
              <p className="note">
                This test ran fewer than 2 weeks. Behaviour varies across the week
                (weekday vs weekend, pay cycles); results from short windows may not generalise.
              </p>
            )}
            <div className={analysis.srm && analysis.srm.flagged ? 'dimmed' : ''}>
              <h3 className="sub-title">Revenue per visitor</h3>
              <p className="field-hint">
                Revenue Per Visitor (RPV) is the average amount of revenue generated by every person who entered the test, including those who didn't buy anything.
              </p>
              {analysis.rpv.map(r => (
                <ResultCard key={`rpv-${r.name}`}
                  name={`${r.name} vs Variant A (Control)`}
                  baseLabel="Variant A (Control) RPV" varLabel={`${r.name} RPV`}
                  baseVal={fmtMoney(r.m1)} varVal={fmtMoney(r.m2)}
                  relUplift={r.relUplift} pRaw={r.pRaw} pAdj={r.pAdj} corrected={corrected}
                  ciBase={r.ciMeanA} ciVar={r.ciMeanB}
                  baseCiLabel="Variant A Revenue Per Visitor" varCiLabel={`${r.name} Revenue Per Visitor`}
                  ciFmt={(lo, hi) => `${fmtMoney(lo)} – ${fmtMoney(hi)}`}
                  confidence={confidence} twoTailed={twoTailed}
                  zScore={{ label: "T-score", value: r.t }}
                  meaningOverride={
                    (corrected ? r.pAdj : r.pRaw) < 1 - confidence
                      ? `The difference is large enough to be a real effect, not random fluctuation — ${r.name} ${r.relUplift >= 0 ? "generated more" : "generated less"} revenue per visitor than Variant A.`
                      : "There's not enough evidence yet to be sure this is a real difference in revenue per visitor — it could still be random fluctuation."
                  }
                />
              ))}

              <h3 className="sub-title">Average order value</h3>
              <div className="aov-warning">
                <strong>Important:</strong> Average order value only looks at people who made a purchase. 
                If you use AOV as your primary metric, you might declare a winner that actually loses you money 
                (e.g. if conversion rate crashes while AOV rises).
              </div>
              {analysis.aov.map(r => (
                <ResultCard key={`aov-${r.name}`}
                  name={`${r.name} vs Variant A (Control)`}
                  baseLabel="Variant A (Control) AOV" varLabel={`${r.name} AOV`}
                  baseVal={fmtMoney(r.m1)} varVal={fmtMoney(r.m2)}
                  relUplift={r.relUplift} pRaw={r.pRaw} pAdj={r.pAdj} corrected={corrected}
                  ciBase={r.ciMeanA} ciVar={r.ciMeanB}
                  baseCiLabel="Variant A Average Order Value" varCiLabel={`${r.name} Average Order Value`}
                  ciFmt={(lo, hi) => `${fmtMoney(lo)} – ${fmtMoney(hi)}`}
                  confidence={confidence} twoTailed={twoTailed}
                  zScore={{ label: "T-score", value: r.t }}
                  meaningOverride={
                    (corrected ? r.pAdj : r.pRaw) < 1 - confidence
                      ? `The difference is large enough to be a real effect, not random fluctuation — among buyers, ${r.name} had a ${r.relUplift >= 0 ? "higher" : "lower"} average order value than Variant A.`
                      : "There's not enough evidence yet to be sure this is a real difference in average order value — it could still be random fluctuation."
                  }
                />
              ))}
            </div>
            <Explainer id="aovrpv" />
            {corrected && <Explainer id="holm" />}
          </>
        )}
      </section>
    </div>
  );
}

/* ───────────────────────── App shell ──────────────────────────── */

export default function EclipseCalculator() {
  const [mode, setMode] = useState("pre");
  const [postTab, setPostTab] = useState("cvr");
  const [confidence, setConfidence] = useState(0.95);
  const [tails, setTails] = useState("two");
  const twoTailed = tails === "two";

  // Shared state between CVR and Revenue tabs
  const [k, setK] = useState(2);
  const [rows, setRows] = useState([
    { visitors: "", conversions: "" },
    { visitors: "", conversions: "" },
  ]);
  const [alloc, setAlloc] = useState(equalSplit(2));
  const [durationDays, setDurationDays] = useState("");

  const setVariantCount = (next) => {
    const kk = Math.max(2, Math.min(8, next));
    setK(kk);
    setRows(r => {
      const copy = r.slice(0, kk);
      while (copy.length < kk) copy.push({ visitors: "", conversions: "" });
      return copy;
    });
    setAlloc(equalSplit(kk));
  };

  return (
    <div className="app">
      <style>{CSS}</style>

      <header className="masthead">
        <div className="mast-inner">
          <EclipseWordmark />
          <div className="tagline">A/B test calculator</div>
        </div>
      </header>

      <nav className="mode-tabs" aria-label="Calculator mode">
        <button type="button" className={`tab ${mode === "pre" ? "tab-on" : ""}`}
          aria-pressed={mode === "pre"} onClick={() => setMode("pre")}>
          Plan a test
          <span className="tab-sub">Sample size &amp; duration</span>
        </button>
        <button type="button" className={`tab ${mode === "post" ? "tab-on" : ""}`}
          aria-pressed={mode === "post"} onClick={() => setMode("post")}>
          Analyse results
          <span className="tab-sub">Significance &amp; uplift</span>
        </button>
      </nav>

      <section className="settings" aria-label="Statistical settings" key={`settings-${mode}-${postTab}`}>
        <SegControl
          legend="Confidence level"
          name="conf"
          value={confidence}
          onChange={setConfidence}
          explainerId="confidence"
          options={[
            { value: 0.9, label: "90%" },
            { value: 0.95, label: "95%" },
            { value: 0.99, label: "99%" },
          ]}
        />
        <SegControl
          legend="Tails"
          name="tails"
          value={tails}
          onChange={setTails}
          explainerId="tailed"
          options={[
            { value: "two", label: "Two-tailed" },
            { value: "one", label: "One-tailed" },
          ]}
        />
      </section>

      {mode === "pre" && <PreTest key="pre" confidence={confidence} twoTailed={twoTailed} />}

      {mode === "post" && (
        <>
          <nav className="sub-tabs" aria-label="Metric">
            <button type="button" className={`subtab ${postTab === "cvr" ? "subtab-on" : ""}`}
              aria-pressed={postTab === "cvr"} onClick={() => setPostTab("cvr")}>
              Conversion rate
            </button>
            <button type="button" className={`subtab ${postTab === "revenue" ? "subtab-on" : ""}`}
              aria-pressed={postTab === "revenue"} onClick={() => setPostTab("revenue")}>
              Revenue per visitor &amp; AOV
            </button>
          </nav>
          {postTab === "cvr"
            ? <PostCvr key="cvr" confidence={confidence} twoTailed={twoTailed}
              k={k} rows={rows} setRows={setRows}
              alloc={alloc} setAlloc={setAlloc}
              setVariantCount={setVariantCount}
              durationDays={durationDays} setDurationDays={setDurationDays} />
            : <PostRevenue key="rev" confidence={confidence} twoTailed={twoTailed}
              k={k} rows={rows}
              alloc={alloc} setAlloc={setAlloc}
              setVariantCount={setVariantCount}
              durationDays={durationDays} setDurationDays={setDurationDays} />}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Styles ─────────────────────────────── */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');

:root {
  --paper:#F7F6FA; --card:#FFFFFF; --ink:#1C1328; --muted:#6B6478;
  --line:#E9E6F0;
  --pink:#DC004A; --pink-deep:#B0003B; --pink-soft:#FCE6EE;
  --purple:#4A3787; --purple-deep:#382A68; --purple-soft:#F0EEFA;
  --purple-bright:#6441C3; --avatar:#CBCAFF;
  --navy:#1C1328; --amber:#F1C40F;
  --grad:linear-gradient(100deg,#DC004A 0%,#8E2173 52%,#4A3787 100%);
  --win:#157347; --win-bg:#E7F6EE; --lose:#B3261E; --lose-bg:#FCEDEB;
  --ns:#6B6478; --ns-bg:#F0EEF4; --warn-bg:#FEF7E0; --warn-edge:#B8920A;
  --shadow:0 1px 2px rgba(26,18,41,.05), 0 10px 30px -12px rgba(26,18,41,.13);
  --radius:15px;
}
.app{font-family:'Inter',system-ui,sans-serif;background:var(--paper);color:var(--ink);
  min-height:100vh;padding:0 16px 56px;font-size:15.5px;line-height:1.55;
  font-feature-settings:'cv11' 1;}
.app *{box-sizing:border-box;}
.app :focus-visible{outline:3px solid var(--pink);outline-offset:2px;border-radius:6px;}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0;}
.num,.stat-num,.mini-table td,.cvr-readout{font-variant-numeric:tabular-nums;
  font-feature-settings:'tnum' 1;}

/* masthead */
.masthead{max-width:1080px;margin:0 auto;padding-top:30px;}
.mast-inner{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
.brand{display:flex;align-items:center;gap:9px;}
.brand-mark{display:block;flex:none;}
.brand-word{font-family:'Sora',sans-serif;font-weight:800;font-size:30px;color:var(--pink);letter-spacing:-0.02em;
  letter-spacing:-0.03em;line-height:1;}
.tagline{color:var(--muted);font-size:15px;padding-top:6px;}

/* tabs */
.mode-tabs{max-width:1080px;margin:26px auto 0;display:flex;gap:12px;flex-wrap:wrap;}
.tab{flex:1;min-width:210px;text-align:left;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);padding:16px 20px;cursor:pointer;box-shadow:var(--shadow);
  font-family:'Sora',sans-serif;font-weight:700;font-size:17px;color:var(--ink);}
.tab-sub{display:block;font-family:'Inter',sans-serif;font-weight:400;
  font-size:13px;color:var(--muted);margin-top:3px;}
.tab-on{border-color:transparent;background:var(--grad);color:#fff;}
.tab-on .tab-sub{color:rgba(255,255,255,.85);}
.sub-tabs{max-width:1080px;margin:18px auto 0;display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;scrollbar-width:none;}
.sub-tabs::-webkit-scrollbar{display:none;}
.subtab{background:var(--card);border:1px solid var(--line);border-radius:999px;
  padding:9px 16px;font-size:13.5px;font-weight:600;color:var(--ink);cursor:pointer;
  font-family:'Inter',sans-serif;box-shadow:var(--shadow);white-space:nowrap;flex:1;text-align:center;}
@media (max-width:600px){
  .sub-tabs{gap:6px;}
  .subtab{padding:8px 12px;font-size:12.5px;}
}
.subtab-on{border-color:var(--pink);background:var(--pink-soft);color:var(--pink-deep);}
.subtab-on:focus-visible{outline-color:var(--pink);}

/* settings */
.settings{max-width:1080px;margin:16px auto 0;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 20px;display:flex;gap:36px;
  flex-wrap:wrap;align-items:flex-start;}
.seg{border:0;padding:0;margin:0;}
.seg-legend{font-weight:600;font-size:13.5px;margin-bottom:7px;padding:0;}
.seg-row{display:inline-flex;background:var(--paper);border:1px solid var(--line);
  border-radius:999px;padding:3px;}
.seg-opt{padding:6px 16px;font-size:14px;cursor:pointer;color:var(--muted);
  border-radius:999px;display:flex;align-items:center;font-weight:600;position:relative;}
.seg-opt input{position:absolute;opacity:0;pointer-events:none;}
.seg-opt:has(:focus-visible){outline:3px solid var(--pink);outline-offset:1px;}
.seg-on{background:var(--purple);color:#fff;}

/* layout */
.two-col{max-width:1080px;margin:18px auto 0;display:grid;grid-template-columns:1fr 1.15fr;gap:18px;align-items:start;}
.two-col .results{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow-y:auto;}
@media (max-width:880px){
  .two-col{grid-template-columns:1fr;}
  .two-col .results{position:static;max-height:none;overflow-y:visible;}
}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:var(--shadow);padding:22px 24px;}
.panel-title{font-family:'Sora',sans-serif;font-weight:700;font-size:20px;margin:0 0 14px;color:var(--navy);letter-spacing:-0.01em;}
.results-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  flex-wrap:wrap;}
.results-head .panel-title{margin-bottom:8px;}
.brand-logo{display:block;}
.export-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px;}
.btn-export{display:inline-flex;align-items:center;gap:6px;background:var(--card);
  border:1.5px solid var(--line);border-radius:9px;padding:6px 14px;font-size:13px;font-weight:600;
  color:var(--purple-deep);cursor:pointer;font-family:'Inter',sans-serif;}
.btn-export:hover{border-color:var(--purple);background:var(--purple-soft);}
.btn-export:disabled{opacity:.5;cursor:wait;}
.export-err{font-size:12.5px;color:var(--lose);}
.detail-wrap{margin:6px 0 12px;}
.detail-toggle{display:inline-flex;align-items:center;gap:7px;background:none;border:0;padding:4px 0;
  color:var(--purple);font-size:13.5px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;}
.detail-card{margin-top:10px;background:var(--paper);border:1px solid var(--line);
  border-radius:12px;padding:14px 16px;overflow:hidden;min-width:0;}
.detail-table-wrap{overflow-x:auto;margin:0 -16px;padding:0 16px;scrollbar-width:thin;}
.detail-table{width:100%;border-collapse:collapse;font-size:12px;
  font-variant-numeric:tabular-nums;min-width:500px;}
@media (max-width:600px){
  .panel{padding:18px 16px;}
  .detail-card{padding:12px 10px;}
  .detail-table{font-size:11px;min-width:450px;}
}
.detail-table th,.detail-table td{border:1px solid var(--line);padding:6px 8px;text-align:right;
  white-space:nowrap;}
.detail-table thead th{background:var(--card);font-weight:600;color:var(--muted);text-align:right;}
.detail-table tbody th{text-align:left;font-weight:600;color:var(--navy);}
.detail-formula{font-size:11.5px;color:var(--muted);margin:10px 0 0;line-height:1.6;}
.btn-calc{width:100%;background:var(--pink);color:#fff;border:0;border-radius:11px;
  padding:13px 20px;font-size:15.5px;font-weight:700;cursor:pointer;margin-top:18px;
  font-family:'Inter',sans-serif;letter-spacing:.01em;}
.btn-calc:hover{background:var(--pink-deep);}
.btn-calc:disabled{background:var(--line);color:var(--muted);cursor:not-allowed;}
.test-chip{font-size:12.5px;font-weight:600;color:var(--purple-deep);background:var(--purple-soft);
  border:1px solid #E3D5F0;border-radius:999px;padding:5px 14px;white-space:nowrap;}
.sub-title{font-family:'Sora',sans-serif;font-weight:700;font-size:16px;
  margin:24px 0 6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.empty{color:var(--muted);}

/* fields */
.field{margin:0 0 16px;}
.field-label{display:block;font-weight:600;font-size:13.5px;margin-bottom:5px;}
.field-hint{color:var(--muted);font-size:13.5px;margin:-2px 0 8px;max-width:58ch;}
.field-hint code{background:var(--purple-soft);padding:1px 6px;border-radius:5px;font-size:12.5px;}
.field-error{color:var(--lose);background:var(--lose-bg);border-left:3px solid var(--lose);
  font-size:13.5px;padding:7px 11px;border-radius:0 8px 8px 0;margin-top:7px;}
.input{width:100%;max-width:220px;border:1.5px solid var(--line);border-radius:10px;
  padding:10px 13px;font-size:15.5px;font-family:'Inter',sans-serif;color:var(--ink);
  background:#fff;font-feature-settings:'tnum' 1;}
.input:focus-visible{border-color:var(--purple);}
.input::placeholder{color:#A9A2B5;font-style:normal;}
.input::-webkit-outer-spin-button,.input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
.input[type=number]{-moz-appearance:textfield;appearance:textfield;}
.input-k{max-width:76px;text-align:center;}
.stepper{display:flex;align-items:center;gap:8px;}
.btn-step{width:40px;height:40px;border-radius:10px;border:1.5px solid var(--line);
  background:var(--card);font-size:20px;cursor:pointer;color:var(--purple);}
.btn-step:disabled{opacity:.35;cursor:not-allowed;}
.btn{background:var(--pink);color:#fff;border:0;border-radius:10px;padding:11px 20px;
  font-size:15px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;}
.btn:hover{background:var(--pink-deep);}
.upload-row{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0 6px;align-items:center;}
.file-name{font-size:13px;color:var(--muted);}
.outlier-wrap{margin:12px 0 24px;}
.outlier-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.outlier-header .explainer{margin:0;}
.outlier-note{margin:12px 0 24px !important;}
.outlier-note .outlier-header{margin-bottom:8px;}
.check-row{display:flex;gap:9px;align-items:flex-start;font-size:14px;margin-top:8px;cursor:pointer;}
.check-row input{margin-top:3px;width:16px;height:16px;accent-color:var(--pink);}
.format-card{border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:6px 0 4px;}
.format-title{font-size:12.5px;font-weight:600;color:var(--muted);background:var(--paper);
  padding:7px 12px;border-bottom:1px solid var(--line);}
.format-pre{margin:0;padding:10px 12px;font-size:13px;line-height:1.6;
  font-family:ui-monospace,Menlo,monospace;color:var(--ink);background:#fff;}

/* variants & allocation */
.arm-row{border-top:1px dashed var(--line);padding-top:14px;margin-top:14px;}
.arm-name{font-size:15px;font-weight:700;margin:0 0 10px;color:var(--navy);display:flex;align-items:center;gap:9px;
  font-family:'Sora',sans-serif;}
.arm-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
@media (max-width:560px){.arm-grid{grid-template-columns:1fr 1fr;}}
.cvr-readout{display:block;padding:10px 0;font-size:15.5px;font-weight:600;}
.alloc-grid{display:flex;gap:10px;flex-wrap:wrap;}
.alloc-cell .input{max-width:110px;}

/* explainers */
.explainer{margin:4px 0 16px;}
.explainer-inline{margin:2px 0 12px;}
.explainer-toggle{display:flex;align-items:center;gap:8px;background:none;border:0;padding:2px 0;
  color:var(--purple);font-size:13.5px;font-weight:600;cursor:pointer;text-align:left;
  font-family:'Inter',sans-serif;}
.exp-ring{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
  background:var(--purple-soft);border:1px solid #DCC9EE;border-radius:50%;font-size:11.5px;
  flex:none;color:var(--purple);}
.exp-lead{margin:0 0 8px;}
.exp-bullets{margin:0 0 8px;padding-left:18px;display:flex;flex-direction:column;gap:5px;}
.exp-bullets li{padding-left:2px;}
.exp-foot{margin:0;color:var(--purple-deep);}
.explainer-body{margin-top:7px;background:var(--purple-soft);border-left:3px solid var(--purple);
  padding:11px 13px;font-size:13.5px;border-radius:0 10px 10px 0;max-width:60ch;}

/* results */
.stat-row{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0 10px;}
.stat{flex:1;min-width:140px;background:var(--paper);border:1px solid var(--line);
  border-radius:12px;padding:14px 16px;}
.stat-hero{background:var(--grad);border-color:transparent;color:#fff;}
.stat-hero .stat-label{color:rgba(255,255,255,.85);}
.stat-label{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);margin-bottom:5px;}
.stat-num{font-family:'Sora',sans-serif;font-size:24px;font-weight:700;}
.note{background:var(--warn-bg);border-left:3px solid var(--warn-edge);padding:11px 13px;
  border-radius:0 10px 10px 0;font-size:14px;margin:12px 0;}
.chart-wrap{margin:6px 0 4px;min-width:0;}
.mini-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:10px;}
.mini-table th,.mini-table td{border:1px solid var(--line);padding:5px 7px;text-align:center;}
.mini-table th{background:var(--paper);font-weight:600;}

.result-card-v2{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px;margin:16px 0;box-shadow:var(--shadow);position:relative;overflow:hidden;}
.v2-winner{border-left:5px solid var(--win);}
.v2-loser{border-left:5px solid var(--lose);}
.v2-ns{border-left:5px solid var(--ns);}

.v2-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px;}
.v2-verdict-wrap{display:flex;flex-direction:column;gap:8px;}
.v2-title{font-family:'Sora',sans-serif;font-size:14px;font-weight:600;color:var(--muted);margin:0;text-transform:uppercase;letter-spacing:0.05em;}
.v2-conf-pill{background:var(--paper);padding:8px 16px;border-radius:12px;display:flex;flex-direction:column;align-items:center;min-width:100px;border:1px solid var(--line);}
.v2-conf-val{font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:var(--ink);line-height:1;}
.v2-conf-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-top:4px;}

.v2-meaning{font-size:15px;line-height:1.5;color:var(--ink);margin:0 0 24px;max-width:65ch;}

.v2-metrics{display:flex;gap:24px;align-items:center;background:var(--paper);padding:20px;border-radius:16px;margin-bottom:20px;flex-wrap:wrap;}
.v2-metric-main{flex:1;min-width:180px;}
.v2-m-label{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;}
.v2-m-val{font-family:'Sora',sans-serif;font-size:32px;font-weight:800;line-height:1;}
.v2-metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1;min-width:240px;border-left:1px solid var(--line);padding-left:24px;}
@media (max-width:600px){.v2-metric-grid{border-left:0;padding-left:0;padding-top:16px;border-top:1px solid var(--line);}}
.v2-m-item{display:flex;flex-direction:column;gap:4px;}
.v2-m-i-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;}
.v2-m-i-val{font-family:'Sora',sans-serif;font-size:18px;font-weight:700;color:var(--ink);}

.v2-details{border-top:1px solid var(--line);padding-top:16px;}
.v2-d-row{display:flex;gap:24px;flex-wrap:wrap;}
.v2-d-col{display:flex;flex-direction:column;gap:2px;}
.v2-d-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;}
.v2-d-val{font-size:14px;font-weight:700;color:var(--ink);white-space:nowrap;}
.span-full{flex-basis:100%;}

.text-win{color:var(--win);}
.text-lose{color:var(--lose);}

.v2-footer{margin-top:16px;}

.result-card{border:1px solid var(--line);border-radius:14px;padding:16px 18px;
  margin:12px 0;background:#fff;box-shadow:var(--shadow);}
.result-head{display:flex;justify-content:space-between;align-items:center;gap:10px;
  flex-wrap:wrap;margin-bottom:12px;}
.result-name{font-family:'Sora',sans-serif;font-size:15.5px;font-weight:700;margin:0;}
.result-grid{display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px 16px;margin:0;}
@media (max-width:680px){.result-grid{grid-template-columns:1fr 1fr;}}
.result-grid dt{font-size:11.5px;font-weight:600;color:var(--muted);text-transform:uppercase;
  letter-spacing:.05em;line-height:1.2;margin-bottom:2px;}
.result-grid dd{margin:0;font-size:16px;font-weight:600;white-space:nowrap;}
.span-2{grid-column:span 2;}
@media (max-width:480px){.span-2{grid-column:span 1;}}
.result-conf{font-size:14px;margin:14px 0 4px;}
.result-summary{font-size:13.5px;color:var(--muted);margin:0;max-width:64ch;}
.p-corrected{font-size:11.5px;color:var(--muted);margin:2px 0 0;font-weight:400;}
.status-block{margin:0 0 14px;padding:14px 16px;background:var(--paper);border-radius:12px;
  border:1px solid var(--line);}
.status-row{display:flex;gap:12px;padding:4px 0;align-items:baseline;}
.status-row dt{flex:none;width:120px;font-size:12px;font-weight:700;color:var(--muted);
  text-transform:uppercase;letter-spacing:.04em;}
.status-row dd{margin:0;font-size:15px;font-weight:600;color:var(--navy);}
.status-row .status-sub{display:block;font-size:12px;font-weight:400;color:var(--muted);margin-top:1px;}
.status-meaning{font-weight:400 !important;font-size:13.5px !important;color:var(--ink) !important;
  line-height:1.5;max-width:60ch;}
.result-days{font-size:13px;color:var(--purple-deep);background:var(--purple-soft);border-radius:9px;padding:8px 11px;margin:10px 0 0;}
.detail-wrap{margin-top:12px;border-top:0.5px solid var(--line);padding-top:10px;}
.detail-btn{display:inline-flex;align-items:center;gap:7px;background:none;border:0;padding:2px 0;
  color:var(--purple);font-size:13px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;}
.stat-detail{margin-top:10px;}
.stat-detail-intro{font-size:12.5px;color:var(--muted);margin:0 0 6px;}
.stat-detail-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 16px;margin:8px 0 0;}
.stat-detail-grid dt{font-size:11.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;}
.stat-detail-grid .num{font-size:15px;font-weight:600;margin:2px 0 0;}
.stat-formula{font-size:11px;color:var(--muted);margin:1px 0 0;font-family:'IBM Plex Mono',ui-monospace,monospace;}
.verdict{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:6px 14px;
  font-size:13px;font-weight:700;}
.verdict-icon{font-size:11px;}
.v-win{background:var(--win-bg);color:var(--win);}
.v-lose{background:var(--lose-bg);color:var(--lose);}
.v-ns{background:var(--ns-bg);color:var(--ns);}
.pill{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  background:var(--pink);color:#fff;border-radius:999px;padding:3px 10px;}
.pill-soft{background:var(--ns-bg);color:var(--muted);}

/* traffic split check */
.srm-ok{color:var(--win);font-weight:600;font-size:14px;margin:4px 0 12px;}
.srm-tick{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
  background:var(--win-bg);border-radius:50%;font-size:11px;margin-right:2px;}
.srm-detail{font-weight:400;color:var(--muted);}
.srm-bad{background:var(--lose-bg);border:1px solid #EFC4C0;border-radius:14px;
  padding:14px 16px;font-size:14px;margin:4px 0 14px;}
.srm-bad p{margin:7px 0 6px;}
.dimmed{opacity:.55;}

.traffic-row{display:flex;gap:8px;align-items:center;}
.block-title{font-family:'Sora',sans-serif;font-weight:700;font-size:15px;margin:20px 0 4px;color:var(--ink);}
.traffic-block-v2{display:flex;flex-direction:column;gap:16px;margin-bottom:12px;}
.traffic-arm{background:var(--paper);padding:12px 16px;border-radius:12px;border:1px solid var(--line);}
.traffic-arm-name{font-weight:700;font-size:14px;color:var(--navy);margin-bottom:10px;font-family:'Sora',sans-serif;}
.traffic-arm-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media (max-width:480px){.traffic-arm-fields{grid-template-columns:1fr;}}
.traffic-block{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:6px;}
.arm-orders{font-family:'Inter',sans-serif;font-weight:400;font-size:12.5px;color:var(--muted);margin-left:auto;}
.avatar-dot{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--avatar);color:var(--purple-deep);font-family:'Sora',sans-serif;font-weight:700;font-size:13px;flex:none;}
.select{max-width:130px;cursor:pointer;}
.derived-line{font-size:13px;color:var(--muted);margin-top:6px;}
.derived-line strong{color:var(--purple-deep);}
.rev-top-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;}
.aov-warning{background:var(--warn-bg);border-left:3px solid var(--warn-edge);padding:12px 16px;
  border-radius:0 10px 10px 0;font-size:13.5px;margin:10px 0 16px;color:var(--ink);line-height:1.5;}
.aov-warning strong{color:var(--warn-edge);}
.mismatch-warn{background:#FFF6E8;border-left:3px solid #C97B12;border-radius:0 10px 10px 0;
  padding:10px 13px;font-size:13.5px;margin:8px 0;}

/* privacy notice */
.data-privacy{display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--muted);
  background:var(--purple-soft);border:1px solid #E3D5F0;border-radius:10px;padding:10px 13px;
  margin-bottom:16px;}
.privacy-icon{flex:none;font-size:15px;}

/* upload zone */
.upload-zone{margin:10px 0 6px;}
.upload-label{display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:5px;border:2px dashed var(--line);border-radius:12px;padding:18px 16px;cursor:pointer;
  text-align:center;background:#fff;transition:border-color .15s,background .15s;}
.upload-label:hover,.upload-label:focus-within{border-color:var(--purple);background:var(--purple-soft);}
.upload-label-filled{border-style:solid;border-color:var(--purple);background:var(--purple-soft);}
.upload-icon{font-size:22px;line-height:1;}
.upload-cta{font-weight:700;font-size:14.5px;color:var(--purple-deep);word-break:break-all;}
.upload-sub{font-size:12.5px;color:var(--muted);}
.upload-fmt{font-size:12.5px;color:var(--muted);margin-top:6px;padding:0 2px;line-height:1.5;}

@media (prefers-reduced-motion:no-preference){
  .tab,.subtab,.btn,.btn-step,.seg-opt{transition:background .15s,border-color .15s,color .15s,box-shadow .15s;}
}
`;

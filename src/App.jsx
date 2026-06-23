import React, { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
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

// Sample size for continuous metrics (e.g. revenue)
function requiredNPerArmContinuous(cv, mdeRel, alphaAdj, power, twoSided) {
  if (cv <= 0 || mdeRel <= 0) return Infinity;
  const za = normInv(twoSided ? 1 - alphaAdj / 2 : 1 - alphaAdj);
  const zb = normInv(power);
  const n = (2 * Math.pow(cv, 2) * Math.pow(za + zb, 2)) / Math.pow(mdeRel, 2);
  return Math.ceil(n);
}

// Smallest detectable relative MDE for a given n per arm (continuous)
function detectableMdeContinuous(cv, nAvail, alphaAdj, power, twoSided) {
  if (nAvail < 2 || cv <= 0) return null;
  const za = normInv(twoSided ? 1 - alphaAdj / 2 : 1 - alphaAdj);
  const zb = normInv(power);
  const mde = Math.sqrt((2 * Math.pow(cv, 2) * Math.pow(za + zb, 2)) / nAvail);
  return mde;
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

  // Draw Logo using the actual SVG from the page
  try {
    const svgEl = document.querySelector('.brand-logo');
    if (svgEl) {
      const pink = getComputedStyle(document.documentElement).getPropertyValue('--pink').trim() || '#DC004A';
      const svgClone = svgEl.cloneNode(true);
      const path = svgClone.querySelector('path');
      if (path) path.setAttribute('fill', pink);
      
      const svgString = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      const scale = 4; // High scale for crisp PDF
      canvas.width = 120 * scale;
      canvas.height = 35 * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', M, y, 120, 35);
      nl(45);
    } else {
      throw new Error("Logo not found");
    }
  } catch (e) {
    // Fallback to stylized text if SVG fails
    const brandColor = [220, 0, 74];
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(...brandColor);
    doc.text("eclipse", M, y + 16); nl(32);
  }

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

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <polyline points="8 12 12 17 16 12" />
      <line x1="12" y1="3" x2="12" y2="17" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function ExportButtons({ onCsv, onPdf }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="export-row">
      <button type="button" className="btn-export" onClick={onCsv}>
        <DownloadIcon /> CSV
      </button>
      <button type="button" className="btn-export" disabled={pdfBusy}
        onClick={async () => {
          setErr(""); setPdfBusy(true);
          try { await onPdf(); } catch (e) { setErr(e.message); }
          setPdfBusy(false);
        }}>
        <DownloadIcon /> {pdfBusy ? "Preparing…" : "PDF"}
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
  pvalue_adj: {
    label: "What is an adjusted p-value?",
    lead: "When testing multiple variants, the risk of a false positive (a 'fluke') increases. We use the Holm-Bonferroni correction to adjust for this.",
    bullets: [
      "p-value: The raw probability for this specific variant.",
      "adj: The adjusted probability after accounting for the other variants in your test.",
    ],
    foot: "A result is only significant if the adjusted p-value is below your threshold.",
  },
  confidence: {
    label: "What does the confidence level mean?",
    body: "Confidence protects you from shipping a fluke. It sets how sure you need to be before calling a variant a winner. At 95% (the industry standard), you accept a 1-in-20 risk of declaring a winner when the variant actually does nothing. At 99% that risk drops to 1-in-100 but you need more traffic; at 90% it rises to 1-in-10. 95% is the default as it's the standard business trade-off.",
  },
  power: {
    label: "What is statistical power?",
    lead: "Power is your protection against missing a winner — the chance your test spots a real improvement instead of coming back flat. 80% is the default as it is the standard business trade-off between speed and sensitivity.",
    bullets: [
      "70% power: a 3-in-10 chance a genuine winner looks like nothing. Fastest, but riskiest.",
      "80% power: a 1-in-5 chance of missing a real winner. The standard choice.",
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
    body: "Revenue data often contains 'whales' — a few customers who spend 10x or 100x more than the average. These outliers can skew your results and make a variant look like a winner just because one person made a huge purchase. Capping (Winsorizing) replaces these extreme values with a lower threshold (e.g. the 99th percentile), making your statistical test more robust and reliable.",
  },
  skewness: {
    label: "What is data skewness?",
    body: "Skewness measures how lopsided your data is. Revenue data is almost always 'right-skewed' because most people spend a little and a few spend a lot. If skewness is very high, the standard t-test can become unreliable. Our tool checks this for you and warns you if your data shape might be problematic for the standard test.",
  },
  cv: {
    label: "What is the Coefficient of Variation (CV)?",
    body: "The CV is the standard deviation divided by the mean. It tells you how much 'noise' there is in your data relative to the signal. For revenue, a CV of 1.0 to 2.5 is common. You need this to estimate how many visitors you'll need to detect a change in revenue.",
  },
};

const FAQ_ITEMS = [
  {
    q: "How do I know if my A/B test result is statistically significant?",
    a: "A result is statistically significant when the difference between your variants is unlikely to be down to random fluctuation. This calculator compares your conversion rates and tells you, in plain English, whether the difference clears your chosen confidence level (90%, 95% or 99%).",
  },
  {
    q: "How many visitors do I need for an A/B test?",
    a: "It depends on your baseline conversion rate, the smallest improvement you want to detect, and how many variants you're testing. Enter those in the planning calculator and it returns the visitors needed per variant and an estimated test duration in weeks.",
  },
  {
    q: "Can this calculator handle more than two variants?",
    a: "Yes. It supports A/B/C/n tests and automatically applies the correct multiple-comparison correction, which many calculators either can't do or handle incorrectly.",
  },
  {
    q: "Can I measure the effect on revenue, not just conversion rate?",
    a: "Yes. Upload your order data and the calculator measures revenue per visitor and average order value, using the correct statistical test for revenue figures.",
  },
  {
    q: "How long should I run an A/B test?",
    a: "Run it until it reaches the sample size your plan calls for, and ideally for at least one to two full weeks so it captures normal variation across the week. The planning calculator estimates the duration for you.",
  },
];

function useChartTheme() {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const obs = new MutationObserver(bump);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", bump);
    };
  }, []);
  return React.useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    return {
      grid: v("--chart-grid", "#EFE8F3"),
      tick: v("--chart-tick", "#6B6478"),
      line: v("--chart-line", "#5B2A86"),
      dot: v("--chart-dot", "#E4014E"),
      dotStroke: v("--chart-dot-stroke", "#fff"),
      control: v("--chart-control", "#9A93A8"),
      tooltipBg: v("--chart-tooltip-bg", "#fff"),
      tooltipBorder: v("--chart-tooltip-border", "#E9E6F0"),
      tooltipText: v("--chart-tooltip-text", "#1C1328"),
    };
  }, [tick]);
}

function chartTipProps(colors) {
  return {
    contentStyle: {
      background: colors.tooltipBg,
      border: `1px solid ${colors.tooltipBorder}`,
      borderRadius: 8,
      fontSize: 13,
      color: colors.tooltipText,
    },
    itemStyle: { color: colors.tooltipText },
    labelStyle: { color: colors.tooltipText },
  };
}

function DetectableUpliftSection({ chart, viewMode, setViewMode }) {
  const colors = useChartTheme();
  const tip = chartTipProps(colors);
  return (
    <>
      <div className="sub-title-row">
        <h3 className="sub-title">Detectable uplift by duration</h3>
        <div className="view-toggle">
          <button type="button" className={`view-btn ${viewMode === "chart" ? "view-btn-on" : ""}`}
            onClick={() => setViewMode("chart")}>Chart</button>
          <button type="button" className={`view-btn ${viewMode === "table" ? "view-btn-on" : ""}`}
            onClick={() => setViewMode("table")}>Table</button>
        </div>
      </div>
      <p className="field-hint">
        How small a relative uplift this traffic can reliably detect if you run for longer.
      </p>
      {viewMode === "chart" ? (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" />
              <XAxis dataKey="week" tick={{ fontSize: 12, fill: colors.tick }}
                label={{ value: "Weeks", position: "insideBottom", offset: -2, fontSize: 12, fill: colors.tick }} />
              <YAxis tick={{ fontSize: 12, fill: colors.tick }} unit="%" width={48} />
              <ChartTip formatter={(v) => [`${v}%`, "Detectable relative uplift"]}
                labelFormatter={(w) => `${w} week${w === 1 ? "" : "s"}`} {...tip} />
              <Line type="monotone" dataKey="mde" stroke={colors.line} strokeWidth={2.5}
                dot={{ r: 3.5, fill: colors.dot, stroke: colors.dotStroke, strokeWidth: 1.5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="detail-table-wrap">
          <table className="mini-table vertical-on-mobile">
            <caption className="sr-only">Detectable relative uplift by number of weeks</caption>
            <thead>
              <tr><th scope="col">Weeks</th>{chart.map((r) => <th scope="col" key={r.week}>{r.week}</th>)}</tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Uplift</th>
                {chart.map((r) => (
                  <td key={r.week} data-label={`Week ${r.week}`}>{r.mde != null ? `${r.mde}%` : "—"}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FaqSection() {
  return (
    <section className="faq-section" aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="faq-heading">Frequently asked questions</h2>
      <div className="faq-list">
        {FAQ_ITEMS.map(({ q, a }) => (
          <article key={q} className="faq-item">
            <h3 className="faq-q">{q}</h3>
            <p className="faq-a">{a}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────── Shared UI pieces ─────────────────────── */

function Explainer({ id, inline, label }) {
  const [open, setOpen] = useState(false);
  const e = EXPLAINERS[id];
  if (!e) return null;
  return (
    <div className={`explainer ${inline ? "explainer-inline" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="explainer-toggle"
        aria-expanded={open}
        aria-controls={`exp-${id}-${inline ? "i" : "b"}`}
        onClick={() => setOpen(!open)}
      >
        {label && <span className="explainer-label-text">{label}</span>}
        <span aria-hidden="true" className="exp-ring">?</span>
      </button>
      {open && (
        <div id={`exp-${id}-${inline ? "i" : "b"}`} className="explainer-body">
          <div className="exp-title">{e.label}</div>
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

function Field({ label, hint, error, children, htmlFor, explainerId }) {
  return (
    <div className="field">
      <div className="field-label-row">
        {explainerId ? (
          <Explainer id={explainerId} inline label={label} />
        ) : (
          <label className="field-label" htmlFor={htmlFor}>{label}</label>
        )}
      </div>
      {hint && <div className="field-hint">{hint}</div>}
      {children}
      {error && <div className="field-error" role="alert">{error}</div>}
    </div>
  );
}

function WinnerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function LoserIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function NsIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function Verdict({ kind, txtOverride }) {
  const map = {
    winner: { txt: "Significant winner", icon: <WinnerIcon />, cls: "v-win" },
    loser: { txt: "Significant loser", icon: <LoserIcon />, cls: "v-lose" },
    ns: { txt: "Not significant", icon: <NsIcon />, cls: "v-ns" },
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
    <Field label={legend} explainerId={explainerId}>
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
    </Field>
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
            <label className="field-label" htmlFor={`${idPrefix}-alloc-${i}`} title={`${labels[i]} %`}>
              {labels[i]} %
            </label>
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
      <div style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px'}}>
        <Explainer id="srm" inline label={<strong>Your traffic didn't split the way it was planned.</strong>} />
      </div>
      <p>
        This is known as a sample ratio mismatch. It usually points to a setup issue rather than
        user behaviour — common causes are redirect bugs, bot filtering that treats variants
        differently, or lost tracking on one variant. The groups may not be comparable, so the
        results below may be unreliable. Worth checking the implementation before acting on them.
      </p>
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

function PreTest({ confidence, twoTailed, power, setPower }) {
  const [baseline, setBaseline] = useState("");
  const [mde, setMde] = useState("");
  const [traffic, setTraffic] = useState("");
  const [period, setPeriod] = useState("week"); // day | week | month
  const [k, setK] = useState(2);
  const [alloc, setAlloc] = useState(equalSplit(2));
  const [calculated, setCalculated] = useState(false);
  const [viewMode, setViewMode] = useState("chart"); // chart | table

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
    const days = Math.ceil(nPerArm / ((wk / 7) * minAllocFrac));
    const weeks = Math.ceil(days / 7);
    const chart = [];
    for (let w = 1; w <= 12; w++) {
      const nAvail = Math.floor(wk * minAllocFrac * w);
      const d = detectableMde(p1, nAvail, alphaAdj, power, twoTailed);
      chart.push({ week: w, mde: d != null ? +(d * 100).toFixed(2) : null });
    }
    result = { nPerArm, total: nPerArm * k, weeks, days, chart };
  }

  return (
    <div className="two-col">
      <section className="panel" aria-labelledby="pre-h">

        <Field label="Baseline conversion rate (%)" htmlFor="pre-baseline" error={errors.baseline} explainerId="ztest"
          hint="Your current conversion rate, before the test.">
          <input id="pre-baseline" className="input" type="number" min="0" max="100" step="0.01" placeholder="e.g. 2.0"
            value={baseline} onChange={(e) => setBaseline(e.target.value)} />
        </Field>

        <Field
          label="Minimum detectable effect (relative uplift, %)"
          htmlFor="pre-mde"
          hint="The smallest uplift worth detecting, relative to your baseline."
          error={errors.mde}
          explainerId="mde"
        >
          <input id="pre-mde" className="input" type="number" min="0" step="0.1" placeholder="e.g. 10"
            value={mde} onChange={(e) => setMde(e.target.value)} />
          {!errors.mde && !errors.baseline && mdeRel > 0 && (
            <div className="derived-line">
              <Explainer id="mdeabs" inline label={<span>= <strong>{fmtPct(mdeAbs)}</strong> absolute ({fmtPct(p1)} → {fmtPct(p1 * (1 + mdeRel))})</span>} />
            </div>
          )}
        </Field>

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
            <Explainer id="holm" inline label="the correction this needs" />, so the duration estimate is honest for a multi-variant test.
          </p>
        )}

        <Field label="Traffic split (defaults to equal)" htmlFor={undefined}>
          <AllocationEditor alloc={alloc} setAlloc={setAlloc} labels={labels} idPrefix="pre" />
        </Field>

        <button type="button" className="btn-calc"
          onClick={() => {
            setCalculated(true);
            setTimeout(() => {
              const resultsEl = document.querySelector('.results');
              if (resultsEl) {
                resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 100);
          }} 
          disabled={!inputsValid}>
          Calculate
        </button>
      </section>

      <section className="panel results" aria-live="polite" aria-labelledby="pre-r">
        <div className="results-head">
          <h2 id="pre-r" className="panel-title">Results</h2>
          <div className="test-chip-row">
            <div className="test-pill">{twoTailed ? "Two-tailed" : "One-tailed"}</div>
            <div className="test-pill">{Math.round(confidence * 100)}% confidence</div>
            <div className="test-pill">{Math.round(power * 100)}% power</div>
          </div>
        </div>
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
                ["Estimated duration (days)", result.days],
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
                `Estimated duration: ${result.days} ${result.days === 1 ? "day" : "days"} (${result.weeks} ${result.weeks === 1 ? "week" : "weeks"})`,
              ]},
              { heading: "Detectable relative uplift by duration", lines:
                result.chart.map(c => `Week ${c.week}: ${c.mde != null ? c.mde + "%" : "—"}`) },
            ])}
          />
        )}
        {!result && <p className="empty">Enter your test details to calculate required sample sizes and duration.</p>}
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
                <div className="stat-num">{result.days} {result.days === 1 ? "day" : "days"}</div>
                <div className="stat-sub-label">({result.weeks} {result.weeks === 1 ? "week" : "weeks"})</div>
              </div>
            </div>
            {result.weeks < 2 && (
              <p className="note">
                This plan completes in under 2 weeks. Behaviour varies across the week
                (weekday vs weekend, pay cycles) — running at least 1–2 full weeks is recommended
                regardless.
              </p>
            )}
            <DetectableUpliftSection chart={result.chart} viewMode={viewMode} setViewMode={setViewMode} />
          </>
        )}
      </section>
    </div>
  );
}

/* Expandable "show the working" detail — z-test internals + distribution chart */
function PreTestRevenue({ confidence, twoTailed, power, setPower }) {
  const [cv, setCv] = useState("1.5");
  const [mde, setMde] = useState("");
  const [traffic, setTraffic] = useState("");
  const [period, setPeriod] = useState("week");
  const [k, setK] = useState(2);
  const [alloc, setAlloc] = useState(equalSplit(2));
  const [calculated, setCalculated] = useState(false);
  const [viewMode, setViewMode] = useState("chart"); // chart | table
  const [sdCalcOpen, setSdCalcOpen] = useState(false);
  const [sdInput, setSdInput] = useState("");
  const [sdResult, setSdResult] = useState(null);

  const labels = useMemo(() => makeLabels(k), [k]);
  const setVariantCount = (next) => {
    const kk = Math.max(2, Math.min(8, next));
    setK(kk);
    setAlloc(equalSplit(kk));
  };

  const runSdCalc = () => {
    const raw = sdInput.split(/[\n,]/).map(v => v.trim().replace(/[£$€\s]/g, '').replace(/,/g, '')).filter(v => v !== "");
    const vals = raw.map(Number).filter(v => !isNaN(v));
    if (vals.length < 2) {
      setSdResult({ error: "Paste at least 2 numbers to calculate standard deviation." });
      return;
    }
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const s = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (vals.length - 1));
    const calculatedCv = s / m;
    setSdResult({ mean: m, sd: s, cv: calculatedCv, count: vals.length });
    setCv(calculatedCv.toFixed(3));
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setCalculated(false); },
    [cv, mde, traffic, period, power, k, alloc, confidence, twoTailed]);

  const errors = {};
  const cvNum = Number(cv);
  const mdeRel = Number(mde) / 100;
  const trafficNum = Number(traffic);
  const perWeekFactor = period === "day" ? 7 : period === "month" ? 12 / 52 : 1;
  const wk = trafficNum * perWeekFactor;
  
  if (!(cvNum > 0)) errors.cv = "Enter a coefficient of variation greater than 0.";
  if (!(mdeRel > 0)) errors.mde = "Enter a relative uplift greater than 0.";
  if (!(trafficNum > 0)) errors.traffic = "Enter a number of visitors greater than 0.";
  const allocSum = alloc.reduce((a, b) => a + (Number(b) || 0), 0);
  const allocOk = Math.abs(allocSum - 100) <= 0.5 && alloc.every((a) => Number(a) > 0);

  const alpha = 1 - confidence;
  const comparisons = k - 1;
  const alphaAdj = alpha / Math.max(1, comparisons);

  const inputsValid = Object.keys(errors).length === 0 && allocOk;
  let result = null;
  if (calculated && inputsValid) {
    const nPerArm = requiredNPerArmContinuous(cvNum, mdeRel, alphaAdj, power, twoTailed);
    const minAllocFrac = Math.min(...alloc.map((a) => Number(a) / 100));
    const days = Math.ceil(nPerArm / ((wk / 7) * minAllocFrac));
    const weeks = Math.ceil(days / 7);
    const chart = [];
    for (let w = 1; w <= 12; w++) {
      const nAvail = Math.floor(wk * minAllocFrac * w);
      const d = detectableMdeContinuous(cvNum, nAvail, alphaAdj, power, twoTailed);
      chart.push({ week: w, mde: d != null ? +(d * 100).toFixed(2) : null });
    }
    result = { nPerArm, total: nPerArm * k, weeks, days, chart };
  }

  return (
    <div className="two-col">
      <section className="panel" aria-labelledby="pre-rev-h">
        <Field label="Coefficient of Variation (CV)" htmlFor="pre-cv" error={errors.cv} explainerId="cv"
          hint="Standard deviation divided by the mean. Usually between 1.0 and 2.5 for revenue.">
          <input id="pre-cv" className="input" type="number" min="0" step="0.01" placeholder="e.g. 1.5"
            value={cv} onChange={(e) => setCv(e.target.value)} />
        </Field>

        <div className="sd-calc-section">
          <button type="button" className="btn-text" onClick={() => setSdCalcOpen(!sdCalcOpen)}>
            {sdCalcOpen ? "− Hide" : "+ Don't know your CV? Calculate it from historical data"}
          </button>
          {sdCalcOpen && (
            <div className="sd-calc-box">
              <p className="field-hint">
                Paste a list of individual order values (the total revenue from each transaction) from a recent period, such as the last 30 days. 
                This calculates the spread (CV) of your revenue data, which is required to plan a revenue-based test.
              </p>
              <textarea
                className="input"
                style={{height: '100px', fontSize: '13px'}}
                placeholder="Paste values here (one per line or comma-separated)...&#10;e.g.&#10;45.00&#10;120.50&#10;89.99"
                value={sdInput}
                onChange={e => setSdInput(e.target.value)}
              />
              <button type="button" className="btn-calc" style={{marginTop: '8px'}} onClick={runSdCalc}>
                Calculate CV
              </button>
              {sdResult && (
                <div className="sd-result">
                  {sdResult.error ? (
                    <div className="field-error">{sdResult.error}</div>
                  ) : (
                    <div className="stat-grid" style={{marginTop: '12px', gridTemplateColumns: '1fr 1fr 1fr'}}>
                      <div className="stat">
                        <div className="stat-label">Mean</div>
                        <div className="stat-num" style={{fontSize: '18px'}}>{fmtMoney(sdResult.mean)}</div>
                      </div>
                      <div className="stat">
                        <div className="stat-label">Std Dev</div>
                        <div className="stat-num" style={{fontSize: '18px'}}>{fmtMoney(sdResult.sd)}</div>
                      </div>
                      <div className="stat">
                        <div className="stat-label">CV</div>
                        <div className="stat-num" style={{fontSize: '18px'}}>{(sdResult.cv * 100).toFixed(1)}%</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <Field
          label="Minimum detectable effect (relative uplift, %)"
          htmlFor="pre-rev-mde"
          hint="The smallest uplift in revenue worth detecting."
          error={errors.mde}
          explainerId="mde"
        >
          <input id="pre-rev-mde" className="input" type="number" min="0" step="0.1" placeholder="e.g. 5"
            value={mde} onChange={(e) => setMde(e.target.value)} />
        </Field>

        <Field label="Visitors (all variants combined)" htmlFor="pre-rev-traffic" error={errors.traffic}>
          <div className="traffic-row">
            <input id="pre-rev-traffic" className="input" type="number" min="1" step="1" placeholder="e.g. 50,000"
              value={traffic} onChange={(e) => setTraffic(e.target.value)} />
            <select className="input select" value={period} aria-label="Traffic period"
              onChange={(e) => setPeriod(e.target.value)}>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </div>
        </Field>

        <VariantStepper k={k} setVariantCount={setVariantCount} idBase="pre-rev-k" />
        
        <Field label="Traffic split (defaults to equal)" htmlFor={undefined}>
          <AllocationEditor alloc={alloc} setAlloc={setAlloc} labels={labels} idPrefix="pre-rev" />
        </Field>

        <button type="button" className="btn-calc"
          onClick={() => {
            setCalculated(true);
            setTimeout(() => {
              const resultsEl = document.querySelector('.results');
              if (resultsEl) {
                resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 100);
          }} 
          disabled={!inputsValid}>
          Calculate
        </button>
      </section>

      <section className="panel results" aria-live="polite" aria-labelledby="pre-rev-r">
        <div className="results-head">
          <h2 id="pre-rev-r" className="panel-title">Results</h2>
          <div className="test-chip-row">
            <div className="test-pill">{twoTailed ? "Two-tailed" : "One-tailed"}</div>
            <div className="test-pill">{Math.round(confidence * 100)}% confidence</div>
            <div className="test-pill">{Math.round(power * 100)}% power</div>
          </div>
        </div>
        {result && (
          <ExportButtons
            onCsv={() => {
              const rows = [
                ["Eclipse — Revenue planning", ""],
                ["Generated", new Date().toLocaleString("en-GB")],
                [],
                ["Inputs", ""],
                ["Coefficient of Variation (CV)", cv],
                ["Minimum detectable effect (relative)", `${mde}%`],
                ["Visitors", `${traffic} ${period === "day" ? "per day" : period === "month" ? "per month" : "per week"}`],
                ["Variants (incl. control)", k],
                ["Confidence level", `${Math.round(confidence*100)}%`],
                ["Statistical power", `${Math.round(power*100)}%`],
                ["Tails", twoTailed ? "Two-tailed" : "One-tailed"],
                [],
                ["Results", ""],
                ["Visitors required per variant", result.nPerArm],
                ["Total visitors required", result.total],
                ["Estimated duration (days)", result.days],
                ["Estimated duration (weeks)", result.weeks],
                [],
                ["Detectable uplift %", ...result.chart.map(c => c.mde ?? "")],
              ];
              downloadBlob(toCsv(rows), `eclipse-plan-rev-${stamp()}.csv`, "text/csv");
            }}
            onPdf={() => {
              exportPdf("Revenue test planning", [
                { heading: "Setup", lines: [
                  `Coefficient of Variation (CV): ${cv}`,
                  `Minimum detectable effect (relative): ${mde}%`,
                  `Visitors: ${traffic} ${period === "day" ? "per day" : period === "month" ? "per month" : "per week"}`,
                  `Variants (incl. control): ${k}`,
                  `Confidence: ${Math.round(confidence*100)}%   Power: ${Math.round(power*100)}%   ${twoTailed ? "Two-tailed" : "One-tailed"}`,
                ]},
                { heading: "Results", lines: [
                  `Visitors required per variant: ${fmtInt(result.nPerArm)}`,
                  `Total visitors required: ${fmtInt(result.total)}`,
                  `Estimated duration: ${result.days} ${result.days === 1 ? "day" : "days"} (${result.weeks} ${result.weeks === 1 ? "week" : "weeks"})`,
                ]},
                { heading: "Detectable relative uplift by duration", lines:
                  result.chart.map(c => `Week ${c.week}: ${c.mde != null ? c.mde + "%" : "—"}`) },
              ]);
            }}
          />
        )}
        {!result && <p className="empty">Enter your test details to calculate required sample sizes and duration.</p>}
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
                <div className="stat-num">{result.days} {result.days === 1 ? "day" : "days"}</div>
                <div className="stat-sub-label">({result.weeks} {result.weeks === 1 ? "week" : "weeks"})</div>
              </div>
            </div>
            {result.weeks < 2 && (
              <p className="note">
                This plan completes in under 2 weeks. Behaviour varies across the week
                (weekday vs weekend, pay cycles) — running at least 1–2 full weeks is recommended
                regardless.
              </p>
            )}
            <DetectableUpliftSection chart={result.chart} viewMode={viewMode} setViewMode={setViewMode} />
          </>
        )}
      </section>
    </div>
  );
}

function DistributionChart({ comparisons }) {
  const colors = useChartTheme();
  const tip = chartTipProps(colors);
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
    row.control = normalPdf(x, comparisons[0].p1, comparisons[0].seA);
    comparisons.forEach((c, j) => { row[`v${j}`] = normalPdf(x, c.p2, c.seB); });
    data.push(row);
  }
  const palette = ["#DC004A", "#818CF8", "#34D399", "#FBBF24", "#F87171", "#38BDF8", "#FB7185"];
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" />
          <XAxis dataKey="x" tick={{ fontSize: 11, fill: colors.tick }} unit="%"
            tickFormatter={(v) => v.toFixed(2)} minTickGap={28} />
          <YAxis hide />
          <ChartTip
            formatter={(val, key) => [Math.round(val), key === "control" ? "Variant A (Control)" : "Variant"]}
            labelFormatter={(x) => `CVR ${(+x).toFixed(3)}%`} {...tip} />
          <Line type="monotone" dataKey="control" stroke={colors.control} strokeWidth={2} dot={false} isAnimationActive={false} name="Variant A (Control)" />
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
                    <td data-label="Std error A">{c.seA.toFixed(5)}</td>
                    <td data-label="Std error">{c.seB.toFixed(5)}</td>
                    <td data-label="Std error of diff">{c.seDiff.toFixed(5)}</td>
                    <td data-label="Z-score">{c.z.toFixed(4)}</td>
                    <td data-label="p-value">{fmtP(c.pAdj)}</td>
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
  confidence, twoTailed, ciFmt, addDays, metricNoun = "performed", meaningOverride, zScore, goal = "increase", skewVerdict }) {
  const [showDetails, setShowDetails] = useState(false);
  const alpha = 1 - confidence;
  const decisionP = corrected ? pAdj : pRaw;
  const sig = Number.isFinite(decisionP) && decisionP < alpha;

  let kind = "ns";
  if (sig && relUplift != null) {
    const isPositive = relUplift > 0;
    if (goal === "decrease") {
      if (!isPositive) kind = "winner";
      else kind = twoTailed ? "loser" : "ns";
    } else {
      if (isPositive) kind = "winner";
      else kind = twoTailed ? "loser" : "ns";
    }
  }
  const confPct = Math.round(confidence * 100);
  const confValue = Number.isFinite(decisionP) ? Math.min(99.9, (1 - decisionP) * 100) : null;
  const fmtCi = ciFmt || ((lo, hi) => `${fmtPct(lo)} – ${fmtPct(hi)}`);

  const who = name.split(" vs ")[0];
  const betterTxt = goal === "decrease" ? "lower" : "better";
  const worseTxt = goal === "decrease" ? "higher" : "worse";
  
  const meaning = meaningOverride || (
    kind === "winner"
      ? `The difference is large enough to be a real effect, not random fluctuation — ${who} ${metricNoun} ${betterTxt} than Variant A.`
      : kind === "loser"
      ? `The difference is large enough to be a real effect, not random fluctuation — ${who} ${metricNoun} ${worseTxt} than Variant A.`
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

      {skewVerdict && skewVerdict.level !== 'low' && (
        <div className={`skew-banner skew-${skewVerdict.level}`}>
          <span className="skew-icon">!</span>
          <span className="skew-text">{skewVerdict.text}</span>
        </div>
      )}

      <div className="v2-metrics">
        <div className="v2-metric-main">
          <div className="v2-m-label">Relative Uplift</div>
          <div className={`v2-m-val ${((goal === "decrease" && relUplift <= 0) || (goal === "increase" && relUplift >= 0)) ? 'text-win' : 'text-lose'}`}>
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

      <div className="v2-details-toggle-wrap">
        <button type="button" className="btn-text" onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? "− Hide statistical details" : "+ Show statistical details"}
        </button>
      </div>

      {showDetails && (
        <div className="v2-details">
          <div className="v2-d-row">
            <div className="v2-d-col">
              <span className="v2-d-label"><Explainer id={corrected ? "pvalue_adj" : "pvalue"} inline label="p-value" /></span>
              <span className="v2-d-val">{fmtP(pRaw)} {corrected && <small>(adj)</small>}</span>
            </div>
            <div className="v2-d-col">
              <span className="v2-d-label">{zScore?.label || "Z-score"}</span>
              <span className="v2-d-val">{zScore?.value != null ? zScore.value.toFixed(4) : "—"}</span>
            </div>
            {ciBase && (
              <div className="v2-d-col">
                <span className="v2-d-label"><Explainer id="confpct" inline label={`${baseCiLabel || "Control"} (${confPct}% CI)`} /></span>
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
      )}

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
  const [showDetails, setShowDetails] = useState(false);
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

      <div className="v2-details-toggle-wrap">
        <button type="button" className="btn-text" onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? "− Hide statistical details" : "+ Show statistical details"}
        </button>
      </div>

      {showDetails && (
        <div className="v2-details">
          <div className="v2-d-row">
            <div className="v2-d-col">
              <span className="v2-d-label"><Explainer id="noninf" inline label="Acceptable Margin" /></span>
              <span className="v2-d-val">−{fmtPct(marginRel)}</span>
            </div>
            <div className="v2-d-col">
              <span className="v2-d-label">p-value</span>
              <span className="v2-d-val">{fmtP(pRaw)}</span>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

/* ─────────────── POST_TEST · Conversion rate (§3) ─────────────── */

function PostCvr({ confidence, twoTailed, k, rows, setRows, alloc, setAlloc, setVariantCount, durationDays, setDurationDays }) {
  const labels = makeLabels(k);
  const [question, setQuestion] = useState("better"); // "better" | "noninf"
  const [goal, setGoal] = useState("increase");       // "increase" | "decrease"
  const [marginPct, setMarginPct] = useState("1");     // non-inferiority margin, relative %
  const marginRel = Number(marginPct) / 100;
  const isNonInf = question === "noninf";
  const [calculated, setCalculated] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setCalculated(false); },
    [rows, alloc, question, goal, marginPct, k, confidence, twoTailed, durationDays]);

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
        {!isNonInf && (
          <SegControl
            legend="Goal direction"
            name="goal"
            value={goal}
            onChange={setGoal}
            options={[
              { value: "increase", label: "Increase is a winner" },
              { value: "decrease", label: "Decrease is a winner" },
            ]}
          />
        )}
        {isNonInf && (
          <>
            <Field label="Acceptable margin (relative drop you can live with, %)" htmlFor="cvr-margin"
              explainerId="noninf"
              hint="Example: 1% means you'll accept the variant as long as it isn't more than 1% below control.">
              <input id="cvr-margin" className="input" type="number" min="0" step="0.1"
                value={marginPct} onChange={(e) => setMarginPct(e.target.value)} />
            </Field>
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

        <Field label="Planned traffic split (for the traffic split check)" htmlFor={undefined} explainerId="srm"
          hint="Defaults to an equal split — change it if your experiment was set up with an unequal split.">
          <AllocationEditor alloc={alloc} setAlloc={setAlloc} labels={labels} idPrefix="cvr" />
        </Field>

        <Field label="Test duration in days (optional)" htmlFor="cvr-days">
          <input id="cvr-days" className="input" type="number" min="1" step="1"
            value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
        </Field>

        <button type="button" className="btn-calc"
          onClick={() => {
            setCalculated(true);
            setTimeout(() => {
              const resultsEl = document.querySelector('.results');
              if (resultsEl) {
                resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 100);
          }} 
          disabled={!inputsValid}>
          Calculate
        </button>
      </section>

      <section className="panel results" aria-live="polite" aria-labelledby="cvr-r">
        <div className="results-head">
          <h2 id="cvr-r" className="panel-title">Results</h2>
          <div className="test-chip-row">
            <div className="test-pill">{isNonInf ? "One-tailed" : (twoTailed ? "Two-tailed" : "One-tailed")}</div>
            <div className="test-pill">{Math.round(confidence * 100)}% confidence</div>
            {isNonInf && <div className="test-pill">{fmtPct(marginRel)} margin</div>}
            {!isNonInf && corrected && <div className="test-pill">Multi-variant corrected</div>}
          </div>
        </div>
        {ready && (
          <ExportButtons
            onCsv={() => {
              const head = [
                ["Eclipse — Conversion rate analysis", ""],
                ["Generated", new Date().toLocaleString("en-GB")],
                ["Test type", isNonInf ? `Non-inferiority (margin ${fmtPct(marginRel)})` : `Z-test, ${twoTailed ? "two-tailed" : "one-tailed"}${corrected ? ", Holm-Bonferroni corrected" : ""}`],
                ["Confidence", `${Math.round(confidence*100)}%`],
                ["Goal direction", goal === "decrease" ? "Decrease is a winner" : "Increase is a winner"],
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
                       (dp < 1 - confidence) ? ((goal === "decrease" ? r.relUplift < 0 : r.relUplift > 0) ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant"];
                   })];
              downloadBlob(toCsv([...head, ...body]), `eclipse-cvr-${stamp()}.csv`, "text/csv");
            }}
            onPdf={() => {
              const currentResults = results;
              const currentNoninfResults = noninfResults;
              const currentParsed = parsed;
              const currentLabels = labels;
              const currentGoal = goal;
              exportPdf("Conversion rate analysis", [
                { heading: "Setup", lines: [
                  isNonInf ? `Non-inferiority test, margin ${fmtPct(marginRel)}` : `Z-test, ${twoTailed ? "two-tailed" : "one-tailed"}${corrected ? ", Holm-Bonferroni corrected" : ""}`,
                  `Confidence: ${Math.round(confidence*100)}%`,
                  !isNonInf ? `Goal: ${currentGoal === "decrease" ? "Decrease is a winner" : "Increase is a winner"}` : "",
                  srm ? (srm.flagged ? `SRM check: FLAGGED (p=${fmtP(srm.p)}) — results may be unreliable` : `SRM check: healthy (p=${fmtP(srm.p)})`) : "",
                ].filter(Boolean)},
                { heading: "Data", lines: currentParsed.map((r, i) => `${currentLabels[i]}: ${fmtInt(r.v)} visitors, ${fmtInt(r.c)} conversions (CVR ${fmtPct(r.c/r.v)})`) },
                { heading: "Results", lines: isNonInf
                  ? currentNoninfResults?.map(r => `${r.name} vs Variant A: relative diff ${fmtSignedPct(r.relDiff)} — ${(r.pRaw < 1 - confidence) ? "Non-inferiority confirmed" : (r.upperBound < -r.margin ? "Worse than margin" : "Not confirmed")}`)
                  : currentResults?.map(r => { 
                      const dp = corrected ? r.pAdj : r.pRaw; 
                      const isWin = currentGoal === "decrease" ? r.relUplift < 0 : r.relUplift > 0;
                      const verdict = (dp < 1 - confidence) ? (isWin ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant";
                      return `${r.name} vs Variant A: ${fmtSignedPct(r.relUplift)} uplift, p=${fmtP(r.pRaw)}${corrected ? ` (corrected ${fmtP(r.pAdj)})` : ""}, ${Math.min(99.9,(1-dp)*100).toFixed(1)}% confidence — ${verdict}`; 
                    }) },
              ]);
            }}
          />
        )}
        {!ready && <p className="empty">Enter your test data to calculate results.</p>}
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
                      goal={goal}
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

// Parse a revenue file: handles CSV, TSV, space-delimited.
// Heuristically finds the revenue column if multiple exist.
function parseRevenueFile(text) {
  const values = [], errors = [];
  
  // Use PapaParse for robust parsing
  let results = Papa.parse(text.trim(), {
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  // Fallback for space-delimited files if auto-detection failed
  if (results.data.length > 0 && results.data[0].length === 1) {
    const spaceSplit = text.trim().split('\n')[0].split(/\s+/);
    if (spaceSplit.length > 1) {
      results = Papa.parse(text.trim(), {
        delimiter: " ",
        skipEmptyLines: true,
        dynamicTyping: false,
      });
    }
  }

  const rows = results.data;
  if (!rows || rows.length === 0) return { values, errors };

  // Heuristic to find the revenue column
  let revenueColIdx = -1;
  const firstRow = rows[0];
  const numCols = firstRow.length;

  if (numCols === 1) {
    revenueColIdx = 0;
  } else {
    // 1. Try header names
    const possibleHeaders = ["revenue", "rev", "value", "amount", "amt", "price", "total", "spend", "order_value", "order value", "sales", "sale"];
    const idHeaders = ["id", "order", "trans", "uuid", "guid", "idx", "row", "key"];

    let bestHeaderScore = -1;
    for (let c = 0; c < numCols; c++) {
      const cell = String(firstRow[c] || "").toLowerCase();
      let score = 0;
      if (possibleHeaders.some(h => cell.includes(h))) score += 10;
      if (idHeaders.some(h => cell.includes(h))) score -= 10;
      
      if (score > bestHeaderScore) {
        bestHeaderScore = score;
        revenueColIdx = c;
      }
    }

    // 2. Fallback or refinement: Analyze data
    if (bestHeaderScore <= 0) {
      const colScores = Array(numCols).fill(0);
      const rowsToTest = rows.slice(0, 20); // Test more rows
      
      for (let c = 0; c < numCols; c++) {
        let numericCount = 0;
        let hasDecimals = false;
        let avgValue = 0;
        let uniqueValues = new Set();
        let isSequential = true;
        let lastValue = null;

        rowsToTest.forEach(row => {
          const rawCell = String(row[c] || "").trim();
          const cell = rawCell.replace(/[£$€\s,]/g, '');
          const v = Number(cell);
          if (rawCell !== "" && !isNaN(v)) {
            numericCount++;
            if (rawCell.includes('.') || (rawCell.includes(',') && !rawCell.includes('.'))) hasDecimals = true;
            avgValue += Math.abs(v);
            uniqueValues.add(v);
            if (lastValue !== null && v !== lastValue + 1) isSequential = false;
            lastValue = v;
          }
        });

        if (numericCount > 0) {
          avgValue /= numericCount;
          // Score higher for columns that are numeric
          colScores[c] += (numericCount / rowsToTest.length) * 20;
          // Score higher for columns with decimals (likely prices)
          if (hasDecimals) colScores[c] += 15;
          // Score LOWER for columns that look like IDs
          if (isSequential && numericCount > 1) colScores[c] -= 30;
          if (uniqueValues.size === numericCount && numericCount > 5) colScores[c] -= 10; // Likely unique ID
          if (avgValue > 1000000 && Number.isInteger(avgValue)) colScores[c] -= 20;
        }
      }
      
      // Pick highest scoring column, prefer rightmost if tied
      let maxScore = -Infinity;
      for (let c = numCols - 1; c >= 0; c--) {
        if (colScores[c] > maxScore) {
          maxScore = colScores[c];
          revenueColIdx = c;
        }
      }
    }
  }

  if (revenueColIdx === -1) revenueColIdx = numCols - 1;

  let firstDataSeen = false;
  const rawValues = new Map(); // Map ID -> sum of revenue

  rows.forEach((row, i) => {
    let cell = String(row[revenueColIdx] || "").trim();
    if (!cell) return;

    // Clean up currency symbols and spaces
    cell = cell.replace(/[£$€\s]/g, '');

    // Robust number parsing
    // 1. If it has both , and . (e.g. 1.234,56 or 1,234.56)
    if (cell.includes(',') && cell.includes('.')) {
      const lastComma = cell.lastIndexOf(',');
      const lastDot = cell.lastIndexOf('.');
      if (lastComma > lastDot) {
        // European: 1.234,56 -> 1234.56
        cell = cell.replace(/\./g, '').replace(',', '.');
      } else {
        // US/UK: 1,234.56 -> 1234.56
        cell = cell.replace(/,/g, '');
      }
    } else if (cell.includes(',')) {
      // 2. Only has , (e.g. 1,234 or 10,50)
      // If it looks like a thousands separator (3 digits after), treat as such
      if (/^\d{1,3}(,\d{3})+$/.test(cell)) {
        cell = cell.replace(/,/g, '');
      } else {
        // Otherwise treat as decimal
        cell = cell.replace(',', '.');
      }
    }

    const v = Number(cell);
    if (!Number.isFinite(v)) {
      if (!firstDataSeen) return; // Skip header
      if (errors.length < 8) errors.push(`Row ${i + 1}: "${cell}" is not a number.`);
      return;
    }
    if (v < 0) {
      if (errors.length < 8) errors.push(`Row ${i + 1}: revenue can't be negative.`);
      firstDataSeen = true; return;
    }

    firstDataSeen = true;
    
    // Grouping logic: if there are multiple columns, use the "other" column as an ID
    let id = i; // Default to row index
    if (numCols > 1) {
      // Find a column that isn't the revenue column to use as ID
      // If there's a column that was penalized as an ID, use it.
      // Otherwise just use the first column that isn't revenue.
      let idColIdx = -1;
      for (let c = 0; c < numCols; c++) {
        if (c !== revenueColIdx) {
          idColIdx = c;
          break;
        }
      }
      if (idColIdx !== -1) id = String(row[idColIdx]);
    }

    rawValues.set(id, (rawValues.get(id) || 0) + v);
  });

  return { values: Array.from(rawValues.values()), errors, numCols, revenueColIdx };
}

function PostRevenue({ confidence, twoTailed, k, rows, alloc, setAlloc, setVariantCount, durationDays, setDurationDays }) {
  const labels = makeLabels(k);

  // Per-variant local state: visitor/conversion overrides, file parse result, file name
  const [visitorOverrides, setVisitorOverrides] = useState(Array(8).fill(''));
  const [convOverrides, setConvOverrides]       = useState(Array(8).fill(''));
  const [fileParsed, setFileParsed]             = useState(Array(8).fill(null)); // {values,errors,name}
  const [winsorize, setWinsorize]               = useState(false);
  const [outlierPct, setOutlierPct]             = useState(0.99);
  const [calculated, setCalculated]             = useState(false);
  const fileRefs = useRef(Array.from({ length: 8 }, () => null));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setCalculated(false); },
    [visitorOverrides, convOverrides, fileParsed, winsorize, outlierPct, alloc, k, confidence, twoTailed, durationDays, rows]);

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
             orders, orderCount, fp, mismatch, numCols: fp ? fp.numCols : 1 };
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
    const pLimit     = percentile(sortedAll, outlierPct);
    const skewFlag   = armData.some(a => {
      const srt = [...a.orders].sort((x,y) => x - y);
      const apLimit = percentile(srt, outlierPct);
      return (apLimit > 0 && srt[srt.length-1] > 10*apLimit) || skewness(a.orders) > 5;
    });
    const cappedOrders = winsorize
      ? armData.map(a => a.orders.map(x => Math.min(x, pLimit)))
      : armData.map(a => a.orders);

    const skewnessVerdict = (data) => {
      const s = skewness(data);
      const max = Math.max(...data);
      const m = mean(data);
      if (s > 5 || max > 10 * m) return {
        level: 'high',
        text: 'Heavily skewed data. The standard t-test may be less reliable. Capping outliers is strongly recommended.'
      };
      if (s > 2) return {
        level: 'medium',
        text: 'Moderately skewed data. Results are likely stable, but consider capping outliers if you have extreme values.'
      };
      return { level: 'low', text: 'Data distribution looks healthy for a standard t-test.' };
    };

    const alpha    = 1 - confidence;
    const armStats = armData.map((a, i) => ({
      name:    a.name,
      rpv:     rpvStats(cappedOrders[i], a.visitors),
      aov:     { m: mean(cappedOrders[i]), s: sd(cappedOrders[i]), n: cappedOrders[i].length, skew: skewnessVerdict(a.orders) },
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
      skewFlag, pLimit, armStats,
      srm: srmCheck(armData.map(a => a.visitors), alloc.map(Number)),
      rpv: buildMetric('rpv'),
      aov: buildMetric('aov'),
    };
  }

  const onFile = (i, file) => {
    const reader = new FileReader();
    reader.onload = e => {
      const { values, errors, numCols, revenueColIdx } = parseRevenueFile(e.target.result);
      setFileParsed(prev => { const n=[...prev]; n[i]={ values, errors, name: file.name, numCols, revenueColIdx }; return n; });
    };
    reader.readAsText(file);
  };

  const corrected = k >= 3;
  const days = Number(durationDays);

  return (
    <div className="two-col">
      <section className="panel" aria-labelledby="rev-h">

        <VariantStepper k={k} setVariantCount={setVariantCount} idBase="rev-k" />

        <Field label="Planned traffic split" htmlFor={undefined} explainerId="srm"
          hint="Defaults to an equal split — change it if your experiment used an unequal split (e.g. 30/70).">
          <AllocationEditor alloc={alloc} setAlloc={setAlloc} labels={labels} idPrefix="rev" />
        </Field>

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

        <h3 className="block-title">Order revenue file per variant</h3>
        {armData.map((a, i) => (
          <div className="arm-row" key={i}>
              <h3 className="arm-name">
                <span className="avatar-dot" aria-hidden="true">{LETTERS[i]}</span>
                {a.name}
                <span className="arm-orders">
                  {a.orderCount > 0 ? `${fmtInt(a.orderCount)} unique ${a.numCols > 1 ? 'IDs' : 'orders'}` : ''}
                </span>
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
                <span className="upload-icon" aria-hidden="true">{a.fp ? <FileIcon /> : <UploadIcon />}</span>
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

        <div className="outlier-wrap">
          <div className="outlier-header">
            <h3 className="block-title" style={{margin:0}}><Explainer id="winsorize" inline label="Outlier handling" /></h3>
          </div>
          <div className="outlier-controls" style={{marginTop: '12px'}}>
            <label className="check-row">
              <input type="checkbox" checked={winsorize}
                onChange={e => setWinsorize(e.target.checked)} />
              Cap order value outliers {analysis ? `at ${fmtMoney(analysis.pLimit)}` : '(optional)'}
            </label>
            {winsorize && (
              <div style={{marginTop: '12px', paddingLeft: '28px'}}>
                <SegControl
                  legend="Capping threshold"
                  name="outlier-pct"
                  value={outlierPct}
                  onChange={setOutlierPct}
                  options={[
                    { value: 0.90, label: "90th pct" },
                    { value: 0.95, label: "95th pct" },
                    { value: 0.99, label: "99th pct" },
                  ]}
                />
              </div>
            )}
          </div>
          {analysis && analysis.skewFlag && !winsorize && (
            <div className="note outlier-note" style={{marginTop: '12px'}} role="status">
              <strong>Note:</strong> Your data is heavily skewed. Capping outliers is recommended for more reliable results.
            </div>
          )}
        </div>

        <Field label="Test duration in days (optional)" htmlFor="rev-days">
          <input id="rev-days" className="input" type="number" min="1" step="1"
            value={durationDays} onChange={e => setDurationDays(e.target.value)} />
        </Field>

        <button type="button" className="btn-calc"
          onClick={() => {
            setCalculated(true);
            setTimeout(() => {
              const resultsEl = document.querySelector('.results');
              if (resultsEl) {
                resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 100);
          }} 
          disabled={!inputsValid}>
          Calculate
        </button>
      </section>

      <section className="panel results" aria-live="polite" aria-labelledby="rev-r">
        <div className="results-head">
          <h2 id="rev-r" className="panel-title">Results</h2>
          <div className="test-chip-row">
            <div className="test-pill">{twoTailed ? 'Two-tailed' : 'One-tailed'}</div>
            <div className="test-pill">{Math.round(confidence * 100)}% confidence</div>
            {corrected && <div className="test-pill">Multi-variant corrected</div>}
            {winsorize && <div className="test-pill">Outliers capped ({outlierPct * 100}th pct)</div>}
          </div>
        </div>
        {analysis && (
          <ExportButtons
            onCsv={() => {
              const rows = [
                ["Eclipse — Revenue analysis", ""],
                ["Generated", new Date().toLocaleString("en-GB")],
                ["Test type", `Welch's t-test, ${twoTailed ? "two-tailed" : "one-tailed"}${corrected ? ", Holm-Bonferroni corrected" : ""}${winsorize ? `, outliers capped at ${outlierPct * 100}th pct` : ""}`],
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
                  `Welch's t-test, ${twoTailed ? "two-tailed" : "one-tailed"}${corrected ? ", Holm-Bonferroni corrected" : ""}${winsorize ? `, outliers capped at ${outlierPct * 100}th percentile` : ""}`,
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
        {!analysis && <p className="empty">Enter your test data to calculate results.</p>}
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
              <h3 className="sub-title"><Explainer id="aovrpv" inline label="Revenue per visitor" /></h3>
              <p className="field-hint">
                Revenue Per Visitor (RPV) is the average amount of revenue generated by every person who entered the test, including those who didn't buy anything.
              </p>
              {analysis.rpv.map((r, i) => (
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
                  skewVerdict={analysis.armStats[i+1].rpv.skew}
                  meaningOverride={
                    (corrected ? r.pAdj : r.pRaw) < 1 - confidence
                      ? `The difference is large enough to be a real effect, not random fluctuation — ${r.name} ${r.relUplift >= 0 ? "generated more" : "generated less"} revenue per visitor than Variant A.`
                      : "There's not enough evidence yet to be sure this is a real difference in revenue per visitor — it could still be random fluctuation."
                  }
                />
              ))}

              <h3 className="sub-title"><Explainer id="aovrpv" inline label="Average order value" /></h3>
              <div className="aov-warning">
                <strong>Important:</strong> Average order value only looks at people who made a purchase. 
                If you use AOV as your primary metric, you might declare a winner that actually loses you money 
                (e.g. if conversion rate crashes while AOV rises).
              </div>
              {analysis.aov.map((r, i) => (
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
                  skewVerdict={analysis.armStats[i+1].aov.skew}
                  meaningOverride={
                    (corrected ? r.pAdj : r.pRaw) < 1 - confidence
                      ? `The difference is large enough to be a real effect, not random fluctuation — among buyers, ${r.name} had a ${r.relUplift >= 0 ? "higher" : "lower"} average order value than Variant A.`
                      : "There's not enough evidence yet to be sure this is a real difference in average order value — it could still be random fluctuation."
                  }
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ───────────────────────── App shell ──────────────────────────── */

const ThemeToggle = ({ theme, toggle }) => (
  <button 
    type="button" 
    className="theme-toggle" 
    onClick={toggle}
    aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
  >
    {theme === 'light' ? (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ) : (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    )}
  </button>
);

export default function EclipseCalculator() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('eclipse-theme');
      if (saved) return saved;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('eclipse-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  const [mode, setMode] = useState("pre");
  const [preTab, setPreTab] = useState("cvr");
  const [postTab, setPostTab] = useState("cvr");
  const [confidence, setConfidence] = useState(0.95);
  const [tails, setTails] = useState("two");
  const [power, setPower] = useState(0.8);
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
          <div style={{marginLeft: 'auto'}}>
            <ThemeToggle theme={theme} toggle={toggleTheme} />
          </div>
        </div>
        <div className="intro">
          <h1 className="page-title">A/B Test Calculator</h1>
          <p className="intro-text">
            Plan sample sizes and test duration before you start, then analyse significance,
            revenue impact, and multiple variant corrections when your test is done.
          </p>
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
        <SegControl
          legend="Statistical power"
          name="power-global"
          value={power}
          onChange={setPower}
          explainerId="power"
          options={[
            { value: 0.7, label: "70%" },
            { value: 0.8, label: "80%" },
            { value: 0.9, label: "90%" },
          ]}
        />
      </section>

      {mode === "pre" && (
        <>
          <nav className="sub-tabs" aria-label="Metric">
            <button type="button" className={`subtab ${preTab === "cvr" ? "subtab-on" : ""}`}
              aria-pressed={preTab === "cvr"} onClick={() => setPreTab("cvr")}>
              Conversion rate
            </button>
            <button type="button" className={`subtab ${preTab === "revenue" ? "subtab-on" : ""}`}
              aria-pressed={preTab === "revenue"} onClick={() => setPreTab("revenue")}>
              Revenue per visitor
            </button>
          </nav>
          {preTab === "cvr" 
            ? <PreTest key="pre-cvr" confidence={confidence} twoTailed={twoTailed} power={power} setPower={setPower} />
            : <PreTestRevenue key="pre-rev" confidence={confidence} twoTailed={twoTailed} power={power} setPower={setPower} />
          }
        </>
      )}

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

      <FaqSection />
    </div>
  );
}

/* ───────────────────────── Styles ─────────────────────────────── */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');

:root {
  --paper:#F7F6FA; --card:#FFFFFF; --ink:#1C1328; --muted:#6B6478;
  --line:#E9E6F0;
  --pink:#DC004A; --pink-deep:#B0003B; --pink-soft:#FCE6EE;
  --grey-disabled:#E0E0E0; --text-disabled:#9E9E9E;
  --purple:#4A3787; --purple-deep:#382A68; --purple-soft:#F0EEFA;
  --purple-bright:#6441C3; --avatar:#CBCAFF;
  --purple-active:#4A3787;
  --navy:#1C1328; --amber:#F1C40F;
  --grad:var(--purple-active);
  --win:#157347; --win-bg:#E7F6EE; --lose:#B3261E; --lose-bg:#FCEDEB;
  --ns:#6B6478; --ns-bg:#F0EEF4; --warn-bg:#FEF7E0; --warn-edge:#B8920A;
  --shadow:0 1px 2px rgba(26,18,41,.05), 0 10px 30px -12px rgba(26,18,41,.13);
  --radius:15px;
  --chart-grid:#E9E6F0;
  --chart-tick:#6B6478;
  --chart-line:#5B2A86;
  --chart-dot:#DC004A;
  --chart-dot-stroke:#FFFFFF;
  --chart-control:#9A93A8;
  --chart-tooltip-bg:#FFFFFF;
  --chart-tooltip-border:#E9E6F0;
  --chart-tooltip-text:#1C1328;
}
[data-theme='dark'] {
  --paper:#09090B; --card:#18181B; --ink:#FAFAFA; --muted:#D4D4D8;
  --line:#3F3F46;
  --pink:#FF1A6A; --pink-deep:#FDA4AF; --pink-soft:#4C0519;
  --grey-disabled:#27272A; --text-disabled:#A1A1AA;
  --purple:#A5B4FC; --purple-deep:#E0E7FF; --purple-soft:#312E81;
  --purple-bright:#818CF8; --avatar:#4338CA;
  --purple-active:#4338CA;
  --navy:#FAFAFA; --amber:#FBBF24;
  --win:#34D399; --win-bg:#064E3B; --lose:#F87171; --lose-bg:#450A0A;
  --ns:#D4D4D8; --ns-bg:#27272A; --warn-bg:#422006; --warn-edge:#FBBF24;
  --shadow:0 1px 3px rgba(0,0,0,.5), 0 20px 40px -12px rgba(0,0,0,.7);
  --chart-grid:#3F3F46;
  --chart-tick:#E4E4E7;
  --chart-line:#C4B5FD;
  --chart-dot:#FDA4AF;
  --chart-dot-stroke:#18181B;
  --chart-control:#D4D4D8;
  --chart-tooltip-bg:#27272A;
  --chart-tooltip-border:#52525B;
  --chart-tooltip-text:#FAFAFA;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --paper:#0F0D15; --card:#16121E; --ink:#FAFAFA; --muted:#D4D4D8;
    --line:#3F3F46;
    --pink:#FF1A6A; --pink-deep:#FDA4AF; --pink-soft:#4C0519;
    --grey-disabled:#2D2638; --text-disabled:#A1A1AA;
    --purple:#A5B4FC; --purple-deep:#E0E7FF; --purple-soft:#312E81;
    --purple-bright:#818CF8; --avatar:#4338CA;
    --purple-active:#4338CA;
    --navy:#FAFAFA; --amber:#F1C40F;
    --win:#34D399; --win-bg:#122B1E; --lose:#F87171; --lose-bg:#3D1414;
    --ns:#D4D4D8; --ns-bg:#27272A; --warn-bg:#2D2605; --warn-edge:#F1C40F;
    --shadow:0 1px 2px rgba(0,0,0,.3), 0 10px 30px -12px rgba(0,0,0,.5);
    --chart-grid:#3F3F46;
    --chart-tick:#E4E4E7;
    --chart-line:#C4B5FD;
    --chart-dot:#FDA4AF;
    --chart-dot-stroke:#16121E;
    --chart-control:#D4D4D8;
    --chart-tooltip-bg:#27272A;
    --chart-tooltip-border:#52525B;
    --chart-tooltip-text:#FAFAFA;
  }
}
.app{font-family:'Inter',ui-sans-serif,system-ui,sans-serif;background:var(--paper);color:var(--ink);
  min-height:100vh;padding:0 16px 56px;font-size:15.5px;line-height:1.55;letter-spacing:-0.025em;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  font-feature-settings:'cv11' 1;overflow-x:hidden;}
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
.brand-word{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:700;font-size:30px;color:var(--pink);
  letter-spacing:-0.03em;line-height:1.2;}
.tagline{color:var(--muted);font-size:15px;padding-top:6px;}
.intro{max-width:1080px;margin:20px auto 0;text-align:left;}
.page-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:700;font-size:28px;
  line-height:1.2;letter-spacing:-0.03em;color:var(--navy);margin:0 0 10px;}
.intro-text{color:var(--muted);font-size:16px;line-height:1.55;margin:0;max-width:65ch;}
.theme-toggle{background:var(--card);border:1.5px solid var(--line);border-radius:10px;
  width:40px;height:40px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;color:var(--purple);transition:all .15s;box-shadow:var(--shadow);}
.theme-toggle:hover{border-color:var(--purple);background:var(--purple-soft);}

/* tabs */
.mode-tabs{max-width:1080px;margin:26px auto 0;display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1.15fr);gap:18px;}
.tab{text-align:left;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);padding:16px 20px;cursor:pointer;box-shadow:var(--shadow);
  font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:600;font-size:17px;color:var(--ink);line-height:1.2;}
@media (max-width:880px){
  .mode-tabs{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px;}
  .tab{flex:1;min-width:0;width:100%;padding:12px 16px;}
}
.tab-sub{display:block;font-family:'Inter',sans-serif;font-weight:400;
  font-size:13px;color:var(--muted);margin-top:3px;}
.tab-on{border-color:transparent;background:var(--grad);color:#fff;}
.tab-on .tab-sub{color:rgba(255,255,255,.85);}
.sub-tabs{max-width:1080px;margin:18px auto 0;display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1.15fr);gap:18px;}
.subtab{background:var(--card);border:1px solid var(--line);border-radius:999px;
  padding:9px 16px;font-size:13.5px;font-weight:600;color:var(--ink);cursor:pointer;
  font-family:'Inter',sans-serif;box-shadow:var(--shadow);white-space:nowrap;text-align:center;}
@media (max-width:880px){
  .sub-tabs{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px;}
  .sub-tabs::-webkit-scrollbar{display:none;}
  .subtab{flex:1;padding:8px 12px;font-size:12.5px;}
}
.subtab-on{border-color:var(--pink);background:var(--pink-soft);color:var(--pink-deep);}
[data-theme='dark'] .subtab-on,[data-theme='dark'] .subtab-on:focus-visible{
  border-color:var(--pink-deep);background:var(--pink-soft);color:var(--pink-deep);}
.subtab-on:focus-visible{outline-color:var(--pink);}

/* settings */
.settings{max-width:1080px;margin:16px auto 0;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 20px;display:flex;gap:36px;
  flex-wrap:wrap;align-items:flex-start;justify-content:flex-start;}
.seg{border:0;padding:0;margin:0;display:flex;flex-direction:column;align-items:flex-start;}
.seg-legend{font-weight:600;font-size:13.5px;margin-bottom:7px;padding:0;text-align:left;}
.seg-row{display:inline-flex;background:var(--paper);border:1px solid var(--line);
  border-radius:999px;padding:3px;flex-wrap:wrap;}
.seg-opt{padding:6px 16px;font-size:14px;cursor:pointer;color:var(--muted);
  border-radius:999px;display:flex;align-items:center;font-weight:600;position:relative;}
.seg-opt input{position:absolute;opacity:0;pointer-events:none;}
.seg-opt:has(:focus-visible){outline:3px solid var(--pink);outline-offset:1px;}
.seg-on{background:var(--purple-active);color:#fff;}

/* layout */
.two-col{max-width:1080px;margin:18px auto 0;display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1.15fr);gap:18px;align-items:start;}
.two-col > *{min-width:0;max-width:100%;}
.two-col .results{position:sticky;top:16px;min-width:0;}
@media (max-width:880px){
  .two-col{display:block;width:100%;}
  .two-col > *{margin-bottom:18px;}
  .two-col .results{position:static;max-height:none;overflow-y:visible;}
}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:var(--shadow);padding:22px 24px;min-width:0;max-width:100%;}
@media (max-width:600px){
  .panel{padding:16px 12px;border-radius:0;border-inline:0;}
}
.panel-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:600;font-size:20px;margin:0 0 14px;color:var(--navy);letter-spacing:-0.025em;line-height:1.2;}
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
  border-radius:12px;padding:14px 16px;min-width:0;}
.detail-table-wrap{overflow-x:auto;margin:0 -16px;padding:0 16px;scrollbar-width:thin;}
.detail-table{width:100%;border-collapse:collapse;font-size:12px;
  font-variant-numeric:tabular-nums;}
@media (max-width:600px){
  .detail-table thead { display: none; }
  .detail-table tbody tr { display: block; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 12px; padding: 8px; background: var(--card); }
  .detail-table tbody th, .detail-table tbody td { display: flex; justify-content: space-between; border: 0; padding: 6px 4px; text-align: right; }
  .detail-table tbody th { text-align: left; border-bottom: 1px solid var(--line); margin-bottom: 4px; padding-bottom: 8px; }
  .detail-table tbody td::before { content: attr(data-label); font-weight: 600; color: var(--muted); text-align: left; padding-right: 10px; }
}
@media (max-width:600px){
  .panel{padding:16px 12px;}
  .detail-card{padding:12px 8px;}
  .detail-table{font-size:11px;min-width:280px;}
}
.detail-table th,.detail-table td{border:1px solid var(--line);padding:6px 8px;text-align:right;
  white-space:nowrap;}
.detail-table thead th{background:var(--card);font-weight:600;color:var(--muted);text-align:right;}
.detail-table tbody th{text-align:left;font-weight:600;color:var(--navy);}
.detail-formula{font-size:11.5px;color:var(--muted);margin:10px 0 0;line-height:1.6;}
.btn-text{background:none;border:0;padding:0;color:var(--purple);font-size:13.5px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;margin:4px 0 12px;}
.btn-text:hover{text-decoration:underline;}
.sd-calc-section{margin-bottom:20px;}
.sd-calc-box{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:8px;}
.sd-result .stat{padding:10px;background:var(--card);}
.sd-result .stat-num{font-size:18px;}

.btn-calc{width:100%;background:var(--pink);color:#fff;border:0;border-radius:11px;
  padding:13px 20px;font-size:15.5px;font-weight:700;cursor:pointer;margin-top:18px;
  font-family:'Inter',sans-serif;letter-spacing:.01em;}
.btn-calc:hover{background:var(--pink-deep);}
.btn-calc:disabled{background:var(--grey-disabled);color:var(--text-disabled);cursor:not-allowed;}
.test-chip-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;}
.test-pill{font-size:12px;font-weight:600;color:var(--purple-deep);background:var(--purple-soft);
  border:1px solid var(--line);border-radius:999px;padding:4px 12px;white-space:nowrap;}
[data-theme='dark'] .test-pill{border-color:var(--purple-active);}
.test-chip{font-size:12.5px;font-weight:600;color:var(--purple-deep);background:var(--purple-soft);
  border:1px solid var(--line);border-radius:999px;padding:5px 14px;white-space:nowrap;}
.sub-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:600;font-size:16px;line-height:1.5;
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
  background:var(--paper);font-feature-settings:'tnum' 1;}
.input:focus-visible{border-color:var(--purple);}
.input::placeholder{color:var(--muted);font-style:normal;}
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
  font-family:ui-monospace,Menlo,monospace;color:var(--ink);background:var(--paper);}

/* variants & allocation */
.arm-row{border-top:1px dashed var(--line);padding-top:14px;margin-top:14px;}
.arm-name{font-size:15px;font-weight:600;margin:0 0 10px;color:var(--navy);display:flex;align-items:center;gap:9px;
  font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;line-height:1.5;}
.arm-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
@media (max-width:560px){.arm-grid{grid-template-columns:1fr;gap:8px;}}
.cvr-readout{display:block;padding:10px 0;font-size:15.5px;font-weight:600;}
.alloc-grid{display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:12px;}
.alloc-cell{min-width:0;}
.alloc-cell .field-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.alloc-cell .input{width:100%;max-width:none;}

/* explainers */
.explainer{position:relative;display:inline-flex;align-items:center;line-height:1;}
.explainer-inline{margin:0 0 0 4px;}
.explainer-toggle{background:none;border:0;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:inherit;font-weight:inherit;color:inherit;text-align:left;}
.explainer-label-text{text-decoration:underline dotted var(--muted);text-underline-offset:3px;}
.exp-ring{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;
  background:var(--purple-soft);border:1px solid var(--line);border-radius:50%;font-size:10px;
  flex:none;color:var(--purple);font-weight:700;line-height:1;margin-top:-1px;}
.explainer-body{position:absolute;top:100%;right:0;z-index:100;margin-top:8px;background:var(--card);
  border:1px solid var(--line);padding:14px 16px;font-size:13.5px;border-radius:12px;
  box-shadow:var(--shadow);width:260px;color:var(--ink);text-align:left;
  max-width:calc(100vw - 40px);}
@media (max-width:480px){.explainer-body{width:220px;}}
.exp-title{font-weight:700;margin-bottom:6px;color:var(--navy);font-size:14px;}
.exp-lead{margin:0 0 8px;line-height:1.4;}
.exp-bullets{margin:0 0 8px;padding-left:18px;display:flex;flex-direction:column;gap:5px;line-height:1.4;}
.exp-bullets li{padding-left:2px;}
.exp-foot{margin:8px 0 0;font-size:12.5px;color:var(--muted);border-top:1px solid var(--line);padding-top:8px;}

/* fields */
.field{margin:0 0 20px;}
.field-label-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-weight:600;font-size:13.5px;color:var(--ink);}
.field-label{display:block;font-weight:600;font-size:13.5px;margin:0;}
.field-hint{color:var(--muted);font-size:13.5px;margin:-2px 0 8px;max-width:58ch;text-align:left;}

/* results */
.stat-row{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0 10px;}
.stat{flex:1;background:var(--paper);border:1px solid var(--line);
  border-radius:12px;padding:14px 16px;min-width:0;word-break:break-word;}
@media (max-width:600px){
  .stat-row{display:grid;grid-template-columns:1fr;gap:10px;}
  .stat{min-width:0;width:100%;padding:12px 10px;}
}
.stat-hero{background:var(--grad);border-color:transparent;color:#fff;}
.stat-hero .stat-label{color:rgba(255,255,255,.85);}
.stat-label{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);margin-bottom:5px;}
.stat-num{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:24px;font-weight:600;line-height:1.2;}
.stat-sub-label{font-size:14px;opacity:0.9;margin-top:2px;}
@media (max-width:600px){.stat-num{font-size:20px;}}

.sub-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:24px 0 6px;flex-wrap:wrap;}
.sub-title-row .sub-title{margin:0;}
.view-toggle{display:inline-flex;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:2px;}
.view-btn{background:none;border:0;padding:4px 10px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;border-radius:6px;}
.view-btn-on{background:var(--card);color:var(--purple-deep);box-shadow:var(--shadow);}
[data-theme='dark'] .view-btn-on{color:var(--ink);}

.v2-details-toggle-wrap{margin-top:16px;border-top:1px solid var(--line);padding-top:12px;}
.note{background:var(--warn-bg);border-left:3px solid var(--warn-edge);padding:11px 13px;
  border-radius:0 10px 10px 0;font-size:14px;margin:12px 0;color:var(--ink);}
.chart-wrap{margin:6px 0 4px;min-width:0;width:100%;overflow:hidden;}
.chart-caption{font-size:13px;color:var(--muted);margin:8px 0 0;line-height:1.45;}
.faq-section{max-width:1080px;margin:40px auto 0;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow);padding:28px 24px;text-align:left;}
.faq-heading{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:700;font-size:22px;
  margin:0 0 20px;color:var(--navy);letter-spacing:-0.02em;}
.faq-list{display:flex;flex-direction:column;gap:20px;}
.faq-item{border-top:1px solid var(--line);padding-top:18px;}
.faq-item:first-child{border-top:0;padding-top:0;}
.faq-q{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:16px;font-weight:600;
  margin:0 0 8px;color:var(--ink);line-height:1.35;}
.faq-a{margin:0;color:var(--muted);font-size:15px;line-height:1.55;max-width:70ch;}
@media (max-width:600px){
  .faq-section{padding:20px 16px;border-radius:0;border-inline:0;}
  .page-title{font-size:24px;}
}
.mini-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:10px;}
.mini-table th,.mini-table td{border:1px solid var(--line);padding:5px 7px;text-align:center;}
.mini-table th{background:var(--paper);font-weight:600;}

@media (max-width:600px){
  .vertical-on-mobile thead { display: none; }
  .vertical-on-mobile tbody tr { display: flex; flex-direction: column; border-bottom: 1px solid var(--line); margin-bottom: 10px; }
  .vertical-on-mobile tbody th, .vertical-on-mobile tbody td { display: flex; justify-content: space-between; border: 0; padding: 8px 0; }
  .vertical-on-mobile tbody td::before { content: attr(data-label); font-weight: 600; color: var(--muted); }
}

.skew-banner{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-radius:10px;font-size:13px;margin-bottom:16px;line-height:1.4;}
.skew-high{background:var(--lose-bg);color:var(--lose);border:1px solid var(--lose);}
.skew-medium{background:var(--warn-bg);color:var(--warn-edge);border:1px solid var(--warn-edge);}
.skew-icon{font-weight:700;font-size:16px;flex:none;}
.skew-text{flex:1;}

.result-card-v2{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px;margin:16px 0;box-shadow:var(--shadow);position:relative;}
@media (max-width:600px){
  .result-card-v2{padding:16px;}
}
.v2-winner{border-left:5px solid var(--win);}
.v2-loser{border-left:5px solid var(--lose);}
.v2-ns{border-left:5px solid var(--ns);}

.v2-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px;flex-wrap:wrap;}
.v2-verdict-wrap{display:flex;flex-direction:column;gap:8px;}
.v2-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:14px;font-weight:600;color:var(--muted);margin:0;text-transform:uppercase;letter-spacing:0.05em;}
.v2-conf-pill{background:var(--paper);padding:8px 16px;border-radius:12px;display:flex;flex-direction:column;align-items:center;border:1px solid var(--line);}
.v2-conf-val{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:20px;font-weight:700;color:var(--ink);line-height:1;}
.v2-conf-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-top:4px;}

.v2-meaning{font-size:15px;line-height:1.5;color:var(--ink);margin:0 0 24px;max-width:65ch;}

.v2-metrics{display:flex;gap:24px;align-items:center;background:var(--paper);padding:20px;border-radius:16px;margin-bottom:20px;flex-wrap:wrap;}
@media (max-width:600px){.v2-metrics{padding:16px;gap:16px;flex-direction:column;align-items:stretch;}}
.v2-metric-main{flex:1;}
@media (max-width:600px){.v2-metric-main{min-width:0;width:100%;text-align:left;}}
.v2-m-label{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;}
.v2-m-val{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:32px;font-weight:700;line-height:1;}
@media (max-width:600px){.v2-m-val{font-size:28px;}}
.v2-metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1;border-left:1px solid var(--line);padding-left:24px;}
@media (max-width:600px){.v2-metric-grid{border-left:0;padding-left:0;padding-top:16px;border-top:1px solid var(--line);min-width:0;width:100%;grid-template-columns:1fr;gap:12px;text-align:left;}}
.v2-m-item{display:flex;flex-direction:column;gap:4px;}
.v2-m-i-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;}
.v2-m-i-val{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:18px;font-weight:600;color:var(--ink);}
@media (max-width:600px){.v2-m-i-val{font-size:16px;}}

.v2-details{border-top:1px solid var(--line);padding-top:16px;}
.v2-d-row{display:flex;gap:24px;flex-wrap:wrap;}
@media (max-width:600px){.v2-d-row{gap:16px 12px;}}
.v2-d-col{display:flex;flex-direction:column;gap:2px;}
.v2-d-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;}
.v2-d-val{font-size:14px;font-weight:700;color:var(--ink);white-space:nowrap;}
@media (max-width:600px){.v2-d-val{white-space:normal;word-break:break-word;}}
.span-full{flex-basis:100%;}

.text-win{color:var(--win);}
.text-lose{color:var(--lose);}

.v2-footer{margin-top:16px;}

.result-card{border:1px solid var(--line);border-radius:14px;padding:16px 18px;
  margin:12px 0;background:var(--card);box-shadow:var(--shadow);}
.result-head{display:flex;justify-content:space-between;align-items:center;gap:10px;
  flex-wrap:wrap;margin-bottom:12px;}
.result-name{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:15.5px;font-weight:600;margin:0;}
.result-grid{display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:12px 16px;margin:0;}
@media (max-width:600px){.result-grid{grid-template-columns:1fr;gap:12px;}}
.result-grid dt{font-size:11.5px;font-weight:600;color:var(--muted);text-transform:uppercase;
  letter-spacing:.05em;line-height:1.2;margin-bottom:2px;}
.result-grid dd{margin:0;font-size:16px;font-weight:600;white-space:nowrap;}
@media (max-width:600px){.result-grid dd{white-space:normal;word-break:break-word;}}
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
.block-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:600;font-size:15px;margin:20px 0 4px;color:var(--ink);line-height:1.5;}
.traffic-block-v2{display:flex;flex-direction:column;gap:16px;margin-bottom:12px;}
.traffic-arm{background:var(--paper);padding:12px 16px;border-radius:12px;border:1px solid var(--line);}
.traffic-arm-name{font-weight:600;font-size:14px;color:var(--navy);margin-bottom:10px;font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;}
.traffic-arm-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media (max-width:480px){.traffic-arm-fields{grid-template-columns:1fr;gap:8px;}}
.traffic-block{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:6px;}
.arm-orders{font-family:'Inter',sans-serif;font-weight:400;font-size:12.5px;color:var(--muted);margin-left:auto;}
.avatar-dot{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--avatar);color:var(--purple-deep);font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:700;font-size:13px;flex:none;}
.select{max-width:130px;cursor:pointer;}
@media (max-width:600px){.select{max-width:100%;font-size:16px;}}
.derived-line{font-size:13px;color:var(--muted);margin-top:6px;}
.derived-line strong{color:var(--purple-deep);}
.rev-top-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;}
.aov-warning{background:var(--warn-bg);border-left:3px solid var(--warn-edge);padding:12px 16px;
  border-radius:0 10px 10px 0;font-size:13.5px;margin:10px 0 16px;color:var(--ink);line-height:1.5;}
.aov-warning strong{color:var(--warn-edge);}
.mismatch-warn{background:#FFF6E8;border-left:3px solid #C97B12;border-radius:0 10px 10px 0;
  padding:10px 13px;font-size:13.5px;margin:8px 0;}

/* upload zone */
.upload-zone{margin:10px 0 6px;}
.upload-label{display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:5px;border:2px dashed var(--line);border-radius:12px;padding:18px 16px;cursor:pointer;
  text-align:center;background:var(--card);transition:border-color .15s,background .15s;}
.upload-label:hover,.upload-label:focus-within{border-color:var(--purple);background:var(--purple-soft);}
.upload-label-filled{border-style:solid;border-color:var(--purple);background:var(--purple-soft);}
.upload-icon{font-size:22px;line-height:1;}
.upload-cta{font-weight:700;font-size:14.5px;color:var(--purple-deep);word-break:break-all;}
.upload-sub{font-size:12.5px;color:var(--muted);}
.upload-fmt{font-size:12.5px;color:var(--muted);margin-top:6px;padding:0 2px;line-height:1.5;}

@media (prefers-reduced-motion:no-preference){
  .tab,.subtab,.btn,.btn-step,.seg-opt{transition:background .15s,border-color .15s,color .15s,box-shadow .15s;}
}

@media (max-width:600px){
  /* Force everything to respect viewport width */
  body, #root, .app { width: 100vw !important; overflow-x: hidden !important; }
  .panel, .result-card-v2, .detail-card { max-width: 100% !important; min-width: 0 !important; width: auto !important; }
  
  /* Fix tables that push width */
  .detail-table-wrap, .mini-table-wrap { width: 100% !important; overflow-x: auto !important; margin: 0 !important; }
  .detail-table, .mini-table { min-width: 0 !important; width: 100% !important; }
  
  /* Fix charts */
  .chart-wrap { width: 100% !important; max-width: 100% !important; overflow: hidden !important; }
}
`;

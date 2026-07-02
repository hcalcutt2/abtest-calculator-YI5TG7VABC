import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
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

// Regularised lower incomplete gamma P(a, x) - for chi-square CDF
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

// Regularised incomplete beta I_x(a,b) - for Student-t CDF
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
function targetPropRate(p1, mdeRel, decrease = false) {
  return decrease ? p1 * (1 - mdeRel) : p1 * (1 + mdeRel);
}

function requiredNPerArm(p1, mdeRel, alphaAdj, power, twoSided, decrease = false) {
  const p2 = targetPropRate(p1, mdeRel, decrease);
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
function detectableMde(p1, nAvail, alphaAdj, power, twoSided, decrease = false) {
  if (nAvail < 2) return null;
  let lo = 0.0005, hi = 10;
  if (requiredNPerArm(p1, hi, alphaAdj, power, twoSided, decrease) > nAvail) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (requiredNPerArm(p1, mid, alphaAdj, power, twoSided, decrease) > nAvail) lo = mid;
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

const fmtInt = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString("en-GB") : "-";
const fmtPct = (x, dp = 2) => Number.isFinite(x) ? `${(x * 100).toFixed(dp)}%` : "-";
const fmtSignedPct = (x, dp = 2) =>
  Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(dp)}%` : "-";
const fmtP = (p) => !Number.isFinite(p) ? "-" : p < 0.0001 ? "< 0.0001" : p.toFixed(4);
const fmtMoney = (x, dp = 2) =>
  Number.isFinite(x) ? x.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "-";

/* ─────────────────────── Export helpers ───────────────────────── */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

function uploadSizeError(file) {
  if (file.size <= MAX_UPLOAD_BYTES) return null;
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  return `File is too large (${mb} MB). Maximum size is 10 MB.`;
}

const DUPLICATE_FILENAME_ERR =
  "This filename is already uploaded for another variant. Upload a separate file per variant.";

function applyDuplicateFilenameErrors(parsed, k) {
  const next = parsed.map(entry => {
    if (!entry) return entry;
    const errors = (entry.errors || []).filter(e => e !== DUPLICATE_FILENAME_ERR);
    return { ...entry, errors };
  });

  const nameCounts = {};
  for (let i = 0; i < k; i++) {
    const name = next[i]?.name?.trim().toLowerCase();
    if (name) nameCounts[name] = (nameCounts[name] || 0) + 1;
  }

  for (let i = 0; i < k; i++) {
    if (!next[i]?.name) continue;
    const key = next[i].name.trim().toLowerCase();
    if (nameCounts[key] > 1) {
      next[i] = { ...next[i], errors: [...(next[i].errors || []), DUPLICATE_FILENAME_ERR] };
    }
  }

  return next;
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeCsvCell(raw) {
  const s = raw == null ? "" : String(raw);
  // Prevent CSV/formula injection when opened in Excel, LibreOffice, etc.
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

function toCsv(rows) {
  // rows: array of arrays. Escape quotes/commas; neutralise formula injection.
  return rows.map(r => r.map(cell => {
    const s = sanitizeCsvCell(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");
}

const stamp = () => new Date().toISOString().slice(0, 10);

// Load jsPDF once on demand (bundled, no CDN)
let _jspdfPromise = null;
function loadJsPdf() {
  if (!_jspdfPromise) {
    _jspdfPromise = import('jspdf').then(({ jsPDF }) => jsPDF);
  }
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
    const pink = getComputedStyle(document.documentElement).getPropertyValue('--pink').trim() || '#DC004A';
    
    // Use stylized text for PDF logo
    const brandColor = [220, 0, 74]; // Default pink
    doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(...brandColor);
    doc.text("eclipse", M, y + 16); nl(32);
  } catch (e) {
    // Fallback if something goes wrong
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(220, 0, 74);
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
    lead: "Power is your protection against missing a winner - the chance your test spots a real improvement instead of coming back flat. 80% is the default as it is the standard business trade-off between speed and sensitivity.",
    bullets: [
      "70% power: a 3-in-10 chance a genuine winner looks like nothing. Fastest, but riskiest.",
      "80% power: a 1-in-5 chance of missing a real winner. The standard choice.",
      "90% power: only a 1-in-10 chance of missing it, but needs more visitors and a longer test.",
    ],
    foot: "Higher power means you're less likely to scrap a change that was actually working - at the cost of more traffic.",
  },
  mde: {
    label: "What is the minimum detectable effect?",
    body: "The smallest uplift worth detecting, expressed as a percentage of your current rate (a relative uplift). Example: a 10% MDE on a 2.00% baseline conversion rate means designing the test to detect a move from 2.00% to 2.20%. Smaller MDEs need much more traffic.",
  },
  srm: {
    label: "What is a sample ratio mismatch?",
    body: "When traffic doesn't split the way the experiment was set up to split it - for example, you planned 50/50 but on very large numbers got a split too lopsided to be random. It's usually caused by a setup problem: redirect bugs, bot filtering that treats variants differently, or lost tracking. When it happens, the groups may not be comparable, so results are unreliable. This check uses a chi-square test against your planned split, so it works for any number of variants and for unequal splits.",
  },
  tailed: {
    label: "One-tailed vs two-tailed - which should I use?",
    body: "A two-tailed test asks 'is the variant different - better or worse?'. A one-tailed test asks only 'is the variant better?'. Use one-tailed only when a decrease would be acted on exactly the same way as no change at all. If a drop would worry you, that's a two-tailed question. The default here is two-tailed.",
  },
  holm: {
    label: "Why do extra variants need a correction?",
    body: "Every variant compared against control is another opportunity for a fluke result. With 3 variants that's 3 comparisons, so the chance of at least one false alarm rises well above your chosen level. The Holm–Bonferroni correction raises the bar for each comparison so the overall false-alarm rate stays where you set it. It's applied automatically here whenever you test more than one variant.",
  },
  ztest: {
    label: "What is a z-test?",
    body: "The test used for comparing proportions - counts out of totals, like conversion rate. Example: 190 conversions from 10,000 visitors vs 230 from 10,000. It asks whether a gap between two rates is bigger than randomness alone would explain.",
  },
  ttest: {
    label: "What is a t-test?",
    body: "The test used for comparing averages of continuous values, like revenue per visitor (£1.84 vs £2.01). This calculator uses Welch's version, which allows the two groups to vary by different amounts - the safer choice for revenue data.",
  },
  metrics: {
    label: "CVR, RPV and AOV - definitions",
    body: "CVR (conversion rate) = conversions ÷ visitors. RPV (revenue per visitor) = total revenue ÷ all visitors, including those who bought nothing. AOV (average order value) = total revenue ÷ orders, so it only looks at buyers.",
  },
  confpct: {
    label: "What does the confidence % mean?",
    body: "It's how close the result is to being statistically significant - calculated as 100% minus the p-value. A result at 95% confidence has cleared the usual significance bar. Important: this is NOT the chance the variant will win. A variant at 70% confidence hasn't 'won 70% of the time' - it just hasn't yet gathered enough evidence to be called significant. Use it as a progress reading, not a probability of success.",
  },
  upliftci: {
    label: "Relative uplift confidence interval",
    body: "The range of plausible values for the true relative uplift (variant vs control). If the interval excludes 0%, the uplift is statistically significant at your chosen confidence level. Calculated via the log-ratio method.",
  },
  aovrpv: {
    label: "Why can AOV and RPV disagree?",
    body: "AOV only counts people who ordered. A variant that persuades extra people to make small orders pushes conversion and revenue per visitor up while pulling average order value down. RPV reflects the full effect on every visitor, which is why it's usually the primary revenue metric.",
  },
  mdeabs: {
    label: "Relative vs absolute - what's the difference?",
    body: "Relative uplift is expressed as a percentage of your baseline; absolute uplift is the change in percentage points. Example: a 10% relative uplift on a 2.00% baseline is the same as a 0.20 percentage-point absolute change (2.00% → 2.20%). This calculator uses relative as the input because it's how most teams describe a target ('a 10% lift'); the absolute equivalent is shown so you can sense-check it.",
  },
  noninf: {
    label: "What is a non-inferiority test?",
    body: "Most tests ask 'is the variant better?'. A non-inferiority test asks the opposite: 'can I be confident the variant is NOT meaningfully worse?'. You'd use it when you want to ship a change for some other reason - simpler code, lower cost, a nicer design - and just need to confirm it doesn't hurt conversion by more than an amount you can live with. You set that amount as the margin. Example: a 1% margin means you'll accept the variant as long as you're confident it isn't more than 1% (relative) below control.",
  },
  winsorize: {
    label: "What is capping outliers?",
    body: "Revenue data often contains 'whales' - a few customers who spend 10x or 100x more than the average. These outliers can skew your results and make a variant look like a winner just because one person made a huge order. Capping (Winsorizing) replaces these extreme values with a lower threshold (e.g. the 99th percentile), making your statistical test more robust and reliable.",
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
    q: "What is an A/B test?",
    a: "An A/B test splits traffic between a control (what you have now) and one or more variants (a change you want to try). By measuring conversion rate, revenue per visitor or other metrics on each group, you can see whether a change made a real difference or the gap was just random noise.",
  },
  {
    q: "How do I know if my A/B test result is statistically significant?",
    a: "A result is statistically significant when the difference between variants is unlikely to have happened by chance alone. Enter your visitor and conversion counts - or upload revenue data - and the calculator runs the appropriate statistical test. It then tells you in plain English whether the result clears your chosen confidence level (90%, 95% or 99%) and shows the p-value and confidence interval behind that call.",
  },
  {
    q: "What is a p-value in A/B testing?",
    a: "The p-value answers: if there were truly no difference between control and variant, how often would you see a gap at least this large just from randomness? A smaller p-value means the result is harder to dismiss as luck. If the p-value is below your significance threshold (for example 0.05 at 95% confidence), the result is called statistically significant.",
  },
  {
    q: "How many visitors do I need for an A/B test?",
    a: "Sample size depends on your baseline conversion rate, the smallest uplift you care about (minimum detectable effect), your chosen confidence level, statistical power, and how many variants you are testing. Use the planning tab: enter your baseline rate, target uplift and traffic, and the calculator returns visitors needed per variant plus an estimated duration in days and weeks.",
  },
  {
    q: "What is statistical power in A/B testing?",
    a: "Statistical power is the probability your test will detect a real improvement if one exists. At 80% power - the usual default - there is roughly a one-in-five chance of missing a genuine winner. Higher power (90%) needs more traffic but reduces that risk. Set power alongside confidence when planning a test so you are not under-powered before you start.",
  },
  {
    q: "What is the minimum detectable effect (MDE)?",
    a: "The minimum detectable effect is the smallest relative uplift you want the test to be able to spot - for example, a 10% lift on a 2.00% baseline means detecting a move from 2.00% to 2.20%. Smaller MDEs need much larger sample sizes. Pick an MDE based on the smallest change that would actually change your decision, not the smallest change you can imagine.",
  },
  {
    q: "Should I use a one-tailed or two-tailed test?",
    a: "A two-tailed test asks whether the variant is different - better or worse. A one-tailed test asks only whether it is better. Use one-tailed only when a decrease would be treated exactly the same as no change. If a drop would worry you, use two-tailed. Two-tailed is the default here and is the safer choice for most business decisions.",
  },
  {
    q: "Can I test more than two variants (A/B/C/n)?",
    a: "Yes. You can compare three or more variants against a control at once. Each variant gets its own comparison, and Holm–Bonferroni correction is applied automatically so your overall false-positive rate stays at the confidence level you set. You can also set unequal traffic splits between variants.",
  },
  {
    q: "Why do multiple variants need a correction?",
    a: "Every extra variant compared against control is another chance for a fluke result. With three variants that is three separate comparisons, so the chance of at least one false alarm rises above your chosen confidence level. Holm–Bonferroni correction adjusts the p-value for each comparison so the family-wise error rate stays controlled. It is applied automatically whenever you analyse more than one variant.",
  },
  {
    q: "Can I measure revenue, not just conversion rate?",
    a: "Yes. Paste or upload order-level revenue data and the calculator measures revenue per visitor (RPV) and average order value (AOV). Revenue is analysed with Welch's t-test, which handles unequal variance between groups - the standard approach for skewed revenue data. You can also cap outliers at the 90th, 95th or 99th percentile before analysis.",
  },
  {
    q: "What is the difference between conversion rate, RPV and AOV?",
    a: "Conversion rate (CVR) is conversions divided by visitors. Revenue per visitor (RPV) is total revenue divided by all visitors, including non-buyers - usually the primary revenue metric because it reflects the full funnel. Average order value (AOV) is total revenue divided by orders only, so it ignores visitors who did not order. A variant can raise RPV while lowering AOV if it brings in more small orders.",
  },
  {
    q: "What are confidence intervals in A/B test results?",
    a: "A confidence interval shows the range of plausible values for the true difference between variants. For conversion rate, you will see intervals for each variant's rate and for the uplift between them. If the interval for uplift excludes zero, the result is significant at that confidence level. Intervals make the size of the effect visible, not just whether it cleared the bar.",
  },
  {
    q: "How long should I run an A/B test?",
    a: "Run until you reach the sample size your plan requires - stopping early inflates false positives. Ideally include at least one to two full business weeks so weekday and weekend patterns are both represented. The planning calculator estimates duration from your traffic volume; the analysis tab can also check whether you ran long enough relative to your original plan.",
  },
  {
    q: "What is a non-inferiority test?",
    a: "A standard test asks whether a variant is better than control. A non-inferiority test asks whether you can be confident the variant is not meaningfully worse - useful when you want to ship a change for other reasons (simpler design, lower cost) and only need to confirm it does not hurt conversion beyond a margin you set. Enable it in the conversion-rate analysis tab and define your acceptable margin.",
  },
  {
    q: "What is a sample ratio mismatch (SRM)?",
    a: "A sample ratio mismatch happens when actual traffic splits do not match the planned allocation - for example, you intended 50/50 but received 48/52 on large volumes. It often points to a tracking or redirect bug and can mean the groups are not comparable. The calculator runs a chi-square check against your planned split and flags a mismatch when the gap is too large to be random.",
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
                  <td key={r.week} data-label={`Week ${r.week}`}>{r.mde != null ? `${r.mde}%` : "-"}</td>
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
  const [pos, setPos] = useState(null);
  const toggleRef = useRef(null);
  const bodyRef = useRef(null);
  const e = EXPLAINERS[id];

  useLayoutEffect(() => {
    if (!open || !e || !toggleRef.current || !bodyRef.current) {
      setPos(null);
      return;
    }
    const toggle = toggleRef.current.getBoundingClientRect();
    const body = bodyRef.current;
    const gap = 8;
    const pad = 12;
    const bw = body.offsetWidth;
    const bh = body.offsetHeight;

    let left = toggle.left;
    let top = toggle.bottom + gap;

    if (left + bw > window.innerWidth - pad) {
      left = toggle.right - bw;
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - bw - pad));

    if (top + bh > window.innerHeight - pad) {
      top = toggle.top - bh - gap;
    }
    top = Math.max(pad, top);

    setPos({ top, left });
  }, [open, id, e]);

  if (!e) return null;

  return (
    <div className={`explainer ${inline ? "explainer-inline" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={toggleRef}
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
        <div
          ref={bodyRef}
          id={`exp-${id}-${inline ? "i" : "b"}`}
          className="explainer-body"
          style={pos ? { top: pos.top, left: pos.left, visibility: "visible" } : { visibility: "hidden" }}
        >
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
    <div className="brand">
      <img src="./brand-icon.png" alt="Eclipse" className="brand-mark" />
      <span className="brand-word">eclipse</span>
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
          Allocation must add up to 100% - currently {sum.toFixed(1)}%.
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
        user behaviour - common causes are redirect bugs, bot filtering that treats variants
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

function PlanningDataSource({ value, onChange }) {
  return (
    <div className="choice-row">
      <button type="button" className={`choice-opt ${value === 'manual' ? 'choice-opt-on' : ''}`}
        onClick={() => onChange('manual')}>
        <span className="choice-title">Manual entry</span>
        <span className="choice-desc">Enter your baseline and target uplift manually.</span>
      </button>
      <button type="button" className={`choice-opt ${value === 'historical' ? 'choice-opt-on' : ''}`}
        onClick={() => onChange('historical')}>
        <div className="choice-title">
          Historical data
          <span className="badge-soon">Coming Soon</span>
        </div>
        <span className="choice-desc">Import data to auto-fill baseline and seasonal trends.</span>
      </button>
    </div>
  );
}

function MetricSelector({ currentTab, setTab, revMetric, setRevMetric, mode }) {
  const isPre = mode === 'pre';
  return (
    <div className="metric-selector-flow">
      <h3 className="flow-title">
        {isPre 
          ? "Which metric would you like to use to calculate sample size?" 
          : "Which metric are you analysing?"}
      </h3>
      <div className="choice-row" style={{ marginBottom: currentTab === 'revenue' ? '20px' : '0' }}>
        <button type="button" className={`choice-opt ${currentTab === 'cvr' ? 'choice-opt-on' : ''}`}
          onClick={() => setTab('cvr')}>
          <span className="choice-title">Conversion rate</span>
          <span className="choice-desc">e.g. clicks, signups, orders</span>
        </button>
        <button type="button" className={`choice-opt ${currentTab === 'revenue' ? 'choice-opt-on' : ''}`}
          onClick={() => setTab('revenue')}>
          <span className="choice-title">Revenue figure</span>
          <span className="choice-desc">e.g. RPV, AOV, total revenue</span>
        </button>
      </div>

      {currentTab === 'revenue' && (
        <div className="revenue-sub-options animated-fade-in">
          <Field label={isPre ? "Which specific revenue metric are you tracking?" : "Which specific revenue metric did you track?"} htmlFor="rev-metric-select">
            <select
              id="rev-metric-select"
              className="input select"
              value={revMetric}
              onChange={(e) => setRevMetric(e.target.value)}
            >
              <option value="rpv">Revenue per visitor (RPV)</option>
              <option value="aov">Average order value (AOV)</option>
              {isPre && (
                <>
                  <option value="margin">Margin</option>
                  <option value="total">Total revenue from test</option>
                  <option value="notsure">Not sure</option>
                </>
              )}
            </select>
            <div className="field-hint">
              {revMetric === 'rpv' && "Measures total revenue divided by all visitors. Best for overall business impact."}
              {revMetric === 'aov' && "Measures revenue per order. Note: This assumes you want to detect a change among buyers only."}
              {revMetric === 'margin' && "Measures profit margin per visitor instead of gross revenue."}
              {revMetric === 'total' && "Total revenue accumulated over the test period."}
              {revMetric === 'notsure' && "Revenue per Visitor (RPV) is usually the best primary metric for most A/B tests."}
            </div>
          </Field>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── PRE_TEST mode (§2) ───────────────────── */

function PreTest({ confidence, twoTailed, power, setPower, goal }) {
  const decrease = goal === "decrease";
  const [dataSource, setDataSource] = useState("manual");
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
    [baseline, mde, traffic, period, power, k, alloc, confidence, twoTailed, goal]);

  const errors = {};
  const p1 = Number(baseline) / 100;
  const mdeRel = Number(mde) / 100;
  const p2Target = baseline !== "" && mde !== "" && mdeRel > 0 ? targetPropRate(p1, mdeRel, decrease) : null;
  const trafficNum = Number(traffic);
  const perWeekFactor = period === "day" ? 7 : period === "month" ? 12 / 52 : 1;
  const wk = trafficNum * perWeekFactor; // visitors per week, internal
  const mdeAbs = p1 * mdeRel; // absolute (proportion) equivalent for display
  if (baseline !== "" && !(p1 > 0 && p1 < 1)) errors.baseline = "Enter a baseline rate between 0 and 100 (exclusive).";
  else if (calculated && baseline === "") errors.baseline = "Enter a baseline rate.";

  if (mde !== "" && !(mdeRel > 0)) errors.mde = decrease ? "Enter a relative drop greater than 0." : "Enter a relative uplift greater than 0.";
  else if (p2Target != null && p2Target <= 0) errors.mde = "Baseline minus this drop would reach 0%. Use a smaller minimum detectable effect.";
  else if (!decrease && p2Target != null && p2Target >= 1) errors.mde = "Baseline plus this uplift would exceed 100%. Lower one of them.";
  else if (calculated && mde === "") errors.mde = decrease ? "Enter a relative drop." : "Enter a relative uplift.";

  if (traffic !== "" && !(trafficNum > 0)) errors.traffic = "Enter a number of visitors greater than 0.";
  else if (calculated && traffic === "") errors.traffic = "Enter a number of visitors.";
  const allocSum = alloc.reduce((a, b) => a + (Number(b) || 0), 0);
  const allocOk = Math.abs(allocSum - 100) <= 0.5 && alloc.every((a) => Number(a) > 0);

  const alpha = 1 - confidence;
  const comparisons = k - 1;
  const alphaAdj = alpha / Math.max(1, comparisons);

  const inputsValid = Object.keys(errors).length === 0 && allocOk;
  let result = null;
  if (calculated && inputsValid) {
    const nPerArm = requiredNPerArm(p1, mdeRel, alphaAdj, power, twoTailed, decrease);
    const minAllocFrac = Math.min(...alloc.map((a) => Number(a) / 100));
    const days = Math.ceil(nPerArm / ((wk / 7) * minAllocFrac));
    const weeks = Math.ceil(days / 7);
    const chart = [];
    for (let w = 1; w <= 12; w++) {
      const nAvail = Math.floor(wk * minAllocFrac * w);
      const d = detectableMde(p1, nAvail, alphaAdj, power, twoTailed, decrease);
      chart.push({ week: w, mde: d != null ? +(d * 100).toFixed(2) : null });
    }
    result = { nPerArm, total: nPerArm * k, weeks, days, chart, p2Target };
  }

  return (
    <div className="two-col">
      <section className="panel" aria-labelledby="pre-h">
        <PlanningDataSource value={dataSource} onChange={setDataSource} />

        {dataSource === 'historical' && (
          <div className="coming-soon-placeholder animated-fade-in">
            <Field label={<span>Test month <span className="badge-soon">Coming Soon</span></span>} htmlFor="pre-month">
              <select id="pre-month" className="input select" disabled style={{opacity: 0.6}}>
                <option>Select month...</option>
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map(m => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <div className="field-hint">Used for seasonal adjustments when historical data is connected.</div>
            </Field>

            <Field label={<span>Upload historical data <span className="badge-soon">Coming Soon</span></span>}>
              <div className="upload-placeholder">
                <UploadIcon />
                <span>Drag and drop your historical CSV here</span>
              </div>
            </Field>
          </div>
        )}

        <VariantStepper k={k} setVariantCount={setVariantCount} idBase="pre-k" />
        {k >= 3 && (
          <p className="note">
            Testing {comparisons} variants against control - the sample sizes below already include
            <Explainer id="holm" inline label="the correction this needs" />, so the duration estimate is honest for a multi-variant test.
          </p>
        )}

        <Field label="Baseline rate (%)" htmlFor="pre-baseline" error={errors.baseline} explainerId="ztest"
          hint={decrease ? "Your current rate before the test, e.g. bounce rate." : "Your current conversion rate, before the test."}>
          <input id="pre-baseline" className="input" type="number" min="0" max="100" step="0.01" placeholder={decrease ? "e.g. 60" : "e.g. 2.0"}
            value={baseline} onChange={(e) => setBaseline(e.target.value)} />
        </Field>

        <Field
          label={decrease ? "Minimum detectable effect (relative drop, %)" : "Minimum detectable effect (relative uplift, %)"}
          htmlFor="pre-mde"
          hint={decrease ? "The smallest relative drop worth detecting, vs your baseline." : "The smallest uplift worth detecting, relative to your baseline."}
          error={errors.mde}
          explainerId="mde"
        >
          <input id="pre-mde" className="input" type="number" min="0" step="0.1" placeholder="e.g. 10"
            value={mde} onChange={(e) => setMde(e.target.value)} />
          {!errors.mde && !errors.baseline && mdeRel > 0 && p2Target != null && (
            <div className="derived-line">
              <Explainer id="mdeabs" inline label={<span>= <strong>{fmtPct(mdeAbs)}</strong> absolute ({fmtPct(p1)} → {fmtPct(p2Target)})</span>} />
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
            <div className="test-pill">{decrease ? "Decrease is a winner" : "Increase is a winner"}</div>
          </div>
        </div>
        {result && (
          <ExportButtons
            onCsv={() => {
              const rows = [
                ["Eclipse - Test planning", ""],
                ["Generated", new Date().toLocaleString("en-GB")],
                [],
                ["Inputs", ""],
                ["Baseline rate", `${baseline}%`],
                [`Minimum detectable effect (relative ${decrease ? "drop" : "uplift"})`, `${mde}%`],
                ["Absolute equivalent", `${fmtPct(mdeAbs)} (${fmtPct(p1)} -> ${fmtPct(result.p2Target)})`],
                ["Goal direction", decrease ? "Decrease is a winner" : "Increase is a winner"],
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
                `Baseline rate: ${baseline}%`,
                `Minimum detectable effect (relative ${decrease ? "drop" : "uplift"}): ${mde}%  (= ${fmtPct(mdeAbs)} absolute, ${fmtPct(p1)} to ${fmtPct(result.p2Target)})`,
                `Goal: ${decrease ? "Decrease is a winner" : "Increase is a winner"}`,
                `Visitors: ${traffic} ${period === "day" ? "per day" : period === "month" ? "per month" : "per week"}`,
                `Variants (incl. control): ${k}`,
                `Confidence: ${Math.round(confidence*100)}%   Power: ${Math.round(power*100)}%   ${twoTailed ? "Two-tailed" : "One-tailed"}`,
              ]},
              { heading: "Results", lines: [
                `Visitors required per variant: ${fmtInt(result.nPerArm)}`,
                `Total visitors required: ${fmtInt(result.total)}`,
                `Estimated duration: ${result.days} ${result.days === 1 ? "day" : "days"} (${result.weeks} ${result.weeks === 1 ? "week" : "weeks"})`,
              ]},
              { heading: `Detectable relative ${decrease ? "drop" : "uplift"} by duration`, lines:
                result.chart.map(c => `Week ${c.week}: ${c.mde != null ? c.mde + "%" : "-"}`) },
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
                (weekday vs weekend, pay cycles) - running at least 1–2 full weeks is recommended
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

/* Expandable "show the working" detail - z-test internals + distribution chart */
function PreTestRevenue({ confidence, twoTailed, power, setPower, revMetric }) {
  const [dataSource, setDataSource] = useState("manual");
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

  const metricLabel = useMemo(() => {
    switch (revMetric) {
      case 'aov': return "Average Order Value (AOV)";
      case 'margin': return "Margin";
      case 'total': return "Total Revenue";
      default: return "Revenue per Visitor (RPV)";
    }
  }, [revMetric]);

  const trafficLabel = useMemo(() => {
    if (revMetric === 'aov') return "Orders (all variants combined)";
    return "Visitors (all variants combined)";
  }, [revMetric]);

  const trafficHint = useMemo(() => {
    if (revMetric === 'aov') return "The number of orders you expect to see in the given period.";
    return "The number of visitors you expect to see in the given period.";
  }, [revMetric]);

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
  
  if (cv !== "" && !(cvNum > 0)) errors.cv = "Enter a coefficient of variation greater than 0.";
  else if (calculated && cv === "") errors.cv = "Enter a coefficient of variation.";

  if (mde !== "" && !(mdeRel > 0)) errors.mde = "Enter a relative uplift greater than 0.";
  else if (calculated && mde === "") errors.mde = "Enter a relative uplift.";

  if (traffic !== "" && !(trafficNum > 0)) errors.traffic = "Enter a number of visitors greater than 0.";
  else if (calculated && traffic === "") errors.traffic = "Enter a number of visitors.";
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
        <PlanningDataSource value={dataSource} onChange={setDataSource} />

        {dataSource === 'historical' && (
          <div className="coming-soon-placeholder animated-fade-in">
            <Field label={<span>Test month <span className="badge-soon">Coming Soon</span></span>} htmlFor="pre-rev-month">
              <select id="pre-rev-month" className="input select" disabled style={{opacity: 0.6}}>
                <option>Select month...</option>
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map(m => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <div className="field-hint">Used for seasonal adjustments when historical data is connected.</div>
            </Field>

            <Field label={<span>Upload historical revenue data <span className="badge-soon">Coming Soon</span></span>}>
              <div className="upload-placeholder">
                <UploadIcon />
                <span>Drag and drop your order-level CSV here</span>
              </div>
            </Field>
          </div>
        )}

        <VariantStepper k={k} setVariantCount={setVariantCount} idBase="pre-rev-k" />
        {k >= 3 && (
          <p className="note">
            Testing {comparisons} variants against control - the sample sizes below already include
            <Explainer id="holm" inline label="the correction this needs" />, so the duration estimate is honest for a multi-variant test.
          </p>
        )}

        <Field label={`Coefficient of Variation (CV) for ${metricLabel}`} htmlFor="pre-cv" error={errors.cv} explainerId="cv"
          hint={`Standard deviation divided by the mean for ${metricLabel}.`}>
          <input id="pre-cv" className="input" type="number" min="0" step="0.01" placeholder="e.g. 1.5"
            value={cv} onChange={(e) => setCv(e.target.value)} />
        </Field>

        <div className="sd-calc-section">
          <button type="button" className="btn-text" onClick={() => setSdCalcOpen(!sdCalcOpen)}>
            {sdCalcOpen ? "− Hide" : `+ Don't know your CV? Calculate it from historical ${metricLabel} data`}
          </button>
          {sdCalcOpen && (
            <div className="sd-calc-box">
              <p className="field-hint">
                Paste a list of individual {revMetric === 'aov' ? 'order values' : 'revenue per visitor values'} from a recent period. 
                This calculates the spread (CV) of your {metricLabel} data.
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
          label={`Minimum detectable effect (relative uplift in ${metricLabel}, %)`}
          htmlFor="pre-rev-mde"
          hint={`The smallest uplift in ${metricLabel} worth detecting.`}
          error={errors.mde}
          explainerId="mde"
        >
          <input id="pre-rev-mde" className="input" type="number" min="0" step="0.1" placeholder="e.g. 5"
            value={mde} onChange={(e) => setMde(e.target.value)} />
        </Field>

        <Field label={trafficLabel} htmlFor="pre-rev-traffic" error={errors.traffic} hint={trafficHint}>
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
                [`Eclipse - ${metricLabel} planning`, ""],
                ["Generated", new Date().toLocaleString("en-GB")],
                [],
                ["Inputs", ""],
                [`Coefficient of Variation (CV) for ${metricLabel}`, cv],
                ["Minimum detectable effect (relative)", `${mde}%`],
                [trafficLabel, `${traffic} ${period === "day" ? "per day" : period === "month" ? "per month" : "per week"}`],
                ["Variants (incl. control)", k],
                ["Confidence level", `${Math.round(confidence*100)}%`],
                ["Statistical power", `${Math.round(power*100)}%`],
                ["Tails", twoTailed ? "Two-tailed" : "One-tailed"],
                [],
                ["Results", ""],
                [`${revMetric === 'aov' ? 'Orders' : 'Visitors'} required per variant`, result.nPerArm],
                [`Total ${revMetric === 'aov' ? 'orders' : 'visitors'} required`, result.total],
                ["Estimated duration (days)", result.days],
                ["Estimated duration (weeks)", result.weeks],
                [],
                ["Detectable uplift %", ...result.chart.map(c => c.mde ?? "")],
              ];
              downloadBlob(toCsv(rows), `eclipse-plan-${revMetric}-${stamp()}.csv`, "text/csv");
            }}
            onPdf={() => {
              exportPdf(`${metricLabel} test planning`, [
                { heading: "Setup", lines: [
                  `Coefficient of Variation (CV): ${cv}`,
                  `Minimum detectable effect (relative): ${mde}%`,
                  `${trafficLabel}: ${traffic} ${period === "day" ? "per day" : period === "month" ? "per month" : "per week"}`,
                  `Variants (incl. control): ${k}`,
                  `Confidence: ${Math.round(confidence*100)}%   Power: ${Math.round(power*100)}%   ${twoTailed ? "Two-tailed" : "One-tailed"}`,
                ]},
                { heading: "Results", lines: [
                  `${revMetric === 'aov' ? 'Orders' : 'Visitors'} required per variant: ${fmtInt(result.nPerArm)}`,
                  `Total ${revMetric === 'aov' ? 'orders' : 'visitors'} required: ${fmtInt(result.total)}`,
                  `Estimated duration: ${result.days} ${result.days === 1 ? "day" : "days"} (${result.weeks} ${result.weeks === 1 ? "week" : "weeks"})`,
                ]},
                { heading: "Detectable relative uplift by duration", lines:
                  result.chart.map(c => `Week ${c.week}: ${c.mde != null ? c.mde + "%" : "-"}`) },
              ]);
            }}
          />
        )}
        {!result && <p className="empty">Enter your test details to calculate required sample sizes and duration.</p>}
        {result && (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-label">{revMetric === 'aov' ? 'Orders' : 'Visitors'} per variant</div>
                <div className="stat-num">{fmtInt(result.nPerArm)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Total {revMetric === 'aov' ? 'orders' : 'visitors'}</div>
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
                (weekday vs weekend, pay cycles) - running at least 1–2 full weeks is recommended
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

function MetricDistributionChart({ comparisons, formatX, formatTooltipLabel, caption }) {
  const colors = useChartTheme();
  const tip = chartTipProps(colors);
  if (!comparisons?.length) return null;

  const normalPdf = (x, mu, s) =>
    s > 0 ? Math.exp(-0.5 * ((x - mu) / s) ** 2) / (s * Math.sqrt(2 * Math.PI)) : 0;

  let lo = Infinity, hi = -Infinity;
  comparisons.forEach(c => {
    lo = Math.min(lo, c.p1 - 4 * c.seA, c.p2 - 4 * c.seB);
    hi = Math.max(hi, c.p1 + 4 * c.seA, c.p2 + 4 * c.seB);
  });
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return null;

  const N = 80;
  const data = [];
  for (let i = 0; i <= N; i++) {
    const x = lo + (hi - lo) * i / N;
    const row = { x };
    row.control = normalPdf(x, comparisons[0].p1, comparisons[0].seA);
    comparisons.forEach((c, j) => { row[`v${j}`] = normalPdf(x, c.p2, c.seB); });
    data.push(row);
  }

  const palette = ["#DC004A", "#818CF8", "#34D399", "#FBBF24", "#F87171", "#38BDF8", "#FB7185"];
  const fmtLabel = formatTooltipLabel || formatX;

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" />
          <XAxis dataKey="x" tick={{ fontSize: 11, fill: colors.tick }}
            tickFormatter={formatX} minTickGap={28} />
          <YAxis hide />
          <ChartTip
            formatter={(val, key) => [Math.round(val), key === "control" ? "Variant A (Control)" : "Variant"]}
            labelFormatter={fmtLabel} {...tip} />
          <Line type="monotone" dataKey="control" stroke={colors.control} strokeWidth={2} dot={false} isAnimationActive={false} name="Variant A (Control)" />
          {comparisons.map((c, j) => (
            <Line key={j} type="monotone" dataKey={`v${j}`} stroke={palette[(j + 1) % palette.length]}
              strokeWidth={2} dot={false} isAnimationActive={false} name={c.name} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {caption && <p className="chart-caption">{caption}</p>}
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
          <MetricDistributionChart
            comparisons={comparisons}
            formatX={(v) => (v * 100).toFixed(2)}
            formatTooltipLabel={(x) => `CVR ${(x * 100).toFixed(3)}%`}
            caption="Expected spread of each variant's true conversion rate. The more the curves overlap, the harder it is to tell them apart - wide separation is what makes a result significant."
          />
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

function buildMetricComparisons(armStats, metricKey) {
  const ctrl = armStats[0][metricKey];
  return armStats.slice(1).map(a => {
    const m = a[metricKey];
    return {
      name: a.name,
      p1: ctrl.m,
      p2: m.m,
      seA: ctrl.s / Math.sqrt(Math.max(1, ctrl.n)),
      seB: m.s / Math.sqrt(Math.max(1, m.n)),
    };
  });
}

function MetricDetailedStats({ armStats, metricKey, metricShort, caption, results, confidence, twoTailed }) {
  const [open, setOpen] = useState(false);
  const comparisons = buildMetricComparisons(armStats, metricKey);

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
          <MetricDistributionChart
            comparisons={comparisons}
            formatX={(v) => fmtMoney(v)}
            formatTooltipLabel={(x) => `${metricShort} ${fmtMoney(x)}`}
            caption={caption}
          />
          <h4 className="detail-title">The numbers</h4>
          <div className="detail-table-wrap">
            <table className="detail-table">
              <thead>
                <tr>
                  <th scope="col">Comparison</th>
                  <th scope="col">Std error A</th>
                  <th scope="col">Std error</th>
                  <th scope="col">T-score</th>
                  <th scope="col">df</th>
                  <th scope="col">p-value</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const c = comparisons[i];
                  return (
                    <tr key={r.name}>
                      <th scope="row">{r.name} vs A</th>
                      <td data-label="Std error A">{c ? fmtMoney(c.seA) : "-"}</td>
                      <td data-label="Std error">{c ? fmtMoney(c.seB) : "-"}</td>
                      <td data-label="T-score">{r.t.toFixed(4)}</td>
                      <td data-label="df">{Number.isFinite(r.df) ? r.df.toFixed(1) : "-"}</td>
                      <td data-label="p-value">{fmtP(r.pAdj)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="detail-formula">
            Welch's t-test · SE<sub>mean</sub> = s / √n ·
            {twoTailed ? " two-tailed" : " one-tailed"} at {Math.round(confidence * 100)}% confidence
          </p>
        </div>
      )}
    </div>
  );
}

function ResultCard({ name, baseLabel, varLabel, baseVal, varVal,
  relUplift, pRaw, pAdj, corrected, ciBase, ciVar, ciUpliftLo, ciUpliftHi, baseCiLabel, varCiLabel,
  confidence, twoTailed, ciFmt, addDays, metricNoun = "performed", meaningOverride, zScore, goal = "increase", skewVerdict,
  sdBase, sdVar, baseSdLabel, varSdLabel }) {
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
  const hasUpliftCi = ciUpliftLo != null && ciUpliftHi != null
    && Number.isFinite(ciUpliftLo) && Number.isFinite(ciUpliftHi);

  const who = name.split(" vs ")[0];
  const betterTxt = goal === "decrease" ? "lower" : "better";
  const worseTxt = goal === "decrease" ? "higher" : "worse";
  
  const meaning = meaningOverride || (
    kind === "winner"
      ? `The difference is large enough to be a real effect, not random fluctuation - ${who} ${metricNoun} ${betterTxt} than Variant A.`
      : kind === "loser"
      ? `The difference is large enough to be a real effect, not random fluctuation - ${who} ${metricNoun} ${worseTxt} than Variant A.`
      : `There's not enough evidence yet to be sure this is a real difference - it could still be random fluctuation.`);

  return (
    <article className={`result-card-v2 v2-${kind}`}>
      <div className="v2-header">
        <div className="v2-verdict-wrap">
          <Verdict kind={kind} />
          <h4 className="v2-title">{name}</h4>
        </div>
        <div className="v2-conf-pill">
          <span className="v2-conf-val">{confValue != null ? `${confValue.toFixed(1)}%` : "-"}</span>
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
              <span className="v2-d-val">{zScore?.value != null ? zScore.value.toFixed(4) : "-"}</span>
            </div>
            {zScore?.df != null && Number.isFinite(zScore.df) && (
              <div className="v2-d-col">
                <span className="v2-d-label">Degrees of freedom</span>
                <span className="v2-d-val">{zScore.df.toFixed(1)}</span>
              </div>
            )}
            {hasUpliftCi && (
              <div className="v2-d-col">
                <span className="v2-d-label"><Explainer id="upliftci" inline label={`Relative uplift (${confPct}% CI)`} /></span>
                <span className="v2-d-val">{fmtSignedPct(ciUpliftLo)} – {fmtSignedPct(ciUpliftHi)}</span>
              </div>
            )}
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
            {sdBase != null && Number.isFinite(sdBase) && (
              <div className="v2-d-col">
                <span className="v2-d-label">{baseSdLabel || "Control std dev"}</span>
                <span className="v2-d-val">{fmtMoney(sdBase)}</span>
              </div>
            )}
            {sdVar != null && Number.isFinite(sdVar) && (
              <div className="v2-d-col">
                <span className="v2-d-label">{varSdLabel || "Variant std dev"}</span>
                <span className="v2-d-val">{fmtMoney(sdVar)}</span>
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
        : `Not enough evidence to confirm ${name} stays within your ${fmtPct(marginRel)} margin. This doesn't mean it's worse - only that the data can't rule out a drop bigger than the margin.`);

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

function PostCvr({ confidence, twoTailed, isNonInf, goal, marginPct, k, rows, setRows, alloc, setAlloc, setVariantCount, durationDays, setDurationDays }) {
  const labels = makeLabels(k);
  const marginRel = Number(marginPct) / 100;
  const [calculated, setCalculated] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setCalculated(false); },
    [rows, alloc, goal, marginPct, k, confidence, twoTailed, isNonInf, durationDays]);

  const parsed = rows.map((r) => ({ v: Number(r.visitors), c: Number(r.conversions) }));
  const rowErrors = parsed.map(({ v, c }, i) => {
    const vRaw = rows[i].visitors;
    const cRaw = rows[i].conversions;
    if (vRaw !== "" && !(Number.isInteger(v) && v > 0)) return "Visitors must be a whole number greater than 0.";
    if (cRaw !== "" && !(Number.isInteger(c) && c >= 0)) return "Conversions must be a whole number of 0 or more.";
    if (vRaw !== "" && cRaw !== "" && c > v) return "Conversions can't exceed visitors.";
    if (calculated && (vRaw === "" || cRaw === "")) return "Enter visitors and conversions.";
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
        <p className="field-hint">Raw counts only - conversion rates are calculated for you.</p>

        <VariantStepper k={k} setVariantCount={setVariantCount} idBase="cvr-k" />

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
                    {cvr != null ? fmtPct(cvr) : "-"}
                  </output>
                </div>
              </div>
              {rowErrors[i] && <div className="field-error" role="alert">{rowErrors[i]}</div>}
            </div>
          );
        })}

        <Field label="Planned traffic split (for the traffic split check)" htmlFor={undefined} explainerId="srm"
          hint="Defaults to an equal split - change it if your experiment was set up with an unequal split.">
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
            <div className="test-pill">{isNonInf ? "Non-inferiority" : (twoTailed ? "Two-tailed" : "One-tailed")}</div>
            <div className="test-pill">{Math.round(confidence * 100)}% confidence</div>
            {isNonInf && <div className="test-pill">{fmtPct(marginRel)} margin</div>}
            {!isNonInf && corrected && <div className="test-pill">Multi-variant corrected</div>}
          </div>
        </div>
        {ready && (
          <ExportButtons
            onCsv={() => {
              const head = [
                ["Eclipse - Conversion rate analysis", ""],
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
                  srm ? (srm.flagged ? `SRM check: FLAGGED (p=${fmtP(srm.p)}) - results may be unreliable` : `SRM check: healthy (p=${fmtP(srm.p)})`) : "",
                ].filter(Boolean)},
                { heading: "Data", lines: currentParsed.map((r, i) => `${currentLabels[i]}: ${fmtInt(r.v)} visitors, ${fmtInt(r.c)} conversions (CVR ${fmtPct(r.c/r.v)})`) },
                { heading: "Results", lines: isNonInf
                  ? currentNoninfResults?.map(r => `${r.name} vs Variant A: relative diff ${fmtSignedPct(r.relDiff)} - ${(r.pRaw < 1 - confidence) ? "Non-inferiority confirmed" : (r.upperBound < -r.margin ? "Worse than margin" : "Not confirmed")}`)
                  : currentResults?.map(r => { 
                      const dp = corrected ? r.pAdj : r.pRaw; 
                      const isWin = currentGoal === "decrease" ? r.relUplift < 0 : r.relUplift > 0;
                      const verdict = (dp < 1 - confidence) ? (isWin ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant";
                      return `${r.name} vs Variant A: ${fmtSignedPct(r.relUplift)} uplift, p=${fmtP(r.pRaw)}${corrected ? ` (corrected ${fmtP(r.pAdj)})` : ""}, ${Math.min(99.9,(1-dp)*100).toFixed(1)}% confidence - ${verdict}`; 
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
                      ciUpliftLo={r.ciLo} ciUpliftHi={r.ciHi}
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

function stripInlineComment(raw) {
  return String(raw ?? "").trim().replace(/\s*(#|\/\/).*$/u, "").trim();
}

function isCommentRow(row) {
  const firstNonEmpty = row.map(c => String(c ?? "").trim()).find(c => c !== "");
  if (!firstNonEmpty) return false;
  return /^[#;]|^\/\//.test(firstNonEmpty);
}

function filterNonCommentRows(rows) {
  return rows.filter(row => !isCommentRow(row));
}

function parseRevenueCell(raw) {
  let cell = stripInlineComment(raw);
  if (!cell) return null;

  cell = cell.replace(/[£$€\s]/g, '');

  if (cell.includes(',') && cell.includes('.')) {
    const lastComma = cell.lastIndexOf(',');
    const lastDot = cell.lastIndexOf('.');
    if (lastComma > lastDot) cell = cell.replace(/\./g, '').replace(',', '.');
    else cell = cell.replace(/,/g, '');
  } else if (cell.includes(',')) {
    if (/^\d{1,3}(,\d{3})+$/.test(cell)) cell = cell.replace(/,/g, '');
    else cell = cell.replace(',', '.');
  }

  const v = Number(cell);
  return Number.isFinite(v) ? v : NaN;
}

function rowHasLeadingNumericPair(row) {
  const a = parseRevenueCell(row[0]);
  const b = parseRevenueCell(row[1]);
  return a !== null && !Number.isNaN(a) && b !== null && !Number.isNaN(b);
}

function isSingleColDataRow(row) {
  const p = parseRevenueCell(row[0]);
  return p !== null && !Number.isNaN(p);
}

function isTwoColDataRow(row) {
  const id = stripInlineComment(row[0]);
  const rev = parseRevenueCell(row[1]);
  return id !== "" && rev !== null && !Number.isNaN(rev);
}

function isMultiColDataRow(row, k) {
  if (!rowHasLeadingNumericPair(row)) return false;
  for (let c = 2; c < k; c++) {
    const cell = String(row[c] ?? "").trim();
    if (!cell) continue;
    const p = parseRevenueCell(row[c]);
    if (p === null || Number.isNaN(p)) return false;
  }
  return true;
}

// format: "single" = one revenue column (col A); "two-col" = ID in col A, revenue in col B
function parseRevenueFile(text, format = "single") {
  const values = [], errors = [];
  const revenueColIdx = format === "two-col" ? 1 : 0;

  let results = Papa.parse(text.trim(), {
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (results.data.length > 0 && results.data[0].length === 1 && format === "single") {
    const spaceSplit = text.trim().split('\n')[0].split(/\s+/);
    if (spaceSplit.length > 1) {
      results = Papa.parse(text.trim(), {
        delimiter: " ",
        skipEmptyLines: true,
        dynamicTyping: false,
      });
    }
  }

  const rows = filterNonCommentRows(results.data ?? []);
  if (!rows.length) return { values, errors };

  if (format === "single") {
    const hasExtraColumnData = rows.some(row =>
      row.slice(1).some(cell => String(cell ?? "").trim() !== "")
    );
    if (hasExtraColumnData) {
      return {
        values: [],
        errors: ["Upload a single-column file with one order revenue value per row in the first column."],
      };
    }
  } else if (format === "two-col") {
    const hasExtraColumnData = rows.some(row =>
      row.slice(2).some(cell => String(cell ?? "").trim() !== "")
    );
    if (hasExtraColumnData) {
      return {
        values: [],
        errors: ["Use two columns only: identifier in the first column, order revenue in the second."],
      };
    }
  }

  let negativeCount = 0;
  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const revRaw = String(row[revenueColIdx] ?? "").trim();
    const parsed = revRaw ? parseRevenueCell(row[revenueColIdx]) : null;

    if (parsed !== null && !Number.isNaN(parsed) && parsed < 0) {
      negativeCount++;
      if (errors.length < 8) {
        errors.push(`Row ${rowNum}: revenue can't be negative (${revRaw}).`);
      }
      return;
    }

    if (format === "single" && !isSingleColDataRow(row)) return;
    if (format === "two-col" && !isTwoColDataRow(row)) return;

    if (parsed === null) return;

    if (Number.isNaN(parsed)) {
      if (errors.length < 8) {
        errors.push(`Row ${rowNum}: "${revRaw}" is not a number.`);
      }
      return;
    }

    values.push(parsed);
  });

  if (negativeCount > 8) {
    errors.push(`…and ${negativeCount - 8} more rows with negative revenue (not included).`);
  }

  if (!values.length && errors.length === 0) {
    errors.push(format === "two-col"
      ? "No revenue values found in the second column."
      : "No revenue values found in the first column.");
  }

  return { values, errors };
}

// One file, one column per variant: each cell is an order revenue value for that variant.
function parseMultiVariantRevenueFile(text, k) {
  const errors = [];
  const variants = Array.from({ length: k }, () => ({ values: [], errors: [] }));

  const results = Papa.parse(text.trim(), {
    skipEmptyLines: false,
    dynamicTyping: false,
  });

  const rows = filterNonCommentRows(
    (results.data ?? []).filter(row =>
      row.some(cell => String(cell ?? "").trim() !== "")
    )
  );
  if (!rows.length) {
    errors.push("File is empty.");
    return { variants, errors };
  }

  const numCols = Math.max(...rows.map(row => row.length));
  if (numCols < k) {
    errors.push(`File has ${numCols} column${numCols === 1 ? "" : "s"} but you have ${k} variants. Each variant needs its own column.`);
    return { variants, errors };
  }
  if (numCols > k) {
    errors.push(`File has ${numCols} columns but you have ${k} variants. Remove extra columns or add variants.`);
    return { variants, errors };
  }

  const negativeCounts = Array(k).fill(0);
  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const rowIsDataRow = isMultiColDataRow(row, k);

    for (let c = 0; c < k; c++) {
      const revRaw = String(row[c] ?? "").trim();
      if (!revRaw) continue;
      const parsed = parseRevenueCell(row[c]);

      if (parsed !== null && !Number.isNaN(parsed) && parsed < 0) {
        negativeCounts[c]++;
        if (variants[c].errors.length < 8) {
          variants[c].errors.push(`Row ${rowNum}, column ${c + 1}: revenue can't be negative (${revRaw}).`);
        }
        continue;
      }

      if (!rowIsDataRow) continue;
      if (parsed === null) continue;
      if (Number.isNaN(parsed)) {
        if (variants[c].errors.length < 8) {
          variants[c].errors.push(`Row ${rowNum}, column ${c + 1}: "${revRaw}" is not a number.`);
        }
        continue;
      }
      variants[c].values.push(parsed);
    }
  });

  negativeCounts.forEach((count, c) => {
    if (count > 8) {
      variants[c].errors.push(`…and ${count - 8} more rows with negative revenue in column ${c + 1} (not included).`);
    }
  });

  const emptyCols = variants.map((v, i) => v.values.length === 0 ? i + 1 : null).filter(Boolean);
  if (emptyCols.length) {
    errors.push(`No revenue values found in column${emptyCols.length > 1 ? "s" : ""} ${emptyCols.join(", ")}.`);
  }

  return { variants, errors };
}

function PostRevenue({ confidence, twoTailed, k, rows, alloc, setAlloc, setVariantCount, durationDays, setDurationDays }) {
  const labels = makeLabels(k);

  // Per-variant local state: visitor/conversion overrides, file parse result, file name
  const [visitorOverrides, setVisitorOverrides] = useState(Array(8).fill(''));
  const [convOverrides, setConvOverrides]       = useState(Array(8).fill(''));
  const [fileParsed, setFileParsed]             = useState(Array(8).fill(null)); // {values,errors,name}
  const [combinedFileParsed, setCombinedFileParsed] = useState(null); // {name, variants, errors}
  const [fileFormat, setFileFormat]             = useState("single"); // single | two-col | multi-col
  const [winsorize, setWinsorize]               = useState(false);
  const [outlierPct, setOutlierPct]             = useState(0.99);
  const [calculated, setCalculated]             = useState(false);
  const fileRefs = useRef(Array.from({ length: 8 }, () => null));
  const combinedFileRef = useRef(null);
  const isMultiCol = fileFormat === "multi-col";
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setCalculated(false); },
    [visitorOverrides, convOverrides, fileParsed, combinedFileParsed, fileFormat, winsorize, outlierPct, alloc, k, confidence, twoTailed, durationDays, rows]);

  React.useEffect(() => {
    setFileParsed(Array(8).fill(null));
    setCombinedFileParsed(null);
    fileRefs.current.forEach(ref => { if (ref) ref.value = ""; });
    if (combinedFileRef.current) combinedFileRef.current.value = "";
    setCalculated(false);
  }, [fileFormat]);

  React.useEffect(() => {
    if (!isMultiCol) return;
    setCombinedFileParsed(null);
    if (combinedFileRef.current) combinedFileRef.current.value = "";
    setCalculated(false);
  }, [k, isMultiCol]);

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
    const fp = isMultiCol
      ? (combinedFileParsed?.variants?.[i]
          ? { ...combinedFileParsed.variants[i], name: combinedFileParsed.name }
          : null)
      : fileParsed[i];
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
        mismatch = `The file contains ${fmtInt(orderCount)} orders but ${fmtInt(convNum)} conversions are recorded above. This could mean a wrong date range, duplicate orders, or multiple orders per visitor.`;
      else
        mismatch = `The file contains ${fmtInt(orderCount)} orders but ${fmtInt(convNum)} conversions are recorded above. Some orders may be missing from the export, or your conversion definition doesn't map 1:1 to individual orders.`;
    }

    let visitorsError = null;
    if (vRaw !== '' && !visitorsOk) visitorsError = 'Visitors must be a whole number greater than 0.';
    else if (vRaw !== '' && orderCount > visitors) visitorsError = `More orders (${fmtInt(orderCount)}) than visitors (${fmtInt(visitors)}) - check the visitor count.`;
    else if (calculated && vRaw === '') visitorsError = 'Enter visitors - needed for revenue per visitor.';

    return { name: nm, visitors, visitorsOk: !visitorsError, visitorsError, vRaw,
             orders, orderCount, fp, mismatch };
  });

  const combinedFileOk = !isMultiCol || (
    combinedFileParsed &&
    combinedFileParsed.errors.length === 0 &&
    combinedFileParsed.variants?.every(v => v.errors.length === 0)
  );
  const noFileErrors = isMultiCol
    ? combinedFileOk
    : armData.every(a => !a.fp || a.fp.errors.length === 0);
  const allFilesLoaded = noFileErrors && armData.every(a => a.orderCount >= 2);
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
    const sizeErr = uploadSizeError(file);
    if (sizeErr) {
      setFileParsed(prev => {
        const n = [...prev];
        n[i] = { values: [], errors: [sizeErr], name: file.name };
        return applyDuplicateFilenameErrors(n, k);
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const { values, errors } = parseRevenueFile(e.target.result, fileFormat);
      setFileParsed(prev => {
        const n = [...prev];
        n[i] = { values, errors, name: file.name };
        return applyDuplicateFilenameErrors(n, k);
      });
    };
    reader.readAsText(file);
  };

  const onCombinedFile = (file) => {
    const sizeErr = uploadSizeError(file);
    if (sizeErr) {
      setCombinedFileParsed({ name: file.name, variants: Array.from({ length: k }, () => ({ values: [], errors: [] })), errors: [sizeErr] });
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const { variants, errors } = parseMultiVariantRevenueFile(e.target.result, k);
      setCombinedFileParsed({ name: file.name, variants, errors });
    };
    reader.readAsText(file);
  };

  const formatHint = isMultiCol
    ? `Upload one CSV with ${k} revenue columns (${labels.map((nm, i) => `column ${i + 1} = ${nm}`).join(", ")}). Changing format or variant count clears uploaded files.`
    : "Upload one file per variant. Changing format clears any files already uploaded.";

  const perVariantUploadHint = fileFormat === "two-col"
    ? "Two columns · ID in the first, revenue in the second · # comment lines ignored · max 10 MB"
    : "Single column · one revenue value per row · # comment lines ignored · max 10 MB";

  const combinedUploadHint = `${k} revenue columns · ${labels.map((nm, i) => `column ${i + 1} = ${nm}`).join(" · ")} · rows need numbers in columns 1 and 2 · # comment lines ignored · max 10 MB`;

  const totalOrdersDetected = isMultiCol && combinedFileParsed
    ? armData.reduce((sum, a) => sum + a.orderCount, 0)
    : 0;

  const corrected = k >= 3;
  const days = Number(durationDays);

  return (
    <div className="two-col">
      <section className="panel" aria-labelledby="rev-h">

        <VariantStepper k={k} setVariantCount={setVariantCount} idBase="rev-k" />

        <Field label="Planned traffic split" htmlFor={undefined} explainerId="srm"
          hint="Defaults to an equal split - change it if your experiment used an unequal split (e.g. 30/70).">
          <AllocationEditor alloc={alloc} setAlloc={setAlloc} labels={labels} idPrefix="rev" />
        </Field>

        <h3 className="block-title">Traffic & Conversions per variant</h3>
        <p className="field-hint">Pulled from the Conversion rate tab if entered there - edit here to fix mismatches with your files.</p>
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

        <Field
          label="File format"
          htmlFor="rev-file-format"
          hint={formatHint}
        >
          <select
            id="rev-file-format"
            className="input select rev-file-format-select"
            value={fileFormat}
            onChange={(e) => setFileFormat(e.target.value)}
          >
            <option value="single">Separate file per variant · 1 revenue column</option>
            <option value="two-col">Separate file per variant · 2 columns (ID + revenue)</option>
            <option value="multi-col">1 shared file · {k} revenue columns (one per variant)</option>
          </select>
        </Field>

        {isMultiCol ? (
          <>
            <h3 className="block-title">Order revenue file</h3>
            <div className="upload-zone" role="group" aria-label="Combined order revenue file for all variants">
              <input
                ref={combinedFileRef}
                type="file" accept=".csv,.txt,text/csv,text/plain"
                className="sr-only"
                id="rev-file-combined"
                aria-describedby="rev-file-combined-hint"
                onChange={e => e.target.files && e.target.files[0] && onCombinedFile(e.target.files[0])}
              />
              <label htmlFor="rev-file-combined" className={`upload-label ${combinedFileParsed ? 'upload-label-filled' : ''}`}>
                <span className="upload-icon" aria-hidden="true">{combinedFileParsed ? <FileIcon /> : <UploadIcon />}</span>
                <span className="upload-cta">{combinedFileParsed ? combinedFileParsed.name : 'Choose file'}</span>
                <span className="upload-sub">
                  {combinedFileParsed
                    ? (combinedFileOk
                      ? `${fmtInt(totalOrdersDetected)} orders detected across ${k} variants - click to replace`
                      : `${fmtInt(totalOrdersDetected)} orders · fix file issues below`)
                    : 'CSV or text file · max 10 MB'}
                </span>
              </label>
              <div id="rev-file-combined-hint" className="upload-fmt">{combinedUploadHint}</div>
            </div>

            {combinedFileParsed && combinedFileParsed.errors.length > 0 && (
              <div className="field-error" role="alert">
                {combinedFileParsed.errors.map((err, j) => <div key={j}>{err}</div>)}
              </div>
            )}

            {combinedFileParsed && (
              <ul className="multi-file-summary">
                {armData.map((a, i) => (
                  <li key={i}>
                    <strong>{a.name}</strong>
                    <span>{fmtInt(a.orderCount)} orders</span>
                    {a.fp?.errors?.length > 0 && (
                      <div className="field-error" role="alert">
                        {a.fp.errors.map((err, j) => <div key={j}>{err}</div>)}
                      </div>
                    )}
                    {a.mismatch && <div className="mismatch-warn" role="alert">{a.mismatch}</div>}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
        <h3 className="block-title">Order revenue file per variant</h3>
        {armData.map((a, i) => (
          <div className="arm-row" key={i}>
              <h3 className="arm-name">
                <span className="avatar-dot" aria-hidden="true">{LETTERS[i]}</span>
                {a.name}
                <span className="arm-orders">
                  {a.orderCount > 0 ? `${fmtInt(a.orderCount)} orders` : ''}
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
                <span className="upload-sub">{a.fp
                  ? (a.fp.errors.length > 0
                    ? `${fmtInt(a.orderCount)} orders · fix ${a.fp.errors.length} issue${a.fp.errors.length > 1 ? 's' : ''} below`
                    : `${fmtInt(a.orderCount)} orders detected - click to replace`)
                  : 'CSV or text file · max 10 MB'}</span>
              </label>
              <div id={`rev-file-hint-${i}`} className="upload-fmt">
                {perVariantUploadHint}
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
          </>
        )}

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
                ["Eclipse - Revenue analysis", ""],
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
                  `${r.name} vs Variant A: ${fmtSignedPct(r.relUplift)}, p=${fmtP(r.pAdj)} - ${(r.pAdj < 1 - confidence) ? (r.relUplift > 0 ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant"}`) },
                { heading: "Average order value", lines: currentAnalysis.aov.map(r =>
                  `${r.name} vs Variant A: ${fmtSignedPct(r.relUplift)}, p=${fmtP(r.pAdj)} - ${(r.pAdj < 1 - confidence) ? (r.relUplift > 0 ? "Significant winner" : (twoTailed ? "Significant loser" : "Not significant")) : "Not significant"}`) },
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
                  ciUpliftLo={r.ciLo} ciUpliftHi={r.ciHi}
                  baseCiLabel="Variant A Revenue Per Visitor" varCiLabel={`${r.name} Revenue Per Visitor`}
                  sdBase={analysis.armStats[0].rpv.s} sdVar={analysis.armStats[i + 1].rpv.s}
                  baseSdLabel="Variant A RPV std dev" varSdLabel={`${r.name} RPV std dev`}
                  ciFmt={(lo, hi) => `${fmtMoney(lo)} – ${fmtMoney(hi)}`}
                  confidence={confidence} twoTailed={twoTailed}
                  zScore={{ label: "T-score", value: r.t, df: r.df }}
                  skewVerdict={analysis.armStats[i+1].rpv.skew}
                  meaningOverride={
                    (corrected ? r.pAdj : r.pRaw) < 1 - confidence
                      ? `The difference is large enough to be a real effect, not random fluctuation - ${r.name} ${r.relUplift >= 0 ? "generated more" : "generated less"} revenue per visitor than Variant A.`
                      : "There's not enough evidence yet to be sure this is a real difference in revenue per visitor - it could still be random fluctuation."
                  }
                />
              ))}

              <MetricDetailedStats
                armStats={analysis.armStats}
                metricKey="rpv"
                metricShort="RPV"
                caption="Expected spread of each variant's true revenue per visitor (non-buyers count as £0). The more the curves overlap, the harder it is to detect a difference."
                results={analysis.rpv}
                confidence={confidence}
                twoTailed={twoTailed}
              />

              <h3 className="sub-title"><Explainer id="aovrpv" inline label="Average order value" /></h3>
              <div className="aov-warning">
                <strong>Important:</strong> Average order value only looks at people who made an order. 
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
                  ciUpliftLo={r.ciLo} ciUpliftHi={r.ciHi}
                  baseCiLabel="Variant A Average Order Value" varCiLabel={`${r.name} Average Order Value`}
                  ciFmt={(lo, hi) => `${fmtMoney(lo)} – ${fmtMoney(hi)}`}
                  confidence={confidence} twoTailed={twoTailed}
                  zScore={{ label: "T-score", value: r.t, df: r.df }}
                  skewVerdict={analysis.armStats[i+1].aov.skew}
                  meaningOverride={
                    (corrected ? r.pAdj : r.pRaw) < 1 - confidence
                      ? `The difference is large enough to be a real effect, not random fluctuation - among buyers, ${r.name} had a ${r.relUplift >= 0 ? "higher" : "lower"} average order value than Variant A.`
                      : "There's not enough evidence yet to be sure this is a real difference in average order value - it could still be random fluctuation."
                  }
                />
              ))}

              <MetricDetailedStats
                armStats={analysis.armStats}
                metricKey="aov"
                metricShort="AOV"
                caption="Expected spread of each variant's true average order value among buyers only. Overlap here means similar order sizes, even if conversion or RPV differ."
                results={analysis.aov}
                confidence={confidence}
                twoTailed={twoTailed}
              />
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
  const [revMetric, setRevMetric] = useState("rpv");
  const [postTab, setPostTab] = useState("cvr");
  const [confidence, setConfidence] = useState(0.95);
  const [tails, setTails] = useState("two");
  const [power, setPower] = useState(0.8);
  const twoTailed = tails === "two";

  // Conversion-rate analysis: test type + winner direction (lives in settings, not the panel)
  const [cvrTestType, setCvrTestType] = useState("two"); // "two" | "one" | "noninf"
  const [goal, setGoal] = useState("increase");
  const [marginPct, setMarginPct] = useState("1");

  const setCvrTestTypeAndSync = (next) => {
    setCvrTestType(next);
    if (next === "two") setTails("two");
    if (next === "one") setTails("one");
  };

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
          <p className="intro-privacy">
            All statistics run here in your browser. Your numbers are never uploaded or stored on a server.
          </p>
        </div>
      </header>

      <nav className="mode-tabs" aria-label="Calculator mode">
        <button type="button" className={`tab ${mode === "pre" ? "tab-on" : ""}`}
          aria-pressed={mode === "pre"} onClick={() => setMode("pre")}>
          Plan a test
          <span className="tab-sub">Sample size & duration</span>
        </button>
        <button type="button" className={`tab ${mode === "post" ? "tab-on" : ""}`}
          aria-pressed={mode === "post"} onClick={() => setMode("post")}>
          Analyse results
          <span className="tab-sub">Significance & uplift</span>
        </button>
      </nav>

      <div className="calculator-container" style={{ maxWidth: '1080px', margin: '24px auto 0' }}>
        <MetricSelector 
          currentTab={mode === 'pre' ? preTab : postTab} 
          setTab={mode === 'pre' ? setPreTab : setPostTab} 
          revMetric={revMetric} 
          setRevMetric={setRevMetric} 
          mode={mode}
        />

        <section className="settings" aria-label="Statistical settings" key={`settings-${mode}-${mode === "pre" ? preTab : postTab}`} style={{ marginTop: '24px' }}>
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
          {mode === "post" && postTab === "cvr" ? (
            <>
              <SegControl
                legend="Tails"
                name="cvr-tails"
                value={cvrTestType}
                onChange={setCvrTestTypeAndSync}
                explainerId="tailed"
                options={[
                  { value: "two", label: "Two-tailed" },
                  { value: "one", label: "One-tailed" },
                  { value: "noninf", label: "Non-inferiority" },
                ]}
              />
              {cvrTestType !== "noninf" ? (
                <SegControl
                  legend="Goal direction"
                  name="cvr-goal"
                  value={goal}
                  onChange={setGoal}
                  options={[
                    { value: "increase", label: "Increase is a winner" },
                    { value: "decrease", label: "Decrease is a winner" },
                  ]}
                />
              ) : (
                <div className="settings-field">
                  <Field label="Non-inferiority margin (%)" htmlFor="cvr-margin"
                    explainerId="noninf"
                    hint="Max relative drop you'll accept vs control.">
                    <input id="cvr-margin" className="input" type="number" min="0" step="0.1"
                      value={marginPct} onChange={(e) => setMarginPct(e.target.value)} />
                  </Field>
                </div>
              )}
            </>
          ) : mode === "pre" && preTab === "cvr" ? (
            <>
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
                legend="Goal direction"
                name="pre-cvr-goal"
                value={goal}
                onChange={setGoal}
                options={[
                  { value: "increase", label: "Increase is a winner" },
                  { value: "decrease", label: "Decrease is a winner" },
                ]}
              />
            </>
          ) : (
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
          )}
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

        <div style={{ marginTop: '24px' }}>
          {mode === "pre" ? (
            preTab === "cvr" 
              ? <PreTest key="pre-cvr" confidence={confidence} twoTailed={twoTailed} power={power} setPower={setPower} goal={goal} />
              : <PreTestRevenue key="pre-rev" confidence={confidence} twoTailed={twoTailed} power={power} setPower={setPower} revMetric={revMetric} />
          ) : (
            postTab === "cvr"
              ? <PostCvr key="cvr" confidence={confidence}
                twoTailed={cvrTestType === "two"}
                isNonInf={cvrTestType === "noninf"}
                goal={goal}
                marginPct={marginPct}
                k={k} rows={rows} setRows={setRows}
                alloc={alloc} setAlloc={setAlloc}
                setVariantCount={setVariantCount}
                durationDays={durationDays} setDurationDays={setDurationDays} />
              : <PostRevenue key="rev" confidence={confidence} twoTailed={twoTailed}
                k={k} rows={rows}
                alloc={alloc} setAlloc={setAlloc}
                setVariantCount={setVariantCount}
                durationDays={durationDays} setDurationDays={setDurationDays} />
          )}
        </div>
      </div>

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
  --paper:#121212; --card:#1E1E1E; --ink:rgba(255,255,255,0.87); --muted:rgba(255,255,255,0.60);
  --line:#383838;
  --pink:#E54D7A; --pink-deep:#FDA4AF; --pink-soft:#4C0519;
  --grey-disabled:#2A2A2A; --text-disabled:#71717A;
  --purple:#94A3E8; --purple-deep:#E0E7FF; --purple-soft:#2D2A70;
  --purple-bright:#818CF8; --avatar:#4338CA;
  --purple-active:#5A51D6;
  --navy:rgba(255,255,255,0.95); --amber:#FBBF24;
  --win:#34D399; --win-bg:#064E3B; --lose:#F87171; --lose-bg:#450A0A;
  --ns:rgba(255,255,255,0.60); --ns-bg:#333333; --warn-bg:#422006; --warn-edge:#FBBF24;
  --shadow:0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
  --chart-grid:#383838;
  --chart-tick:rgba(255,255,255,0.45);
  --chart-line:#94A3E8;
  --chart-dot:#E54D7A;
  --chart-dot-stroke:#1E1E1E;
  --chart-control:rgba(255,255,255,0.60);
  --chart-tooltip-bg:#1E1E1E;
  --chart-tooltip-border:#444444;
  --chart-tooltip-text:rgba(255,255,255,0.87);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --paper:#121212; --card:#1E1E1E; --ink:rgba(255,255,255,0.87); --muted:rgba(255,255,255,0.60);
    --line:#383838;
    --pink:#E54D7A; --pink-deep:#FDA4AF; --pink-soft:#4C0519;
    --grey-disabled:#2A2A2A; --text-disabled:#71717A;
    --purple:#94A3E8; --purple-deep:#E0E7FF; --purple-soft:#2D2A70;
    --purple-bright:#818CF8; --avatar:#4338CA;
    --purple-active:#5A51D6;
    --navy:rgba(255,255,255,0.95); --amber:#F1C40F;
    --win:#34D399; --win-bg:#122B1E; --lose:#F87171; --lose-bg:#3D1414;
    --ns:rgba(255,255,255,0.60); --ns-bg:#333333; --warn-bg:#2D2605; --warn-edge:#F1C40F;
    --shadow:0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
    --chart-grid:#383838;
    --chart-tick:rgba(255,255,255,0.45);
    --chart-line:#94A3E8;
    --chart-dot:#E54D7A;
    --chart-dot-stroke:#1E1E1E;
    --chart-control:rgba(255,255,255,0.60);
    --chart-tooltip-bg:#1E1E1E;
    --chart-tooltip-border:#444444;
    --chart-tooltip-text:rgba(255,255,255,0.87);
  }
}
.app{font-family:'Inter',ui-sans-serif,system-ui,sans-serif;background:var(--paper);color:var(--ink);
  min-height:100vh;padding:0 16px 56px;font-size:15.5px;line-height:1.55;letter-spacing:-0.025em;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  font-feature-settings:'cv11' 1;overflow-x:hidden;}
.app *{box-sizing:border-box;}
.app :focus-visible{outline:3px solid var(--pink);outline-offset:2px;border-radius:6px;}
[data-theme='dark'] .app :focus-visible{outline-color:var(--purple-bright);}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0;}
.num,.stat-num,.mini-table td,.cvr-readout{font-variant-numeric:tabular-nums;
  font-feature-settings:'tnum' 1;}

/* masthead */
.masthead{max-width:1080px;margin:0 auto;padding-top:30px;}
.mast-inner{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;}
.brand-mark{display:block;width:32px;height:32px;min-width:32px;min-height:32px;flex:none;object-fit:contain;}
.brand-word{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:700;font-size:26px;color:var(--pink);
  letter-spacing:-0.03em;line-height:1;text-transform:lowercase;}
[data-theme='dark'] .brand-word{color:var(--pink);}
.tagline{color:var(--muted);font-size:15px;padding-top:6px;}
[data-theme='dark'] .tagline{color:var(--muted);}
.intro{max-width:1080px;margin:20px auto 0;text-align:left;}
.page-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:700;font-size:28px;
  line-height:1.2;letter-spacing:-0.03em;color:var(--navy);margin:0 0 10px;}
[data-theme='dark'] .page-title{color:var(--navy);}
.intro-text{color:var(--muted);font-size:16px;line-height:1.55;margin:0;max-width:65ch;}
.intro-privacy{color:var(--muted);font-size:13.5px;line-height:1.5;margin:10px 0 0;max-width:65ch;opacity:0.9;}
[data-theme='dark'] .intro-text{color:var(--muted);}
[data-theme='dark'] .intro-privacy{color:var(--muted);}
.theme-toggle{background:var(--card);border:1.5px solid var(--line);border-radius:10px;
  width:40px;height:40px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;color:var(--purple);transition:all .15s;box-shadow:var(--shadow);}
[data-theme='dark'] .theme-toggle{color:var(--purple-bright);}
.theme-toggle:hover{border-color:var(--purple);background:rgba(74,55,135,0.08);}
[data-theme='dark'] .theme-toggle:hover{border-color:var(--purple-bright);background:rgba(255,255,255,0.1);}

/* tabs */
.mode-tabs{max-width:1080px;margin:26px auto 0;display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.tab{text-align:left;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);padding:16px 20px;cursor:pointer;box-shadow:var(--shadow);
  font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:600;font-size:17px;color:var(--ink);line-height:1.2;transition:all .15s;}
.tab:hover:not(.tab-on){border-color:var(--purple);background:rgba(74,55,135,0.08);}
[data-theme='dark'] .tab:hover:not(.tab-on){border-color:var(--purple-bright);background:rgba(255,255,255,0.1);filter:none;}
@media (max-width:880px){
  .mode-tabs{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px;}
  .tab{flex:1;min-width:0;width:100%;padding:12px 16px;}
}
.tab-sub{display:block;font-family:'Inter',sans-serif;font-weight:400;
  font-size:13px;color:var(--muted);margin-top:3px;}
[data-theme='dark'] .tab-sub{color:var(--muted);}
.tab-on{border-color:transparent;background:var(--grad);color:#fff;transition:none !important;}
[data-theme='dark'] .tab-on{background:var(--purple-bright);color:var(--navy);border-color:transparent;transition:none !important;}
.tab-on .tab-sub{color:rgba(255,255,255,.85);}
[data-theme='dark'] .tab-on .tab-sub{color:rgba(0,0,0,0.6);}
.tab-on:hover{opacity:1 !important;background:var(--grad) !important;filter:none !important;}
[data-theme='dark'] .tab-on:hover{opacity:1 !important;background:var(--purple-bright) !important;filter:none !important;}
.sub-tabs{max-width:1080px;margin:18px auto 0;display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.subtab{background:var(--card);border:1px solid var(--line);border-radius:999px;
  padding:9px 16px;font-size:13.5px;font-weight:600;color:var(--ink);cursor:pointer;
  font-family:'Inter',sans-serif;box-shadow:var(--shadow);white-space:nowrap;text-align:center;transition:all .15s;}
.subtab:hover:not(.subtab-on){border-color:var(--pink);background:rgba(220,0,74,0.08);}
[data-theme='dark'] .subtab:hover:not(.subtab-on){border-color:var(--pink);background:rgba(255,255,255,0.1);filter:none;}
@media (max-width:880px){
  .sub-tabs{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px;}
  .sub-tabs::-webkit-scrollbar{display:none;}
  .subtab{flex:1;padding:8px 12px;font-size:12.5px;}
}
.subtab-on{border-color:var(--pink);background:var(--pink-soft);color:var(--pink-deep);transition:none !important;}
[data-theme='dark'] .subtab-on{border-color:var(--pink);background:var(--pink-soft);color:var(--pink-deep);box-shadow:0 0 0 1px var(--pink);transition:none !important;}
.subtab-on:hover{opacity:1 !important;background:var(--pink-soft) !important;filter:none !important;}
[data-theme='dark'] .subtab-on:focus-visible{
  border-color:var(--pink);background:var(--pink-soft);color:var(--pink-deep);}
.subtab-on:focus-visible{outline-color:var(--pink);}

/* settings */
.settings{max-width:1080px;margin:16px auto 0;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 20px;display:flex;gap:36px;
  flex-wrap:wrap;align-items:flex-start;justify-content:flex-start;}
.settings-field{min-width:180px;}
.settings-field .field{margin-bottom:0;}
.seg{border:0;padding:0;margin:0;display:flex;flex-direction:column;align-items:flex-start;}
.seg-legend{font-weight:600;font-size:13.5px;margin-bottom:7px;padding:0;text-align:left;}
[data-theme='dark'] .seg-legend{color:var(--ink);}
.seg-row{display:inline-flex;background:var(--paper);border:1px solid var(--line);
  border-radius:999px;padding:3px;flex-wrap:wrap;}
[data-theme='dark'] .seg-row{background:var(--paper);border-color:var(--line);}
.seg-opt{padding:6px 16px;font-size:14px;cursor:pointer;color:var(--muted);
  border-radius:999px;display:flex;align-items:center;font-weight:600;position:relative;transition:all .15s;}
[data-theme='dark'] .seg-opt{color:var(--muted);}
.seg-opt:hover:not(.seg-on){background:rgba(74,55,135,0.08) !important;}
[data-theme='dark'] .seg-opt:hover:not(.seg-on){background:rgba(255,255,255,0.1) !important;filter:none;}
.seg-opt input{position:absolute;opacity:0;pointer-events:none;}
.seg-opt:has(:focus-visible){outline:3px solid var(--pink);outline-offset:1px;}
.seg-opt.seg-on,
.seg-opt.seg-on:hover,
.seg-opt.seg-on:focus,
.seg-opt.seg-on:active{
  background:var(--purple-active) !important;
  background-color:var(--purple-active) !important;
  color:#fff !important;
  opacity:1 !important;
  filter:none !important;
  transition:none !important;
}
[data-theme='dark'] .seg-opt.seg-on,
[data-theme='dark'] .seg-opt.seg-on:hover,
[data-theme='dark'] .seg-opt.seg-on:focus,
[data-theme='dark'] .seg-opt.seg-on:active{
  background:var(--purple-bright) !important;
  background-color:var(--purple-bright) !important;
  color:var(--navy) !important;
  box-shadow:0 0 0 1px var(--purple-bright) !important;
}

/* layout */
.two-col{max-width:1080px;margin:18px auto 0;display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start;}
.pre-planning-container .two-col{grid-template-columns:1fr 1fr;gap:18px;}
.two-col > *{min-width:0;max-width:100%;}
.two-col .results{position:sticky;top:16px;min-width:0;}
@media (max-width:880px){
  .two-col{display:block;width:100%;}
  .two-col > *{margin-bottom:18px;}
  .two-col .results{position:static;max-height:none;overflow-y:visible;}
}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:var(--shadow);padding:22px 24px;min-width:0;max-width:100%;}
[data-theme='dark'] .panel{background:var(--card);border-color:var(--line);}
@media (max-width:600px){
  .panel{padding:16px 12px;border-radius:0;border-inline:0;}
}
.panel-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:600;font-size:20px;margin:0 0 14px;color:var(--navy);letter-spacing:-0.025em;line-height:1.2;}
[data-theme='dark'] .panel-title{color:var(--ink);}
.results-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  flex-wrap:wrap;}
.results-head .panel-title{margin-bottom:8px;}
.export-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px;}
.btn-export{display:inline-flex;align-items:center;gap:6px;background:var(--card);
  border:1.5px solid var(--line);border-radius:9px;padding:6px 14px;font-size:13px;font-weight:600;
  color:var(--purple-deep);cursor:pointer;font-family:'Inter',sans-serif;}
[data-theme='dark'] .btn-export{color:var(--purple-bright);}
.btn-export:hover{border-color:var(--purple);background:rgba(74,55,135,0.08);}
[data-theme='dark'] .btn-export:hover{border-color:var(--purple-bright);background:rgba(255,255,255,0.1);}
.btn-export:disabled{opacity:.5;cursor:wait;}
.export-err{font-size:12.5px;color:var(--lose);}
.detail-wrap{margin:6px 0 12px;}
.detail-toggle{display:inline-flex;align-items:center;gap:7px;background:none;border:0;padding:4px 0;
  color:var(--purple);font-size:13.5px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;}
[data-theme='dark'] .detail-toggle{color:var(--purple-bright);}
.detail-card{margin-top:10px;background:var(--paper);border:1px solid var(--line);
  border-radius:12px;padding:14px 16px;min-width:0;}
[data-theme='dark'] .detail-card{background:var(--paper);border-color:var(--line);}
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
[data-theme='dark'] .detail-table td{color:var(--ink);}
.detail-table thead th{background:var(--card);font-weight:600;color:var(--muted);text-align:right;}
[data-theme='dark'] .detail-table thead th{background:var(--paper);}
.detail-table tbody th{text-align:left;font-weight:600;color:var(--navy);}
[data-theme='dark'] .detail-table tbody th{color:var(--ink);}
.detail-formula{font-size:11.5px;color:var(--muted);margin:10px 0 0;line-height:1.6;}
[data-theme='dark'] .detail-formula{color:var(--muted);}
.btn-text{background:none;border:0;padding:0;color:var(--purple);font-size:13.5px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;margin:4px 0 12px;}
[data-theme='dark'] .btn-text{color:var(--purple-bright);}
.btn-text:hover{text-decoration:underline;}
.badge-soon{display:block;width:fit-content;background:var(--purple-soft);color:var(--purple);
  font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-top:4px;
  text-transform:uppercase;letter-spacing:0.02em;}
[data-theme='dark'] .badge-soon{background:var(--purple-soft);color:var(--purple-bright);border:1px solid var(--purple-bright);}
.animated-fade-in{animation:fadeIn .3s ease-out;}
@keyframes fadeIn{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:translateY(0);}}
.choice-row{display:flex;gap:18px;margin-bottom:24px;flex-wrap:wrap;}
.choice-opt{flex:1;min-width:140px;background:var(--card);border:1.5px solid var(--line);
  border-radius:12px;padding:14px;cursor:pointer;transition:all .15s;text-align:left;position:relative;
  font-family:inherit;-webkit-appearance:none;appearance:none;}
.choice-opt:hover:not(.choice-opt-on){border-color:var(--purple) !important;background:rgba(74,55,135,0.08) !important;}
[data-theme='dark'] .choice-opt:hover:not(.choice-opt-on){border-color:var(--purple-bright) !important;background:rgba(255,255,255,0.1) !important;filter:none;}
.choice-opt.choice-opt-on,
.choice-opt.choice-opt-on:hover,
.choice-opt.choice-opt-on:focus,
.choice-opt.choice-opt-on:active{
  border-color:var(--purple) !important;
  background:var(--purple-active) !important;
  background-color:var(--purple-active) !important;
  color:#fff !important;
  box-shadow:0 0 0 1px var(--purple) !important;
  opacity:1 !important;
  filter:none !important;
  transition:none !important;
}
.choice-opt-on .choice-title{color:#fff !important;}
.choice-opt-on .choice-desc{color:rgba(255,255,255,0.8) !important;}
[data-theme='dark'] .choice-opt.choice-opt-on,
[data-theme='dark'] .choice-opt.choice-opt-on:hover,
[data-theme='dark'] .choice-opt.choice-opt-on:focus,
[data-theme='dark'] .choice-opt.choice-opt-on:active{
  background:var(--purple-bright) !important;
  background-color:var(--purple-bright) !important;
  border-color:var(--purple-bright) !important;
  box-shadow:0 0 0 1px var(--purple-bright) !important;
}
[data-theme='dark'] .choice-opt-on .choice-title{color:var(--navy) !important;}
[data-theme='dark'] .choice-opt-on .choice-desc{color:rgba(0,0,0,0.6) !important;}
.choice-title{display:block;font-weight:600;font-size:14px;color:var(--navy);margin-bottom:4px;}
.choice-desc{display:block;font-size:12.5px;color:var(--muted);line-height:1.4;}
.choice-disabled{opacity:0.7;cursor:not-allowed;}
.choice-disabled:hover{border-color:var(--line);}
.flow-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:600;
  font-size:18px;margin:0 0 16px;color:var(--navy);letter-spacing:-0.02em;}
[data-theme='dark'] .flow-title{color:var(--ink);}
.metric-selector-flow{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:24px;box-shadow:var(--shadow);margin-bottom:0;}
[data-theme='dark'] .metric-selector-flow{background:var(--card);border-color:var(--line);}
.pre-planning-container .two-col{margin-top:0;}
.coming-soon-placeholder{margin-bottom:24px;padding:16px;background:var(--paper);border:1px dashed var(--line);border-radius:12px;}
[data-theme='dark'] .coming-soon-placeholder{background:var(--paper);border-color:var(--line);}
.upload-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:10px;padding:30px;border:2px dashed var(--line);border-radius:12px;color:var(--muted);
  font-size:14px;background:var(--card);transition:all .15s;}
[data-theme='dark'] .upload-placeholder{background:var(--paper);border-color:var(--line);}
.upload-placeholder svg{color:var(--purple);opacity:0.6;}
[data-theme='dark'] .upload-placeholder svg{color:var(--purple-bright);opacity:0.8;}
.sd-calc-section{margin-bottom:20px;}
.sd-calc-box{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:8px;}
[data-theme='dark'] .sd-calc-box{background:var(--paper);border-color:var(--line);}
.sd-result .stat{padding:10px;background:var(--card);}
[data-theme='dark'] .sd-result .stat{background:var(--paper);border-color:var(--line);}
.sd-result .stat-num{font-size:18px;}

.btn-calc{width:100%;background:var(--pink);color:#fff;border:0;border-radius:11px;
  padding:13px 20px;font-size:15.5px;font-weight:700;cursor:pointer;margin-top:18px;
  font-family:'Inter',sans-serif;letter-spacing:.01em;transition:all .15s;}
.btn-calc:hover{background:var(--pink-deep);transform:translateY(-1px);}
[data-theme='dark'] .btn-calc{background:var(--purple-bright);color:var(--navy);}
[data-theme='dark'] .btn-calc:hover{filter:brightness(1.1);transform:translateY(-1px);}
.btn-calc:disabled{background:var(--grey-disabled);color:var(--text-disabled);cursor:not-allowed;}
[data-theme='dark'] .btn-calc:disabled{background:var(--grey-disabled);color:var(--text-disabled);}
.test-chip-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;}
.test-pill{font-size:12px;font-weight:600;color:var(--purple-deep);background:var(--purple-soft);
  border:1px solid var(--line);border-radius:999px;padding:4px 12px;white-space:nowrap;}
[data-theme='dark'] .test-pill{color:var(--purple-deep);background:var(--purple-soft);border-color:var(--purple-bright);}
.test-chip{font-size:12.5px;font-weight:600;color:var(--purple-deep);background:var(--purple-soft);
  border:1px solid var(--line);border-radius:999px;padding:5px 14px;white-space:nowrap;}
[data-theme='dark'] .test-chip{color:var(--purple-deep);background:var(--purple-soft);border-color:var(--purple-bright);}
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
  background:var(--card);font-feature-settings:'tnum' 1;}
.input.select{max-width:320px;}
.rev-file-format-select{max-width:100%;width:100%;}
[data-theme='dark'] .input{background:var(--paper);border-color:var(--line);}
.input:focus-visible{border-color:var(--purple);outline:0;box-shadow:0 0 0 3px var(--purple-soft);}
[data-theme='dark'] .input:focus-visible{border-color:var(--purple-bright);box-shadow:0 0 0 3px var(--purple-soft);}
.input::placeholder{color:var(--muted);font-style:normal;}
.input::-webkit-outer-spin-button,.input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
.input[type=number]{-moz-appearance:textfield;appearance:textfield;}
.input-k{max-width:76px;text-align:center;}
.stepper{display:flex;align-items:center;gap:8px;}
.btn-step{width:40px;height:40px;border-radius:10px;border:1.5px solid var(--line);
  background:var(--card);font-size:20px;cursor:pointer;color:var(--purple);transition:all .15s;}
[data-theme='dark'] .btn-step{color:var(--purple-bright);background:var(--paper);border-color:var(--line);}
.btn-step:hover{border-color:var(--purple);background:rgba(74,55,135,0.08);}
[data-theme='dark'] .btn-step:hover{border-color:var(--purple-bright);background:rgba(255,255,255,0.1);}
.btn-step:disabled{opacity:.35;cursor:not-allowed;}
[data-theme='dark'] .btn-step:disabled{opacity:.2;}
.btn{background:var(--pink);color:#fff;border:0;border-radius:10px;padding:11px 20px;
  font-size:15px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;}
[data-theme='dark'] .btn{background:var(--purple-bright);color:var(--navy);}
.btn:hover{background:var(--pink-deep);}
[data-theme='dark'] .btn:hover{filter:brightness(1.1);}
.upload-row{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0 6px;align-items:center;}
.file-name{font-size:13px;color:var(--muted);}
.outlier-wrap{margin:12px 0 24px;}
.outlier-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.outlier-header .explainer{margin:0;}
.outlier-note{margin:12px 0 24px !important;}
.outlier-note .outlier-header{margin-bottom:8px;}
.check-row{display:flex;gap:9px;align-items:flex-start;font-size:14px;margin-top:8px;cursor:pointer;}
.check-row input{margin-top:3px;width:16px;height:16px;accent-color:var(--pink);}
[data-theme='dark'] .check-row input{accent-color:var(--purple-bright);}
.format-card{border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:6px 0 4px;}
.format-title{font-size:12.5px;font-weight:600;color:var(--muted);background:var(--paper);
  padding:7px 12px;border-bottom:1px solid var(--line);}
[data-theme='dark'] .format-title{background:var(--paper);color:var(--muted);}
.format-pre{margin:0;padding:10px 12px;font-size:13px;line-height:1.6;
  font-family:ui-monospace,Menlo,monospace;color:var(--ink);background:var(--paper);}
[data-theme='dark'] .format-pre{background:var(--paper);color:var(--ink);}

/* variants & allocation */
.arm-row{border-top:1px dashed var(--line);padding-top:14px;margin-top:14px;}
.arm-name{font-size:15px;font-weight:600;margin:0 0 10px;color:var(--navy);display:flex;align-items:center;gap:9px;
  font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;line-height:1.5;}
[data-theme='dark'] .arm-name{color:var(--ink);}
.arm-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
@media (max-width:560px){.arm-grid{grid-template-columns:1fr;gap:8px;}}
.cvr-readout{display:block;padding:10px 0;font-size:15.5px;font-weight:600;}
[data-theme='dark'] .cvr-readout{color:var(--ink);}
.alloc-grid{display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:12px;}
.alloc-cell{min-width:0;}
.alloc-cell .field-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.alloc-cell .input{width:100%;max-width:none;}

/* explainers */
.explainer{position:relative;display:inline-flex;align-items:center;line-height:1;}
.explainer-inline{margin:0 0 0 4px;}
.explainer-toggle{background:none;border:0;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:inherit;font-weight:inherit;color:inherit;text-align:left;}
[data-theme='dark'] .explainer-toggle{color:var(--ink);}
.explainer-label-text{text-decoration:underline dotted var(--muted);text-underline-offset:3px;}
[data-theme='dark'] .explainer-label-text{text-decoration-color:var(--muted);}
.exp-ring{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
  background:var(--purple-soft);border:1px solid var(--line);border-radius:50%;font-size:11px;
  flex:none;color:var(--purple);font-weight:700;line-height:1;margin-top:-1px;padding:0;}
[data-theme='dark'] .exp-ring{background:var(--purple-soft);color:var(--purple-deep);border-color:var(--purple-bright);}
.explainer-body{position:fixed;z-index:1000;background:var(--card);
  border:1px solid var(--line);padding:16px 20px;font-size:14px;border-radius:12px;
  box-shadow:var(--shadow);width:280px;color:var(--ink);text-align:left;
  max-width:calc(100vw - 24px);font-weight:400;line-height:1.6;text-transform:none;}
[data-theme='dark'] .explainer-body{background:var(--card);border-color:var(--line);box-shadow:0 8px 32px rgba(0,0,0,0.8);}
@media (max-width:480px){.explainer-body{width:240px;}}
.exp-title{font-weight:700;margin-bottom:8px;color:var(--navy);font-size:15px;}
[data-theme='dark'] .exp-title{color:var(--purple-bright);}
.exp-lead{margin:0 0 10px;line-height:1.6;font-weight:400;}
[data-theme='dark'] .exp-lead{color:var(--ink);}
.exp-bullets{margin:0 0 10px;padding-left:20px;display:flex;flex-direction:column;gap:6px;line-height:1.6;font-weight:400;}
.exp-bullets li{padding-left:4px;}
.exp-foot{margin:10px 0 0;font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px;line-height:1.5;font-weight:400;}
[data-theme='dark'] .exp-foot{color:var(--muted);}

/* fields */
.field{margin:0 0 20px;}
.field-label-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-weight:600;font-size:13.5px;color:var(--ink);}
[data-theme='dark'] .field-label-row{color:var(--ink);}
.field-label{display:block;font-weight:600;font-size:13.5px;margin:0;}
.field-hint{color:var(--muted);font-size:13.5px;margin:4px 0 8px;max-width:58ch;text-align:left;}
[data-theme='dark'] .field-hint{color:var(--muted);}

/* results */
.stat-row{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0 10px;}
.stat{flex:1;background:var(--paper);border:1px solid var(--line);
  border-radius:12px;padding:14px 16px;min-width:0;word-break:break-word;}
[data-theme='dark'] .stat{background:var(--paper);border-color:var(--line);}
@media (max-width:600px){
  .stat-row{display:grid;grid-template-columns:1fr;gap:10px;}
  .stat{min-width:0;width:100%;padding:12px 10px;}
}
.stat-hero{background:var(--grad);border-color:transparent;color:#fff;}
[data-theme='dark'] .stat-hero{background:var(--purple-bright);color:var(--navy);}
[data-theme='dark'] .stat-hero{background:var(--purple-bright);color:var(--navy);}
.stat-hero .stat-label{color:rgba(255,255,255,.85);}
[data-theme='dark'] .stat-hero .stat-label{color:rgba(0,0,0,0.6);}
[data-theme='dark'] .stat-hero .stat-label{color:rgba(0,0,0,0.7);}
.stat-label{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);margin-bottom:5px;}
[data-theme='dark'] .stat-label{color:var(--muted);}
.stat-num{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:24px;font-weight:600;line-height:1.2;}
[data-theme='dark'] .stat-num{color:var(--ink);}
[data-theme='dark'] .stat-hero .stat-num{color:var(--navy);}
.stat-sub-label{font-size:14px;opacity:0.9;margin-top:2px;}
[data-theme='dark'] .stat-sub-label{color:var(--muted);}
[data-theme='dark'] .stat-hero .stat-sub-label{color:rgba(0,0,0,0.6);}
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
[data-theme='dark'] .chart-caption{color:var(--muted);}
.faq-section{max-width:1080px;margin:40px auto 0;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow);padding:28px 24px;text-align:left;}
[data-theme='dark'] .faq-section{background:var(--card);border-color:var(--line);}
.faq-heading{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:700;font-size:22px;
  margin:0 0 20px;color:var(--navy);letter-spacing:-0.02em;}
[data-theme='dark'] .faq-heading{color:var(--ink);}
.faq-list{display:flex;flex-direction:column;gap:20px;}
.faq-item{border-top:1px solid var(--line);padding-top:18px;}
.faq-item:first-child{border-top:0;padding-top:0;}
.faq-q{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:16px;font-weight:600;
  margin:0 0 8px;color:var(--ink);line-height:1.35;}
[data-theme='dark'] .faq-q{color:var(--purple-bright);}
.faq-a{margin:0;color:var(--muted);font-size:15px;line-height:1.55;max-width:70ch;}
[data-theme='dark'] .faq-a{color:var(--muted);}
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
[data-theme='dark'] .srm-bad{border-color:var(--lose);color:var(--ink);}
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
[data-theme='dark'] .derived-line{color:var(--muted);}
.derived-line strong{color:var(--purple-deep);}
[data-theme='dark'] .derived-line strong{color:var(--purple-bright);}
.rev-top-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;}
.aov-warning{background:var(--warn-bg);border-left:3px solid var(--warn-edge);padding:12px 16px;
  border-radius:0 10px 10px 0;font-size:13.5px;margin:10px 0 16px;color:var(--ink);line-height:1.5;}
[data-theme='dark'] .aov-warning{color:var(--ink);}
.aov-warning strong{color:var(--warn-edge);}
.mismatch-warn{background:#FFF6E8;border-left:3px solid #C97B12;border-radius:0 10px 10px 0;
  padding:10px 13px;font-size:13.5px;margin:8px 0;}
[data-theme='dark'] .mismatch-warn{background:var(--warn-bg);border-color:var(--warn-edge);color:var(--ink);}

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
.multi-file-summary{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:10px;}
.multi-file-summary li{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px;padding:10px 12px;background:var(--paper);border:1px solid var(--line);border-radius:10px;}
.multi-file-summary li strong{font-size:14px;color:var(--ink);}
.multi-file-summary li span{font-size:13px;color:var(--muted);}
.multi-file-summary .field-error,.multi-file-summary .mismatch-warn{width:100%;margin-top:4px;}

@media (prefers-reduced-motion:no-preference){
  .tab:not(.tab-on),.subtab:not(.subtab-on),.btn,.btn-step,.seg-opt:not(.seg-on),.choice-opt:not(.choice-opt-on){
    transition:background .15s,border-color .15s,color .15s,box-shadow .15s;
  }
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

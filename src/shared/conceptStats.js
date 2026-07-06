import { normCdf, normInv } from "./statsCore.js";

/** Normal PDF */
export function normalPdf(x, mu = 0, sd = 1) {
  const z = (x - mu) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/** Type I / II rates for a two-sample proportion z-test (equal n, two-tailed) */
export function typeErrorRates({ baseline, upliftRel, nPerArm, alpha, twoTailed = true }) {
  const p1 = baseline;
  const p2 = baseline * (1 + upliftRel);
  if (!(p1 > 0 && p1 < 1) || nPerArm < 10) return null;

  const se0 = Math.sqrt((2 * p1 * (1 - p1)) / nPerArm);
  const zCrit = twoTailed ? normInv(1 - alpha / 2) : normInv(1 - alpha);
  const typeI = alpha;

  const delta = Math.max(0, p2 - p1);
  const zEffect = se0 > 0 ? delta / se0 : 0;

  let power = 0;
  if (delta > 0) {
    power = twoTailed
      ? normCdf(zEffect - zCrit) + normCdf(-zEffect - zCrit)
      : normCdf(zEffect - zCrit);
  } else {
    power = typeI;
  }

  const typeII = 1 - power;
  return { typeI, typeII, power, zCrit, zEffect, se0, p1, p2, delta };
}

/** Sample z grid for chart paths */
export function normalCurvePoints(mu, sd, lo = -4, hi = 6, steps = 120) {
  const pts = [];
  const step = (hi - lo) / steps;
  for (let i = 0; i <= steps; i++) {
    const x = lo + i * step;
    pts.push({ x, y: normalPdf(x, mu, sd) });
  }
  return pts;
}

import React, { useMemo, useState } from "react";
import ConceptLabLayout from "../shared/ConceptLabLayout.jsx";
import ConceptIntro from "../shared/ConceptIntro.jsx";
import { normalCurvePoints } from "../shared/conceptStats.js";
import {
  proportionSe,
  simulateRateRuns,
  variantLosesShare,
} from "../shared/conceptViz.js";
import { fmtPct, fmtInt } from "../shared/statsCore.js";

function DistributionChart({ p1, p2, se1, se2, runs1, runs2 }) {
  const W = 640;
  const H = 200;
  const pad = { l: 36, r: 16, t: 20, b: 32 };
  const xMin = Math.max(0, Math.min(p1, p2) - Math.max(se1, se2) * 4);
  const xMax = Math.min(0.35, Math.max(p1, p2) + Math.max(se1, se2) * 4);
  const span = xMax - xMin || 0.01;

  const sx = (x) => pad.l + ((x - xMin) / span) * (W - pad.l - pad.r);
  const sy = (y, yMax) => pad.t + (1 - y / yMax) * (H - pad.t - pad.b);

  const pts1 = normalCurvePoints(p1, se1, xMin, xMax, 120);
  const pts2 = normalCurvePoints(p2, se2, xMin, xMax, 120);
  const yMax = Math.max(0.01, ...pts1.map((p) => p.y), ...pts2.map((p) => p.y));
  const baseY = sy(0, yMax);

  const line = (pts) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y, yMax).toFixed(1)}`).join(" ");

  const overlapPath = () => {
    const merged = pts1.map((p, i) => ({
      x: p.x,
      y: Math.min(p.y, pts2[i]?.y ?? 0),
    }));
    const seg = merged.filter((p) => p.y > 0);
    if (seg.length < 2) return "";
    let d = `M ${sx(seg[0].x).toFixed(1)} ${baseY.toFixed(1)}`;
    seg.forEach((p) => { d += ` L ${sx(p.x).toFixed(1)} ${sy(p.y, yMax).toFixed(1)}`; });
    d += ` L ${sx(seg[seg.length - 1].x).toFixed(1)} ${baseY.toFixed(1)} Z`;
    return d;
  };

  const dotY = (i, total) => H - pad.b + 4 + (i % 3) * 5;

  return (
    <svg className="cv-line-chart cv-dist-chart" viewBox={`0 0 ${W} ${H + 28}`} role="img"
      aria-label="Bell curves showing spread of possible conversion rates for control and variant">
      <path d={overlapPath()} className="cv-dist-overlap" />
      <path d={line(pts1)} className="cv-dist-curve-control" fill="none" />
      <path d={line(pts2)} className="cv-dist-curve-variant" fill="none" />
      <line x1={sx(p1)} x2={sx(p1)} y1={pad.t} y2={H - pad.b} className="cv-dist-mean-line" />
      <line x1={sx(p2)} x2={sx(p2)} y1={pad.t} y2={H - pad.b} className="cv-dist-mean-line variant" />
      <text x={sx(p1)} y={pad.t - 4} textAnchor="middle" className="cv-dist-mean-label">Control</text>
      <text x={sx(p2)} y={pad.t - 4} textAnchor="middle" className="cv-dist-mean-label variant">Variant</text>
      <text x={pad.l} y={H - 6} className="cv-axis-label">{fmtPct(xMin, 1)}</text>
      <text x={W - pad.r} y={H - 6} textAnchor="end" className="cv-axis-label">{fmtPct(xMax, 1)}</text>
      <text x={W / 2} y={H - 6} textAnchor="middle" className="cv-axis-label">Possible conversion rate if you re-ran the test</text>

      {runs1.map((r, i) => (
        <circle key={`c-${i}`} cx={sx(r)} cy={dotY(i, runs1.length)} r={2.5} className="cv-dist-dot control" />
      ))}
      {runs2.map((r, i) => (
        <circle key={`v-${i}`} cx={sx(r)} cy={dotY(i, runs2.length) + 14} r={2.5} className="cv-dist-dot variant" />
      ))}
      <text x={pad.l} y={H + 22} className="cv-dist-dots-caption">Each dot = one repeat of the test (same true rates, new visitors)</text>
    </svg>
  );
}

export default function DistributionsPlayground({ theme, toggleTheme }) {
  const [basePct, setBasePct] = useState(5);
  const [upliftPct, setUpliftPct] = useState(15);
  const [nPerArm, setNPerArm] = useState(2000);
  const [seed] = useState(11);

  const p1 = basePct / 100;
  const p2 = p1 * (1 + upliftPct / 100);
  const se1 = proportionSe(p1, nPerArm);
  const se2 = proportionSe(p2, nPerArm);

  const runs1 = useMemo(() => simulateRateRuns(seed, p1, nPerArm), [seed, p1, nPerArm]);
  const runs2 = useMemo(() => simulateRateRuns(seed + 1, p2, nPerArm), [seed, p1, p2, nPerArm]);
  const loseShare = useMemo(
    () => variantLosesShare(seed + 2, p1, p2, nPerArm),
    [seed, p1, p2, nPerArm],
  );

  const overlapHigh = loseShare > 0.25;

  return (
    <ConceptLabLayout
      theme={theme}
      toggleTheme={toggleTheme}
      title="Distributions"
      subtitle="One A/B test gives you one number. A distribution describes all the numbers you could have gotten if you ran it again."
      breadcrumbs={
        <>
          <a href="#/">Main calculator</a> / <a href="#/concepts">Learn the concepts</a> / Distributions
        </>
      }
    >
      <div className="det-demo">
        <ConceptIntro
          heading="What is a distribution?"
          lede="Visitors do not behave identically — neither do samples. If you re-ran the same experiment with fresh traffic, the conversion rate would wobble around a true value. A distribution is the shape of that wobble."
          cards={[
            {
              title: "Centre of the spread",
              body: "The peak is the most likely outcome — close to the true conversion rate for that arm.",
            },
            {
              title: "Width of the spread",
              body: "More visitors → narrower spread → less wobble. Few visitors → wide spread → lucky or unlucky runs look very different.",
            },
          ]}
          footnote="Grey is control, purple is variant. Where the bells overlap, repeat runs often look too close to call. Move the sliders to narrow or separate the curves."
        />

        <h2 className="det-try-heading">Try it</h2>
        <section className="det-board">
          <div className="det-dock">
            <div className="det-dock-item">
              <label htmlFor="dist-base">
                Control conversion rate
                <span className="det-dock-val">{basePct.toFixed(1)}%</span>
              </label>
              <input id="dist-base" type="range" min={2} max={15} step={0.5} value={basePct}
                onChange={(e) => setBasePct(Number(e.target.value))} />
            </div>
            <div className="det-dock-item">
              <label htmlFor="dist-uplift">
                True variant uplift
                <span className="det-dock-val">{upliftPct}%</span>
              </label>
              <input id="dist-uplift" type="range" min={0} max={40} step={1} value={upliftPct}
                onChange={(e) => setUpliftPct(Number(e.target.value))} />
            </div>
            <div className="det-dock-item">
              <label htmlFor="dist-n">
                Visitors per variant
                <span className="det-dock-val">{fmtInt(nPerArm)}</span>
              </label>
              <input id="dist-n" type="range" min={200} max={20000} step={200} value={nPerArm}
                onChange={(e) => setNPerArm(Number(e.target.value))} />
              <p className="det-dock-hint">More visitors → narrower bells</p>
            </div>
          </div>

          <div className="cv-stat-row">
            <div className="cv-stat">
              <span className="cv-stat-label">True rates</span>
              <span className="cv-stat-num cv-stat-num-sm">{fmtPct(p1, 1)} → {fmtPct(p2, 1)}</span>
            </div>
            <div className={`cv-stat ${overlapHigh ? "cv-stat-warn" : ""}`}>
              <span className="cv-stat-label">Re-runs where variant looks no better</span>
              <span className="cv-stat-num">{fmtPct(loseShare, 0)}</span>
            </div>
          </div>

          <DistributionChart p1={p1} p2={p2} se1={se1} se2={se2} runs1={runs1} runs2={runs2} />

          <p className="clab-summary">
            With {fmtInt(nPerArm)} visitors per arm, control might land around {fmtPct(p1, 1)} (±{fmtPct(se1 * 2, 1)}
            {" "}typical wobble) and variant around {fmtPct(p2, 1)}. Shaded overlap is where repeat runs look
            similar — about {fmtPct(loseShare, 0)} of re-runs would not show variant ahead of control.
            {overlapHigh ? " That overlap is why you need enough traffic before trusting a winner." : " The curves are fairly separated — a test is more likely to spot the lift."}
          </p>
        </section>
      </div>
    </ConceptLabLayout>
  );
}

import React, { useMemo, useState } from "react";
import ConceptLabLayout from "../shared/ConceptLabLayout.jsx";
import ConceptIntro from "../shared/ConceptIntro.jsx";
import { generateBernoulliSequence } from "../shared/conceptViz.js";
import { fmtPct } from "../shared/statsCore.js";

function RunningChart({ flips, pTrue, nShow }) {
  const visible = flips.slice(0, nShow);
  const W = 640;
  const H = 160;
  const pad = { l: 36, r: 12, t: 16, b: 28 };
  const yTrue = pTrue;

  const path = visible
    .map((pt, i) => {
      const x = pad.l + (i / Math.max(1, nShow - 1)) * (W - pad.l - pad.r);
      const y = pad.t + (1 - pt.running / 0.25) * (H - pad.t - pad.b);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${Math.min(H - pad.b, Math.max(pad.t, y)).toFixed(1)}`;
    })
    .join(" ");

  const yTrueLine = pad.t + (1 - yTrue / 0.25) * (H - pad.t - pad.b);

  return (
    <svg className="cv-line-chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label="Running conversion rate approaching true rate">
      <line x1={pad.l} x2={W - pad.r} y1={yTrueLine} y2={yTrueLine} className="cv-line-true" strokeDasharray="4 4" />
      <text x={W - pad.r} y={yTrueLine - 4} textAnchor="end" className="cv-line-true-label">
        True rate {fmtPct(pTrue, 0)}
      </text>
      {visible.length > 1 && <path d={path} className="cv-line-running" fill="none" />}
      <text x={pad.l} y={H - 6} className="cv-axis-label">0 visitors</text>
      <text x={W - pad.r} y={H - 6} textAnchor="end" className="cv-axis-label">{nShow} visitors</text>
    </svg>
  );
}

export default function LawOfLargeNumbers({ theme, toggleTheme }) {
  const [seed, setSeed] = useState(99);
  const [nShow, setNShow] = useState(50);

  const { flips, pTrue } = useMemo(() => generateBernoulliSequence(seed), [seed]);
  const current = flips[nShow - 1];
  const err = Math.abs(current.running - pTrue);

  return (
    <ConceptLabLayout
      theme={theme}
      toggleTheme={toggleTheme}
      title="Law of large numbers"
      subtitle="Small samples bounce around. More data pulls the observed rate toward the true rate."
      breadcrumbs={
        <>
          <a href="#/">Main calculator</a> / <a href="#/concepts">Learn the concepts</a> / Law of large numbers
        </>
      }
    >
      <div className="det-demo">
        <ConceptIntro
          heading="What is the law of large numbers?"
          lede="Flip a biased coin or measure conversion on a page — the first few tries can look wildly high or low. Keep collecting observations and the average settles near the true rate."
          cards={[
            {
              title: "Small sample",
              body: "With 20 visitors you might see 0% or 15% even when the true rate is 10%. Noise looks like a trend.",
            },
            {
              title: "Large sample",
              body: "With thousands of visitors the running rate hugs the true line. That is why A/B tests need enough traffic.",
            },
          ]}
          footnote="The sequence below is fixed — only how many visitors you include changes. Slide to add more and watch the line calm down."
        />

        <h2 className="det-try-heading">Try it</h2>
        <section className="det-board">
          <div className="det-slider-block">
            <p className="det-slider-prompt">How many visitors have you observed so far?</p>
            <div className="det-slider-row">
              <input
                id="lln-n"
                type="range"
                min={10}
                max={2000}
                step={10}
                value={nShow}
                onChange={(e) => setNShow(Number(e.target.value))}
                className="det-slider"
              />
              <output className="det-slider-pct" htmlFor="lln-n">{nShow.toLocaleString()}</output>
            </div>
            <div className="det-slider-ends">
              <span>10 — very jumpy</span>
              <span>2,000 — much steadier</span>
            </div>
          </div>

          <div className="cv-stat-row">
            <div className="cv-stat">
              <span className="cv-stat-label">Observed rate so far</span>
              <span className="cv-stat-num">{fmtPct(current.running, 1)}</span>
            </div>
            <div className="cv-stat">
              <span className="cv-stat-label">Gap from true rate</span>
              <span className="cv-stat-num">{fmtPct(err, 1)}</span>
            </div>
          </div>

          <RunningChart flips={flips} pTrue={pTrue} nShow={nShow} />

          <p className="clab-summary">
            After {nShow.toLocaleString()} visitors the observed rate is {fmtPct(current.running, 1)}; the true
            rate is {fmtPct(pTrue, 0)}. {err < 0.01 ? "They are very close now." : "Keep sliding right to close the gap."}
          </p>

          <button type="button" className="det-resample-btn" onClick={() => setSeed((s) => s + 1)}>
            Shuffle new visitor sequence
          </button>
        </section>
      </div>
    </ConceptLabLayout>
  );
}

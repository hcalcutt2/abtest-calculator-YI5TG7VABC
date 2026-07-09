import React, { useMemo, useState } from "react";
import ConceptLabLayout from "../shared/ConceptLabLayout.jsx";
import ConceptIntro from "../shared/ConceptIntro.jsx";
import { classifyPower, generatePowerPopulation, typeErrorRates } from "../shared/conceptViz.js";
import { fmtPct, fmtInt } from "../shared/statsCore.js";

function PowerGrid({ classified }) {
  return (
    <div className="det-grid-wrap">
      <div className="det-grid" role="img" aria-label="Items coloured by whether the test detected a real lift">
        {classified.map((item) => (
          <span
            key={item.id}
            className={`det-cell cv-power-cell cv-power-${item.outcome}`}
            title={item.outcome}
          >
            <span className="visually-hidden">{item.outcome}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function StatPowerPlayground({ theme, toggleTheme }) {
  const [seed, setSeed] = useState(3);
  const [surePct, setSurePct] = useState(95);
  const [upliftPct, setUpliftPct] = useState(10);
  const [nPerArm, setNPerArm] = useState(10000);

  const items = useMemo(() => generatePowerPopulation(seed), [seed]);
  const { classified, detected, missed, nPos } = useMemo(
    () => classifyPower(items, surePct),
    [items, surePct],
  );

  const baseline = 0.05;
  const alpha = (100 - surePct) / 100;
  const upliftRel = upliftPct / 100;
  const planned = useMemo(
    () => typeErrorRates({ baseline, upliftRel, nPerArm, alpha, twoTailed: true }),
    [baseline, upliftRel, nPerArm, alpha],
  );
  const powerPct = planned?.power ?? 0;

  return (
    <ConceptLabLayout
      theme={theme}
      toggleTheme={toggleTheme}
      title="Statistical power"
      subtitle="Statistical power, minimum detectable effect (MDE), and sample size — the chance your test spots a real conversion rate or revenue lift before test duration runs out."
      breadcrumbs={
        <>
          <a href="#/">Main calculator</a> / <a href="#/concepts">Learn the concepts</a> / Statistical power
        </>
      }
    >
      <div className="det-demo">
        <ConceptIntro
          heading="What is statistical power?"
          lede="Power answers: if the variant really lifts conversion, RPV, or engagement, how often will your test notice it? Low power means real winners sit in “no result” while you wait for more traffic."
          cards={[
            {
              tone: "ok",
              title: "High power",
              body: "Enough visitors and a clear lift on conversion or revenue → the test usually catches the winner.",
              example: "You ship a checkout change that truly helps instead of abandoning it.",
            },
            {
              tone: "type2",
              title: "Low power",
              body: "Too few sessions or a tiny bounce/RPV lift → the test often says “inconclusive” even when the variant helps.",
              example: "That is a missed winner (Type II error).",
            },
          ]}
          footnote="Purple dots are real lifts on 25 of 100 metrics (conversion, clicks, time on page, etc.). Move the sliders — the same dots stay put; only whether the test calls them changes."
        />

        <h2 className="det-try-heading">Try it</h2>
        <section className="det-board">
          <div className="cv-stat-row cv-stat-row-power">
            <div className="cv-stat cv-stat-power">
              <span className="cv-stat-label">Power (detect real lifts)</span>
              <span className="cv-stat-num">{fmtPct(powerPct, 0)}</span>
            </div>
            <div className="cv-stat">
              <span className="cv-stat-label">Detected / missed (of {nPos} real)</span>
              <span className="cv-stat-num cv-stat-num-sm">{detected} / {missed}</span>
            </div>
          </div>

          <ul className="det-legend">
            <li className="det-legend-item det-legend-hit"><span className="det-legend-swatch" /> Detected</li>
            <li className="det-legend-item det-legend-miss"><span className="det-legend-swatch" /> Missed (Type II)</li>
            <li className="det-legend-item det-legend-pass"><span className="det-legend-swatch" /> No real lift</li>
          </ul>

          <PowerGrid classified={classified} />

          <div className="det-dock">
            <div className="det-dock-item">
              <label htmlFor="pwr-sure">
                Says yes only when at least this sure
                <span className="det-dock-val">{surePct}%</span>
              </label>
              <input id="pwr-sure" type="range" min={90} max={99} value={surePct}
                onChange={(e) => setSurePct(Number(e.target.value))} />
              <p className="det-dock-hint">Higher bar → fewer detections (more misses)</p>
            </div>
            <div className="det-dock-item">
              <label htmlFor="pwr-n">
                Visitors per variant (planning)
                <span className="det-dock-val">{fmtInt(nPerArm)}</span>
              </label>
              <input id="pwr-n" type="range" min={500} max={50000} step={500} value={nPerArm}
                onChange={(e) => setNPerArm(Number(e.target.value))} />
              <p className="det-dock-hint">Used in summary; grid uses evidence scores for intuition</p>
            </div>
            <div className="det-dock-item">
              <label htmlFor="pwr-uplift">
                True uplift you want to catch
                <span className="det-dock-val">{upliftPct}%</span>
              </label>
              <input id="pwr-uplift" type="range" min={5} max={30} value={upliftPct}
                onChange={(e) => setUpliftPct(Number(e.target.value))} />
            </div>
          </div>

          <p className="clab-summary">
            Planning context: baseline {fmtPct(baseline, 0)}, target uplift {upliftPct}%, {fmtInt(nPerArm)} visitors
            per variant → about {fmtPct(powerPct, 0)} power. The grid shows how many of {nPos} fixed “real lifts”
            clear a {surePct}% sure bar ({detected} detected, {missed} missed).{" "}
            <a href="#/concepts/type-errors">See Type I &amp; II errors</a> for false alarms vs misses.
          </p>

          <button type="button" className="det-resample-btn" onClick={() => setSeed((s) => s + 1)}>
            Shuffle new 100 items
          </button>
        </section>
      </div>
    </ConceptLabLayout>
  );
}

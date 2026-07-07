import React, { useMemo, useState } from "react";
import ConceptLabLayout from "../shared/ConceptLabLayout.jsx";
import ConceptIntro from "../shared/ConceptIntro.jsx";
import { falseWinnerRisk, generateNullTests } from "../shared/conceptViz.js";
import { fmtPct } from "../shared/statsCore.js";

export default function PHackingPlayground({ theme, toggleTheme }) {
  const [seed, setSeed] = useState(7);
  const [numTests, setNumTests] = useState(5);

  const allTests = useMemo(() => generateNullTests(seed), [seed]);
  const active = allTests.slice(0, numTests);
  const falseWinners = active.filter((t) => t.calledWinner);
  const risk = falseWinnerRisk(numTests);

  return (
    <ConceptLabLayout
      theme={theme}
      toggleTheme={toggleTheme}
      title="P-hacking"
      subtitle="Testing again and again until something looks like a winner — even when nothing changed."
      breadcrumbs={
        <>
          <a href="#/">Main calculator</a> / <a href="#/concepts">Learn the concepts</a> / P-hacking
        </>
      }
    >
      <div className="det-demo">
        <ConceptIntro
          heading="What is p-hacking?"
          lede="P-hacking is checking conversion, then bounce, then RPV, then time on page, then every CTA click — until one metric looks like a win by luck. The variant did nothing; you just kept slicing the data until noise looked exciting."
          cards={[
            {
              tone: "type1",
              title: "One metric at 95% confidence",
              body: "If the variant truly changed nothing, there is still about a 1-in-20 chance that single conversion or bounce test looks significant.",
              example: "That is one false winner waiting to ship.",
            },
            {
              tone: "type2",
              title: "Many metrics on the same experiment",
              body: "Each extra metric — orders, scroll depth, element clicks — is another lottery ticket. The chance of at least one false winner grows fast.",
              example: "Ten metrics can push the risk toward 40%, not 5%.",
            },
          ]}
          footnote="Below, every row is a different analytics metric on the same A/B test where control and variant truly match. Add more metrics and watch false winners appear."
        />

        <h2 className="det-try-heading">Try it</h2>
        <section className="det-board">
          <div className="det-slider-block">
            <p className="det-slider-prompt">How many separate metrics do you test on the same experiment?</p>
            <div className="det-slider-row">
              <input
                id="phack-n"
                type="range"
                min={1}
                max={20}
                step={1}
                value={numTests}
                onChange={(e) => setNumTests(Number(e.target.value))}
                className="det-slider"
              />
              <output className="det-slider-pct" htmlFor="phack-n">{numTests} {numTests === 1 ? "metric" : "metrics"}</output>
            </div>
            <div className="det-slider-ends">
              <span>1 metric</span>
              <span>20 metrics</span>
            </div>
          </div>

          <div className="cv-stat-row">
            <div className="cv-stat cv-stat-warn">
              <span className="cv-stat-label">False winners this run</span>
              <span className="cv-stat-num">{falseWinners.length}</span>
            </div>
            <div className="cv-stat">
              <span className="cv-stat-label">Chance of ≥1 false winner (math)</span>
              <span className="cv-stat-num">{fmtPct(risk, 0)}</span>
            </div>
          </div>

          <div className="cv-phack-grid" role="list" aria-label="Metric comparison results">
            {active.map((t) => (
              <div
                key={t.id}
                role="listitem"
                className={`cv-phack-chip ${t.calledWinner ? "cv-phack-chip-winner" : ""}`}
              >
                <span className="cv-phack-chip-id">{t.metric}</span>
                <span className="cv-phack-chip-rates">
                  {(t.rate1 * 100).toFixed(1)}% vs {(t.rate2 * 100).toFixed(1)}%
                </span>
                <span className="cv-phack-chip-verdict">
                  {t.calledWinner ? "False winner (luck)" : "No winner"}
                </span>
              </div>
            ))}
          </div>

          <p className="clab-summary">
            {falseWinners.length === 0
              ? `None of these ${numTests} metrics crossed the line — but with more metrics checked, a false winner usually shows up.`
              : `${falseWinners.length} ${falseWinners.length === 1 ? "metric" : "metrics"} would have shipped a change that did nothing.`}
          </p>

          <button type="button" className="det-resample-btn" onClick={() => setSeed((s) => s + 1)}>
            Shuffle new random data
          </button>
        </section>
      </div>
    </ConceptLabLayout>
  );
}

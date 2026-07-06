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
          lede="P-hacking is running many checks — extra metrics, subgroups, or peeks at the data — until one looks like a win by luck alone. There was never a real lift; you just kept looking until noise looked exciting."
          cards={[
            {
              tone: "type1",
              title: "One test at 95% confidence",
              body: "If nothing really changed, there is still about a 1-in-20 chance that single test looks like a winner.",
              example: "That is one false alarm waiting to happen.",
            },
            {
              tone: "type2",
              title: "Many tests on the same data",
              body: "Each extra look is another lottery ticket. The chance of at least one false winner grows fast even when the variant does nothing.",
              example: "Ten looks can push the risk toward 40%, not 5%.",
            },
          ]}
          footnote="Below, every comparison is a fair coin flip in disguise — control and variant truly match. Move the slider to add more looks and watch false winners appear."
        />

        <h2 className="det-try-heading">Try it</h2>
        <section className="det-board">
          <div className="det-slider-block">
            <p className="det-slider-prompt">How many separate comparisons do you run on the same experiment?</p>
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
              <output className="det-slider-pct" htmlFor="phack-n">{numTests} {numTests === 1 ? "look" : "looks"}</output>
            </div>
            <div className="det-slider-ends">
              <span>1 look</span>
              <span>20 looks</span>
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

          <div className="cv-phack-grid" role="list" aria-label="Comparison results">
            {active.map((t) => (
              <div
                key={t.id}
                role="listitem"
                className={`cv-phack-chip ${t.calledWinner ? "cv-phack-chip-winner" : ""}`}
              >
                <span className="cv-phack-chip-id">Look {t.id + 1}</span>
                <span className="cv-phack-chip-rates">
                  {(t.rate1 * 100).toFixed(1)}% vs {(t.rate2 * 100).toFixed(1)}%
                </span>
                <span className="cv-phack-chip-verdict">
                  {t.calledWinner ? "Called a winner (luck)" : "No winner"}
                </span>
              </div>
            ))}
          </div>

          <p className="clab-summary">
            {falseWinners.length === 0
              ? `None of these ${numTests} looks crossed the line — but with more looks, a false winner usually shows up.`
              : `${falseWinners.length} ${falseWinners.length === 1 ? "look" : "looks"} would have shipped a change that did nothing.`}
          </p>

          <button type="button" className="det-resample-btn" onClick={() => setSeed((s) => s + 1)}>
            Shuffle new random data
          </button>
        </section>
      </div>
    </ConceptLabLayout>
  );
}

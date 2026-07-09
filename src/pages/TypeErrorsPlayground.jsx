import React, { useMemo, useState } from "react";
import ConceptLabLayout from "../shared/ConceptLabLayout.jsx";
import {
  BASE_RATE,
  POPULATION_SIZE,
  classifyPopulation,
  generatePopulation,
  scoreHistogram,
} from "../shared/detectorDemo.js";
import { OUTCOME_META, OUTCOME_ORDER, SCENARIOS } from "../shared/detectorScenarios.js";

function DetectorIntro() {
  return (
    <section className="det-intro" aria-labelledby="det-intro-heading">
      <h2 id="det-intro-heading" className="det-intro-heading">What are Type I and Type II errors?</h2>
      <p className="det-intro-lede">
        Any time analytics forces a yes/no call — ship an A/B winner, flag high bounce, report an engagement
        drop — you can get the answer wrong in two different ways.
      </p>
      <div className="det-intro-cards">
        <div className="det-intro-card det-intro-card-type1">
          <h3 className="det-intro-card-title">Type I error — false alarm</h3>
          <p className="det-intro-card-text">
            You said <strong>yes</strong> (ship, alert, report a problem), but nothing real was there.
            You acted on noise.
          </p>
          <p className="det-intro-card-example">Example: you ship a “winning” variant, but conversion was flat.</p>
        </div>
        <div className="det-intro-card det-intro-card-type2">
          <h3 className="det-intro-card-title">Type II error — miss</h3>
          <p className="det-intro-card-text">
            You said <strong>no</strong> (hold, stay quiet), but a real lift or issue was there.
            You missed something that mattered.
          </p>
          <p className="det-intro-card-example">Example: bounce really spiked, but your alert threshold was too strict.</p>
        </div>
      </div>
      <p className="det-intro-tradeoff">
        You cannot make both mistakes rare at once. Require more certainty before shipping or alerting and
        false alarms drop — but real winners and real problems slip through. Move the slider on the same
        100 checks to see that trade-off.
      </p>
    </section>
  );
}

function ItemIcon({ type }) {
  if (type === "chart") {
    return (
      <svg className="det-icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="9" width="2.5" height="4.5" rx=".4" fill="currentColor" opacity="0.45" />
        <rect x="6.75" y="6" width="2.5" height="7.5" rx=".4" fill="currentColor" opacity="0.7" />
        <rect x="11" y="3.5" width="2.5" height="10" rx=".4" fill="currentColor" />
      </svg>
    );
  }
  if (type === "bounce") {
    return (
      <svg className="det-icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3" y="3" width="7" height="9" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <path d="M11 8h2.5M12.25 8L10.5 6.25M12.25 8L10.5 9.75" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "engage") {
    return (
      <svg className="det-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <path d="M8 5v3.5l2 1.2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="det-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="9" width="2.5" height="4.5" rx=".4" fill="currentColor" opacity="0.45" />
      <rect x="6.75" y="6" width="2.5" height="7.5" rx=".4" fill="currentColor" opacity="0.7" />
      <rect x="11" y="3.5" width="2.5" height="10" rx=".4" fill="currentColor" />
    </svg>
  );
}

function ScoreStrip({ items, cutoff, scenarioId }) {
  const hist = useMemo(() => scoreHistogram(items), [items, cutoff]);
  const maxCount = Math.max(1, ...hist.bins.map((b) => b.neg + b.pos));
  const cutoffX = ((hist.cutoff - hist.lo) / (hist.hi - hist.lo)) * 100;

  return (
    <div className="det-strip" aria-hidden="true">
      <p className="det-strip-label">
        Why mistakes happen: each {SCENARIOS.find((s) => s.id === scenarioId)?.itemNoun ?? "item"} has hidden
        evidence (gray = not really yes, purple tint = really yes). The vertical line is your “say yes” bar.
      </p>
      <div className="det-strip-chart">
        <div className="det-strip-bins">
          {hist.bins.map((bin, i) => {
            const hNeg = (bin.neg / maxCount) * 100;
            const hPos = (bin.pos / maxCount) * 100;
            return (
              <div key={i} className="det-strip-bin">
                <div className="det-strip-bar det-strip-bar-pos" style={{ height: `${hPos}%` }} />
                <div className="det-strip-bar det-strip-bar-neg" style={{ height: `${hNeg}%` }} />
              </div>
            );
          })}
        </div>
        <div className="det-strip-cutoff" style={{ left: `${cutoffX}%` }} title="Say-yes bar" />
      </div>
      <div className="det-strip-axis">
        <span>Weaker evidence for yes</span>
        <span>Stronger evidence for yes</span>
      </div>
    </div>
  );
}

function DetectorGrid({ classified, scenario, onHoverOutcome }) {
  return (
    <div className="det-grid-wrap">
      <div
        className="det-grid"
        role="img"
        aria-label={`Grid of ${POPULATION_SIZE} ${scenario.itemNoun}s coloured by detector outcome`}
      >
      {classified.map((item) => {
        const meta = OUTCOME_META[item.outcome];
        const info = scenario.outcomes[item.outcome];
        return (
          <button
            key={item.id}
            type="button"
            className={`det-cell det-cell-${meta.css} ${meta.isError ? "det-cell-error" : ""}`}
            title={`${info.label}: ${info.short}`}
            onMouseEnter={() => onHoverOutcome(item.outcome)}
            onMouseLeave={() => onHoverOutcome(null)}
            onFocus={() => onHoverOutcome(item.outcome)}
            onBlur={() => onHoverOutcome(null)}
          >
            <ItemIcon type={scenario.itemIcon} />
            <span className="visually-hidden">{info.label}</span>
          </button>
        );
      })}
      </div>
    </div>
  );
}

function ErrorCard({ card, count, tone }) {
  return (
    <div className={`det-error-card det-error-card-${tone}`}>
      <div className="det-error-card-head">
        <span className="det-error-card-title">{card.title}</span>
        <span className="det-error-card-gloss">{card.gloss}</span>
      </div>
      <div className="det-error-card-count">{count}</div>
      <p className="det-error-card-example">{card.example(count)}</p>
    </div>
  );
}

function ScreenReaderSummary({ scenario, counts, surePct, cutoff }) {
  return (
    <div className="visually-hidden" aria-live="polite" aria-atomic="true">
      {scenario.title}. {BASE_RATE} of {POPULATION_SIZE} items are truly yes.
      Detector says yes only when at least {surePct} percent sure.
      {counts.falseAlarm} false alarms (Type I): {scenario.type1Card.example(counts.falseAlarm)}.
      {counts.miss} misses (Type II): {scenario.type2Card.example(counts.miss)}.
      {counts.hit} hits and {counts.correctPass} correct passes.
      Say-yes evidence bar at {cutoff.toFixed(2)}.
    </div>
  );
}

export default function TypeErrorsPlayground({ theme, toggleTheme }) {
  const [scenarioId, setScenarioId] = useState("winner");
  const [seed, setSeed] = useState(42);
  const [surePct, setSurePct] = useState(50);
  const [hoverOutcome, setHoverOutcome] = useState(null);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  const population = useMemo(() => generatePopulation(seed), [seed]);

  const { classified, cutoff, counts } = useMemo(
    () => classifyPopulation(population, surePct),
    [population, surePct],
  );

  const resample = () => setSeed((s) => s + 1);

  return (
    <ConceptLabLayout
      theme={theme}
      toggleTheme={toggleTheme}
      title="Type I and Type II errors"
      subtitle="Type I error (false winner) vs Type II error (missed lift) — how confidence level and statistical power trade off when you reject the null hypothesis."
      breadcrumbs={
        <>
          <a href="#/">Main calculator</a> / <a href="#/concepts">Learn the concepts</a> / Type I &amp; II errors
        </>
      }
    >
      <div className="det-demo">
        <DetectorIntro />

        <h2 className="det-try-heading">Try it: pick a scenario</h2>
        <div className="det-scenario-tabs" role="tablist" aria-label="Choose a scenario">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={scenarioId === s.id}
              className={`det-scenario-tab ${scenarioId === s.id ? "det-scenario-tab-on" : ""}`}
              onClick={() => setScenarioId(s.id)}
            >
              {s.title}
            </button>
          ))}
        </div>

        <p className="det-tagline">{scenario.tagline}</p>
        <p className="det-base-rate">{scenario.baseRateNote}</p>

        <section className="det-board" aria-labelledby="det-slider-label">
          <div className="det-slider-block">
            <p id="det-slider-label" className="det-slider-prompt">{scenario.sliderPrompt}</p>
            <div className="det-slider-row">
              <input
                id="det-sure-slider"
                type="range"
                min={5}
                max={95}
                step={1}
                value={surePct}
                onChange={(e) => setSurePct(Number(e.target.value))}
                className="det-slider"
                aria-labelledby="det-slider-label"
                aria-valuetext={`${surePct} percent sure`}
              />
              <output className="det-slider-pct" htmlFor="det-sure-slider">{surePct}% sure</output>
            </div>
            <div className="det-slider-ends">
              <span>5% — {scenario.sliderLow}</span>
              <span>95% — {scenario.sliderHigh}</span>
            </div>
          </div>

          <ul className="det-legend" aria-label="Outcome colours">
            {OUTCOME_ORDER.map((key) => (
              <li
                key={key}
                className={`det-legend-item det-legend-${OUTCOME_META[key].css} ${hoverOutcome === key ? "det-legend-on" : ""}`}
              >
                <span className="det-legend-swatch" aria-hidden="true" />
                {OUTCOME_META[key].legend}
              </li>
            ))}
          </ul>

          <DetectorGrid classified={classified} scenario={scenario} onHoverOutcome={setHoverOutcome} />

          <ScoreStrip items={population} cutoff={cutoff} scenarioId={scenarioId} />

          <div className="det-error-row">
            <ErrorCard card={scenario.type1Card} count={counts.falseAlarm} tone="type1" />
            <ErrorCard card={scenario.type2Card} count={counts.miss} tone="type2" />
          </div>

          <div className="det-actions">
            <button type="button" className="det-resample-btn" onClick={resample}>
              Shuffle new 100 {scenario.itemNoun}s
            </button>
            <p className="det-bridge-note">
              In formal statistics, Type I is a false alarm and Type II is a miss. In analytics: a false winner
              shipped, a bounce spike ignored, an engagement drop missed. Require more certainty before acting
              and false alarms fall — but real lifts and real problems get through. Only 20 of 100 are truly
              “yes” here, so false alarms pile up when the bar is low.
            </p>
          </div>
        </section>

        <ScreenReaderSummary scenario={scenario} counts={counts} surePct={surePct} cutoff={cutoff} />
      </div>
    </ConceptLabLayout>
  );
}

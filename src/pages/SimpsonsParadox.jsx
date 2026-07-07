import React, { useMemo, useState } from "react";
import ConceptLabLayout from "../shared/ConceptLabLayout.jsx";
import ConceptIntro from "../shared/ConceptIntro.jsx";
import { SIMPSON_SEGMENTS, rate, simpsonTotals } from "../shared/conceptViz.js";
import { fmtPct } from "../shared/statsCore.js";

function RateBar({ label, r, tone, highlight }) {
  const pct = r * 100;
  return (
    <div className={`cv-bar-row ${highlight ? "cv-bar-row-hi" : ""}`}>
      <span className="cv-bar-label">{label}</span>
      <div className="cv-bar-track">
        <div className={`cv-bar-fill cv-bar-${tone}`} style={{ width: `${Math.min(100, pct * 2.5)}%` }} />
      </div>
      <span className="cv-bar-val">{fmtPct(r, 1)}</span>
    </div>
  );
}

export default function SimpsonsParadox({ theme, toggleTheme }) {
  const [split, setSplit] = useState(true);

  const totals = useMemo(() => simpsonTotals(SIMPSON_SEGMENTS), []);
  const controlOverall = rate(totals.control);
  const variantOverall = rate(totals.variant);
  const controlWinsOverall = controlOverall > variantOverall;

  return (
    <ConceptLabLayout
      theme={theme}
      toggleTheme={toggleTheme}
      title="Simpson's paradox"
      subtitle="The headline conversion rate can disagree with mobile and desktop — because traffic mix matters."
      breadcrumbs={
        <>
          <a href="#/">Main calculator</a> / <a href="#/concepts">Learn the concepts</a> / Simpson&apos;s paradox
        </>
      }
    >
      <div className="det-demo">
        <ConceptIntro
          heading="What is Simpson's paradox?"
          lede="You split results by device and control wins on both mobile and desktop conversion — but pool everyone together and the headline flips. It is not magic: desktop carries most traffic, so its numbers dominate the total."
          cards={[
            {
              title: "Split by device",
              body: "Compare control vs variant conversion separately for mobile sessions and desktop sessions.",
            },
            {
              title: "Headline (pooled) rate",
              body: "Merge all visitors into one conversion rate — that single number can point the opposite way from both splits.",
            },
          ]}
          footnote="Toggle the view below. Control wins both device segments, but variant wins combined because most sessions are desktop, where variant had more room to grow."
        />

        <h2 className="det-try-heading">Try it</h2>
        <section className="det-board">
          <div className="cv-toggle-row">
            <button
              type="button"
              className={`det-scenario-tab ${split ? "det-scenario-tab-on" : ""}`}
              aria-pressed={split}
              onClick={() => setSplit(true)}
            >
              Split by device
            </button>
            <button
              type="button"
              className={`det-scenario-tab ${!split ? "det-scenario-tab-on" : ""}`}
              aria-pressed={!split}
              onClick={() => setSplit(false)}
            >
              Combined total
            </button>
          </div>

          {split ? (
            <div className="cv-simpson-split">
              {SIMPSON_SEGMENTS.map((seg) => {
                const rc = rate(seg.control);
                const rv = rate(seg.variant);
                const controlWins = rc > rv;
                return (
                  <div key={seg.id} className="cv-simpson-panel">
                    <h3 className="cv-simpson-panel-title">{seg.label}</h3>
                    <RateBar label="Control" r={rc} tone="control" highlight={controlWins} />
                    <RateBar label="Variant" r={rv} tone="variant" highlight={!controlWins} />
                    <p className="cv-simpson-verdict">
                      {controlWins ? "Control wins here" : "Variant wins here"}
                      {" · "}
                      {seg.control.conv}/{seg.control.visitors} vs {seg.variant.conv}/{seg.variant.visitors}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cv-simpson-combined">
              <RateBar label="Control (all visitors)" r={controlOverall} tone="control" highlight={controlWinsOverall} />
              <RateBar label="Variant (all visitors)" r={variantOverall} tone="variant" highlight={!controlWinsOverall} />
              <p className="cv-simpson-verdict">
                {controlWinsOverall ? "Control wins combined" : "Variant wins combined"}
                {" · "}
                {totals.control.conv}/{totals.control.visitors} vs {totals.variant.conv}/{totals.variant.visitors}
              </p>
            </div>
          )}

          <p className="clab-summary">
            Split: control wins mobile ({fmtPct(rate(SIMPSON_SEGMENTS[0].control), 0)} vs{" "}
            {fmtPct(rate(SIMPSON_SEGMENTS[0].variant), 0)}). Variant wins desktop (
            {fmtPct(rate(SIMPSON_SEGMENTS[1].variant), 0)} vs {fmtPct(rate(SIMPSON_SEGMENTS[1].control), 0)}).
            Combined: variant wins ({fmtPct(variantOverall, 1)} vs {fmtPct(controlOverall, 1)}) — most visitors
            are on desktop, so that segment drives the headline.
          </p>
        </section>
      </div>
    </ConceptLabLayout>
  );
}

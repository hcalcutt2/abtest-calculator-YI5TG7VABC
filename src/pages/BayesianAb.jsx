import React, { useMemo, useState } from "react";
import { Field, PageShell, ScenarioBox, WarningList } from "../shared/gds.jsx";
import { probVariantBetter } from "../shared/advancedStats.js";
import { fmtPct, fmtSignedPct } from "../shared/statsCore.js";

function PriorField({ label, a, b, setA, setB }) {
  return (
    <Field label={label} hint="Beta(α, β) prior. Use α=1, β=1 for uniform; α=1, β=1 with pseudo-counts for weakly informative.">
      <div style={{ display: "flex", gap: 10 }}>
        <input className="input" type="number" min={0.1} step={0.1} value={a}
          onChange={(e) => setA(Number(e.target.value))} aria-label={`${label} alpha`} />
        <input className="input" type="number" min={0.1} step={0.1} value={b}
          onChange={(e) => setB(Number(e.target.value))} aria-label={`${label} beta`} />
      </div>
    </Field>
  );
}

export default function BayesianAbPage({ theme, toggleTheme }) {
  const [usingPrior, setUsingPrior] = useState(null);
  const [priorCa, setPriorCa] = useState(1);
  const [priorCb, setPriorCb] = useState(1);
  const [priorVa, setPriorVa] = useState(1);
  const [priorVb, setPriorVb] = useState(1);
  const [cSucc, setCSucc] = useState(400);
  const [cTrials, setCTrials] = useState(10000);
  const [vSucc, setVSucc] = useState(430);
  const [vTrials, setVTrials] = useState(10000);

  const result = useMemo(() => {
    if (cTrials <= 0 || vTrials <= 0 || cSucc < 0 || vSucc < 0) return null;
    if (cSucc > cTrials || vSucc > vTrials) return null;
    return probVariantBetter(
      { a: priorCa, b: priorCb },
      { a: priorVa, b: priorVb },
      cSucc, cTrials, vSucc, vTrials,
    );
  }, [priorCa, priorCb, priorVa, priorVb, cSucc, cTrials, vSucc, vTrials]);

  const prob = result?.prob ?? null;
  const strong = prob != null && (prob >= 0.95 || prob <= 0.05);

  return (
    <PageShell
      title="Bayesian A/B test calculator"
      subtitle="Estimate the probability the variant is better, combining prior beliefs with observed conversions."
      theme={theme}
      toggleTheme={toggleTheme}
      breadcrumbs={<> <a href="#/">Main calculator</a> / <a href="#/advanced">Advanced tools</a> / Bayesian</>}
    >
      <section className="panel prior-gate" aria-labelledby="prior-gate-h">
        <h2 id="prior-gate-h" className="panel-title">Are you using a prior?</h2>
        <div className="prior-gate-row" role="group" aria-label="Are you using a prior?">
          <button type="button"
            className={`prior-gate-btn ${usingPrior === true ? "prior-gate-btn-on" : ""}`}
            aria-pressed={usingPrior === true}
            onClick={() => setUsingPrior(true)}>
            Yes
          </button>
          <button type="button"
            className={`prior-gate-btn ${usingPrior === false ? "prior-gate-btn-on" : ""}`}
            aria-pressed={usingPrior === false}
            onClick={() => setUsingPrior(false)}>
            No
          </button>
        </div>
      </section>

      {usingPrior === false && (
        <section className="panel prior-gate-no" aria-live="polite">
          <p className="prior-gate-statement">Bayesian without a prior is just frequentist.</p>
          <p className="field-hint">
            Use the <a href="#/">main calculator</a> for standard significance and confidence intervals.
          </p>
        </section>
      )}

      {usingPrior === true && (
        <>
      <ScenarioBox title="Use this when…">
        <p>
          You want a <strong>probability statement</strong> ("87% chance variant beats control") rather than a
          p-value against a fixed null. Useful when you have prior knowledge (historical tests, industry benchmarks)
          or stakeholders ask "how likely is a win?" instead of "is p &lt; 0.05?"
        </p>
        <p>
          This uses a Beta-Binomial model for binary conversion. It is not the same as the frequentist test
          in the main calculator and the two can disagree.
        </p>
      </ScenarioBox>

      <WarningList
        items={[
          "The prior matters, especially with small samples. A strong prior can dominate early data. Always sensitivity-test priors.",
          "P(variant > control) is not a p-value. There is no universal 95% threshold; decide what probability is actionable for your business.",
          "Optional stopping and peeking are less problematic in Bayesian frameworks, but priors and decision rules still need pre-registration.",
          "Beta-Binomial assumes independent Bernoulli trials. User-level clustering or one-user-many-orders violates this.",
          "Do not pick the prior after seeing results to force a favourable probability.",
        ]}
      />

      <div className="two-col">
        <section className="panel">
          <h2 className="panel-title">Priors &amp; data</h2>
          <PriorField label="Control prior Beta(α, β)" a={priorCa} b={priorCb} setA={setPriorCa} setB={setPriorCb} />
          <PriorField label="Variant prior Beta(α, β)" a={priorVa} b={priorVb} setA={setPriorVa} setB={setPriorVb} />
          <Field label="Control conversions" htmlFor="bc-s">
            <input id="bc-s" className="input" type="number" min={0} value={cSucc} onChange={(e) => setCSucc(Number(e.target.value))} />
          </Field>
          <Field label="Control visitors" htmlFor="bc-n">
            <input id="bc-n" className="input" type="number" min={1} value={cTrials} onChange={(e) => setCTrials(Number(e.target.value))} />
          </Field>
          <Field label="Variant conversions" htmlFor="bv-s">
            <input id="bv-s" className="input" type="number" min={0} value={vSucc} onChange={(e) => setVSucc(Number(e.target.value))} />
          </Field>
          <Field label="Variant visitors" htmlFor="bv-n">
            <input id="bv-n" className="input" type="number" min={1} value={vTrials} onChange={(e) => setVTrials(Number(e.target.value))} />
          </Field>
        </section>

        <section className="panel results">
          <h2 className="panel-title">Posterior summary</h2>
          {result ? (
            <>
              <div className="test-chip-row">
                <div className={`test-pill ${strong ? "test-pill-win" : ""}`}>
                  P(variant &gt; control) = {fmtPct(prob, 1)}
                </div>
              </div>
              <div className="stat-row">
                <div className="stat">
                  <div className="stat-label">Control posterior mean</div>
                  <div className="stat-num">{fmtPct(result.postC.mean, 2)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Variant posterior mean</div>
                  <div className="stat-num">{fmtPct(result.postV.mean, 2)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Relative uplift 95% CrI</div>
                  <div className="stat-num">{fmtSignedPct(result.relCiLo)} to {fmtSignedPct(result.relCiHi)}</div>
                </div>
              </div>
              <div className="playground-callout">
                {prob >= 0.95
                  ? "Posterior strongly favours the variant given your prior and data. Confirm the prior reflects genuine pre-test beliefs."
                  : prob <= 0.05
                    ? "Posterior strongly favours control. Check whether the prior was too optimistic for the variant."
                    : prob >= 0.5
                      ? "Variant is more likely than not to win, but uncertainty remains. More data or a narrower prior may be needed for a firm decision."
                      : "Control is more likely than not better. The variant is not supported by current data and prior."}
              </div>
            </>
          ) : (
            <p className="empty">Enter valid conversion counts within visitor totals.</p>
          )}
        </section>
      </div>
        </>
      )}
    </PageShell>
  );
}

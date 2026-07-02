import React, { useMemo, useState } from "react";
import { Field, PageShell, ScenarioBox, WarningList } from "../shared/gds.jsx";
import { poissonRateTest } from "../shared/advancedStats.js";
import { fmtNum, fmtP, fmtPct, fmtSignedPct } from "../shared/statsCore.js";

function NumInput({ label, hint, value, onChange, min = 0, step = 1 }) {
  const id = React.useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input id={id} className="input" type="number" min={min} step={step}
        value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

export default function PoissonMeansPage({ theme, toggleTheme }) {
  const [cEvents, setCEvents] = useState(42);
  const [cExposure, setCExposure] = useState(10000);
  const [vEvents, setVEvents] = useState(51);
  const [vExposure, setVExposure] = useState(10000);
  const [alphaPct, setAlphaPct] = useState(5);

  const result = useMemo(() => {
    return poissonRateTest(cEvents, cExposure, vEvents, vExposure, alphaPct / 100, true);
  }, [cEvents, cExposure, vEvents, vExposure, alphaPct]);

  return (
    <PageShell
      title="Poisson means test"
      subtitle="Compare event rates when outcomes are counts per exposure unit."
      theme={theme}
      toggleTheme={toggleTheme}
      breadcrumbs={<> <a href="#/">Main calculator</a> / <a href="#/advanced">Advanced tools</a> / Poisson means</>}
    >
      <ScenarioBox title="Use this when…">
        <p>
          Your metric is a <strong>count per unit of exposure</strong>, not a binary conversion. Examples:
          support tickets per 1,000 users, API errors per million requests, orders per 100 sessions,
          or clinical adverse events per patient-year.
        </p>
        <p>
          Use the main conversion-rate calculator when each visitor either converts or does not.
          Use this tool when events can happen zero, one, or many times per unit, and you have an exposure denominator.
        </p>
      </ScenarioBox>

      <WarningList
        items={[
          "Assumes events are independent and the rate is constant over the exposure window. Clustered or seasonal spikes break the model.",
          "Exposure must be measured on the same scale for both arms. Mixing different exposure definitions invalidates the comparison.",
          "Overdispersion (variance higher than Poisson predicts) makes p-values too optimistic. Consider negative-binomial methods if counts are bursty.",
          "Very small expected counts (&lt; 5 per arm) make normal approximations unreliable.",
          "If exposure differs systematically between arms (not just random), you may be comparing unlike populations.",
        ]}
      />

      <div className="two-col">
        <section className="panel">
          <h2 className="panel-title">Control (A)</h2>
          <NumInput label="Events" hint="Total count of events in control." value={cEvents} onChange={setCEvents} />
          <NumInput label="Exposure" hint="Denominator: sessions, user-days, requests, etc." value={cExposure} onChange={setCExposure} />
          <h2 className="panel-title" style={{ marginTop: 20 }}>Variant (B)</h2>
          <NumInput label="Events" value={vEvents} onChange={setVEvents} />
          <NumInput label="Exposure" value={vExposure} onChange={setVExposure} />
          <Field label="Confidence level (%)" htmlFor="pois-alpha">
            <input id="pois-alpha" className="input" type="number" min={90} max={99} step={1}
              value={alphaPct} onChange={(e) => setAlphaPct(Number(e.target.value))} />
          </Field>
        </section>

        <section className="panel results">
          <h2 className="panel-title">Rate comparison</h2>
          {result ? (
            <>
              <div className="test-chip-row">
                <div className={`test-pill ${result.pRaw < alphaPct / 100 ? "test-pill-win" : ""}`}>
                  {result.pRaw < alphaPct / 100 ? "Significant" : "Not significant"}
                </div>
                <div className="test-pill">p = {fmtP(result.pRaw)}</div>
              </div>
              <div className="stat-row">
                <div className="stat">
                  <div className="stat-label">Control rate</div>
                  <div className="stat-num">{fmtNum(result.r1, 4)}</div>
                  <div className="stat-sub-label">{cEvents} / {cExposure}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Variant rate</div>
                  <div className="stat-num">{fmtNum(result.r2, 4)}</div>
                  <div className="stat-sub-label">{vEvents} / {vExposure}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Relative uplift</div>
                  <div className="stat-num">{fmtSignedPct(result.relUplift)}</div>
                </div>
              </div>
              <p className="derived-line">
                Absolute rate difference {100 - alphaPct}% CI: {fmtNum(result.ciLo, 4)} to {fmtNum(result.ciHi, 4)} per exposure unit
              </p>
              <div className="playground-callout">
                {result.pRaw < alphaPct / 100
                  ? `The variant rate differs from control at the ${100 - alphaPct}% level. Check whether the exposure units match and whether overdispersion could explain a noisy count.`
                  : `No significant rate difference at ${100 - alphaPct}% confidence. Low counts or high variance may mean you are underpowered.`}
              </div>
            </>
          ) : (
            <p className="empty">Enter valid non-negative counts and positive exposure.</p>
          )}
        </section>
      </div>
    </PageShell>
  );
}

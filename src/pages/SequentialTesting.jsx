import React, { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Field, PageShell, ScenarioBox, WarningList } from "../shared/gds.jsx";
import { obrienFlemingBoundaries, pocockBoundary } from "../shared/advancedStats.js";
import { fmtNum, fmtP } from "../shared/statsCore.js";

function RangeField({ label, hint, value, onChange, min, max, step, display }) {
  const id = React.useId();
  const fmt = display || String;
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="playground-range">
        <input id={id} type="range" className="playground-range-input"
          min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))} />
        <output className="playground-range-val">{fmt(value)}</output>
      </div>
    </Field>
  );
}

export default function SequentialTestingPage({ theme, toggleTheme }) {
  const [looks, setLooks] = useState(4);
  const [alphaPct, setAlphaPct] = useState(5);
  const [method, setMethod] = useState("obf");
  const [currentLook, setCurrentLook] = useState(2);
  const [observedZ, setObservedZ] = useState(2.1);

  const alpha = alphaPct / 100;
  const lookFractions = useMemo(() => {
    const arr = [];
    for (let k = 1; k <= looks; k++) arr.push(k / looks);
    return arr;
  }, [looks]);

  const boundaries = useMemo(() => {
    const fn = method === "obf" ? obrienFlemingBoundaries : pocockBoundary;
    return fn(lookFractions, alpha);
  }, [lookFractions, alpha, method]);

  const chartData = boundaries.map((b, i) => ({
    look: i + 1,
    zUpper: b.z,
    zLower: -b.z,
    infoFrac: Math.round(b.t * 100),
  }));

  const active = boundaries[currentLook - 1];
  const canStopEfficacy = observedZ >= active?.z;
  const canStopFutility = observedZ <= -active?.z;

  return (
    <PageShell
      title="Sequential testing calculator"
      subtitle="Plan interim looks for sequential sampling — stop early with efficacy boundaries without inflating Type I error on the null hypothesis."
      theme={theme}
      toggleTheme={toggleTheme}
      breadcrumbs={<> <a href="#/">Main calculator</a> / <a href="#/advanced">Advanced tools</a> / Sequential testing</>}
    >
      <ScenarioBox title="Use this when…">
        <p>
          You plan to check results before the full sample size is reached and may <strong>stop early</strong> if
          the variant is clearly winning or clearly losing. Typical examples: regulated experiments, long-running
          tests where early stopping saves traffic, or programmes with a formal interim analysis schedule.
        </p>
        <p>
          <strong>Do not use this</strong> if you peek whenever you feel like it without pre-planned boundaries.
          That inflates false positives even if you apply a correction after the fact.
        </p>
      </ScenarioBox>

      <WarningList
        items={[
          "Interim looks must be planned before the test starts. Ad-hoc peeking and then applying sequential boundaries does not fix the false-positive rate.",
          "Stopping early for efficacy can overstate the true effect size (winner's curse). Always report the sample size at stopping.",
          "These boundaries are approximate (O'Brien-Fleming / Pocock style). Your platform or biostat team may use different spending functions.",
          "If you stop for futility, you may miss a late-arriving effect. Sequential designs trade speed against power.",
          "Revenue, multiple variants, and changing traffic mix need different sequential methods than a simple conversion z-test shown here.",
        ]}
      />

      <div className="two-col">
        <section className="panel">
          <h2 className="panel-title">Design inputs</h2>
          <Field label="Boundary method" hint="O'Brien-Fleming is conservative early; Pocock uses a constant threshold.">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="obf">O'Brien-Fleming (conservative early)</option>
              <option value="pocock">Pocock (equal threshold)</option>
            </select>
          </Field>
          <RangeField label="Planned interim looks" value={looks} onChange={setLooks}
            min={2} max={8} step={1} display={(v) => `${v} looks`} />
          <RangeField label="Overall alpha (two-sided %)" value={alphaPct} onChange={setAlphaPct}
            min={1} max={10} step={0.5} display={(v) => `${v}%`} />
          <RangeField label="Current look number" value={currentLook} onChange={setCurrentLook}
            min={1} max={looks} step={1} display={(v) => `Look ${v}`} />
          <RangeField label="Observed z-statistic at this look" value={observedZ} onChange={setObservedZ}
            min={-4} max={4} step={0.05} display={(v) => fmtNum(v, 2)} />
        </section>

        <section className="panel results">
          <h2 className="panel-title">Interim decision</h2>
          {active && (
            <>
              <div className="test-chip-row">
                <div className={`test-pill ${canStopEfficacy ? "test-pill-win" : ""}`}>
                  {canStopEfficacy ? "Crosses efficacy boundary" : "Not significant yet"}
                </div>
                {canStopFutility && <div className="test-pill">Crosses futility boundary</div>}
              </div>
              <div className="stat-row">
                <div className="stat">
                  <div className="stat-label">Boundary z at look {currentLook}</div>
                  <div className="stat-num">±{fmtNum(active.z, 3)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Nominal p at boundary</div>
                  <div className="stat-num">{fmtP(active.p)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Information fraction</div>
                  <div className="stat-num">{Math.round(active.t * 100)}%</div>
                </div>
              </div>
              <div className="playground-callout">
                {canStopEfficacy
                  ? `Observed z = ${fmtNum(observedZ, 2)} exceeds the efficacy boundary (+${fmtNum(active.z, 2)}). Under this pre-planned design you could stop for efficacy. Confirm with your analysis plan before acting.`
                  : canStopFutility
                    ? `Observed z is below the lower boundary. You might stop for futility, but confirm the effect you still care about is ruled out.`
                    : `Observed z = ${fmtNum(observedZ, 2)} is inside the boundaries (±${fmtNum(active.z, 2)}). Continue to the next look or final analysis.`}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <h2 className="panel-title">Efficacy boundaries over looks</h2>
        <p className="field-hint">Upper and lower z thresholds at each pre-planned look. Stay inside the funnel until a boundary is crossed.</p>
        <div className="chart-wrap" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="2 4" />
              <XAxis dataKey="look" label={{ value: "Look", position: "insideBottom", offset: -2 }} />
              <YAxis label={{ value: "z boundary", angle: -90, position: "insideLeft" }} />
              <Tooltip formatter={(v) => fmtNum(v, 3)} />
              <ReferenceLine y={0} stroke="#999" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="zUpper" stroke="#5B2A86" strokeWidth={2.5} dot name="Upper" />
              <Line type="monotone" dataKey="zLower" stroke="#DC004A" strokeWidth={2.5} dot name="Lower" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </PageShell>
  );
}

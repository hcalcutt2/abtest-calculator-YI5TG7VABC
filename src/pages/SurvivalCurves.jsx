import React, { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Field, PageShell, ScenarioBox, WarningList } from "../shared/gds.jsx";
import { kaplanMeier, logRankTest } from "../shared/advancedStats.js";
import { fmtP, fmtPct } from "../shared/statsCore.js";

const DEFAULT_INTERVALS = [
  { day: 7, cAtRisk: 1000, cEvents: 120, vAtRisk: 1000, vEvents: 95 },
  { day: 14, cAtRisk: 880, cEvents: 85, vAtRisk: 905, vEvents: 70 },
  { day: 30, cAtRisk: 795, cEvents: 150, vAtRisk: 835, vEvents: 110 },
  { day: 60, cAtRisk: 645, cEvents: 200, vAtRisk: 725, vEvents: 165 },
];

export default function SurvivalCurvesPage({ theme, toggleTheme }) {
  const [intervals, setIntervals] = useState(DEFAULT_INTERVALS);

  const update = (idx, key, val) => {
    setIntervals((rows) => rows.map((r, i) => (i === idx ? { ...r, [key]: Number(val) } : r)));
  };

  const controlRows = intervals.map((r) => ({ time: r.day, atRisk: r.cAtRisk, events: r.cEvents }));
  const variantRows = intervals.map((r) => ({ time: r.day, atRisk: r.vAtRisk, events: r.vEvents }));

  const kmC = useMemo(() => kaplanMeier(controlRows), [controlRows]);
  const kmV = useMemo(() => kaplanMeier(variantRows), [variantRows]);
  const lr = useMemo(() => logRankTest(intervals), [intervals]);

  const chartData = intervals.map((r, i) => ({
    day: r.day,
    control: kmC[i + 1]?.survival ?? 1,
    variant: kmV[i + 1]?.survival ?? 1,
  }));

  const sig = lr.pRaw != null && lr.pRaw < 0.05;

  return (
    <PageShell
      title="Survival curves calculator"
      subtitle="Compare time-to-event outcomes with Kaplan-Meier survival estimates."
      theme={theme}
      toggleTheme={toggleTheme}
      breadcrumbs={<> <a href="#/">Main calculator</a> / <a href="#/advanced">Advanced tools</a> / Survival curves</>}
    >
      <ScenarioBox title="Use this when…">
        <p>
          Your outcome is <strong>time until an event</strong>: churn, first purchase, activation, or failure.
          Visitors enter at different times and may leave the test before the event (censoring).
        </p>
        <p>
          Enter interval summaries (at-risk counts and events between checkpoints). This is a simplified
          planning view, not a full individual-level survival analysis.
        </p>
      </ScenarioBox>

      <WarningList
        items={[
          "Survival methods assume independent censoring: people who drop out early are not systematically different from those who stay.",
          "The log-rank test assumes proportional hazards (the hazard ratio is roughly constant over time). If curves cross, p-values can mislead.",
          "Binned interval data loses detail. Production analysis should use user-level timestamps.",
          "Stopping when survival curves look separated mid-test inflates false positives unless you pre-plan sequential survival monitoring.",
          "Competing risks (e.g. upgrade vs churn) need specialised models, not a simple two-group KM curve.",
        ]}
      />

      <section className="panel">
        <h2 className="panel-title">Interval data</h2>
        <p className="field-hint">For each checkpoint: days since test start, users still at risk, and events since the last checkpoint.</p>
        <div className="detail-table-wrap">
          <table className="detail-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Control at risk</th>
                <th>Control events</th>
                <th>Variant at risk</th>
                <th>Variant events</th>
              </tr>
            </thead>
            <tbody>
              {intervals.map((row, i) => (
                <tr key={i}>
                  <td><input className="input" type="number" value={row.day} onChange={(e) => update(i, "day", e.target.value)} /></td>
                  <td><input className="input" type="number" value={row.cAtRisk} onChange={(e) => update(i, "cAtRisk", e.target.value)} /></td>
                  <td><input className="input" type="number" value={row.cEvents} onChange={(e) => update(i, "cEvents", e.target.value)} /></td>
                  <td><input className="input" type="number" value={row.vAtRisk} onChange={(e) => update(i, "vAtRisk", e.target.value)} /></td>
                  <td><input className="input" type="number" value={row.vEvents} onChange={(e) => update(i, "vEvents", e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col" style={{ marginTop: 18 }}>
        <section className="panel results">
          <h2 className="panel-title">Log-rank style check</h2>
          <div className="test-chip-row">
            <div className={`test-pill ${sig ? "test-pill-win" : ""}`}>
              {sig ? "Curves differ (p &lt; 0.05)" : "No clear separation"}
            </div>
            <div className="test-pill">χ² = {lr.chi?.toFixed(3) ?? "—"}</div>
            <div className="test-pill">p = {fmtP(lr.pRaw)}</div>
          </div>
          <div className="stat-row">
            <div className="stat">
              <div className="stat-label">Control survival @ last day</div>
              <div className="stat-num">{fmtPct(kmC[kmC.length - 1]?.survival, 1)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Variant survival @ last day</div>
              <div className="stat-num">{fmtPct(kmV[kmV.length - 1]?.survival, 1)}</div>
            </div>
          </div>
          <div className="playground-callout">
            {sig
              ? "Survival curves diverge by the log-rank approximation. Check whether hazards are proportional and whether censoring is balanced across arms."
              : "Curves are not significantly different at 95%. Longer follow-up or more events may be needed."}
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">Kaplan-Meier survival</h2>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="2 4" />
                <XAxis dataKey="day" unit="d" />
                <YAxis domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip formatter={(v) => fmtPct(v, 1)} />
                <Legend />
                <Line type="stepAfter" dataKey="control" stroke="#9A93A8" strokeWidth={2.5} dot name="Control" />
                <Line type="stepAfter" dataKey="variant" stroke="#5B2A86" strokeWidth={2.5} dot name="Variant" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </PageShell>
  );
}

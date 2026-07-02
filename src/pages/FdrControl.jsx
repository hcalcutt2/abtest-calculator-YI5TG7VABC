import React, { useMemo, useState } from "react";
import { Field, PageShell, ScenarioBox, WarningList } from "../shared/gds.jsx";
import { benjaminiHochberg } from "../shared/advancedStats.js";
import { fmtP, fmtPct } from "../shared/statsCore.js";

const DEFAULT_P = "0.04\n0.12\n0.008\n0.31\n0.02\n0.18\n0.001\n0.45";

export default function FdrControlPage({ theme, toggleTheme }) {
  const [raw, setRaw] = useState(DEFAULT_P);
  const [qPct, setQPct] = useState(10);

  const parsed = useMemo(() => {
    const pvals = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((p) => Number.isFinite(p) && p >= 0 && p <= 1);
    return pvals;
  }, [raw]);

  const result = useMemo(() => {
    if (parsed.length === 0) return null;
    return benjaminiHochberg(parsed, qPct / 100);
  }, [parsed, qPct]);

  return (
    <PageShell
      title="FDR / TDR calculator"
      subtitle="Control the false discovery rate when testing many hypotheses at once."
      theme={theme}
      toggleTheme={toggleTheme}
      breadcrumbs={<> <a href="#/">Main calculator</a> / <a href="#/advanced">Advanced tools</a> / FDR &amp; TDR</>}
    >
      <ScenarioBox title="Use this when…">
        <p>
          You run <strong>many comparisons in one experiment</strong>: dozens of metrics, segments, funnel steps,
          or variants. Family-wise correction (Bonferroni / Holm) is very conservative; FDR control (Benjamini-Hochberg)
          limits the <em>expected proportion</em> of discoveries that are false positives.
        </p>
        <p>
          <strong>FDR</strong> (false discovery rate): among results you call significant, what fraction might be flukes?<br />
          <strong>TDR</strong> (true discovery rate): under ideal assumptions, roughly 1 − FDR of rejections may be real effects.
        </p>
      </ScenarioBox>

      <WarningList
        items={[
          "Benjamini-Hochberg assumes p-values are independent or positively dependent. Highly correlated metrics (e.g. revenue and orders) make FDR control less reliable.",
          "FDR control does not guarantee any single result is true. It controls errors across the family on average.",
          "Do not run many tests, pick the lowest p-value, then apply FDR retroactively. The family must be defined upfront.",
          "TDR estimates here are illustrative. Real power depends on effect sizes you cannot observe for null metrics.",
          "For a small number of pre-specified primary metrics, prefer Holm-Bonferroni (used in the main calculator) over FDR.",
        ]}
      />

      <div className="two-col">
        <section className="panel">
          <h2 className="panel-title">P-values</h2>
          <Field label="One p-value per line (or comma-separated)" hint="Enter all tests in the family, not just significant ones.">
            <textarea className="input textarea-input" value={raw} onChange={(e) => setRaw(e.target.value)} rows={8} />
          </Field>
          <Field label="FDR level q (%)" htmlFor="fdr-q">
            <input id="fdr-q" className="input" type="number" min={5} max={20} step={1}
              value={qPct} onChange={(e) => setQPct(Number(e.target.value))} />
          </Field>
          <p className="field-hint">{parsed.length} valid p-value{parsed.length === 1 ? "" : "s"} parsed.</p>
        </section>

        <section className="panel results">
          <h2 className="panel-title">Benjamini-Hochberg</h2>
          {result ? (
            <>
              <div className="stat-row">
                <div className="stat stat-hero">
                  <div className="stat-label">Rejected at FDR {qPct}%</div>
                  <div className="stat-num">{result.numRejected}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Illustrative TDR</div>
                  <div className="stat-num">{result.tdrEstimate != null ? fmtPct(result.tdrEstimate, 0) : "—"}</div>
                </div>
              </div>
              <div className="detail-table-wrap">
                <table className="detail-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Raw p</th>
                      <th>Adjusted p</th>
                      <th>Reject?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((p, i) => (
                      <tr key={i} className={result.rejected[i] ? "row-active" : ""}>
                        <td>{i + 1}</td>
                        <td>{fmtP(p)}</td>
                        <td>{fmtP(result.adj[i])}</td>
                        <td>{result.rejected[i] ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="playground-callout">
                {result.numRejected > 0
                  ? `${result.numRejected} hypothesis${result.numRejected === 1 ? "" : "es"} pass BH-FDR at ${qPct}%. Treat these as candidates for follow-up, not guaranteed wins.`
                  : `Nothing passes at FDR ${qPct}%. Either effects are weak or the family of tests is too large for your sample size.`}
              </div>
            </>
          ) : (
            <p className="empty">Enter at least one valid p-value between 0 and 1.</p>
          )}
        </section>
      </div>
    </PageShell>
  );
}

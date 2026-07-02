import React from "react";
import { PageShell, ScenarioBox, WarningList } from "../shared/gds.jsx";
import { ADVANCED_TOOLS } from "../shared/advancedTools.js";

export default function AdvancedHub({ theme, toggleTheme }) {
  return (
    <PageShell
      title="Advanced calculators"
      subtitle="Standalone tools for specialised A/B testing scenarios. Each calculator explains when to use it, what it assumes, and where it can mislead you."
      theme={theme}
      toggleTheme={toggleTheme}
      breadcrumbs={<><a href="#/">Main calculator</a> / Advanced tools</>}
    >
      <ScenarioBox title="When to use these instead of the main calculator">
        <p>
          The main Eclipse calculator covers standard conversion-rate and revenue tests with fixed sample sizes
          and frequentist significance. Use the tools below when your question does not fit that mould:
          you need interim stopping rules, count data with exposure, time-to-event outcomes, many simultaneous
          comparisons, or a probability-based readout.
        </p>
        <p>
          These are educational and planning aids. They are not a substitute for a pre-registered analysis plan
          or review with your experimentation team.
        </p>
      </ScenarioBox>

      <WarningList
        items={[
          "Advanced methods have stronger assumptions than a simple two-proportion test. If assumptions fail, results can look precise but be wrong.",
          "Peeking, optional stopping, and testing many metrics all increase false-positive risk unless the design accounts for it upfront.",
          "Always decide the method before you look at results. Switching methods after seeing data invalidates the guarantees.",
          "If in doubt, stick with the main calculator and a fixed-horizon test.",
        ]}
      />

      <div className="adv-grid">
        {ADVANCED_TOOLS.map((tool) => (
          <a key={tool.path} href={`#${tool.path}`} className="adv-card">
            <span className="adv-card-tag">{tool.tag}</span>
            <h2 className="adv-card-title">{tool.title}</h2>
            <p className="adv-card-desc">{tool.desc}</p>
          </a>
        ))}
      </div>
    </PageShell>
  );
}

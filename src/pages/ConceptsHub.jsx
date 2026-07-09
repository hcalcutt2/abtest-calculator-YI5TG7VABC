import React from "react";
import ConceptLabLayout from "../shared/ConceptLabLayout.jsx";
import { CONCEPT_TOOLS } from "../shared/conceptTools.js";

export default function ConceptsHub({ theme, toggleTheme }) {
  return (
    <ConceptLabLayout
      theme={theme}
      toggleTheme={toggleTheme}
      title="Learn A/B testing concepts"
      subtitle="Interactive guides on statistical power, Type I and Type II errors, p-values, null hypothesis, MDE, and distributions — build intuition beyond the main sample size and significance calculators."
      breadcrumbs={<><a href="#/">Main calculator</a> / Learn the concepts</>}
    >
      <div className="clab-hub-grid">
        {CONCEPT_TOOLS.map((tool) => (
          <a key={tool.path} href={`#${tool.path}`} className="clab-hub-card">
            <span className="clab-hub-tag">{tool.tag}</span>
            <h2>{tool.title}</h2>
            <p>{tool.desc}</p>
          </a>
        ))}
      </div>
    </ConceptLabLayout>
  );
}

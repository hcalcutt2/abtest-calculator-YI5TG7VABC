import React from "react";
import ConceptLabLayout from "../shared/ConceptLabLayout.jsx";
import { CONCEPT_TOOLS } from "../shared/conceptTools.js";

export default function ConceptsHub({ theme, toggleTheme }) {
  return (
    <ConceptLabLayout
      theme={theme}
      toggleTheme={toggleTheme}
      title="Learn the concepts"
      subtitle="Interactive visual explainers — not calculators. Play with the graphics and build intuition for how testing actually works."
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

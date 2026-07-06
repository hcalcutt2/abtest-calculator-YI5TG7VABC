import React from "react";
import { ADVANCED_CSS, EclipseWordmark, ThemeToggle } from "./gds.jsx";
import "../pages/concept-lab.css";

export default function ConceptLabLayout({
  title,
  subtitle,
  breadcrumbs,
  children,
  theme,
  toggleTheme,
}) {
  return (
    <div className="app adv-app clab-app">
      <style>{ADVANCED_CSS}</style>
      <header className="masthead">
        <div className="mast-inner">
          <EclipseWordmark />
          <nav className="adv-nav" aria-label="Site">
            <a href="#/" className="adv-nav-link">Main calculator</a>
            <a href="#/concepts" className="adv-nav-link">Learn concepts</a>
            <a href="#/advanced" className="adv-nav-link">Advanced tools</a>
          </nav>
          <div style={{ marginLeft: "auto" }}>
            <ThemeToggle theme={theme} toggle={toggleTheme} />
          </div>
        </div>
        {breadcrumbs && <div className="breadcrumbs">{breadcrumbs}</div>}
        {(title || subtitle) && (
          <div className="intro clab-intro">
            {title && <h1 className="page-title clab-title">{title}</h1>}
            {subtitle && <p className="intro-text clab-subtitle">{subtitle}</p>}
          </div>
        )}
      </header>
      <main className="clab-main">{children}</main>
    </div>
  );
}

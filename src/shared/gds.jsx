import React, { useEffect, useState } from "react";

export function useHashRoute() {
  const [route, setRoute] = useState(() => normalizeRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(normalizeRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

function normalizeRoute(hash) {
  const raw = (hash || "").replace(/^#/, "") || "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function navigate(path) {
  window.location.hash = path.startsWith("/") ? path : `/${path}`;
}

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("eclipse-theme");
      if (saved) return saved;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("eclipse-theme", theme);
  }, [theme]);
  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  return { theme, toggle };
}

/** Stop scroll wheel changing focused number/range inputs; blur on browser tab switch */
export function useStableNumericInputs() {
  useEffect(() => {
    const onWheel = (e) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && (el.type === "number" || el.type === "range")
          && document.activeElement === el) {
        e.preventDefault();
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        const el = document.activeElement;
        if (el instanceof HTMLInputElement && (el.type === "number" || el.type === "range")) {
          el.blur();
        }
      }
    };
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("wheel", onWheel, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

export function EclipseWordmark() {
  return (
    <a href="#/" className="brand" aria-label="Eclipse home">
      <img className="brand-mark" src={`${import.meta.env.BASE_URL}brand-icon.png`} alt="" width={32} height={32} />
      <span className="brand-word">eclipse</span>
    </a>
  );
}

export function ThemeToggle({ theme, toggle }) {
  return (
    <button type="button" className="theme-toggle" onClick={toggle}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
      {theme === "light" ? "🌙" : "☀️"}
    </button>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {hint && <p className="field-hint">{hint}</p>}
      {children}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function ScenarioBox({ title, children }) {
  return (
    <section className="scenario-box" aria-labelledby="scenario-title">
      <h2 id="scenario-title" className="scenario-title">{title}</h2>
      <div className="scenario-body">{children}</div>
    </section>
  );
}

export function WarningList({ title = "Where this can go wrong", items }) {
  return (
    <section className="warn-panel" aria-labelledby="warn-title">
      <h2 id="warn-title" className="warn-panel-title">{title}</h2>
      <ul className="warn-list">
        {items.map((item, i) => (
          <li key={i} className="warn-item">{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function PageShell({ title, subtitle, theme, toggleTheme, children, breadcrumbs }) {
  return (
    <div className="app adv-app">
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
        <div className="intro">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="intro-text">{subtitle}</p>}
          <p className="intro-privacy">
            All statistics run here in your browser. Your numbers are never uploaded or stored on a server.
          </p>
        </div>
      </header>
      <main className="adv-main">{children}</main>
    </div>
  );
}

export const ADVANCED_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
:root {
  --paper:#F7F6FA; --card:#FFFFFF; --ink:#1C1328; --muted:#6B6478; --line:#E9E6F0;
  --pink:#DC004A; --pink-deep:#B0003B; --pink-soft:#FCE6EE;
  --purple:#4A3787; --purple-deep:#382A68; --purple-soft:#F0EEFA; --purple-bright:#6441C3;
  --navy:#1C1328; --win:#157347; --win-bg:#E7F6EE; --lose:#B3261E; --lose-bg:#FCEDEB;
  --warn-bg:#FEF7E0; --warn-edge:#B8920A; --amber:#F1C40F;
  --chart-control:#9A93A8; --chart-line:#5B2A86;
  --shadow:0 1px 2px rgba(26,18,41,.05), 0 10px 30px -12px rgba(26,18,41,.13);
  --radius:15px;
}
[data-theme='dark'] {
  --paper:#121212; --card:#1E1E1E; --ink:rgba(255,255,255,0.87); --muted:rgba(255,255,255,0.60); --line:#383838;
  --pink:#E54D7A; --pink-deep:#FDA4AF; --pink-soft:#4C0519;
  --purple:#94A3E8; --purple-deep:#E0E7FF; --purple-soft:#2D2A70; --purple-bright:#818CF8;
  --navy:rgba(255,255,255,0.95); --win:#34D399; --win-bg:#064E3B; --lose:#F87171; --lose-bg:#450A0A;
  --warn-bg:#422006; --warn-edge:#FBBF24; --amber:#FBBF24;
  --chart-control:rgba(255,255,255,0.55); --chart-line:#94A3E8;
  --shadow:0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
}
.masthead{max-width:1080px;margin:0 auto;padding-top:30px;}
.mast-inner{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;}
.brand-mark{width:32px;height:32px;object-fit:contain;}
.brand-word{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:700;font-size:26px;color:var(--pink);text-transform:lowercase;}
.intro{max-width:1080px;margin:20px auto 0;}
.page-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:700;font-size:28px;margin:0 0 10px;color:var(--navy);}
.intro-text{color:var(--muted);font-size:16px;line-height:1.55;margin:0;max-width:65ch;}
.intro-privacy{color:var(--muted);font-size:13.5px;margin:10px 0 0;max-width:65ch;}
.adv-app{font-family:'Inter',ui-sans-serif,system-ui,sans-serif;background:var(--paper);color:var(--ink);
  min-height:100vh;padding:0 16px 56px;font-size:15.5px;line-height:1.55;}
.adv-app *{box-sizing:border-box;}
.adv-nav{display:flex;gap:12px;flex-wrap:wrap;margin-left:12px;}
.adv-nav-link{font-size:13.5px;font-weight:600;color:var(--purple);text-decoration:none;padding:6px 10px;border-radius:999px;}
.adv-nav-link:hover{background:var(--purple-soft);}
.breadcrumbs{max-width:1080px;margin:12px auto 0;font-size:13px;color:var(--muted);}
.breadcrumbs a{color:var(--purple);text-decoration:none;}
.adv-main{max-width:1080px;margin:24px auto 0;}
.adv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px;}
.adv-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:20px;
  box-shadow:var(--shadow);text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:10px;transition:border-color .15s;}
.adv-card:hover{border-color:var(--purple);}
.adv-card-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-weight:700;font-size:18px;margin:0;color:var(--navy);}
.adv-card-tag{font-size:12px;font-weight:600;color:var(--purple-deep);background:var(--purple-soft);
  border-radius:999px;padding:4px 10px;align-self:flex-start;}
.adv-card-desc{color:var(--muted);font-size:14px;margin:0;flex:1;}
.scenario-box{background:var(--purple-soft);border:1px solid var(--line);border-radius:var(--radius);
  padding:18px 20px;margin-bottom:20px;}
.scenario-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:17px;font-weight:700;margin:0 0 10px;color:var(--purple-deep);}
.scenario-body{font-size:14.5px;line-height:1.6;color:var(--ink);}
.scenario-body p{margin:0 0 8px;}
.scenario-body p:last-child{margin:0;}
.warn-panel{background:var(--warn-bg);border:1px solid var(--warn-edge);border-left:4px solid var(--warn-edge);
  border-radius:var(--radius);padding:16px 18px;margin:20px 0;}
.warn-panel-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:16px;font-weight:700;margin:0 0 10px;color:var(--ink);}
.warn-list{margin:0;padding-left:20px;}
.warn-item{margin:0 0 8px;font-size:14px;line-height:1.5;}
.warn-item:last-child{margin:0;}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
@media (max-width:880px){.two-col{grid-template-columns:1fr;}}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);}
.panel-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:17px;font-weight:700;margin:0 0 12px;}
.panel.results{border-color:var(--purple-soft);}
.stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:12px 0;}
.stat{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px;}
.stat-label{font-size:12px;font-weight:600;color:var(--muted);margin-bottom:4px;}
.stat-num{font-size:20px;font-weight:700;font-feature-settings:'tnum' 1;color:var(--ink);}
.stat-sub-label{font-size:12px;color:var(--muted);margin-top:2px;}
.derived-line{font-size:13.5px;color:var(--muted);margin:8px 0 0;}
.playground-callout{margin-top:14px;padding:14px 16px;background:var(--purple-soft);border:1px solid var(--line);
  border-radius:12px;font-size:14px;line-height:1.55;}
.playground-range{display:flex;align-items:center;gap:14px;}
.playground-range-input{flex:1;accent-color:var(--purple);height:6px;}
.playground-range-val{min-width:72px;text-align:right;font-weight:700;font-feature-settings:'tnum' 1;}
.field{margin:0 0 16px;}
.field-label{display:block;font-weight:600;font-size:13.5px;margin-bottom:5px;}
.field-hint{color:var(--muted);font-size:13.5px;margin:-2px 0 8px;max-width:58ch;}
.field-error{color:var(--lose);background:var(--lose-bg);border-left:3px solid var(--lose);
  font-size:13.5px;padding:7px 11px;border-radius:0 8px 8px 0;margin-top:7px;}
.input{width:100%;max-width:100%;border:1.5px solid var(--line);border-radius:10px;
  padding:10px 13px;font-size:15.5px;font-family:'Inter',sans-serif;color:var(--ink);background:var(--card);}
.input:focus-visible{border-color:var(--purple);outline:0;box-shadow:0 0 0 3px var(--purple-soft);}
.textarea-input{min-height:88px;resize:vertical;font-family:'Inter',ui-monospace,monospace;font-size:13px;}
.chart-wrap{margin-top:12px;width:100%;height:240px;}
.detail-table{width:100%;border-collapse:collapse;font-size:13.5px;}
.detail-table th,.detail-table td{border:1px solid var(--line);padding:8px 10px;text-align:left;}
.detail-table th{background:var(--paper);font-weight:600;}
.detail-table-wrap{overflow-x:auto;margin-top:12px;}
.row-active{background:var(--purple-soft);}
.text-win{color:var(--win);}
.text-lose{color:var(--lose);}
.test-chip-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}
.test-pill{font-size:12px;font-weight:600;color:var(--purple-deep);background:var(--purple-soft);
  border:1px solid var(--line);border-radius:999px;padding:4px 12px;}
.test-pill-win{color:var(--win);background:var(--win-bg);border-color:var(--win);}
.empty{color:var(--muted);}
.theme-toggle{background:var(--card);border:1px solid var(--line);border-radius:10px;
  width:40px;height:40px;cursor:pointer;font-size:18px;}
.prior-gate{margin-bottom:20px;}
.prior-gate-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;}
.prior-gate-btn{flex:1;min-width:120px;max-width:200px;padding:12px 20px;border-radius:999px;
  border:1px solid var(--line);background:var(--card);font-family:'Inter',sans-serif;font-size:15px;
  font-weight:600;color:var(--ink);cursor:pointer;box-shadow:var(--shadow);transition:border-color .15s,background .15s;}
.prior-gate-btn:hover{border-color:var(--purple);background:var(--purple-soft);}
.prior-gate-btn-on{border-color:var(--pink);background:var(--pink-soft);color:var(--pink-deep);}
[data-theme='dark'] .prior-gate-btn-on{border-color:var(--pink);background:var(--pink-soft);color:var(--pink-deep);}
.prior-gate-no{margin-top:0;}
.prior-gate-statement{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:18px;font-weight:700;
  margin:0 0 12px;color:var(--navy);line-height:1.4;}
.prior-gate-no a{color:var(--purple);font-weight:600;}
.error-chart{width:100%;max-width:100%;height:auto;display:block;margin-top:8px;}
.error-curve-null{stroke:#9A93A8;stroke-width:2.5;}
.error-curve-alt{stroke:#5B2A86;stroke-width:2.5;}
[data-theme='dark'] .error-curve-null{stroke:rgba(255,255,255,0.55);}
[data-theme='dark'] .error-curve-alt{stroke:#94A3E8;}
.error-crit-line{stroke:var(--pink);stroke-width:1.5;stroke-dasharray:4 4;}
.error-fill-type1{fill:rgba(179,38,30,0.25);}
.error-fill-type2{fill:rgba(74,55,135,0.2);}
[data-theme='dark'] .error-fill-type1{fill:rgba(248,113,113,0.25);}
[data-theme='dark'] .error-fill-type2{fill:rgba(148,163,232,0.25);}
.error-axis-label{font-size:11px;fill:var(--muted);}
.error-legend-label{font-size:11px;fill:var(--lose);font-weight:600;}
.error-legend-label.type2-label{fill:var(--purple-deep);}
[data-theme='dark'] .error-legend-label.type2-label{fill:var(--purple);}
.concept-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,320px);gap:18px;align-items:start;}
@media (max-width:960px){.concept-workspace{grid-template-columns:1fr;}}
.concept-controls{position:sticky;top:16px;}
@media (max-width:960px){.concept-controls{position:static;order:2;}}
.concept-visual{order:1;padding:22px;}
.concept-visual-top{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:18px;}
@media (max-width:720px){.concept-visual-top{grid-template-columns:1fr;}}
.concept-block-title{font-family:'Plus Jakarta Sans',ui-sans-serif,sans-serif;font-size:14px;font-weight:700;
  margin:0 0 12px;color:var(--purple-deep);text-transform:uppercase;letter-spacing:.04em;}
.concept-scenario{display:flex;flex-direction:column;gap:12px;}
.concept-scenario-row{display:grid;grid-template-columns:64px 1fr 52px;align-items:center;gap:10px;}
.concept-scenario-label{font-size:13px;font-weight:600;color:var(--muted);}
.concept-scenario-track{height:28px;background:var(--paper);border:1px solid var(--line);border-radius:8px;overflow:hidden;}
.concept-scenario-fill{height:100%;border-radius:7px;transition:width .35s ease;background:var(--line);}
.concept-scenario-fill.control{background:#9A93A8;}
.concept-scenario-fill.variant{background:#C4BFD0;}
.concept-scenario-fill.variant.lift{background:linear-gradient(90deg,#5B2A86,#7C3AED);}
.concept-scenario-pct{font-size:14px;font-weight:700;font-feature-settings:'tnum' 1;text-align:right;}
.concept-meters{display:flex;flex-direction:column;gap:12px;}
.concept-meter-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px;}
.concept-meter-label{font-size:13px;font-weight:600;color:var(--ink);}
.concept-meter-val{font-size:15px;font-weight:700;font-feature-settings:'tnum' 1;}
.concept-meter-track{height:10px;background:var(--paper);border:1px solid var(--line);border-radius:999px;overflow:hidden;}
.concept-meter-fill{height:100%;border-radius:999px;transition:width .35s ease;}
.concept-meter-type1 .concept-meter-fill{background:#B3261E;}
.concept-meter-type2 .concept-meter-fill{background:#5B2A86;}
.concept-meter-power .concept-meter-fill{background:#1B7F5A;}
.concept-meter-caption{font-size:12px;color:var(--muted);margin:5px 0 0;}
.concept-chart-wrap{margin:0 -4px 16px;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:8px 8px 4px;}
@media (max-width:960px){
  .concept-chart-wrap{position:sticky;top:0;z-index:3;box-shadow:0 4px 20px rgba(0,0,0,.08);}
  [data-theme='dark'] .concept-chart-wrap{box-shadow:0 4px 24px rgba(0,0,0,.35);}
}
.error-chart-large{min-height:240px;}
.error-chart-title{font-size:13px;font-weight:700;fill:var(--ink);}
.error-area-label{font-size:12px;font-weight:700;}
.error-area-label.type1{fill:#B3261E;}
.error-area-label.type2{fill:#5B2A86;}
[data-theme='dark'] .error-area-label.type1{fill:#F87171;}
[data-theme='dark'] .error-area-label.type2{fill:#94A3E8;}
.error-reject-badge{fill:var(--card);stroke:var(--line);}
.error-reject-label{font-size:10px;font-weight:600;fill:var(--muted);}
.error-curve-tag{font-size:11px;font-weight:600;}
.error-curve-tag.null-tag{fill:#9A93A8;}
.error-curve-tag.alt-tag{fill:#5B2A86;}
[data-theme='dark'] .error-curve-tag.alt-tag{fill:#94A3E8;}
.concept-outcomes{margin-top:4px;padding-top:16px;border-top:1px solid var(--line);}
.concept-outcomes-title{font-size:13.5px;font-weight:600;margin:0 0 10px;color:var(--ink);}
.concept-outcome-grid{display:grid;grid-template-columns:repeat(20,1fr);gap:4px;max-width:520px;}
.concept-outcome-dot{display:block;width:100%;aspect-ratio:1;border-radius:3px;background:var(--line);transition:background .35s ease;}
.concept-outcome-dot.type1{background:#B3261E;}
.concept-outcome-dot.type2{background:#5B2A86;}
.concept-outcome-dot.power{background:#1B7F5A;}
.concept-outcome-dot.ok{background:#9A93A8;}
[data-theme='dark'] .concept-outcome-dot.type1{background:#F87171;}
[data-theme='dark'] .concept-outcome-dot.type2{background:#818CF8;}
[data-theme='dark'] .concept-outcome-dot.power{background:#34D399;}
.concept-outcome-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12.5px;color:var(--muted);}
.concept-outcome-legend span{display:inline-flex;align-items:center;gap:6px;}
.concept-outcome-legend .concept-outcome-dot{width:12px;height:12px;flex-shrink:0;}
.concept-narrative{margin:16px 0 0;padding:12px 14px;background:var(--purple-soft);border:1px solid var(--line);
  border-radius:12px;font-size:14px;line-height:1.55;}
.concept-controls-hint{margin-top:-4px;margin-bottom:16px;}
.concept-key{margin-top:20px;padding-top:16px;border-top:1px solid var(--line);}
.concept-key-title{font-size:13px;font-weight:700;margin:0 0 8px;color:var(--purple-deep);}
.concept-key-list{margin:0;padding:0;list-style:none;font-size:13px;line-height:1.7;color:var(--muted);}
.concept-key-list li{display:flex;align-items:center;gap:8px;}
.concept-key-swatch{width:12px;height:12px;border-radius:3px;flex-shrink:0;}
.concept-key-swatch.type1{background:#B3261E;}
.concept-key-swatch.type2{background:#5B2A86;}
.concept-key-swatch.power{background:#1B7F5A;}
`;

import React, { useMemo, useState } from "react";
import ConceptLabLayout from "../shared/ConceptLabLayout.jsx";
import ConceptIntro from "../shared/ConceptIntro.jsx";
import {
  DISTRIBUTION_TYPES,
  continuousDomain,
  curvePoints,
  defaultParams,
  histogramContinuous,
  sampleFrom,
  winsorizeComparison,
} from "../shared/distributionTypes.js";
import { fmtPct } from "../shared/statsCore.js";

function fmtGbp(v) {
  if (!Number.isFinite(v)) return "—";
  return `£${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
}

function RevenueWinsorPanel({ samples, params }) {
  const cmp = useMemo(() => winsorizeComparison(samples), [samples]);
  const W = 640;
  const H = 260;
  const pad = { l: 48, r: 16, t: 36, b: 44 };
  const lo = 0;
  const hi = Math.max(cmp.cap99 * 1.15, ...samples) * 1.02;
  const span = hi - lo || 1;
  const bins = 28;
  const step = span / bins;

  const sx = (x) => pad.l + ((x - lo) / span) * (W - pad.l - pad.r);
  const baseY = pad.t + (H - pad.t - pad.b);

  const hist = (vals) => histogramContinuous(vals, bins, lo, hi);
  const rawHist = hist(cmp.raw);
  const h99 = hist(cmp.capped99);
  const h95 = hist(cmp.capped95);
  const yMax = Math.max(rawHist.max, h99.max, h95.max, 1);
  const sy = (count) => baseY - (count / yMax) * (H - pad.t - pad.b) * 0.88;

  const renderBars = (binsArr, className) =>
    binsArr.map((count, i) => {
      const x0 = lo + i * step;
      const barH = baseY - sy(count);
      return (
        <rect
          key={`${className}-${i}`}
          x={sx(x0)}
          y={sy(count)}
          width={Math.max(1, sx(x0 + step) - sx(x0) - 1)}
          height={barH}
          className={className}
        />
      );
    });

  return (
    <section className="cv-winsor-panel" aria-labelledby="winsor-heading">
      <h3 id="winsor-heading" className="cv-winsor-title">What 95% and 99% capping does to revenue</h3>
      <p className="cv-winsor-lede">
        Whale orders can inflate RPV and AOV. In the main calculator, any order above the chosen percentile is
        replaced with that cap before averages and significance tests run — same logic shown here on a sample of order values.
      </p>

      <svg className="cv-line-chart cv-dist-chart cv-winsor-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Order value histograms: raw, 99 percent cap, and 95 percent cap">
        <text x={W / 2} y={18} textAnchor="middle" className="cv-dist-type-chart-title">
          Raw orders vs capped orders (same sample)
        </text>

        {renderBars(rawHist.bins, "cv-winsor-bar-raw")}
        {renderBars(h99.bins, "cv-winsor-bar-99")}
        {renderBars(h95.bins, "cv-winsor-bar-95")}

        <line x1={sx(cmp.cap99)} x2={sx(cmp.cap99)} y1={pad.t} y2={baseY}
          className="cv-winsor-cap-line cv-winsor-cap-99" />
        <line x1={sx(cmp.cap95)} x2={sx(cmp.cap95)} y1={pad.t} y2={baseY}
          className="cv-winsor-cap-line cv-winsor-cap-95" />

        <text x={sx(cmp.cap99)} y={pad.t + 12} textAnchor="middle" className="cv-winsor-cap-label cv-winsor-cap-99">
          99% cap {fmtGbp(cmp.cap99)}
        </text>
        <text x={sx(cmp.cap95)} y={pad.t + 24} textAnchor="middle" className="cv-winsor-cap-label cv-winsor-cap-95">
          95% cap {fmtGbp(cmp.cap95)}
        </text>

        <text x={pad.l} y={H - 10} className="cv-axis-label">Order value (£) →</text>
      </svg>

      <ul className="cv-winsor-legend" aria-hidden="true">
        <li><span className="cv-winsor-swatch cv-winsor-bar-raw" /> Raw (uncapped)</li>
        <li><span className="cv-winsor-swatch cv-winsor-bar-99" /> After 99% cap</li>
        <li><span className="cv-winsor-swatch cv-winsor-bar-95" /> After 95% cap</li>
      </ul>

      <div className="cv-winsor-stats">
        <div className="cv-winsor-stat">
          <span className="cv-winsor-stat-label">Raw average order</span>
          <strong>{fmtGbp(cmp.meanRaw)}</strong>
          <span className="cv-winsor-stat-note">Whale orders pull RPV/AOV up</span>
        </div>
        <div className="cv-winsor-stat">
          <span className="cv-winsor-stat-label">99% cap</span>
          <strong>{fmtGbp(cmp.mean99)}</strong>
          <span className="cv-winsor-stat-note">
            {cmp.clipped99} order{cmp.clipped99 === 1 ? "" : "s"} clipped at {fmtGbp(cmp.cap99)}
          </span>
        </div>
        <div className="cv-winsor-stat">
          <span className="cv-winsor-stat-label">95% cap</span>
          <strong>{fmtGbp(cmp.mean95)}</strong>
          <span className="cv-winsor-stat-note">
            {cmp.clipped95} order{cmp.clipped95 === 1 ? "" : "s"} clipped at {fmtGbp(cmp.cap95)}
          </span>
        </div>
      </div>

      <p className="clab-summary cv-winsor-foot">
        Heavier whale tail (σ = {params.sigma}) widens the gap between raw and capped averages.
        A 99% cap only trims the very top orders; 95% cap pulls typical-test averages closer to everyday basket sizes.
      </p>
    </section>
  );
}

function DistributionChart({ typeId, params, samples, dtype }) {
  const W = 640;
  const H = 240;
  const pad = { l: 44, r: 16, t: 28, b: 40 };
  const isDiscrete = dtype.family === "discrete";
  const pts = curvePoints(typeId, params);
  const yMax = Math.max(0.001, ...pts.map((p) => p.y), 0.01);

  let lo;
  let hi;
  if (isDiscrete) {
    lo = -0.5;
    hi = pts.length > 0 ? pts[pts.length - 1].x + 0.5 : 1.5;
  } else {
    const d = continuousDomain(typeId, params);
    lo = d.lo;
    hi = d.hi;
  }
  const span = hi - lo || 1;

  const sx = (x) => pad.l + ((x - lo) / span) * (W - pad.l - pad.r);
  const sy = (y) => pad.t + (1 - y / yMax) * (H - pad.t - pad.b);
  const baseY = sy(0);

  const hist = !isDiscrete
    ? histogramContinuous(samples, 24, lo, hi)
    : null;

  return (
    <svg className="cv-line-chart cv-dist-chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`${dtype.title} distribution shape`}>
      <text x={W / 2} y={18} textAnchor="middle" className="cv-dist-type-chart-title">
        {isDiscrete ? "Probability at each whole-number outcome" : "Density along the range"}
      </text>

      {hist?.bins.map((count, i) => {
        const x0 = lo + i * hist.step;
        const barH = (count / hist.max) * (H - pad.t - pad.b) * 0.4;
        return (
          <rect
            key={i}
            x={sx(x0)}
            y={baseY - barH}
            width={Math.max(1, sx(x0 + hist.step) - sx(x0) - 1)}
            height={barH}
            className="cv-dist-hist-bar"
          />
        );
      })}

      {isDiscrete ? (
        pts.map((p) => {
          const barW = Math.min(28, (W - pad.l - pad.r) / Math.max(pts.length, 1) * 0.65);
          const cx = sx(p.x);
          const h = sy(p.y) - baseY;
          return (
            <g key={p.x}>
              <rect
                x={cx - barW / 2}
                y={sy(p.y)}
                width={barW}
                height={Math.abs(h)}
                className="cv-dist-discrete-bar"
                rx={2}
              />
              <text x={cx} y={H - 10} textAnchor="middle" className="cv-dist-x-tick">{p.x}</text>
            </g>
          );
        })
      ) : (
        <>
          <path
            d={`${pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ")} L ${sx(hi).toFixed(1)} ${baseY.toFixed(1)} L ${sx(lo).toFixed(1)} ${baseY.toFixed(1)} Z`}
            className="cv-dist-area"
          />
          <path
            d={pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ")}
            className="cv-dist-type-curve"
            fill="none"
          />
        </>
      )}

      {!isDiscrete && (
        <text x={pad.l} y={H - 8} className="cv-axis-label">{dtype.xLabel} →</text>
      )}
      {isDiscrete && (
        <text x={W / 2} y={H - 8} textAnchor="middle" className="cv-axis-label">{dtype.xLabel}</text>
      )}
      <text x={pad.l} y={pad.t + 10} className="cv-dist-hist-legend">
        {isDiscrete ? "Bar height = probability" : "Line = model · faint bars = sample"}
      </text>
    </svg>
  );
}

function ParamSliders({ dtype, params, setParams }) {
  if (!dtype.params.length) return null;
  return (
    <div className={`det-dock cv-dist-params cv-dist-params-${dtype.params.length}`}>
      {dtype.params.map((p) => (
        <div key={p.key} className="det-dock-item">
          <label htmlFor={`dist-${p.key}`}>
            {p.label}
            <span className="det-dock-val">
              {p.key === "p" ? fmtPct(params[p.key], 1) : params[p.key]}
            </span>
          </label>
          <input
            id={`dist-${p.key}`}
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={params[p.key]}
            onChange={(e) => setParams({ ...params, [p.key]: Number(e.target.value) })}
          />
        </div>
      ))}
    </div>
  );
}

export default function DistributionsPlayground({ theme, toggleTheme }) {
  const [typeId, setTypeId] = useState("normal");
  const [params, setParams] = useState(() => defaultParams(DISTRIBUTION_TYPES[0]));
  const [seed] = useState(42);

  const dtype = DISTRIBUTION_TYPES.find((t) => t.id === typeId) ?? DISTRIBUTION_TYPES[0];
  const samples = useMemo(
    () => sampleFrom(typeId, params, typeId === "lognormal" ? 800 : 350, seed + typeId.charCodeAt(0)),
    [typeId, params, seed],
  );

  const pickType = (id) => {
    const t = DISTRIBUTION_TYPES.find((d) => d.id === id);
    setTypeId(id);
    if (t) setParams(defaultParams(t));
  };

  const continuous = DISTRIBUTION_TYPES.filter((t) => t.family === "continuous");
  const discrete = DISTRIBUTION_TYPES.filter((t) => t.family === "discrete");

  return (
    <ConceptLabLayout
      theme={theme}
      toggleTheme={toggleTheme}
      title="Types of distributions"
      subtitle="The shapes behind conversion, revenue, bounce, session time, clicks, and other site metrics."
      breadcrumbs={
        <>
          <a href="#/">Main calculator</a> / <a href="#/concepts">Learn the concepts</a> / Distribution types
        </>
      }
    >
      <div className="det-demo">
        <ConceptIntro
          heading="Continuous vs discrete"
          lede="Your dashboard mixes both kinds: continuous metrics (time on page, order value, scroll depth) and discrete counts (conversions, orders per hour, CTA clicks). Each distribution type describes a different pattern you will see in analytics."
          cards={[
            {
              title: "Continuous metrics",
              body: "Time on page, order value, seconds until bounce — values anywhere on a scale, often skewed for revenue.",
            },
            {
              title: "Discrete metrics",
              body: "Conversions per visitor slice, orders per hour, element clicks — whole-number counts at 0, 1, 2…",
            },
          ]}
          footnote="Pick a distribution below. Sliders change the shape. Examples use everyday analytics — revenue, orders, bounce, engagement — not abstract maths."
        />

        <h2 className="det-try-heading">Continuous</h2>
        <div className="det-scenario-tabs" role="tablist" aria-label="Continuous distributions">
          {continuous.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={typeId === t.id}
              className={`det-scenario-tab ${typeId === t.id ? "det-scenario-tab-on" : ""}`}
              onClick={() => pickType(t.id)}
            >
              {t.title}
            </button>
          ))}
        </div>

        <h2 className="det-try-heading det-try-heading-sub">Discrete</h2>
        <div className="det-scenario-tabs" role="tablist" aria-label="Discrete distributions">
          {discrete.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={typeId === t.id}
              className={`det-scenario-tab ${typeId === t.id ? "det-scenario-tab-on" : ""}`}
              onClick={() => pickType(t.id)}
            >
              {t.title}
            </button>
          ))}
        </div>

        <section className="det-board">
          <div className="cv-dist-type-head">
            <span className={`cv-dist-family cv-dist-family-${dtype.family}`}>
              {dtype.family === "continuous" ? "Continuous" : "Discrete"}
            </span>
            <h3 className="cv-dist-type-name">{dtype.title}</h3>
            <p className="cv-dist-type-plain">{dtype.plainName} · {dtype.tag}</p>
          </div>

          <p className="cv-dist-definition">{dtype.definition}</p>

          <dl className="cv-dist-facts">
            <div>
              <dt>Everyday example</dt>
              <dd>{dtype.example}</dd>
            </div>
            <div>
              <dt>In your analytics</dt>
              <dd>{dtype.abNote}</dd>
            </div>
          </dl>

          <ParamSliders dtype={dtype} params={params} setParams={setParams} />

          <DistributionChart typeId={typeId} params={params} samples={samples} dtype={dtype} />

          {typeId === "lognormal" && (
            <RevenueWinsorPanel samples={samples} params={params} />
          )}

          <p className="clab-summary">
            <strong>{dtype.title}</strong> ({dtype.plainName}): {dtype.abNote}
          </p>
        </section>
      </div>
    </ConceptLabLayout>
  );
}

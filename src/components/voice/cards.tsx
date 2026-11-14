"use client";

import type { Card, OverlaySeries } from "@/lib/voice/brain";

export function VoiceCard({ card, onSay }: { card: Card; onSay: (text: string) => void }) {
  switch (card.type) {
    case "stats":
      return (
        <figure className="vc">
          <figcaption>{card.title}</figcaption>
          <table className="vc-table">
            <tbody>
              {card.rows.map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {card.note && <p className="vc-note">Data: {card.note}. Test: Mann-Kendall + Sen&apos;s slope on yearly values.</p>}
        </figure>
      );
    case "overlay":
      return <Overlay card={card} />;
    case "change": {
      const c = card.result;
      return (
        <figure className="vc">
          <figcaption>{card.title}</figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="vc-map" src={`/api/voice${c.map}`} alt={`Change in plant cover from ${c.then.years[0]} to ${c.now.years[1]}`} />
          <div className="vc-legend">
            <span className="vc-swatch is-loss" /> Lost greenness <span className="vc-swatch is-gain" /> Gained <span className="vc-swatch is-faint" /> Not consistent
          </div>
          <div className="vc-stats">
            <Stat label="Lost greenness" value={`${c.loss_pct}%`} sub={`${c.strong_loss_pct}% strongly`} tone="loss" />
            <Stat label="Gained" value={`${c.gain_pct}%`} sub={`${c.strong_gain_pct}% strongly`} tone="gain" />
            <Stat label="Mean NDVI" value={`${c.ndvi_then.toFixed(2)} → ${c.ndvi_now.toFixed(2)}`} sub={`${c.then.years[0]}–${c.then.years[1]} vs ${c.now.years[0]}–${c.now.years[1]}`} />
          </div>
          <p className="vc-note">
            {c.method} {c.cached ? "(cached)" : `(${(c.ms / 1000).toFixed(1)} s)`}
          </p>
        </figure>
      );
    }
    case "suggest":
      return (
        <ol className="vc vc-list">
          {card.items.map((t, i) => (
            <li key={i}>
              <button type="button" onClick={() => onSay(["the first one", "the second one", "the third one"][i])}>
                {t}
              </button>
            </li>
          ))}
        </ol>
      );
    case "help":
      return (
        <ul className="vc vc-list is-help">
          {[
            "Take me to the Amazon",
            "Select vegetation",
            "Compare historical and recent satellite observations",
            "Overlay precipitation and soil moisture",
            "Calculate the trend slope and statistical significance",
            "Only summer",
            "From 2005 to 2025",
            "Compare with the world",
            "What is a p-value?",
            "What else should I investigate?",
          ].map((t) => (
            <li key={t}>
              <button type="button" onClick={() => onSay(t)}>
                “{t}”
              </button>
            </li>
          ))}
        </ul>
      );
  }
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "loss" | "gain" }) {
  return (
    <div className={`vc-stat ${tone ? `is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** Several measurements on one chart, each as standard deviations from its own average. */
function Overlay({ card }: { card: Extract<Card, { type: "overlay" }> }) {
  const W = 300;
  const H = 130;
  const P = { l: 22, r: 6, t: 6, b: 16 };
  const ys = card.years;
  const x = (i: number) => P.l + (i / Math.max(1, ys.length - 1)) * (W - P.l - P.r);
  const lim = Math.max(2, ...card.series.flatMap((s) => s.z.filter((v): v is number => v !== null).map(Math.abs)));
  const y = (v: number) => P.t + ((lim - v) / (2 * lim)) * (H - P.t - P.b);
  const path = (s: OverlaySeries) => {
    let d = "";
    s.z.forEach((v, i) => {
      if (v === null) return;
      d += `${d && s.z[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };
  return (
    <figure className="vc">
      <figcaption>{card.title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="vc-chart" role="img" aria-label="Overlay chart">
        {[-2, 0, 2].map((g) => (
          <g key={g}>
            <line x1={P.l} x2={W - P.r} y1={y(g)} y2={y(g)} className={g === 0 ? "vc-zero" : "vc-grid"} />
            <text x={P.l - 4} y={y(g) + 3} className="vc-tick" textAnchor="end">
              {g > 0 ? `+${g}` : g}
            </text>
          </g>
        ))}
        {[0, ys.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 3} className="vc-tick" textAnchor={i ? "end" : "start"}>
            {ys[i]}
          </text>
        ))}
        {card.series.map((s, k) => (
          <path key={s.layer} d={path(s)} stroke={s.color} strokeWidth={k === 0 ? 2.2 : 1.5} fill="none" opacity={k === 0 ? 1 : 0.85} />
        ))}
      </svg>
      <div className="vc-keys">
        {card.series.map((s) => (
          <span key={s.layer}>
            <i style={{ background: s.color }} />
            {s.label}
            {s.trend && (
              <em className={s.trend.significant ? "is-sig" : ""}>
                {s.trend.pctPerDecade !== null ? `${s.trend.pctPerDecade > 0 ? "+" : ""}${s.trend.pctPerDecade.toFixed(1)}%/dec` : ""}
                {s.trend.significant ? " ✓" : ""}
              </em>
            )}
          </span>
        ))}
      </div>
      {card.links.length > 0 && (
        <p className="vc-note">
          {card.links.map((l) => `${l.a} vs ${l.b}: r = ${l.r.toFixed(2)} (p ${l.p < 0.001 ? "< 0.001" : "= " + l.p.toFixed(3)}, ${l.n} yrs)`).join(" · ")}. Lines show
          each measure in standard deviations from its own average; ✓ = significant trend.
        </p>
      )}
    </figure>
  );
}

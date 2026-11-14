"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { Trend, YearValue } from "@/lib/series";

/* ------------------------------------------------------------------ */
/* Shared                                                              */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return out;
}

const decimalsFor = (ticks: number[]) => {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  return step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
};

const inRange = (y: number, [a, b]: [number, number]) => y >= a && y <= b;

/** Horizontal year scale shared by the stripes, the chart and the bars. */
function yearScale(first: number, last: number, left: number, width: number) {
  const step = width / (last - first + 1);
  return { step, x: (year: number) => left + (year - first + 0.5) * step, yearAt: (px: number) => Math.round(first - 0.5 + (px - left) / step) };
}

/* ------------------------------------------------------------------ */
/* Warming stripes                                                     */

export function Stripes({
  series,
  range,
  color,
  valueText,
  low,
  high,
}: {
  series: YearValue[];
  range: [number, number];
  color: (t: number) => string;
  valueText: (v: number) => string;
  low: string;
  high: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<YearValue | null>(null);
  if (!series.length) return null;
  const first = series[0].year;
  const last = series[series.length - 1].year;
  const mean = series.reduce((a, d) => a + d.value, 0) / series.length;
  const maxAbs = Math.max(...series.map((d) => Math.abs(d.value - mean))) || 1;
  const { step, x, yearAt } = yearScale(first, last, 0, width);

  return (
    <div className="stripes" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={56}
          onPointerMove={(e) => setHover(series.find((d) => d.year === yearAt(e.nativeEvent.offsetX)) ?? null)}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Stripes, one per year from ${first} to ${last}, coloured from below average to above average`}
        >
          {series.map((d) => (
            <rect
              key={d.year}
              x={x(d.year) - step / 2}
              y={0}
              width={step + 0.6}
              height={56}
              fill={color((d.value - mean) / maxAbs)}
              opacity={inRange(d.year, range) ? 1 : 0.28}
            />
          ))}
          {hover && <rect className="stripes-hover" x={x(hover.year) - step / 2} y={0.5} width={step} height={55} />}
        </svg>
      )}
      <div className="stripes-foot">
        <span>{first}</span>
        {hover ? (
          <span className="stripes-read">
            <b>{hover.year}</b> {valueText(hover.value)}
          </span>
        ) : (
          <span className="stripes-key">
            <i style={{ background: color(-0.8) }} />
            {low}
            <i style={{ background: color(0.8) }} />
            {high}
          </span>
        )}
        <span>{last}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The main chart: yearly values, trend line, chosen years            */

export function TrendChart({
  series,
  trend,
  range,
  valueText,
  accent,
  axis,
  height = 240,
}: {
  series: YearValue[];
  trend: Trend | null;
  range: [number, number];
  valueText: (v: number) => string;
  accent: string;
  /** Unit written above the value axis. */
  axis: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!series.length) return null;

  const PAD = { top: 22, right: 8, bottom: 24, left: 44 };
  const first = series[0].year;
  const last = series[series.length - 1].year;
  const { x, yearAt } = yearScale(first, last, PAD.left, Math.max(1, width - PAD.left - PAD.right));
  const vals = series.map((d) => d.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 1;
  const ticks = niceTicks(lo - pad, hi + pad);
  const y0 = Math.min(lo - pad, ticks[0]);
  const y1 = Math.max(hi + pad, ticks[ticks.length - 1]);
  const y = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0)) * (height - PAD.top - PAD.bottom);
  const digits = decimalsFor(ticks);

  const line = series.map((d, i) => `${i ? "L" : "M"}${x(d.year).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
  const inside = series.filter((d) => inRange(d.year, range));
  const insideLine = inside.map((d, i) => `${i ? "L" : "M"}${x(d.year).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
  const decades: number[] = [];
  for (let yr = Math.ceil(first / 10) * 10; yr <= last; yr += 10) decades.push(yr);
  const hv = hover !== null ? series.find((d) => d.year === hover) : undefined;

  return (
    <div className="trend-chart" ref={ref}>
      <div className="chart-read" aria-live="polite">
        {hv ? (
          <>
            <b>{hv.year}</b> {valueText(hv.value)}
            {trend && inRange(hv.year, range) && <span>trend {valueText(trend.at(hv.year))}</span>}
          </>
        ) : (
          <span className="chart-key">
            <i className="key-dot" />
            One year
            {trend && <i className="key-line" style={{ background: accent }} />}
            {trend && "Trend"}
          </span>
        )}
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onPointerMove={(e: PointerEvent<SVGSVGElement>) => {
            const yr = yearAt(e.nativeEvent.offsetX);
            setHover(yr >= first && yr <= last ? yr : null);
          }}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Yearly values from ${first} to ${last}${trend ? ` with a trend line for ${range[0]} to ${range[1]}` : ""}`}
        >
          <text className="axis-unit" x={0} y={10}>
            {axis}
          </text>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end">
                {t.toFixed(digits)}
              </text>
            </g>
          ))}
          {decades.map((d) => (
            <text key={d} className="tick" x={x(d)} y={height - 6} textAnchor="middle">
              {d}
            </text>
          ))}
          <rect
            className="chosen"
            x={x(range[0]) - 4}
            y={PAD.top}
            width={x(range[1]) - x(range[0]) + 8}
            height={height - PAD.top - PAD.bottom}
            rx={6}
          />
          <path className="series-all" d={line} />
          <path className="series-in" d={insideLine} />
          {inside.map((d) => (
            <circle key={d.year} className="dot" cx={x(d.year)} cy={y(d.value)} r={3.2} />
          ))}
          {trend && (
            <line
              className="trend-line"
              style={{ stroke: accent }}
              x1={x(range[0])}
              x2={x(range[1])}
              y1={y(trend.at(range[0]))}
              y2={y(trend.at(range[1]))}
            />
          )}
          {hv && (
            <>
              <line className="hover-line" x1={x(hv.year)} x2={x(hv.year)} y1={PAD.top} y2={height - PAD.bottom} />
              <circle className="hover-dot" cx={x(hv.year)} cy={y(hv.value)} r={4} />
            </>
          )}
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Year range: two handles                                             */

export function RangeSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const MIN_SPAN = 9; // a trend test needs about ten years
  const [a, b] = value;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  return (
    <div className="range">
      <div className="range-track">
        <span className="range-fill" style={{ left: `${pct(a)}%`, right: `${100 - pct(b)}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          value={a}
          aria-label="First year"
          onChange={(e) => onChange([Math.min(Number(e.target.value), b - MIN_SPAN), b])}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={b}
          aria-label="Last year"
          onChange={(e) => onChange([a, Math.max(Number(e.target.value), a + MIN_SPAN)])}
        />
      </div>
      <div className="range-labels">
        <span>{a}</span>
        <span>{b}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diverging bars: seasons, and every place ranked                     */

export interface BarRow {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  value: number | null;
  significant: boolean;
  text: string;
  highlight?: boolean;
}

/**
 * Bars left of the centre line fell, bars to the right rose. A clear trend is
 * a solid bar; one that could be chance is pale and says so.
 */
export function DivergingBars({
  rows,
  hue,
  selected,
  onPick,
  dense,
}: {
  rows: BarRow[];
  hue: { up: string; down: string };
  selected?: string;
  onPick?: (id: string) => void;
  dense?: boolean;
}) {
  const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value ?? 0)));
  return (
    <ul className={`bars${dense ? " is-dense" : ""}`}>
      {rows.map((r) => {
        const v = r.value ?? 0;
        const w = (Math.abs(v) / maxAbs) * 50;
        const fill = v >= 0 ? hue.up : hue.down;
        const Tag = onPick ? "button" : "div";
        return (
          <li key={r.id}>
            <Tag
              {...(onPick ? { type: "button" as const, onClick: () => onPick(r.id) } : {})}
              className="bar-row"
              data-on={selected === r.id || r.highlight ? "" : undefined}
              aria-pressed={onPick && selected !== undefined ? selected === r.id : undefined}
            >
              <span className="bar-label">
                {r.icon}
                <span>{r.label}</span>
              </span>
              <span className="bar-track">
                <span className="bar-zero" />
                {r.value !== null && (
                  <span
                    className="bar"
                    data-faint={r.significant ? undefined : ""}
                    style={{ left: v >= 0 ? "50%" : `${50 - w}%`, width: `${Math.max(w, 0.8)}%`, background: fill }}
                  />
                )}
              </span>
              <span className="bar-value" style={r.significant ? { color: fill } : undefined}>
                {r.text}
              </span>
              {!dense && <span className="bar-status">{r.value === null ? "" : r.significant ? "clear trend" : "could be chance"}</span>}
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Counts per year (heatwave days, heavy rain days)                    */

export function YearBars({
  series,
  trend,
  range,
  color,
  unit,
  height = 160,
}: {
  series: YearValue[];
  trend: Trend | null;
  range: [number, number];
  color: string;
  unit: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<YearValue | null>(null);
  if (!series.length) return null;
  const PAD = { top: 22, right: 8, bottom: 22, left: 36 };
  const first = series[0].year;
  const last = series[series.length - 1].year;
  const { step, x, yearAt } = yearScale(first, last, PAD.left, Math.max(1, width - PAD.left - PAD.right));
  const hi = Math.max(1, ...series.map((d) => d.value));
  const ticks = niceTicks(0, hi, 3).filter((t) => Number.isInteger(t));
  const top = Math.max(hi, ticks[ticks.length - 1] ?? hi);
  const y = (v: number) => PAD.top + (1 - v / top) * (height - PAD.top - PAD.bottom);
  const decades: number[] = [];
  for (let yr = Math.ceil(first / 10) * 10; yr <= last; yr += 10) decades.push(yr);
  // Only draw a trend that passed the test; a flat line stuck on zero just confuses.
  const showTrend = trend?.significant;

  return (
    <div className="year-bars" ref={ref}>
      <div className="chart-read">
        {hover ? (
          <>
            <b>{hover.year}</b> {Math.round(hover.value)} {unit}
          </>
        ) : (
          <span className="chart-key">
            <i className="key-bar" style={{ background: color }} />
            One year
            {showTrend && <i className="key-line" style={{ background: "#fff" }} />}
            {showTrend && "Trend"}
          </span>
        )}
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onPointerMove={(e) => setHover(series.find((d) => d.year === yearAt(e.nativeEvent.offsetX)) ?? null)}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${unit} per year, ${first} to ${last}`}
        >
          <text className="axis-unit" x={0} y={10}>
            {unit}
          </text>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "grid is-zero" : "grid"} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {series.map((d) => (
            <rect
              key={d.year}
              x={x(d.year) - step * 0.36}
              y={y(d.value)}
              width={step * 0.72}
              height={Math.max(0, y(0) - y(d.value))}
              rx={Math.min(2, step * 0.2)}
              fill={color}
              opacity={hover?.year === d.year ? 1 : inRange(d.year, range) ? 0.85 : 0.25}
            />
          ))}
          {showTrend && trend && (
            <line
              className="trend-line"
              style={{ stroke: "#fff" }}
              x1={x(range[0])}
              x2={x(range[1])}
              y1={y(Math.max(0, trend.at(range[0])))}
              y2={y(Math.max(0, trend.at(range[1])))}
            />
          )}
          {decades.map((d) => (
            <text key={d} className="tick" x={x(d)} y={height - 6} textAnchor="middle">
              {d}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Two series as change from their own average (days vs nights)       */

export function PairChart({
  a,
  b,
  range,
  colors,
  height = 180,
}: {
  a: { series: YearValue[]; trend: Trend | null };
  b: { series: YearValue[]; trend: Trend | null };
  range: [number, number];
  colors: [string, string];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (!a.series.length) return null;
  const PAD = { top: 22, right: 8, bottom: 22, left: 36 };
  const first = a.series[0].year;
  const last = a.series[a.series.length - 1].year;
  const { x } = yearScale(first, last, PAD.left, Math.max(1, width - PAD.left - PAD.right));
  const anom = (s: YearValue[]) => {
    const inside = s.filter((d) => inRange(d.year, range));
    const m = inside.reduce((t, d) => t + d.value, 0) / (inside.length || 1);
    return { m, pts: s.map((d) => ({ year: d.year, value: d.value - m })) };
  };
  const A = anom(a.series);
  const B = anom(b.series);
  const all = [...A.pts, ...B.pts].map((d) => d.value);
  const ext = Math.max(0.5, ...all.map(Math.abs));
  const ticks = niceTicks(-ext, ext, 4);
  const y = (v: number) => PAD.top + (1 - (v + ext) / (2 * ext)) * (height - PAD.top - PAD.bottom);
  const path = (pts: YearValue[]) => pts.map((d, i) => `${i ? "L" : "M"}${x(d.year).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
  const decades: number[] = [];
  for (let yr = Math.ceil(first / 10) * 10; yr <= last; yr += 10) decades.push(yr);

  return (
    <div className="pair-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Daytime highs and night-time lows, as change from their average">
          <text className="axis-unit" x={0} y={10}>
            °C warmer or cooler than usual
          </text>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "grid is-zero" : "grid"} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end">
                {t > 0 ? `+${t}` : t}
              </text>
            </g>
          ))}
          {[A, B].map((S, i) => {
            const t = i ? b.trend : a.trend;
            return (
              <g key={i}>
                <path className="pair-line" d={path(S.pts)} style={{ stroke: colors[i] }} />
                {t && (
                  <line
                    className="trend-line"
                    style={{ stroke: colors[i], strokeDasharray: t.significant ? undefined : "5 4" }}
                    x1={x(range[0])}
                    x2={x(range[1])}
                    y1={y(t.at(range[0]) - S.m)}
                    y2={y(t.at(range[1]) - S.m)}
                  />
                )}
              </g>
            );
          })}
          {decades.map((d) => (
            <text key={d} className="tick" x={x(d)} y={height - 6} textAnchor="middle">
              {d}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

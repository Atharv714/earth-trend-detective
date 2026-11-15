"use client";

// The detective's free-form charts ({"type":"plot"} in a ```viz block), drawn
// with bklit charts (src/components/charts). Lines, areas and dots run over
// years: from tool chart ids, so the numbers are NASA's own, or from values the
// model writes (the number check reads those). Bars, pies and radars compare
// labelled things: places, seasons, sources.

import { useEffect, useState } from "react";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { useChartHoverSelector } from "@/components/charts/chart-context";
import { Grid } from "@/components/charts/grid";
import { Line } from "@/components/charts/line";
import { LineChart } from "@/components/charts/line-chart";
import { PieCenter } from "@/components/charts/pie-center";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { RadarArea } from "@/components/charts/radar-area";
import { RadarAxis } from "@/components/charts/radar-axis";
import { RadarChart } from "@/components/charts/radar-chart";
import { RadarGrid } from "@/components/charts/radar-grid";
import { RadarLabels } from "@/components/charts/radar-labels";
import { Scatter, ScatterChart } from "@/components/charts/scatter-chart";
import { ChartTooltip } from "@/components/charts/tooltip";
import { XAxis } from "@/components/charts/x-axis";
import type { ChartSpec } from "./parts";

type J = Record<string, unknown>;
type Kind = "line" | "area" | "bar" | "scatter" | "pie" | "radar";

const KINDS: Kind[] = ["line", "area", "bar", "scatter", "pie", "radar"];
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const GRID = "rgba(255, 255, 255, 0.12)";

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/−/g, "-")) : NaN);
const minus = (t: string) => t.replace(/^-/, "−");

/** A value as the tooltip shows it: up to 3 significant digits, the unit after. */
function show(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  const t = a >= 1000 ? Math.round(v).toLocaleString("en") : a >= 100 ? v.toFixed(0) : a >= 10 ? String(Number(v.toFixed(1))) : String(Number(v.toPrecision(3)));
  return `${minus(t)}${unit ? ` ${unit}` : ""}`;
}

interface Named {
  name: string;
  values: (number | null)[];
}

interface Table {
  kind: Kind;
  title: string;
  unit: string;
  labels: string[];
  series: Named[];
}

/** A year ("2004"), a month ("2004-07") or a date: the x of a line. */
function dateOf(x: string): Date | null {
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(x.trim());
  if (!m) return null;
  return new Date(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1);
}

/** The block as one table: labels across, one row per series. Tool chart ids join on the year. */
export function tableOf(spec: J, charts: Map<string, ChartSpec>): Table | null {
  let kind = (KINDS.includes(spec.chart as Kind) ? spec.chart : "line") as Kind;
  const title = str(spec.title);
  let unit = str(spec.unit);
  const ids = (Array.isArray(spec.ids) ? spec.ids : []).map((id) => charts.get(str(id))).filter((c): c is ChartSpec => !!c);
  let labels: string[] = [];
  let series: Named[] = [];
  if (ids.length) {
    const years = [...new Set(ids.flatMap((c) => c.series.map(([y]) => y)))].sort((a, b) => a - b);
    labels = years.map(String);
    const names = Array.isArray(spec.names) ? spec.names.map(str) : [];
    series = ids.slice(0, 5).map((c, i) => {
      const by = new Map(c.series.map(([y, v]) => [y, v]));
      return { name: names[i] || c.caption, values: years.map((y) => by.get(y) ?? null) };
    });
    unit ||= ids[0].unit;
  } else {
    labels = (Array.isArray(spec.x) ? spec.x : []).map(str);
    series = (Array.isArray(spec.series) ? spec.series : [])
      .filter((r): r is J => !!r && typeof r === "object")
      .slice(0, 5)
      .map((r, i) => ({
        name: str(r.name) || `Series ${i + 1}`,
        values: labels.map((_, j) => {
          const v = num(Array.isArray(r.values) ? r.values[j] : undefined);
          return Number.isFinite(v) ? v : null;
        }),
      }));
  }
  series = series.filter((r) => r.values.some((v) => v !== null));
  if (labels.length < 2 || !series.length) return null;
  // Lines need dates along x; labels that are not years are compared as bars instead.
  if ((kind === "line" || kind === "area" || kind === "scatter") && !labels.every((l) => dateOf(l))) kind = "bar";
  return { kind, title, unit, labels: labels.slice(0, 200), series };
}

export function Plot({ spec, charts }: { spec: J; charts: Map<string, ChartSpec> }) {
  const t = tableOf(spec, charts);
  if (!t) return null;
  return (
    <section className="viz viz-plot" data-kind={t.kind}>
      {t.title && <p className="viz-title">{t.title}</p>}
      {t.kind === "pie" ? <Pie t={t} /> : t.kind === "radar" ? <Radar t={t} /> : t.kind === "bar" ? <Bars t={t} /> : <Over t={t} />}
      {t.kind === "radar" && <Legend t={t} />}
      {t.kind !== "pie" && t.kind !== "radar" && <p className="viz-foot">{foot(t)}</p>}
    </section>
  );
}

/** Under the chart: the unit and, where there is no y axis, the lowest and highest values so the height means something. */
function foot(t: Table): string {
  const all = t.series.flatMap((r) => r.values).filter((v): v is number => v !== null);
  const range = t.kind === "bar" ? "" : `lowest ${show(Math.min(...all), "")}, highest ${show(Math.max(...all), "")}`;
  return [t.unit, range].filter(Boolean).join(" · ");
}

/** Row objects keyed s0, s1… so any series name is safe as a key. */
function rows(t: Table, x: (label: string) => unknown) {
  return t.labels.map((l, j) => {
    const row: J = { x: x(l) };
    t.series.forEach((r, i) => {
      if (r.values[j] !== null) row[`s${i}`] = r.values[j];
    });
    return row;
  });
}

/** The hovered label under the crosshair, drawn here: bklit's rolling ticker slips out of line inside the chat's text styles. */
const pill = ({ label }: { label: string }) => <span className="viz-pill">{label}</span>;

/** Series names in their colours, for charts whose numbers show in the hover box. */
function Legend({ t }: { t: Table }) {
  return (
    <ul className="viz-plot-key">
      {t.series.map((r, i) => (
        <li key={r.name} style={{ color: COLORS[i] }}>
          <span>{r.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The hover box for dots and bars: each series' name and value. It floats on the page
 * (patched tooltip-box.tsx), so the chat's edge cannot cut it off.
 */
function boxTip(t: Table) {
  const unit = t.unit.length <= 4 ? t.unit : "";
  return {
    rows: (p: J) =>
      t.series.flatMap((r, i) => (typeof p[`s${i}`] === "number" ? [{ color: COLORS[i], label: r.name, value: show(p[`s${i}`] as number, unit) }] : [])),
  };
}

/** Reports the hovered row to the key below a line or area chart, which draw no hover box. */
function HoverIndex({ onChange }: { onChange: (i: number | null) => void }) {
  const i = useChartHoverSelector((h) => h.tooltipData?.index ?? null);
  useEffect(() => onChange(i), [i, onChange]);
  return null;
}

/**
 * The key: each series with its value at the hovered row, or at `rest` when nothing is hovered.
 * It sits under the chart, so the lines ahead and behind the cursor stay in view.
 */
function Key({ t, data, labels, at, rest, restNote }: { t: Table; data: J[]; labels: string[]; at: number | null; rest: number; restNote: string }) {
  const i = at ?? rest;
  const row = data[i];
  if (!row) return null;
  return (
    <div className="viz-plot-readout" data-live={at !== null ? "" : undefined}>
      <p className="viz-plot-at">
        <b>{labels[i]}</b>
        {at === null && restNote && <span>{restNote}</span>}
      </p>
      <ul className="viz-plot-key viz-plot-key-col">
        {t.series.map((r, k) => (
          <li key={r.name} style={{ color: COLORS[k] }}>
            <span>{r.name}</span>
            <b>{show(typeof row[`s${k}`] === "number" ? (row[`s${k}`] as number) : NaN, t.unit.length <= 4 ? t.unit : "")}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lines, areas and dots over time. */
function Over({ t }: { t: Table }) {
  const [at, setAt] = useState<number | null>(null);
  // A gap in one series would break the line: keep the years every series has.
  const data = rows(t, (l) => dateOf(l)).filter((r) => t.series.every((_, i) => typeof r[`s${i}`] === "number"));
  if (data.length < 2) return null;
  const monthly = t.labels.some((l) => l.includes("-"));
  const when = (d: Date) => (monthly ? d.toLocaleDateString("en", { month: "short", year: "numeric" }) : String(d.getFullYear()));
  const labels = data.map((r) => when(r.x as Date));
  const common = { data, xDataKey: "x", aspectRatio: "2.2 / 1", margin: { top: 16, right: 12, bottom: 28, left: 12 } };
  // Lines and areas: no box over the trend; the key under the chart reads out the hovered year.
  // Dots: the box beside the hovered dot.
  const dots = t.kind === "scatter";
  const hover = (
    <>
      <XAxis labels={labels} numTicks={Math.min(5, data.length)} />
      {dots ? (
        <ChartTooltip {...boxTip(t)} dateLabels={labels} formatTitle={when} datePill={pill} />
      ) : (
        <ChartTooltip hideBox dateLabels={labels} formatTitle={when} datePill={pill} />
      )}
      {!dots && <HoverIndex onChange={setAt} />}
    </>
  );
  const chart =
    t.kind === "scatter" ? (
      <ScatterChart {...common} formatXLabel={when}>
        <Grid horizontal stroke={GRID} />
        {t.series.map((_, i) => (
          <Scatter key={i} dataKey={`s${i}`} fill={COLORS[i]} radius={3.5} />
        ))}
        {hover}
      </ScatterChart>
    ) : t.kind === "area" ? (
      <AreaChart {...common}>
        <Grid horizontal stroke={GRID} />
        {t.series.map((_, i) => (
          <Area key={i} dataKey={`s${i}`} fill={COLORS[i]} stroke={COLORS[i]} fillOpacity={0.25} />
        ))}
        {hover}
      </AreaChart>
    ) : (
      <LineChart {...common} floating>
        <Grid horizontal stroke={GRID} />
        {t.series.map((_, i) => (
          <Line key={i} dataKey={`s${i}`} stroke={COLORS[i]} strokeWidth={2} />
        ))}
        {hover}
      </LineChart>
    );
  return (
    <>
      {chart}
      {dots ? <Legend t={t} /> : <Key t={t} data={data} labels={labels} at={at} rest={data.length - 1} restNote="latest · hover the chart for any year" />}
    </>
  );
}

/** Labelled things side by side; sideways when the labels are long. */
function Bars({ t }: { t: Table }) {
  const data = rows(t, (l) => l);
  const sideways = t.labels.some((l) => l.length > 10) || t.labels.length > 8;
  const one = t.series.length === 1;
  return (
    <>
      <BarChart
        data={data}
        xDataKey="x"
        orientation={sideways ? "horizontal" : "vertical"}
        aspectRatio={sideways ? `2 / ${Math.max(1, t.labels.length * 0.22).toFixed(2)}` : "2.2 / 1"}
        margin={sideways ? { top: 8, right: 16, bottom: 8, left: 110 } : { top: 16, right: 12, bottom: 28, left: 12 }}
      >
        <Grid horizontal={!sideways} vertical={sideways} stroke={GRID} />
        {t.series.map((_, i) => (
          <Bar key={i} dataKey={`s${i}`} fill={COLORS[i]} showValue={one} valueLabelFormatter={(v) => show(v, "")} />
        ))}
        {sideways ? <BarYAxis /> : <BarXAxis />}
        {/* One series already prints its values on the bars. */}
        {!one && <ChartTooltip {...boxTip(t)} datePill={pill} />}
      </BarChart>
      {!one && <Legend t={t} />}
    </>
  );
}

/** Shares of one whole: the first series only. */
function Pie({ t }: { t: Table }) {
  const r = t.series[0];
  const data = t.labels.map((label, j) => ({ label, value: r.values[j] ?? 0, color: COLORS[j % COLORS.length] })).filter((d) => d.value > 0);
  if (!data.length) return null;
  return (
    <div className="viz-plot-round">
      <PieChart data={data} size={220} innerRadius={62} padAngle={0.02} cornerRadius={4}>
        {data.map((_, i) => (
          <PieSlice key={i} index={i} />
        ))}
        <PieCenter defaultLabel={r.name} suffix={t.unit && t.unit.length <= 4 ? ` ${t.unit}` : undefined} />
      </PieChart>
      <ul className="viz-plot-key viz-plot-key-col">
        {data.map((d) => (
          <li key={d.label} style={{ color: d.color }}>
            <span>{d.label}</span> <b>{show(d.value, t.unit)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Several measures at once: each axis scaled to its largest value, so different units fit on one web. */
function Radar({ t }: { t: Table }) {
  if (t.labels.length < 3) return <Bars t={t} />;
  const metrics = t.labels.map((label, j) => ({ key: `m${j}`, label }));
  const top = t.labels.map((_, j) => Math.max(...t.series.map((r) => Math.abs(r.values[j] ?? 0))) || 1);
  const data = t.series.map((r, i) => ({
    label: r.name,
    color: COLORS[i],
    values: Object.fromEntries(t.labels.map((_, j) => [`m${j}`, (Math.abs(r.values[j] ?? 0) / top[j]) * 100])),
  }));
  return (
    <div className="viz-plot-round">
      <RadarChart data={data} metrics={metrics} size={260} levels={4}>
        <RadarGrid showLabels={false} stroke={GRID} />
        <RadarAxis stroke={GRID} />
        {data.map((_, i) => (
          <RadarArea key={i} index={i} />
        ))}
        <RadarLabels fontSize={11} />
      </RadarChart>
    </div>
  );
}

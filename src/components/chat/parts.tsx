"use client";

// Pieces of a detective reply: the plan, the trail of tool steps (with small
// charts) and the number check. The answer itself is drawn in blocks.tsx.

import { useState, type CSSProperties, type ReactNode } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import { LAYER_INFO } from "@/lib/layers";
import type { Layer } from "@/lib/regions";
import type { CheckData, PlanData, Series } from "@/lib/agent/view";

/* ------------------------------------------------------------------ */
/* Tool parts                                                          */

export interface ToolPart {
  toolName: string;
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error" | string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export function toolParts(m: UIMessage): ToolPart[] {
  return m.parts.filter(isToolUIPart).map((p) => ({
    ...p,
    toolName: "toolName" in p ? p.toolName : p.type.slice(5),
  })) as ToolPart[];
}

/** Tool results arrive as JSON text. */
export function parseOutput(o: unknown): Record<string, unknown> | null {
  if (o == null) return null;
  if (typeof o === "object") {
    // LangChain ToolMessage objects carry the text in `content`.
    const c = (o as { content?: unknown; kwargs?: { content?: unknown } }).kwargs?.content ?? (o as { content?: unknown }).content;
    if (typeof c === "string") return parseOutput(c);
    return o as Record<string, unknown>;
  }
  if (typeof o !== "string") return null;
  try {
    return JSON.parse(o);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */

export function Plan({ data, done, answering }: { data: PlanData; done: number; answering: boolean }) {
  return (
    <section className="chat-plan" aria-label="Plan">
      <p className="chat-plan-goal">{data.goal}</p>
      <ol>
        {data.steps.map((s, i) => (
          <li key={i} data-done={answering || i < done ? "" : undefined}>
            {s}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Trail of tool steps                                                 */

type I = Record<string, unknown>;
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const layerName = (l: unknown) => (typeof l === "string" && l in LAYER_INFO ? LAYER_INFO[l as Layer].measure.toLowerCase() : "record");
const placeOf = (i: I, o: I | null) => {
  const p = o?.place;
  if (p && typeof p === "object" && "name" in p) return str((p as { name: unknown }).name);
  return str(p) || str(i.place) || str(i.query);
};

/** What a step did, in plain words, while running and once done. */
function describe(t: ToolPart): { doing: string; did: string } {
  const i = (t.input ?? {}) as I;
  const o = parseOutput(t.output);
  const place = placeOf(i, o);
  const what = layerName(i.layer);
  const season = str(i.season) ? `, ${str(i.season)}` : "";
  switch (t.toolName) {
    case "list_places":
      return { doing: "Checking which places have records", did: "Checked which places have records" };
    case "find_place":
      return { doing: `Finding ${place}`, did: `Found ${place}` };
    case "get_trend":
      return { doing: `Testing ${place}’s ${what} record${season}`, did: `Tested ${place}’s ${what} record${season}` };
    case "compare_places":
      return {
        doing: `Comparing ${what} in ${(i.places as string[] | undefined)?.length ?? "several"} places`,
        did: `Compared ${what} in ${(i.places as string[] | undefined)?.length ?? "several"} places`,
      };
    case "versus_world":
      return { doing: `Measuring ${place} against the whole Earth`, did: `Measured ${place} against the whole Earth` };
    case "season_breakdown":
      return { doing: `Splitting ${place}’s ${what} by season`, did: `Split ${place}’s ${what} by season` };
    case "monthly_pattern":
      return { doing: `Reading ${place}’s months`, did: `Read ${place}’s months` };
    case "daily_extremes":
      return { doing: `Counting extreme days in ${place}`, did: `Counted extreme days in ${place}` };
    case "water_storage":
      return { doing: `Weighing the water under ${place || "the area"}`, did: `Weighed the water under ${place || "the area"} (GRACE)` };
    case "nasa_power": {
      const ps = ((i.parameters as string[] | undefined) ?? []).join(", ");
      return { doing: `Reading ${ps} for ${place || "the area"}`, did: `Read ${ps} for ${place || "the area"}` };
    }
    case "scan_region": {
      const p = str(i.parameter) === "WATER_STORAGE" ? "water storage" : str(i.parameter);
      return { doing: `Scanning ${p} across ${place || "the area"}`, did: `Scanned ${p} across ${place || "the area"}` };
    }
    case "calculate":
      return { doing: "Working out the numbers", did: "Worked out the numbers" };
    case "power_parameters":
      return { doing: `Looking up NASA POWER variables for “${str(i.search)}”`, did: `Looked up NASA POWER variables for “${str(i.search)}”` };
    case "web_search":
      return { doing: `Searching the web: ${str(i.objective)}`, did: `Searched the web: ${str(i.objective)}` };
    case "show_in_app":
      return { doing: `Opening ${place}`, did: `Opened ${str(o?.placeName) || place} on the globe` };
    default:
      return { doing: t.toolName, did: t.toolName };
  }
}

/** One line of result under a finished step. */
function finding(t: ToolPart): ReactNode {
  const o = parseOutput(t.output);
  if (!o) return null;
  if (typeof o.error === "string") return <span className="is-error">{o.error}</span>;
  switch (t.toolName) {
    case "get_trend":
      return o.rate ? (
        <>
          <b>{str(o.verdict)}</b> · {str(o.rate)} · {Number(o.firstYear)}–{Number(o.lastYear)}
        </>
      ) : (
        str(o.verdict)
      );
    case "versus_world":
      return o.timesTheWorldRate != null ? (
        <>
          {str(o.placeRate)} against the world’s {str(o.worldRate)}
        </>
      ) : (
        str(o.note)
      );
    case "compare_places": {
      const rows = (o.ranked as { place: string; rate: string; significant: boolean }[] | undefined) ?? [];
      return (
        <ul className="chat-rank">
          {rows.slice(0, 6).map((r) => (
            <li key={r.place} data-flat={r.significant ? undefined : ""}>
              <span>{r.place}</span>
              <span>{r.rate.replace(/ (per decade|of water per decade)$/, "")}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "season_breakdown": {
      const rows = (o.seasons as { season: string; rate?: string; verdict: string; significant?: boolean }[] | undefined) ?? [];
      return (
        <ul className="chat-rank">
          {rows.map((r) => (
            <li key={r.season} data-flat={r.significant ? undefined : ""}>
              <span>{r.season}</span>
              <span>{r.rate?.replace(/ (per decade|of water per decade)$/, "") ?? r.verdict}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "water_storage":
      return o.perDecadeText ? (
        <>
          <b>{str(o.trend)}</b> · {str(o.perDecadeText)} · {Number(o.waterVolumeChangePerYearKm3)} km³ a year
        </>
      ) : (
        str(o.trend)
      );
    case "nasa_power": {
      const rows = (o.results as { parameter: string; perDecadeText?: string; trend?: string; significant?: boolean; error?: string }[] | undefined) ?? [];
      return (
        <ul className="chat-rank">
          {rows.map((r) => (
            <li key={r.parameter} data-flat={r.significant ? undefined : ""}>
              <span>{r.parameter}</span>
              <span>{r.error ?? r.perDecadeText?.replace(/ per decade$/, "") ?? r.trend}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "scan_region":
      return (
        <>
          <b>{Number(o.cellsRisingSignificantly)}</b> of {Number(o.cells)} cells rising, <b>{Number(o.cellsFallingSignificantly)}</b> falling
        </>
      );
    case "calculate": {
      const rows = (o.results as { label: string; result?: number; error?: string }[] | undefined) ?? [];
      return (
        <ul className="chat-rank">
          {rows.map((r) => (
            <li key={r.label}>
              <span>{r.label}</span>
              <span>{r.error ?? r.result}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "power_parameters": {
      const rows = (o.matches as { code: string; name?: string }[] | undefined) ?? [];
      return (
        <ul className="chat-rank">
          {rows.slice(0, 6).map((r) => (
            <li key={r.code}>
              <span>{r.code}</span>
              <span>{r.name}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "web_search": {
      const rows = (o.results as { url: string; title?: string | null; published?: string | null }[] | undefined) ?? [];
      return (
        <ul className="chat-rank">
          {rows.slice(0, 6).map((r) => (
            <li key={r.url}>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.title || r.url}
              </a>
              <span>{hostOf(r.url)}{r.published ? `, ${r.published.slice(0, 4)}` : ""}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "find_place":
      return Array.isArray(o.questions) ? `Records: ${(o.questions as string[]).map((q) => layerName(q)).join(", ")}` : null;
    default:
      return null;
  }
}

export function Trail({ tools, live }: { tools: ToolPart[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const expanded = live || open;
  return (
    <section className="chat-trail" aria-label="Investigation">
      {!live && (
        <button type="button" className="chat-trail-toggle" aria-expanded={expanded} onClick={() => setOpen((v) => !v)}>
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="m6 4 4 4-4 4" />
          </svg>
          Investigated in {tools.length} {tools.length === 1 ? "step" : "steps"}
        </button>
      )}
      {expanded && (
        <ol>
          {tools.map((t) => (
            <Step key={t.toolCallId} t={t} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Step({ t }: { t: ToolPart }) {
  const running = t.state === "input-streaming" || t.state === "input-available";
  const failed = t.state === "output-error" || !!parseOutput(t.output)?.error;
  const { doing, did } = describe(t);
  return (
    <li className="chat-step" data-state={running ? "running" : failed ? "failed" : "done"}>
      <span className="chat-step-mark" aria-hidden>
        {running ? <span className="spinner" /> : failed ? "!" : <Tick />}
      </span>
      <div>
        <p>{running ? `${doing}…` : did}</p>
        {!running && <div className="chat-step-result">{t.state === "output-error" ? <span className="is-error">{t.errorText}</span> : finding(t)}</div>}
        {!running && <ToolChart t={t} />}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */

/** One yearly series from a tool result, ready to draw. */
export interface ChartSpec {
  id: string;
  series: Series;
  caption: string;
  verdict: string;
  rate: string;
  rateValue: number;
  significant: boolean;
  unit: string;
  hue: { up: string; down: string };
}

const NEUTRAL = { up: "#ffb86b", down: "#6bb8ff" };

/** Every chart a tool result carries (the server tags each series with a chart id). */
export function chartsOf(t: ToolPart): ChartSpec[] {
  if (t.state !== "output-available") return [];
  const o = parseOutput(t.output);
  if (!o) return [];
  const name = (o.place as { name?: string } | undefined)?.name ?? "";
  const make = (r: I, caption: string, extra: Partial<ChartSpec> = {}): ChartSpec[] =>
    typeof r.chart === "string" && Array.isArray(r.series) && r.series.length > 1
      ? [
          {
            id: r.chart,
            series: r.series as Series,
            caption,
            verdict: str(r.trend) || str(r.verdict),
            rate: str(r.perDecadeText) || str(r.rate),
            rateValue: Number(r.perDecade ?? r.rateValue ?? 0),
            significant: !!r.significant,
            unit: "",
            hue: NEUTRAL,
            ...extra,
            // POWER writes "1" or "-" for a unitless quantity (soil wetness, cloud fraction).
            ...(extra.unit === "1" || extra.unit === "-" ? { unit: "" } : {}),
          },
        ]
      : [];
  switch (t.toolName) {
    case "get_trend": {
      const layer = (t.input as I | undefined)?.layer;
      const info = typeof layer === "string" && layer in LAYER_INFO ? LAYER_INFO[layer as Layer] : null;
      const season = (t.input as I | undefined)?.season;
      const names: Record<string, string> = { djf: "Dec–Feb", mam: "Mar–May", jja: "Jun–Aug", son: "Sep–Nov", post: "post-monsoon" };
      const when = typeof season === "string" && season !== "annual" ? `${names[season] ?? season} ` : "";
      return make(o, `${name} · ${when}${info?.measure.toLowerCase() ?? "record"}`, { hue: info?.hue ?? NEUTRAL });
    }
    case "water_storage":
      return make(o, `${name} · water stored on land`, { unit: "mm", hue: LAYER_INFO.groundwater.hue });
    case "scan_region": {
      const w = (o.wholeArea as I | undefined) ?? {};
      return make({ ...w, chart: o.chart, series: o.series }, `${name} · ${str(o.name).toLowerCase()}`, { unit: o.parameter === "WATER_STORAGE" ? "mm" : str(o.units) });
    }
    case "nasa_power": {
      const season = seasonOf((t.input as I | undefined)?.months);
      return ((o.results as I[] | undefined) ?? []).flatMap((r) => make(r, `${name} · ${season ? `${season} ` : ""}${str(r.name).toLowerCase()}`, { unit: str(r.units) }));
    }
    default:
      return [];
  }
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** [6,7,8,9] → "Jun–Sep", [12,1,2] → "Dec–Feb"; a scattered pick lists each month. */
function seasonOf(v: unknown): string {
  if (!Array.isArray(v) || !v.length || v.length >= 12) return "";
  const m = v.map(Number).filter((x) => x >= 1 && x <= 12);
  const run = m.every((x, i) => i === 0 || x === (m[i - 1] % 12) + 1);
  if (m.length === 1) return MON[m[0] - 1];
  return run ? `${MON[m[0] - 1]}–${MON[m[m.length - 1] - 1]}` : m.map((x) => MON[x - 1]).join(", ");
}

/** The small charts under a step in the trail. */
function ToolChart({ t }: { t: ToolPart }) {
  return (
    <>
      {chartsOf(t).map((c) => (
        <TrendChart key={c.id} spec={c} />
      ))}
    </>
  );
}

const Tick = () => (
  <svg viewBox="0 0 16 16">
    <path d="m4 8.5 2.5 2.5L12 5.5" />
  </svg>
);

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)).replace("-", "−");

/** A yearly chart. `big` is the version placed in the answer: titled, with its range and rate. */
export function TrendChart({ spec, big }: { spec: ChartSpec; big?: boolean }) {
  const { series } = spec;
  const tone = !spec.significant ? "rgba(235,235,245,0.5)" : spec.rateValue > 0 ? spec.hue.up : spec.hue.down;

  const W = 300;
  const H = big ? 86 : 64;
  const pad = 4;
  const xs = series.map((d) => d[0]);
  const ys = series.map((d) => d[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const x = (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - pad * 2);
  const line = series.map(([a, b]) => `${x(a).toFixed(1)},${y(b).toFixed(1)}`).join(" ");
  const area = `${x(x0).toFixed(1)},${H} ${line} ${x(x1).toFixed(1)},${H}`;

  // Least squares only for the drawn guide; the numbers come from Sen's slope.
  const n = series.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const k = xs.reduce((a, xv, i) => a + (xv - mx) * (ys[i] - my), 0) / (xs.reduce((a, xv) => a + (xv - mx) ** 2, 0) || 1);

  return (
    <figure className="chat-chart" data-big={big ? "" : undefined} style={{ "--tone": tone } as CSSProperties}>
      <figcaption>
        <span>{spec.caption}</span>
        {big && spec.rate ? <b>{spec.rate.replace(/^-/, "−")}</b> : <b>{spec.verdict}</b>}
      </figcaption>
      <div className="chat-chart-plot">
        {big && (
          <div className="chat-chart-y" aria-hidden>
            <span>
              {fmt(y1)}
              {spec.unit && spec.unit.length <= 8 ? ` ${spec.unit}` : ""}
            </span>
            <span>{fmt(y0)}</span>
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${spec.caption} each year, ${x0} to ${x1}: ${spec.verdict}`}>
          {big && <polygon className="chat-chart-area" points={area} />}
          <polyline className="chat-chart-line" points={line} />
          {spec.significant ? <line className="chat-chart-trend" x1={x(x0)} y1={y(my + k * (x0 - mx))} x2={x(x1)} y2={y(my + k * (x1 - mx))} /> : null}
        </svg>
      </div>
      <div className="chat-chart-axis">
        <span>{x0}</span>
        {big && <span>{spec.significant ? spec.verdict : "no clear trend"}</span>}
        <span>{x1}</span>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Number check                                                        */

export function Check({ data }: { data: CheckData }) {
  const all = data.traced === data.total;
  return (
    <p className="chat-check" data-ok={all ? "" : undefined}>
      {all ? <Tick /> : <span aria-hidden>!</span>}
      {all
        ? `All ${data.total} ${data.total === 1 ? "number traces" : "numbers trace"} back to the NASA records`
        : `${data.traced} of ${data.total} numbers trace back to the NASA records. Not found: ${data.untraced.join(", ")}`}
    </p>
  );
}

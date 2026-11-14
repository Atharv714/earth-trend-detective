"use client";

// The answer, drawn as a stack of small cards. The model writes markdown with
// ```viz blocks (one JSON object each, kinds listed in prompts.ts); this file
// turns them into a verdict, stat tiles, charts, bars, meters, a side-by-side,
// a timeline, folded fine print and tappable follow-ups.

import type { CSSProperties, ReactNode } from "react";
import { TrendChart, type ChartSpec } from "./parts";

type Tone = "bad" | "good" | "mixed" | "neutral";
type J = Record<string, unknown>;

const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arr = <T = J,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const tone = (v: unknown): Tone => (v === "bad" || v === "good" || v === "mixed" ? v : "neutral");
const minus = (t: string) => t.replace(/^-/, "−");

/* ------------------------------------------------------------------ */
/* Text                                                                */

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** Bold, italics and links. A link is a source, so it shows as a small tag. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g).map((bit, i) => {
    if (bit.startsWith("**") && bit.endsWith("**")) return <strong key={i}>{inline(bit.slice(2, -2))}</strong>;
    if (bit.length > 2 && bit.startsWith("*") && bit.endsWith("*")) return <em key={i}>{inline(bit.slice(1, -1))}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(bit);
    if (link) {
      const url = link[2];
      const safe = /^https?:\/\//.test(url);
      return safe ? (
        <a key={i} className="chat-src" href={url} target="_blank" rel="noreferrer" title={host(url)}>
          {link[1]}
        </a>
      ) : (
        link[1]
      );
    }
    return bit;
  });
}

/** Headings, bullet lists, numbered lists and short paragraphs. */
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{inline(para.join(" "))}</p>);
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      out.push(
        <Tag key={out.length}>
          {list.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </Tag>,
      );
    }
    para = [];
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const item = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (/^#{1,4}\s+/.test(line)) {
      flush();
      out.push(<h3 key={out.length}>{inline(line.replace(/^#{1,4}\s+/, ""))}</h3>);
    } else if (item) {
      const ordered = /^\d/.test(item[1]);
      if (para.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[2]);
    } else if (list) {
      // A wrapped list line belongs to the item above it.
      list.items[list.items.length - 1] += ` ${line}`;
    } else para.push(line);
  }
  flush();
  return <>{out}</>;
}

/* ------------------------------------------------------------------ */
/* Splitting the answer                                                */

type Piece = { kind: "md"; text: string } | { kind: "viz"; spec: J | null; done: boolean };

const FENCE = /```(viz|json)[^\n]*\n([\s\S]*?)(?:```|$)/g;

export function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(FENCE)) {
    const before = text.slice(at, m.index);
    if (before.trim()) out.push({ kind: "md", text: before });
    const done = m[0].trimEnd().endsWith("```") && m[0].length > m[1].length + 6;
    let spec: J | null = null;
    try {
      spec = JSON.parse(m[2]) as J;
    } catch {
      spec = null;
    }
    // A ```json block that is not one of ours is shown as plain text.
    if (m[1] === "json" && (!spec || typeof spec.type !== "string")) out.push({ kind: "md", text: m[2] });
    else out.push({ kind: "viz", spec, done });
    at = (m.index ?? 0) + m[0].length;
  }
  const rest = text.slice(at);
  if (rest.trim()) out.push({ kind: "md", text: rest });
  return out;
}

/* ------------------------------------------------------------------ */
/* The answer                                                          */

export function Answer({ text, charts, onAsk, live }: { text: string; charts: Map<string, ChartSpec>; onAsk?: (q: string) => void; live?: boolean }) {
  return (
    <div className="chat-answer">
      {pieces(text).map((p, i) =>
        p.kind === "md" ? (
          <Markdown key={i} text={p.text} />
        ) : p.spec ? (
          <Viz key={i} spec={p.spec} charts={charts} onAsk={live ? undefined : onAsk} />
        ) : p.done ? null : (
          <div key={i} className="viz viz-loading" aria-hidden />
        ),
      )}
    </div>
  );
}

function Viz({ spec, charts, onAsk }: { spec: J; charts: Map<string, ChartSpec>; onAsk?: (q: string) => void }) {
  switch (spec.type) {
    case "verdict":
      return <Verdict spec={spec} />;
    case "stats":
      return <Stats spec={spec} />;
    case "chart":
      return <Charts spec={spec} charts={charts} />;
    case "bars":
      return <Bars spec={spec} />;
    case "meter":
      return <Meter spec={spec} />;
    case "versus":
      return <Versus spec={spec} />;
    case "timeline":
      return <Timeline spec={spec} />;
    case "details":
      return <Details spec={spec} />;
    case "next":
      return <Next spec={spec} onAsk={onAsk} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */

function Verdict({ spec }: { spec: J }) {
  return (
    <section className="viz viz-verdict" data-tone={tone(spec.tone)}>
      <p className="viz-verdict-title">{inline(s(spec.title))}</p>
      {s(spec.text) && <p className="viz-verdict-text">{inline(s(spec.text))}</p>}
    </section>
  );
}

function Stats({ spec }: { spec: J }) {
  const items = arr(spec.items).slice(0, 4);
  if (!items.length) return null;
  return (
    <section className="viz viz-stats" style={{ "--n": items.length } as CSSProperties}>
      {items.map((it, i) => {
        // A unit of a symbol or two sits beside the number ("%", "mm"); anything longer gets its own line.
        const unit = s(it.unit);
        const short = unit.length <= 3;
        return (
          <div key={i} className="viz-stat" data-tone={tone(it.tone)}>
            <p className="viz-stat-value">
              {minus(s(it.value))}
              {unit && short && <span> {unit}</span>}
            </p>
            {unit && !short && <p className="viz-stat-unit">{unit}</p>}
            <p className="viz-stat-label">{s(it.label)}</p>
          </div>
        );
      })}
    </section>
  );
}

function Charts({ spec, charts }: { spec: J; charts: Map<string, ChartSpec> }) {
  const found = arr<string>(spec.ids)
    .map((id) => charts.get(id))
    .filter((c): c is ChartSpec => !!c)
    .slice(0, 3);
  if (!found.length) return null;
  return (
    <section className="viz viz-charts">
      {s(spec.title) && <p className="viz-title">{s(spec.title)}</p>}
      {found.map((c) => (
        <TrendChart key={c.id} spec={c} big />
      ))}
    </section>
  );
}

function Bars({ spec }: { spec: J }) {
  const items = arr(spec.items)
    .map((it) => ({ label: s(it.label), value: Number(it.value), tone: it.tone }))
    .filter((it) => Number.isFinite(it.value))
    .slice(0, 8);
  if (!items.length) return null;
  const max = Math.max(...items.map((it) => Math.abs(it.value))) || 1;
  const signed = items.some((it) => it.value < 0) && items.some((it) => it.value > 0);
  const unit = s(spec.unit);
  return (
    <section className="viz viz-bars" data-signed={signed ? "" : undefined} data-tone={tone(spec.tone)}>
      {s(spec.title) && <p className="viz-title">{s(spec.title)}</p>}
      <ul>
        {items.map((it, i) => {
          const w = (Math.abs(it.value) / max) * (signed ? 50 : 100);
          const style = { "--w": `${w}%`, "--x": signed ? (it.value < 0 ? `${50 - w}%` : "50%") : "0%" } as CSSProperties;
          return (
            <li key={i} data-dir={it.value < 0 ? "down" : "up"} data-tone={it.tone ? tone(it.tone) : undefined}>
              <span className="viz-bar-label">{it.label}</span>
              <span className="viz-bar-track">
                <span className="viz-bar" style={style} />
              </span>
              <span className="viz-bar-value">
                {minus(String(it.value))}
                {unit && unit.length <= 4 ? ` ${unit}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {unit && unit.length > 4 && <p className="viz-foot">{unit}</p>}
    </section>
  );
}

function Meter({ spec }: { spec: J }) {
  const value = Number(spec.value);
  const limit = Number(spec.limit);
  if (!Number.isFinite(value)) return null;
  const top = Math.max(value, Number.isFinite(limit) ? limit : 0) * 1.12 || 1;
  const unit = s(spec.unit);
  return (
    <section className="viz viz-meter" data-tone={tone(spec.tone)}>
      <p className="viz-meter-head">
        <span>{s(spec.label)}</span>
        <b>
          {minus(String(value))}
          {unit}
        </b>
      </p>
      <div className="viz-meter-track">
        <span className="viz-meter-fill" style={{ width: `${(Math.max(0, value) / top) * 100}%` }} />
        {Number.isFinite(limit) && (
          <span className="viz-meter-limit" style={{ left: `${(limit / top) * 100}%` }}>
            <span>
              {s(spec.limitLabel) || "limit"} {limit}
              {unit}
            </span>
          </span>
        )}
      </div>
    </section>
  );
}

function Versus({ spec }: { spec: J }) {
  const sides = [spec.left, spec.right].filter((x): x is J => !!x && typeof x === "object");
  if (sides.length < 2) return null;
  return (
    <section className="viz viz-versus">
      {sides.map((side, i) => (
        <div key={i} data-tone={tone(side.tone)}>
          <p className="viz-versus-title">{s(side.title)}</p>
          <ul>
            {arr<string>(side.points).map((pt, j) => (
              <li key={j}>{inline(s(pt))}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Timeline({ spec }: { spec: J }) {
  const items = arr(spec.items);
  if (!items.length) return null;
  return (
    <section className="viz viz-timeline">
      {s(spec.title) && <p className="viz-title">{s(spec.title)}</p>}
      <ol>
        {items.map((it, i) => (
          <li key={i}>
            <b>{s(it.when)}</b>
            <span>{inline(s(it.text))}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Details({ spec }: { spec: J }) {
  return (
    <details className="viz viz-details">
      <summary>{s(spec.title) || "More detail"}</summary>
      <div>
        <Markdown text={s(spec.text)} />
      </div>
    </details>
  );
}

function Next({ spec, onAsk }: { spec: J; onAsk?: (q: string) => void }) {
  const qs = arr<string>(spec.questions).filter((q) => typeof q === "string").slice(0, 3);
  if (!qs.length) return null;
  return (
    <section className="viz viz-next" aria-label="Ask next">
      <p className="viz-title">Ask next</p>
      {qs.map((q) => (
        <button key={q} type="button" disabled={!onAsk} onClick={() => onAsk?.(q)}>
          {q}
        </button>
      ))}
    </section>
  );
}

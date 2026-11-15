"use client";

// "What else changes when it gets hotter?" Pick a measure, drag it above or
// below its usual, and see how the place's other measures behaved in months
// like that. The maths is in src/lib/coupling.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Layer, Region } from "@/lib/regions";
import { formatP, type Season } from "@/lib/series";
import { KNOB_OF_LAYER, howOften, knobsFor, linksFrom, loadKnob, wobble, type Knob, type Link, type Wobble } from "@/lib/coupling";
import { niceTicks, useWidth } from "./charts";
import { Info, Trendmark } from "./ui";

const UP = "#64d2ff";
const DOWN = "#ff9f0a";
const GREY = "rgba(235, 235, 245, 0.3)";

const num = (v: number, d: number) => Math.abs(v).toFixed(d);
const signed = (v: number, d: number) => (Number(num(v, d)) === 0 ? num(v, d) : `${v > 0 ? "+" : "−"}${num(v, d)}`);
const amount = (v: number, k: Knob) => `${num(v, k.digits)}${k.unit === "%" ? "%" : ` ${k.unit}`}`;
const change = (v: number, k: Knob) => `${signed(v, k.digits)}${k.unit === "%" ? "%" : ` ${k.unit}`}`;
const isZero = (v: number, k: Knob) => Number(num(v, k.digits)) === 0;

/** "1.4 °C hotter" */
const pushText = (v: number, k: Knob) => `${amount(v, k)} ${k.more[v > 0 ? 0 : 1].toLowerCase()}`;

function stepFor(span: number) {
  const raw = span / 40;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
}

/** Eases a number toward its target, so the picture visibly shifts. */
function useEased(target: number, ms = 400) {
  const [v, setV] = useState(target);
  const shown = useRef(target);
  useEffect(() => {
    const from = shown.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      shown.current = from + (target - from) * (1 - (1 - t) ** 3);
      setV(shown.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** What one link predicts for a given push. */
function answer(l: Link, push: number) {
  const v = l.slope * push;
  const pct = l.knob.unit !== "%" && l.knob.unit !== "°C" && l.mean > 0 ? (v / l.mean) * 100 : null;
  return { v, pct, z: l.sd ? v / l.sd : 0, lo: (l.slope - 1.96 * l.se) * push, hi: (l.slope + 1.96 * l.se) * push };
}

const later = (lag: number) => (lag === 1 ? "a month later" : `${lag} months later`);

function list(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------------ */

export function Links({ region, layer, range, season }: { region: Region; layer: Layer; range: [number, number]; season: Season }) {
  const knobs = useMemo(() => knobsFor(region), [region]);
  const [loaded, setLoaded] = useState<Wobble[] | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [push, setPush] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showWeak, setShowWeak] = useState(false);

  const [from, to] = range;
  useEffect(() => {
    let alive = true;
    Promise.allSettled(knobs.map((k) => loadKnob(k))).then((res) => {
      if (!alive) return;
      const ws = res.flatMap((r, i) => (r.status === "fulfilled" ? [wobble(knobs[i], r.value, [from, to])] : [])).filter((w): w is Wobble => !!w);
      setLoaded(ws);
    });
    return () => {
      alive = false;
    };
  }, [knobs, from, to]);

  const all = useMemo(() => loaded ?? [], [loaded]);
  const driver = all.find((w) => w.knob.id === driverId) ?? all.find((w) => w.knob.id === KNOB_OF_LAYER[layer]) ?? all[0];
  const links = useMemo(() => (driver ? linksFrom(driver, all, season) : []), [driver, all, season]);

  const span = driver ? Math.max(2 * driver.sd, Math.abs(driver.change ?? 0) * 1.1) : 1;
  const step = stepFor(span);
  const typical = driver ? Math.max(step, Math.round(driver.sd / step) * step) : 0;
  const target = push ?? typical;
  const shown = useEased(target);

  if (all.length < 2 || !driver) return null;

  const k = driver.knob;
  const clear = links.filter((l) => l.significant);
  const weak = links.filter((l) => !l.significant);
  const real = driver.change !== null && Math.abs(driver.change) >= step ? Math.round(driver.change / step) * step : null;
  const inSeason = season.months.length === 12 ? "" : `, ${season.label.toLowerCase()} only`;

  const pick = (id: string) => {
    setDriverId(id);
    setPush(null);
    setOpen(null);
  };

  return (
    <section className="block links">
      <div className="block-head">
        <h2>
          What else changes when {k.when}?
          <Info>
            We compare every month with what is normal for that month, so the seasons don’t count, and we leave out slow changes over the
            years. When two measures keep moving together month after month, they are linked. Soil, plants and groundwater can react a
            month or more later, so we check that too.
          </Info>
        </h2>
      </div>
      <p className="block-note">
        Pick a measure and drag the slider. We show how {region.name}’s other measures behaved in months like that ({from}–{to}
        {inSeason}).
      </p>

      <div className="chips links-drivers" role="radiogroup" aria-label="Measure to change">
        {all.map((w) => (
          <button key={w.knob.id} type="button" role="radio" className="chip" aria-checked={w.knob.id === k.id} onClick={() => pick(w.knob.id)}>
            {w.knob.label}
          </button>
        ))}
      </div>

      <div className="links-control">
        <div className="links-ends">
          <span>{k.more[1]}</span>
          <strong style={{ color: isZero(target, k) ? undefined : target > 0 ? UP : DOWN }}>
            {isZero(target, k) ? "Usual" : `${pushText(target, k)} than usual`}
          </strong>
          <span>{k.more[0]}</span>
        </div>
        <PushSlider value={target} span={span} step={step} onChange={setPush} label={`${k.label} compared with usual`} />
        <div className="chips links-presets">
          <button type="button" className="chip" aria-pressed={target === typical} onClick={() => setPush(typical)}>
            A typical {k.more[0].toLowerCase()} month
          </button>
          {real !== null && (
            <button type="button" className="chip" aria-pressed={target === real} onClick={() => setPush(real)}>
              The change since {from} ({change(real, k)})
            </button>
          )}
        </div>
      </div>

      <Summary region={region} driver={k} links={clear} push={target} />

      <Web driver={driver} links={links} push={shown} open={open} onOpen={setOpen} />

      <ul className="links-list">
        {(showWeak ? [...clear, ...weak] : clear).map((l) => (
          <Row
            key={l.knob.id}
            l={l}
            driver={driver}
            push={shown}
            open={l.knob.id === open}
            onToggle={() => setOpen(open === l.knob.id ? null : l.knob.id)}
          />
        ))}
      </ul>
      {weak.length > 0 && (
        <button type="button" className="link links-more" onClick={() => setShowWeak(!showWeak)}>
          {showWeak ? "Hide" : "Show"} {weak.length} with no clear link
        </button>
      )}

      <p className="links-caveat">This shows what tends to happen together, not what causes what.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function PushSlider({
  value,
  span,
  step,
  onChange,
  label,
}: {
  value: number;
  span: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const max = Math.ceil(span / step) * step;
  const pct = ((value + max) / (2 * max)) * 100;
  return (
    <div className="range links-slider">
      <div className="range-track">
        <span
          className="range-fill"
          style={{ left: `${Math.min(50, pct)}%`, right: `${100 - Math.max(50, pct)}%`, background: value >= 0 ? UP : DOWN }}
        />
        <span className="links-zero" />
        <input type="range" min={-max} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    </div>
  );
}

/** The answer in one sentence, before any chart. */
function Summary({ region, driver, links, push }: { region: Region; driver: Knob; links: Link[]; push: number }) {
  if (isZero(push, driver)) return <p className="links-summary is-quiet">Drag the slider left or right to see what follows.</p>;
  if (!links.length) return <p className="links-summary is-quiet">Nothing else in {region.name} clearly changes when {driver.when}.</p>;
  const top = [...links].sort((a, b) => Math.abs(answer(b, push).z) - Math.abs(answer(a, push).z)).slice(0, 4);
  const word = (l: Link) => l.knob.gets[l.slope * push > 0 ? 0 : 1];
  const now = top.filter((l) => !l.lag).map(word);
  const after = top.filter((l) => l.lag).map(word);
  return (
    <p className="links-summary">
      When a month is {pushText(push, driver)} than usual, {region.name} usually gets <b>{list(now.length ? now : after)}</b>
      {now.length > 0 && after.length > 0 && (
        <>
          , then <b>{list(after)}</b> a month or so later
        </>
      )}
      {!now.length && " a month or so later"}.
    </p>
  );
}

function Row({ l, driver, push, open, onToggle }: { l: Link; driver: Wobble; push: number; open: boolean; onToggle: () => void }) {
  const { v, pct, lo, hi } = answer(l, push);
  const flat = isZero(v, l.knob);
  const color = !l.significant || flat ? undefined : v > 0 ? UP : DOWN;
  const k = driver.knob;
  return (
    <li>
      <button type="button" className="links-row" aria-expanded={open} data-faint={l.significant ? undefined : ""} onClick={onToggle}>
        <Trendmark dir={flat || !l.significant ? "flat" : v > 0 ? "up" : "down"} color={color} size={16} />
        <span className="links-name">
          {l.knob.label}
          <small>{l.significant ? `${howOften(l.r)}${l.lag ? `, ${later(l.lag)}` : ""}` : "No clear link"}</small>
        </span>
        <span className="links-val" style={{ color }}>
          {l.significant ? change(v, l.knob) : "–"}
          {l.significant && pct !== null && Math.abs(pct) >= 1 && <small> ({signed(pct, 0)}%)</small>}
        </span>
        <svg className="links-chev" viewBox="0 0 16 16" aria-hidden>
          <path d="m6 4 4 4-4 4" />
        </svg>
      </button>
      {open && (
        <div className="links-detail">
          <p>
            In months that were {k.more[0].toLowerCase()} than usual, {l.knob.label.toLowerCase()}
            {l.lag ? ` ${later(l.lag)}` : ""} was usually {l.slope > 0 ? "higher" : "lower"}: about {amount(l.slope, l.knob)} for every{" "}
            {amount(1, k)}. {!l.significant && "It happened so unevenly, though, that it could just be chance. "}
            {l.via && `${l.via.knob.label} moves with both, so part of this may really be about ${l.via.knob.label.toLowerCase()}.`}
          </p>
          <Scatter driver={driver} link={l} />
          <p className="links-numbers">
            Behind the numbers: correlation {l.r.toFixed(2)} over {l.n} months, {formatP(l.p)}
            {l.knob.slow ? " (after checking delays of up to 3 months)" : ""}. Likely range for this change: {change(Math.min(lo, hi), l.knob)}{" "}
            to {change(Math.max(lo, hi), l.knob)}.
          </p>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The picture: the measure you change in the middle, the rest around  */
/* it, each moving up or down from where it sits in a usual month.     */

function Web({
  driver,
  links,
  push,
  open,
  onOpen,
}: {
  driver: Wobble;
  links: Link[];
  push: number;
  open: string | null;
  onOpen: (id: string | null) => void;
}) {
  const W = 560;
  const H = 320;
  const cx = W / 2;
  const cy = H / 2;
  const rx = 200;
  const ry = 92;
  const MOVE = 24;
  const ring = [...links].sort((a, b) => a.knob.id.localeCompare(b.knob.id));

  return (
    <div className="links-web-wrap">
      <svg className="links-web" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`How the other measures move when ${driver.knob.when}`}>
        {ring.map((l, i) => {
          const a = -Math.PI / 2 + (i / ring.length) * Math.PI * 2;
          const x = cx + rx * Math.cos(a);
          const y0 = cy + ry * Math.sin(a);
          const { v, z } = answer(l, push);
          const moved = l.significant && !isZero(v, l.knob);
          const y = moved ? y0 - Math.max(-2.2, Math.min(2.2, z)) * MOVE : y0;
          const color = moved ? (v > 0 ? UP : DOWN) : GREY;
          const r = moved ? 6 + Math.min(2.2, Math.abs(z)) * 3 : 4;
          return (
            <g
              key={l.knob.id}
              className="links-node"
              data-on={open === l.knob.id ? "" : undefined}
              onClick={() => onOpen(open === l.knob.id ? null : l.knob.id)}
            >
              <line
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke={color}
                strokeOpacity={moved ? 0.3 + Math.abs(l.r) * 0.6 : 0.5}
                strokeWidth={moved ? 1 + Math.abs(l.r) * 5 : 1}
                strokeDasharray={l.significant ? undefined : "2 4"}
                strokeLinecap="round"
              />
              {moved && <circle cx={x} cy={y0} r={3} fill="none" stroke={GREY} />}
              {moved && <line x1={x} y1={y0} x2={x} y2={y} stroke={GREY} strokeDasharray="2 2" />}
              <circle cx={x} cy={y} r={20} fill="transparent" />
              <circle cx={x} cy={y} r={r} fill={color} />
              <text x={x} y={y - r - 8} textAnchor="middle" className="links-node-label">
                {l.knob.label}
              </text>
              {moved && (
                <text x={x} y={y + r + 16} textAnchor="middle" className="links-node-value" fill={color}>
                  {change(v, l.knob)}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={34} fill="rgba(255,255,255,0.94)" />
        <text x={cx} y={cy - 2} textAnchor="middle" className="links-driver-label">
          {driver.knob.label}
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" className="links-driver-value">
          {change(push, driver.knob)}
        </text>
      </svg>
      <p className="links-legend">
        <span>
          <i style={{ background: UP }} /> Goes up
        </span>
        <span>
          <i style={{ background: DOWN }} /> Goes down
        </span>
        <span>
          <i style={{ background: GREY }} /> No clear link
        </span>
        <span>Thicker line: happens more often</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The evidence for one link: every month as a dot.                    */

function Scatter({ driver, link }: { driver: Wobble; link: Link }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = 200;
  const PAD = { top: 22, right: 10, bottom: 34, left: 44 };
  const xs = link.pairs.map((p) => p[0]);
  const ys = link.pairs.map((p) => p[1]);
  const xt = niceTicks(Math.min(...xs), Math.max(...xs));
  const yt = niceTicks(Math.min(...ys), Math.max(...ys));
  const x0 = Math.min(xt[0], ...xs);
  const x1 = Math.max(xt[xt.length - 1], ...xs);
  const y0 = Math.min(yt[0], ...ys);
  const y1 = Math.max(yt[yt.length - 1], ...ys);
  const w = Math.max(1, width - PAD.left - PAD.right);
  const h = H - PAD.top - PAD.bottom;
  const X = (v: number) => PAD.left + ((v - x0) / (x1 - x0 || 1)) * w;
  const Y = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0 || 1)) * h;
  const color = link.significant ? (link.slope >= 0 ? UP : DOWN) : GREY;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const at = (x: number) => my + link.slope * (x - mx);
  const tick = (t: number) => (Math.abs(t) < 1e-9 ? "0" : `${t > 0 ? "+" : "−"}${+Math.abs(t).toPrecision(3)}`);
  const d = driver.knob;
  const y = link.knob;

  return (
    <div className="links-scatter" ref={ref}>
      <p className="links-scatter-title">
        Each dot is one month. Further right: {d.more[0].toLowerCase()} than usual. Higher up: more {y.label.toLowerCase()} than usual
        {link.lag ? `, ${later(link.lag)}` : ""}.
      </p>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`${d.label} against ${y.label}, month by month`}>
          {yt.map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.left} x2={width - PAD.right} y1={Y(t)} y2={Y(t)} stroke="rgba(255,255,255,0.07)" />
              <text x={PAD.left - 6} y={Y(t) + 3.5} textAnchor="end" className="tick">
                {tick(t)}
              </text>
            </g>
          ))}
          {xt.map((t) => (
            <text key={`x${t}`} x={X(t)} y={H - PAD.bottom + 14} textAnchor="middle" className="tick">
              {tick(t)}
            </text>
          ))}
          <line x1={X(0)} x2={X(0)} y1={PAD.top} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.15)" />
          {link.pairs.map(([a, b], i) => (
            <circle key={i} cx={X(a)} cy={Y(b)} r={2.2} fill={color} fillOpacity={0.45} />
          ))}
          <line x1={X(x0)} y1={Y(at(x0))} x2={X(x1)} y2={Y(at(x1))} stroke={color} strokeWidth={2} />
          <text x={PAD.left + w / 2} y={H - 4} textAnchor="middle" className="tick">
            {d.label} vs usual ({d.unit})
          </text>
          <text x={4} y={11} className="tick">
            {y.label} vs usual ({y.unit})
          </text>
        </svg>
      )}
    </div>
  );
}

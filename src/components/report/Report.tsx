"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { REGIONS, sourceFor, type Layer, type Region } from "@/lib/regions";
import {
  WHOLE_YEAR,
  annualize,
  loadDaily,
  loadMonthly,
  pick,
  seasonMonths,
  seasonsFor,
  trend,
  within,
  type DailyYear,
  type Month,
  type Season,
  type Trend,
} from "@/lib/series";
import { LAYERS, LAYER_INFO, signed, type LayerInfo } from "@/lib/layers";
import { DEFAULT_MAP, MAP_LAYERS, mapLayer, type MapLayer } from "@/lib/gibs";
import { DivergingBars, PairChart, RangeSlider, Stripes, TrendChart, YearBars, type BarRow } from "./charts";
import { Info, SeasonIcon, Trendmark, Verdict } from "./ui";

export type Overview = Record<string, Trend | null | Error | undefined>;

/** Satellite maps of two years, side by side on the globe. */
export interface Sat {
  on: boolean;
  /** Null: the default map for the question. */
  map: MapLayer | null;
  /** Null: the years being tested, within what the maps cover. */
  years: [number, number] | null;
}

interface Props {
  region: Region;
  layer: Layer;
  onLayer: (l: Layer) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** Full-record trend of every place for this layer, for the comparison. */
  overview: Overview;
  range: [number, number] | null;
  onRange: (r: [number, number] | null) => void;
  sat: Sat;
  onSat: (s: Sat) => void;
  /** Season id, or null for the whole year. */
  season: string | null;
  onSeason: (id: string | null) => void;
}

type Load<T> = T | Error | undefined;

const DAY = "#ffb067";
const NIGHT = "#9aa6ff";
const MUTED = "#d1d1d6";

/** The years both maps cover, given the years being tested. */
export function satYears(sat: Sat, range: [number, number] | null, map: MapLayer): [number, number] {
  if (sat.years) return sat.years;
  const m = mapLayer(map);
  const a = Math.min(m.lastYear - 1, Math.max(m.firstYear, range?.[0] ?? m.firstYear));
  const b = Math.max(a + 1, Math.min(m.lastYear, range?.[1] ?? m.lastYear));
  return [a, b];
}

export function Report(props: Props) {
  const { region, layer, onLayer, onClose } = props;
  const info = LAYER_INFO[layer];
  const src = sourceFor(region, layer);

  return (
    <aside className="report" aria-label={`${region.name}: ${info.question}`}>
      <div className="report-scroll">
        <header className="report-head">
          <button type="button" className="back" onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M10 3 5 8l5 5" />
            </svg>
            All places
          </button>
          <h1>{region.name}</h1>
          <p className="report-where">{placeLine(region)}</p>
          <div className="segmented is-small report-tabs" role="radiogroup" aria-label="Question">
            {LAYERS.filter((l) => l === layer || sourceFor(region, l)).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={layer === l} title={LAYER_INFO[l].question} onClick={() => onLayer(l)}>
                {LAYER_INFO[l].tab}
              </button>
            ))}
          </div>
        </header>

        {src ? (
          <Body key={`${region.id}-${layer}`} {...props} info={info} />
        ) : (
          <p className="note">
            We have no {info.tab.toLowerCase()} record for {region.name}. Try another question above, or another place.
          </p>
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function Body({ region, layer, info, overview, range, onRange, onSelect, sat, onSat, season: seasonParam, onSeason }: Props & { info: LayerInfo }) {
  const src = sourceFor(region, layer)!;
  const [months, setMonths] = useState<Load<Month[]>>();
  const [daily, setDaily] = useState<Load<DailyYear[]>>();
  const seasonId = seasonParam ?? WHOLE_YEAR.id;
  const setSeasonId = (id: string) => onSeason(id === WHOLE_YEAR.id ? null : id);
  const wantsDaily = !!region.daily && (layer === "warming" || layer === "rainfall");

  useEffect(() => {
    let alive = true;
    loadMonthly(src).then(
      (m) => alive && setMonths(m),
      (e: Error) => alive && setMonths(e),
    );
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    if (!wantsDaily || !region.daily) return;
    let alive = true;
    loadDaily(region.daily.file).then(
      (d) => alive && setDaily(d),
      (e: Error) => alive && setDaily(e),
    );
    return () => {
      alive = false;
    };
  }, [wantsDaily, region.daily]);

  const seasons = seasonsFor(region);
  const season: Season = seasons.find((s) => s.id === seasonId) ?? WHOLE_YEAR;

  const data = useMemo(() => {
    if (!Array.isArray(months)) return null;
    const year = annualize(months, WHOLE_YEAR);
    if (year.length < 2) return null;
    const bounds: [number, number] = [year[0].year, year[year.length - 1].year];
    const r: [number, number] = range ? [Math.max(bounds[0], range[0]), Math.min(bounds[1], range[1])] : bounds;
    const series = season.id === WHOLE_YEAR.id ? year : annualize(months, season);
    const t = trend(within(series, r));
    const bySeason = seasons.map((s) => ({ s, t: trend(within(annualize(months, s), r)) }));
    return { bounds, r, series, t, bySeason };
  }, [months, range, season, seasons]);

  if (months === undefined)
    return (
      <p className="loading" role="status">
        {src.points
          ? `Asking NASA POWER for ${src.points.length === 1 ? "this spot’s" : `${src.points.length} spots’`} records since 1981. This takes about 10 seconds the first time…`
          : "Reading NASA data…"}
      </p>
    );
  if (months instanceof Error) return <p className="note">{months.message}</p>;
  if (!data) return <p className="note">This record is too short to test.</p>;

  const { bounds, r, series, t, bySeason } = data;
  const accent = t?.significant ? (info.rate(t) >= 0 ? info.hue.up : info.hue.down) : MUTED;
  const whole = season.id === WHOLE_YEAR.id;
  const south = region.lat < -5;

  return (
    <>
      <Headline region={region} info={info} t={t} r={r} season={whole ? null : season} />

      <section className="block is-tight">
        <div className="block-head">
          <h2>
            {r[1] - r[0] + 1} years at a glance
            <Info>{info.stripesTip}</Info>
          </h2>
        </div>
        <Stripes series={series} range={r} color={info.color} valueText={info.valueText} low={info.low} high={info.high} />
      </section>

      {t && <Stats info={info} t={t} />}

      <section className="block">
        <div className="block-head">
          <h2>
            {info.measure} each year
            <Info>
              {info.chartTip} The coloured line is the trend: the straight line that best fits the years you are testing.
            </Info>
          </h2>
          {!whole && (
            <button type="button" className="chip" aria-pressed onClick={() => setSeasonId(WHOLE_YEAR.id)} title="Back to the whole year">
              <SeasonIcon id={season.id} south={south} />
              {season.label} only
              <svg className="chip-x" viewBox="0 0 16 16" aria-hidden>
                <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          )}
        </div>
        <p className="block-note">{info.definition}</p>
        <TrendChart series={series} trend={t} range={r} valueText={info.valueText} accent={accent} axis={info.axis} />
        <div className="range-row">
          <span className="range-label">
            Years to test
            <Info>
              Pick any stretch of at least 10 years. Every number on this page is worked out again for just those years. A trend can
              look different over a short stretch than over the whole record.
            </Info>
          </span>
          <RangeSlider min={bounds[0]} max={bounds[1]} value={r} onChange={(v) => onRange(v[0] === bounds[0] && v[1] === bounds[1] ? null : v)} />
          {range && (
            <button type="button" className="link" onClick={() => onRange(null)}>
              All years
            </button>
          )}
        </div>
      </section>

      <FromSpace layer={layer} region={region} range={range} sat={sat} onSat={onSat} />

      <section className="block">
        <div className="block-head">
          <h2>
            Which season is changing most?
            <Info>
              A change can hide inside the yearly average: hotter summers and milder winters can cancel each other out. So we test every
              season on its own. Pick one to see its chart above.
            </Info>
          </h2>
        </div>
        <p className="block-note">Change every 10 years, {r[0]} to {r[1]}.</p>
        <DivergingBars
          rows={bySeason.map(({ s, t: st }) => ({
            id: s.id,
            icon: <SeasonIcon id={s.id} south={south} />,
            label: (
              <>
                {s.label}
                <small>{seasonMonths(s)}</small>
              </>
            ),
            value: st ? info.rate(st) : null,
            significant: !!st?.significant,
            text: st ? info.rateText(info.rate(st)) : "too few years",
          }))}
          hue={info.hue}
          selected={season.id}
          onPick={(id) => setSeasonId(id === season.id ? WHOLE_YEAR.id : id)}
        />
      </section>

      {wantsDaily && region.daily && <Daily layer={layer} daily={daily} station={region.daily.station} r={r} />}

      <Compare layer={layer} info={info} region={region} overview={overview} onSelect={onSelect} />

      <p className="source">
        Data: {src.label}. Trend: Mann-Kendall test and Sen’s slope on one value per year.
        {info.caveat && ` ${info.caveat}`}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The answer, in words                                                */

function Headline({ region, info, t, r, season }: { region: Region; info: LayerInfo; t: Trend | null; r: [number, number]; season: Season | null }) {
  const only = season
    ? season.label === seasonMonths(season)
      ? `${season.label} only. `
      : `${season.label} only (${seasonMonths(season)}). `
    : "";
  if (!t) {
    return (
      <section className="headline" style={{ "--tone": MUTED } as CSSProperties}>
        <span className="headline-mark">
          <Trendmark dir="flat" size={24} />
        </span>
        <div>
          <h2>Not enough years</h2>
          <p>{only}A fair test needs at least 10 years. Drag the years to test further apart.</p>
        </div>
      </section>
    );
  }
  const rate = info.rate(t);
  const up = rate > 0;
  const dir = !t.significant ? "flat" : up ? "up" : "down";
  const tone = !t.significant ? MUTED : up ? info.hue.up : info.hue.down;
  const word = t.significant ? (up ? info.up : info.down) : info.flat;
  const from = info.valueText(t.at(r[0]));
  const to = info.valueText(t.at(r[1]));
  const per10 = info.rateText(rate);

  const sentence = t.significant
    ? info.sentence({ name: region.name, t, r, up, from, to })
    : `${info.measure} in ${region.name} went up and down from year to year between ${r[0]} and ${r[1]}, without a steady rise or fall. The small change we measured (${per10} every 10 years) could easily be chance.`;

  return (
    <section className="headline" style={{ "--tone": tone } as CSSProperties}>
      <span className="headline-mark">
        <Trendmark dir={dir} size={24} />
      </span>
      <div>
        <h2>{word}</h2>
        <p>
          {only}
          {sentence}
        </p>
        <Verdict t={t} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Two numbers                                                         */

function Stats({ info, t }: { info: LayerInfo; t: Trend }) {
  const rate = info.rate(t);
  const dir = rate > 0 ? "up" : rate < 0 ? "down" : "flat";
  const color = t.significant ? (rate >= 0 ? info.hue.up : info.hue.down) : MUTED;
  const enough = t.n >= 15;
  const expected = Math.round((10 * 15) / t.n);

  return (
    <dl className="tiles">
      <Tile
        label="Every 10 years"
        tip="We draw the straight line that best fits all the years, using a method (Sen’s slope) that is not thrown off by one odd year. This is how much that line rises or falls in 10 years."
        value={info.rateText(rate)}
        mark={<Trendmark dir={dir} color={color} />}
        color={color}
        note={`${rate >= 0 ? info.more : info.less} each decade`}
      />
      <Tile
        label={`${cap(info.top)} years`}
        tip={`Of the 10 ${info.top} years in this record, how many came in the last 15. If nothing were changing, you would expect about ${expected}.`}
        value={enough ? `${t.topTenInLast15} of 10` : "–"}
        note={enough ? `in the last 15 years (chance alone: ~${expected})` : "needs 15 or more years"}
      />
    </dl>
  );
}

function Tile({ label, tip, value, mark, color, note }: { label: string; tip: ReactNode; value: string; mark?: ReactNode; color?: string; note: string }) {
  return (
    <div className="tile">
      <dt>
        {label}
        <Info>{tip}</Info>
      </dt>
      <dd>
        <b style={color ? { color } : undefined}>
          {mark}
          {value}
        </b>
        <span>{note}</span>
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Then and now, from space                                            */

function FromSpace({ layer, region, range, sat, onSat }: { layer: Layer; region: Region; range: [number, number] | null; sat: Sat; onSat: (s: Sat) => void }) {
  const mapId = sat.map ?? DEFAULT_MAP[layer];
  const map = mapLayer(mapId);
  const [then, now] = satYears(sat, range, mapId);
  const [playing, setPlaying] = useState(false);
  const years: number[] = [];
  for (let y = map.firstYear; y <= map.lastYear; y++) years.push(y);
  const setYears = (y: [number, number]) => onSat({ ...sat, on: true, years: y });

  // Step the "now" map one year at a time, so the change plays out.
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => {
      if (now >= map.lastYear) setPlaying(false);
      else onSat({ ...sat, on: true, years: [then, now + 1] });
    }, 1700);
    return () => clearTimeout(id);
  }, [playing, then, now, map.lastYear, sat, onSat]);

  const play = () => {
    if (playing) return setPlaying(false);
    if (now >= map.lastYear) setYears([then, then + 1]);
    setPlaying(true);
  };

  return (
    <section className="block space">
      <div className="block-head">
        <h2>
          Then and now, from space
          <Info>
            Real NASA satellite images of {region.name} from two years, side by side on the globe. Drag the white line on the globe to
            slide between them. We show the same time of year in both, so the difference is change over the years, not just the seasons.
          </Info>
        </h2>
        <button type="button" className="toggle" aria-pressed={sat.on} onClick={() => onSat({ ...sat, on: !sat.on })}>
          {sat.on ? "Showing on globe" : "Show on globe"}
        </button>
      </div>

      <div className="chips" role="radiogroup" aria-label="Map">
        {MAP_LAYERS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={m.id === mapId}
            className="chip"
            onClick={() => onSat({ ...sat, on: true, map: m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="block-note">{map.explain}</p>

      <div className="space-years">
        <label>
          <span>Then</span>
          <select value={then} onChange={(e) => setYears([Number(e.target.value), Math.max(now, Number(e.target.value) + 1)])}>
            {years.slice(0, -1).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <svg className="space-arrow" viewBox="0 0 16 16" aria-hidden>
          <path d="M2 8h12M10 4l4 4-4 4" />
        </svg>
        <label>
          <span>Now</span>
          <select value={now} onChange={(e) => setYears([Math.min(then, Number(e.target.value) - 1), Number(e.target.value)])}>
            {years.slice(1).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <button type="button" className="play" aria-pressed={playing} onClick={play}>
          <svg viewBox="0 0 16 16" aria-hidden>
            {playing ? <path d="M5 3v10M11 3v10" /> : <path d="M5 3.5v9l7-4.5z" />}
          </svg>
          {playing ? "Pause" : "Play the years"}
        </button>
      </div>

      {map.legend && (
        <div className="space-legend">
          <span>{map.legend.min}</span>
          <i style={{ background: `linear-gradient(90deg, ${map.legend.stops.join(",")})` }} />
          <span>{map.legend.max}</span>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Daily station records                                               */

function Daily({ layer, daily, station, r }: { layer: Layer; daily: Load<DailyYear[]>; station: string; r: [number, number] }) {
  const [hot, setHot] = useState<"over40" | "over45">("over40");
  const [wet, setWet] = useState<"heavyRain" | "dryRun">("heavyRain");

  if (daily === undefined) return <p className="loading" role="status">Reading daily records…</p>;
  if (daily instanceof Error) return <p className="note">{daily.message}</p>;
  if (!daily.length) return null;

  const within_ = (k: Parameters<typeof pick>[1]) => trend(within(pick(daily, k), r));

  if (layer === "warming") {
    const day = { series: pick(daily, "dayHigh"), trend: within_("dayHigh") };
    const night = { series: pick(daily, "nightLow"), trend: within_("nightLow") };
    const hotSeries = pick(daily, hot);
    const hotTrend = within_(hot);
    const limit = hot === "over40" ? 40 : 45;
    const total = within(hotSeries, r).reduce((a, d) => a + d.value, 0);
    return (
      <>
        <section className="block">
          <div className="block-head">
            <h2>
              Hotter days or hotter nights?
              <Info>
                Daily readings for {station} from NASA POWER. Each year’s average daytime high and night-time low, shown as how far it was
                from usual. Warm nights matter: when nights stay hot, people and crops never get to cool down.
              </Info>
            </h2>
          </div>
          <div className="pair-keys">
            <PairKey color={DAY} label="Daytime high" t={day.trend} />
            <PairKey color={NIGHT} label="Night-time low" t={night.trend} />
          </div>
          <PairChart a={day} b={night} range={r} colors={[DAY, NIGHT]} />
        </section>

        <section className="block">
          <div className="block-head">
            <h2>
              Days above {limit} °C
              <Info>
                A day counts when its highest temperature passed {limit} °C ({limit === 40 ? 104 : 113} °F) at {station}.{" "}
                {limit === 45 ? "Heat like this is dangerous even for healthy adults." : "That is heatwave heat in most of India."}
              </Info>
            </h2>
            <div className="segmented is-small" role="radiogroup" aria-label="Threshold">
              {(["over40", "over45"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={hot === k} onClick={() => setHot(k)}>
                  Above {k === "over40" ? 40 : 45} °C
                </button>
              ))}
            </div>
          </div>
          <p className="block-note">
            {total === 0
              ? `${station} did not reach ${limit} °C once between ${r[0]} and ${r[1]}.`
              : `${Math.round(total)} such days at ${station} from ${r[0]} to ${r[1]}. ${trendLine(hotTrend, "day")}`}
          </p>
          {total > 0 && <YearBars series={hotSeries} trend={hotTrend} range={r} color="#ff7a5c" unit="days" />}
        </section>
      </>
    );
  }

  const series = pick(daily, wet);
  const t = within_(wet);
  const total = within(series, r).reduce((a, d) => a + d.value, 0);
  return (
    <section className="block">
      <div className="block-head">
        <h2>
          {wet === "heavyRain" ? "Very heavy rain days" : "Longest dry spell"}
          <Info>
            {wet === "heavyRain"
              ? `Days when more than 50 mm of rain fell at ${station}: a downpour big enough to flood streets. More of these can mean more floods even when the yearly total barely changes.`
              : `The most days in a row each year with almost no rain (under 1 mm) at ${station}. Longer dry spells stress crops and water supplies.`}
          </Info>
        </h2>
        <div className="segmented is-small" role="radiogroup" aria-label="Measure">
          <button type="button" role="radio" aria-checked={wet === "heavyRain"} onClick={() => setWet("heavyRain")}>
            Heavy rain
          </button>
          <button type="button" role="radio" aria-checked={wet === "dryRun"} onClick={() => setWet("dryRun")}>
            Dry spell
          </button>
        </div>
      </div>
      <p className="block-note">
        {wet === "heavyRain"
          ? total === 0
            ? `Not one day over 50 mm at ${station} between ${r[0]} and ${r[1]}.`
            : `${Math.round(total)} such days at ${station} from ${r[0]} to ${r[1]}. ${trendLine(t, "day")}`
          : trendLine(t, "day")}
      </p>
      <YearBars
        series={series}
        trend={t}
        range={r}
        color={wet === "heavyRain" ? "#5cc8b8" : "#d3a05e"}
        unit={wet === "heavyRain" ? "days" : "days in a row"}
      />
    </section>
  );
}

function PairKey({ color, label, t }: { color: string; label: string; t: Trend | null }) {
  const v = t?.slopePerDecade ?? 0;
  return (
    <div className="pair-key">
      <i style={{ background: color }} aria-hidden />
      <span>{label}</span>
      <b>
        <Trendmark dir={!t?.significant ? "flat" : v > 0 ? "up" : "down"} color={color} />
        {t ? `${signed(v, 2)} °C` : "–"}
      </b>
      <small>{t ? (t.significant ? "every 10 years, very likely real" : "every 10 years, could be chance") : ""}</small>
    </div>
  );
}

function trendLine(t: Trend | null, unit: string) {
  if (!t) return "";
  const v = t.slopePerDecade;
  if (!t.significant) return "No clear rise or fall over these years.";
  return `${v > 0 ? "Rising" : "Falling"} by about ${Math.abs(v).toFixed(1)} ${unit}s every 10 years.`;
}

/* ------------------------------------------------------------------ */

function Compare({ layer, info, region, overview, onSelect }: { layer: Layer; info: LayerInfo; region: Region; overview: Overview; onSelect: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const places = (REGIONS.includes(region) ? REGIONS : [region, ...REGIONS]).filter((p) => sourceFor(p, layer));
  const indian = region.group === "India" || region.group === "Indian cities";
  const near = new Set([region.id, "world", ...(indian ? ["india"] : [])]);
  const rateOf = (id: string) => {
    const t = overview[id];
    return t && !(t instanceof Error) ? t : null;
  };
  const rows: BarRow[] = places
    .filter((p) => all || near.has(p.id))
    .map((p) => {
      const t = rateOf(p.id);
      return {
        id: p.id,
        label: p.id === region.id ? <b>{p.name}</b> : p.name,
        value: t ? info.rate(t) : null,
        significant: !!t?.significant,
        text: t ? info.rateText(info.rate(t)) : overview[p.id] === undefined ? "…" : "–",
        highlight: p.id === region.id,
      };
    })
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

  const mine = rateOf(region.id);
  const earth = rateOf("world");
  let note = "";
  if (mine && earth && region.id !== "world") {
    const m = info.rate(mine);
    const e = info.rate(earth);
    const what = info.changing;
    note =
      Math.abs(m) > Math.abs(e) * 1.15
        ? `${region.name} is ${what} faster than the planet as a whole.`
        : Math.abs(m) < Math.abs(e) * 0.85
          ? `${region.name} is ${what} more slowly than the planet as a whole.`
          : `${region.name} is ${what} at about the same pace as the planet as a whole.`;
  }

  return (
    <section className="block">
      <div className="block-head">
        <h2>
          Compared with the world
          <Info>
            Change every 10 years, each place over its full record. Solid bars are very likely real; pale ones could be chance. Pick a place to
            open it.
          </Info>
        </h2>
      </div>
      {note && <p className="block-note">{note}</p>}
      <DivergingBars rows={rows} hue={info.hue} onPick={onSelect} dense />
      <button type="button" className="link more" onClick={() => setAll(!all)}>
        {all ? "Show fewer" : `Show all ${places.length} places`}
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function placeLine(r: Region): ReactNode {
  if (r.id === "world") return "Average over the whole planet";
  const lat = `${Math.abs(r.lat).toFixed(1)}° ${r.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(r.lon).toFixed(1)}° ${r.lon >= 0 ? "E" : "W"}`;
  return r.bbox ? `Average over the outlined area, centred on ${lat}, ${lon}` : `${lat}, ${lon}`;
}

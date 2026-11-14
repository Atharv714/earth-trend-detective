// The detective's view of the data: find a place, test a trend, compare.
// Same files, same maths and same wording as the report (series.ts,
// layers.ts), so the chat and the screen always agree.
import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { REGIONS, sourceFor, type Layer, type Region } from "../regions";
import { findPlace } from "../live";
import { LAYERS, LAYER_INFO } from "../layers";
import {
  WHOLE_YEAR,
  annualize,
  loadDaily,
  loadMonthly,
  pick,
  seasonsFor,
  setTextLoader,
  trend,
  within,
  type DailyYear,
  type Season,
  type Trend,
  type YearValue,
} from "../series";
import type { Series, ViewChange } from "./view";

const ROOT = path.join(process.cwd(), "public", "trend_detective_data");
setTextLoader((p) => readFile(path.join(ROOT, p), "utf8"));

/** Shortest window we test, as in the report. */
export const MIN_SPAN = 10;

/* ------------------------------------------------------------------ */
/* Rounding: the model quotes what it gets, so give it tidy numbers.   */

/** Round to 3 significant figures (at most 4 decimals). */
export const r3 = (v: number) => (v === 0 || !Number.isFinite(v) ? v : Number(v.toPrecision(3)));
const round = (v: number, d: number) => Number(v.toFixed(d));

/** p as "the chance this is luck", the way the report says it. */
const chance = (p: number) => (p < 0.001 ? "under 0.1%" : `${r3(p * 100)}%`);

/* ------------------------------------------------------------------ */
/* Places                                                              */

const byName = (q: string) => {
  const k = q.trim().toLowerCase();
  return REGIONS.find((r) => r.id === k || r.name.toLowerCase() === k) ?? REGIONS.find((r) => r.name.toLowerCase().startsWith(k));
};

/** A catalog id or name, a "find:" id, or any place name (looked up live). */
export async function resolvePlace(q: string): Promise<Region> {
  const hit = byName(q);
  if (hit) return hit;
  return findPlace(q.startsWith("find:") ? q.slice(5) : q);
}

export const layersOf = (r: Region) => LAYERS.filter((l) => sourceFor(r, l));

export function placeCard(r: Region) {
  return {
    id: r.id,
    name: r.name,
    group: r.group,
    lat: round(r.lat, 2),
    lon: round(r.lon, 2),
    questions: layersOf(r),
    ...(r.daily ? { dailyStation: r.daily.station } : {}),
    ...(r.group === "Searched" ? { data: "NASA POWER, fetched live" } : {}),
  };
}

export function listPlaces(layer?: Layer) {
  return REGIONS.filter((r) => !layer || sourceFor(r, layer)).map((r) => ({
    id: r.id,
    name: r.name,
    group: r.group,
    questions: layersOf(r).join(","),
    ...(r.daily ? { dailyStation: r.daily.station } : {}),
  }));
}

/* ------------------------------------------------------------------ */
/* Seasons and years                                                   */

export function resolveSeason(r: Region, s?: string | null): Season {
  if (!s || s === "year") return WHOLE_YEAR;
  const k = s.toLowerCase();
  const hit = seasonsFor(r).find((x) => x.id === k || x.label.toLowerCase() === k);
  if (!hit) throw new Error(`No season "${s}" for ${r.name}. Seasons there: ${seasonsFor(r).map((x) => x.id).join(", ")}, or "year".`);
  return hit;
}

const seasonCard = (s: Season) => ({ id: s.id, label: s.label, months: s.months });

function clip(series: YearValue[], from?: number | null, to?: number | null) {
  if (!from && !to) return series;
  const a = from ?? series[0]?.year ?? 0;
  const b = to ?? series[series.length - 1]?.year ?? 0;
  if (b - a + 1 < MIN_SPAN) throw new Error(`A fair test needs at least ${MIN_SPAN} years; ${a}–${b} is too short.`);
  return within(series, [a, b]);
}

/* ------------------------------------------------------------------ */
/* One trend                                                           */

function needSource(r: Region, layer: Layer) {
  const src = sourceFor(r, layer);
  if (!src) throw new Error(`${r.name} has no ${layer} record. It has: ${layersOf(r).join(", ") || "nothing"}.`);
  return src;
}

async function yearly(r: Region, layer: Layer, season: Season) {
  return annualize(await loadMonthly(needSource(r, layer)), season);
}

/** The numbers behind one verdict, in the units people read. */
function describe(r: Region, layer: Layer, t: Trend) {
  const info = LAYER_INFO[layer];
  const rate = info.rate(t);
  const up = rate > 0;
  const span: [number, number] = [t.firstYear, t.lastYear];
  return {
    verdict: t.significant ? (up ? info.up : info.down) : info.flat,
    significant: t.significant,
    rate: `${info.rateText(rate)} ${info.rateUnit}`,
    rateValue: r3(rate),
    slopePerDecade: r3(t.slopePerDecade),
    pctPerDecade: t.pctPerDecade == null ? null : r3(t.pctPerDecade),
    totalChange: r3(t.totalChange),
    pValue: r3(t.pValue),
    chanceItIsLuck: chance(t.pValue),
    yearsTested: t.n,
    firstYear: t.firstYear,
    lastYear: t.lastYear,
    average: info.valueText(t.mean),
    trendLineStart: info.valueText(t.at(span[0])),
    trendLineEnd: info.valueText(t.at(span[1])),
    topTenInLast15: t.topTenInLast15,
    ...(t.significant
      ? { summary: info.sentence({ name: r.name, t, r: span, up, from: info.valueText(t.at(span[0])), to: info.valueText(t.at(span[1])) }) }
      : {}),
  };
}

export interface TrendArgs {
  place: string;
  layer: Layer;
  season?: string | null;
  from?: number | null;
  to?: number | null;
}

export async function getTrend({ place, layer, season, from, to }: TrendArgs) {
  const r = await resolvePlace(place);
  const s = resolveSeason(r, season);
  const src = needSource(r, layer);
  const all = await yearly(r, layer, s);
  const series = clip(all, from, to);
  const t = trend(series);
  const info = LAYER_INFO[layer];
  const base = {
    place: { id: r.id, name: r.name },
    layer,
    question: info.question,
    measure: info.measure,
    unit: src.unit || "fraction",
    season: seasonCard(s),
    source: src.label,
    recordYears: all.length ? [all[0].year, all[all.length - 1].year] : null,
    ...(info.caveat ? { caveat: info.caveat } : {}),
  };
  if (!t) return { ...base, verdict: "Not enough years", yearsAvailable: series.length, series: toSeries(series) };
  return { ...base, ...describe(r, layer, t), series: toSeries(series) };
}

const toSeries = (s: YearValue[]): Series => s.map((d) => [d.year, r3(d.value)]);

/* ------------------------------------------------------------------ */
/* Many places                                                         */

export async function compare({ places, layer, season, from, to }: { places: string[]; layer: Layer; season?: string | null; from?: number | null; to?: number | null }) {
  const info = LAYER_INFO[layer];
  const rows = await Promise.all(
    places.map(async (q) => {
      try {
        const r = await resolvePlace(q);
        const s = resolveSeason(r, season);
        const t = trend(clip(await yearly(r, layer, s), from, to));
        if (!t) return { place: r.name, id: r.id, error: "Not enough years" };
        return { place: r.name, id: r.id, ...describe(r, layer, t) };
      } catch (e) {
        return { place: q, error: (e as Error).message };
      }
    }),
  );
  const ok = rows.filter((x): x is Extract<typeof x, { rateValue: number }> => "rateValue" in x);
  ok.sort((a, b) => b.rateValue - a.rateValue);

  // Places moving in opposite directions, both beyond chance: the most telling contrast.
  const up = ok.filter((x) => x.significant && x.rateValue > 0);
  const down = ok.filter((x) => x.significant && x.rateValue < 0);
  const opposite = up.length && down.length ? { rising: up.map((x) => x.place), falling: down.map((x) => x.place) } : null;

  return {
    layer,
    rateUnit: info.rateUnit,
    ranked: ok.map(({ place, id, rate, rateValue, verdict, significant, chanceItIsLuck, firstYear, lastYear }) => ({
      place,
      id,
      rate,
      rateValue,
      verdict,
      significant,
      chanceItIsLuck,
      years: `${firstYear}–${lastYear}`,
    })),
    failed: rows.filter((x) => "error" in x),
    oppositeTrends: opposite,
  };
}

/** Each place against the whole Earth, the planet's own pace as the yardstick. */
export async function versusWorld(place: string, layer: Layer) {
  const world = REGIONS.find((r) => r.id === "world")!;
  if (!sourceFor(world, layer)) return { note: `No whole-Earth ${layer} record to compare with.` };
  const [a, b] = await Promise.all([getTrend({ place, layer }), getTrend({ place: "world", layer })]);
  if (!("rateValue" in a) || !("rateValue" in b)) return { note: "Not enough years to compare." };
  const ratio = b.rateValue === 0 ? null : r3(a.rateValue / b.rateValue);
  return { place: a.place.name, placeRate: a.rate, worldRate: b.rate, timesTheWorldRate: ratio, placeSignificant: a.significant, worldSignificant: b.significant };
}

/* ------------------------------------------------------------------ */
/* Seasons                                                             */

export async function seasonBreakdown(place: string, layer: Layer) {
  const r = await resolvePlace(place);
  const months = await loadMonthly(needSource(r, layer));
  const info = LAYER_INFO[layer];
  const rows = [WHOLE_YEAR, ...seasonsFor(r)].map((s) => {
    const t = trend(annualize(months, s));
    if (!t) return { season: s.label, id: s.id, verdict: "Not enough years" };
    return {
      season: s.label,
      id: s.id,
      rate: `${info.rateText(info.rate(t))} ${info.rateUnit}`,
      rateValue: r3(info.rate(t)),
      verdict: t.significant ? (info.rate(t) > 0 ? info.up : info.down) : info.flat,
      significant: t.significant,
      chanceItIsLuck: chance(t.pValue),
      years: `${t.firstYear}–${t.lastYear}`,
    };
  });
  return { place: r.name, layer, seasons: rows };
}

/* ------------------------------------------------------------------ */
/* Month by month                                                      */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function monthlyPattern(place: string, layer: Layer, year?: number | null) {
  const r = await resolvePlace(place);
  const src = needSource(r, layer);
  const months = await loadMonthly(src);
  const last = year ?? Math.max(...months.map((m) => m.year));
  const normal = MONTHS.map((name, i) => {
    const v = months.filter((m) => m.month === i + 1).map((m) => m.value);
    const that = months.find((m) => m.year === last && m.month === i + 1)?.value;
    const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
    return {
      month: name,
      usual: Number.isFinite(avg) ? r3(avg) : null,
      [String(last)]: that == null ? null : r3(that),
      difference: that == null || !Number.isFinite(avg) ? null : r3(that - avg),
    };
  });
  return { place: r.name, layer, unit: src.unit || "fraction", year: last, months: normal };
}

/* ------------------------------------------------------------------ */
/* Daily station extremes (India)                                      */

const EXTREMES: { key: keyof Omit<DailyYear, "year">; what: string; unit: string }[] = [
  { key: "over40", what: "Days above 40 °C", unit: "days" },
  { key: "over45", what: "Days above 45 °C", unit: "days" },
  { key: "dayHigh", what: "Average daytime high", unit: "°C" },
  { key: "nightLow", what: "Average night-time low", unit: "°C" },
  { key: "heavyRain", what: "Days with over 50 mm of rain", unit: "days" },
  { key: "dryRun", what: "Longest dry spell (under 1 mm a day)", unit: "days" },
];

export async function extremes(place: string) {
  const r = await resolvePlace(place);
  if (!r.daily) {
    const with_ = REGIONS.filter((x) => x.daily).map((x) => x.name);
    throw new Error(`${r.name} has no daily station record. Places with one: ${with_.join(", ")}.`);
  }
  const days = await loadDaily(r.daily.file);
  const rows = EXTREMES.map(({ key, what, unit }) => {
    const s = pick(days, key);
    const t = trend(s);
    const avg = (xs: YearValue[]) => r3(xs.reduce((a, b) => a + b.value, 0) / xs.length);
    return {
      measure: what,
      unit,
      firstDecadeAverage: avg(s.slice(0, 10)),
      lastDecadeAverage: avg(s.slice(-10)),
      firstDecade: `${s[0].year}–${s[Math.min(9, s.length - 1)].year}`,
      lastDecade: `${s[Math.max(0, s.length - 10)].year}–${s[s.length - 1].year}`,
      ...(t
        ? { perDecade: r3(t.slopePerDecade), significant: t.significant, chanceItIsLuck: chance(t.pValue) }
        : { verdict: "Not enough years" }),
    };
  });
  return {
    place: r.name,
    station: r.daily.station,
    source: "NASA POWER daily record at one point",
    years: `${days[0].year}–${days[days.length - 1].year}`,
    measures: rows,
  };
}

/* ------------------------------------------------------------------ */
/* Showing it in the app                                               */

export async function viewChange(a: TrendArgs): Promise<ViewChange & { placeName: string }> {
  const r = await resolvePlace(a.place);
  needSource(r, a.layer);
  const s = resolveSeason(r, a.season);
  const range: [number, number] | null = a.from && a.to ? [a.from, a.to] : null;
  if (range && range[1] - range[0] + 1 < MIN_SPAN) throw new Error(`A fair test needs at least ${MIN_SPAN} years.`);
  return {
    place: r.id,
    ...(r.id.startsWith("find:") ? { query: r.id.slice(5) } : {}),
    placeName: r.name,
    layer: a.layer,
    season: s === WHOLE_YEAR ? null : s.id,
    range,
  };
}

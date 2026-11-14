// The detective's research tools: go past the app's ready-made records.
//   water_storage  GRACE satellites: water stored on land, anywhere, 2002–2026
//   nasa_power     any NASA POWER variable for any place, 1981–2025
//   scan_region    a grid over an area: where inside it is changing fastest
//   calculate      arithmetic the answer needs, so derived numbers are traceable
import "server-only";

import { findPlace, shapeOf } from "../live";
import type { Region } from "../regions";
import { WHOLE_YEAR, annualize, seasonsFor, trend, within, type Month, type Season, type Trend, type YearValue } from "../series";
import { MIN_SPAN, r3, resolvePlace } from "./data";
import { GRACE_MIN_SIDE, areaKm2, areaMean, graceBox, graceCells, graceYearly } from "./grace";
import { POWER_FIRST, POWER_LAST, powerAtPoints, powerGrid, type Box } from "./power";
import type { Series } from "./view";

const chance = (p: number) => (p < 0.001 ? "under 0.1%" : `${r3(p * 100)}%`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const toSeries = (s: YearValue[]): Series => s.map((d) => [d.year, r3(d.value)]);

/* ------------------------------------------------------------------ */
/* Where                                                               */

export interface AreaArgs {
  place?: string | null;
  /** [west, south, east, north] in degrees */
  box?: number[] | null;
}

interface Area {
  name: string;
  box: Box;
  lat: number;
  lon: number;
  monsoon: boolean;
  /** Points to sample for POWER's point API */
  points: [number, number][];
  /** The place's real outline, when known */
  inside?: ((lon: number, lat: number) => boolean) | null;
}

const inMonsoon = (lat: number, lon: number) => lon > 68 && lon < 98 && lat > 6 && lat < 37;

function gridPoints([w, s, e, n]: Box, k: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) out.push([s + ((i + 0.5) * (n - s)) / k, w + ((j + 0.5) * (e - w)) / k]);
  return out;
}

/** A place name or a box, as an area with an outline box. */
async function area({ place, box }: AreaArgs): Promise<Area> {
  if (box?.length === 4) {
    const [w, s, e, n] = box;
    if (!(e > w && n > s)) throw new Error("box is [west, south, east, north] with east > west and north > south.");
    const lat = (s + n) / 2;
    const lon = (w + e) / 2;
    const pts = e - w < 1 && n - s < 1 ? [[lat, lon] as [number, number]] : gridPoints([w, s, e, n], 3);
    return { name: place ?? `${s}–${n}°N, ${w}–${e}°E`, box: [w, s, e, n], lat, lon, monsoon: inMonsoon(lat, lon), points: pts };
  }
  if (!place) throw new Error("Give a place name or a box [west, south, east, north].");
  const r: Region = await resolvePlace(place).catch((e: Error) => {
    throw new Error(`${e.message} A river basin, sea, desert, mountain range or other natural region has no outline to look up: pass box [west, south, east, north] instead, with place as its label.`);
  });
  // Catalog places are mostly single points: look the name up for its outline.
  const found = r.group === "Searched" ? r : await findPlace(r.name).catch(() => null);
  const outline = r.bbox ?? found?.bbox;
  const b: Box = outline ?? [r.lon - 0.25, r.lat - 0.25, r.lon + 0.25, r.lat + 0.25];
  const points = r.temp?.points ?? (outline ? gridPoints(outline, 3) : [[r.lat, r.lon] as [number, number]]);
  const inside = r.id === "world" ? null : found ? shapeOf(found.id) : null;
  return { name: r.name, box: b, lat: r.lat, lon: r.lon, monsoon: r.monsoon ?? inMonsoon(r.lat, r.lon), points, inside };
}

/** Degrees to 0.01° (about 1 km). Not r3: 3 significant figures turns −122.5° into −123°, 45 km off. */
const deg = (v: number) => Number(v.toFixed(2));
const roundBox = (b: Box) => b.map(deg) as Box;

/** Keep grid cells inside the place's outline; keep all when too few fall inside (small places, coarse grids). */
function clipTo<C extends { lat: number; lon: number }>(cells: C[], where: Area, min: number): { cells: C[]; clipped: boolean } {
  if (!where.inside) return { cells, clipped: false };
  const kept = cells.filter((c) => where.inside!(c.lon, c.lat));
  return kept.length >= min ? { cells: kept, clipped: true } : { cells, clipped: false };
}

/* ------------------------------------------------------------------ */
/* When                                                                */

export interface WhenArgs {
  season?: string | null;
  months?: number[] | null;
  from?: number | null;
  to?: number | null;
}

const ALL_SEASONS = [...seasonsFor({ monsoon: true } as Region), ...seasonsFor({ monsoon: false } as Region)];

function pickSeason(season?: string | null, months?: number[] | null): Season {
  if (months?.length) {
    const ms = [...new Set(months)].filter((m) => m >= 1 && m <= 12);
    return { id: "custom", label: ms.map((m) => MONTHS[m - 1]).join("+"), months: ms };
  }
  if (!season || season === "year") return WHOLE_YEAR;
  const k = season.toLowerCase();
  const hit = ALL_SEASONS.find((s) => s.id === k || s.label.toLowerCase() === k);
  if (!hit) throw new Error(`Unknown season "${season}". Use ${ALL_SEASONS.map((s) => s.id).join(", ")}, or pass months [1..12].`);
  return hit;
}

/** The years asked for. A window under 10 years still returns its values and mean (no trend test), unless `strict`. */
function clip(series: YearValue[], from?: number | null, to?: number | null, strict = false) {
  if (!from && !to) return series;
  const a = from ?? series[0]?.year ?? 0;
  const b = to ?? series[series.length - 1]?.year ?? 0;
  if (strict && b - a + 1 < MIN_SPAN) throw new Error(`A fair test needs at least ${MIN_SPAN} years; ${a}–${b} is too short.`);
  return within(series, [a, b]);
}

/** For a window too short to test: its mean and each year, so periods can still be compared. */
function shortWindow(yearly: YearValue[]) {
  return {
    trend: `Too few years for a trend test (${yearly.length}); the mean and each year are given instead.`,
    mean: yearly.length ? r3(yearly.reduce((x, y) => x + y.value, 0) / yearly.length) : null,
    years: Object.fromEntries(yearly.map((y) => [y.year, r3(y.value)])),
  };
}

/** The test result as numbers the model can quote. An anomaly record (GRACE) averages near zero, so a % change means nothing there. */
function verdict(t: Trend, unit: string, anomaly = false) {
  return {
    trend: t.significant ? (t.slopePerDecade > 0 ? "rising" : "falling") : "no clear trend",
    significant: t.significant,
    perDecade: r3(t.slopePerDecade),
    // POWER marks a unitless quantity (soil wetness, cloud fraction) with "1" or "-".
    perDecadeText: `${t.slopePerDecade > 0 ? "+" : ""}${r3(t.slopePerDecade)}${unit && unit !== "1" && unit !== "-" ? ` ${unit}` : ""} per decade`,
    ...(anomaly ? {} : { pctPerDecade: t.pctPerDecade == null ? null : r3(t.pctPerDecade) }),
    totalChange: r3(t.totalChange),
    pValue: r3(t.pValue),
    chanceItIsLuck: chance(t.pValue),
    yearsTested: t.n,
    firstYear: t.firstYear,
    lastYear: t.lastYear,
    average: r3(t.mean),
    trendLineStart: r3(t.at(t.firstYear)),
    trendLineEnd: r3(t.at(t.lastYear)),
    topTenInLast15: t.topTenInLast15,
  };
}

/* ------------------------------------------------------------------ */
/* water_storage                                                       */

export async function waterStorage(a: AreaArgs & { from?: number | null; to?: number | null }) {
  const where = await area(a);
  const box = graceBox(where.box);
  const g = await graceCells(box);
  const { months, source } = g;
  const { cells, clipped } = clipTo(g.cells, where, 9);
  if (!cells.length) throw new Error(`No GRACE land cells in ${where.name} (open ocean?). Try a wider box.`);
  const monthly = areaMean(cells, months);
  const yearly = clip(graceYearly(monthly), a.from, a.to);
  const t = trend(yearly);
  const km2 = areaKm2(cells);
  const last = monthly[monthly.length - 1];
  const sameMonth = monthly.filter((m) => m.month.slice(5) === last.month.slice(5));
  const usual = sameMonth.reduce((s, m) => s + m.value, 0) / sameMonth.length;
  const lowest = monthly.reduce((x, m) => (m.value < x.value ? m : x));
  const highest = monthly.reduce((x, m) => (m.value > x.value ? m : x));
  // mm over km² -> km³ of water: 1 mm × 1 km² = 1e-6 km³.
  const km3 = (mm: number) => r3(mm * km2 * 1e-6);

  return {
    place: { name: where.name },
    measures: "Total water stored on and under the land: groundwater + soil moisture + snow and ice + lakes and rivers",
    source: `${source}, monthly, ${months[0]} to ${months[months.length - 1]}`,
    units: "mm of water, as a difference from the 2004–2009 average",
    areaUsed: {
      box: roundBox(box),
      cells: cells.length,
      areaKm2: r3(km2),
      clippedToBorder: clipped,
      note: where.box !== box ? `Widened to ${GRACE_MIN_SIDE}° because GRACE sees features about 300 km across` : undefined,
    },
    ...(t
      ? {
          ...verdict(t, "mm", true),
          perYear: r3(t.slopePerDecade / 10),
          waterVolumeChangePerYearKm3: km3(t.slopePerDecade / 10),
          waterVolumeTotalChangeKm3: km3(t.totalChange),
        }
      : shortWindow(yearly)),
    latest: { month: last.month, value: r3(last.value), usualForThisMonth: r3(usual), differenceFromUsual: r3(last.value - usual) },
    lowestMonth: { month: lowest.month, value: r3(lowest.value) },
    highestMonth: { month: highest.month, value: r3(highest.value) },
    last12Months: monthly.slice(-12).map((m) => [m.month, r3(m.value)]),
    series: toSeries(yearly),
    caveat:
      "GRACE weighs all the water in a column, not groundwater alone. Where soil and snow change little (dry lands, irrigated plains), most of a long decline is groundwater. Areas smaller than about 300 km get the signal of the region around them. GRACE ended in June 2017 and GRACE-FO began in June 2018, so 2017–2018 has a gap.",
  };
}

/* ------------------------------------------------------------------ */
/* nasa_power                                                          */

export async function nasaPower(a: AreaArgs & WhenArgs & { parameters: string[] }) {
  const where = await area(a);
  const season = pickSeason(a.season, a.months);
  const params = [...new Set(a.parameters.map((p) => p.trim().toUpperCase()))];
  const data = await powerAtPoints(where.points, params);
  const results = params.map((p) => {
    const d = data[p];
    if (!d?.months.length) return { parameter: p, error: "No data for this parameter here." };
    const all = annualize(d.months, season);
    const yearly = clip(all, a.from, a.to);
    const t = trend(yearly);
    const lastYear = d.months[d.months.length - 1].year;
    const normal = MONTHS.map((_, i) => {
      const v = d.months.filter((m) => m.month === i + 1).map((m) => m.value);
      return v.length ? r3(v.reduce((x, y) => x + y, 0) / v.length) : null;
    });
    const latest = MONTHS.map((_, i) => {
      const m = d.months.find((x) => x.year === lastYear && x.month === i + 1);
      return m ? r3(m.value) : null;
    });
    return {
      parameter: p,
      name: d.name,
      units: d.units,
      ...(t ? verdict(t, d.units) : shortWindow(yearly)),
      usualByMonth: Object.fromEntries(MONTHS.map((m, i) => [m, normal[i]])),
      [`months${lastYear}`]: Object.fromEntries(MONTHS.map((m, i) => [m, latest[i]])),
      series: toSeries(yearly),
    };
  });
  return {
    place: { name: where.name },
    source: `NASA POWER (MERRA-2 and CERES based), monthly ${POWER_FIRST}–${POWER_LAST}, averaged over ${data[params[0]]?.points ?? where.points.length} points`,
    season: { id: season.id, label: season.label, months: season.months },
    results,
  };
}

/* ------------------------------------------------------------------ */
/* scan_region                                                         */

const SCAN_MAX_SIDE = 30;
export const WATER_STORAGE = "WATER_STORAGE";

interface CellResult {
  lat: number;
  lon: number;
  mean: number;
  t: Trend;
}

const geoCache = new Map<string, Promise<string>>();
let lastGeo = 0;

/** A cell's district and state (OpenStreetMap), one request a second as Nominatim asks. */
function nameOf(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let p = geoCache.get(key);
  if (!p) {
    p = (async () => {
      const wait = lastGeo + 1100 - Date.now();
      lastGeo = Math.max(Date.now(), lastGeo + 1100);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=en`, {
        headers: { "User-Agent": "EarthTrendDetective/0.1" },
      });
      if (!res.ok) return "";
      const j = (await res.json()) as { address?: Record<string, string> };
      const ad = j.address ?? {};
      const local = ad.city ?? ad.town ?? ad.county ?? ad.state_district ?? ad.district ?? ad.village ?? "";
      return [local, ad.state ?? ad.region, ad.country].filter(Boolean).join(", ");
    })().catch(() => "");
    geoCache.set(key, p);
  }
  return p;
}

const SECTORS = [
  ["south-west", "south", "south-east"],
  ["west", "centre", "east"],
  ["north-west", "north", "north-east"],
];

export async function scanRegion(a: AreaArgs & WhenArgs & { parameter: string; top?: number | null; nameCells?: boolean | null }) {
  const where = await area(a);
  const param = a.parameter.trim().toUpperCase();
  const top = Math.min(Math.max(a.top ?? 5, 1), 10);
  const [w, s, e, n] = where.box;
  const grace = param === WATER_STORAGE;
  if (!grace && (e - w > SCAN_MAX_SIDE || n - s > SCAN_MAX_SIDE))
    throw new Error(`That area is ${r3(e - w)}° × ${r3(n - s)}°. Scan at most ${SCAN_MAX_SIDE}° a side: split it into parts and scan each.`);

  const cells: CellResult[] = [];
  let units = "";
  let name = param;
  let source = "";
  let box = where.box;
  let meanSeries: YearValue[] = [];
  const season = pickSeason(a.season, a.months);

  if (grace) {
    box = graceBox(where.box);
    const raw = await graceCells(box);
    const g = { ...raw, cells: clipTo(raw.cells, where, 9).cells };
    units = "mm";
    name = "Water stored on land (GRACE)";
    source = `${g.source}, 1° grid`;
    for (const c of g.cells) {
      const yearly = clip(graceYearly(areaMean([c], g.months)), a.from, a.to, true);
      const t = trend(yearly);
      if (t) cells.push({ lat: c.lat, lon: c.lon, mean: t.mean, t });
    }
    meanSeries = clip(graceYearly(areaMean(g.cells, g.months)), a.from, a.to, true);
  } else {
    const g = await powerGrid(where.box, param, a.from ?? POWER_FIRST, a.to ?? POWER_LAST);
    box = g.box;
    units = g.units;
    name = g.name;
    source = `NASA POWER ${param}, regional grid (about 0.5°), ${a.from ?? POWER_FIRST}–${a.to ?? POWER_LAST}${g.tilesFailed ? `; ${g.tilesFailed} tile(s) failed` : ""}`;
    const sum = new Map<number, { s: number; n: number }>();
    for (const c of clipTo(g.cells, where, 12).cells) {
      const t = trend(annualize(c.months, season));
      if (t) cells.push({ lat: c.lat, lon: c.lon, mean: t.mean, t });
      for (const m of c.months) {
        const k = m.year * 12 + m.month - 1;
        const acc = sum.get(k) ?? { s: 0, n: 0 };
        acc.s += m.value;
        acc.n++;
        sum.set(k, acc);
      }
    }
    const avg: Month[] = [...sum.entries()].sort((x, y) => x[0] - y[0]).map(([k, v]) => ({ year: Math.floor(k / 12), month: (k % 12) + 1, value: v.s / v.n }));
    meanSeries = annualize(avg, season);
  }
  if (!cells.length) throw new Error(`No usable grid cells in ${where.name}.`);

  const whole = trend(meanSeries);
  const sig = cells.filter((c) => c.t.significant);
  const rising = sig.filter((c) => c.t.slopePerDecade > 0);
  const falling = sig.filter((c) => c.t.slopePerDecade < 0);

  // Sectors: the box cut 3 × 3, so the model can describe the pattern.
  const [bw, bs, be, bn] = box;
  const sectors = SECTORS.flat().map((label, idx) => {
    const row = Math.floor(idx / 3);
    const col = idx % 3;
    const inside = cells.filter((c) => {
      const r = Math.min(2, Math.floor(((c.lat - bs) / (bn - bs || 1)) * 3));
      const k = Math.min(2, Math.floor(((c.lon - bw) / (be - bw || 1)) * 3));
      return r === row && k === col;
    });
    if (!inside.length) return null;
    const avg = (f: (c: CellResult) => number) => r3(inside.reduce((x, c) => x + f(c), 0) / inside.length);
    return {
      sector: label,
      cells: inside.length,
      average: avg((c) => c.mean),
      perDecade: avg((c) => c.t.slopePerDecade),
      significantRising: inside.filter((c) => c.t.significant && c.t.slopePerDecade > 0).length,
      significantFalling: inside.filter((c) => c.t.significant && c.t.slopePerDecade < 0).length,
    };
  }).filter(Boolean);

  const card = (c: CellResult) => ({
    lat: deg(c.lat),
    lon: deg(c.lon),
    average: r3(c.mean),
    perDecade: r3(c.t.slopePerDecade),
    ...(grace || c.t.pctPerDecade == null ? {} : { pctPerDecade: r3(c.t.pctPerDecade) }),
    significant: c.t.significant,
    chanceItIsLuck: chance(c.t.pValue),
  });
  const byRate = [...cells].sort((x, y) => y.t.slopePerDecade - x.t.slopePerDecade);
  const up = byRate.slice(0, top).map(card);
  const down = byRate.slice(-top).reverse().map(card);
  if (a.nameCells ?? true) {
    const named = await Promise.all([...up, ...down].map((c) => nameOf(c.lat, c.lon)));
    [...up, ...down].forEach((c, i) => Object.assign(c, { near: named[i] || undefined }));
  }

  return {
    place: { name: where.name },
    parameter: param,
    name,
    units,
    source,
    season: { id: season.id, label: season.label },
    box: roundBox(box),
    cells: cells.length,
    wholeArea: whole ? verdict(whole, units, grace) : { trend: "Not enough years" },
    cellsRisingSignificantly: rising.length,
    cellsFallingSignificantly: falling.length,
    cellsWithNoClearTrend: cells.length - sig.length,
    sectors,
    fastestRising: up,
    fastestFalling: down,
    series: toSeries(meanSeries),
  };
}

/* ------------------------------------------------------------------ */
/* calculate                                                           */

const FUNCS: Record<string, (...x: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  min: Math.min,
  max: Math.max,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  mean: (...x) => x.reduce((a, b) => a + b, 0) / x.length,
  sum: (...x) => x.reduce((a, b) => a + b, 0),
};

/** + − × ÷ ^ %, brackets and the functions above. No variables, no eval. */
export function evaluate(src: string): number {
  const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,(?=\d{3}\b)/g, "");
  let i = 0;
  const peek = () => s[i];
  const skip = () => {
    while (s[i] === " ") i++;
  };
  const expect = (c: string) => {
    skip();
    if (s[i] !== c) throw new Error(`Expected "${c}" at ${i} in ${src}`);
    i++;
  };
  function primary(): number {
    skip();
    if (peek() === "(") {
      i++;
      const v = expr();
      expect(")");
      return v;
    }
    if (peek() === "-") {
      i++;
      return -power();
    }
    if (peek() === "+") {
      i++;
      return power();
    }
    const num = /^\d*\.?\d+(?:e[-+]?\d+)?/i.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      skip();
      if (peek() === "%") {
        i++;
        return Number(num[0]) / 100;
      }
      return Number(num[0]);
    }
    const id = /^[a-z]+/i.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const name = id[0].toLowerCase();
      if (name === "pi") return Math.PI;
      const f = FUNCS[name];
      if (!f) throw new Error(`Unknown function ${id[0]}`);
      expect("(");
      const args = [expr()];
      skip();
      while (peek() === ",") {
        i++;
        args.push(expr());
        skip();
      }
      expect(")");
      return f(...args);
    }
    throw new Error(`Cannot read "${s.slice(i, i + 10)}" in ${src}`);
  }
  function power(): number {
    const b = primary();
    skip();
    if (peek() === "^") {
      i++;
      return b ** power();
    }
    return b;
  }
  function term(): number {
    let v = power();
    for (;;) {
      skip();
      if (peek() === "*") {
        i++;
        v *= power();
      } else if (peek() === "/") {
        i++;
        v /= power();
      } else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      skip();
      if (peek() === "+") {
        i++;
        v += term();
      } else if (peek() === "-") {
        i++;
        v -= term();
      } else return v;
    }
  }
  const v = expr();
  skip();
  if (i < s.length) throw new Error(`Unexpected "${s.slice(i)}" in ${src}`);
  if (!Number.isFinite(v)) throw new Error(`${src} has no finite answer`);
  return v;
}

export async function calculate({ items }: { items: { label: string; expression: string }[] }) {
  return {
    results: items.map(({ label, expression }) => {
      try {
        const v = evaluate(expression);
        return { label, expression, result: Number(v.toPrecision(6)) };
      } catch (e) {
        return { label, expression, error: (e as Error).message };
      }
    }),
  };
}

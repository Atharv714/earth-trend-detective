// What the detective is looking at, as the globe shows it: the area it is
// reading (focus) and, after a scan, every grid cell's trend (grid). The
// server sends both as data parts while it works (research.ts, toGlobe).

import { HAZE_RAMP, WARM_RAMP, WET_RAMP, hazeColor, warmColor, wetColor } from "./colors";
import type { GlobeFocus, GlobeGrid, GlobeImagery } from "./agent/view";

export interface Probe {
  /**
   * Where the camera looks, outlined: all the areas of the current answer
   * together (the model reads several at once). `id` is the box, so the camera only moves
   * when the frame really changes. `what` is the newest thing being read.
   */
  focus: (GlobeFocus & { id: string }) | null;
  /**
   * The answer's heat maps of one measure, merged: the model reads a basin and
   * each of its countries in parallel, and they arrive in any order.
   */
  grid: (GlobeGrid & { id: string }) | null;
  /** The newest then/now satellite map, else the newest map. */
  imagery: (GlobeImagery & { id: string }) | null;
  /** A map and a heat map would hide each other: the globe shows the one that came last first. */
  latest: "imagery" | "grid" | null;
  /** The detective is still working: pulse the caption, sweep the frame. */
  scanning: boolean;
}

type Box = [number, number, number, number];

/**
 * The globe's view of one answer, from its data parts in order. With nothing
 * in the answer yet, the previous answer's view stays.
 */
export function probeOf(parts: { type: string; data?: unknown }[], live: boolean): Probe | null {
  const focuses = parts.filter((p) => p.type === "data-focus").map((p) => p.data as GlobeFocus);
  const grids = parts.filter((p) => p.type === "data-grid").map((p) => p.data as GlobeGrid & { id: string });
  // A then/now split the answer talks about beats the single latest-month map measure_satellite sends after it.
  const splitMap = parts.findLastIndex((p) => p.type === "data-imagery" && !!(p.data as GlobeImagery).before);
  const lastMap = splitMap >= 0 ? splitMap : parts.findLastIndex((p) => p.type === "data-imagery");
  const lastGrid = parts.findLastIndex((p) => p.type === "data-grid");
  if (!focuses.length && !grids.length && lastMap < 0) return null;
  const imagery = lastMap >= 0 ? (parts[lastMap].data as GlobeImagery & { id: string }) : null;
  const grid = merged(grids);
  const areas: Box[] = [];
  for (const f of focuses) if (!areas.some((b) => b.join() === f.box.join())) areas.push(f.box);
  const last = focuses.at(-1);
  let focus: Probe["focus"] = null;
  if (last) {
    const all = union([...areas, ...(grid ? [grid.box] : [])]);
    // Areas far apart (two continents) would zoom out to half the Earth: follow the newest instead.
    const box = all[2] - all[0] > 50 || all[3] - all[1] > 50 ? last.box : all;
    const names = [...new Set(focuses.map((f) => f.name))];
    focus = { name: grid?.name ?? (names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ")), box, what: last.what, id: box.join(",") };
  }
  if (!focus && imagery?.box) focus = { name: imagery.name, box: imagery.box, what: `Showing ${imagery.title}`, id: imagery.box.join(",") };
  const latest = lastMap > lastGrid ? "imagery" : lastGrid >= 0 ? "grid" : null;
  return { focus, grid, imagery, latest, scanning: live };
}

type Grid = GlobeGrid & { id: string };

/**
 * The grids comparable with the first (same measure, cell size, years, season) as one map; a cell read twice is drawn once.
 * Seasons tested side by side arrive in any order: the whole year leads when there is one.
 */
function merged(grids: Grid[]): Grid | null {
  const first = grids.find((g) => !g.season) ?? grids[0];
  if (!first) return null;
  const same = grids.filter(
    (g) => g.parameter === first.parameter && g.step.join() === first.step.join() && g.years.join() === first.years.join() && g.season === first.season,
  );
  if (same.length === 1) return first;
  const seen = new Set<string>();
  const cells = same.flatMap((g) => g.cells).filter((c) => !seen.has(`${c[0]},${c[1]}`) && !!seen.add(`${c[0]},${c[1]}`));
  const names = [...new Set(same.map((g) => g.name))];
  return {
    ...first,
    id: same.map((g) => g.id).join("+"),
    name: names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", "),
    box: union(same.map((g) => g.box)),
    cells,
  };
}

function union(boxes: Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

interface Scale {
  ramp: string[];
  color: (t: number) => string;
  up: string;
  down: string;
}

const TEMPERATURE = /^(T2M|T10M|TS|TQV|T2MDEW|T2MWET|TO3)/;

/** Colours and words for a parameter: water and rain brown to teal, heat blue to red. */
export function scaleFor(parameter: string): Scale {
  const p = parameter.toUpperCase();
  if (p.startsWith("SAT_")) {
    // A satellite map layer (measure_satellite): its id says what it measures.
    if (/NDVI|EVI|VEGETATION|LAI/.test(p)) return { ramp: WET_RAMP, color: wetColor, up: "greener", down: "browner" };
    if (/PRECIP|RAIN|SOIL_MOISTURE|WATER|SNOW|ICE/.test(p)) return { ramp: WET_RAMP, color: wetColor, up: "more", down: "less" };
    if (/AOD|AEROSOL|DUST|SMOKE|NITROGEN|NO2|CARBON_MONOXIDE|SULFUR|SO2/.test(p)) return { ramp: HAZE_RAMP, color: hazeColor, up: "more polluted", down: "cleaner" };
    if (/TEMP|SST/.test(p)) return { ramp: WARM_RAMP, color: warmColor, up: "warming", down: "cooling" };
    return { ramp: WARM_RAMP, color: warmColor, up: "rising", down: "falling" };
  }
  if (p === "WATER_STORAGE") return { ramp: WET_RAMP, color: wetColor, up: "gaining water", down: "losing water" };
  if (/^PREC|^GWET|^EVP|^RH2M|^QV2M/.test(p)) return { ramp: WET_RAMP, color: wetColor, up: "wetter", down: "drier" };
  if (TEMPERATURE.test(p)) return { ramp: WARM_RAMP, color: warmColor, up: "warming", down: "cooling" };
  if (/^AOD/.test(p)) return { ramp: HAZE_RAMP, color: hazeColor, up: "hazier", down: "cleaner" };
  return { ramp: WARM_RAMP, color: warmColor, up: "rising", down: "falling" };
}

/**
 * The colour scale's end: the 90th percentile of the cells' rates, so one
 * extreme cell does not wash the rest out. Rounded to a readable number.
 */
export function limitOf(grid: GlobeGrid): number {
  const v = grid.cells.map((c) => Math.abs(c[2])).sort((a, b) => a - b);
  const raw = v[Math.floor(v.length * 0.9)] || v[v.length - 1] || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => n * mag >= raw) ?? 10;
  return nice * mag;
}

/** "−92 mm" style numbers for the caption. */
export function fmt(v: number): string {
  const a = Math.abs(v);
  // NO2 columns are ~10^15 molecules/cm²: write those as "8 × 10¹⁴".
  if (a >= 1e5) {
    const e = Math.floor(Math.log10(a));
    const m = Number((a / 10 ** e).toPrecision(2));
    const sup = String(e).replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+d]);
    return `${v < 0 ? "−" : "+"}${m === 1 ? "" : `${m} × `}10${sup}`;
  }
  const s = a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(0) : a >= 1 ? a.toFixed(1) : a.toPrecision(2);
  return `${v < 0 ? "−" : v > 0 ? "+" : ""}${s}`;
}

/** The grid's units after a number (" °C", " mm/day"), or nothing for unitless ones. POWER writes Celsius as "C". */
export function unitOf(grid: GlobeGrid): string {
  const u = grid.units === "C" ? "°C" : grid.units;
  return u && u !== "1" && u !== "-" ? ` ${u}` : "";
}

/** Plain words for a POWER code the caption shows when the grid has no title. */
export function measureName(grid: GlobeGrid): string {
  return grid.title && grid.title !== grid.parameter ? grid.title : grid.parameter;
}

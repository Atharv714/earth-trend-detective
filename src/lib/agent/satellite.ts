// Any NASA satellite map, for any place: the detective's window into GIBS
// (Global Imagery Browse Services), about 1,000 layers from MODIS, VIIRS,
// GPM, SMAP, GHRSST, MERRA-2, TEMPO, OMI and more.
//   find_satellite_layers  search the live catalog for a measure
//   show_satellite_map     put a layer on the globe for a date (or two, split)
//   measure_satellite      read values off the map tiles, year by year, and test the trend
// GIBS data tiles are palette PNGs whose palette index is the colormap entry,
// so each pixel turns back into a number (the middle of its colour's range).
// These are visualisation products: good for patterns and trends, not a
// replacement for the science files.
import "server-only";

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trend, type YearValue } from "../series";
import { r3 } from "./data";
import { deg, focusOn, roundBox, toGlobe } from "./globe";
import { decodePng } from "./png";
import { area, chance, toSeries, verdict, type AreaArgs } from "./research";
import type { GlobeGrid, GlobeImagery } from "./view";

type Box = [number, number, number, number];

const WMTS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";
const CAPS = `${WMTS}/1.0.0/WMTSCapabilities.xml`;
const CACHE = join(tmpdir(), "earth-trend-detective", "gibs-capabilities.xml");
const DAY = 86_400_000;

/** Deepest zoom level of each GIBS tile-matrix set. */
const MAX_LEVEL: Record<string, number> = { "2km": 5, "1km": 6, "500m": 7, "250m": 8, "31.25m": 11, "15.625m": 12 };

/* ------------------------------------------------------------------ */
/* Catalog                                                             */

interface TimeRange {
  start: number;
  end: number;
  period: Period;
  /** The dates carry a time of day. */
  clock: boolean;
}

interface Period {
  months: number;
  ms: number;
  text: string;
}

export interface SatLayer {
  id: string;
  title: string;
  matrixSet: string;
  ext: "png" | "jpeg";
  colormap: string | null;
  times: TimeRange[];
}

let catalog: Promise<SatLayer[]> | null = null;

/** The GIBS capabilities document (5 MB), kept on disk for a day. */
async function capabilities(): Promise<string> {
  const fresh = await stat(CACHE).then((s) => Date.now() - s.mtimeMs < DAY, () => false);
  if (fresh) return readFile(CACHE, "utf8");
  const res = await fetch(CAPS, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`NASA GIBS catalog: HTTP ${res.status}`);
  const xml = await res.text();
  await mkdir(join(tmpdir(), "earth-trend-detective"), { recursive: true }).catch(() => {});
  await writeFile(CACHE, xml).catch(() => {});
  return xml;
}

function parsePeriod(text: string): Period {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text);
  if (!m) return { months: 0, ms: DAY, text };
  const [, y, mo, d, h, mi, s] = m.map((v) => Number(v ?? 0));
  return { months: y * 12 + mo, ms: d * DAY + h * 3_600_000 + mi * 60_000 + s * 1000, text };
}

const parseTime = (t: string) => Date.parse(t.length === 10 ? `${t}T00:00:00Z` : t);

function parseCatalog(xml: string): SatLayer[] {
  const out: SatLayer[] = [];
  for (const block of xml.split("<Layer>").slice(1)) {
    const body = block.slice(0, block.indexOf("</Layer>"));
    const id = /<ows:Identifier>([^<]+)<\/ows:Identifier>/.exec(body)?.[1];
    const title = /<ows:Title[^>]*>([^<]+)<\/ows:Title>/.exec(body)?.[1];
    const format = /<Format>([^<]+)<\/Format>/.exec(body)?.[1] ?? "";
    const matrixSet = /<TileMatrixSet>([^<]+)<\/TileMatrixSet>/.exec(body)?.[1];
    if (!id || !title || !matrixSet || !(matrixSet in MAX_LEVEL) || !/png|jpeg/.test(format)) continue;
    const colormap = /colormap\/1\.3' [^>]*xlink:href='([^']+)'/.exec(body)?.[1] ?? null;
    const times: TimeRange[] = [];
    for (const [, v] of body.matchAll(/<Value>([^<]+)<\/Value>/g)) {
      const [a, b, p] = v.split("/");
      if (!a || !b || !p) continue;
      times.push({ start: parseTime(a), end: parseTime(b), period: parsePeriod(p), clock: a.includes("T") && !a.endsWith("T00:00:00Z") });
    }
    out.push({ id, title: decode(title), matrixSet, ext: format.includes("jpeg") ? "jpeg" : "png", colormap, times });
  }
  return out;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');

export function satCatalog(): Promise<SatLayer[]> {
  catalog ??= capabilities()
    .then(parseCatalog)
    .catch((e) => {
      catalog = null;
      throw e;
    });
  return catalog;
}

const PERIOD_WORDS: [RegExp, string][] = [
  [/^P1D$/, "daily"],
  [/^P1M$/, "monthly"],
  [/^P1Y$/, "yearly"],
  [/^P8D$/, "8-day"],
  [/^P16D$/, "16-day"],
  [/^P5D$/, "5-day"],
  [/^PT/, "several times a day"],
];
const periodWord = (l: SatLayer) => {
  const p = l.times.at(-1)?.period.text;
  if (!p) return "one map (no dates)";
  return PERIOD_WORDS.find(([re]) => re.test(p))?.[1] ?? p;
};

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Everyday words → words in GIBS layer titles. */
const SYNONYMS: [RegExp, string[]][] = [
  [/vegetation|green|plant|forest|crop|ndvi/, ["ndvi", "evi", "vegetation"]],
  [/land.*temp|ground.*temp|surface temp|lst|heat/, ["land surface temperature"]],
  [/sea.*temp|ocean.*temp|sst|marine heat/, ["sea surface temperature"]],
  [/rain|precip/, ["precipitation"]],
  [/snow/, ["snow cover"]],
  [/soil/, ["soil moisture"]],
  [/aerosol|haze|smog|dust|smoke|pm2|particul/, ["aerosol optical depth"]],
  [/no2|nitrogen|pollution|traffic/, ["nitrogen dioxide"]],
  [/night ?light|lights|electric|black marble|urban/, ["night lights", "black marble", "earth at night"]],
  [/fire|burn/, ["burned area", "fire", "thermal anomalies"]],
  [/chlorophyll|algae|bloom/, ["chlorophyll"]],
  [/ice|glacier/, ["sea ice", "ice"]],
  [/cloud/, ["cloud"]],
  [/water vapo|humid/, ["water vapor", "humidity"]],
  [/ozone/, ["ozone"]],
  [/carbon monoxide|\bco\b/, ["carbon monoxide"]],
  [/so2|sulfur|volcan/, ["sulfur dioxide"]],
  [/flood/, ["flood"]],
  [/salin/, ["salinity"]],
  [/evapo/, ["evapotranspiration"]],
  [/wind/, ["wind"]],
  [/temperature|warm|hot/, ["temperature"]],
];

function span(l: SatLayer): [number, number] | null {
  if (!l.times.length) return null;
  return [l.times[0].start, l.times[l.times.length - 1].end];
}

export async function findSatelliteLayers({ search, max }: { search: string; max?: number | null }) {
  const all = await satCatalog();
  const q = search.toLowerCase();
  const words = q.split(/[^a-z0-9.]+/).filter((w) => w.length > 1);
  const phrases = SYNONYMS.filter(([re]) => re.test(q)).flatMap(([, p]) => p);
  const scored = all
    .map((l) => {
      const hay = `${l.title} ${l.id.replace(/_/g, " ")}`.toLowerCase();
      let s = 0;
      for (const w of words) if (hay.includes(w)) s += 2;
      for (const p of phrases) if (hay.includes(p)) s += 8;
      if (!s) return null;
      const sp = span(l);
      const years = sp ? (sp[1] - sp[0]) / (365.25 * DAY) : 0;
      // Long monthly records with a colour scale are the ones a trend can be read from.
      if (l.colormap) s += 2;
      if (periodWord(l) === "monthly") s += 2;
      s += Math.min(years, 25) / 8;
      if (/Orbit|Tracks|Granule|_Labels|Reference|Coastlines/i.test(l.id)) s -= 6;
      return { l, s };
    })
    .filter((x): x is { l: SatLayer; s: number } => !!x)
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.min(Math.max(max ?? 12, 1), 30));
  if (!scored.length) return { found: 0, note: `No GIBS layer matches "${search}". Try other words (e.g. "NDVI", "land surface temperature", "aerosol").` };
  return {
    found: scored.length,
    layers: scored.map(({ l }) => {
      const sp = span(l);
      return {
        layer: l.id,
        title: l.title,
        every: periodWord(l),
        from: sp ? iso(sp[0]) : null,
        to: sp ? iso(sp[1]) : null,
        resolution: l.matrixSet,
        measurable: !!l.colormap,
      };
    }),
    note: "measurable: has a colour scale, so measure_satellite can read numbers from it. Others (true colour, night lights) can only be shown.",
  };
}

async function layerOf(id: string): Promise<SatLayer> {
  const all = await satCatalog();
  const hit = all.find((l) => l.id === id) ?? all.find((l) => l.id.toLowerCase() === id.toLowerCase());
  if (hit) return hit;
  const near = await findSatelliteLayers({ search: id.replace(/_/g, " "), max: 5 });
  const names = "layers" in near ? near.layers!.map((l) => l.layer).join(", ") : "";
  throw new Error(`No GIBS layer "${id}".${names ? ` Closest: ${names}.` : ""} Use find_satellite_layers.`);
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */

function addMonths(t: number, k: number) {
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() + k);
  return d.getTime();
}

/** The layer's date on or just before `t` (its last date when `t` is past the end). */
function snap(l: SatLayer, t: number): number | null {
  if (!l.times.length) return null;
  const r = l.times.find((x) => t >= x.start && t <= x.end);
  if (!r) {
    const before = l.times.filter((x) => x.end < t);
    if (before.length) return before[before.length - 1].end;
    return l.times[0].start;
  }
  const p = r.period;
  if (p.months) {
    const a = new Date(r.start);
    const b = new Date(t);
    let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
    if (b.getUTCDate() < a.getUTCDate()) m--;
    return addMonths(r.start, Math.floor(m / p.months) * p.months);
  }
  return r.start + Math.floor((t - r.start) / p.ms) * p.ms;
}

function timeText(l: SatLayer, t: number | null): string | undefined {
  if (t == null) return undefined;
  const r = l.times.find((x) => t >= x.start && t <= x.end) ?? l.times.at(-1);
  return r?.clock || (r && r.period.ms && r.period.ms < DAY) ? new Date(t).toISOString().replace(".000", "") : iso(t);
}

function dateLabel(l: SatLayer, t: number | null): string {
  if (t == null) return "";
  const d = new Date(t);
  const w = periodWord(l);
  if (w === "yearly") return String(d.getUTCFullYear());
  if (w === "monthly") return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "2024", "2024-07" or "2024-07-15" as a time; null for the latest. */
function wanted(l: SatLayer, date?: string | null): number | null {
  const sp = span(l);
  if (!sp) return null;
  if (!date || /latest|now|today/i.test(date)) return sp[1];
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(date.trim());
  if (!m) throw new Error(`Date "${date}" should look like 2024, 2024-07 or 2024-07-15.`);
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 7;
  const d = m[3] ? Number(m[3]) : 15;
  return Date.UTC(y, mo - 1, periodWord(l) === "monthly" ? 1 : d);
}

/* ------------------------------------------------------------------ */
/* Colour scale → numbers                                              */

interface Scale {
  title: string;
  units: string;
  /** Value of each palette index; NaN for no data. */
  byIndex: Float64Array;
  byRgb: Map<number, number>;
  /** Colours of the data entries, low to high, for the legend. */
  colors: string[];
  min: number;
  max: number;
  numeric: boolean;
  /** A picture with no colour scale (true colour, Black Marble): read its brightness, 0–100. */
  brightness?: boolean;
}

/** Brightness for pictures without a colour scale: lit areas in Black Marble, smoke, snow or floods in true colour. */
const BRIGHTNESS: Scale = {
  title: "Brightness",
  units: "% of full brightness",
  byIndex: new Float64Array(256).fill(NaN),
  byRgb: new Map(),
  colors: [],
  min: 0,
  max: 100,
  numeric: false,
  brightness: true,
};

const scales = new Map<string, Promise<Scale>>();

const hex = (rgb: number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** The number a colour stands for: the middle of its range, or the finite end of an open one. */
function valueOf(v: string | undefined): number {
  if (!v) return NaN;
  const nums = v
    .replace(/[[\]()]/g, "")
    .split(",")
    .map((x) => (/-INF/i.test(x) ? -Infinity : /\+?INF/i.test(x) ? Infinity : Number(x)));
  if (nums.length === 1) return nums[0];
  const [a, b] = nums;
  if (a === -Infinity) return b > 0 ? 0 : b; // "below 0.1 mm/hr" is no rain
  if (b === Infinity) return a;
  return (a + b) / 2;
}

function scaleOf(l: SatLayer): Promise<Scale> {
  if (!l.colormap) return Promise.reject(new Error(`${l.title} has no colour scale, so its values cannot be read (it can still be shown).`));
  let p = scales.get(l.colormap);
  if (!p) {
    p = (async () => {
      const res = await fetch(l.colormap!, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`Colour scale for ${l.id}: HTTP ${res.status}`);
      const xml = await res.text();
      const byIndex = new Float64Array(256).fill(NaN);
      const byRgb = new Map<number, number>();
      const colors: string[] = [];
      let title = l.title;
      let units = "";
      let best = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const [, head, body] of xml.matchAll(/<ColorMap([^>]*)>([\s\S]*?)<\/ColorMap>/g)) {
        const entries = [...body.matchAll(/<ColorMapEntry([^>]*)\/>/g)].map(([, a]) => {
          const at = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(a)?.[1];
          const rgb = (at("rgb") ?? "0,0,0").split(",").map(Number);
          const nodata = at("nodata") === "true";
          const transparent = at("transparent") === "true";
          let v = nodata ? NaN : valueOf(at("value"));
          // A see-through colour with a closed range (water in NDVI, say) is not data.
          if (transparent && !/^\[-INF/i.test(at("value") ?? "")) v = NaN;
          const span = (at("value") ?? "")
            .replace(/[[\]()]/g, "")
            .split(",")
            .map((x) => (/-INF/i.test(x) ? -Infinity : /\+?INF/i.test(x) ? Infinity : Number(x)));
          return { rgb, ref: Number(at("ref")), v, transparent, lo: span[0], hi: span[1] };
        });
        // A catch-all first or last colour ("anything under 200 K") would read as its far-off
        // middle (−173 °C): read it at its inner edge, the nearest value it really stands for.
        const steps = entries.map((e) => e.hi - e.lo).filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
        const typical = steps[Math.floor(steps.length / 2)];
        const live = entries.filter((e) => !e.transparent && Number.isFinite(e.v));
        if (typical && live.length > 5) {
          const [first, last] = [live[0], live[live.length - 1]];
          // "Below 0.1 mm/hr" stays 0 (no rain); "below 220 K" is 220 K, not 0 K.
          if (first.hi - first.lo > typical * 10 && !(first.lo === -Infinity && first.hi <= typical * 10)) first.v = first.hi;
          if (last.hi - last.lo > typical * 10) last.v = last.lo;
        }
        for (const e of entries) {
          if (Number.isInteger(e.ref) && e.ref >= 0 && e.ref < 256) byIndex[e.ref] = e.v;
          byRgb.set((e.rgb[0] << 16) | (e.rgb[1] << 8) | e.rgb[2], e.v);
        }
        const data = entries.filter((e) => !e.transparent && Number.isFinite(e.v));
        if (data.length > best) {
          best = data.length;
          title = /title="([^"]*)"/.exec(head)?.[1] ?? title;
          units = /units="([^"]*)"/.exec(head)?.[1] ?? "";
          colors.length = 0;
          const k = Math.max(1, Math.floor(data.length / 10));
          for (let i = 0; i < data.length; i += k) colors.push(hex(data[i].rgb));
          if (colors.at(-1) !== hex(data[data.length - 1].rgb)) colors.push(hex(data[data.length - 1].rgb));
          min = data[0].v;
          max = data[data.length - 1].v;
        }
      }
      // Kelvin reads better as °C.
      if (units === "K") {
        for (let i = 0; i < 256; i++) byIndex[i] -= 273.15;
        for (const [k, v] of byRgb) byRgb.set(k, v - 273.15);
        min -= 273.15;
        max -= 273.15;
        units = "°C";
      }
      // The colour scale's title is often plainer, but some are copied from a sister layer
      // (MERRA-2 extinction says "Scattering"): keep it only when its words match the layer.
      const words = decode(title).toLowerCase().match(/scattering|extinction|absorption|day|night|ascending|descending|terra|aqua/g) ?? [];
      const layer = `${l.title} ${l.id.replace(/_/g, " ")}`.toLowerCase();
      if (!words.every((w) => layer.includes(w))) title = l.title;
      return { title: decode(title), units: decode(units), byIndex, byRgb, colors, min, max, numeric: best >= 5 };
    })().catch((e) => {
      scales.delete(l.colormap!);
      throw e;
    });
    scales.set(l.colormap, p);
  }
  return p;
}

/** A legend end: a hair above zero reads as 0. */
const tick = (v: number, sc: Scale) => `${Math.abs(v) < (sc.max - sc.min) * 0.01 ? "0" : num(v)}${sc.units ? ` ${sc.units}` : ""}`;

const num = (v: number) =>
  Math.abs(v) >= 1e5 ? v.toExponential(1) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : Number(v.toPrecision(2)).toString();

/* ------------------------------------------------------------------ */
/* Tiles                                                               */

/** Degrees one tile spans at a zoom level (GIBS EPSG:4326: 288° at level 0). */
const tileDeg = (z: number) => 288 / 2 ** z;

interface Tiling {
  z: number;
  tiles: { row: number; col: number }[];
}

/** The zoom that gives about `px` pixels across the box, and its tiles (at most `maxTiles`). */
function tiling(l: SatLayer, [w, s, e, n]: Box, px: number, maxTiles: number): Tiling {
  const maxZ = MAX_LEVEL[l.matrixSet] ?? 5;
  const side = Math.max(e - w, n - s);
  let z = Math.max(0, Math.min(maxZ, Math.round(Math.log2((px * 288) / (512 * side)))));
  for (;;) {
    const d = tileDeg(z);
    const cols = Math.ceil(360 / d);
    const rows = Math.ceil(180 / d);
    const c0 = Math.max(0, Math.floor((w + 180) / d));
    const c1 = Math.min(cols - 1, Math.floor((e + 180 - 1e-9) / d));
    const r0 = Math.max(0, Math.floor((90 - n) / d));
    const r1 = Math.min(rows - 1, Math.floor((90 - s - 1e-9) / d));
    const tiles = [];
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) tiles.push({ row, col });
    if (tiles.length <= maxTiles || z === 0) return { z, tiles };
    z--;
  }
}

const tileUrl = (l: SatLayer, time: string | undefined, z: number, row: number, col: number) =>
  `${WMTS}/${l.id}/default/${time ? `${time}/` : ""}${l.matrixSet}/${z}/${row}/${col}.${l.ext}`;

/**
 * Decoded tiles kept by URL, so a repeated question (a rehearsed demo) reads no tile twice.
 * A tile is 256 KB, so the cap holds about 100 MB. Failures are not kept.
 */
const tileCache = new Map<string, Promise<Float32Array | null>>();
const TILE_CACHE_MAX = 400;

/** One tile's values (NaN where there is no data), or null when the tile is missing. */
function tileValues(l: SatLayer, sc: Scale, time: string | undefined, z: number, row: number, col: number): Promise<Float32Array | null> {
  const key = tileUrl(l, time, z, row, col);
  const hit = tileCache.get(key);
  if (hit) {
    tileCache.delete(key); // most recently used goes last
    tileCache.set(key, hit);
    return hit;
  }
  const p = fetchTile(l, sc, time, z, row, col);
  p.catch(() => tileCache.delete(key));
  if (tileCache.size >= TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value!);
  tileCache.set(key, p);
  return p;
}

async function fetchTile(l: SatLayer, sc: Scale, time: string | undefined, z: number, row: number, col: number): Promise<Float32Array | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(tileUrl(l, time, z, row, col), { signal: AbortSignal.timeout(20_000) });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] !== 0x89) return null; // an error page, not an image
      const px = decodePng(buf);
      const out = new Float32Array(px.width * px.height);
      if (sc.brightness) {
        for (let i = 0; i < out.length; i++) {
          const o = i * 4;
          out[i] = px.rgba[o + 3] < 128 ? NaN : (0.2126 * px.rgba[o] + 0.7152 * px.rgba[o + 1] + 0.0722 * px.rgba[o + 2]) / 2.55;
        }
      } else if (px.index) {
        for (let i = 0; i < out.length; i++) out[i] = sc.byIndex[px.index[i]];
      } else {
        for (let i = 0; i < out.length; i++) {
          const o = i * 4;
          out[i] = px.rgba[o + 3] < 128 ? NaN : (sc.byRgb.get((px.rgba[o] << 16) | (px.rgba[o + 1] << 8) | px.rgba[o + 2]) ?? NaN);
        }
      }
      return out;
    } catch (e) {
      if (attempt) throw e;
    }
  }
  return null;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* Sampling an area                                                    */

interface Sampler {
  tiling: Tiling;
  /** Per sample: tile number, pixel offset, weight (cos lat), grid cell. */
  tile: Uint16Array;
  offset: Uint32Array;
  weight: Float32Array;
  cell: Int32Array;
  cells: { lat: number; lon: number }[];
  step: [number, number];
}

/** Which pixels of which tiles fall inside the area, and which grid cell each belongs to. */
function sampler(t: Tiling, box: Box, inside: ((lon: number, lat: number) => boolean) | null | undefined, cellsAcross: number): Sampler {
  const [w, s, e, n] = box;
  const d = tileDeg(t.z);
  const res = d / 512;
  const stepDeg = Math.max(res, Math.max(e - w, n - s) / cellsAcross);
  const nx = Math.max(1, Math.ceil((e - w) / stepDeg));
  const ny = Math.max(1, Math.ceil((n - s) / stepDeg));
  const sx = (e - w) / nx;
  const sy = (n - s) / ny;
  // Keep about 60,000 pixels at most.
  const total = ((e - w) / res) * ((n - s) / res);
  const stride = Math.max(1, Math.ceil(Math.sqrt(total / 60_000)));
  const tile: number[] = [];
  const offset: number[] = [];
  const weight: number[] = [];
  const cell: number[] = [];
  t.tiles.forEach(({ row, col }, k) => {
    const lon0 = -180 + col * d;
    const lat0 = 90 - row * d;
    for (let y = 0; y < 512; y += stride) {
      const lat = lat0 - (y + 0.5) * res;
      if (lat < s || lat > n) continue;
      for (let x = 0; x < 512; x += stride) {
        const lon = lon0 + (x + 0.5) * res;
        if (lon < w || lon > e) continue;
        if (inside && !inside(lon, lat)) continue;
        tile.push(k);
        offset.push(y * 512 + x);
        weight.push(Math.cos((lat * Math.PI) / 180));
        cell.push(Math.min(ny - 1, Math.floor((n - lat) / sy)) * nx + Math.min(nx - 1, Math.floor((lon - w) / sx)));
      }
    }
  });
  const cells = Array.from({ length: nx * ny }, (_, i) => ({ lat: n - (Math.floor(i / nx) + 0.5) * sy, lon: w + ((i % nx) + 0.5) * sx }));
  return {
    tiling: t,
    tile: Uint16Array.from(tile),
    offset: Uint32Array.from(offset),
    weight: Float32Array.from(weight),
    cell: Int32Array.from(cell),
    cells,
    step: [Number(sx.toFixed(3)), Number(sy.toFixed(3))],
  };
}

interface Reading {
  mean: number;
  /** Share of the area with data. */
  covered: number;
  p10: number;
  p90: number;
  /** Share of the area brighter than a quarter of full brightness (brightness readings only). */
  bright: number;
  cellMeans: Float32Array;
}

/** Read one date over the area: weighted mean, spread, and each grid cell's mean. */
async function read(l: SatLayer, sc: Scale, sm: Sampler, time: string | undefined): Promise<Reading | null> {
  const tiles = await Promise.all(sm.tiling.tiles.map(({ row, col }) => tileValues(l, sc, time, sm.tiling.z, row, col)));
  if (tiles.every((x) => !x)) return null;
  const nCells = sm.cells.length;
  const cs = new Float64Array(nCells);
  const cw = new Float64Array(nCells);
  const cn = new Uint32Array(nCells);
  const all = new Uint32Array(nCells);
  let sum = 0;
  let wsum = 0;
  let got = 0;
  let bright = 0;
  const vals: number[] = [];
  for (let i = 0; i < sm.tile.length; i++) {
    const c = sm.cell[i];
    all[c]++;
    const v = tiles[sm.tile[i]]?.[sm.offset[i]];
    if (v == null || !Number.isFinite(v)) continue;
    const wt = sm.weight[i];
    sum += v * wt;
    wsum += wt;
    got++;
    if (v >= 25) bright++;
    cs[c] += v * wt;
    cw[c] += wt;
    cn[c]++;
    if (vals.length < 20_000) vals.push(v);
  }
  if (!got) return null;
  vals.sort((a, b) => a - b);
  const cellMeans = new Float32Array(nCells).fill(NaN);
  for (let c = 0; c < nCells; c++) if (all[c] && cn[c] >= all[c] * 0.3) cellMeans[c] = cs[c] / cw[c];
  return { mean: sum / wsum, covered: got / sm.tile.length, bright: bright / got, p10: vals[Math.floor(vals.length * 0.1)], p90: vals[Math.floor(vals.length * 0.9)], cellMeans };
}

/* ------------------------------------------------------------------ */
/* show_satellite_map                                                  */

function imagery(l: SatLayer, sc: Scale | null, name: string, box: Box | null, time: string | undefined, label: string, before?: { time?: string; label: string }): GlobeImagery {
  return {
    name,
    layer: l.id,
    title: sc?.numeric ? sc.title : l.title,
    source: l.title,
    matrixSet: l.matrixSet,
    maxLevel: MAX_LEVEL[l.matrixSet] ?? 5,
    ext: l.ext,
    time,
    label,
    ...(before ? { before: before.time, beforeLabel: before.label } : {}),
    box: box ? roundBox(box) : null,
    legend: sc?.numeric ? { stops: sc.colors, min: tick(sc.min, sc), max: tick(sc.max, sc) } : null,
  };
}

export const showImagery = (part: GlobeImagery) => toGlobe({ type: "imagery", ...part });

/** A box around the area with some margin, so the map shows its surroundings too. */
function padded([w, s, e, n]: Box): Box {
  // A city is a speck from orbit: show at least ~5° around it.
  const gx = Math.max(1, (e - w) * 0.25, (5 - (e - w)) / 2);
  const gy = Math.max(1, (n - s) * 0.25, (5 - (n - s)) / 2);
  return [Math.max(-180, w - gx), Math.max(-90, s - gy), Math.min(180, e + gx), Math.min(90, n + gy)];
}

export async function showSatelliteMap(a: AreaArgs & { layer: string; date?: string | null; compareDate?: string | null; wholeEarth?: boolean | null }) {
  const l = await layerOf(a.layer);
  const where = a.place || a.box ? await area(a) : null;
  const sc = l.colormap ? await scaleOf(l).catch(() => null) : null;
  const t = snap(l, wanted(l, a.date) ?? 0);
  const time = timeText(l, t);
  const label = dateLabel(l, t);
  const t0 = a.compareDate ? snap(l, wanted(l, a.compareDate) ?? 0) : null;
  const before = t0 != null ? { time: timeText(l, t0), label: dateLabel(l, t0) } : undefined;
  const name = where?.name ?? "The whole Earth";
  const shown = where && !a.wholeEarth ? padded(where.box) : null;
  if (where) focusOn(where.name, where.box, `Showing ${l.title}`);
  showImagery(imagery(l, sc, name, shown, time, label, before));

  // A quick reading of what the map shows, so the answer can quote it.
  // With no colour scale (true colour, Black Marble) the picture's brightness is read instead.
  let summary: Record<string, unknown> | null = null;
  const by = sc?.numeric ? sc : !l.colormap && where ? BRIGHTNESS : null;
  if (by && where) {
    const sm = sampler(tiling(l, where.box, by.brightness ? 400 : 200, 6), where.box, where.inside, 12);
    if (sm.tile.length) {
      const [now, then] = await Promise.all([read(l, by, sm, time), before ? read(l, by, sm, before.time) : Promise.resolve(null)]);
      const card = (r: Reading | null, when: string) =>
        r
          ? {
              date: when,
              areaMean: r3(r.mean),
              typicalRange: [r3(r.p10), r3(r.p90)],
              ...(by.brightness ? { brightShare: `${Math.round(r.bright * 100)}%` } : {}),
              shareWithData: `${Math.round(r.covered * 100)}%`,
            }
          : { date: when, areaMean: null, note: "No data there that date (clouds, night or outside the sensor's swath)." };
      summary = { units: by.units, measure: by.title, now: card(now, label), ...(before ? { before: card(then, before.label) } : {}) };
      if (now && then) summary.change = r3(now.mean - then.mean);
      if (now && then && by.brightness) summary.brightShareChange = `${Math.round((now.bright - then.bright) * 100)} points`;
    }
  }
  return {
    shown: `${l.title} for ${label}${before ? `, split against ${before.label} (drag the line on the globe)` : ""}, on the globe${where ? ` over ${where.name}` : ""}.`,
    layer: l.id,
    title: l.title,
    every: periodWord(l),
    date: label,
    available: span(l) ? `${iso(span(l)![0])} to ${iso(span(l)![1])}` : "no dates",
    ...(summary
      ? {
          reading: summary,
          note: by?.brightness
            ? "This map is a picture with no data scale, so its brightness was read (0–100). brightShare = share of the area brighter than 25%: for night lights, the lit area. Two dates only show change, not a trend."
            : "Values read from the map's colour scale (NASA GIBS), about the middle of each colour's range.",
        }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* measure_satellite                                                   */

// Tiles one measurement may fetch. Each takes ~0.8 s from GIBS, so 160 at 32 at a time is ~5 s;
// 360 at 24 took ~12 s per place, ~21 s for a two-city question (15 Nov). Over 26 years that
// still reads 6 months a year, plenty for a trend.
const MAX_REQUESTS = 160;
const PARALLEL_TILES = 32;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function measureSatellite(a: AreaArgs & { layer: string; months?: number[] | null; from?: number | null; to?: number | null }) {
  const l = await layerOf(a.layer);
  const sc = await scaleOf(l);
  if (!sc.numeric) throw new Error(`${l.title} shows classes, not amounts, so it has no trend to measure. Show it with show_satellite_map instead.`);
  const where = await area(a);
  const sp = span(l);
  if (!sp) throw new Error(`${l.title} has no dates.`);
  const word = periodWord(l);
  focusOn(where.name, where.box, `Reading ${sc.title.toLowerCase()} off NASA satellite maps`);

  // Which dates: each wanted month of each year (the 15th for daily maps, one map a year for yearly ones).
  let months = [...new Set((a.months?.length ? a.months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).filter((m) => m >= 1 && m <= 12))].sort((x, y) => x - y);
  const lastT = sp[1];
  const firstYear = new Date(sp[0]).getUTCFullYear() + (new Date(sp[0]).getUTCMonth() > months[0] - 1 ? 1 : 0);
  const lastYear = new Date(lastT).getUTCFullYear() - (new Date(lastT).getUTCMonth() < months[months.length - 1] - 1 ? 1 : 0);
  const y0 = Math.max(a.from ?? firstYear, firstYear);
  const y1 = Math.min(a.to ?? lastYear, lastYear);
  if (y1 < y0) throw new Error(`${l.title} runs ${iso(sp[0])} to ${iso(sp[1])}; nothing in ${a.from ?? ""}–${a.to ?? ""}.`);

  const t = tiling(l, where.box, 160, 4);
  const sm = sampler(t, where.box, where.inside, 18);
  if (!sm.tile.length) throw new Error(`${where.name} is too small for this map's pixels; give a larger box.`);
  const perYear = word === "yearly" ? 1 : months.length;
  const years = y1 - y0 + 1;
  let sampledNote = "";
  if (years * perYear * t.tiles.length > MAX_REQUESTS && perYear > 1) {
    const keep = Math.max(1, Math.floor(MAX_REQUESTS / (years * t.tiles.length)));
    const k = months.length / keep;
    months = Array.from({ length: keep }, (_, i) => months[Math.floor(i * k + k / 2)]);
    sampledNote = `To keep it quick, read ${months.map((m) => MONTH[m - 1]).join(", ")} each year.`;
  }

  const dates: { year: number; at: number; time: string | undefined }[] = [];
  const seen = new Set<string>();
  for (let y = y0; y <= y1; y++) {
    const targets = word === "yearly" ? [Date.UTC(y, 6, 1)] : months.map((m) => Date.UTC(y, m - 1, word === "monthly" ? 1 : 15));
    for (const target of targets) {
      const s = snap(l, target);
      if (s == null || new Date(s).getUTCFullYear() !== y) continue;
      const time = timeText(l, s);
      if (seen.has(time ?? "")) continue;
      seen.add(time ?? "");
      dates.push({ year: y, at: s, time });
    }
  }

  // Show the latest map while it reads.
  const latest = dates.at(-1);
  if (latest) showImagery(imagery(l, sc, where.name, padded(where.box), latest.time, dateLabel(l, latest.at)));
  const readings = await pool(dates, PARALLEL_TILES, (d) => read(l, sc, sm, d.time).catch(() => null));

  // A date where most of the area is hidden (cloud, snow, gaps) would skew the mean: drop it.
  const best = Math.max(0, ...readings.map((r) => r?.covered ?? 0));
  const ok = dates.map((d, i) => ({ ...d, r: readings[i] })).filter((x) => x.r && x.r.covered >= best * 0.5) as { year: number; time: string; r: Reading }[];
  if (!ok.length) throw new Error(`No usable ${l.title} data over ${where.name} for those dates.`);

  const byYear = new Map<number, Reading[]>();
  for (const x of ok) byYear.set(x.year, [...(byYear.get(x.year) ?? []), x.r]);
  const need = Math.max(1, Math.ceil((word === "yearly" ? 1 : months.length) / 2));
  const yearly: YearValue[] = [];
  const nCells = sm.cells.length;
  const cellYears: YearValue[][] = Array.from({ length: nCells }, () => []);
  for (const [year, rs] of [...byYear.entries()].sort((x, y) => x[0] - y[0])) {
    if (rs.length < need) continue;
    yearly.push({ year, value: rs.reduce((s, r) => s + r.mean, 0) / rs.length });
    for (let c = 0; c < nCells; c++) {
      const v = rs.map((r) => r.cellMeans[c]).filter(Number.isFinite);
      if (v.length >= need) cellYears[c].push({ year, value: v.reduce((s, x) => s + x, 0) / v.length });
    }
  }

  const whole = trend(yearly);
  const cells = sm.cells
    .map((c, i) => ({ ...c, t: trend(cellYears[i]) }))
    .filter((c): c is { lat: number; lon: number; t: NonNullable<ReturnType<typeof trend>> } => !!c.t);
  const season = a.months?.length ? months.map((m) => MONTH[m - 1]).join("+") : undefined;
  if (cells.length) {
    const grid: GlobeGrid = {
      name: where.name,
      title: sc.title,
      units: sc.units,
      parameter: `SAT_${l.id}`,
      box: roundBox(where.box),
      step: sm.step,
      years: [cells[0].t.firstYear, cells[0].t.lastYear],
      ...(season ? { season } : {}),
      cells: cells.map((c) => [deg(c.lat), deg(c.lon), r3(c.t.slopePerDecade), c.t.significant ? 1 : 0]),
    };
    toGlobe({ type: "grid", ...grid });
  }
  const sig = cells.filter((c) => c.t.significant);
  const byRate = [...cells].sort((x, y) => y.t.slopePerDecade - x.t.slopePerDecade);
  const card = (c: (typeof cells)[number]) => ({ lat: deg(c.lat), lon: deg(c.lon), perDecade: r3(c.t.slopePerDecade), significant: c.t.significant, chanceItIsLuck: chance(c.t.pValue) });

  return {
    place: { name: where.name },
    layer: l.id,
    measure: sc.title,
    units: sc.units,
    source: `NASA GIBS ${l.title}, ${word}; ${ok.length} maps read${sampledNote ? ` (${sampledNote})` : ""}`,
    months: word === "yearly" ? "one map a year" : months.map((m) => MONTH[m - 1]).join(", "),
    ...(whole ? { wholeArea: verdict(whole, sc.units) } : { wholeArea: { trend: `Too few years for a trend test (${yearly.length}).`, years: Object.fromEntries(yearly.map((y) => [y.year, r3(y.value)])) } }),
    gridCells: cells.length,
    cellsRisingSignificantly: sig.filter((c) => c.t.slopePerDecade > 0).length,
    cellsFallingSignificantly: sig.filter((c) => c.t.slopePerDecade < 0).length,
    cellsWithNoClearTrend: cells.length - sig.length,
    fastestRising: byRate.slice(0, 3).map(card),
    fastestFalling: byRate.slice(-3).reverse().map(card),
    series: toSeries(yearly),
    note: "Values read from NASA GIBS map tiles through their colour scale (the middle of each colour's range), averaged over the area by latitude-weighted pixels. Good for direction and size of change; official products give exact values.",
  };
}

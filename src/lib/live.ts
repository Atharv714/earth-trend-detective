// Any place on Earth: find it by name (OpenStreetMap Nominatim), then ask
// NASA POWER for its monthly record at a handful of points and average them.
// Both services are free, need no key and allow calls from the browser (HANDOFF §3).

import type { Month } from "./series";
import type { Region, Source } from "./regions";

const POWER = "https://power.larc.nasa.gov/api/temporal/monthly/point";
const PARAMS = ["T2M", "PRECTOTCORR", "GWETROOT", "AOD_55"] as const;
type Param = (typeof PARAMS)[number];
const FIRST_YEAR = 1981;
const LAST_YEAR = 2025;
/** Most points we average for one place; each one is a separate request. */
const MAX_POINTS = 12;
/** Requests at once: NASA POWER slows down past this. */
const PARALLEL = 6;

/* ------------------------------------------------------------------ */
/* NASA POWER                                                          */

type Record_ = Record<Param, Map<number, number>>;

const pointCache = new Map<string, Promise<Record_>>();

async function fetchPoint(lat: number, lon: number): Promise<Record_> {
  const url = `${POWER}?parameters=${PARAMS.join(",")}&community=AG&latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start=${FIRST_YEAR}&end=${LAST_YEAR}&format=JSON`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NASA POWER answered ${res.status}`);
  const json = (await res.json()) as { properties: { parameter: Record<Param, Record<string, number>> } };
  const out = {} as Record_;
  for (const p of PARAMS) {
    const m = new Map<number, number>();
    for (const [k, v] of Object.entries(json.properties.parameter[p] ?? {})) {
      const month = Number(k.slice(4));
      if (month < 1 || month > 12 || v <= -999) continue; // 13 is the yearly value; -999 is missing
      m.set(Number(k.slice(0, 4)) * 12 + month - 1, v);
    }
    out[p] = m;
  }
  return out;
}

function point(lat: number, lon: number) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  let p = pointCache.get(key);
  if (!p) {
    p = fetchPoint(lat, lon);
    p.catch(() => pointCache.delete(key));
    pointCache.set(key, p);
  }
  return p;
}

/** Run at most PARALLEL at a time. */
async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  return out;
}

/** The average monthly record over several points, for one POWER parameter. */
export async function loadPower(points: [number, number][], param: string): Promise<Month[]> {
  const settled = await pool(points, ([lat, lon]) => point(lat, lon));
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (!ok.length) throw new Error("NASA POWER did not answer. Check the connection and try again in a minute.");
  const sum = new Map<number, { s: number; n: number }>();
  for (const rec of ok) {
    for (const [k, v] of rec[param as Param] ?? []) {
      const a = sum.get(k) ?? { s: 0, n: 0 };
      a.s += v;
      a.n++;
      sum.set(k, a);
    }
  }
  return [...sum.entries()]
    .filter(([, a]) => a.n >= Math.ceil(ok.length / 2))
    .sort((a, b) => a[0] - b[0])
    .map(([k, a]) => ({ year: Math.floor(k / 12), month: (k % 12) + 1, value: a.s / a.n }));
}

/* ------------------------------------------------------------------ */
/* Finding a place                                                     */

type Ring = [number, number][];
type Geo = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] } | { type: string };

interface Hit {
  name: string;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // lat min, lat max, lon min, lon max
  geojson?: Geo;
}

function inRing(lon: number, lat: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inShape(lon: number, lat: number, g: Geo | undefined): boolean {
  if (!g) return true;
  if (g.type === "Polygon") return inRing(lon, lat, (g as { coordinates: Ring[] }).coordinates[0]);
  if (g.type === "MultiPolygon") return (g as { coordinates: Ring[][] }).coordinates.some((p) => inRing(lon, lat, p[0]));
  return true;
}

/** Points spread evenly over the place, kept only where they fall inside its outline. */
function samplePoints(box: [number, number, number, number], centre: [number, number], g: Geo | undefined): [number, number][] {
  const [w, s, e, n] = box;
  if (e - w < 1 && n - s < 1) return [centre];
  const steps = 7;
  const grid: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const lat = s + ((i + 0.5) * (n - s)) / steps;
      const lon = w + ((j + 0.5) * (e - w)) / steps;
      if (inShape(lon, lat, g)) grid.push([lat, lon]);
    }
  }
  if (!grid.length) return [centre];
  if (grid.length <= MAX_POINTS) return grid;
  const every = grid.length / MAX_POINTS;
  return Array.from({ length: MAX_POINTS }, (_, i) => grid[Math.floor(i * every)]);
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Widest box we average over, in degrees: very large or wrap-around shapes are cut to the area around their centre. */
const MAX_SPAN = 50;

const live = (id: string, column: string, unit: string, what: string, n: number): Source => ({
  path: `live:${id}`,
  column,
  convert: "none",
  unit,
  label: `NASA POWER ${what}, fetched live for ${n === 1 ? "this point" : `${n} points across this place`}`,
});

const regionCache = new Map<string, Promise<Region>>();

/** Look a place up by name and build a region whose data comes live from NASA POWER. */
export function findPlace(query: string): Promise<Region> {
  const q = query.trim();
  const key = q.toLowerCase();
  let p = regionCache.get(key);
  if (!p) {
    p = geocode(q);
    p.catch(() => regionCache.delete(key));
    regionCache.set(key, p);
  }
  return p;
}

async function geocode(q: string): Promise<Region> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&polygon_geojson=1&polygon_threshold=0.05&accept-language=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The place search answered ${res.status}. Try again in a moment.`);
  const [hit] = (await res.json()) as Hit[];
  if (!hit) throw new Error(`Could not find “${q}”. Try a country, state or city name.`);

  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  const [s0, n0, w0, e0] = hit.boundingbox.map(Number);
  const half = MAX_SPAN / 2;
  const box: [number, number, number, number] = [
    clamp(w0, lon - half, lon),
    clamp(s0, lat - half, lat),
    clamp(e0, lon, lon + half),
    clamp(n0, lat, lat + half),
  ];
  const small = box[2] - box[0] < 1 && box[3] - box[1] < 1;
  const points = samplePoints(box, [lat, lon], hit.geojson);
  const id = `find:${q.toLowerCase()}`;
  const name = hit.name || hit.display_name.split(",")[0];
  const src = (column: string, unit: string, what: string): Source => ({ ...live(id, column, unit, what, points.length), points });

  return {
    id,
    name,
    group: "Searched",
    ...(small ? {} : { bbox: box }),
    lat,
    lon,
    monsoon: lon > 68 && lon < 98 && lat > 6 && lat < 37,
    temp: src("T2M", "°C", "air temperature"),
    rain: src("PRECTOTCORR", "mm/day", "rainfall"),
    soil: src("GWETROOT", "", "root-zone soil wetness"),
    air: src("AOD_55", "AOD", "aerosol optical depth (from MERRA-2)"),
  };
}

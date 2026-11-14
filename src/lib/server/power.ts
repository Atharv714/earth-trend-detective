// Live NASA POWER fetch for any point / box / place name on Earth.
import type { Point, Region } from "@/lib/types";
import { POWER_COLUMNS, VARIABLE_BY_ID } from "./catalog";
import { HttpError } from "./http";
import type { BaseSeries } from "./series";

const LIVE_PARAMS: Record<string, { param: string; community: "AG" | "RE" }> = {
  ...Object.fromEntries(Object.entries(POWER_COLUMNS).map(([param, c]) => [c.variable, { param, community: c.community }])),
  temperature_min: { param: "T2M_MIN", community: "AG" },
};
const COMMUNITY_PARAMS: Record<"AG" | "RE", string[]> = { AG: [], RE: [] };
for (const { param, community } of Object.values(LIVE_PARAMS)) COMMUNITY_PARAMS[community].push(param);

export const LIVE_VARIABLES = Object.keys(LIVE_PARAMS);

const START_YEAR = 1981;
const END_YEAR = 2025;
const UA = "earth-trend-detective/0.1 (NASA Space Apps 2026 student project)";

type MonthlyParams = Record<string, Record<string, number>>;
const pointCache = new Map<string, Promise<MonthlyParams>>();

async function fetchJson(url: string, timeoutMs = 30000): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(502, `Upstream ${new URL(url).host} returned HTTP ${res.status}`);
  return res.json();
}

/** All params of one community for one point, monthly 1981–2025. Cached in memory. */
function fetchPoint(lat: number, lon: number, community: "AG" | "RE"): Promise<MonthlyParams> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${community}`;
  let p = pointCache.get(key);
  if (!p) {
    const url =
      `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=${COMMUNITY_PARAMS[community].join(",")}` +
      `&community=${community}&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start=${START_YEAR}&end=${END_YEAR}&format=JSON`;
    p = fetchJson(url).then((j) => {
      const params = (j as { properties?: { parameter?: MonthlyParams } }).properties?.parameter;
      if (!params) throw new HttpError(502, "NASA POWER response had no data");
      return params;
    });
    p.catch(() => pointCache.delete(key));
    pointCache.set(key, p);
  }
  return p;
}

/** POWER { YYYYMM: value } → Point[] (drops month 13 = annual and -999 = missing). */
function toPoints(obj: Record<string, number> | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(obj ?? {})) {
    const m = Number(k.slice(4));
    if (m < 1 || m > 12 || v == null || v <= -998) continue;
    out.set(`${k.slice(0, 4)}-${k.slice(4)}`, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geocoding (OpenStreetMap Nominatim) with polygon, so grid samples land inside the place.
// ---------------------------------------------------------------------------

type Ring = [number, number][]; // [lon, lat]
type Place = { label: string; bbox: Region["bbox"]; polygons: Ring[][] | null };
const geoCache = new Map<string, Promise<Place>>();

function geocode(q: string): Promise<Place> {
  const key = q.trim().toLowerCase();
  let p = geoCache.get(key);
  if (!p) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&polygon_geojson=1&polygon_threshold=0.05`;
    p = fetchJson(url, 15000).then((j) => {
      const hit = (j as { display_name: string; boundingbox: string[]; geojson?: { type: string; coordinates: unknown } }[])[0];
      if (!hit) throw new HttpError(404, `Couldn't find a place called "${q}"`);
      const [latMin, latMax, lonMin, lonMax] = hit.boundingbox.map(Number);
      let polygons: Ring[][] | null = null;
      if (hit.geojson?.type === "Polygon") polygons = [hit.geojson.coordinates as Ring[]];
      else if (hit.geojson?.type === "MultiPolygon") polygons = hit.geojson.coordinates as Ring[][];
      return { label: hit.display_name.split(",")[0], bbox: [lonMin, latMin, lonMax, latMax], polygons };
    });
    p.catch(() => geoCache.delete(key));
    geoCache.set(key, p);
  }
  return p;
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygons = (lon: number, lat: number, polys: Ring[][]) =>
  polys.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h)));

/** Up to `max` sample points spread over the box (and inside the polygon, if given). */
export function samplePoints(bbox: Region["bbox"], polygons: Ring[][] | null, max = 20): [number, number][] {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  const lonSpan = lonMax - lonMin;
  const latSpan = latMax - latMin;
  // POWER's grid is ~0.5°; below that one point is enough.
  if (lonSpan < 0.5 && latSpan < 0.5) return [[(latMin + latMax) / 2, (lonMin + lonMax) / 2]];
  for (const res of [10, 6, 4, 3, 2]) {
    const nx = Math.max(1, Math.min(res, Math.ceil(lonSpan / 0.5)));
    const ny = Math.max(1, Math.min(res, Math.ceil(latSpan / 0.5)));
    let pts: [number, number][] = [];
    for (let i = 0; i < ny; i++)
      for (let j = 0; j < nx; j++) pts.push([latMin + ((i + 0.5) * latSpan) / ny, lonMin + ((j + 0.5) * lonSpan) / nx]);
    if (polygons) pts = pts.filter(([lat, lon]) => inPolygons(lon, lat, polygons));
    if (pts.length === 0) continue;
    if (pts.length <= max) return pts;
    const step = pts.length / max;
    return Array.from({ length: max }, (_, k) => pts[Math.floor(k * step)]);
  }
  return [[(latMin + latMax) / 2, (lonMin + lonMax) / 2]];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export type LiveQuery = { variable: string; lat?: number; lon?: number; bbox?: Region["bbox"]; q?: string };

export async function loadLive({ variable, lat, lon, bbox, q }: LiveQuery): Promise<BaseSeries & { samples: [number, number][] }> {
  const vdef = VARIABLE_BY_ID.get(variable);
  const lp = LIVE_PARAMS[variable];
  if (!vdef || !lp) throw new HttpError(400, `Live data supports: ${LIVE_VARIABLES.join(", ")}`);

  let label: string;
  let box: Region["bbox"];
  let polygons: Ring[][] | null = null;
  if (lat !== undefined && lon !== undefined) {
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, "lat must be within ±90 and lon within ±180");
    box = [lon, lat, lon, lat];
    label = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  } else if (bbox) {
    box = bbox;
    label = `Box ${bbox.map((x) => x.toFixed(1)).join(", ")}`;
  } else if (q) {
    const place = await geocode(q);
    box = place.bbox;
    polygons = place.polygons;
    label = place.label;
  } else throw new HttpError(400, "Give lat & lon, bbox=lonMin,latMin,lonMax,latMax, or q=<place name>");

  const samples = samplePoints(box, polygons);
  const results = await mapLimit(samples, 6, ([la, lo]) => fetchPoint(la, lo, lp.community));
  const acc = new Map<string, { s: number; n: number }>();
  for (const r of results) {
    for (const [t, v] of toPoints(r[lp.param])) {
      const a = acc.get(t) ?? { s: 0, n: 0 };
      a.s += v;
      a.n++;
      acc.set(t, a);
    }
  }
  const need = Math.ceil(samples.length * 0.8);
  const points: Point[] = [...acc.entries()]
    .filter(([, a]) => a.n >= need)
    .map(([t, a]) => ({ t, v: a.s / a.n }))
    .sort((a, b) => (a.t < b.t ? -1 : 1));
  if (points.length === 0) throw new HttpError(502, "NASA POWER returned no usable values for this place");

  return {
    meta: {
      variable,
      label: vdef.label,
      unit: vdef.unit,
      region: q ? `live:${q.trim().toLowerCase()}` : `live:${box.join(",")}`,
      regionLabel: label,
      source: samples.length > 1 ? `NASA POWER (live, average of ${samples.length} grid points)` : "NASA POWER (live)",
      frequency: "monthly",
      citation:
        "NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science / Applied Science Program (power.larc.nasa.gov). Place lookup: © OpenStreetMap contributors (Nominatim).",
    },
    points,
    samples,
  };
}

// NASA POWER for the detective's research tools: any parameter, at points or
// over a grid. Free and keyless. Limits learned the hard way (15 Nov 2026):
// the regional API takes one parameter per request and a box from 2° to 10°
// on each side, so wider areas are fetched as tiles.
import "server-only";

import type { Month } from "../series";

const BASE = "https://power.larc.nasa.gov/api/temporal/monthly";
export const POWER_FIRST = 1981;
export const POWER_LAST = 2025;
const PARALLEL = 6;

export interface ParamInfo {
  units: string;
  name: string;
}

interface PowerJson {
  properties?: { parameter?: Record<string, Record<string, number>> };
  parameters?: Record<string, { units?: string; longname?: string }>;
  features?: { geometry: { coordinates: [number, number, number?] }; properties: { parameter: Record<string, Record<string, number>> } }[];
  messages?: string[];
  errors?: string[];
}

/** POWER keys are "YYYYMM"; month 13 is the year's value; -999 is missing. */
function toMonths(rec: Record<string, number> | undefined): Month[] {
  const out: Month[] = [];
  for (const [k, v] of Object.entries(rec ?? {})) {
    const month = Number(k.slice(4));
    if (month < 1 || month > 12 || v <= -999) continue;
    out.push({ year: Number(k.slice(0, 4)), month, value: v });
  }
  return out.sort((a, b) => a.year - b.year || a.month - b.month);
}

/**
 * Answers kept by URL for as long as the server runs, so a question asked again
 * (a rehearsed demo) skips POWER's slow replies. Failures are not kept.
 */
const jsonCache = new Map<string, Promise<PowerJson>>();
const JSON_CACHE_MAX = 500;

function getJson(url: string): Promise<PowerJson> {
  const hit = jsonCache.get(url);
  if (hit) return hit;
  const p = fetchJson(url);
  p.catch(() => jsonCache.delete(url));
  if (jsonCache.size >= JSON_CACHE_MAX) jsonCache.delete(jsonCache.keys().next().value!);
  jsonCache.set(url, p);
  return p;
}

async function fetchJson(url: string): Promise<PowerJson> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => ({}))) as PowerJson;
  if (!res.ok) {
    const why = [...(json.messages ?? []), ...(json.errors ?? [])].join(" ").slice(0, 300);
    throw new Error(`NASA POWER answered ${res.status}${why ? `: ${why}` : ""}`);
  }
  return json;
}

const info = (json: PowerJson, p: string): ParamInfo => ({
  units: json.parameters?.[p]?.units ?? "",
  name: json.parameters?.[p]?.longname ?? p,
});

/** Run at most PARALLEL at a time. */
export async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>, parallel = PARALLEL): Promise<PromiseSettledResult<R>[]> {
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
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker));
  return out;
}

/* ------------------------------------------------------------------ */
/* Points                                                              */

type PointRecord = { months: Record<string, Month[]>; info: Record<string, ParamInfo> };
const pointCache = new Map<string, Promise<PointRecord>>();

function fetchPoint(lat: number, lon: number, params: string[]): Promise<PointRecord> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${params.join(",")}`;
  let p = pointCache.get(key);
  if (!p) {
    const url = `${BASE}/point?parameters=${params.join(",")}&community=AG&latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start=${POWER_FIRST}&end=${POWER_LAST}&format=JSON`;
    p = getJson(url).then((json) => ({
      months: Object.fromEntries(params.map((x) => [x, toMonths(json.properties?.parameter?.[x])])),
      info: Object.fromEntries(params.map((x) => [x, info(json, x)])),
    }));
    p.catch(() => pointCache.delete(key));
    pointCache.set(key, p);
  }
  return p;
}

/** Several parameters averaged over several points (one request per point). */
export async function powerAtPoints(points: [number, number][], params: string[]) {
  const settled = await pool(points, ([lat, lon]) => fetchPoint(lat, lon, params));
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
  return Object.fromEntries(
    params.map((p) => {
      const sum = new Map<number, { s: number; n: number }>();
      for (const rec of ok)
        for (const m of rec.months[p]) {
          const k = m.year * 12 + m.month - 1;
          const a = sum.get(k) ?? { s: 0, n: 0 };
          a.s += m.value;
          a.n++;
          sum.set(k, a);
        }
      const months: Month[] = [...sum.entries()]
        .filter(([, a]) => a.n >= Math.ceil(ok.length / 2))
        .sort((a, b) => a[0] - b[0])
        .map(([k, a]) => ({ year: Math.floor(k / 12), month: (k % 12) + 1, value: a.s / a.n }));
      return [p, { months, ...ok[0].info[p], points: ok.length }];
    }),
  ) as Record<string, { months: Month[]; units: string; name: string; points: number }>;
}

/* ------------------------------------------------------------------ */
/* Grids                                                               */

export type Box = [number, number, number, number]; // west, south, east, north

/** Split a box into tiles POWER accepts (each side 2°..10°). */
function tiles([w, s, e, n]: Box): Box[] {
  const out: Box[] = [];
  const nx = Math.ceil((e - w) / 10);
  const ny = Math.ceil((n - s) / 10);
  const dx = (e - w) / nx;
  const dy = (n - s) / ny;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) out.push([w + i * dx, s + j * dy, w + (i + 1) * dx, s + (j + 1) * dy]);
  return out;
}

export interface GridCell {
  lat: number;
  lon: number;
  months: Month[];
}

/** One parameter on POWER's grid (about 0.5°) over a box of any size, fetched in tiles. */
export async function powerGrid(box: Box, param: string, from = POWER_FIRST, to = POWER_LAST) {
  let [w, s, e, n] = box;
  // At least 2° each way.
  if (e - w < 2) [w, e] = [(w + e) / 2 - 1, (w + e) / 2 + 1];
  if (n - s < 2) [s, n] = [(s + n) / 2 - 1, (s + n) / 2 + 1];
  const parts = tiles([w, s, e, n]);
  const settled = await pool(
    parts,
    ([tw, ts, te, tn]) =>
      getJson(
        `${BASE}/regional?parameters=${param}&community=AG&latitude-min=${ts.toFixed(2)}&latitude-max=${tn.toFixed(2)}&longitude-min=${tw.toFixed(2)}&longitude-max=${te.toFixed(2)}&start=${from}&end=${to}&format=JSON`,
      ),
    4,
  );
  const ok = settled.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []));
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
  const seen = new Map<string, GridCell>();
  for (const json of ok)
    for (const f of json.features ?? []) {
      const [lon, lat] = f.geometry.coordinates;
      const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
      if (seen.has(key)) continue;
      const months = toMonths(f.properties.parameter[param]);
      if (months.length) seen.set(key, { lat, lon, months });
    }
  return { cells: [...seen.values()], ...info(ok[0], param), box: [w, s, e, n] as Box, tilesFailed: parts.length - ok.length };
}

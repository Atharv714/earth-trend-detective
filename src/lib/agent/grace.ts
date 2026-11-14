// GRACE/GRACE-FO: how much water an area holds (groundwater + soil + snow +
// lakes and rivers), monthly since April 2002, as an anomaly in mm of water.
// Read from the 1° land grid made by scripts/grace-to-grid.py.
import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { YearValue } from "../series";
import type { Box } from "./power";

const DIR = path.join(process.cwd(), "public", "trend_detective_data", "07_grace");
const MISSING = -32768;
/** GRACE sees features about 300 km across: smaller areas get the area around them. */
export const GRACE_MIN_SIDE = 3;
/** Fewest months a year needs to count (GRACE skips months, and 2017–18 is the gap between missions). */
const MIN_MONTHS = 6;

interface Grid {
  months: string[];
  cells: [number, number][];
  data: Int16Array;
  source: string;
}

let grid: Promise<Grid> | null = null;

function load(): Promise<Grid> {
  grid ??= (async () => {
    const [meta, bin] = await Promise.all([readFile(path.join(DIR, "meta.json"), "utf8"), readFile(path.join(DIR, "grace.bin"))]);
    const m = JSON.parse(meta) as { months: string[]; cells: [number, number][]; source: string };
    const data = new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2);
    return { ...m, data };
  })();
  grid.catch(() => (grid = null));
  return grid;
}

const KM_PER_DEG = 111.32;
/** Area of a 1° cell at this latitude, km². */
const cellArea = (lat: number) => KM_PER_DEG * KM_PER_DEG * Math.cos((lat * Math.PI) / 180);

/** Widen a box to GRACE's resolution around its centre. */
export function graceBox(box: Box): Box {
  const [w, s, e, n] = box;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const h = GRACE_MIN_SIDE / 2;
  return e - w >= GRACE_MIN_SIDE && n - s >= GRACE_MIN_SIDE ? box : [Math.min(w, cx - h), Math.min(s, cy - h), Math.max(e, cx + h), Math.max(n, cy + h)];
}

export interface GraceCell {
  lat: number;
  lon: number;
  /** mm, one per month in `months`; NaN = missing */
  values: number[];
}

/** Land cells whose centre falls in the box. */
export async function graceCells(box: Box): Promise<{ months: string[]; cells: GraceCell[]; source: string }> {
  const g = await load();
  const [w, s, e, n] = box;
  const M = g.months.length;
  const cells: GraceCell[] = [];
  g.cells.forEach(([lat, lon], i) => {
    if (lat < s || lat > n || lon < w || lon > e) return;
    const values = Array.from(g.data.subarray(i * M, (i + 1) * M), (v) => (v === MISSING ? NaN : v));
    cells.push({ lat, lon, values });
  });
  return { months: g.months, cells, source: g.source };
}

/** Area-weighted mean over cells, month by month. */
export function areaMean(cells: GraceCell[], months: string[]) {
  const out: { month: string; value: number }[] = [];
  months.forEach((m, t) => {
    let s = 0;
    let wsum = 0;
    for (const c of cells) {
      const v = c.values[t];
      if (Number.isNaN(v)) continue;
      const w = cellArea(c.lat);
      s += v * w;
      wsum += w;
    }
    if (wsum) out.push({ month: m, value: s / wsum });
  });
  return out;
}

export const areaKm2 = (cells: GraceCell[]) => cells.reduce((a, c) => a + cellArea(c.lat), 0);

/**
 * One value per year: each month minus its usual value for that calendar
 * month (so a year missing its wet months is not biased), averaged.
 */
export function graceYearly(series: { month: string; value: number }[]): YearValue[] {
  const clim = new Array(13).fill(0);
  const cnt = new Array(13).fill(0);
  for (const { month, value } of series) {
    const mo = Number(month.slice(5));
    clim[mo] += value;
    cnt[mo]++;
  }
  for (let i = 1; i <= 12; i++) clim[i] = cnt[i] ? clim[i] / cnt[i] : 0;
  const by = new Map<number, number[]>();
  for (const { month, value } of series) {
    const y = Number(month.slice(0, 4));
    const arr = by.get(y) ?? [];
    arr.push(value - clim[Number(month.slice(5))]);
    by.set(y, arr);
  }
  return [...by.entries()]
    .filter(([, a]) => a.length >= MIN_MONTHS)
    .map(([year, a]) => ({ year, value: a.reduce((x, y) => x + y, 0) / a.length }))
    .sort((a, b) => a.year - b.year);
}

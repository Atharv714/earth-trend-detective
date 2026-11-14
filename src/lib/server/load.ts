import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Point } from "@/lib/types";
import type { SourceDef } from "./catalog";

// In-memory caches (per server process).
const tableCache = new Map<string, Promise<Table>>();
const seriesCache = new Map<string, Promise<Point[]>>();

export type Table = { header: string[]; rows: string[][] };

// Literal path segments keep Next's file tracing scoped to the data folder.
const dataPath = (rel: string) => path.join(process.cwd(), "public", "trend_detective_data", rel);

function readTable(rel: string): Promise<Table> {
  let p = tableCache.get(rel);
  if (!p) {
    p = readFile(dataPath(rel), "utf8").then((text) => {
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      const header = lines[0].split(",").map((h) => h.trim());
      return { header, rows: lines.slice(1).map((l) => l.split(",")) };
    });
    p.catch(() => tableCache.delete(rel));
    tableCache.set(rel, p);
  }
  return p;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === "" || /^nan$/i.test(t)) return null;
  const x = Number(t);
  return Number.isFinite(x) && x > -998 ? x : null; // POWER uses -999 for missing
};

/** Reads one numeric column as Point[] (t = whatever the first column holds). */
export async function readColumn(rel: string, column?: string): Promise<Point[]> {
  const { header, rows } = await readTable(rel);
  const idx = column ? header.indexOf(column) : 1;
  if (idx < 0) throw new Error(`Column ${column} not found in ${rel}`);
  const out: Point[] = [];
  for (const r of rows) {
    const v = num(r[idx]);
    if (v !== null) out.push({ t: r[0].trim(), v });
  }
  return out;
}

/** Daily rows as objects, for extreme indices. */
export async function readDailyTable(rel: string): Promise<{ t: string; cols: Record<string, number | null> }[]> {
  const { header, rows } = await readTable(rel);
  return rows.map((r) => {
    const cols: Record<string, number | null> = {};
    header.forEach((h, i) => {
      if (i > 0) cols[h] = num(r[i]);
    });
    return { t: r[0].trim(), cols };
  });
}

/** Average daily points (t = YYYY-MM-DD) to monthly, requiring ≥ minDays values per month. */
export function dailyToMonthly(points: Point[], minDays = 20): Point[] {
  const acc = new Map<string, { s: number; n: number }>();
  for (const p of points) {
    const m = p.t.slice(0, 7);
    const a = acc.get(m) ?? { s: 0, n: 0 };
    a.s += p.v;
    a.n++;
    acc.set(m, a);
  }
  return [...acc.entries()]
    .filter(([, a]) => a.n >= minDays)
    .map(([t, a]) => ({ t, v: a.s / a.n }))
    .sort((a, b) => (a.t < b.t ? -1 : 1));
}

const convert = (pts: Point[], scale = 1, offset = 0): Point[] =>
  scale === 1 && offset === 0 ? pts : pts.map((p) => ({ t: p.t, v: p.v * scale + offset }));

async function loadPm25(template: string): Promise<Point[]> {
  const weights: Record<string, number> = { dust: 1, seasalt: 1, bc: 1, oc: 1.4, so4: 1.375 };
  const parts = await Promise.all(
    Object.keys(weights).map(async (c) => [c, await readColumn(template.replace("{c}", c))] as const),
  );
  const sum = new Map<string, { v: number; n: number }>();
  for (const [c, pts] of parts) {
    for (const p of pts) {
      const a = sum.get(p.t) ?? { v: 0, n: 0 };
      a.v += weights[c] * p.v;
      a.n++;
      sum.set(p.t, a);
    }
  }
  return [...sum.entries()]
    .filter(([, a]) => a.n === parts.length)
    .map(([t, a]) => ({ t, v: a.v * 1e9 })) // kg/m³ → µg/m³
    .sort((a, b) => (a.t < b.t ? -1 : 1));
}

async function loadSeaLevel(rel: string): Promise<Point[]> {
  const text = await readFile(dataPath(rel), "utf8");
  const acc = new Map<string, { s: number; n: number }>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("HDR")) continue;
    const [yf, gmsl] = line.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(yf) || !Number.isFinite(gmsl) || Math.abs(gmsl) > 1e30) continue;
    const year = Math.floor(yf);
    const month = Math.min(12, Math.floor((yf - year) * 12) + 1);
    const t = `${year}-${String(month).padStart(2, "0")}`;
    const a = acc.get(t) ?? { s: 0, n: 0 };
    a.s += gmsl;
    a.n++;
    acc.set(t, a);
  }
  return [...acc.entries()].map(([t, a]) => ({ t, v: a.s / a.n })).sort((a, b) => (a.t < b.t ? -1 : 1));
}

/** Full monthly series for a (non-extreme) source, in display units, sorted by time. */
export function loadMonthly(src: SourceDef): Promise<Point[]> {
  const key = `${src.kind}|${src.file}|${src.column ?? ""}`;
  let p = seriesCache.get(key);
  if (!p) {
    p = (async () => {
      switch (src.kind) {
        case "pm25":
          return loadPm25(src.file);
        case "sea_level":
          return loadSeaLevel(src.file);
        case "giovanni":
        case "power_monthly":
        case "power_daily": {
          let pts = await readColumn(src.file, src.column);
          if (src.nativeFrequency === "daily") pts = dailyToMonthly(pts);
          return convert(pts, src.scale, src.offset).sort((a, b) => (a.t < b.t ? -1 : 1));
        }
        default:
          throw new Error(`loadMonthly cannot load kind ${src.kind}`);
      }
    })();
    p.catch(() => seriesCache.delete(key));
    seriesCache.set(key, p);
  }
  return p;
}

// Client-side loading and trend statistics.
// A stand-in until Medhu's /api/trend lands (HANDOFF §5, §7); it uses the same
// method: Mann-Kendall test + Sen's slope on yearly values.

import type { Region, Source } from "./regions";
import { loadPower } from "./live";

export interface Month {
  year: number;
  month: number; // 1-12
  value: number;
}

export interface YearValue {
  year: number;
  value: number;
}

export interface Trend {
  n: number;
  firstYear: number;
  lastYear: number;
  mean: number;
  /** Sen's slope, unit per decade */
  slopePerDecade: number;
  /** Slope as % of the mean, per decade. Null when the mean is near zero. */
  pctPerDecade: number | null;
  /** Slope x length of the period */
  totalChange: number;
  pValue: number;
  significant: boolean;
  /** Trend line: value at a given year */
  at: (year: number) => number;
  /** How many of the 10 highest years fall in the 15 most recent */
  topTenInLast15: number;
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */

const text = new Map<string, Promise<string>>();

function fetchText(path: string): Promise<string> {
  let p = text.get(path);
  if (!p) {
    p = fetch(`/trend_detective_data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
      return r.text();
    });
    p.catch(() => text.delete(path));
    text.set(path, p);
  }
  return p;
}

const monthly = new Map<string, Promise<Month[]>>();

export function loadMonthly(src: Source): Promise<Month[]> {
  const key = `${src.path}#${src.column}`;
  let p = monthly.get(key);
  if (!p) {
    p = src.points
      ? loadPower(src.points, src.column)
      : fetchText(src.path).then((t) => monthlyMeans(src.format === "gmsl" ? parseGmsl(t) : parseMonthly(t, src)));
    monthly.set(key, p);
  }
  return p;
}

function parseMonthly(t: string, src: Source): Month[] {
  const lines = t.trim().split(/\r?\n/);
  const col = lines[0].split(",").indexOf(src.column);
  if (col < 0) throw new Error(`Column ${src.column} missing in ${src.path}`);
  const out: Month[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const raw = cells[col];
    if (!raw) continue;
    let v = Number(raw);
    if (!Number.isFinite(v)) continue;
    if (src.convert === "kelvin") v -= 273.15;
    if (src.convert === "mmPerHour") v *= 24;
    out.push({ year: Number(cells[0].slice(0, 4)), month: Number(cells[0].slice(5, 7)), value: v });
  }
  return out;
}

/** NASA's sea level indicator: "year.fraction GMSL smoothed" rows after HDR lines, a reading every ~10 days. */
function parseGmsl(t: string): Month[] {
  const out: Month[] = [];
  for (const line of t.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("HDR")) continue;
    const [time, gmsl] = line.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(time) || !Number.isFinite(gmsl) || Math.abs(gmsl) > 1e6) continue;
    const year = Math.floor(time);
    out.push({ year, month: Math.min(12, Math.floor((time - year) * 12) + 1), value: gmsl });
  }
  return out;
}

/** One value per month: daily or 10-day readings become that month's average. */
export function monthlyMeans(points: Month[]): Month[] {
  const acc = new Map<number, { year: number; month: number; sum: number; n: number }>();
  for (const p of points) {
    const k = p.year * 12 + p.month;
    const a = acc.get(k) ?? { year: p.year, month: p.month, sum: 0, n: 0 };
    a.sum += p.value;
    a.n++;
    acc.set(k, a);
  }
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, a]) => ({ year: a.year, month: a.month, value: a.sum / a.n }));
}

/* ------------------------------------------------------------------ */
/* Seasons                                                             */

export interface Season {
  id: string;
  label: string;
  months: number[];
}

export const WHOLE_YEAR: Season = { id: "year", label: "Whole year", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] };

const INDIA_SEASONS: Season[] = [
  { id: "winter", label: "Winter", months: [12, 1, 2] },
  { id: "summer", label: "Summer", months: [3, 4, 5] },
  { id: "monsoon", label: "Monsoon", months: [6, 7, 8, 9] },
  { id: "post", label: "After monsoon", months: [10, 11] },
];

const QUARTERS: Season[] = [
  { id: "djf", label: "Dec–Feb", months: [12, 1, 2] },
  { id: "mam", label: "Mar–May", months: [3, 4, 5] },
  { id: "jja", label: "Jun–Aug", months: [6, 7, 8] },
  { id: "son", label: "Sep–Nov", months: [9, 10, 11] },
];

export const seasonsFor = (r: Region) => (r.monsoon ? INDIA_SEASONS : QUARTERS);

export function seasonMonths(s: Season) {
  const n = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return s.months.length === 12 ? "Jan–Dec" : `${n[s.months[0] - 1]}–${n[s.months[s.months.length - 1] - 1]}`;
}

/**
 * One value per year for a season (or the whole year).
 * December counts toward the next year's winter. A year needs every month
 * of the season (the whole year may miss one), and a missing month is filled
 * with that month's long-term average, so a gap can't fake a trend.
 */
export function annualize(months: Month[], season: Season = WHOLE_YEAR): YearValue[] {
  const sum = new Array(13).fill(0);
  const cnt = new Array(13).fill(0);
  for (const m of months) {
    sum[m.month] += m.value;
    cnt[m.month]++;
  }
  const clim = sum.map((s, i) => (cnt[i] ? s / cnt[i] : NaN));
  // A month the record never has (Arctic December: polar night) is left out of the season.
  const present = season.months.filter((m) => cnt[m] > 0);
  if (!present.length) return [];
  const wraps = present.includes(12) && present.includes(1);
  const want = new Set(present);
  const need = season.months.length === 12 ? present.length - 1 : present.length;
  const climMean = present.reduce((a, m) => a + clim[m], 0) / present.length;

  const byYear = new Map<number, number[]>();
  for (const m of months) {
    if (!want.has(m.month)) continue;
    const y = wraps && m.month === 12 ? m.year + 1 : m.year;
    const arr = byYear.get(y) ?? [];
    arr.push(m.value - clim[m.month]);
    byYear.set(y, arr);
  }
  return [...byYear.entries()]
    .filter(([, a]) => a.length >= need)
    .map(([year, a]) => ({ year, value: climMean + a.reduce((x, y) => x + y, 0) / a.length }))
    .sort((a, b) => a.year - b.year);
}

/* ------------------------------------------------------------------ */
/* Trend test                                                          */

export const MIN_YEARS = 8;

export function trend(series: YearValue[]): Trend | null {
  const n = series.length;
  if (n < MIN_YEARS) return null;
  const xs = series.map((d) => d.year);
  const ys = series.map((d) => d.value);
  const mean = ys.reduce((a, b) => a + b, 0) / n;

  // Sen's slope: median of all pairwise slopes. Mann-Kendall S: sum of signs.
  const slopes: number[] = [];
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = ys[j] - ys[i];
      slopes.push(d / (xs[j] - xs[i]));
      s += Math.sign(d);
    }
  }
  const slope = median(slopes);
  const intercept = median(ys.map((y, i) => y - slope * xs[i]));

  // Variance of S with the tie correction (ties are common in day counts).
  const ties = new Map<number, number>();
  for (const y of ys) ties.set(y, (ties.get(y) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = varS <= 0 ? 0 : s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  const pValue = 2 * (1 - normCdf(Math.abs(z)));

  const firstYear = xs[0];
  const lastYear = xs[n - 1];
  const top10 = [...series].sort((a, b) => b.value - a.value).slice(0, 10);

  return {
    n,
    firstYear,
    lastYear,
    mean,
    slopePerDecade: slope * 10,
    pctPerDecade: Math.abs(mean) > 1e-6 ? ((slope * 10) / Math.abs(mean)) * 100 : null,
    totalChange: slope * (lastYear - firstYear),
    pValue,
    significant: pValue < 0.05,
    at: (year: number) => intercept + slope * year,
    topTenInLast15: top10.filter((d) => d.year > lastYear - 15).length,
  };
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Abramowitz-Stegun 7.1.26
function normCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export function formatP(p: number): string {
  if (p < 0.001) return "p < 0.001";
  return `p = ${p.toFixed(3)}`;
}

/** Keep only the years inside [from, to]. */
export const within = (s: YearValue[], [from, to]: [number, number]) => s.filter((d) => d.year >= from && d.year <= to);

/* ------------------------------------------------------------------ */
/* Daily station records (India): heat, nights, extreme rain           */

export interface DailyYear {
  year: number;
  /** Average daytime high and night-time low over the year, °C */
  dayHigh: number;
  nightLow: number;
  /** Days with a high above 40 °C */
  over40: number;
  /** Days with a high above 45 °C */
  over45: number;
  /** Days with more than 50 mm of rain */
  heavyRain: number;
  /** Longest run of days with under 1 mm of rain */
  dryRun: number;
}

const dailyCache = new Map<string, Promise<DailyYear[]>>();

export function loadDaily(path: string): Promise<DailyYear[]> {
  let p = dailyCache.get(path);
  if (!p) {
    p = fetchText(path).then(parseDaily);
    dailyCache.set(path, p);
  }
  return p;
}

function parseDaily(t: string): DailyYear[] {
  const lines = t.trim().split(/\r?\n/);
  const h = lines[0].split(",");
  const iMax = h.indexOf("T2M_MAX");
  const iMin = h.indexOf("T2M_MIN");
  const iRain = h.indexOf("PRECTOTCORR");
  const years = new Map<number, { n: number; hi: number; lo: number; o40: number; o45: number; wet: number; run: number; best: number }>();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const year = Number(c[0].slice(0, 4));
    const hi = Number(c[iMax]);
    const lo = Number(c[iMin]);
    const rain = Number(c[iRain]);
    if (![hi, lo, rain].every((v) => Number.isFinite(v) && v > -900)) continue;
    let y = years.get(year);
    if (!y) years.set(year, (y = { n: 0, hi: 0, lo: 0, o40: 0, o45: 0, wet: 0, run: 0, best: 0 }));
    y.n++;
    y.hi += hi;
    y.lo += lo;
    if (hi > 40) y.o40++;
    if (hi > 45) y.o45++;
    if (rain > 50) y.wet++;
    y.run = rain < 1 ? y.run + 1 : 0;
    y.best = Math.max(y.best, y.run);
  }
  return [...years.entries()]
    .filter(([, y]) => y.n >= 360)
    .map(([year, y]) => ({
      year,
      dayHigh: y.hi / y.n,
      nightLow: y.lo / y.n,
      over40: y.o40,
      over45: y.o45,
      heavyRain: y.wet,
      dryRun: y.best,
    }))
    .sort((a, b) => a.year - b.year);
}

export const pick = (d: DailyYear[], key: keyof Omit<DailyYear, "year">): YearValue[] => d.map((y) => ({ year: y.year, value: y[key] }));

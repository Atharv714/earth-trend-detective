import type { Point, Season } from "@/lib/types";

export const SEASON_MONTHS: Record<Exclude<Season, "all">, number[]> = {
  DJF: [12, 1, 2],
  MAM: [3, 4, 5],
  JJA: [6, 7, 8],
  SON: [9, 10, 11],
  monsoon: [6, 7, 8, 9],
};

export const SEASON_LABEL: Record<Season, string> = {
  all: "all months",
  DJF: "winter (Dec–Feb)",
  MAM: "spring / pre-monsoon (Mar–May)",
  JJA: "summer (Jun–Aug)",
  SON: "autumn (Sep–Nov)",
  monsoon: "monsoon (Jun–Sep)",
};

const month = (t: string) => Number(t.slice(5, 7));

/** Keep points with start ≤ t ≤ end. Accepts "YYYY", "YYYY-MM" or "YYYY-MM-DD" bounds. */
export function clip(points: Point[], start?: string, end?: string): Point[] {
  return points.filter((p) => {
    if (start && p.t.slice(0, start.length) < start) return false;
    if (end && p.t.slice(0, end.length) > end) return false;
    return true;
  });
}

/** Monthly anomalies: subtract each calendar month's mean over the given points. */
export function deseasonalize(points: Point[]): Point[] {
  const sum = new Array(13).fill(0);
  const cnt = new Array(13).fill(0);
  for (const p of points) {
    sum[month(p.t)] += p.v;
    cnt[month(p.t)]++;
  }
  return points.map((p) => ({ t: p.t, v: p.v - sum[month(p.t)] / cnt[month(p.t)] }));
}

export function filterSeason(points: Point[], season: Season): Point[] {
  if (season === "all") return points;
  const ms = SEASON_MONTHS[season];
  return points.filter((p) => ms.includes(month(p.t)));
}

/**
 * Monthly → annual means. With a season, each year averages only that season's months
 * (December counts toward the following year's DJF) and all of them must be present.
 * Without a season, a year needs ≥ 10 of 12 months.
 */
export function toAnnual(points: Point[], season: Season = "all"): Point[] {
  const need = season === "all" ? 10 : SEASON_MONTHS[season].length;
  const acc = new Map<number, { s: number; n: number }>();
  for (const p of points) {
    let y = Number(p.t.slice(0, 4));
    if (season === "DJF" && month(p.t) === 12) y += 1;
    const a = acc.get(y) ?? { s: 0, n: 0 };
    a.s += p.v;
    a.n++;
    acc.set(y, a);
  }
  return [...acc.entries()]
    .filter(([, a]) => a.n >= need)
    .sort((a, b) => a[0] - b[0])
    .map(([y, a]) => ({ t: String(y), v: a.s / a.n }));
}

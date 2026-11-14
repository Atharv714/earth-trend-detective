import type { ExtremeIndex, Frequency, Point, Season, Series, SeriesMeta, SeriesWithTrend, TrendResult } from "@/lib/types";
import { computeTrend, decimalYear } from "@/lib/stats";
import { EXTREME_VARIABLES, REGION_BY_ID, SOURCES, VARIABLE_BY_ID, findSource } from "./catalog";
import { computeExtreme } from "./extremes";
import { HttpError } from "./http";
import { loadMonthly } from "./load";
import { SEASON_LABEL, clip, deseasonalize, filterSeason, toAnnual } from "./transform";

export type SeriesOptions = {
  start?: string;
  end?: string;
  season?: Season;
  agg?: "monthly" | "annual";
  deseasonalize?: boolean;
  threshold?: number;
  /** Compute the trend inline. */
  trend?: boolean;
  /** Test the trend on raw monthly values instead of anomalies. */
  trendRaw?: boolean;
  /** Restrict to a dataset: giovanni | power | power_daily | nasa_ssh. */
  source?: string;
};

/** Base series as loaded, before user transforms. */
export type BaseSeries = { meta: Omit<SeriesMeta, "start" | "end">; points: Point[] };

export async function loadBase(variable: string, region: string, opts: SeriesOptions = {}): Promise<BaseSeries> {
  const vdef = VARIABLE_BY_ID.get(variable);
  if (!vdef) throw new HttpError(404, `Unknown variable "${variable}"`);
  const rdef = REGION_BY_ID.get(region);
  if (!rdef) throw new HttpError(404, `Unknown region "${region}"`);
  const src = findSource(variable, region, opts.source);
  if (!src) {
    const where = SOURCES.filter((s) => s.variable === variable).map((s) => s.region);
    throw new HttpError(
      404,
      `No ${opts.source ? opts.source + " " : ""}data for ${vdef.label} in ${rdef.label}. Available regions: ${[...new Set(where)].join(", ")}. For anywhere else use /api/live.`,
    );
  }

  let points: Point[];
  let unit = vdef.unit;
  if (src.kind === "extreme") {
    const thr = opts.threshold ?? EXTREME_VARIABLES[variable].threshold;
    points = await computeExtreme(src.file, src.extremeIndex as ExtremeIndex, thr);
    if (opts.threshold !== undefined) unit = `${unit} (threshold ${opts.threshold})`;
  } else {
    points = await loadMonthly(src);
  }
  return {
    meta: {
      variable,
      label: vdef.label,
      unit,
      region,
      regionLabel: rdef.label,
      source: src.source,
      frequency: src.frequency,
      citation: src.citation,
    },
    points,
  };
}

/** Clip, deseasonalize, season-filter and aggregate, then (optionally) attach a trend. */
export function finish(base: BaseSeries, opts: SeriesOptions = {}): SeriesWithTrend {
  const season = opts.season ?? "all";
  let freq: Frequency = base.meta.frequency;
  let pts = clip(base.points, opts.start, opts.end);
  const monthly = freq === "monthly";
  const anomalies = monthly && !!opts.deseasonalize;
  if (anomalies) pts = deseasonalize(pts);
  if (monthly) pts = filterSeason(pts, season);
  if (monthly && opts.agg === "annual") {
    pts = toAnnual(pts, season);
    freq = "annual";
  }

  const meta: SeriesMeta = {
    ...base.meta,
    frequency: freq,
    start: pts[0]?.t ?? "",
    end: pts.at(-1)?.t ?? "",
    ...(monthly && season !== "all" ? { season } : {}),
    ...(anomalies ? { deseasonalized: true, unit: `${base.meta.unit} (anomaly)` } : {}),
  };
  const series: SeriesWithTrend = { meta, points: pts };
  if (opts.trend) series.trend = trendFor(series, base.meta.unit, !!opts.trendRaw);
  return series;
}

/**
 * Trend for a finished series. Monthly data with a seasonal cycle is tested on anomalies
 * (plain Mann-Kendall assumes no seasonality), then the fit line is shifted back onto the raw values.
 */
export function trendFor(series: Series, baseUnit = series.meta.unit, raw = false): TrendResult {
  const { meta, points } = series;
  const vdef = VARIABLE_BY_ID.get(meta.variable);
  const seasonText = meta.season ? ` during ${SEASON_LABEL[meta.season]}` : "";
  const label = `${meta.deseasonalized ? `${meta.label} anomaly` : meta.label}${seasonText}`;
  const opts = {
    label,
    regionLabel: meta.regionLabel,
    where: meta.region === "world" ? " worldwide" : undefined,
    plural: /days|nights/.test(meta.variable) && !meta.deseasonalized,
    unit: baseUnit,
    allowPercent: (vdef?.ratioScale ?? true) && !meta.deseasonalized,
  };

  const monthsPresent = new Set(points.map((p) => p.t.slice(5, 7))).size;
  const useAnomalies = !raw && meta.frequency === "monthly" && !meta.deseasonalized && monthsPresent > 1;
  if (!useAnomalies) return computeTrend(points, opts);

  const trend = computeTrend(deseasonalize(points), { ...opts, allowPercent: false });
  if (trend.fitLine.length) {
    // Anomaly fit + raw mean puts the line through the middle of the raw data.
    const mean = points.reduce((a, p) => a + p.v, 0) / points.length;
    trend.fitLine = trend.fitLine.map((p) => ({ t: p.t, v: p.v + mean }));
    if (opts.allowPercent) {
      const x0 = decimalYear(points[0].t);
      const base = points.filter((p) => decimalYear(p.t) < x0 + 5);
      const m = base.reduce((a, p) => a + p.v, 0) / base.length;
      trend.percentChangeOverPeriod = Math.abs(m) > 1e-9 ? (trend.changeOverPeriod / Math.abs(m)) * 100 : null;
    }
  }
  trend.seasonalCycleRemoved = true;
  return trend;
}

export async function getSeries(variable: string, region: string, opts: SeriesOptions = {}): Promise<SeriesWithTrend> {
  return finish(await loadBase(variable, region, opts), opts);
}

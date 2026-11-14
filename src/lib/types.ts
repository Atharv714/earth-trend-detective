// Shared API types (frontend ⇄ backend). Contract: HANDOFF §5.
// Backend owns this file; ask before changing a field.

/** t = "YYYY-MM" (monthly), "YYYY-MM-DD" (daily) or "YYYY" (annual). */
export type Point = { t: string; v: number };

export type Frequency = "daily" | "monthly" | "annual";

export type Theme = "heat" | "water" | "air" | "ocean_ice";

export type SeriesMeta = {
  variable: string; // our id, e.g. "temperature"
  label: string; // "Air temperature"
  unit: string; // display unit, e.g. "°C"
  region: string; // region id, e.g. "arctic"
  regionLabel: string; // "Arctic"
  source: string; // "NASA MERRA-2 via Giovanni" | "NASA POWER (live)" | ...
  frequency: Frequency;
  start: string;
  end: string;
  citation: string;
  /** Present when the request applied these transforms. */
  season?: Season;
  deseasonalized?: boolean;
};

export type Series = { meta: SeriesMeta; points: Point[] };

export type TrendResult = {
  n: number;
  method: "mann-kendall+sen";
  slopePerYear: number;
  slopePerDecade: number; // headline number
  changeOverPeriod: number; // slope × years, in display unit
  percentChangeOverPeriod: number | null; // null when mean ≈ 0 (e.g. anomalies)
  pValue: number;
  significant: boolean; // pValue < 0.05
  direction: "increasing" | "decreasing" | "no trend";
  tau: number; // Kendall's tau
  ci95PerDecade?: [number, number]; // Sen slope 95% CI
  ols?: { slopePerDecade: number; pValue: number }; // second opinion (t-test)
  fitLine: Point[]; // two points (start, end) for drawing the trend line
  verdict: string; // plain English
  /** Rough years of extra data needed for significance at the current slope (only when not significant). */
  yearsToSignificance?: number | null;
  message?: string; // e.g. "Too few points (n < 10)"
};

/** Series with the trend computed inline (what GET /api/series returns when trend=1). */
export type SeriesWithTrend = Series & { trend?: TrendResult };

export type Season = "all" | "DJF" | "MAM" | "JJA" | "SON" | "monsoon";

export type Variable = {
  id: string;
  label: string;
  unit: string;
  theme: Theme;
  definition: string; // one plain sentence for students
};

export type RegionType = "city" | "region" | "continent" | "ocean" | "global";

export type Region = {
  id: string;
  label: string;
  /** [lon_min, lat_min, lon_max, lat_max]; for cities, a zero-size box at the point. */
  bbox: [number, number, number, number];
  type: RegionType;
  country?: string;
};

export type Availability = {
  variable: string;
  region: string;
  source: string;
  frequency: Frequency;
  start: string;
  end: string;
};

export type Catalog = {
  variables: Variable[];
  regions: Region[];
  availability: Availability[];
};

export type CompareResponse = { series: Series[]; trends: TrendResult[] };

export type ExplainResponse = { text: string; ai: true };

export type ApiError = { error: string };

export type ExtremeIndex =
  | "heatwave_days"
  | "warm_nights"
  | "extreme_rain_days"
  | "max_dry_spell"
  | "heat_index";

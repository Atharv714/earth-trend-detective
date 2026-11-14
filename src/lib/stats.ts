// Trend statistics: Mann-Kendall test + Sen's slope (+ OLS t-test as a second opinion).
// Pure functions, no Node APIs, so this can also run in the browser if needed.
import type { Point, TrendResult } from "./types";

/** "YYYY" | "YYYY-MM" | "YYYY-MM-DD" → decimal year (mid-period). */
export function decimalYear(t: string): number {
  const [y, m, d] = t.split("-").map(Number);
  if (m === undefined) return y + 0.5;
  if (d === undefined) return y + (m - 0.5) / 12;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const doy = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000 + 1;
  return y + (doy - 0.5) / (leap ? 366 : 365);
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value of Student's t with df degrees of freedom. */
export function tTestP(t: number, df: number): number {
  return incBeta(df / (df + t * t), df / 2, 0.5);
}

const median = (sorted: number[]) => {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};

export type MannKendall = { S: number; varS: number; Z: number; pValue: number; tau: number };

export function mannKendall(v: number[]): MannKendall {
  const n = v.length;
  let S = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(v[j] - v[i]);
  const counts = new Map<number, number>();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  let tie = 0;
  for (const t of counts.values()) if (t > 1) tie += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tie) / 18;
  const Z = varS > 0 ? (S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0) : 0;
  const pValue = Math.min(1, 2 * (1 - normCdf(Math.abs(Z))));
  return { S, varS, Z, pValue, tau: S / ((n * (n - 1)) / 2) };
}

/** Sen's slope (units per year) with 95% CI (Gilbert 1987) and median intercept. */
export function senSlope(x: number[], v: number[], varS: number) {
  const slopes: number[] = [];
  for (let i = 0; i < x.length - 1; i++)
    for (let j = i + 1; j < x.length; j++) if (x[j] !== x[i]) slopes.push((v[j] - v[i]) / (x[j] - x[i]));
  slopes.sort((a, b) => a - b);
  const slope = median(slopes);
  const N = slopes.length;
  const C = 1.959964 * Math.sqrt(varS);
  const lo = Math.max(0, Math.min(N - 1, Math.round((N - C) / 2) - 1));
  const hi = Math.max(0, Math.min(N - 1, Math.round((N + C) / 2)));
  const intercept = median(x.map((xi, i) => v[i] - slope * xi).sort((a, b) => a - b));
  return { slope, intercept, ci: [slopes[lo], slopes[hi]] as [number, number] };
}

export function ols(x: number[], v: number[]) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const mv = v.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxv = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxv += (x[i] - mx) * (v[i] - mv);
  }
  const slope = sxv / sxx;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (v[i] - (mv + slope * (x[i] - mx))) ** 2;
  const se = Math.sqrt(ssr / (n - 2) / sxx);
  const t = se > 0 ? slope / se : slope === 0 ? 0 : Infinity;
  return { slope, t, pValue: Number.isFinite(t) ? tTestP(t, n - 2) : 0 };
}

/** Human-friendly number: 0.31, 1.2, 12.3, 1234. */
export function fmt(x: number): string {
  const a = Math.abs(x);
  if (a === 0) return "0";
  if (a >= 100) return x.toFixed(0);
  if (a >= 10) return x.toFixed(1);
  if (a >= 1) return x.toFixed(2);
  return String(Number(x.toPrecision(2)));
}

export const fmtP = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);

export type TrendOptions = {
  label?: string;
  regionLabel?: string;
  /** Overrides " in {regionLabel}", e.g. " worldwide". */
  where?: string;
  /** Use "are" instead of "is" (e.g. "Heatwave days are rising"). */
  plural?: boolean;
  unit?: string;
  /** Allow % change (false for °C, anomalies, values relative to an arbitrary zero). */
  allowPercent?: boolean;
  alpha?: number;
};

const MAX_POINTS = 3000;

export function computeTrend(points: Point[], opts: TrendOptions = {}): TrendResult {
  const alpha = opts.alpha ?? 0.05;
  const clean = points
    .filter((p) => p && typeof p.t === "string" && Number.isFinite(p.v))
    .map((p) => ({ t: p.t, x: decimalYear(p.t), v: p.v }))
    .filter((p) => Number.isFinite(p.x))
    .sort((a, b) => a.x - b.x);
  const n = clean.length;
  const label = opts.label ?? "This variable";
  const where = opts.where ?? (opts.regionLabel ? ` in ${opts.regionLabel}` : "");
  const is = opts.plural ? "are" : "is";
  const unit = opts.unit && !["unitless", "0–1", "1"].includes(opts.unit) ? ` ${opts.unit}` : "";

  const empty = (message: string): TrendResult => ({
    n,
    method: "mann-kendall+sen",
    slopePerYear: 0,
    slopePerDecade: 0,
    changeOverPeriod: 0,
    percentChangeOverPeriod: null,
    pValue: 1,
    significant: false,
    direction: "no trend",
    tau: 0,
    fitLine: [],
    verdict: message,
    message,
  });
  if (n < 10) return empty(`Not enough data to test for a trend: ${n} points, need at least 10.`);
  if (n > MAX_POINTS) return empty(`Too many points (${n}); aggregate to monthly or annual first.`);

  const x = clean.map((p) => p.x);
  const v = clean.map((p) => p.v);
  const mk = mannKendall(v);
  const sen = senSlope(x, v, mk.varS);
  const reg = ols(x, v);
  const years = x[n - 1] - x[0];
  const significant = mk.pValue < alpha;
  const direction = sen.slope > 0 ? "increasing" : sen.slope < 0 ? "decreasing" : "no trend";

  let percent: number | null = null;
  if (opts.allowPercent !== false) {
    const base = v.filter((_, i) => x[i] < x[0] + 5);
    const mean = base.reduce((a, b) => a + b, 0) / base.length;
    if (Math.abs(mean) > 1e-9) percent = ((sen.slope * years) / Math.abs(mean)) * 100;
  }

  // Rough "how much longer" estimate: for a weak trend in noise, the Mann-Kendall Z grows
  // ~ n^1.5 at a fixed slope and noise level (same scaling as the OLS t statistic).
  let yearsToSignificance: number | null | undefined;
  if (!significant) {
    const tAbs = Math.abs(mk.Z);
    if (tAbs < 1e-6 || sen.slope === 0) yearsToSignificance = null;
    else {
      const nNeeded = n * Math.pow(1.96 / tAbs, 2 / 3);
      const extra = Math.max(0, (nNeeded - n) / (n / Math.max(years, 1e-9)));
      yearsToSignificance = extra > 200 ? null : Math.max(1, Math.ceil(extra));
    }
  }

  const start = clean[0].t;
  const end = clean[n - 1].t;
  const period = `${start.slice(0, 4)}–${end.slice(0, 4)}`;
  const perDecade = sen.slope * 10;
  let verdict: string;
  if (direction === "no trend") {
    verdict = `${label}${where} ${opts.plural ? "show" : "shows"} no overall change (${period}). (${fmtP(mk.pValue)})`;
  } else {
    verdict =
      `${label}${where} ${is} ${direction === "increasing" ? "rising" : "falling"} by ${fmt(Math.abs(perDecade))}${unit} per decade (${period}). ` +
      (significant
        ? `This trend is statistically significant (${fmtP(mk.pValue)}).`
        : `This trend is not statistically significant (${fmtP(mk.pValue)}), so it may need a longer record` +
          (yearsToSignificance ? ` (roughly ${yearsToSignificance} more year${yearsToSignificance === 1 ? "" : "s"} of data at this rate).` : "."));
  }

  return {
    n,
    method: "mann-kendall+sen",
    slopePerYear: sen.slope,
    slopePerDecade: perDecade,
    changeOverPeriod: sen.slope * years,
    percentChangeOverPeriod: percent,
    pValue: mk.pValue,
    significant,
    direction,
    tau: mk.tau,
    ci95PerDecade: [sen.ci[0] * 10, sen.ci[1] * 10],
    ols: { slopePerDecade: reg.slope * 10, pValue: reg.pValue },
    fitLine: [
      { t: start, v: sen.intercept + sen.slope * x[0] },
      { t: end, v: sen.intercept + sen.slope * x[n - 1] },
    ],
    verdict,
    yearsToSignificance,
  };
}

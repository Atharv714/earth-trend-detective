// How variables move together in one place: "if this goes up, what follows?"
//
// For every variable we take the monthly record, remove the seasonal cycle
// (each calendar month minus its own average) and the long-term straight-line
// trend, so what is left is the month-to-month wobble: a hotter-than-usual May,
// a drier-than-usual July. Two variables are linked when their wobbles line up.
// Removing the trends stops two things that both drift over the years (say,
// temperature and plant cover) from looking linked just because of that.
//
// The driver may lead by 0–3 months (rain now, groundwater later); the best lag
// is kept and its p-value is multiplied by the number of lags tried
// (Bonferroni). Months follow each other, so the effective sample size is cut
// for lag-1 autocorrelation (Bretherton et al. 1999) before the t-test.
// A link is an association in the record, not proof of cause.

import type { Region, Source } from "./regions";
import { WHOLE_YEAR, annualize, loadMonthly, trend, within, type Month, type Season } from "./series";

export interface Knob {
  id: string;
  label: string;
  unit: string;
  /** Multiply raw values by this for display (0–1 fractions → %). */
  scale: number;
  digits: number;
  /** Slider ends and comparisons: ["Hotter", "Cooler"]. */
  more: [string, string];
  /** For the heading: "What else changes when it gets hotter?" */
  when: string;
  /** For the answer: "Delhi usually gets drier air, drier soil and less rain." */
  gets: [string, string];
  /** A storage (soil, ground, plants) answers a push weeks later. */
  slow?: boolean;
  src: Source;
}

const P = "01_india_monthly_nasa_power";

const power = (column: string, unit: string, label: string): Omit<Source, "path"> => ({
  column,
  convert: "none",
  unit,
  label: `NASA POWER ${label}`,
});

type Words = Pick<Knob, "id" | "label" | "unit" | "scale" | "digits" | "more" | "when" | "gets" | "slow">;

const WORDS: Record<string, Words> = {
  temp: { id: "temp", label: "Temperature", unit: "°C", scale: 1, digits: 1, more: ["Hotter", "Cooler"], when: "it gets hotter", gets: ["warmer weather", "cooler weather"] },
  rain: { id: "rain", label: "Rainfall", unit: "mm/day", scale: 1, digits: 1, more: ["Wetter", "Drier"], when: "it rains more", gets: ["more rain", "less rain"] },
  soil: { id: "soil", label: "Soil moisture", unit: "%", scale: 100, digits: 0, more: ["Wetter", "Drier"], when: "the soil gets wetter", gets: ["wetter soil", "drier soil"], slow: true },
  veg: { id: "veg", label: "Plant cover", unit: "NDVI", scale: 1, digits: 3, more: ["Greener", "Browner"], when: "plants get greener", gets: ["greener plants", "browner plants"], slow: true },
  air: { id: "air", label: "Haze", unit: "AOD", scale: 1, digits: 2, more: ["Hazier", "Clearer"], when: "the air gets hazier", gets: ["hazier air", "cleaner air"] },
  ground: { id: "ground", label: "Groundwater", unit: "cm", scale: 0.1, digits: 1, more: ["More", "Less"], when: "groundwater rises", gets: ["more groundwater", "less groundwater"], slow: true },
  ice: { id: "ice", label: "Sea ice", unit: "%", scale: 100, digits: 1, more: ["More", "Less"], when: "sea ice grows", gets: ["more sea ice", "less sea ice"], slow: true },
  humidity: { id: "humidity", label: "Humidity", unit: "%", scale: 1, digits: 0, more: ["More humid", "Less humid"], when: "it gets more humid", gets: ["more humid air", "drier air"] },
  cloud: { id: "cloud", label: "Cloud cover", unit: "%", scale: 1, digits: 0, more: ["Cloudier", "Clearer"], when: "it gets cloudier", gets: ["more cloud", "clearer skies"] },
  sun: { id: "sun", label: "Sunshine", unit: "kWh/m²", scale: 1, digits: 2, more: ["Sunnier", "Dimmer"], when: "it gets sunnier", gets: ["more sunshine", "less sunshine"] },
  wind: { id: "wind", label: "Wind", unit: "m/s", scale: 1, digits: 2, more: ["Windier", "Calmer"], when: "it gets windier", gets: ["more wind", "calmer air"] },
};

/** Every variable we can line up for a place. */
export function knobsFor(region: Region): Knob[] {
  const k: Knob[] = [];
  const add = (id: string, src: Source | undefined) => src && k.push({ ...WORDS[id], src });
  add("temp", region.temp);
  add("rain", region.rain);
  add("soil", region.soil);
  add("veg", region.veg);
  add("air", region.air);
  add("ground", region.ground);
  add("ice", region.ice);

  // The rest of a NASA POWER record: a file for Indian places, live for searched ones.
  const base = region.soil?.points
    ? { path: region.soil.path, points: region.soil.points }
    : region.soil?.path.startsWith(P)
      ? { path: region.soil.path }
      : null;
  if (base) {
    const live = base.points ? ", fetched live" : "";
    add("humidity", { ...base, ...power("RH2M", "%", `relative humidity${live}`) });
    add("cloud", { ...base, ...power("CLOUD_AMT", "%", `cloud amount${live}`) });
    add("sun", { ...base, ...power("ALLSKY_SFC_SW_DWN", "kWh/m²/day", `sunlight at the ground${live}`) });
    add("wind", { ...base, ...power("WS2M", "m/s", `wind speed at 2 m${live}`) });
  }
  return k;
}

/** Which knob a report question is about. */
export const KNOB_OF_LAYER: Record<string, string> = {
  warming: "temp",
  rainfall: "rain",
  vegetation: "veg",
  air: "air",
  drought: "soil",
  groundwater: "ground",
  ice: "ice",
};

/* ------------------------------------------------------------------ */
/* One variable, ready to compare                                      */

export interface Wobble {
  knob: Knob;
  /** Month index (year*12 + month-1) → wobble around the usual, display units. */
  anom: Map<number, number>;
  /** Spread of the wobble (standard deviation). */
  sd: number;
  /** Average value over the years tested, display units. */
  mean: number;
  /** How much one month's wobble carries into the next. */
  r1: number;
  /** Straight-line change over the years tested (Sen's slope of yearly means), display units. Null when too short. */
  change: number | null;
  changeSignificant: boolean;
}

export const loadKnob = (k: Knob) => loadMonthly(k.src);

export function wobble(knob: Knob, months: Month[], [from, to]: [number, number]): Wobble | null {
  const rows = months.filter((m) => m.year >= from && m.year <= to).map((m) => ({ ...m, value: m.value * knob.scale }));
  if (rows.length < 36) return null;

  const sum = new Array(13).fill(0);
  const cnt = new Array(13).fill(0);
  for (const m of rows) {
    sum[m.month] += m.value;
    cnt[m.month]++;
  }
  const clim = sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const m of rows) {
    xs.push(m.year * 12 + m.month - 1);
    ys.push(m.value - clim[m.month]);
  }
  // Take out the straight-line trend.
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  const anom = new Map<number, number>();
  for (let i = 0; i < n; i++) anom.set(xs[i], ys[i] - my - b * (xs[i] - mx));

  const vals = [...anom.values()];
  const sd = Math.sqrt(vals.reduce((a, v) => a + v * v, 0) / Math.max(1, vals.length - 1));

  // Lag-1 autocorrelation over consecutive months.
  let num = 0;
  let den = 0;
  for (const [k, v] of anom) {
    den += v * v;
    const next = anom.get(k + 1);
    if (next !== undefined) num += v * next;
  }
  const r1 = den ? Math.max(-0.95, Math.min(0.95, num / den)) : 0;

  const t = trend(within(annualize(rows, WHOLE_YEAR), [from, to]));
  return {
    knob,
    anom,
    sd,
    mean: rows.reduce((a, m) => a + m.value, 0) / rows.length,
    r1,
    change: t ? t.totalChange : null,
    changeSignificant: !!t?.significant,
  };
}

/* ------------------------------------------------------------------ */
/* Two variables                                                       */

export interface Link {
  knob: Knob;
  /** Months the driver leads by. */
  lag: number;
  n: number;
  /** Effective number of independent months. */
  nEff: number;
  r: number;
  /** Change in this variable per unit of the driver. */
  slope: number;
  /** Standard error of the slope. */
  se: number;
  /** After the lag correction. */
  p: number;
  significant: boolean;
  /** Another variable that moves with both and explains most of the link. */
  via: { knob: Knob; partial: number } | null;
  /** Wobble pairs, for the scatter. */
  pairs: [number, number][];
  mean: number;
  sd: number;
}

export const MAX_LAG = 3;

function pairUp(x: Wobble, y: Wobble, lag: number, months: Set<number>): [number, number][] {
  const out: [number, number][] = [];
  for (const [k, vy] of y.anom) {
    if (!months.has((k % 12) + 1)) continue;
    const vx = x.anom.get(k - lag);
    if (vx !== undefined) out.push([vx, vy]);
  }
  return out;
}

function corr(pairs: [number, number][]) {
  const n = pairs.length;
  let mx = 0;
  let my = 0;
  for (const [a, b] of pairs) {
    mx += a;
    my += b;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [a, b] of pairs) {
    sxy += (a - mx) * (b - my);
    sxx += (a - mx) ** 2;
    syy += (b - my) ** 2;
  }
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  return { r, slope: sxx ? sxy / sxx : 0, sx: Math.sqrt(sxx / Math.max(1, n - 1)), sy: Math.sqrt(syy / Math.max(1, n - 1)) };
}

function test(pairs: [number, number][], x: Wobble, y: Wobble, lags: number) {
  const n = pairs.length;
  const { r, slope, sx, sy } = corr(pairs);
  const rr = x.r1 * y.r1;
  const nEff = Math.max(4, Math.min(n, (n * (1 - rr)) / (1 + rr)));
  const df = nEff - 2;
  const t = Math.abs(r) < 1 ? r * Math.sqrt(df / (1 - r * r)) : Infinity;
  const p = Math.min(1, 2 * (1 - studentCdf(Math.abs(t), df)) * lags);
  const se = sx ? Math.sqrt((1 - r * r) / df) * (sy / sx) : 0;
  return { n, nEff, r, slope, se, p };
}

/** Months in a season, by the answering variable's month. */
const monthSet = (s: Season) => new Set(s.months);

/** Everything that moves with the driver, strongest first. */
export function linksFrom(driver: Wobble, others: Wobble[], season: Season): Link[] {
  const months = monthSet(season);
  const out: Link[] = [];
  for (const y of others) {
    if (y.knob.id === driver.knob.id) continue;
    const lags = y.knob.slow ? MAX_LAG + 1 : 1;
    let best: (ReturnType<typeof test> & { lag: number; pairs: [number, number][] }) | null = null;
    for (let lag = 0; lag < lags; lag++) {
      const pairs = pairUp(driver, y, lag, months);
      if (pairs.length < 24) continue;
      const res = test(pairs, driver, y, lags);
      if (!best || Math.abs(res.r) > Math.abs(best.r)) best = { ...res, lag, pairs };
    }
    if (!best) continue;
    const significant = best.p < 0.05;
    out.push({
      knob: y.knob,
      lag: best.lag,
      n: best.n,
      nEff: best.nEff,
      r: best.r,
      slope: best.slope,
      se: best.se,
      p: best.p,
      significant,
      via: significant ? mediator(driver, y, others, best.lag, months, best.r) : null,
      pairs: best.pairs,
      mean: y.mean,
      sd: y.sd,
    });
  }
  return out.sort((a, b) => Number(b.significant) - Number(a.significant) || Math.abs(b.r) - Math.abs(a.r));
}

/**
 * The third variable that explains most of a link: the partial correlation of
 * driver and answer once it is held fixed. Named only when the link drops by
 * more than 40% and the third variable moves with both.
 */
function mediator(x: Wobble, y: Wobble, all: Wobble[], lag: number, months: Set<number>, rxy: number): Link["via"] {
  let best: Link["via"] = null;
  for (const z of all) {
    if (z.knob.id === x.knob.id || z.knob.id === y.knob.id) continue;
    const triples: [number, number, number][] = [];
    for (const [k, vy] of y.anom) {
      if (!months.has((k % 12) + 1)) continue;
      const vx = x.anom.get(k - lag);
      const vz = z.anom.get(k);
      if (vx !== undefined && vz !== undefined) triples.push([vx, vy, vz]);
    }
    if (triples.length < 24) continue;
    const rxz = corr(triples.map(([a, , c]) => [a, c])).r;
    const ryz = corr(triples.map(([, b, c]) => [b, c])).r;
    const r = corr(triples.map(([a, b]) => [a, b])).r;
    if (Math.abs(rxz) < 0.3 || Math.abs(ryz) < 0.3) continue;
    const d = Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
    if (d < 1e-6) continue;
    const partial = (r - rxz * ryz) / d;
    if (Math.abs(partial) < 0.6 * Math.abs(rxy) && (!best || Math.abs(partial) < Math.abs(best.partial))) best = { knob: z.knob, partial };
  }
  return best;
}

/** In words: how often the two moved together. */
export function howOften(r: number): string {
  const a = Math.abs(r);
  return a >= 0.7 ? "Almost every time" : a >= 0.5 ? "Most of the time" : a >= 0.3 ? "Often" : "Sometimes";
}

/* ------------------------------------------------------------------ */
/* Student's t (regularised incomplete beta, Numerical Recipes 6.4)    */

function studentCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return 1;
  const x = df / (df + t * t);
  const tail = 0.5 * incBeta(df / 2, 0.5, x);
  return t >= 0 ? 1 - tail : tail;
}

function incBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function betacf(a: number, b: number, x: number): number {
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

function lgamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = z;
  const tmp = z + 5.5 - (z + 0.5) * Math.log(z + 5.5);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / z);
}


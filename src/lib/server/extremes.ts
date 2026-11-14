import type { ExtremeIndex, Point } from "@/lib/types";
import { readDailyTable } from "./load";

export const EXTREME_DEFAULTS: Record<ExtremeIndex, number> = {
  heatwave_days: 40,
  warm_nights: 25,
  extreme_rain_days: 50,
  max_dry_spell: 1,
  heat_index: 41,
};

/** NOAA heat index (Rothfusz regression with NWS adjustments). Inputs °C and %, output °C. */
export function heatIndexC(tC: number, rh: number): number {
  const T = (tC * 9) / 5 + 32;
  let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + rh * 0.094);
  if ((hi + T) / 2 >= 80) {
    hi =
      -42.379 + 2.04901523 * T + 10.14333127 * rh - 0.22475541 * T * rh - 0.00683783 * T * T -
      0.05481717 * rh * rh + 0.00122874 * T * T * rh + 0.00085282 * T * rh * rh - 0.00000199 * T * T * rh * rh;
    if (rh < 13 && T >= 80 && T <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (rh > 85 && T >= 80 && T <= 87) hi += ((rh - 85) / 10) * ((87 - T) / 5);
  }
  return ((hi - 32) * 5) / 9;
}

/** Annual series of an extreme-event index from a daily POWER file. Years need ≥ 360 valid days. */
export async function computeExtreme(file: string, index: ExtremeIndex, threshold?: number): Promise<Point[]> {
  const thr = threshold ?? EXTREME_DEFAULTS[index];
  const rows = await readDailyTable(file);
  const years = new Map<number, { count: number; valid: number; run: number; maxRun: number }>();
  for (const { t, cols } of rows) {
    const y = Number(t.slice(0, 4));
    const a = years.get(y) ?? { count: 0, valid: 0, run: 0, maxRun: 0 };
    years.set(y, a);
    let value: number | null;
    switch (index) {
      case "heatwave_days":
        value = cols.T2M_MAX;
        break;
      case "warm_nights":
        value = cols.T2M_MIN;
        break;
      case "extreme_rain_days":
      case "max_dry_spell":
        value = cols.PRECTOTCORR;
        break;
      case "heat_index":
        value = cols.T2M_MAX != null && cols.RH2M != null ? heatIndexC(cols.T2M_MAX, cols.RH2M) : null;
        break;
    }
    if (value == null) {
      a.run = 0;
      continue;
    }
    a.valid++;
    if (index === "max_dry_spell") {
      a.run = value < thr ? a.run + 1 : 0;
      a.maxRun = Math.max(a.maxRun, a.run);
    } else if (value > thr) a.count++;
  }
  return [...years.entries()]
    .filter(([, a]) => a.valid >= 360)
    .sort((a, b) => a[0] - b[0])
    .map(([y, a]) => ({ t: String(y), v: index === "max_dry_spell" ? a.maxRun : a.count }));
}

// Diverging scales. Warming uses the ColorBrewer RdBu ramp Ed Hawkins used
// for the original warming stripes; rain uses BrBG (dry brown to wet teal).

const RDBU = ["#08306b", "#08519c", "#2171b5", "#4292c6", "#6baed6", "#9ecae1", "#c6dbef", "#deebf7",
  "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#a50f15", "#67000d"];
// Brown (browning) to green (greening), from ColorBrewer BrBG with greens.
const BRGN = ["#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#d9f0d3", "#a6dba0", "#5aae61", "#1b7837", "#00441b"];
const BRBG = ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"];

function pick(ramp: string[], t: number): string {
  const i = Math.round(Math.min(1, Math.max(0, t)) * (ramp.length - 1));
  return ramp[i];
}

/** t = -1 (coolest) .. +1 (warmest) */
export const warmColor = (t: number) => pick(RDBU, (t + 1) / 2);
/** t = -1 (drier) .. +1 (wetter) */
export const wetColor = (t: number) => pick(BRBG, (t + 1) / 2);

/** t = -1 (browner) .. +1 (greener) */
export const greenColor = (t: number) => pick(BRGN, (t + 1) / 2);

export const WARM_RAMP = RDBU;
export const WET_RAMP = BRBG;
export const GREEN_RAMP = BRGN;

/** Scale limits for the globe markers. */
export const WARMING_LIMIT = 0.5; // °C per decade
export const RAIN_LIMIT = 15; // % per decade
export const GREEN_LIMIT = 8; // % per decade

// Haze: clean blue to smoky brown (ColorBrewer PuOr, flipped so haze is warm).
const HAZE = ["#2d004b", "#542788", "#8073ac", "#b2abd2", "#d8daeb", "#f7f7f7", "#fee0b6", "#fdb863", "#e08214", "#b35806", "#7f3b08"];
const ICE = [...RDBU].reverse();

/** t = -1 (cleaner) .. +1 (hazier) */
export const hazeColor = (t: number) => pick(HAZE, (t + 1) / 2);
/** t = -1 (less ice) .. +1 (more ice) */
export const iceColor = (t: number) => pick(ICE, (t + 1) / 2);

export const HAZE_RAMP = HAZE;
export const ICE_RAMP = ICE;

export const AIR_LIMIT = 20; // % per decade
export const SOIL_LIMIT = 5; // % per decade
export const GROUND_LIMIT = 40; // mm per decade
export const ICE_LIMIT = 10; // % per decade
export const SEA_LIMIT = 4; // cm per decade

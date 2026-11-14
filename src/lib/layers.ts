// Everything that differs between the three questions, in one place.
import { GREEN_LIMIT, GREEN_RAMP, RAIN_LIMIT, WARMING_LIMIT, WARM_RAMP, WET_RAMP, greenColor, warmColor, wetColor } from "./colors";
import type { Layer } from "./regions";
import type { Trend } from "./series";

export interface LayerInfo {
  id: Layer;
  tab: string;
  question: string;
  intro: string;
  /** One plain sentence: what is being measured. */
  definition: string;
  /** Answers when the trend is up, down, or not significant. */
  up: string;
  down: string;
  flat: string;
  /** "hottest", "wettest", "greenest" */
  top: string;
  /** The headline rate shown everywhere: °C per decade, or % per decade. */
  rate: (t: Trend) => number;
  rateText: (v: number) => string;
  rateUnit: string;
  valueText: (v: number) => string;
  color: (t: number) => string;
  limit: number;
  ramp: string[];
  tone: { up: string; down: string };
  /** Bright colours for rising and falling, readable on the dark panel. */
  hue: { up: string; down: string };
  /** What is measured, as a noun: "Temperature", "Rainfall", "Plant cover". */
  measure: string;
  /** Unit shown on chart axes. */
  axis: string;
  /** Stripe legend: a year below and above the place's own average. */
  low: string;
  high: string;
  /** Plain explanation of the yearly chart. */
  chartTip: string;
  /** Tooltip on the stripes. */
  stripesTip: string;
}

export const signed = (v: number, d: number) => {
  const r = Math.abs(v).toFixed(d);
  return Number(r) === 0 ? r : `${v > 0 ? "+" : "−"}${r}`;
};

export const LAYER_INFO: Record<Layer, LayerInfo> = {
  warming: {
    id: "warming",
    tab: "Temperature",
    question: "Is it getting hotter?",
    intro: "Each dot is a place, coloured by how fast it has warmed per decade. Pick one to test its record.",
    definition: "Air temperature about 2 m above the ground, averaged over the whole area.",
    up: "Getting hotter",
    down: "Getting cooler",
    flat: "No clear trend",
    top: "hottest",
    rate: (t) => t.slopePerDecade,
    rateText: (v) => `${signed(v, 2)} °C`,
    rateUnit: "°C per decade",
    valueText: (v) => `${v.toFixed(1)} °C`,
    color: warmColor,
    limit: WARMING_LIMIT,
    ramp: WARM_RAMP,
    tone: { up: "warm", down: "cool" },
    hue: { up: "#ff7a5c", down: "#6aa8ff" },
    measure: "Temperature",
    axis: "°C",
    low: "Cooler year",
    high: "Warmer year",
    chartTip:
      "Each dot is the average air temperature for one whole year. Averaging a year smooths out daily weather, so what is left is the climate.",
    stripesTip:
      "These are warming stripes, the picture climate scientist Ed Hawkins made famous. Each stripe is one year: blue years were cooler than this place's usual, red years warmer.",
  },
  rainfall: {
    id: "rainfall",
    tab: "Rainfall",
    question: "Is rainfall changing?",
    intro: "Each dot is a place, coloured by how much its rain has changed per decade. Pick one to test its record.",
    definition: "How much rain falls, as millimetres per day averaged over the year, measured by satellites.",
    up: "Getting wetter",
    down: "Getting drier",
    flat: "No clear change",
    top: "wettest",
    rate: (t) => t.pctPerDecade ?? 0,
    rateText: (v) => `${signed(v, 1)}%`,
    rateUnit: "per decade",
    valueText: (v) => `${v.toFixed(2)} mm/day`,
    color: wetColor,
    limit: RAIN_LIMIT,
    ramp: WET_RAMP,
    tone: { up: "wet", down: "dry" },
    hue: { up: "#5cc8b8", down: "#d3a05e" },
    measure: "Rainfall",
    axis: "mm of rain a day",
    low: "Drier year",
    high: "Wetter year",
    chartTip:
      "Each dot is how much rain fell on an average day that year, in millimetres. 1 mm a day adds up to about 365 mm, or 36 cm, over a year.",
    stripesTip: "Each stripe is one year: brown years were drier than this place's usual, teal years wetter.",
  },
  vegetation: {
    id: "vegetation",
    tab: "Vegetation",
    question: "Is the land getting greener?",
    intro: "Each dot is a place, coloured by how much greener or browner it has become per decade. Pick one to test its record.",
    definition: "NDVI: how green the land looks from space, from about 0.1 for bare ground to 0.9 for dense forest.",
    up: "Getting greener",
    down: "Getting browner",
    flat: "No clear change",
    top: "greenest",
    rate: (t) => t.pctPerDecade ?? 0,
    rateText: (v) => `${signed(v, 1)}%`,
    rateUnit: "per decade",
    valueText: (v) => v.toFixed(3),
    color: greenColor,
    limit: GREEN_LIMIT,
    ramp: GREEN_RAMP,
    tone: { up: "green", down: "brown" },
    hue: { up: "#7cc56b", down: "#c49058" },
    measure: "Plant cover",
    axis: "NDVI",
    low: "Less green year",
    high: "Greener year",
    chartTip:
      "Each dot is how green the land looked from space that year (NDVI). It runs from about 0.1 for bare desert to 0.9 for thick rainforest.",
    stripesTip: "Each stripe is one year: brown years were less green than this place's usual, green years greener.",
  },
};

export const LAYERS: Layer[] = ["warming", "rainfall", "vegetation"];

/** Colour for a trend: grey when it is not significant. */
export function trendColor(layer: Layer, t: Trend | null | undefined): string | undefined {
  if (t === undefined) return undefined;
  if (!t || !t.significant) return "#8e8e93";
  const info = LAYER_INFO[layer];
  return info.color(info.rate(t) / info.limit);
}

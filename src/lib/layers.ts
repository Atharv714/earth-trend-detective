// Everything that differs between the questions, in one place.
import {
  AIR_LIMIT,
  GREEN_LIMIT,
  GREEN_RAMP,
  GROUND_LIMIT,
  HAZE_RAMP,
  ICE_LIMIT,
  ICE_RAMP,
  RAIN_LIMIT,
  SEA_LIMIT,
  SOIL_LIMIT,
  WARMING_LIMIT,
  WARM_RAMP,
  WET_RAMP,
  greenColor,
  hazeColor,
  iceColor,
  warmColor,
  wetColor,
} from "./colors";
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
  /** "warmer" / "cooler": what a rise and a fall mean, for "… each decade". */
  more: string;
  less: string;
  /** "warming", "changing in rainfall": for "X is ___ faster than the planet". */
  changing: string;
  /** The answer in one sentence, when the trend is real. */
  sentence: (a: { name: string; t: Trend; r: [number, number]; up: boolean; from: string; to: string }) => string;
  /** Said under the data source, when the numbers need a warning. */
  caveat?: string;
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
    rateUnit: "per decade",
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
    more: "warmer",
    less: "cooler",
    changing: "warming",
    sentence: ({ name, t, r, up }) =>
      `${name} ${up ? "warmed" : "cooled"} by about ${Math.abs(t.totalChange).toFixed(1)} °C from ${r[0]} to ${r[1]}: roughly ${Math.abs(t.slopePerDecade).toFixed(2)} °C every 10 years.`,
  },
  rainfall: {
    id: "rainfall",
    tab: "Rainfall",
    question: "Is rainfall changing?",
    intro: "Each dot is a place, coloured by how much its rain has changed per decade. Pick one to test its record.",
    definition: "How much rain falls, as millimetres per day averaged over the months shown, measured by satellites.",
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
    more: "more rain",
    less: "less rain",
    changing: "changing in rainfall",
    sentence: ({ name, t, r, up, from, to }) =>
      `From ${r[0]} to ${r[1]}, rain in ${name} ${up ? "rose" : "fell"} by about ${Math.abs(t.pctPerDecade ?? 0).toFixed(0)}% every 10 years. A typical day went from ${from} to ${to}.`,
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
    more: "greener",
    less: "less green",
    changing: "changing in plant cover",
    sentence: ({ name, t, r, up }) =>
      `From ${r[0]} to ${r[1]}, the land in ${name} became about ${Math.abs(t.pctPerDecade ?? 0).toFixed(0)}% ${up ? "greener" : "less green"} every 10 years, as seen from space.`,
    caveat: "Not an official NASA area average; treat small changes with care.",
  },
  air: {
    id: "air",
    tab: "Air",
    question: "Is the air getting hazier?",
    intro: "Each dot is a place, coloured by how much hazier or cleaner its air has become per decade. Pick one to test its record.",
    definition:
      "Aerosol optical depth (AOD): how much smoke, dust and pollution in the air dims the sunlight. Under 0.1 is clear air; above 0.5 is thick haze.",
    up: "Getting hazier",
    down: "Getting cleaner",
    flat: "No clear change",
    top: "haziest",
    rate: (t) => t.pctPerDecade ?? 0,
    rateText: (v) => `${signed(v, 1)}%`,
    rateUnit: "per decade",
    valueText: (v) => v.toFixed(2),
    color: hazeColor,
    limit: AIR_LIMIT,
    ramp: HAZE_RAMP,
    tone: { up: "hazy", down: "clean" },
    hue: { up: "#e0a050", down: "#9d8cff" },
    measure: "Haze",
    axis: "AOD (haze)",
    low: "Cleaner year",
    high: "Hazier year",
    chartTip:
      "Each dot is how hazy the air was on average that year, measured by satellites looking at how much sunlight the air blocks. Smoke from wildfires, dust storms and city smog all raise it.",
    stripesTip: "Each stripe is one year: purple years had cleaner air than this place's usual, brown years were hazier.",
    more: "hazier",
    less: "cleaner",
    changing: "changing in haze",
    sentence: ({ name, t, r, up, from, to }) =>
      `From ${r[0]} to ${r[1]}, the air over ${name} became about ${Math.abs(t.pctPerDecade ?? 0).toFixed(0)}% ${up ? "hazier" : "cleaner"} every 10 years. A typical year went from ${from} to ${to} AOD.`,
  },
  drought: {
    id: "drought",
    tab: "Drought",
    question: "Is the soil drying out?",
    intro: "Each dot is a place, coloured by how much wetter or drier its soil has become per decade. Pick one to test its record.",
    definition: "How wet the soil is down where plant roots reach, from 0% (bone dry) to 100% (soaked through).",
    up: "Getting wetter",
    down: "Drying out",
    flat: "No clear change",
    top: "wettest",
    rate: (t) => t.pctPerDecade ?? 0,
    rateText: (v) => `${signed(v, 1)}%`,
    rateUnit: "per decade",
    valueText: (v) => `${(v * 100).toFixed(0)}%`,
    color: wetColor,
    limit: SOIL_LIMIT,
    ramp: WET_RAMP,
    tone: { up: "wet", down: "dry" },
    hue: { up: "#5cc8b8", down: "#d3a05e" },
    measure: "Soil wetness",
    axis: "% wet, root zone",
    low: "Drier year",
    high: "Wetter year",
    chartTip:
      "Each dot is how wet the soil around plant roots was on average that year. Drier soil means thirstier crops and more irrigation, even when the rain barely changes.",
    stripesTip: "Each stripe is one year: brown years had drier soil than this place's usual, teal years wetter.",
    more: "wetter",
    less: "drier",
    changing: "changing in soil moisture",
    sentence: ({ name, t, r, up, from, to }) =>
      `From ${r[0]} to ${r[1]}, the soil in ${name} became about ${Math.abs(t.pctPerDecade ?? 0).toFixed(0)}% ${up ? "wetter" : "drier"} every 10 years. A typical year went from ${from} to ${to} wet.`,
  },
  groundwater: {
    id: "groundwater",
    tab: "Groundwater",
    question: "Is groundwater running out?",
    intro: "Each dot is a place, coloured by how much water it has gained or lost underground per decade. Pick one to test its record.",
    definition:
      "Water stored underground, in the soil and rock that wells pump from, as centimetres of water over the whole area. NASA's GRACE satellites weigh it from space through tiny changes in gravity.",
    up: "Filling up",
    down: "Running down",
    flat: "No clear change",
    top: "fullest",
    rate: (t) => t.slopePerDecade,
    rateText: (v) => `${signed(v / 10, 1)} cm`,
    rateUnit: "of water per decade",
    valueText: (v) => `${(v / 10).toFixed(0)} cm`,
    color: wetColor,
    limit: GROUND_LIMIT,
    ramp: WET_RAMP,
    tone: { up: "wet", down: "dry" },
    hue: { up: "#5cc8b8", down: "#d3a05e" },
    measure: "Groundwater",
    axis: "cm of water underground",
    low: "Lower year",
    high: "Fuller year",
    chartTip:
      "Each dot is how much water was stored underground on average that year, as if it were a layer of water spread over the whole area. Pumping for farms and cities lowers it; heavy monsoons refill it.",
    stripesTip: "Each stripe is one year: brown years had less water underground than this place's usual, teal years more.",
    more: "more water",
    less: "less water",
    changing: "changing underground",
    sentence: ({ name, t, r, up }) =>
      `${name} ${up ? "gained" : "lost"} about ${Math.abs(t.totalChange / 10).toFixed(0)} cm of water stored underground from ${r[0]} to ${r[1]}: roughly ${Math.abs(t.slopePerDecade / 10).toFixed(1)} cm every 10 years, across the whole area.`,
    caveat: "GLDAS is a computer model of the land kept on track by GRACE gravity data, so it is an estimate, not a well reading.",
  },
  ice: {
    id: "ice",
    tab: "Sea ice",
    question: "Is the sea ice shrinking?",
    intro: "Each dot is a polar region, coloured by how much its sea ice has grown or shrunk per decade. Pick one to test its record.",
    definition: "How much of the area is covered by floating sea ice, from 0% to 100%, averaged over the months shown.",
    up: "Growing",
    down: "Shrinking",
    flat: "No clear change",
    top: "iciest",
    rate: (t) => t.pctPerDecade ?? 0,
    rateText: (v) => `${signed(v, 1)}%`,
    rateUnit: "per decade",
    valueText: (v) => `${(v * 100).toFixed(0)}%`,
    color: iceColor,
    limit: ICE_LIMIT,
    ramp: ICE_RAMP,
    tone: { up: "icy", down: "melting" },
    hue: { up: "#6aa8ff", down: "#ff7a5c" },
    measure: "Sea ice cover",
    axis: "% of the area under ice",
    low: "Less ice",
    high: "More ice",
    chartTip:
      "Each dot is how much of the area was under sea ice on average that year. Ice grows every winter and melts every summer; the yearly average shows whether it is slowly disappearing.",
    stripesTip: "Each stripe is one year: red years had less ice than this place's usual, blue years more.",
    more: "more ice",
    less: "less ice",
    changing: "changing in sea ice",
    sentence: ({ name, t, r, up, from, to }) =>
      `From ${r[0]} to ${r[1]}, sea ice ${name === "Antarctica" ? "around" : "in the"} ${name} ${up ? "grew" : "shrank"} by about ${Math.abs(t.pctPerDecade ?? 0).toFixed(0)}% every 10 years. A typical year went from ${from} to ${to} of the area frozen over.`,
  },
  sealevel: {
    id: "sealevel",
    tab: "Sea level",
    question: "Is the sea rising?",
    intro: "Sea level is measured for the whole ocean at once. Open Whole Earth to test it.",
    definition:
      "The average height of the ocean surface over the whole planet, measured by satellites that bounce radar off the sea. Zero is where it stood when the satellite record began in 1993.",
    up: "Rising",
    down: "Falling",
    flat: "No clear change",
    top: "highest",
    rate: (t) => t.slopePerDecade,
    rateText: (v) => `${signed(v, 1)} cm`,
    rateUnit: "per decade",
    valueText: (v) => `${signed(v, 1)} cm`,
    color: warmColor,
    limit: SEA_LIMIT,
    ramp: WARM_RAMP,
    tone: { up: "high", down: "low" },
    hue: { up: "#ff7a5c", down: "#6aa8ff" },
    measure: "Sea level",
    axis: "cm above 1993",
    low: "Lower year",
    high: "Higher year",
    chartTip:
      "Each dot is the average height of the world's ocean that year. Melting ice sheets add water, and warmer water takes up more room, so both push it up.",
    stripesTip: "Each stripe is one year: blue years the sea stood lower than usual, red years higher.",
    more: "higher",
    less: "lower",
    changing: "rising",
    sentence: ({ t, r, up }) =>
      `The ocean ${up ? "rose" : "fell"} about ${Math.abs(t.totalChange).toFixed(0)} cm from ${r[0]} to ${r[1]}: roughly ${Math.abs(t.slopePerDecade).toFixed(1)} cm every 10 years, across the whole planet.`,
  },
};

export const LAYERS: Layer[] = ["warming", "rainfall", "vegetation", "air", "drought", "groundwater", "ice", "sealevel"];

/** Colour for a trend: grey when it is not significant. */
export function trendColor(layer: Layer, t: Trend | null | undefined): string | undefined {
  if (t === undefined) return undefined;
  if (!t || !t.significant) return "#8e8e93";
  const info = LAYER_INFO[layer];
  return info.color(info.rate(t) / info.limit);
}

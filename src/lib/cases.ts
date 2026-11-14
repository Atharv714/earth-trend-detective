// One-click stories for the home screen and for demos. Each one is just a
// view of the app: a question, a place and, for some, a season.
import type { Layer } from "./regions";

export interface Case {
  id: string;
  title: string;
  note: string;
  layer: Layer;
  place: string;
  /** Season id from series.ts; absent for the whole year. */
  season?: string;
}

export const CASES: Case[] = [
  { id: "smoke", title: "Wildfire smoke over Wisconsin", note: "Summer haze, the example in the challenge brief", layer: "air", place: "wisconsin", season: "jja" },
  { id: "arctic", title: "The melting Arctic", note: "Sea ice at the end of the summer melt", layer: "ice", place: "arctic", season: "son" },
  { id: "delhi", title: "Delhi’s air", note: "Haze over India’s capital since 2003", layer: "air", place: "delhi" },
  { id: "sea", title: "Rising seas", note: "The whole ocean, measured from space", layer: "sealevel", place: "world" },
  { id: "heat", title: "Heatwaves in Rajasthan", note: "Days above 40 °C in Jodhpur", layer: "warming", place: "rajasthan", season: "summer" },
  { id: "punjab", title: "Punjab’s groundwater", note: "Wells running dry under India’s breadbasket", layer: "groundwater", place: "punjab" },
];

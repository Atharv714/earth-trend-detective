// Types the detective shares with the browser. No server code here: the chat
// panel imports this file.

import type { Layer } from "../regions";

/** What the app is showing right now. Sent with every chat message. */
export interface View {
  /** Region id ("delhi", "find:lagos"), or null on the home screen. */
  place: string | null;
  placeName?: string;
  layer: Layer;
  /** Season id from series.ts; null is the whole year. */
  season: string | null;
  range: [number, number] | null;
}

/** A change to the app the detective asks for (the show_in_app tool). */
export interface ViewChange {
  place: string;
  /** For a place found by name: what to search for in the browser. */
  query?: string;
  layer: Layer;
  season: string | null;
  range: [number, number] | null;
}

/** The plan, shown above the answer (data-plan part). */
export interface PlanData {
  goal: string;
  steps: string[];
}

/** How many numbers in the answer came straight from the tools (data-check part). */
export interface CheckData {
  total: number;
  traced: number;
  /** Numbers we could not find in any tool result. */
  untraced: string[];
}

/** Yearly series the chat draws as a small chart: [year, value]. */
export type Series = [number, number][];

/** An area the detective is looking at (data-focus part), drawn as an outline on the globe. */
export interface GlobeFocus {
  name: string;
  /** [west, south, east, north] */
  box: [number, number, number, number];
  /** What it is doing there, as a short phrase for the globe caption. */
  what: string;
}

/** Every grid cell's trend over an area (data-grid part), drawn as a heat map on the globe. */
export interface GlobeGrid {
  name: string;
  /** What was measured, in words. */
  title: string;
  units: string;
  /** NASA POWER code, or WATER_STORAGE. Picks the colours. */
  parameter: string;
  box: [number, number, number, number];
  /** Cell size in degrees: [longitude, latitude]. */
  step: [number, number];
  years: [number, number];
  season?: string;
  /** [lat, lon, change per decade, significant 1 or 0] */
  cells: [number, number, number, number][];
}

/** A NASA satellite map on the globe (data-imagery part): a GIBS layer for one date, or two split left and right. */
export interface GlobeImagery {
  name: string;
  /** GIBS layer id */
  layer: string;
  /** What the colours measure */
  title: string;
  /** The layer's full name (satellite, product) */
  source: string;
  matrixSet: string;
  maxLevel: number;
  ext: "png" | "jpeg";
  /** GIBS date; none for a layer without dates */
  time?: string;
  /** The date in words */
  label: string;
  /** A second date, shown on the left of a split */
  before?: string;
  beforeLabel?: string;
  /** Where to draw it [west, south, east, north]; null is the whole Earth. */
  box: [number, number, number, number] | null;
  legend: { stops: string[]; min: string; max: string } | null;
}

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

// What the router decides about one message. Shared with the browser, so no
// server code here.

import type { Layer } from "../regions";

/**
 * Who handles a message:
 * ui: only changes what is on screen; research: a question for the detective;
 * both: change the screen and ask the detective; chat: small talk (the detective answers).
 */
export type Route = "ui" | "research" | "both" | "chat";

/** A change to the app. Only the fields the person asked for are set. */
export interface UiPatch {
  /** One of our places by id, or any place on Earth by name (found live). */
  place?: { id: string } | { name: string };
  layer?: Layer;
  /** Season id from series.ts (null is the whole year). Mapped onto the place's own seasons. */
  season?: string | null;
  /** First and last year; null is the whole record. */
  range?: [number, number] | null;
  /** Satellite maps of then and now on the globe. */
  sat?: boolean;
  /** One of the stories in cases.ts. */
  story?: string;
  /** Back to the whole Earth. */
  home?: true;
  /** Open or close the detective panel. */
  chat?: boolean;
}

export interface Routed {
  route: Route;
  patch: UiPatch;
  /** How sure the router is of the route, 0 to 1. */
  confidence: number;
  /** Time the router took on the server. */
  ms: number;
}

export const isEmpty = (p: UiPatch) => Object.values(p).every((v) => v === undefined);

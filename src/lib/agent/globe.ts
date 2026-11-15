// What the detective is looking at, sent to the globe as it happens. These go
// to the browser as data parts (data-focus, data-grid, data-imagery), never to the model, so
// a grid of hundreds of cells costs no tokens. Outside a streamed run (voice,
// tests) there is no writer and nothing is sent.
import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { GlobeFocus, GlobeGrid, GlobeImagery } from "./view";

type Box = [number, number, number, number];

/** The stream writer of the tool call running now (set by `safe` in tools.ts). */
export const globeWriter = new AsyncLocalStorage<((chunk: unknown) => void) | undefined>();

export function toGlobe(part: ({ type: "focus" } & GlobeFocus) | ({ type: "grid" } & GlobeGrid) | ({ type: "imagery" } & GlobeImagery)) {
  globeWriter.getStore()?.({ ...part, id: `${part.type}-${randomUUID()}` });
}

export const deg = (v: number) => Number(v.toFixed(2));
export const roundBox = (b: Box) => b.map(deg) as Box;

/** Point the globe at an area, with what is being read there. */
export const focusOn = (name: string, box: Box, what: string) => toGlobe({ type: "focus", name, box: roundBox(box), what });

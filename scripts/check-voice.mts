// Runs spoken commands through the voice brain against the real data files (no browser, no mic).
//   SCRIPT="Take me to the Amazon.|Select vegetation.|What else should I investigate?" npx tsx scripts/check-voice.mts
// /api calls (computer vision) go to a running dev server on $PORT (default 3000).
import { readFile } from "node:fs/promises";
import { Brain, type AppState } from "../src/lib/voice/brain";
import { REGIONS } from "../src/lib/regions";

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("/trend_detective_data/")) {
    const body = await readFile("public" + decodeURIComponent(url), "utf8");
    return new Response(body);
  }
  if (url.startsWith("/api/")) return realFetch("http://127.0.0.1:" + (process.env.PORT ?? "3000") + url, init);
  return realFetch(input, init);
}) as typeof fetch;

const state: AppState = { regions: REGIONS, selected: null, layer: "warming", range: null, season: null, sat: { on: true, map: null, years: null } };
const control = {
  open: (id: string | null) => { state.selected = REGIONS.find((r) => r.id === id) ?? null; console.log("   [ui] open", id); },
  setOverlay: (o: unknown) => { console.log("   [ui] overlay", o ? JSON.stringify(o) : null); },
  find: async (q: string) => { throw new Error(`(offline test) no lookup for ${q}.`); },
  setLayer: (l: AppState["layer"]) => { state.layer = l; console.log("   [ui] layer", l); },
  setRange: (r: AppState["range"]) => { state.range = r; console.log("   [ui] range", r); },
  setSeason: (s: string | null) => { state.season = s; console.log("   [ui] season", s); },
  setSat: (s: AppState["sat"]) => { state.sat = s; console.log("   [ui] sat", JSON.stringify(s)); },
  reset: () => { state.selected = null; console.log("   [ui] reset"); },
  openCase: () => {},
};
const brain = new Brain(() => state, control, (t) => console.log("   [progress]", t));
const script = (process.env.SCRIPT ?? "").split("|").filter(Boolean);
for (const line of script) {
  const t0 = performance.now();
  const r = await brain.handle(line);
  console.log(`> ${line}\n  (${r.intent}, ${Math.round(performance.now() - t0)} ms) ${r.text}${r.card ? `\n  [card ${r.card.type}]` : ""}\n`);
}

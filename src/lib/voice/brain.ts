// Command → action + answer. Every number spoken comes from the same loaders and trend test the
// report uses (src/lib/series.ts), or from the computer-vision service; nothing is generated freely.
import { CASES, type Case } from "@/lib/cases";
import { LAYERS, LAYER_INFO } from "@/lib/layers";
import { REGIONS, sourceFor, type Layer, type Region } from "@/lib/regions";
import { annualize, formatP, loadMonthly, seasonsFor, trend, within, WHOLE_YEAR, type Trend, type YearValue } from "@/lib/series";
import { compareMonth, regionBox } from "@/lib/gibs";
import { tTestP } from "@/lib/stats";
import type { Sat } from "@/components/report/Report";
import { parse, type Intent, type PlaceRef, type Term } from "./nlu";

export interface AppState {
  regions: Region[];
  selected: Region | null;
  layer: Layer;
  range: [number, number] | null;
  season: string | null;
  sat: Sat;
}

export interface AppControl {
  open(id: string | null): void;
  find(query: string): Promise<Region>;
  setLayer(l: Layer): void;
  setRange(r: [number, number] | null): void;
  setSeason(s: string | null): void;
  setSat(s: Sat): void;
  reset(): void;
  openCase(c: Case): void;
  /** Drape an image over a box on the globe; null removes it. */
  setOverlay(o: { url: string; bbox: [number, number, number, number] } | null): void;
}

export interface OverlaySeries {
  layer: Layer;
  label: string;
  unit: string;
  color: string;
  values: (number | null)[];
  z: (number | null)[];
  trend: Trend | null;
}

export interface ChangeResult {
  key: string;
  map: string;
  bbox: [number, number, number, number];
  pixel_km: number;
  then: { years: [number, number]; images: number };
  now: { years: [number, number]; images: number };
  valid_pct: number;
  ndvi_then: number;
  ndvi_now: number;
  mean_change: number;
  loss_pct: number;
  gain_pct: number;
  strong_loss_pct: number;
  strong_gain_pct: number;
  loss_centroid: [number, number] | null;
  gain_centroid: [number, number] | null;
  cells: { where: string; loss_pct: number; gain_pct: number; valid_share: number }[];
  method: string;
  source: string;
  cached: boolean;
  ms: number;
}

export type Card =
  | { type: "stats"; title: string; rows: [string, string][]; note?: string }
  | { type: "overlay"; title: string; years: number[]; series: OverlaySeries[]; links: { a: string; b: string; r: number; p: number; n: number }[] }
  | { type: "change"; title: string; result: ChangeResult }
  | { type: "suggest"; title: string; items: string[] }
  | { type: "help" };

export interface Reply {
  text: string;
  /** What to say, when it differs from the text (units spelled out etc.). Built automatically otherwise. */
  speech?: string;
  card?: Card;
  intent: Intent["kind"];
}

type Action = () => Promise<Reply>;

const OVERLAY_COLORS: Partial<Record<Layer, string>> = {
  vegetation: "#7cc56b",
  rainfall: "#5cc8b8",
  drought: "#d3a05e",
  warming: "#ff7a5c",
  air: "#e0a050",
  groundwater: "#6aa8ff",
  ice: "#b8e1ff",
  sealevel: "#9d8cff",
};

const DEFINITIONS: Record<Term, string> = {
  ndvi: "NDVI, the Normalized Difference Vegetation Index, measures how green the land looks from space. Healthy leaves reflect lots of near-infrared light and absorb red light, so NDVI runs from about 0.1 for bare ground to 0.9 for dense rainforest.",
  pvalue: "The p-value is the chance of seeing a trend at least this strong if nothing were really changing. Below 0.05, we call the trend statistically significant: very likely real, not just random ups and downs.",
  sen: "Sen's slope is the median of the slopes between every pair of years. Because it uses the median, a few extreme years can't pull it around, which makes it a robust measure of how fast something is changing.",
  mannkendall:
    "The Mann-Kendall test checks every pair of years and counts how often the later year is higher. If later years are higher far more often than chance would give, the series has a real upward trend; far less often, a downward one.",
  significance:
    "Statistically significant means the Mann-Kendall test gave a p-value below 0.05: a trend this steady would be very unlikely if the values were just random. Not significant doesn't mean no change, only that the record can't yet rule out chance.",
  aod: "Aerosol optical depth, or AOD, measures how much smoke, dust and pollution dim the sunlight passing through the air. Under 0.1 is clear air; above 0.5 is thick haze.",
  trend: "A trend is the long-term direction of a record once the year-to-year ups and downs are set aside. We measure its speed with Sen's slope and test whether it's real with the Mann-Kendall test.",
  anomaly: "An anomaly is how far a value is from its usual level, for example how much warmer this July was than an average July. Using anomalies removes the seasons so the long-term change stands out.",
  soil: "Root-zone soil wetness tells how much water is in the soil where plant roots reach, from 0 for bone dry to 1 for completely soaked. It comes from NASA's POWER project, based on the MERRA-2 model.",
  decade: "Per decade means the change every 10 years at the current pace. Plus 0.2 degrees per decade, for example, adds up to about 1 degree over 50 years.",
};

const DRIVERS: Record<Layer, string> = {
  warming: "In general, greenhouse gases trap more heat everywhere, while local changes like irrigation, city growth or haze can add to that or offset it.",
  rainfall: "In general, rainfall swings a lot naturally from year to year, with patterns such as El Niño, and a warmer atmosphere can hold more moisture, which changes where and how hard it rains.",
  vegetation: "In general, land gets greener from irrigation, farming, tree planting and more carbon dioxide, and browner from drought, fire and forest clearing.",
  air: "In general, haze comes from smoke from wildfires and crop burning, desert dust, and pollution from traffic, power plants and industry.",
  drought: "In general, soil dries out when less rain falls or when higher temperatures make more water evaporate.",
  groundwater: "In general, groundwater falls when wells pump out more water for farms and cities than rain and rivers put back.",
  ice: "In general, sea ice shrinks as the air and the ocean beneath it warm.",
  sealevel: "In general, the sea rises because ocean water expands as it warms and melting glaciers and ice sheets add water.",
};

/** Which other questions to check against each one, for overlays and "why". */
const RELATED: Record<Layer, Layer[]> = {
  vegetation: ["rainfall", "drought", "warming"],
  rainfall: ["vegetation", "drought"],
  drought: ["rainfall", "warming", "vegetation"],
  warming: ["drought", "rainfall"],
  air: ["warming", "rainfall"],
  groundwater: ["rainfall", "drought"],
  ice: ["warming"],
  sealevel: ["warming"],
};

/* ------------------------------------------------------------------ */
/* Formatting                                                          */

const num = (v: number, d = 2) => {
  const a = Math.abs(v);
  const s = a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a >= 1 ? a.toFixed(d) : a.toPrecision(2);
  return `${v < 0 ? "−" : ""}${Number(s)}`;
};
const sgn = (v: number, d = 2) => (v > 0 ? `+${num(v, d)}` : num(v, d));

export function toSpeech(text: string): string {
  return text
    .replace(/p < 0\.001/g, "p less than 0.001")
    .replace(/p = (\d)/g, "p equals $1")
    .replace(/(\d)\s*°C/g, "$1 degrees Celsius")
    .replace(/°\s*([NSEW])\b/g, (_, d: string) => ` degrees ${{ N: "north", S: "south", E: "east", W: "west" }[d]}`)
    .replace(/°/g, " degrees")
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/(\d)\s*mm\/day/g, "$1 millimetres per day")
    .replace(/(\d)\s*cm\b/g, "$1 centimetres")
    .replace(/(\d)\s*km\b/g, "$1 kilometres")
    .replace(/\bNDVI\b/g, "N D V I")
    .replace(/\bAOD\b/g, "A O D")
    .replace(/\bMODIS\b/g, "MODIS")
    .replace(/\bGIBS\b/g, "gibs")
    .replace(/\bNASA\b/g, "NASA")
    .replace(/(\d{4})\s*[–-]\s*(\d{4})/g, "$1 to $2")
    .replace(/−\s*(\d)/g, "minus $1")
    .replace(/\+\s*(\d)/g, "plus $1")
    .replace(/\br = /g, "correlation ")
    .replace(/[*_#]/g, "");
}

/** Places said with "the": "the Amazon rainforest", "the Arctic". */
const THE = new Set([
  "amazon", "congo", "arctic", "sahara", "sahel", "middle_east", "mediterranean", "us_southwest", "western_ghats",
  "gangetic_plain", "himalaya", "world",
]);
export const placeName = (r: Region) => (THE.has(r.id) ? `the ${r.name}` : r.name);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const lat = (v: number) => `${Math.abs(v).toFixed(1)}° ${v < 0 ? "S" : "N"}`;
const lon = (v: number) => `${Math.abs(v).toFixed(1)}° ${v < 0 ? "W" : "E"}`;

/* ------------------------------------------------------------------ */
/* Data                                                                */

interface Yearly {
  region: Region;
  layer: Layer;
  series: YearValue[];
  t: Trend | null;
  r: [number, number] | null;
  unit: string;
  source: string;
}

function seasonFor(region: Region, id: string | null) {
  if (!id) return WHOLE_YEAR;
  return seasonsFor(region).find((s) => s.id === id) ?? WHOLE_YEAR;
}

async function yearly(region: Region, layer: Layer, range: [number, number] | null, season: string | null): Promise<Yearly | null> {
  const src = sourceFor(region, layer);
  if (!src) return null;
  const months = await loadMonthly(src);
  let series = annualize(months, seasonFor(region, season));
  if (range) series = within(series, range);
  const t = trend(series);
  return {
    region,
    layer,
    series,
    t,
    r: series.length ? [series[0].year, series[series.length - 1].year] : null,
    unit: src.unit,
    source: src.label,
  };
}

/** Plain-English verdict, the same wording rules as the report. */
function verdict(y: Yearly): string {
  const info = LAYER_INFO[y.layer];
  const name = placeName(y.region);
  if (!y.t || !y.r) return `There aren't enough years of ${info.measure.toLowerCase()} data for ${name} to test a trend; I need at least 8.`;
  const t = y.t;
  const rate = info.rate(t);
  const rateTxt = `${info.rateText(rate)} ${info.rateUnit}`;
  if (!t.significant) {
    return `${info.measure} in ${name}, ${y.r[0]} to ${y.r[1]}: ${info.flat.toLowerCase()}. It moved ${rateTxt}, but ${formatP(t.pValue)}, so that could be chance.`;
  }
  const up = rate > 0;
  const from = info.valueText(t.at(y.r[0]));
  const to = info.valueText(t.at(y.r[1]));
  const sure = `The Mann-Kendall test gives ${formatP(t.pValue)}, so this trend is very likely real.`;
  // The report's sentences round % to whole numbers; below 1% that would say "0% greener".
  if (info.rateUnit === "per decade" && t.pctPerDecade !== null && Math.abs(t.pctPerDecade) < 1 && y.layer !== "sealevel") {
    return `${info.measure} in ${name} ${up ? "rose" : "fell"} slightly from ${y.r[0]} to ${y.r[1]}: ${rateTxt}, from ${from} to ${to}. It's small, but steady: ${sure.charAt(0).toLowerCase()}${sure.slice(1)}`;
  }
  return `${cap(info.sentence({ name, t, r: y.r, up, from, to }))} ${sure}`;
}

function pearson(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  const r = saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  const t = Math.abs(r) < 1 ? (r * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r) : 99;
  return { r, p: n > 3 ? tTestP(t, n - 2) : 1 };
}

const zscores = (v: number[]) => {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1)) || 1;
  return v.map((x) => (x - m) / sd);
};

/* ------------------------------------------------------------------ */
/* Brain                                                               */

export class Brain {
  private last: Reply | null = null;
  private pending: Action[] = [];
  private investigated = new Set<string>();
  private changes = new Map<string, ChangeResult>();
  /** Place and question the brain itself last moved to; React state may not have caught up yet. */
  private cur: { region: Region | null; layer: Layer } | null = null;

  constructor(
    private getState: () => AppState,
    private control: AppControl,
    private progress: (text: string) => void = () => {},
  ) {}

  private here() {
    const s = this.getState();
    const region = this.cur?.region !== undefined && this.cur ? this.cur.region : s.selected;
    const layer = this.cur?.layer ?? s.layer;
    return { ...s, region, layer };
  }

  async handle(text: string): Promise<Reply> {
    const s = this.getState();
    // Pick up manual changes (clicks) since the last voice command.
    if (this.cur && (this.cur.region?.id ?? null) !== (s.selected?.id ?? null)) this.cur = null;
    if (this.cur && this.cur.layer !== s.layer) this.cur = null;
    const intent = parse(text, s.regions);
    const reply = await this.run(intent).catch(
      (e: Error): Reply => ({ intent: intent.kind, text: `Sorry, that didn't work: ${e.message}` }),
    );
    if (intent.kind !== "repeat" && intent.kind !== "stop") this.last = reply;
    return reply;
  }

  private async run(intent: Intent): Promise<Reply> {
    const k = intent.kind;
    switch (intent.kind) {
      case "navigate":
        return this.navigate(intent.place, intent.layer);
      case "layer":
        if (intent.place) return this.navigate(intent.place, intent.layer);
        return this.selectLayer(intent.layer);
      case "trend":
        return this.trendReply(intent.layer);
      case "stats":
        return this.stats(intent.layer);
      case "overlay":
        return this.overlay(intent.layers);
      case "satellite":
        return this.satellite();
      case "suggest":
        return this.suggest();
      case "compareWorld":
        return this.compareWorld();
      case "season":
        return this.season(intent.season);
      case "range":
        return this.range(intent.from, intent.to);
      case "define":
        return { intent: k, text: DEFINITIONS[intent.term] };
      case "source":
        return this.source();
      case "why":
        return this.why();
      case "case":
        return this.playCase(intent.id);
      case "hideMap":
        this.control.setOverlay(null);
        return { intent: k, text: "Change map hidden." };
      case "home":
        this.control.setOverlay(null);
        this.cur = null;
        this.control.reset();
        return { intent: k, text: "Back to the whole Earth. Where shall we go next?" };
      case "stop":
        return { intent: k, text: "" };
      case "repeat":
        return this.last ?? { intent: k, text: "I haven't said anything yet." };
      case "help":
        return {
          intent: k,
          text: "You can say: take me to the Amazon. Select vegetation. Compare satellite images. Overlay rainfall and soil moisture. Is it significant? Only summer. From 2005 to 2025. What else should I investigate?",
          card: { type: "help" },
        };
      case "yes":
      case "choose": {
        const i = intent.kind === "choose" ? intent.index : 0;
        const act = this.pending[i];
        if (!act) return { intent: k, text: "There's nothing waiting for a yes. Ask me what to investigate next." };
        this.pending = [];
        return act();
      }
      case "no":
        this.pending = [];
        return { intent: k, text: "Okay. What would you like to look at?" };
      case "unknown":
        return {
          intent: k,
          text: `I heard “${intent.text}”, but I can only act on questions about the NASA data here. Try “take me to Punjab”, “select rainfall”, or “what else should I investigate?”.`,
        };
    }
  }

  /* ---------------- navigation ---------------- */

  private async navigate(place: PlaceRef, layer?: Layer): Promise<Reply> {
    let region: Region;
    this.control.setOverlay(null);
    if ("id" in place) {
      region = this.getState().regions.find((r) => r.id === place.id) ?? REGIONS.find((r) => r.id === place.id)!;
      this.control.open(region.id);
    } else {
      this.progress(`Looking up ${place.query} and fetching live NASA data.`);
      try {
        region = await this.control.find(place.query);
      } catch (e) {
        return { intent: "navigate", text: `${(e as Error).message} I can still take you to any place in the list, like the Amazon or Punjab.` };
      }
    }
    const s = this.getState();
    const want = layer ?? s.layer;
    const use = sourceFor(region, want) ? want : (LAYERS.find((l) => sourceFor(region, l)) ?? want);
    if (use !== s.layer) this.control.setLayer(use);
    this.cur = { region, layer: use };
    const y = await yearly(region, use, null, null);
    this.mark(region, use);
    const lead = layer && use !== layer ? `There's no ${LAYER_INFO[layer].measure.toLowerCase()} record for ${placeName(region)}, so I opened ${LAYER_INFO[use].tab.toLowerCase()}. ` : `Here's ${placeName(region)}. `;
    const have = LAYERS.filter((l) => l !== use && sourceFor(region, l)).map((l) => LAYER_INFO[l].tab.toLowerCase());
    const more = have.length ? ` I also have ${listJoin(have)} here.` : "";
    return { intent: "navigate", text: `${lead}${y ? verdict(y) : ""}${more}` };
  }

  private async selectLayer(layer: Layer): Promise<Reply> {
    const { region } = this.here();
    if (!region) {
      this.control.setLayer(layer);
      this.cur = { region: null, layer };
      const info = LAYER_INFO[layer];
      return { intent: "layer", text: `Showing ${info.tab.toLowerCase()} for every place. ${info.intro} Name a place to test its record.` };
    }
    if (!sourceFor(region, layer)) {
      const alt = REGIONS.filter((r) => sourceFor(r, layer)).slice(0, 4).map((r) => r.name);
      return { intent: "layer", text: `I don't have a ${LAYER_INFO[layer].measure.toLowerCase()} record for ${placeName(region)}. It's available for places like ${listJoin(alt)}.` };
    }
    this.control.setLayer(layer);
    this.cur = { region, layer };
    const s = this.getState();
    const y = await yearly(region, layer, null, s.season);
    this.mark(region, layer);
    return { intent: "layer", text: `${LAYER_INFO[layer].tab}. ${LAYER_INFO[layer].definition} ${y ? verdict(y) : ""}` };
  }

  private async trendReply(layer?: Layer, season?: string | null, range?: [number, number] | null): Promise<Reply> {
    const st = this.here();
    const h = { ...st, season: season !== undefined ? season : st.season, range: range !== undefined ? range : st.range };
    if (!h.region) return { intent: "trend", text: "Pick a place first, for example: take me to the Amazon." };
    const l = layer ?? h.layer;
    if (layer && layer !== h.layer) return this.selectLayer(layer);
    const y = await yearly(h.region, l, h.range, h.season);
    if (!y) return { intent: "trend", text: `There's no ${LAYER_INFO[l].measure.toLowerCase()} record for ${placeName(h.region)}.` };
    this.mark(h.region, l);
    let extra = "";
    const ch = this.changes.get(h.region.id);
    if (l === "vegetation" && ch) {
      extra = ` Pixel by pixel, the satellite comparison found ${ch.loss_pct}% of the land losing greenness and ${ch.gain_pct}% gaining, so the regional average ${Math.abs(ch.mean_change) < 0.01 ? "hides changes that cancel out" : "matches what the pixels show"}.`;
    }
    return { intent: "trend", text: `${verdict(y)}${extra}` };
  }

  private async stats(layer?: Layer): Promise<Reply> {
    const h = this.here();
    if (!h.region) return { intent: "stats", text: "Pick a place first, then I'll run the trend test." };
    const l = layer ?? h.layer;
    const y = await yearly(h.region, l, h.range, h.season);
    if (!y) return { intent: "stats", text: `There's no ${LAYER_INFO[l].measure.toLowerCase()} record for ${placeName(h.region)}.` };
    if (!y.t || !y.r) return { intent: "stats", text: verdict(y) };
    const t = y.t;
    const info = LAYER_INFO[l];
    const unit = y.unit ? ` ${y.unit}` : "";
    const season = seasonFor(h.region, h.season);
    const pct = t.pctPerDecade !== null ? ` That's ${sgn(t.pctPerDecade, 1)}% of the average per decade.` : "";
    const text =
      `${info.measure} in ${placeName(h.region)}, ${season.id === "year" ? "whole year" : season.label.toLowerCase()}, ${y.r[0]} to ${y.r[1]}, ${t.n} years. ` +
      `Sen's slope: ${sgn(t.slopePerDecade)}${unit} per decade.${pct} ` +
      `Mann-Kendall test: ${formatP(t.pValue)}, so the trend is ${t.significant ? "statistically significant at the 0.05 level" : "not statistically significant; it could be chance"}. ` +
      `${t.topTenInLast15} of the 10 ${info.top} years fell in the last 15; chance alone would give about ${Math.round((15 / t.n) * 10)}.`;
    this.mark(h.region, l);
    return {
      intent: "stats",
      text,
      card: {
        type: "stats",
        title: `${info.measure} · ${h.region.name}`,
        rows: [
          ["Years", `${y.r[0]}–${y.r[1]} (n = ${t.n})`],
          ["Season", season.id === "year" ? "Whole year" : season.label],
          ["Sen's slope", `${sgn(t.slopePerDecade)}${unit} / decade`],
          ["Relative change", t.pctPerDecade !== null ? `${sgn(t.pctPerDecade, 1)}% / decade` : "—"],
          ["Total change", `${sgn(t.totalChange)}${unit}`],
          ["Mann-Kendall p", formatP(t.pValue).replace("p ", "")],
          ["Verdict", t.significant ? "Significant (p < 0.05)" : "Not significant"],
        ],
        note: y.source,
      },
    };
  }

  /* ---------------- overlay ---------------- */

  private async overlay(layers: Layer[]): Promise<Reply> {
    const h = this.here();
    if (!h.region) return { intent: "overlay", text: "Pick a place first, then I can overlay other measurements on it." };
    const region = h.region;
    const want = [h.layer, ...layers.filter((l) => l !== h.layer)];
    const loaded = await Promise.all(want.map((l) => yearly(region, l, h.range, h.season)));
    const missing = want.filter((_, i) => !loaded[i]).map((l) => LAYER_INFO[l].measure.toLowerCase());
    const ok = loaded.filter((y): y is Yearly => !!y && y.series.length > 0);
    if (ok.length < 2) {
      return { intent: "overlay", text: `I can't overlay that here: there's no ${listJoin(missing)} record for ${placeName(region)}.` };
    }
    const years = [...new Set(ok.flatMap((y) => y.series.map((d) => d.year)))].sort((a, b) => a - b);
    const series: OverlaySeries[] = ok.map((y) => {
      const map = new Map(y.series.map((d) => [d.year, d.value]));
      const vals = y.series.map((d) => d.value);
      const zs = zscores(vals);
      const zmap = new Map(y.series.map((d, i) => [d.year, zs[i]]));
      return {
        layer: y.layer,
        label: LAYER_INFO[y.layer].measure,
        unit: y.unit,
        color: OVERLAY_COLORS[y.layer] ?? "#fff",
        values: years.map((yr) => map.get(yr) ?? null),
        z: years.map((yr) => zmap.get(yr) ?? null),
        trend: y.t,
      };
    });
    // Year-to-year link between the main measure and each overlay, on the years both have.
    const links = series.slice(1).map((o) => {
      const a: number[] = [];
      const b: number[] = [];
      years.forEach((_, i) => {
        if (series[0].values[i] !== null && o.values[i] !== null) {
          a.push(series[0].values[i]!);
          b.push(o.values[i]!);
        }
      });
      const { r, p } = pearson(a, b);
      return { a: series[0].label, b: o.label, r, p, n: a.length };
    });
    ok.forEach((y) => this.mark(region, y.layer));
    this.investigated.add(`${region.id}:overlay`);
    const parts = ok.slice(1).map((y) => verdict(y));
    const linkText = links
      .map((l) =>
        l.n < 8
          ? ""
          : l.p < 0.05
            ? `Year to year, ${l.a.toLowerCase()} and ${l.b.toLowerCase()} ${l.r > 0 ? "rise and fall together" : "move in opposite directions"} (r = ${l.r.toFixed(2)}, ${formatP(l.p)}, ${l.n} years).`
            : `Year to year, ${l.a.toLowerCase()} and ${l.b.toLowerCase()} aren't clearly linked (r = ${l.r.toFixed(2)}, ${formatP(l.p)}).`,
      )
      .filter(Boolean)
      .join(" ");
    const miss = missing.length ? ` There's no ${listJoin(missing)} record for ${placeName(region)}, so I left it out.` : "";
    return {
      intent: "overlay",
      text: `Overlaying on ${LAYER_INFO[h.layer].measure.toLowerCase()} for ${placeName(region)}. ${parts.join(" ")} ${linkText}${miss}`.replace(/\s+/g, " ").trim(),
      card: { type: "overlay", title: `${region.name}: ${series.map((s) => s.label.toLowerCase()).join(", ")}`, years, series, links },
    };
  }

  /* ---------------- computer vision ---------------- */

  private async satellite(): Promise<Reply> {
    const h = this.here();
    if (!h.region) return { intent: "satellite", text: "Pick a place first, then I'll compare its old and new satellite images." };
    const region = h.region;
    const box = regionBox(region) ?? (region.id === "world" ? ([-180, -60, 180, 80] as [number, number, number, number]) : null);
    if (!box) return { intent: "satellite", text: `I can't frame ${region.name} for a satellite comparison.` };
    const [a, b] = h.sat.years ?? [2001, 2025];
    this.control.setSat({ on: true, map: "vegetation", years: [a, b] });
    this.progress(`Comparing NASA satellite images of ${placeName(region)} from ${a} and ${b}, pixel by pixel.`);
    const month = compareMonth(region, "vegetation");
    const q = new URLSearchParams({ bbox: box.join(","), then: String(a), now: String(b), month: String(month), span: "3" });
    const res = await fetch(`/api/voice/cv/change?${q}`);
    const j = await res.json();
    if (!res.ok) {
      return { intent: "satellite", text: `The satellite maps are on the globe, but the computer-vision comparison failed: ${j.error ?? res.status}.` };
    }
    const c = j as ChangeResult;
    this.changes.set(region.id, c);
    this.control.setOverlay({ url: `/api/voice${c.map}`, bbox: c.bbox });
    this.mark(region, "vegetation");
    const top = [...c.cells].filter((x) => x.valid_share > 0.03).sort((x, y) => y.loss_pct - x.loss_pct)[0];
    const topGain = [...c.cells].filter((x) => x.valid_share > 0.03).sort((x, y) => y.gain_pct - x.gain_pct)[0];
    let where = "";
    if (c.loss_pct >= 1 && top && c.loss_centroid) {
      where = ` The losses are concentrated in the ${top.where} of the region, where ${top.loss_pct}% of the land lost greenness; their centre is near ${lat(c.loss_centroid[1])}, ${lon(c.loss_centroid[0])}.`;
    }
    const gainWhere = c.gain_pct >= 1 && topGain ? ` Gains are strongest in the ${topGain.where} (${topGain.gain_pct}%).` : "";
    const small = c.loss_pct < 1 && c.gain_pct < 1;
    const text =
      `I compared ${c.then.images} NASA MODIS images from ${c.then.years[0]}–${c.then.years[1]} with ${c.now.images} from ${c.now.years[0]}–${c.now.years[1]}, pixel by pixel, about ${c.pixel_km} km per pixel. ` +
      (small
        ? `Less than 1% of the land changed consistently in either direction.`
        : `${c.loss_pct}% of the land lost greenness and ${c.gain_pct}% gained, counting only changes that held up across the images.`) +
      where +
      gainWhere +
      ` Averaged over the whole region, NDVI went from ${c.ndvi_then.toFixed(2)} to ${c.ndvi_now.toFixed(2)}.`;
    return { intent: "satellite", text, card: { type: "change", title: `${region.name}: plant cover change`, result: c } };
  }

  /* ---------------- suggestions ---------------- */

  private async suggest(): Promise<Reply> {
    const h = this.here();
    const region = h.region;
    type Cand = { score: number; text: string; act: Action };
    const cands: Cand[] = [];

    if (region) {
      // Other measurements at this place that haven't been looked at yet.
      const others = LAYERS.filter((l) => l !== h.layer && sourceFor(region, l) && !this.investigated.has(`${region.id}:${l}`));
      const ys = await Promise.all(others.map((l) => yearly(region, l, null, null)));
      ys.forEach((y) => {
        if (!y?.t || !y.r) return;
        const info = LAYER_INFO[y.layer];
        const rate = info.rate(y.t);
        const strength = Math.min(2, Math.abs(rate) / info.limit);
        cands.push({
          score: (y.t.significant ? 1 : 0.2) + strength,
          text: `${info.measure} in ${placeName(region)}: ${(rate > 0 ? info.up : info.down).toLowerCase()} at ${info.rateText(rate)} ${info.rateUnit}, ${y.t.significant ? "very likely real" : "not yet significant"} (${formatP(y.t.pValue)}).`,
          act: () => this.selectLayer(y.layer),
        });
      });
      // Related measurements together.
      const rel = RELATED[h.layer].filter((l) => sourceFor(region, l));
      if (rel.length && !this.investigated.has(`${region.id}:overlay`)) {
        cands.push({
          score: 1.1,
          text: `Overlay ${listJoin(rel.slice(0, 2).map((l) => LAYER_INFO[l].measure.toLowerCase()))} on ${LAYER_INFO[h.layer].measure.toLowerCase()} to see whether they move together.`,
          act: () => this.overlay(rel.slice(0, 2)),
        });
      }
      // Satellite comparison for plant cover.
      const ch = this.changes.get(region.id);
      if (!ch && sourceFor(region, "vegetation")) {
        cands.push({ score: 1.05, text: `Compare satellite images of ${placeName(region)} from 2001 and 2025 pixel by pixel, to find where the land changed.`, act: () => this.satellite() });
      } else if (ch && ch.loss_pct >= 2 && ch.loss_centroid) {
        cands.push({
          score: 1.3,
          text: `Look closer at the ${ch.cells.sort((a, b) => b.loss_pct - a.loss_pct)[0]?.where} of ${placeName(region)}, near ${lat(ch.loss_centroid[1])}, ${lon(ch.loss_centroid[0])}, where the satellite comparison found the most lost greenness.`,
          act: () => this.navigate({ query: `${ch.loss_centroid![1].toFixed(2)}, ${ch.loss_centroid![0].toFixed(2)}` }, "vegetation"),
        });
      }
    }

    // The fastest real change for this question somewhere else.
    const layer = h.layer;
    const pool = REGIONS.filter((r) => r.id !== region?.id && sourceFor(r, layer));
    const all = await Promise.all(pool.map((r) => yearly(r, layer, null, null).catch(() => null)));
    const info = LAYER_INFO[layer];
    const best = all
      .filter((y): y is Yearly => !!y?.t?.significant && !this.investigated.has(`${y.region.id}:${layer}`))
      .sort((a, b) => Math.abs(info.rate(b.t!)) - Math.abs(info.rate(a.t!)))[0];
    if (best?.t) {
      const rate = info.rate(best.t);
      cands.push({
        score: 1,
        text: `Elsewhere, ${placeName(best.region)} has the fastest ${info.changing} I can find: ${info.rateText(rate)} ${info.rateUnit} (${formatP(best.t.pValue)}).`,
        act: () => this.navigate({ id: best.region.id, name: best.region.name }, layer),
      });
    }

    if (!cands.length) {
      return { intent: "suggest", text: "Try another place: say “take me to” and a country, state or city, and I'll fetch live NASA data for it." };
    }
    const top = cands.sort((a, b) => b.score - a.score).slice(0, 3);
    this.pending = top.map((c) => c.act);
    const ord = ["First", "Second", "Third"];
    const text = `${top.length > 1 ? "Here are " + top.length + " leads." : "Here's a lead."} ${top.map((c, i) => `${ord[i]}: ${c.text}`).join(" ")} Say “the first one”, “the second one” or “the third one”.`;
    return { intent: "suggest", text, card: { type: "suggest", title: "Leads to investigate", items: top.map((c) => c.text) } };
  }

  /* ---------------- the rest ---------------- */

  private async compareWorld(): Promise<Reply> {
    const h = this.here();
    if (!h.region) return { intent: "compareWorld", text: "Pick a place first, then I'll compare it with the whole planet." };
    const world = REGIONS.find((r) => r.id === "world")!;
    const [a, b] = await Promise.all([yearly(h.region, h.layer, null, null), yearly(world, h.layer, null, null)]);
    const info = LAYER_INFO[h.layer];
    if (!a?.t || !b?.t) return { intent: "compareWorld", text: `I can't compare ${info.measure.toLowerCase()} for ${placeName(h.region)} with the whole Earth: one of the records is missing.` };
    const ra = info.rate(a.t);
    const rb = info.rate(b.t);
    const ratio = Math.abs(rb) > 1e-9 ? ra / rb : NaN;
    const how =
      !a.t.significant || !b.t.significant
        ? "but at least one of these trends isn't significant, so I wouldn't rank them"
        : Number.isFinite(ratio) && ratio > 1.2
          ? `about ${ratio.toFixed(1)} times as fast as the planet`
          : Number.isFinite(ratio) && ratio < 0.8 && ratio > 0
            ? "slower than the planet"
            : ratio <= 0
              ? "in the opposite direction to the planet"
              : "about as fast as the planet";
    return {
      intent: "compareWorld",
      text: `${info.measure} in ${placeName(h.region)}: ${info.rateText(ra)} ${info.rateUnit} (${formatP(a.t.pValue)}) against ${info.rateText(rb)} for the whole Earth (${formatP(b.t.pValue)}), ${how}.`,
    };
  }

  private async season(spoken: string): Promise<Reply> {
    const h = this.here();
    if (!h.region) return { intent: "season", text: "Pick a place first, then choose a season." };
    if (spoken === "year") {
      this.control.setSeason(null);
      return { intent: "season", text: "Back to the whole year." };
    }
    const seasons = seasonsFor(h.region);
    const south = h.region.lat < 0;
    const map: Record<string, string> = h.region.monsoon
      ? { summer: "summer", winter: "winter", monsoon: "monsoon", post: "post", spring: "summer", autumn: "post", dry: "winter" }
      : south
        ? { summer: "djf", winter: "jja", spring: "son", autumn: "mam", dry: "jja", monsoon: "djf", post: "mam" }
        : { summer: "jja", winter: "djf", spring: "mam", autumn: "son", dry: "jja", monsoon: "jja", post: "son" };
    const s = seasons.find((x) => x.id === map[spoken]);
    if (!s) return { intent: "season", text: `${h.region.name} doesn't use that season.` };
    this.control.setSeason(s.id);
    const r = await this.trendReply(undefined, s.id);
    return { ...r, intent: "season", text: `${s.label} only. ${r.text}` };
  }

  private async range(from: number, to: number): Promise<Reply> {
    const h = this.here();
    if (!h.region) return { intent: "range", text: "Pick a place first, then choose the years." };
    if (from === 0) {
      this.control.setRange(null);
      const r = await this.trendReply(undefined, undefined, null);
      return { ...r, intent: "range", text: `Using the whole record. ${r.text}` };
    }
    const y = await yearly(h.region, h.layer, null, h.season);
    if (!y?.r) return { intent: "range", text: "There's no record to narrow down." };
    const a = Math.max(from, y.r[0]);
    const b = Math.min(to, y.r[1]);
    if (b - a < 9) return { intent: "range", text: `The record runs ${y.r[0]} to ${y.r[1]}. Pick a span of at least 10 years inside it.` };
    this.control.setRange([a, b]);
    const r = await this.trendReply(undefined, undefined, [a, b]);
    return { ...r, intent: "range", text: `${a} to ${b}. ${r.text}` };
  }

  private source(): Reply {
    const h = this.here();
    if (!h.region) return { intent: "source", text: "All the data is NASA's: POWER, Giovanni, GIBS satellite imagery and the NASA sea level record." };
    const src = sourceFor(h.region, h.layer);
    const cav = LAYER_INFO[h.layer].caveat;
    return { intent: "source", text: src ? `${LAYER_INFO[h.layer].measure} for ${placeName(h.region)} comes from ${src.label}.${cav ? " " + cav : ""}` : "There's no record for this question here." };
  }

  private async why(): Promise<Reply> {
    const h = this.here();
    const general = DRIVERS[h.layer];
    if (!h.region) return { intent: "why", text: general };
    const rel = RELATED[h.layer].filter((l) => sourceFor(h.region!, l));
    if (rel.length) this.pending = [() => this.overlay(rel.slice(0, 2))];
    const offer = rel.length
      ? ` I can't tell you the cause from one record, but I can test clues: want me to overlay ${listJoin(rel.slice(0, 2).map((l) => LAYER_INFO[l].measure.toLowerCase()))}? Say yes.`
      : "";
    return { intent: "why", text: `${general}${offer}` };
  }

  private playCase(id: string): Reply {
    const c = CASES.find((x) => x.id === id);
    if (!c) return { intent: "case", text: "I don't know that story." };
    this.control.openCase(c);
    const r = REGIONS.find((x) => x.id === c.place) ?? null;
    this.cur = { region: r, layer: c.layer };
    if (r) this.mark(r, c.layer);
    return { intent: "case", text: `${c.title}. ${c.note}. Ask me “is it significant?” to run the test.` };
  }

  private mark(region: Region, layer: Layer) {
    this.investigated.add(`${region.id}:${layer}`);
  }
}

function listJoin(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

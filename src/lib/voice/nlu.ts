// Speech → command. Deterministic grammar + fuzzy place matching: instant, offline, and it never
// guesses: anything it can't map to a known command comes back as "unknown" and the brain says so.
import type { Layer, Region } from "@/lib/regions";
import { CASES } from "@/lib/cases";

export type Intent =
  | { kind: "navigate"; place: PlaceRef; layer?: Layer }
  | { kind: "layer"; layer: Layer; place?: PlaceRef }
  | { kind: "satellite" }
  | { kind: "trend"; layer?: Layer }
  | { kind: "stats"; layer?: Layer }
  | { kind: "overlay"; layers: Layer[] }
  | { kind: "suggest" }
  | { kind: "compareWorld" }
  | { kind: "season"; season: string }
  | { kind: "range"; from: number; to: number }
  | { kind: "define"; term: Term }
  | { kind: "source" }
  | { kind: "why" }
  | { kind: "case"; id: string }
  | { kind: "home" }
  | { kind: "hideMap" }
  | { kind: "stop" }
  | { kind: "repeat" }
  | { kind: "help" }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "choose"; index: number }
  | { kind: "unknown"; text: string };

/** A place: one of ours, or a free-text name to look up live. */
export type PlaceRef = { id: string; name: string } | { query: string };

export type Term = "ndvi" | "pvalue" | "sen" | "mannkendall" | "significance" | "aod" | "trend" | "anomaly" | "soil" | "decade";

const LAYER_WORDS: [Layer, RegExp][] = [
  ["vegetation", /\b(vegetation|plants?|plant cover|green(ness|ing|er)?|brown(ing|er)|ndvi|n d v i|evi|forests?|trees|crops?|leaf|leaves|deforestation)\b/],
  ["rainfall", /\b(rain(fall|s|y)?|precipitation|wet(ter|ness)?|showers?)\b/],
  ["drought", /\b(soil( moisture| wetness| water)?|drought|dry(ness)?|drier|moisture)\b/],
  ["groundwater", /\b(ground ?water|aquifers?|wells?|water table)\b/],
  ["warming", /\b(temperature|heat(wave)?s?|hot(ter)?|warm(ing|er|th)?|climate)\b/],
  ["air", /\b(air( quality)?|haze|hazy|hazier|cleaner|pollution|aerosols?|smoke|smog|dust|a o d|aod)\b/],
  ["ice", /\b(sea ice|ice|ice cover|glaciers?|melting)\b/],
  ["sealevel", /\b(sea level|sea-level|sea levels|ocean rise|rising seas?)\b/],
];

/** Extra spoken names for our places. */
const ALIASES: Record<string, string[]> = {
  world: ["world", "whole world", "whole earth", "earth", "the planet", "planet", "globe", "global"],
  amazon: ["amazon", "amazon basin", "amazon rainforest", "amazon rain forest", "the amazon", "amazonia", "amazon forest"],
  congo: ["congo", "congo basin", "congo rainforest"],
  arctic: ["arctic", "north pole", "the arctic"],
  antarctic: ["antarctic", "antarctica", "south pole"],
  north_america: ["north america"],
  south_america: ["south america"],
  us_southwest: ["us southwest", "american southwest", "southwest us", "south west us", "arizona"],
  southeast_asia: ["southeast asia", "south east asia"],
  east_africa: ["east africa"],
  middle_east: ["middle east"],
  himalaya: ["himalaya", "himalayas", "uttarakhand", "himachal"],
  gangetic_plain: ["gangetic plain", "ganges", "ganga", "gangetic"],
  western_ghats: ["western ghats", "ghats"],
  northeast: ["northeast india", "north east india", "northeast", "north east", "assam"],
  andhra: ["andhra", "andhra pradesh"],
  tamil_nadu: ["tamil nadu", "tamilnadu"],
  central_india: ["central india"],
  delhi: ["delhi", "new delhi", "delhi ncr"],
  bengaluru: ["bengaluru", "bangalore"],
  chennai: ["chennai", "madras"],
  kolkata: ["kolkata", "calcutta"],
  mumbai: ["mumbai", "bombay"],
  wisconsin: ["wisconsin"],
};

/** Ways Whisper writes our jargon, mapped back to one spelling. */
const FIXES: [RegExp, string][] = [
  [/\b(and|an|in|end|n)[ .-]?d[ .-]?v[ .-]?i\b/g, "ndvi"],
  [/\bman[ -]kendall\b/g, "mann kendall"],
  [/\b(sens|sen's|sense|sins) slope\b/g, "sen's slope"],
  [/\ba[ .]o[ .]d\b/g, "aod"],
];

export function normalize(s: string): string {
  let t = s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9.' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, to] of FIXES) t = t.replace(re, to);
  return t.replace(/\.(?=\s|$)/g, "").trim();
}

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

type Name = { id: string; name: string; alias: string };

function names(regions: Region[]): Name[] {
  const out: Name[] = [];
  for (const r of regions) {
    const base = normalize(r.name.replace(/\(.*?\)/g, ""));
    const set = new Set([base, ...(ALIASES[r.id] ?? []), normalize(r.id.replace(/_/g, " "))]);
    if (base.includes(",")) set.add(base.split(",")[0]);
    for (const alias of set) out.push({ id: r.id, name: r.name, alias: normalize(alias) });
  }
  return out.sort((a, b) => b.alias.length - a.alias.length); // longest alias first: "south america" before "america"
}

/** Best known place mentioned in the text (exact phrase, then a close spelling). */
export function matchPlace(text: string, regions: Region[]): { id: string; name: string } | null {
  const t = ` ${normalize(text)} `;
  const list = names(regions);
  for (const n of list) if (t.includes(` ${n.alias} `)) return { id: n.id, name: n.name };
  // Whisper spelling slips ("amazone", "rajastan"): compare word windows of the same length.
  const words = normalize(text).split(" ");
  let best: { id: string; name: string; d: number } | null = null;
  for (const n of list) {
    const k = n.alias.split(" ").length;
    if (n.alias.length < 5) continue;
    for (let i = 0; i + k <= words.length; i++) {
      const w = words.slice(i, i + k).join(" ");
      const d = lev(w, n.alias);
      const limit = n.alias.length >= 8 ? 2 : 1;
      if (d <= limit && (!best || d < best.d)) best = { id: n.id, name: n.name, d };
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

function layersIn(t: string): Layer[] {
  const found: { l: Layer; at: number }[] = [];
  let rest = t;
  for (const [l, re] of LAYER_WORDS) {
    const m = rest.match(re);
    if (m && m.index !== undefined) {
      found.push({ l, at: m.index });
      rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length);
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.l);
}

const SEASON_WORDS: [string, RegExp][] = [
  ["year", /\b(whole|full|all|entire) year\b|\ball (the )?months\b|\bevery month\b/],
  ["monsoon", /\bmonsoon\b/],
  ["post", /\b(after|post)[ -]monsoon\b/],
  ["summer", /\bsummers?\b/],
  ["winter", /\bwinters?\b/],
  ["spring", /\bspring\b/],
  ["autumn", /\b(autumn|fall)\b/],
  ["dry", /\bdry season\b/],
];

const NUM_WORDS: Record<string, number> = { ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, five: 5 };

function yearsIn(t: string): number[] {
  return [...t.matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
}

/** Words to strip before treating the rest as a place name to look up. */
const NAV = /^(please |can you |could you |now |okay |ok |hey |so )*(take me to|bring me to|go to|fly( me)? to|fly over|zoom( in)?( in)?to|zoom in on|zoom to|navigate to|travel to|head to|let's go to|lets go to|show me|open|visit|find|look at|search( for)?)\b/;

export function parse(raw: string, regions: Region[]): Intent {
  const t = normalize(raw);
  if (!t) return { kind: "unknown", text: raw };
  const has = (re: RegExp) => re.test(t);

  // Control words first: short and unambiguous.
  if (has(/^(stop|quiet|shut up|cancel|never ?mind|be quiet|pause|silence)\b/)) return { kind: "stop" };
  if (has(/\b(repeat|say (that|it) again|pardon|come again)\b/)) return { kind: "repeat" };
  if (has(/^(yes|yeah|yep|sure|ok(ay)?|go ahead|do it|please do|let's do (it|that)|sounds good)\b/) && t.split(" ").length <= 4)
    return { kind: "yes" };
  if (has(/^(no|nope|not now|no thanks)\b/) && t.split(" ").length <= 3) return { kind: "no" };
  const ord = t.match(/\b(the )?(first|second|third|1st|2nd|3rd|number (one|two|three))( one)?\b/);
  if (ord && t.split(" ").length <= 5) {
    const w = ord[0];
    return { kind: "choose", index: /second|2nd|two/.test(w) ? 1 : /third|3rd|three/.test(w) ? 2 : 0 };
  }
  if (has(/\b(help|what can (you|i) (do|say|ask)|how (do i|does this) work|commands)\b/)) return { kind: "help" };
  if (has(/\b(hide|remove|clear|turn off|close)\b.*\b(map|overlay)\b/)) return { kind: "hideMap" };
  if (has(/\b(go (back )?home|reset|start over|zoom (all the way )?out|back to (the )?(globe|start|earth)|close (the )?report|go back)\b/))
    return { kind: "home" };

  // "What else should I investigate?"
  if (has(/\b(what else|what next|what now|where (else|next)|suggest|recommend|investigate|what should (i|we) (look|check|explore|do)|any (other )?ideas|anything else)\b/))
    return { kind: "suggest" };

  // Definitions.
  if (has(/\b(what('s| is| does| are)|define|meaning of|explain|tell me about)\b/)) {
    const term: Term | null = has(/\bn ?d ?v ?i\b|vegetation index/)
      ? "ndvi"
      : has(/\bp[ -]?values?\b|\bp value\b/)
        ? "pvalue"
        : has(/\bsen'?s? slope|\bsense slope|\bslope\b/)
          ? "sen"
          : has(/\bmann[ -]?kendall|\bman kendall|\bkendall\b/)
            ? "mannkendall"
            : has(/\b(statistical(ly)? )?significan(t|ce)\b/)
              ? "significance"
              : has(/\baerosol optical depth|\baod\b|\ba o d\b/)
                ? "aod"
                : has(/\banomal(y|ies)\b/)
                  ? "anomaly"
                  : has(/\bsoil (wetness|moisture)\b/)
                    ? "soil"
                    : has(/\bper decade\b|\bdecade\b/)
                      ? "decade"
                      : has(/\b(a |the )?trend\b/) && has(/\bwhat (is|does) (a |the )?trend\b/)
                        ? "trend"
                        : null;
    if (term && !has(/\b(calculate|compute)\b/)) return { kind: "define", term };
  }

  if (has(/\b(where (does|do|did) (the|this|these|it) .*come from|data source|sources?\b|which (satellite|dataset)|where.*data from)/))
    return { kind: "source" };
  if (has(/\bwhy\b|\bwhat('s| is) causing\b|\bcause[sd]?\b|\breason\b/)) return { kind: "why" };

  // Satellite then-and-now with computer vision.
  if (has(/\b(computer vision|change detection|satellite (images?|imagery|observations?|photos?|maps?)|then and now|before and after|historical and (recent|current|present)|past and present|old and new (images?|photos?)|compare (the )?(images?|imagery|photos?|maps?)|pixel)/))
    return { kind: "satellite" };

  // Statistics.
  if (has(/\b(calculate|compute|run|test|give me|what('s| is)|how)\b.*\b(slope|significan|statistic|p[ -]?value|mann|kendall|confidence)/) || has(/\b(is it|is this|is that) (statistically )?significant\b/))
    return { kind: "stats", layer: layersIn(t)[0] };

  // Overlay other variables on the current one.
  if (has(/\b(overlay|layer on|add|plot (them )?together|combine|on top|alongside|together with|compare (it )?with|versus|vs)\b/)) {
    const ls = layersIn(t);
    if (ls.length) return { kind: "overlay", layers: ls };
    if (has(/\b(world|planet|earth|global|rest of the world)\b/)) return { kind: "compareWorld" };
  }
  if (has(/\b(compare|comparison|compared)\b.*\b(world|planet|earth|global|everywhere|other places)\b|\bhow does (it|this) compare\b/))
    return { kind: "compareWorld" };

  // Cases.
  if (has(/\b(story|stories|case|example|demo)\b/)) {
    const c =
      CASES.find((x) => t.includes(x.id)) ??
      CASES.find((x) => normalize(x.title).split(" ").some((w) => w.length > 4 && t.includes(w)));
    if (c) return { kind: "case", id: c.id };
  }

  // Seasons and years.
  for (const [s, re] of SEASON_WORDS) if (has(re) && !has(NAV)) return { kind: "season", season: s };
  const ys = yearsIn(t);
  if (ys.length >= 2 && has(/\b(from|between|to|until|through|and)\b/)) return { kind: "range", from: Math.min(...ys), to: Math.max(...ys) };
  if (ys.length === 1 && has(/\b(since|from|after|starting)\b/)) return { kind: "range", from: ys[0], to: 2025 };
  const last = t.match(/\b(last|past) (\d+|ten|fifteen|twenty|thirty|forty|five) years\b/);
  if (last) {
    const n = Number(last[2]) || NUM_WORDS[last[2]];
    return { kind: "range", from: 2025 - n + 1, to: 2025 };
  }
  if (has(/\b(all (the )?years|whole record|full record|entire record)\b/)) return { kind: "range", from: 0, to: 0 };

  // Trend summary ("reveal the NDVI trend", "is it getting greener?").
  if (has(/\b(trends?|changing|chang(ed|e)|getting (hotter|warmer|wetter|drier|greener|browner|hazier|cleaner)|increas|decreas|rising|falling|going up|going down)\b/) && !has(NAV)) {
    const place = matchPlace(t, regions);
    const l = layersIn(t)[0];
    if (place) return { kind: "navigate", place, layer: l };
    return { kind: "trend", layer: l };
  }

  // Navigation and question selection.
  const place = matchPlace(t, regions);
  const ls = layersIn(t);
  if (has(NAV) || place) {
    if (place) return { kind: "navigate", place, layer: ls[0] };
    // Unknown place: the words after the verb, minus a trailing "please".
    const q = t.replace(NAV, "").replace(/\b(please|for me|now)\b/g, "").replace(/^(the|a)\s+/, "").trim();
    if (ls.length && (!q || layersIn(q).length)) return { kind: "layer", layer: ls[0] };
    if (q.length >= 3) return { kind: "navigate", place: { query: q }, layer: undefined };
  }
  if (ls.length && has(/\b(select|choose|switch( to)?|show|pick|change to|use|let's (look at|see)|look at|go with)\b|^\w+( \w+)?$/))
    return { kind: "layer", layer: ls[0] };
  if (ls.length) return { kind: "trend", layer: ls[0] };

  return { kind: "unknown", text: raw };
}

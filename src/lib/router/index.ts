// The router: decides in well under a second whether a message only changes
// what is on screen (and what to change), is a question for the detective, or both.
//
// Two models run at once:
//   - a decision model (Jev) answers typed questions with probabilities. Its
//     options come from the app's own lists (places, questions, seasons, stories),
//     so nothing here matches phrases.
//   - a small language model reads out what a decision model can't: a place
//     name and years. It is only waited for when it is needed (a place we don't
//     have, or specific years), so "fly to the Amazon" costs one fast call.
import { experimental_decide as decide, generateText, Output } from "ai";
import { z } from "zod";
import { CASES } from "../cases";
import { LAYERS, LAYER_INFO } from "../layers";
import { REGIONS, type Layer, type Region } from "../regions";
import type { View } from "../agent/view";
import type { Route, Routed, UiPatch } from "./types";

const DECIDER = "typesafe-ai/jev-1.14.0";
const EXTRACTOR = "openai/gpt-6-luna"; // with reasoning off: ~0.9 s, about a third of the price of Gemini 3.5 Flash-Lite

/** Below this the route is a guess: the detective takes it instead. */
const SURE = 0.6;

const KEEP = "keep";

const placeOptions: Record<string, string> = {
  [KEEP]: "No place named, or the place already on screen (here, this place, it)",
  other: "A place that is not in this list, or only part of one of these (a country, city or state inside a bigger area)",
};
for (const r of REGIONS) placeOptions[r.id] = r.name;

const layerOptions: Record<string, string> = { [KEEP]: "No measure named: keep the one on screen" };
for (const l of LAYERS) layerOptions[l] = `${LAYER_INFO[l].tab}: ${LAYER_INFO[l].question}`;

const storyOptions: Record<string, string> = {
  none: "None of these. Pick this unless the person clearly asks for one of the others.",
  home: "Go back to the whole Earth: home, zoom out, reset, close the place",
  open_chat: "Open the detective chat panel",
  close_chat: "Close or hide the detective chat panel",
};
for (const c of CASES) storyOptions[`story_${c.id}`] = `Asks by name to play or open the story "${c.title}"`;

/** The kind of place each of ours is, to tell "Brazil" from South America and "Kenya" from East Africa. */
type Kind = "continent" | "country" | "sub" | "feature";
function kindOf(r: Region): Kind[] {
  if (r.group === "Continents" || r.group === "World") return ["continent"];
  if (r.group === "Indian cities") return ["sub"];
  if (r.group === "India") return [r.id === "india" ? "country" : "sub"];
  if (r.id === "china") return ["country"];
  if (r.id === "wisconsin") return ["sub"];
  return ["feature", "continent"]; // the Amazon, the Sahel, East Africa
}

const QUESTIONS = {
  route: {
    type: "choice",
    instructions: "This is what a person said to an Earth-data app: a 3D globe with reports of NASA records for places. Decide who handles it.",
    criteria: {
      ui: "Only asks to move, show, open, switch, filter or reset what is on screen: go to a place, change the measure, season or years, show or hide satellite maps, play a story, go home. No question that needs analysis.",
      research: "A question that needs looking at data, explaining, comparing, searching across places or reasoning about causes.",
      both: "Asks to go to or show something AND asks a question that needs analysis.",
      chat: "Greeting, thanks or small talk.",
    },
  },
  place: { type: "choice", instructions: "Which place does the person want to see?", criteria: placeOptions },
  kind: {
    type: "choice",
    instructions: "What kind of place did the person name?",
    criteria: {
      none: "No place",
      continent: "A continent or a large region of several countries",
      country: "A single country",
      sub: "A state, province, city or smaller area",
      feature: "A natural feature: rainforest, river basin, ice sheet, desert, sea, pole",
    },
  },
  layer: { type: "choice", instructions: "Which measure does the person want to see?", criteria: layerOptions },
  season: {
    type: "choice",
    instructions: "Which part of the year does the person want?",
    criteria: {
      [KEEP]: "No season named",
      year: "The whole year, all months, no season",
      djf: "December to February (northern winter)",
      mam: "March to May (spring; summer in India)",
      jja: "June to August (northern summer)",
      son: "September to November (autumn)",
      monsoon: "The monsoon, June to September",
      post: "After the monsoon, October and November",
    },
  },
  years: {
    type: "choice",
    instructions: "Which years does the person want?",
    criteria: {
      [KEEP]: "No years named",
      all: "The whole record, all years",
      set: "Specific years, a start year, an end year, or the last few years",
    },
  },
  satellite: {
    type: "choice",
    instructions: "Does the person want the satellite maps of then and now on the globe?",
    criteria: {
      [KEEP]: "Not mentioned",
      on: "Show or compare satellite images, then and now, before and after",
      off: "Hide or turn off the satellite maps",
    },
  },
  action: { type: "choice", instructions: "Does the person ask for one of these?", criteria: storyOptions },
} as const;

const Slots = z.object({
  place: z.string().nullable().describe("The place the person wants, spelled as it is on a map (country, state, city, region, river basin), or null. The text may come from speech recognition: if a name is misheard or misspelled, give the real place it sounds like. Seasons, measures and years are not places."),
  from: z.number().int().nullable().describe("First year, or null"),
  to: z.number().int().nullable().describe("Last year, or null"),
});

function describe(view: View | null) {
  if (!view) return "the globe";
  const where = view.place ? `the report for ${view.placeName ?? view.place}` : "the whole globe, no place open";
  return `${where}, measure "${LAYER_INFO[view.layer].tab}"${view.season ? `, season ${view.season}` : ""}${view.range ? `, years ${view.range.join("–")}` : ""}`;
}

function extract(text: string, signal?: AbortSignal) {
  const year = new Date().getFullYear();
  return generateText({
    model: EXTRACTOR,
    output: Output.object({ schema: Slots }),
    system: `Read the place and years from what a person said to an Earth-data globe app. Fill only what they said. The records end in ${year - 1}; "last N years" means ${year - 1}-N+1 to ${year - 1}; "since 2005" means 2005 to ${year - 1}.`,
    prompt: text,
    providerOptions: { openai: { reasoningEffort: "none" } },
    abortSignal: signal,
  }).then((r) => r.output);
}

const top = (a: { choice: string; probabilities?: Record<string, number> }) => a.probabilities?.[a.choice] ?? 0;

export async function routeMessage(text: string, view: View | null, signal?: AbortSignal): Promise<Routed> {
  const t0 = performance.now();
  const slots = extract(text, signal);
  slots.catch(() => {}); // only awaited when needed

  const { answers: a } = await decide({
    model: DECIDER,
    state: `Person said: "${text}"\nOn screen: ${describe(view)}.`,
    questions: QUESTIONS,
    abortSignal: signal,
  });

  let route = a.route.choice as Route;
  let confidence = top(a.route);
  const patch: UiPatch = {};

  const place = a.place.choice;
  const named = place !== KEEP && a.kind.choice !== "none";
  const region = REGIONS.find((r) => r.id === place);
  // Ours only when it is the same kind of place that was named: a country inside a continent is found live.
  const ours = !!region && top(a.place) >= 0.5 && (a.kind.choice === "none" || kindOf(region).includes(a.kind.choice as Kind));
  if (ours) patch.place = { id: place };

  const needSlots = (named && !ours) || a.years.choice === "set";
  if (needSlots) {
    const s = await slots.catch(() => null);
    if (named && !ours) {
      // The extractor fixes mishearings, so the name it gives may be one of ours after all.
      const mine = s?.place && REGIONS.find((r) => r.name.toLowerCase() === s.place!.toLowerCase());
      if (mine) patch.place = { id: mine.id };
      else if (s?.place) patch.place = { name: s.place };
      else if (route === "ui") route = "research"; // a place we can't name: let the detective work it out
    }
    if (a.years.choice === "set" && s?.from) patch.range = [s.from, s.to ?? new Date().getFullYear() - 1];
  }
  if (a.years.choice === "all") patch.range = null;

  if (a.layer.choice !== KEEP && (!view || a.layer.choice !== view.layer)) patch.layer = a.layer.choice as Layer;
  if (a.season.choice !== KEEP) patch.season = a.season.choice === "year" ? null : a.season.choice;
  if (a.satellite.choice !== KEEP) patch.sat = a.satellite.choice === "on";

  const act = a.action.choice;
  if (act === "home") patch.home = true;
  else if (act === "open_chat" || act === "close_chat") patch.chat = act === "open_chat";
  else if (act.startsWith("story_")) patch.story = act.slice(6);

  // An unsure route goes to the detective, which can do everything the screen can.
  if ((route === "ui" || route === "both") && confidence < SURE) {
    route = "research";
    confidence = 1 - confidence;
  }

  return { route, patch, confidence, ms: Math.round(performance.now() - t0) };
}

export type { Routed, UiPatch } from "./types";

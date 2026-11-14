// The detective's tools. Each one returns JSON the model reads and the chat
// panel draws (a trend's `series` becomes a small chart).
import "server-only";

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { LAYERS } from "../layers";
import type { Layer } from "../regions";
import { compare, extremes, getTrend, listPlaces, monthlyPattern, placeCard, resolvePlace, seasonBreakdown, versusWorld, viewChange } from "./data";
import { WATER_STORAGE, calculate, nasaPower, scanRegion, waterStorage } from "./research";
import { powerParameters, webSearch } from "./web";

const layer = z.enum(LAYERS as [Layer, ...Layer[]]).describe("warming, rainfall, vegetation, air, drought, groundwater, ice or sealevel");
const place = z.string().describe('A place id from list_places ("delhi"), its name, or any place name on Earth ("Lagos")');
const season = z
  .string()
  .nullish()
  .describe('Season id: India uses winter, summer, monsoon, post; elsewhere djf, mam, jja, son. Omit for the whole year.');
const year = z.number().int().min(1900).max(2100).nullish();

/** A short letters-only id (letters, so the number check never sees it). */
const chartId = () => Array.from({ length: 5 }, () => "abcdefghjkmnpqrstuvwxyz"[Math.floor(Math.random() * 23)]).join("");

/**
 * Every yearly series a tool returns gets a chart id. The answer places that
 * chart with a viz block ({"type":"chart","ids":[...]}); the chat draws it
 * from the same tool result, so the model never re-types the numbers.
 */
function tagCharts(out: unknown): unknown {
  if (!out || typeof out !== "object") return out;
  const o = out as Record<string, unknown>;
  if (Array.isArray(o.series) && o.series.length > 1) o.chart = chartId();
  if (Array.isArray(o.results)) for (const r of o.results as Record<string, unknown>[]) if (r && Array.isArray(r.series) && r.series.length > 1) r.chart = chartId();
  return o;
}

/** Errors go back to the model as text, so it can pick another place or question. */
const safe =
  <A>(fn: (a: A) => Promise<unknown>) =>
  async (a: A) => {
    try {
      return JSON.stringify(tagCharts(await fn(a)));
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  };

export const listPlacesTool = tool(safe(({ layer }: { layer?: Layer | null }) => Promise.resolve(listPlaces(layer ?? undefined))), {
  name: "list_places",
  description:
    "The places with ready NASA records, and which questions each can answer. Use it to pick ids, to find places that fit a question, or when unsure what exists.",
  schema: z.object({ layer: layer.nullish().describe("Only places with this record") }),
});

export const findPlaceTool = tool(safe(async ({ query }: { query: string }) => placeCard(await resolvePlace(query))), {
  name: "find_place",
  description:
    "Look up any place by name. Catalog places come back with their records; anywhere else gets live NASA POWER data (warming, rainfall, drought, air) averaged over the area.",
  schema: z.object({ query: z.string() }),
});

export const getTrendTool = tool(safe(getTrend), {
  name: "get_trend",
  description:
    "Test whether a place's record has a real trend: Mann-Kendall test and Sen's slope on one value per year. Returns the verdict, rate per decade, total change, the chance it is luck (p-value), and the yearly series. Optional season and year window (at least 10 years).",
  schema: z.object({ place, layer, season, from: year, to: year }),
});

export const compareTool = tool(safe(compare), {
  name: "compare_places",
  description:
    "Test the same question in several places (up to 12) and rank them by rate per decade. Flags places whose trends point in opposite directions.",
  schema: z.object({ places: z.array(z.string()).min(2).max(12), layer, season, from: year, to: year }),
});

export const versusWorldTool = tool(safe(({ place, layer }: { place: string; layer: Layer }) => versusWorld(place, layer)), {
  name: "versus_world",
  description: "How fast a place is changing compared with the whole Earth, as a ratio of their rates per decade.",
  schema: z.object({ place, layer }),
});

export const seasonTool = tool(safe(({ place, layer }: { place: string; layer: Layer }) => seasonBreakdown(place, layer)), {
  name: "season_breakdown",
  description: "The trend for every season and the whole year at one place. Finds changes hidden in one season.",
  schema: z.object({ place, layer }),
});

export const monthlyTool = tool(
  safe(({ place, layer, year }: { place: string; layer: Layer; year?: number | null }) => monthlyPattern(place, layer, year)),
  {
    name: "monthly_pattern",
    description: "A place's usual value for each month, next to one year's months (the latest by default). For questions about one year or the yearly cycle.",
    schema: z.object({ place, layer, year }),
  },
);

export const extremesTool = tool(safe(({ place }: { place: string }) => extremes(place)), {
  name: "daily_extremes",
  description:
    "Heatwaves, hot nights, heavy rain and dry spells from a daily station record (Indian places only): first decade against last decade, and the trend.",
  schema: z.object({ place }),
});

/** Changes the browser applies: the chat panel reads this tool's output. */
export const showTool = tool(safe(viewChange), {
  name: "show_in_app",
  description:
    "Open a place's full report on the globe, on one question, optionally for a season and years. Use it when you finish a finding the person should see, or when they ask to see or open something. Takes a named country, state or city only; skip it for a box or a natural region.",
  schema: z.object({ place, layer, season, from: year, to: year }),
});

/* ------------------------------------------------------------------ */
/* Research: past the app's ready-made records                         */

const areaPlace = z.string().nullish().describe("Any place name on Earth (a city, district, state, country, river basin) or a catalog id");
const box = z
  .array(z.number())
  .length(4)
  .nullish()
  .describe("Instead of a place: [west, south, east, north] in degrees (east longitude and north latitude positive). Use it for custom areas.");
const months = z.array(z.number().int().min(1).max(12)).nullish().describe("Custom season as month numbers, e.g. [6,7,8,9]. Overrides season.");

export const waterStorageTool = tool(safe(waterStorage), {
  name: "water_storage",
  description:
    "GROUNDWATER and total water stored on land, for ANY place or area on Earth, from NASA's GRACE and GRACE-FO satellites (monthly, April 2002 to September 2026). Returns the trend in mm of water per decade, the volume gained or lost in km³ per year, the latest month against its usual level, the lowest and highest months, the last 12 months and the yearly series. Use it for any question about groundwater, aquifers, water tables, depletion, wells running dry, or water security.",
  schema: z.object({ place: areaPlace, box, from: year, to: year }),
});

export const nasaPowerTool = tool(safe(nasaPower), {
  name: "nasa_power",
  description: `Any NASA POWER climate variable for ANY place on Earth, monthly 1981–2025: trend test (Mann-Kendall, Sen's slope), usual value for each month, the latest year's months and the yearly series. Ask for up to 8 parameters in one call. Useful parameters:
T2M mean air temperature °C; T2M_MAX / T2M_MIN daily max / min °C; TS earth skin temperature; T2MDEW dew point; RH2M relative humidity %; QV2M specific humidity g/kg;
PRECTOTCORR rainfall mm/day; EVPTRNS evapotranspiration; GWETTOP topsoil wetness, GWETROOT root-zone soil wetness, GWETPROF whole-profile soil wetness (0–1);
WS2M / WS10M wind m/s; ALLSKY_SFC_SW_DWN sunlight reaching the ground kWh/m²/day; CLRSKY_SFC_SW_DWN clear-sky sunlight; CLOUD_AMT cloud cover %; ALLSKY_SFC_UV_INDEX UV index; PS surface pressure kPa; FROST_DAYS; AOD_55 aerosols (haze, dust, smoke).
POWER has about 280 monthly parameters in all: for anything not listed here, find its code with power_parameters first.`,
  schema: z.object({
    place: areaPlace,
    box,
    parameters: z.array(z.string()).min(1).max(8).describe("POWER parameter codes, e.g. [\"T2M_MAX\", \"RH2M\"]"),
    season,
    months,
    from: year,
    to: year,
  }),
});

export const scanRegionTool = tool(safe(scanRegion), {
  name: "scan_region",
  description: `Map a variable across an area on a grid and find WHERE inside it things are changing: tests the trend in every grid cell (POWER ~0.5°, or GRACE 1°), then reports the whole-area trend, how many cells rise or fall significantly, a 3×3 sector breakdown (north-west … south-east), and the fastest rising and falling cells with nearby place names. Use it for "which parts of X…", hotspots, and spatial patterns. Parameter: any NASA POWER code (see nasa_power), or ${WATER_STORAGE} for GRACE groundwater/water storage. Areas up to 30° a side (any size for ${WATER_STORAGE}). Takes 5–20 s.`,
  schema: z.object({
    place: areaPlace,
    box,
    parameter: z.string().describe(`A NASA POWER code like PRECTOTCORR, or ${WATER_STORAGE}`),
    season,
    months,
    from: year,
    to: year,
    top: z.number().int().min(1).max(10).nullish().describe("How many fastest rising and falling cells to list (default 5)"),
    nameCells: z.boolean().nullish().describe("Look up place names for the listed cells (default true; false is faster)"),
  }),
});

export const calculateTool = tool(safe(calculate), {
  name: "calculate",
  description:
    "Arithmetic for numbers you derive (differences, ratios, percentages, unit conversions, per-person shares, projections). Use it instead of doing sums in your head, so every number in the answer is traceable. Several labelled expressions per call. Supports + - * / ^ %, brackets, sqrt, abs, ln, log, exp, min, max, mean, sum, round, pi.",
  schema: z.object({
    items: z.array(z.object({ label: z.string(), expression: z.string().describe("e.g. (12.3 - 4.1) / 4.1 * 100") })).min(1).max(20),
  }),
});

export const powerParametersTool = tool(safe(powerParameters), {
  name: "power_parameters",
  description:
    "Search NASA POWER's official catalog (about 280 monthly parameters: temperature, humidity, rain, snow, wind, soil wetness, sunlight, clouds, UV, aerosols, pressure, degree days and more) for the code of a variable, then pass that code to nasa_power or scan_region.",
  schema: z.object({
    search: z.string().describe('Words to look for, e.g. "snow depth", "wet bulb", "heating degree days"'),
    max: z.number().int().min(1).max(40).nullish(),
  }),
});

export const webSearchTool = tool(safe(webSearch), {
  name: "web_search",
  description:
    "Search the web. Use it for what satellite data cannot say: causes, local reports and well-level surveys, government assessments, policies, news of a recent flood or heatwave, and published studies to compare your numbers with. Returns pages with URL, title, date and excerpts. Several searches can run in parallel.",
  schema: z.object({
    objective: z.string().describe("What you want to find out, in a full sentence, with the place, period and kind of source wanted"),
    queries: z.array(z.string()).min(1).max(5).describe("2-3 short keyword searches, 3-6 words each"),
    max: z.number().int().min(1).max(15).nullish().describe("Pages to return, default 6"),
    after: z.string().nullish().describe("Only pages published on or after this date, YYYY-MM-DD"),
  }),
});

export const TOOLS = [
  listPlacesTool,
  findPlaceTool,
  getTrendTool,
  compareTool,
  versusWorldTool,
  seasonTool,
  monthlyTool,
  extremesTool,
  waterStorageTool,
  nasaPowerTool,
  scanRegionTool,
  powerParametersTool,
  webSearchTool,
  calculateTool,
  showTool,
];

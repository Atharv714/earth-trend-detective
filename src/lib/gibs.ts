// NASA GIBS (Global Imagery Browse Services): free satellite map tiles by date.
// We use the EPSG:4326 service because it covers the poles; the web-mercator
// one stops at 85°. Layer ids and date ranges were checked against
// https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml
import type { Region } from "./regions";
import clearDates from "./clear-dates.json";

export const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";

export interface TileSource {
  layer: string;
  matrixSet: string; // GIBS tile-matrix-set name, e.g. "1km"
  maxLevel: number;
  ext: "jpeg" | "png";
}

export const BASE: TileSource = { layer: "BlueMarble_NextGeneration", matrixSet: "500m", maxLevel: 7, ext: "jpeg" };
export const BORDERS: TileSource = { layer: "Reference_Features_15m", matrixSet: "15.625m", maxLevel: 12, ext: "png" };

export type MapLayer = "truecolor" | "vegetation" | "heat";

export interface MapLayerDef extends TileSource {
  id: MapLayer;
  label: string;
  /** One sentence for people who have never seen this kind of map. */
  explain: string;
  firstYear: number;
  lastYear: number;
  legend?: { stops: string[]; min: string; max: string; title: string };
}

export const MAP_LAYERS: MapLayerDef[] = [
  {
    id: "truecolor",
    label: "Photo",
    explain: "A real satellite photo (NASA Terra/MODIS) from the clearest day we could find that season.",
    layer: "MODIS_Terra_CorrectedReflectance_TrueColor",
    matrixSet: "250m",
    maxLevel: 8,
    ext: "jpeg",
    firstYear: 2001,
    lastYear: 2025,
  },
  {
    id: "vegetation",
    label: "Vegetation",
    explain: "How green the land is that month (NDVI). Dark green is dense forest or crops, brown is bare ground.",
    layer: "MODIS_Terra_L3_NDVI_Monthly",
    matrixSet: "1km",
    maxLevel: 6,
    ext: "png",
    firstYear: 2001,
    lastYear: 2025,
    legend: {
      title: "Plant cover (NDVI)",
      stops: ["#f1ecec", "#dfcec1", "#b09f8e", "#9d7c5f", "#a0c030", "#6eaa01", "#4e9401", "#2e8000", "#197301", "#006400", "#004801", "#001801"],
      min: "Bare",
      max: "Dense",
    },
  },
  {
    id: "heat",
    label: "Surface heat",
    explain: "How hot the ground itself got in the daytime that month, measured from orbit (MODIS land surface temperature).",
    layer: "MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day",
    matrixSet: "2km",
    maxLevel: 5,
    ext: "png",
    firstYear: 2001,
    lastYear: 2025,
    legend: {
      title: "Ground temperature",
      stops: ["#00b3ff", "#00f0ff", "#28ffa2", "#54ff3c", "#80ff00", "#abff00", "#dbff00", "#fffa00", "#ffd600", "#ffb200", "#ff8800", "#ff6400"],
      min: "−23 °C",
      max: "57 °C",
    },
  },
];

export const mapLayer = (id: MapLayer) => MAP_LAYERS.find((l) => l.id === id)!;

export function tileUrl(src: TileSource, time?: string) {
  const t = time ? `${time}/` : "";
  return `${GIBS}/${src.layer}/default/${t}${src.matrixSet}/{z}/{y}/{x}.${src.ext}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m: number) => MONTHS[m - 1];

const inIndia = (r: Region) => r.group === "India" || r.group === "Indian cities";

/**
 * Which month to compare across years. Comparing the same month removes the
 * seasons, so what is left is the long-term change.
 */
export function compareMonth(r: Region, layer: MapLayer): number {
  if (layer === "heat") {
    if (inIndia(r)) return 5; // pre-monsoon peak
    if (r.lat < -23) return 1;
    if (Math.abs(r.lat) < 15) return 9;
    return 7;
  }
  // Vegetation: the end of each place's growing season.
  if (inIndia(r)) return 10; // after the monsoon
  if (r.id === "amazon" || r.id === "south_america") return 8; // dry season, cleared land shows
  if (r.lat < -23) return 2;
  return 8;
}

/** Date string GIBS expects for one layer, place and year. */
export function layerDate(r: Region, layer: MapLayer, year: number): string {
  if (layer === "truecolor") {
    const d = (clearDates as Record<string, Record<string, string>>)[r.id]?.[String(year)];
    return d ?? `${year}-07-15`;
  }
  return `${year}-${String(compareMonth(r, layer)).padStart(2, "0")}-01`;
}

export function describeDate(r: Region, layer: MapLayer, year: number) {
  if (layer === "truecolor") {
    const d = new Date(layerDate(r, layer, year) + "T00:00:00Z");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  return `${monthName(compareMonth(r, layer))} ${year}`;
}

/** Years every map layer has, so any two can be compared. */
export const MAP_YEARS: [number, number] = [2001, 2025];

/** Which map to open with for each question. Photos show change best; GIBS has no monthly rain map, so rain uses plant cover. */
export const DEFAULT_MAP: Record<"warming" | "rainfall" | "vegetation", MapLayer> = {
  warming: "truecolor",
  rainfall: "vegetation",
  vegetation: "vegetation",
};

/** The area to frame on the map: the region's box, or about 130 km around a city. Null for the whole Earth. */
export function regionBox(r: Region): [number, number, number, number] | null {
  if (r.id === "world") return null;
  if (r.bbox) return r.bbox;
  return [r.lon - 0.6, r.lat - 0.6, r.lon + 0.6, r.lat + 0.6];
}

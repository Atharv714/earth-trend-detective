// Catalog of every place we have data for, and where its files live.
// Boxes come from the READMEs in public/trend_detective_data.

export type Layer = "warming" | "rainfall" | "vegetation";

/** How to turn the raw CSV value into the unit we show. */
export type Convert = "kelvin" | "mmPerHour" | "none";

export interface Source {
  path: string; // under /trend_detective_data
  column: string;
  convert: Convert;
  unit: string;
  label: string; // where the numbers come from, for people
}

export type RegionGroup = "World" | "Continents" | "Hotspots" | "India" | "Indian cities";

export interface Region {
  id: string;
  name: string;
  group: RegionGroup;
  /** lon_min, lat_min, lon_max, lat_max. Absent for single points. */
  bbox?: [number, number, number, number];
  lat: number;
  lon: number;
  temp?: Source;
  rain?: Source;
  veg?: Source;
  /** Daily NASA POWER station file (India only), for heatwaves, nights and extreme rain. */
  daily?: { file: string; station: string };
  /** India uses the IMD seasons (with a monsoon); everywhere else uses the four quarters. */
  monsoon?: boolean;
}

const W = "04_world_giovanni";
const I = "02_india_satellite_giovanni";
const P = "01_india_monthly_nasa_power";
const V = "06_vegetation_land_temp_gibs";

const merra = (file: string): Source => ({
  path: `${file}.csv`,
  column: "M2TMNXSLV_5_12_4_T2M",
  convert: "kelvin",
  unit: "°C",
  label: "MERRA-2 air temperature, via NASA Giovanni",
});
const gpm = (file: string): Source => ({
  path: `${file}.csv`,
  column: "GPM_3IMERGM_07_precipitation",
  convert: "mmPerHour",
  unit: "mm/day",
  label: "GPM IMERG satellite rainfall, via NASA Giovanni",
});
const powerT = (file: string): Source => ({
  path: `${P}/${file}.csv`,
  column: "T2M",
  convert: "none",
  unit: "°C",
  label: "NASA POWER air temperature",
});
const powerR = (file: string): Source => ({
  path: `${P}/${file}.csv`,
  column: "PRECTOTCORR",
  convert: "none",
  unit: "mm/day",
  label: "NASA POWER rainfall",
});
const ndvi = (id: string): Source => ({
  path: `${V}/ndvi_${id}.csv`,
  column: "NDVI",
  convert: "none",
  unit: "NDVI",
  label: "MODIS Terra NDVI (plant greenness), averaged by us from NASA GIBS imagery",
});
const daily = (file: string, station: string) => ({ daily: { file: `03_india_daily_nasa_power/${file}.csv`, station } });

type B = [number, number, number, number];
const box = (lonMin: number, latMin: number, lonMax: number, latMax: number): Pick<Region, "bbox" | "lat" | "lon"> => ({
  bbox: [lonMin, latMin, lonMax, latMax] as B,
  lat: (latMin + latMax) / 2,
  lon: (lonMin + lonMax) / 2,
});

const india = { monsoon: true } as const;

export const REGIONS: Region[] = [
  { id: "world", name: "Whole Earth", group: "World", lat: 20, lon: 10, temp: merra(`${W}/temp_world`), rain: gpm(`${W}/rain_world`), veg: ndvi("world") },

  { id: "asia", name: "Asia", group: "Continents", ...box(60, 5, 150, 55), temp: merra(`${W}/temp_asia`), rain: gpm(`${W}/rain_asia`), veg: ndvi("asia") },
  { id: "africa", name: "Africa", group: "Continents", ...box(-20, -35, 52, 37), temp: merra(`${W}/temp_africa`), rain: gpm(`${W}/rain_africa`), veg: ndvi("africa") },
  { id: "europe", name: "Europe", group: "Continents", ...box(-10, 35, 40, 70), temp: merra(`${W}/temp_europe`), rain: gpm(`${W}/rain_europe`), veg: ndvi("europe") },
  { id: "north_america", name: "North America", group: "Continents", ...box(-170, 15, -50, 72), lon: -105, temp: merra(`${W}/temp_north_america`), rain: gpm(`${W}/rain_north_america`), veg: ndvi("north_america") },
  { id: "south_america", name: "South America", group: "Continents", ...box(-82, -56, -34, 13), temp: merra(`${W}/temp_south_america`), rain: gpm(`${W}/rain_south_america`), veg: ndvi("south_america") },
  { id: "australia", name: "Australia", group: "Continents", ...box(113, -39, 154, -11), temp: merra(`${W}/temp_australia`), rain: gpm(`${W}/rain_australia`), veg: ndvi("australia") },

  { id: "arctic", name: "Arctic", group: "Hotspots", bbox: [-180, 66.5, 180, 90], lat: 80, lon: 0, temp: merra(`${W}/temp_arctic`), veg: ndvi("arctic") },
  { id: "antarctic", name: "Antarctica", group: "Hotspots", bbox: [-180, -90, 180, -60], lat: -78, lon: 0, temp: merra(`${W}/temp_antarctic`) },
  { id: "siberia", name: "Siberia", group: "Hotspots", ...box(60, 50, 140, 70), temp: merra(`${W}/temp_siberia`), veg: ndvi("siberia") },
  { id: "amazon", name: "Amazon rainforest", group: "Hotspots", ...box(-75, -15, -45, 5), temp: merra(`${W}/temp_amazon`), rain: gpm(`${W}/rain_amazon`), veg: ndvi("amazon") },
  { id: "congo", name: "Congo rainforest", group: "Hotspots", ...box(12, -5, 30, 5), veg: ndvi("congo") },
  { id: "borneo", name: "Borneo", group: "Hotspots", ...box(108, -4, 119, 7), veg: ndvi("borneo") },
  { id: "southeast_asia", name: "Southeast Asia", group: "Hotspots", ...box(92, -10, 141, 25), rain: gpm(`${W}/rain_southeast_asia`), veg: ndvi("southeast_asia") },
  { id: "china", name: "China", group: "Hotspots", ...box(100, 20, 122, 42), veg: ndvi("china") },
  { id: "sahara", name: "Sahara", group: "Hotspots", ...box(-15, 15, 35, 30), temp: merra(`${W}/temp_sahara`), rain: gpm(`${W}/rain_sahara`), veg: ndvi("sahara") },
  { id: "sahel", name: "Sahel", group: "Hotspots", ...box(-17, 12, 40, 18), veg: ndvi("sahel") },
  { id: "east_africa", name: "East Africa", group: "Hotspots", ...box(29, -12, 52, 15), rain: gpm(`${W}/rain_east_africa`), veg: ndvi("east_africa") },
  { id: "middle_east", name: "Middle East", group: "Hotspots", ...box(34, 12, 60, 38), temp: merra(`${W}/temp_middle_east`), veg: ndvi("middle_east") },
  { id: "mediterranean", name: "Mediterranean", group: "Hotspots", ...box(-10, 30, 40, 45), rain: gpm(`${W}/rain_mediterranean`), veg: ndvi("mediterranean") },
  { id: "us_southwest", name: "US Southwest", group: "Hotspots", ...box(-120, 30, -103, 42), rain: gpm(`${W}/rain_us_southwest`), veg: ndvi("us_southwest") },
  { id: "wisconsin", name: "Wisconsin, USA", group: "Hotspots", ...box(-92.9, 42.5, -86.8, 47.1), temp: merra(`${W}/temp_wisconsin`), rain: gpm(`${W}/rain_wisconsin`), veg: ndvi("wisconsin") },

  { id: "india", name: "India", group: "India", ...box(68, 6, 98, 37), ...india, temp: merra(`${I}/temp_india`), rain: gpm(`${I}/rain_india`), veg: ndvi("india") },
  { id: "punjab", name: "Punjab", group: "India", ...box(73.9, 29.5, 76.9, 32.5), ...india, temp: powerT("punjab"), rain: gpm(`${I}/rain_punjab`), veg: ndvi("punjab"), ...daily("punjab_ludhiana_lat30.9_lon75.85", "Ludhiana") },
  { id: "rajasthan", name: "Rajasthan", group: "India", ...box(69.5, 24.5, 76.5, 30), ...india, temp: merra(`${I}/temp_rajasthan`), rain: gpm(`${I}/rain_rajasthan`), veg: ndvi("rajasthan"), ...daily("rajasthan_jodhpur_lat26.24_lon73.02", "Jodhpur") },
  { id: "gangetic_plain", name: "Gangetic plain", group: "India", ...box(80, 24, 88, 28), ...india, temp: powerT("gangetic_plain"), rain: gpm(`${I}/rain_gangetic_plain`), veg: ndvi("gangetic_plain"), ...daily("gangetic_patna_lat25.59_lon85.14", "Patna") },
  { id: "himalaya", name: "Himalaya (Uttarakhand, HP)", group: "India", ...box(76.5, 29.5, 80.5, 33), ...india, temp: merra(`${I}/temp_himalaya`), rain: powerR("himalaya_uttarakhand_hp"), veg: ndvi("himalaya"), ...daily("himalaya_dehradun_lat30.32_lon78.03", "Dehradun") },
  { id: "northeast", name: "Northeast India", group: "India", ...box(89.5, 22, 97, 29), ...india, temp: powerT("northeast"), rain: gpm(`${I}/rain_northeast`), veg: ndvi("northeast"), ...daily("northeast_guwahati_lat26.14_lon91.74", "Guwahati") },
  { id: "western_ghats", name: "Western Ghats", group: "India", ...box(73, 10, 77, 16), ...india, temp: powerT("western_ghats"), rain: gpm(`${I}/rain_western_ghats`), veg: ndvi("western_ghats"), ...daily("western_ghats_mahabaleshwar_lat17.92_lon73.66", "Mahabaleshwar") },
  { id: "andhra", name: "Andhra Pradesh", group: "India", ...box(77, 13, 84.5, 19.5), ...india, temp: merra(`${I}/temp_andhra`), rain: gpm(`${I}/rain_andhra`), veg: ndvi("andhra") },
  { id: "kerala", name: "Kerala", group: "India", ...box(74.8, 8, 77.5, 12.5), ...india, temp: powerT("kerala"), rain: gpm(`${I}/rain_kerala`), veg: ndvi("kerala"), ...daily("kerala_kochi_lat9.93_lon76.27", "Kochi") },
  { id: "central_india", name: "Central India", group: "India", ...box(76, 20, 83, 25), ...india, temp: powerT("central_india"), rain: gpm(`${I}/rain_central_india`), veg: ndvi("central_india"), ...daily("central_nagpur_lat21.15_lon79.09", "Nagpur") },
  { id: "tamil_nadu", name: "Tamil Nadu", group: "India", ...box(76.5, 8, 80.5, 13.5), ...india, temp: powerT("tamil_nadu"), rain: powerR("tamil_nadu"), ...daily("tamilnadu_madurai_lat9.93_lon78.12", "Madurai") },

  { id: "delhi", name: "Delhi NCR", group: "Indian cities", lat: 28.61, lon: 77.21, ...india, temp: powerT("delhi_ncr"), rain: powerR("delhi_ncr"), veg: ndvi("delhi"), ...daily("delhi_ncr_lat28.61_lon77.21", "Delhi") },
  { id: "mumbai", name: "Mumbai", group: "Indian cities", lat: 19.07, lon: 72.88, ...india, temp: powerT("mumbai"), rain: powerR("mumbai"), ...daily("mumbai_lat19.07_lon72.88", "Mumbai") },
  { id: "amaravati", name: "Amaravati", group: "Indian cities", lat: 16.51, lon: 80.52, ...india, temp: powerT("amaravati"), rain: powerR("amaravati"), ...daily("amaravati_lat16.51_lon80.52", "Amaravati") },
  { id: "bengaluru", name: "Bengaluru", group: "Indian cities", lat: 12.97, lon: 77.59, ...india, temp: powerT("bengaluru"), rain: powerR("bengaluru"), ...daily("bengaluru_lat12.97_lon77.59", "Bengaluru") },
  { id: "kolkata", name: "Kolkata", group: "Indian cities", lat: 22.57, lon: 88.36, ...india, temp: powerT("kolkata"), rain: powerR("kolkata"), ...daily("kolkata_lat22.57_lon88.36", "Kolkata") },
  { id: "chennai", name: "Chennai", group: "Indian cities", lat: 13.08, lon: 80.27, ...india, temp: powerT("chennai"), rain: powerR("chennai"), ...daily("chennai_lat13.08_lon80.27", "Chennai") },
];

export const GROUPS: RegionGroup[] = ["World", "Continents", "Hotspots", "India", "Indian cities"];

export function sourceFor(region: Region, layer: Layer): Source | undefined {
  if (layer === "rainfall") return region.rain;
  if (layer === "vegetation") return region.veg;
  return region.temp;
}

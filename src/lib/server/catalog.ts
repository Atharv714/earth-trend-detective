import type { Availability, Catalog, Frequency, Theme, Variable } from "@/lib/types";
import { REGIONS, REGION_BY_ID } from "./regions";

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

export type VariableDef = Variable & {
  /** false when a % change is meaningless (°C, anomalies relative to an arbitrary zero, ...). */
  ratioScale: boolean;
};

const v = (
  id: string,
  label: string,
  unit: string,
  theme: Theme,
  definition: string,
  ratioScale = true,
): VariableDef => ({ id, label, unit, theme, definition, ratioScale });

export const VARIABLES: VariableDef[] = [
  // Heat
  v("temperature", "Air temperature", "°C", "heat", "How warm the air is about 2 metres above the ground, averaged over the month.", false),
  v("temperature_max", "Daytime high temperature", "°C", "heat", "The average of each day's hottest temperature during the month.", false),
  v("temperature_min", "Night-time low temperature", "°C", "heat", "The average of each day's coldest temperature (usually at night) during the month.", false),
  v("heatwave_days", "Heatwave days", "days/year", "heat", "How many days each year the afternoon temperature went above a dangerous threshold (40 °C by default)."),
  v("warm_nights", "Warm nights", "nights/year", "heat", "How many nights each year stayed above 25 °C, which stops people and crops from cooling down."),
  v("heat_index_days", "Dangerous 'feels-like' days", "days/year", "heat", "Days each year when heat plus humidity made it feel hotter than 41 °C (NOAA 'danger' level)."),
  v("sunlight", "Sunlight at the ground", "kWh/m²/day", "heat", "How much solar energy reaches the ground each day; haze and clouds reduce it."),
  // Water
  v("rainfall", "Rainfall", "mm/day", "water", "How much rain (and melted snow) falls, as an average depth of water per day."),
  v("extreme_rain_days", "Extreme rain days", "days/year", "water", "How many days each year had a downpour of more than 50 mm, enough to cause floods."),
  v("dry_spell", "Longest dry spell", "days", "water", "The longest run of days in each year with almost no rain (less than 1 mm)."),
  v("humidity", "Relative humidity", "%", "water", "How close the air is to being saturated with water vapour (100% = fully saturated)."),
  v("soil_wetness", "Root-zone soil wetness", "0–1", "water", "How wet the soil is where plant roots live, from 0 (bone dry) to 1 (completely soaked)."),
  v("soil_moisture", "Root-zone soil moisture", "mm", "water", "How much water is stored in the soil around plant roots, as a depth of water."),
  v("evaporation", "Evapotranspiration", "mm/day", "water", "Water that leaves the land as vapour, from soil evaporation and from plants 'breathing out'."),
  v("groundwater", "Groundwater storage", "mm", "water", "Water stored underground in aquifers, the water pumped up by wells; shown as a depth of water."),
  v("cloud_cover", "Cloud cover", "%", "water", "The share of the sky covered by clouds."),
  v("wind", "Wind speed", "m/s", "water", "How fast the wind blows about 2 metres above the ground."),
  // Air
  v("aerosol", "Aerosol optical depth (haze)", "unitless", "air", "How much smoke, dust and pollution particles block sunlight; 0.1 is clean air, above 1 is very hazy."),
  v("pm25", "PM2.5 (fine particle pollution)", "µg/m³", "air", "Tiny particles small enough to get deep into your lungs, estimated from NASA's MERRA-2 model."),
  v("carbon_monoxide", "Carbon monoxide", "×10¹⁸ molecules/cm²", "air", "A gas made by fires and burning fuel; measured by satellite as the total amount in a column of air."),
  v("methane", "Methane (mid-troposphere)", "ppbv", "air", "A powerful greenhouse gas from wetlands, farming, livestock and gas leaks; parts per billion of air."),
  // Ocean & ice
  v("sea_surface_temp", "Sea surface temperature", "°C", "ocean_ice", "How warm the top layer of the ocean is, measured by satellite during the day.", false),
  v("sea_ice", "Sea-ice cover", "%", "ocean_ice", "The share of the ocean surface in the region that is covered by floating ice."),
  v("snow", "Snow water equivalent", "mm", "ocean_ice", "How much water is locked up in the snowpack; the depth of water you'd get if it all melted."),
  v("sea_level", "Global mean sea level", "cm", "ocean_ice", "The average height of the world's oceans, compared with the 1993 average (0 cm).", false),
];

export const VARIABLE_BY_ID = new Map(VARIABLES.map((x) => [x.id, x]));

// ---------------------------------------------------------------------------
// Sources: one entry per (variable, region, dataset)
// ---------------------------------------------------------------------------

export type SourceKind = "power_monthly" | "giovanni" | "power_daily" | "pm25" | "sea_level" | "extreme";

export type SourceDef = {
  variable: string;
  region: string;
  kind: SourceKind;
  /** Short id the client can pass as ?source= to pick a specific dataset. */
  sourceId: "giovanni" | "power" | "power_daily" | "nasa_ssh";
  /** Path relative to public/trend_detective_data. For pm25: a template with {c}. */
  file: string;
  /** CSV column to read (time-based files use the second column if omitted). */
  column?: string;
  /** display = raw * scale + offset */
  scale?: number;
  offset?: number;
  /** Frequency of the file; daily files are averaged to monthly. */
  nativeFrequency: Frequency;
  /** Frequency of the series served. */
  frequency: Frequency;
  source: string;
  citation: string;
  /** For extremes: which index. */
  extremeIndex?: string;
  start: string;
  end: string;
  /** Lower = preferred when several sources exist. */
  priority: number;
};


const CITE_POWER =
  "NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science / Applied Science Program (power.larc.nasa.gov).";
const giovanniCite = (product: string) =>
  `${product}. Area-averaged time series produced with the Giovanni online data system, NASA Goddard Earth Sciences Data and Information Services Center (GES DISC).`;

const GIOVANNI_PRODUCTS: Record<
  string,
  { variable: string; source: string; product: string; scale?: number; offset?: number; start: string; end: string; daily?: boolean }
> = {
  temp: { variable: "temperature", source: "NASA MERRA-2 via Giovanni", product: "GMAO MERRA-2 M2TMNXSLV v5.12.4, 2-m air temperature", offset: -273.15, start: "1980-01", end: "2025-12" },
  rain: { variable: "rainfall", source: "NASA GPM IMERG via Giovanni", product: "GPM IMERG Final Run monthly V07 (GPM_3IMERGM)", scale: 24, start: "1998-01", end: "2025-09" },
  aod: { variable: "aerosol", source: "NASA MODIS-Aqua via Giovanni", product: "MODIS-Aqua MYD08_M3 v6.1, aerosol optical depth 550 nm (land & ocean)", start: "2002-07", end: "2025-12" },
  soil: { variable: "soil_moisture", source: "NASA GLDAS Noah via Giovanni", product: "GLDAS Noah Land Surface Model L4 monthly 0.25° v2.1, root-zone soil moisture", start: "2000-01", end: "2025-12" },
  snow: { variable: "snow", source: "NASA GLDAS Noah via Giovanni", product: "GLDAS Noah Land Surface Model L4 monthly 0.25° v2.1, snow water equivalent", start: "2000-01", end: "2025-12" },
  evap: { variable: "evaporation", source: "NASA GLDAS Noah via Giovanni", product: "GLDAS Noah Land Surface Model L4 monthly 0.25° v2.1, evapotranspiration", scale: 86400, start: "2000-01", end: "2025-12" },
  sst: { variable: "sea_surface_temp", source: "NASA MODIS-Aqua via Giovanni", product: "MODIS-Aqua L3m monthly 9 km SST (11 µm, daytime), R2019.0", start: "2002-08", end: "2025-12" },
  seaice: { variable: "sea_ice", source: "NASA MERRA-2 via Giovanni", product: "GMAO MERRA-2 M2TMNXOCN v5.12.4, ice-covered fraction of ocean", scale: 100, start: "1980-01", end: "2025-12" },
  co: { variable: "carbon_monoxide", source: "NASA Terra MOPITT via Giovanni", product: "MOPITT L3 monthly V10 (MOP03TM), daytime CO total column", scale: 1e-18, start: "2000-03", end: "2025-01" },
  ch4_500hpa: { variable: "methane", source: "NASA Aqua AIRS via Giovanni", product: "AIRS L3 monthly V006 (AIRS3STM), CH4 volume mixing ratio at 500 hPa", start: "2002-09", end: "2025-12" },
  groundwater: { variable: "groundwater", source: "NASA GLDAS CLSM via Giovanni", product: "GLDAS Catchment Land Surface Model L4 daily 0.25° v2.2, groundwater storage", start: "2003-02", end: "2025-12", daily: true },
};

/** Giovanni file region names → our region ids. */
const GIOVANNI_REGION_ALIAS: Record<string, string> = {
  andhra: "andhra_pradesh",
  himalaya: "himalaya_uttarakhand_hp",
  delhi: "delhi_ncr",
};

const GIOVANNI_FILES: Record<string, string[]> = {
  "02_india_satellite_giovanni": [
    "aod_andhra", "aod_delhi", "aod_india", "aod_punjab",
    "evap_andhra", "evap_india", "evap_punjab",
    "rain_andhra", "rain_india", "rain_northeast", "rain_punjab", "rain_rajasthan", "rain_western_ghats",
    "snow_himalaya",
    "soil_andhra", "soil_india", "soil_punjab", "soil_rajasthan",
    "temp_andhra", "temp_delhi", "temp_himalaya", "temp_india", "temp_rajasthan",
  ],
  "04_world_giovanni": [
    "aod_africa", "aod_amazon", "aod_asia", "aod_sahara", "aod_wisconsin", "aod_world",
    "ch4_500hpa_india", "ch4_500hpa_world",
    "co_africa", "co_amazon", "co_delhi", "co_india", "co_world",
    "groundwater_india", "groundwater_punjab",
    "rain_africa", "rain_amazon", "rain_asia", "rain_europe", "rain_north_america", "rain_sahara",
    "rain_south_america", "rain_wisconsin", "rain_world",
    "seaice_antarctic", "seaice_arctic",
    "sst_arabian_sea", "sst_bay_of_bengal", "sst_north_atlantic", "sst_pacific_tropics", "sst_world",
    "temp_africa", "temp_amazon", "temp_antarctic", "temp_arctic", "temp_asia", "temp_europe",
    "temp_north_america", "temp_sahara", "temp_south_america", "temp_wisconsin", "temp_world",
  ],
};

const POWER_MONTHLY_REGIONS = [
  "amaravati", "andhra_pradesh", "bengaluru", "central_india", "chennai", "delhi_ncr", "gangetic_plain",
  "himalaya_uttarakhand_hp", "kerala", "kolkata", "mumbai", "northeast", "punjab", "rajasthan", "tamil_nadu",
  "western_ghats",
];

/** POWER column → variable, with first available month. */
export const POWER_COLUMNS: Record<string, { variable: string; start: string; community: "AG" | "RE" }> = {
  T2M: { variable: "temperature", start: "1981-01", community: "AG" },
  T2M_MAX: { variable: "temperature_max", start: "1981-01", community: "AG" },
  PRECTOTCORR: { variable: "rainfall", start: "1981-01", community: "AG" },
  GWETROOT: { variable: "soil_wetness", start: "1981-01", community: "AG" },
  RH2M: { variable: "humidity", start: "1981-01", community: "AG" },
  AOD_55: { variable: "aerosol", start: "2001-01", community: "RE" },
  ALLSKY_SFC_SW_DWN: { variable: "sunlight", start: "1984-01", community: "RE" },
  CLOUD_AMT: { variable: "cloud_cover", start: "1984-01", community: "RE" },
  WS2M: { variable: "wind", start: "1981-01", community: "AG" },
};

/** Daily file location id → file name. */
export const DAILY_FILES: Record<string, string> = {
  amaravati: "amaravati_lat16.51_lon80.52.csv",
  bengaluru: "bengaluru_lat12.97_lon77.59.csv",
  central_nagpur: "central_nagpur_lat21.15_lon79.09.csv",
  chennai: "chennai_lat13.08_lon80.27.csv",
  delhi_ncr: "delhi_ncr_lat28.61_lon77.21.csv",
  gangetic_patna: "gangetic_patna_lat25.59_lon85.14.csv",
  himalaya_dehradun: "himalaya_dehradun_lat30.32_lon78.03.csv",
  kerala_kochi: "kerala_kochi_lat9.93_lon76.27.csv",
  kolkata: "kolkata_lat22.57_lon88.36.csv",
  mumbai: "mumbai_lat19.07_lon72.88.csv",
  northeast_guwahati: "northeast_guwahati_lat26.14_lon91.74.csv",
  punjab_ludhiana: "punjab_ludhiana_lat30.9_lon75.85.csv",
  rajasthan_jodhpur: "rajasthan_jodhpur_lat26.24_lon73.02.csv",
  tamilnadu_madurai: "tamilnadu_madurai_lat9.93_lon78.12.csv",
  western_ghats_mahabaleshwar: "western_ghats_mahabaleshwar_lat17.92_lon73.66.csv",
};

/** Extreme-index variable → index id + default threshold. */
export const EXTREME_VARIABLES: Record<string, { index: string; threshold: number }> = {
  heatwave_days: { index: "heatwave_days", threshold: 40 },
  warm_nights: { index: "warm_nights", threshold: 25 },
  extreme_rain_days: { index: "extreme_rain_days", threshold: 50 },
  dry_spell: { index: "max_dry_spell", threshold: 1 },
  heat_index_days: { index: "heat_index", threshold: 41 },
};

function buildSources(): SourceDef[] {
  const out: SourceDef[] = [];

  for (const [folder, files] of Object.entries(GIOVANNI_FILES)) {
    for (const name of files) {
      const prefix = Object.keys(GIOVANNI_PRODUCTS)
        .sort((a, b) => b.length - a.length)
        .find((p) => name.startsWith(p + "_"))!;
      const p = GIOVANNI_PRODUCTS[prefix];
      const rawRegion = name.slice(prefix.length + 1);
      const region = GIOVANNI_REGION_ALIAS[rawRegion] ?? rawRegion;
      out.push({
        variable: p.variable,
        region,
        kind: "giovanni",
        sourceId: "giovanni",
        file: `${folder}/${name}.csv`,
        scale: p.scale,
        offset: p.offset,
        nativeFrequency: p.daily ? "daily" : "monthly",
        frequency: "monthly",
        source: p.source,
        citation: giovanniCite(p.product),
        start: p.start,
        end: p.end,
        priority: 1,
      });
    }
  }

  // PM2.5 total from MERRA-2 components
  for (const r of ["delhi", "india", "world"]) {
    out.push({
      variable: "pm25",
      region: GIOVANNI_REGION_ALIAS[r] ?? r,
      kind: "pm25",
      sourceId: "giovanni",
      file: `04_world_giovanni/pm25_{c}_${r}.csv`,
      nativeFrequency: "monthly",
      frequency: "monthly",
      source: "NASA MERRA-2 via Giovanni",
      citation: giovanniCite(
        "GMAO MERRA-2 M2TMNXAER v5.12.4 surface mass concentrations; PM2.5 = dust2.5 + seasalt2.5 + BC + 1.4·OC + 1.375·SO4",
      ),
      start: "1980-01",
      end: "2025-12",
      priority: 1,
    });
  }

  for (const region of POWER_MONTHLY_REGIONS) {
    for (const [col, info] of Object.entries(POWER_COLUMNS)) {
      out.push({
        variable: info.variable,
        region,
        kind: "power_monthly",
        sourceId: "power",
        file: `01_india_monthly_nasa_power/${region}.csv`,
        column: col,
        nativeFrequency: "monthly",
        frequency: "monthly",
        source: "NASA POWER",
        citation: CITE_POWER,
        start: info.start,
        end: "2025-12",
        priority: 2,
      });
    }
  }

  for (const [region, file] of Object.entries(DAILY_FILES)) {
    const daily = (variable: string, column: string, priority: number) =>
      out.push({
        variable,
        region,
        kind: "power_daily",
        sourceId: "power_daily",
        file: `03_india_daily_nasa_power/${file}`,
        column,
        nativeFrequency: "daily",
        frequency: "monthly",
        source: "NASA POWER (daily, averaged to monthly)",
        citation: CITE_POWER,
        start: "1981-01",
        end: "2025-12",
        priority,
      });
    daily("temperature_min", "T2M_MIN", 2);
    // Daily-only locations get the basic monthly variables from their daily file.
    if (!POWER_MONTHLY_REGIONS.includes(region)) {
      daily("temperature", "T2M", 3);
      daily("temperature_max", "T2M_MAX", 3);
      daily("rainfall", "PRECTOTCORR", 3);
      daily("humidity", "RH2M", 3);
    }
    for (const [variable, ex] of Object.entries(EXTREME_VARIABLES)) {
      out.push({
        variable,
        region,
        kind: "extreme",
        sourceId: "power_daily",
        file: `03_india_daily_nasa_power/${file}`,
        nativeFrequency: "daily",
        frequency: "annual",
        source: "NASA POWER daily (index computed per year)",
        citation: CITE_POWER,
        extremeIndex: ex.index,
        start: "1981",
        end: "2025",
        priority: 2,
      });
    }
  }

  out.push({
    variable: "sea_level",
    region: "world",
    kind: "sea_level",
    sourceId: "nasa_ssh",
    file: "05_global_sea_level/NASA_SSH_GMSL_INDICATOR.txt",
    nativeFrequency: "daily",
    frequency: "monthly",
    source: "NASA-SSH satellite altimetry (PO.DAAC)",
    citation:
      "NASA-SSH Global Mean Sea Level Indicator, NASA Physical Oceanography DAAC, doi:10.5067/NSIND-GMSV1. Monthly means of ~weekly values; 0 cm = 1993 mean.",
    start: "1993-01",
    end: "2026-11",
    priority: 1,
  });

  return out;
}

export const SOURCES: SourceDef[] = buildSources();

export function findSource(variable: string, region: string, sourceId?: string): SourceDef | undefined {
  return SOURCES.filter(
    (s) => s.variable === variable && s.region === region && (!sourceId || s.sourceId === sourceId),
  ).sort((a, b) => a.priority - b.priority)[0];
}

export function getCatalog(): Catalog {
  const availability: Availability[] = SOURCES.map((s) => ({
    variable: s.variable,
    region: s.region,
    source: s.sourceId,
    frequency: s.frequency,
    start: s.start,
    end: s.end,
  }));
  const usedRegions = new Set(SOURCES.map((s) => s.region));
  return {
    variables: VARIABLES.map(({ ratioScale: _r, ...rest }) => rest),
    regions: REGIONS.filter((r) => usedRegions.has(r.id)),
    availability,
  };
}

export { REGION_BY_ID };

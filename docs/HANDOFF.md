# HANDOFF: NASA Space Apps 2026 · "Be An Earth System Trend Detective!"

Read this first. It is the single source of truth for the project as of 14 Nov 2026. Team split: **Atharv = frontend, Medhu = backend.** Both work in this repo (Next.js) with Claude threads in T3 Code. If anything in code disagrees with this doc, update the doc.

## 0. TL;DR

- **Challenge:** build a tool that lets anyone pick an Earth variable + a region + a time range, see the time series, and get told what is changing, where, how much, and whether it is statistically significant (p < 0.05).
- **Data is done.** 113 CSVs (~23 MB, including two `_index.csv` files) are committed at `public/trend_detective_data/`. India in depth (monthly + daily), world/continents/oceans, sea level. Everything is real NASA data.
- **Any other region** (e.g. a judge types "Brazil") is fetched live from the NASA POWER API. No login needed.
- **Stack:** one Next.js 16 repo using the `src/` layout. Frontend = pages and components under `src/app` and `src/components`. Backend = Next.js Route Handlers under `src/app/api/*` (TypeScript), doing data loading, unit conversion, live fetch, and the trend statistics.
- **Win condition:** judges must see depth. The core 5 steps are table stakes; the extras in §6 are what win.

## 1. The challenge (what judges will check)

Source: challenge page + the author's video (Dr. James Acker, NASA Goddard, the challenge author).

The 5 steps the app must support (straight from the author's video):

1. Decide on the data variable(s).
2. Choose a region, which can be the entire world.
3. Select the time period.
4. Create the time series and examine it. Does it look like a trend?
5. Analyze the trend for significance.

Rules and hints from the brief:

| Point | What it means for us |
|---|---|
| "A response that does both the visualization and the analysis meets the full scope" | Chart + significance test = minimum viable submission |
| Linear trends are enough; complex/non-linear is out of scope | Linear slope + Mann-Kendall is perfect |
| Significance via t-test, Mann-Kendall, or confidence intervals | We use Mann-Kendall + Sen's slope (+ optional OLS t-test) |
| Monthly/daily data are easiest | Our data is monthly (some daily) |
| Seasonal cycles can hide trends | Offer "remove seasonal cycle" (anomalies) and a per-season filter |
| A trend can be interesting even if not significant; a longer series may make it significant | Show non-significant trends honestly with that explanation |
| Same variable can trend opposite ways in different regions, even from the same process | Highlight this. Very few teams will (see §6) |
| Audience: high school/college students + public with some science background | Plain-language definitions for every variable |
| Suggested approach: short series of questions → app suggests variables; demo examples users can watch; AI ("SI") to suggest variables for a region type | Guided "detective mode", demo cases, AI suggester |
| Author's own worked example: MODIS-Aqua aerosol optical depth over Wisconsin, monthly since 2002, maybe rising in summer due to Canadian wildfire smoke | We have `aod_wisconsin.csv`. Reproduce it in the app, since judges who saw the video will recognise it |
| Author's p-value rule: p < 0.05 = significant | Use exactly this wording in the UI |

**Competition context (Amaravati local event):** 100 teams total; only 5 chose this challenge (Alpha Techies, Cosmic, NASAX, OCEANS, Tapu Sena), so it is one of the least crowded.

**What judges reward (our read from past experience):** visible complexity, a story they feel, and many features. If a judge thinks "ye toh ban jayega" (anyone could build this), we lose regardless of what is under the hood. Every hard thing we do must be visible on screen.

## 2. Data inventory

All data lives at `public/trend_detective_data/` and is served by Next.js at `/trend_detective_data/...`. Every folder has its own `README.txt`; the top-level `README.md` maps themes to files.

### 2.1 Folder overview

| Folder | Contents | Time | Format |
|---|---|---|---|
| `01_india_monthly_nasa_power/` | 16 Indian regions/cities × 9 variables | monthly 1981-01 → 2025-12 | one wide CSV per region |
| `02_india_satellite_giovanni/` | 26 series: MODIS aerosol, GPM rain, MERRA-2 temp, GLDAS soil/snow/evap for 8 Indian regions | monthly, varies (see below) | one CSV per series, `time,<VAR_ID>` |
| `03_india_daily_nasa_power/` | 15 locations, daily mean/max/min temp, rain, humidity | daily 1981-01-01 → 2025-12-31 | one wide CSV per location |
| `04_world_giovanni/` | 65 series: world, continents, poles, Amazon, Sahara, Wisconsin, oceans, air composition, groundwater | monthly (groundwater daily) | one CSV per series, `time,<VAR_ID>` |
| `05_global_sea_level/` | NASA-SSH global mean sea level | ~weekly 1993 → Nov 2026 | text file with `HDR` header lines |
| `06_vegetation_land_temp_gibs/` | NDVI and EVI (plant greenness) for 32 regions, our own averages of NASA GIBS MODIS imagery | monthly 2000-03 → 2025-12 (2025-04 missing) | one CSV per region, `time,<NDVI|EVI>,valid_pixels,area_coverage` |
| `07_grace/` | GRACE/GRACE-FO water stored on land (groundwater + soil + snow + surface water), **every land area on Earth**, 1° grid, 22,794 cells | monthly 2002-04 → 2026-09 (259 months; gaps, incl. 2017-07 → 2018-05 between missions) | `grace.bin` (int16 mm) + `meta.json`, see §2.6c |

Original NetCDF files are in `netcdf_originals/` subfolders (for provenance only; the app should not need them).

### 2.2 `01_india_monthly_nasa_power/`

Wide CSV, header: `date,T2M,T2M_MAX,PRECTOTCORR,GWETROOT,RH2M,AOD_55,ALLSKY_SFC_SW_DWN,CLOUD_AMT,WS2M`. `date` = `YYYY-MM`. Blank cell = not available for that month.

| Column | Meaning | Unit | Starts |
|---|---|---|---|
| T2M | mean air temperature at 2 m | °C | 1981 |
| T2M_MAX | max daily temperature in the month | °C | 1981 |
| PRECTOTCORR | precipitation (bias-corrected) | mm/day | 1981 |
| GWETROOT | root-zone soil wetness (0 dry → 1 saturated) | 0–1 | 1981 |
| RH2M | relative humidity | % | 1981 |
| AOD_55 | aerosol optical depth 550 nm (smoke/dust/haze) | unitless | 2001 |
| ALLSKY_SFC_SW_DWN | sunlight reaching the ground | kWh/m²/day | 1984 |
| CLOUD_AMT | cloud cover | % | 1984 |
| WS2M | wind speed at 2 m | m/s | 1981 |

Files (region averages over a box, or a single city point):

- **Regions** (box `lat_min,lat_max,lon_min,lon_max`): punjab 29.5,32.5,73.9,76.9 · rajasthan 24.5,30,69.5,76.5 · gangetic_plain 24,28,80,88 · himalaya_uttarakhand_hp 29.5,33,76.5,80.5 · northeast 22,29,89.5,97 · western_ghats 10,16,73,77 · andhra_pradesh 13,19.5,77,84.5 · kerala 8,12.5,74.8,77.5 · central_india 20,25,76,83 · tamil_nadu 8,13.5,76.5,80.5
- **City points** (lat,lon): delhi_ncr 28.61,77.21 · mumbai 19.07,72.88 · amaravati 16.51,80.52 · bengaluru 12.97,77.59 · kolkata 22.57,88.36 · chennai 13.08,80.27

### 2.3 `02_india_satellite_giovanni/`

CSV `time,<VAR_ID>`, `time` = `YYYY-MM`.

| Prefix | Giovanni VAR_ID | Meaning | Raw unit → display | Range | Regions |
|---|---|---|---|---|---|
| `aod_` | MYD08_M3_6_1_Aerosol_Optical_Depth_Land_Ocean_Mean_Mean | MODIS-Aqua aerosol optical depth | unitless | 2002-07 → 2025-12 | delhi, punjab, india, andhra |
| `rain_` | GPM_3IMERGM_07_precipitation | GPM IMERG rainfall | mm/hr → ×24 = mm/day | 1998-01 → 2025-09 | india, western_ghats, rajasthan, northeast, andhra, punjab, kerala, central_india, gangetic_plain |
| `temp_` | M2TMNXSLV_5_12_4_T2M | MERRA-2 air temperature | K → −273.15 = °C | 1980-01 → 2025-12 | india, delhi, rajasthan, himalaya, andhra |
| `soil_` | GLDAS_NOAH025_M_2_1_RootMoist_inst | GLDAS root-zone soil moisture | kg/m² (= mm water) | 2000-01 → 2025-12 | india, punjab, rajasthan, andhra |
| `snow_` | GLDAS_NOAH025_M_2_1_SWE_inst | GLDAS snow water equivalent | kg/m² (= mm water) | 2000-01 → 2025-12 | himalaya |
| `evap_` | GLDAS_NOAH025_M_2_1_Evap_tavg | GLDAS evapotranspiration | kg/m²/s → ×86400 = mm/day | 2000-01 → 2025-12 | india, andhra, punjab |

Boxes (`lon_min,lat_min,lon_max,lat_max`): india 68,6,98,37 (includes parts of neighbours and ocean) · delhi 76.8,28.4,77.4,28.9 · punjab 73.9,29.5,76.9,32.5 · rajasthan 69.5,24.5,76.5,30 · western_ghats 73,10,77,16 · himalaya 76.5,29.5,80.5,33 · andhra 77,13,84.5,19.5 · northeast 89.5,22,97,29.

`_index.csv` lists file, VAR_ID, start, end, count, units, long name.

### 2.4 `03_india_daily_nasa_power/`

Header `date,T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M`. `date` = `YYYY-MM-DD`; 16,436 rows each; °C, mm/day, %. Lat/lon in the file name.

Locations: amaravati, bengaluru, central_nagpur, chennai, delhi_ncr, gangetic_patna, himalaya_dehradun, kerala_kochi, kolkata, mumbai, northeast_guwahati, punjab_ludhiana, rajasthan_jodhpur, tamilnadu_madurai, western_ghats_mahabaleshwar.

Use these for derived "extreme" indices (backend computes per year):

- **Heatwave days:** days with T2M_MAX > 40 °C (or > 45)
- **Warm nights:** days with T2M_MIN > 25 °C (or the annual mean T2M_MIN)
- **Extreme rain days:** days with PRECTOTCORR > 50 mm (or > 100 mm)
- **Longest dry spell:** longest run of days with rain < 1 mm (per monsoon season or year)
- **Heat index ("feels like"):** from T2M + RH2M (standard NOAA formula)

### 2.5 `04_world_giovanni/`

CSV `time,<VAR_ID>`.

| Prefix | Meaning | Raw unit → display | Range | Regions |
|---|---|---|---|---|
| `temp_` | MERRA-2 air temp | K → °C | 1980-01 → 2025-12 | world, asia, africa, europe, north_america, south_america, australia, arctic, antarctic, siberia, middle_east, amazon, sahara, wisconsin |
| `rain_` | GPM IMERG rain | mm/hr ×24 → mm/day | 1998-01 → 2025-09 | world, asia, africa, europe, north_america, south_america, australia, amazon, sahara, wisconsin, east_africa, mediterranean, southeast_asia, us_southwest |
| `aod_` | MODIS-Aqua aerosol | unitless | 2002-07 → 2025-12 | world, asia, africa, amazon, sahara, wisconsin |
| `sst_` | MODIS-Aqua sea surface temp (day) | °C | 2002-08 → 2025-12 | world, bay_of_bengal, arabian_sea, north_atlantic, pacific_tropics |
| `seaice_` | MERRA-2 sea-ice fraction of ocean | 0–1 (×100 = %) | 1980-01 → 2025-12 | arctic, antarctic |
| `co_` | MOPITT carbon monoxide total column | mol/cm² | 2000-03 → 2025-01 | world, india, delhi, amazon, africa |
| `ch4_500hpa_` | AIRS methane at 500 hPa | ppbv | 2002-09 → 2025-12 | world, india |
| `pm25_bc_`, `pm25_oc_`, `pm25_dust_`, `pm25_seasalt_`, `pm25_so4_` | MERRA-2 surface PM2.5 components | kg/m³ → ×1e9 = µg/m³ | 1980-01 → 2025-12 | world, india, delhi |
| `groundwater_` | GLDAS CLSM groundwater storage | mm | daily 2003-02-01 → 2025-12-31 | india, punjab |

**PM2.5 total** (standard MERRA-2 formula): `PM2.5 = dust25 + seasalt25 + bc + 1.4·oc + 1.375·so4` (all in the same unit; convert to µg/m³ after).

Boxes (`lon_min,lat_min,lon_max,lat_max`): world -180,-90,180,90 · asia 60,5,150,55 · africa -20,-35,52,37 · europe -10,35,40,70 · north_america -170,15,-50,72 · south_america -82,-56,-34,13 · arctic -180,66.5,180,90 · antarctic -180,-90,180,-60 · amazon -75,-15,-45,5 · sahara -15,15,35,30 · wisconsin -92.9,42.5,-86.8,47.1 · india 68,6,98,37 · delhi 76.8,28.4,77.4,28.9 · punjab 73.9,29.5,76.9,32.5 · bay_of_bengal 80,10,95,22 · arabian_sea 55,8,75,22 · north_atlantic -60,20,-10,60 · pacific_tropics -180,-10,-80,10

### 2.6 `05_global_sea_level/NASA_SSH_GMSL_INDICATOR.txt`

Lines starting `HDR` are header. Data rows are whitespace-separated: `year_fraction  GMSL_cm  GMSL_cm_60day_smoothed`. Missing flag `9.96921E36`. Zero = 1993 mean. ~1,755 rows, 1993 → Nov 2026, about +11.5 cm. Global only (no per-city sea level).

### 2.6b `06_vegetation_land_temp_gibs/`

`ndvi_<region>.csv` and `evi_<region>.csv`, 32 regions each (same boxes as 02/04, plus borneo, congo, sahel, china, siberia, australia, middle_east, mediterranean, east_africa, southeast_asia, us_southwest, kerala, central_india, gangetic_plain; see the folder README). GIBS has no numeric download, so each value is a cos(latitude)-weighted mean of GIBS tile pixels turned back into NDVI with NASA's colormap. **Not an official NASA area average;** say so to judges. Arctic has no December (polar night); `annualize` in `src/lib/series.ts` leaves out months a record never has. Land surface temperature was extracted but left out on purpose (Terra orbit drift fakes a cooling after ~2020). Region-wide Amazon and Borneo are about flat; do not claim "the Amazon is browning".

### 2.7 Theme → data map (the 8 themes we pitch)

| Theme | Files | Status |
|---|---|---|
| Global warming | 01 T2M/T2M_MAX, 02 `temp_`, 03 daily, 04 `temp_` | ✅ |
| Rainfall variability | 01 PRECTOTCORR, 02 `rain_`, 03 daily rain, 04 `rain_` | ✅ |
| Soil moisture & drought | 01 GWETROOT, 02 `soil_`/`evap_`, 04 `groundwater_*` | ✅ |
| Ocean warming | 04 `sst_*` | ✅ |
| Glacier & ice | 02 `snow_himalaya`, 04 `seaice_*` | 🟡 (no glacier mass) |
| Sea level rise | 05 | 🟡 (global only) |
| Atmospheric composition | 01 AOD_55, 02/04 `aod_`, 04 `co_`, `ch4_`, `pm25_` | ✅ |
| Deforestation / vegetation | 06 `ndvi_*`, `evi_*` | ✅ greening trends (India farmland, China, Sahel); deforestation itself is too local to show in big boxes |

## 3. Live data (any region on Earth): NASA POWER

Giovanni cannot be used live (needs login, has a queue of minutes). NASA POWER can: no login, fast, CORS-enabled, works from the browser or from a server route.

Endpoints we verified:

- **Monthly, single point, many params in one call:**
  `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,T2M_MAX,PRECTOTCORR,GWETROOT,RH2M,WS2M&community=AG&latitude=-10&longitude=-55&start=1981&end=2025&format=JSON`
- **Monthly, single point, RE community params:**
  `...&parameters=AOD_55,ALLSKY_SFC_SW_DWN,CLOUD_AMT&community=RE...`
- **Monthly, regional box (grid of cells), ONE param per call:**
  `https://power.larc.nasa.gov/api/temporal/monthly/regional?parameters=T2M&community=AG&latitude-min=20&latitude-max=30&longitude-min=70&longitude-max=80&start=1981&end=2025&format=JSON`
- **Daily, point:**
  `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M&community=AG&latitude=28.61&longitude=77.21&start=19810101&end=20251231&format=JSON`

Gotchas we hit:

- Regional box must be ≥ 2° in both lat and lon (smaller → HTTP 422, use the point endpoint). 10°×10° worked; larger boxes not tested.
- Regional = 1 parameter per request. Point = many parameters per request.
- Missing values are `-999`. Drop them.
- Monthly responses include a 13th "month" key per year (`YYYY13` = annual value). Filter to months 01–12.
- Point response shape: `properties.parameter.<PARAM>.<YYYYMM> = value`. Regional: `features[]`, each with the same `properties.parameter` shape → average across features.
- AOD_55 data starts 2001; sunlight and cloud start 1984.

**Strategy for big regions** (e.g. Brazil ~40°×40°): sample ~16–25 grid points inside the bounding box with the point endpoint (all params per call, in parallel), then average. ~5–10 s. The alternative (tiling 10° boxes) is slower. For World/continents/poles, use the pre-downloaded Giovanni files instead.

**Place name → bounding box:** use OpenStreetMap Nominatim (`https://nominatim.openstreetmap.org/search?q=Brazil&format=json&limit=1` → `boundingbox`), or ship a static country-bbox JSON (safer for the demo: no rate limits, no network risk).

### 2.6c `07_grace/` (groundwater anywhere)

Why it exists: the ready records only had groundwater for India and Punjab (GLDAS, a model), so the detective could not answer groundwater questions anywhere else. The fix is NASA's GRACE satellites: JPL mascon RL06.3 v04 with the CRI filter (PO.DAAC `TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4`, CMR `C3195527175-POCLOUD`). It needs an **Earthdata login**, which is why it was not in the first download. The token is `EARTHDATA_TOKEN` in `.env`.

- Raw file: `GRCTellus.JPL.200204_202609.GLO.RL06.3M.MSCNv04CRI.nc` (46 MB), saved as `data-raw/grace_mascon.nc` (git-ignored). Download with `curl -L -H "Authorization: Bearer $EARTHDATA_TOKEN" -o data-raw/grace_mascon.nc https://archive.podaac.earthdata.nasa.gov/podaac-ops-cumulus-protected/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4/GRCTellus.JPL.200204_202609.GLO.RL06.3M.MSCNv04CRI.nc`.
- `python3 -I scripts/grace-to-grid.py data-raw/grace_mascon.nc` (needs `h5py`, `numpy`) applies JPL's CRI scale factors, averages 0.5° → 1°, drops ocean, and writes `grace.bin` (12 MB: int16 mm, cell-major, `-32768` = missing) and `meta.json` (months, cell centres). GRACE resolves about 300 km, so 1° loses nothing.
- Values are **anomalies** in mm of water against the 2004–2009 mean, so "% per decade" is meaningless; use mm/decade and km³/year. GRACE weighs the whole water column: in dry or irrigated plains a long decline is mostly groundwater, elsewhere soil and snow matter too.
- Sanity numbers: Punjab (3° box) −337 mm/decade, about −3.2 km³ of water a year since 2002; India (inside its border) −41 mm/decade, with gains in the south and west and losses in the north-west, north and north-east.

## 4. Architecture

```
Next.js app (one repo, src/ layout)
├── public/trend_detective_data/   ← static CSVs (done)
├── src/app/                       ← FRONTEND (Atharv)
│   ├── page.tsx                   landing + "Start investigating"
│   ├── explore/                   pick variable / region / time → chart + verdict
│   ├── cases/                     demo stories (Wisconsin, Delhi smog, Arctic ice…)
│   ├── map/                       trend map (India + world)
│   └── about/                     methods, data sources, citations
├── src/app/api/                   ← BACKEND (Medhu), Next.js Route Handlers (TypeScript)
│   ├── catalog/route.ts
│   ├── series/route.ts
│   ├── trend/route.ts
│   ├── live/route.ts
│   ├── extremes/route.ts
│   ├── compare/route.ts
│   ├── explain/route.ts           (optional, LLM)
│   └── chat/route.ts              the detective chat (built, see §8)
├── src/components/                ← shared UI (Atharv)
└── src/lib/                       ← types.ts (shared), catalog.ts, stats.ts, loaders (Medhu)
```

The `@/*` import alias maps to `./src/*` (e.g. `import type { Series } from "@/lib/types"`). `public/` and config files stay at the repo root.

**Why Route Handlers rather than a separate Python service:** one deploy, one repo, no CORS, and the stats needed (Mann-Kendall, Sen's slope, OLS) are ~100 lines of TS. If the backend owner strongly prefers Python, a small FastAPI service is fine, but then keep the API contract in §5 identical so the frontend does not care.

Backend reads CSVs from disk (`fs` + `path.join(process.cwd(), 'public', 'trend_detective_data', ...)`) and caches the parsed result in memory. Do the unit conversions in the backend so the frontend always receives display-ready units.

> This is Next.js 16. Before writing Route Handlers or pages, read the relevant guide in `node_modules/next/dist/docs/` (see `AGENTS.md`); APIs differ from older versions.

## 5. API contract (frontend ⇄ backend)

Agree on this before writing code. All responses JSON. Errors: `{ "error": "message" }` with 4xx/5xx.

### 5.1 Shared types (put in `src/lib/types.ts`, used by both sides)

```ts
export type Point = { t: string; v: number };          // t = "YYYY-MM" (or "YYYY-MM-DD" for daily, "YYYY" for annual)

export type SeriesMeta = {
  variable: string;        // our id, e.g. "temperature"
  label: string;           // "Air temperature"
  unit: string;            // display unit, e.g. "°C"
  region: string;          // region id, e.g. "arctic"
  regionLabel: string;     // "Arctic"
  source: string;          // "NASA MERRA-2 via Giovanni" | "NASA POWER (live)" | ...
  frequency: "daily" | "monthly" | "annual";
  start: string; end: string;
  citation: string;
};

export type Series = { meta: SeriesMeta; points: Point[] };

export type TrendResult = {
  n: number;
  method: "mann-kendall+sen";
  slopePerYear: number;
  slopePerDecade: number;            // headline number
  changeOverPeriod: number;          // slope × years, in display unit
  percentChangeOverPeriod: number | null;  // null when mean ≈ 0 (e.g. anomalies)
  pValue: number;
  significant: boolean;              // pValue < 0.05
  direction: "increasing" | "decreasing" | "no trend";
  tau: number;                       // Kendall's tau
  ci95PerDecade?: [number, number];  // optional, Sen slope CI
  fitLine: Point[];                  // two points (start, end) for drawing the trend line
  verdict: string;                   // plain English, e.g. "Rising 0.31 °C per decade, statistically significant (p = 0.001)."
};
```

### 5.2 Endpoints

| Method & path | Query / body | Returns | Notes |
|---|---|---|---|
| `GET /api/catalog` | none | `{ variables: Variable[], regions: Region[], availability: {variable, region, source, start, end}[] }` | Drives every dropdown. `Variable` includes id, label, unit, theme, definition (one plain sentence for students). `Region` includes id, label, bbox, type: `"city" \| "region" \| "continent" \| "ocean" \| "global"` |
| `GET /api/series` | `variable`, `region`, `start?`, `end?`, `season?` (all/DJF/MAM/JJA/SON/monsoon=JJAS), `agg?` (monthly/annual), `deseasonalize?` (bool) | `Series` | Loads from the CSVs, converts units, filters, aggregates |
| `POST /api/trend` | body: `Series` or `{ points }` | `TrendResult` | Pure stats; keeps the frontend free of math |
| `GET /api/live` | `variable`, (`lat` & `lon`) or (`bbox`) or `q` (place name), `start?`, `end?` | `Series` | NASA POWER live fetch; sampling strategy in §3; cache results in memory |
| `GET /api/extremes` | `location`, `index` (heatwave_days / warm_nights / extreme_rain_days / max_dry_spell / heat_index), `threshold?` | `Series` (annual) | From the daily CSVs |
| `GET /api/compare` | `variable`, `regions=a,b,c` | `{ series: Series[], trends: TrendResult[] }` | Powers "same cause, opposite trend" |
| `POST /api/explain` (optional) | `{ meta, trend }` | `{ text }` | LLM writes a 3–4 sentence student-friendly explanation; needs an API key in env (Azure OpenAI works). Never call the LLM from the browser. |

**Shortcut if time is short:** `/api/series` can return the trend inline (`{ ...Series, trend: TrendResult }`) so the frontend makes one call.

### 5.3 Variable id → data source mapping (backend owns this table)

Suggested ids: `temperature`, `temperature_max`, `temperature_min`, `rainfall`, `soil_moisture`, `humidity`, `aerosol`, `sunlight`, `cloud_cover`, `wind`, `snow`, `evaporation`, `sea_surface_temp`, `sea_ice`, `carbon_monoxide`, `methane`, `pm25`, `groundwater`, `sea_level`, `heatwave_days`, `warm_nights`, `extreme_rain_days`, `dry_spell`.

Priority when several sources exist for the same variable + region: NASA satellite/model file (02/04) > POWER file (01) > POWER live. Always put the real source in `meta.source`.

## 6. Features: priority order

**P0, must work (meets the brief):**

1. Pick variable → region → time range → see the time series chart.
2. Trend line + slope per decade + p-value + "significant / not significant" verdict in plain English.
3. Works for any region: preset regions (files) + live POWER for any point or bbox.
4. Variable definitions in one sentence each.
5. Data source + citation shown for every chart.

**P1, strongly visible wins:**

6. **Guided detective mode:** 2–3 questions ("Where?", "What worries you: heat, water, air, ice?") → app suggests variables and runs them. The brief literally suggests this.
7. **Demo cases** (one click each):
   - Wisconsin wildfire smoke: `aod_wisconsin`, summer months only. The author's own example.
   - Is the Arctic melting?: `seaice_arctic` + `temp_arctic`
   - Delhi's air: `aod_delhi` + PM2.5 total for Delhi
   - Global sea level: 1993→2026, ~+11.5 cm
   - India heatwaves: heatwave days per year at Delhi/Jodhpur from daily data
   - Punjab groundwater: `groundwater_punjab`
8. **Remove seasonal cycle** toggle + season filter (summer-only trends, monsoon-only). The brief mentions both.
9. **"Not significant yet" explanation:** show how many more years the trend would need. Optional but impressive.

**P2, the "this team thought deeper" features:**

10. **Same cause, opposite trend:** one map/panel comparing the same variable across regions with up/down arrows (rain: Western Ghats vs Rajasthan vs Northeast; temperature: Arctic vs world). The brief's background highlights this exact idea.
11. **Trend map:** India + world markers coloured red/blue by slope, size by significance.
12. **AI explanation** of each result ("why might this be happening?"), clearly labelled as AI.
13. **Linked clues:** show two related variables together, e.g. soil moisture down + groundwater down + rain flat → "over-pumping, not less rain".

**P3, only if everything else is solid:** "Since you were born" mode (enter birth year → changes since then), export chart/CSV, share link.

**Explicitly out of scope:** per-city sea level, non-linear trend models.

## 7. Statistics spec (backend)

- **Input:** ordered points, monthly or annual. Drop NaNs. Require n ≥ 10 (else return `direction: "no trend"` and a message).
- **Deseasonalize (option):** for monthly data, subtract each calendar month's long-term mean → anomalies. Recommended default on for monthly trend tests (seasonal cycle inflates variance; plain Mann-Kendall assumes no seasonality).
- **Mann-Kendall test:** S statistic, variance with tie correction, Z with continuity correction, two-sided p from the normal CDF. Kendall's tau = S / (n(n−1)/2).
- **Sen's slope:** median of all pairwise slopes (v_j − v_i)/(t_j − t_i), with time in years (monthly: year + (month−0.5)/12). Report per decade = ×10.
- **Optional:** OLS slope + t-test p-value as a second opinion (the author mentions t-tests).
- **Significance:** p < 0.05, exactly the author's rule.
- **Percent change:** slope × years / |mean of first 5 years| × 100. Skip (`null`) when working with anomalies or when the mean ≈ 0.
- **Annual aggregation:** mean for state variables (temperature, soil, AOD, SST, sea ice), sum ×days for rain if showing mm/year. Require ≥ 10 of 12 months to keep a year.
- **Verdict text template:** "{Variable} in {Region} is {rising/falling} by {x} {unit} per decade ({start}–{end}). This trend is {statistically significant (p = …) / not statistically significant (p = …), so it may need a longer record}."
- **Sanity check before demo:** global temperature should show a significant warming trend; Arctic sea ice a significant decline; global sea level a strong rise. If any of these fail, there is a bug (units, sorting, or time axis).

## 8. Frontend notes (Atharv)

**Built so far (14 Nov):** a full-screen globe for picking a place, and an analysis report for the place you pick. The globe only chooses; the report answers the question. Style: Apple's restraint (one dark glass material, system font, one accent), not a macOS costume.
- **Globe engine:** CesiumJS 1.147 (`cesium` npm package) with NASA GIBS map tiles; no Cesium ion account or token. The prebuilt `Cesium.js` is copied to `public/cesium/` by `npm install` (`postinstall` → `scripts/copy-cesium.mjs`; the folder is git-ignored and ESLint skips it) and loaded with a script tag in `src/lib/cesium.ts`, so Turbopack does not bundle ~2000 modules. Globe: `src/components/globe/CesiumGlobe.tsx`.
- **Imagery** (`src/lib/gibs.ts`): GIBS WMTS in EPSG:4326 (covers the poles). Base = Blue Marble; one overlay = borders (the place-name layer was dropped to halve tile traffic). GIBS tiles are 512 px and level 0 is two 288° tiles, so the tiling scheme rectangle is −180, −198, 396, 90.
- **Home view:** eight question tabs (Temperature / Rainfall / Vegetation / Air / Drought / Groundwater / Sea ice / Sea level), "Start with a story" (the six demo cases from `src/lib/cases.ts`, one click each), the place list (`src/components/shell/Panel.tsx`, search with ⌘K) and a dot per place coloured by its full-record trend per decade; grey = not significant. The list and the globe only show places that have a record for the current question. Colour key bottom right. After 3 quiet seconds on the home view the Earth turns slowly west to east (one turn in about two minutes); any click, drag, scroll or key stops it, and it never runs with reduced motion on. Framing: the home view, the pole views (Arctic, Antarctic) and every place sit in the middle of the screen space the panels leave free, not the middle of the screen (`framed()` and `paddedRect()` in `CesiumGlobe.tsx`); over a pole the view turns instead, since there is no "north up" there. Speed: the globe draws at 1× pixel density while the camera moves and 1.5× once it has been still for half a second (the graphics chip was the limit; 1× held 60 fps with no stutter). Hovering a dot is found with screen maths, not `scene.pick()`, which redrew the globe and cost ~85 ms per mouse move.
- **Any place on Earth** (`src/lib/live.ts`): type a name in the search and pick "Get a live NASA report". OpenStreetMap Nominatim gives the outline (`polygon_geojson`); we lay a 7×7 grid over its box (cut to 50° around the centre for huge or wrap-around countries), keep the points inside the outline, use at most 12 (a place under 1° is one point), and fetch each from the NASA POWER monthly point API (T2M, PRECTOTCORR, GWETROOT, AOD_55, 1981–2025; six requests at a time). A month counts when at least half the points have it; the points are averaged. Brazil takes about 10–20 s the first time, then it is cached for the session. The searched place gets Temperature, Rainfall, Drought and Air and opens the same report; its link is `?place=find:brazil` and is looked up again when shared.
- **Report** (`src/components/report/Report.tsx`, charts in `charts.tsx`, tooltips and icons in `ui.tsx`, all hand-written SVG). Opens on the **left** (bottom sheet under 760px); the right side holds the detective chat (below), and the globe frames the place in the space left over. Copy is for the public: every term (per decade, p-value, NDVI, stripes, trend line, record years) has an (i) tooltip that says what it is. Sections, top to bottom:
  1. Headline: arrow icon, the answer in words ("Getting wetter", "No clear trend"), one plain sentence with the years and real values, and a "Very likely real" / "Could be chance" badge whose tooltip explains the p-value.
  2. Stripes: one coloured stripe per year with a two-colour key (warming stripes; rain and plant cover use their own ramps). Years outside the tested range are dimmed.
  3. Two tiles (with up/down arrows): change every 10 years; how many of the 10 hottest/wettest/greenest years fell in the last 15 (and how many chance alone would give). Total change and "is it real" live in the headline, not repeated here.
  4. "{Measure} each year": dots + the Sen's-slope trend line (bright colour by direction), axis unit, and a two-handle **years to test** slider. Every number is recomputed for the chosen years and season. A season is picked from the seasons bars (6); while one is picked, a "Summer only ✕" pill next to the heading goes back to the whole year.
  5. Then and now, from space: GIBS maps of two years side by side on the globe with a draggable line, for every question. The maps are clipped to the open place's box (cities: ±0.6°), so Mumbai shows only Mumbai; the World view shows the whole globe. Map choice (Photo / Rain / Plant cover / Ground heat; default from `DEFAULT_MAP`: temperature → Photo, rainfall → Rain, vegetation → Plant cover). Rain is GIBS `MERRA2_Precipitation_Bias_Corrected_Monthly` (1981–2025, ~50 km squares, so cities show as a few blocks), compared in each place's rainy-season month (`compareMonth`: India July, Mediterranean/Middle East/US southwest/Europe January, East Africa April), Then and Now year pickers (2001–2025), and "Play the years" steps Now forward one year every 1.7 s. On by default.
  6. Which season is changing most: one bar per season with icons; solid = clear trend, pale = could be chance (also written next to the bar); clicking one switches the chart to it.
  6b. **What else changes when …?** (`Links.tsx`, maths in `src/lib/coupling.ts`). Built for the public, so plain words first and numbers last. Chips pick a measure (temperature, rain, soil moisture, plant cover, haze, groundwater, sea ice, plus humidity, cloud, sunshine and wind where a NASA POWER record exists: the 01 files for Indian places, live for searched ones). One slider sets how far that month is from usual, with the words at each end ("Cooler" … "Hotter") and the value in the middle ("1.4 °C hotter than usual"). Two presets: "A typical hotter month" and "The change since {year}". Under it, **one sentence** sums it up ("When a month is 1.4 °C hotter than usual, Delhi usually gets drier air, drier soil and less rain"). The picture puts the pushed measure in the middle and the others around it: they rise (blue, goes up) or sink (orange, goes down), grey when there is no clear link, thicker lines for links that hold more often. The list gives each change with "Almost every time / Most of the time / Often / Sometimes" and "a month later" when it lags. Tap a row for a sentence, the month-by-month scatter and a small "Behind the numbers" line (correlation, p, likely range). Measures with no clear link are hidden behind "Show N with no clear link". The panel ends with "This shows what tends to happen together, not what causes what." Method: each monthly record minus its calendar-month mean, then the linear trend removed (so two drifting records don't look linked); OLS slope and Pearson r; effective n cut for lag-1 autocorrelation; Student t p-value. Slow measures (soil, plants, groundwater, sea ice) may answer 0–3 months later; the best lag is kept and its p is multiplied by 4. A third measure that moves with both and cuts the link by over 40% (partial correlation) is named. Follows the report's season and years. Sanity: Delhi monsoon temperature vs humidity r = −0.92; Punjab rain → groundwater a month later r = 0.38; Arctic temperature vs sea ice r = −0.33. Live places now fetch RH2M, CLOUD_AMT, ALLSKY_SFC_SW_DWN (AG community gives MJ/m²/day; `live.ts` divides by 3.6 to match the files' kWh) and WS2M in the same request.
  7. Daily station data (India places with a file in 03): hotter days or nights (both trends), days above 40/45 °C for Temperature; very heavy rain days (>50 mm) and the longest dry spell for Rainfall. Bar charts draw a trend line only when it is significant.
  8. Compared with the world: the open place, India (for Indian places) and the whole Earth, ranked by full-record trend, with one sentence (faster / slower / about the same as the planet). "Show all N places" expands to every place; a row opens that place.
  9. Source line and method.
- Per-question wording, units, colour ramps, the headline sentence and the headline rate live in `src/lib/layers.ts`: °C/decade for temperature; % of the mean per decade for rain, NDVI, AOD, soil wetness and sea ice; cm/decade for groundwater and sea level.
- **The five newer questions and their data:**

  | Question | Places | Data |
  |---|---|---|
  | Air (haze) | World, Asia, Africa, Amazon, Sahara, Wisconsin, India, Delhi, Punjab, Andhra | MODIS AOD from 02/04 (`aod_*`, 2002→) |
  | Air (haze) | the other Indian places | POWER `AOD_55` from 01 (2001→) |
  | Drought | every Indian place with a file in 01 | POWER `GWETROOT` (root-zone wetness, 0–1, shown as %) |
  | Groundwater | India, Punjab | GLDAS `GWS_tavg` daily (04) → monthly means, mm → cm |
  | Sea ice | Arctic, Antarctica | MERRA-2 `FRSEAICE` (04), shown as % |
  | Sea level | Whole Earth | `05_global_sea_level` (10-day readings → monthly means; HDR lines and the 9.97e36 fill value skipped) |

  The daily-station sections only show for Temperature and Rainfall. PM2.5, CO, CH₄, SST, evaporation, GLDAS soil and Himalayan snow are downloaded but not shown yet.
- Region catalog with bboxes, sources per layer, daily station and the monsoon-season flag: `src/lib/regions.ts`. Cities have no box; the map frames about 130 km around them.
- `src/lib/series.ts` loads the CSVs in the browser: `annualize` (one value per year or season; December counts toward the next winter; a missing month is filled with its long-term mean so gaps can't fake a trend; whole year needs all but one month), `trend` (Mann-Kendall with tie correction + Sen's slope, needs 8+ years), `loadDaily` (yearly heat/rain indices from daily files, years with 360+ days). Swap for `/api/trend` once the backend exists; keep the same fields.
- Deep links: `/?layer=warming&place=punjab&from=1990&to=2025&season=summer` (season ids from `series.ts`: India `winter|summer|monsoon|post`, elsewhere `djf|mam|jja|son`); satellite maps: `map=truecolor|rain|vegetation|heat`, `then=2005&now=2024`, `space=0` hides them.
- Shortcuts: ⌘1–8 questions, ⌘K search, ⌘J the detective, Esc back to the whole Earth.
- Sanity numbers (full record): world +0.16 °C/decade, Arctic +0.44 (about 2.7×), India +0.12; NDVI world +1.9 %/decade, Punjab +5.9, Rajasthan +15.6, Amazon +0.2.

- **The detective (AI chat, `src/lib/agent/`, `src/app/api/chat/route.ts`, `src/components/chat/`).** A panel on the right ("Ask the detective", ⌘J, or open it with `?ask=1`) that answers questions by working with the same records the report uses. It does not answer from memory.
  - **Model:** `openai/gpt-6-luna` through the Vercel AI Gateway (`https://ai-gateway.vercel.sh/v1`, OpenAI-compatible), called with LangChain `ChatOpenAI`. Key: `AI_GATEWAY_API_KEY` in `.env` (git-ignored, server only). Reasoning effort (`reasoning_effort`): **high** for the investigation (it is meant to do real research), low for the plan card. The gateway also accepts `xhigh`.
  - **Graph (LangGraph, `graph.ts`):** `make_plan` and `investigate` both start at once; `investigate` ⇄ `tools` → `verify`. `make_plan` writes the goal and up to 8 steps (shown as a card). It runs beside the first round instead of before it, which saves its 3–5 s; the first round therefore sees no plan, and later rounds do. `investigate` is the model with the tools; each round runs all the tool calls the model asked for at once, then loops until the model has its evidence. There is no step budget in code (only LangGraph's `recursionLimit: 500` as a runaway guard), but the prompt asks for 2 rounds, 3 at most: round 1 calls everything at once (data, web search, the map); round 2 only for follow-ups a result made necessary. `verify` traces every number in the answer back to a tool result, the question or the open view (`check.ts`), and shows "All N numbers trace back to the NASA records" or lists the ones it could not find.
  - **Tools (`tools.ts`, maths in `data.ts`):** `list_places`, `find_place` (any place on Earth via the live POWER route), `get_trend` (Mann-Kendall + Sen's slope, same as the report), `compare_places`, `versus_world`, `season_breakdown`, `monthly_pattern`, `daily_extremes` (India stations), `show_in_app` (opens a place/question/season/years on the globe and in the report). On the server the CSVs are read from `public/trend_detective_data` with `fs`: `series.ts` has a swappable loader (`setTextLoader`), so the browser and the agent share one copy of the stats code.
  - **Research tools (`research.ts`, with `power.ts` and `grace.ts`), for any place or area (a name, or a box `[west, south, east, north]`):**
    - `water_storage`: GRACE groundwater/water storage (§2.6c): trend in mm/decade, km³ gained or lost a year, latest month against its usual level, lowest and highest months, last 12 months. Clipped to the place's real border (from the OpenStreetMap outline) when at least 9 cells fall inside.
    - `nasa_power`: any NASA POWER monthly parameter (T2M_MAX, T2M_MIN, RH2M, QV2M, EVPTRNS, GWETTOP/ROOT/PROF, WS2M/WS10M, ALLSKY_SFC_SW_DWN, CLOUD_AMT, FROST_DAYS, AOD_55 …), up to 8 per call, with the trend, the usual value per month and the latest year. Seasons by id or any list of months.
    - `scan_region`: the POWER regional grid (about 0.5°) or the GRACE grid over an area. Tests every cell, reports the whole-area trend, how many cells rise or fall significantly, a 3×3 sector breakdown and the fastest rising and falling cells with nearby place names (Nominatim reverse lookup, one a second). POWER's regional API takes one parameter per request and boxes 2°–10° a side, so `power.ts` tiles larger areas (up to 30° a side). This replaces asking for a list of cities one by one (a "which parts of Rajasthan are getting wetter" question took 27 steps before; now one scan).
    - **Areas and periods:** a named place is looked up as an outline (country, state, district, city). A river basin, sea, desert or mountain range has no outline, so the agent passes a box with the name as its label; a failed lookup says so. A period under 10 years (a drought, before vs after) returns the mean and each year instead of a trend, so periods can be compared; `scan_region` still needs 10 years. Coordinates are rounded to 2 decimals (`deg()`), not 3 significant figures, which had moved cells up to 45 km.
    - `calculate`: a small safe expression parser (no `eval`), so derived numbers (conversions, differences, projections) come from a tool and pass the number check.
  - **Lookups outside our data (`web.ts`):**
    - `power_parameters`: searches NASA POWER's official monthly catalog (`/api/system/manager/parameters?community=AG&temporal=monthly`, fetched once and cached). POWER lists 1388 monthly keys, of which 1106 are hour-of-day copies (`T2M_00`…`T2M_23`), so 282 real parameters; daily has 152, hourly 105. `nasa_power`'s description names about 25 common ones, but it accepts any code, so the agent looks up the rest here (snow depth `SNODP`, wet-bulb `T2MWET`, degree days, …).
    - `web_search`: Parallel's Search API called directly (`POST https://api.parallel.ai/v1/search`, header `x-api-key`, key `PARALLEL_WEB_SEARCH_KEY` in `.env`). The model passes an objective and 1–5 search queries; mode `advanced`, up to 6 results, 12,000 characters of excerpts, an optional `after` date. About 2–3 s a search. Returns URL, title, date and excerpts. The prompt uses it for causes, local surveys, official reports, policies and recent events, cites every web fact as a link with its year, and keeps web figures apart from NASA measurements. Numbers in excerpts count as traced by the number check, because they are in a tool result.
  - **Prompt (`prompts.ts`):** the detective works as a research scientist: it plans the evidence, calls independent tools together, tests explanations with a second variable, and gives a reasoned judgment when asked ("is it enough", "is it livable") instead of refusing. Data values must come from tools. p-values stay in the folded details. A GRACE hotspot near big reservoirs or snow is not called groundwater. Numbers are rounded to 2-3 significant figures, with matching decimals in a comparison. The verdict may not claim more than the sections show; studies with different numbers are checked for different years or areas before being called a disagreement; for a river basin the headwaters' rainfall is checked, not only the basin average. When a study found on the web answers the question directly ("60% of the loss was groundwater"), the answer quotes it and says where NASA data agrees or differs. Background science (climate thresholds, water needs) is allowed but labelled as such. Green (`tone: good`) only for a change people clearly want (cleaner air, water coming back); a cooling or an unclear benefit is neutral. For a city, it says in one line that POWER is a ~50 km model (the number check accepts "50 km" and "1 km" for this) (the region, not street thermometers) and uses ~1 km land surface temperature for heat inside the city.
  - **Speed (15 Nov, production build):** each round costs about 5 s of model time plus the tools, and the written answer about 6 s, so the round count decides the wait. "Ozone layer depletion near Antarctic" took 50 s in 5 rounds (the plan blocking for 4.7 s, a round spent searching the layer catalogue, `scan_region` called with a satellite layer id, which failed with a 422 error). After the parallel plan, the 2–3 round prompt, ozone layers listed in `SAT_LAYERS`, and `scan_region`'s description saying it takes only POWER codes: ozone 18–24 s, Delhi pollution 20–32 s, Punjab groundwater 16.5 s. Effort stays `high` for answer quality. "Air analysis between Mumbai and Delhi" took 40 s on the dev server, 21 s of it reading 26 years of daily MODIS haze maps (`measure_satellite` fetched up to 360 tiles per place, 24 at a time, about 0.8 s each). `MAX_REQUESTS` is now 160 and `PARALLEL_TILES` 32 (`satellite.ts`), which still reads about 6 months a year: the read takes 3 s, and the whole question 25 s (15.6 s asked again). **Caches:** POWER replies (`power.ts getJson`, 500 URLs) and decoded GIBS tiles (`satellite.ts tileValues`, 400 tiles, about 100 MB) are kept by URL while the server runs, with failures dropped, so a question rehearsed before the demo reads its data again in about 1 s. They sit below the tools, so the globe still gets its focus, grid and imagery every time.
  - **Prompt caching** (automatic on the gateway, about 10× cheaper for cached tokens): every request starts with the same tools and instructions, then the screen-and-plan note (fixed for one answer), then the conversation, which only grows. So each tool round reuses the previous round from cache (measured: round 3 read 4,480 of 4,545 input tokens from cache). Do not put anything that changes between rounds (a counter, a time) in a system message: the provider merges system messages to the front, and one change there makes everything after it uncached. The gateway serves `gpt-6-luna` from both OpenAI and Bedrock and each has its own cache, so requests bouncing between them lost the cache (the dashboard showed 0–66%). `chatModel()` sets `providerOptions.gateway.order = ["bedrock", "openai"]`: Bedrock always, OpenAI only if Bedrock fails. Bedrock was picked on speed (14 Nov, median of 5 runs each, same prompts): first token 1.3 s vs 1.9 s, a tool-calling turn 1.0 s vs 1.7 s, 240 vs 143 tokens/s; both cache equally well. A `prompt_cache_key` made hits worse, so it is not set.
  - **How answers look (built for skimming):** the model writes short markdown plus ```` ```viz ```` blocks, one JSON object each, and `src/components/chat/blocks.tsx` draws them. Kinds: `verdict` (the answer in 5–9 words, always first), `stats` (2–4 headline numbers), `chart` (ids of tool series), `bars`, `meter` (a value against a limit), `versus` (two pieces of evidence side by side), `timeline`, `details` (folded caveats and method), `next` (2–3 follow-up questions you can tap, always last). The verdict has no side bar: its title is coloured by tone (warm = bad, green = good, blue = neutral). `plot` is the free-form chart, drawn with [bklit charts](https://bklit.com) (MIT, installed by shadcn from `components.json` into `src/components/charts/`, which eslint skips as library code; `src/components/chat/plot.tsx`): `"chart"` is `line`, `area`, `scatter`, `bar`, `pie` or `radar`; data is either tool chart ids (+ `names`, joined on the year, so the values are NASA's own) or `x` + `series[{name, values}]`. Lines fit the data (a patched `floating` prop on `LineChart`; scatter is fitted too) and say the lowest and highest value under the chart, since bklit lines have no y axis. Non-year labels on a line fall back to bars; radar scales each axis to its largest value. Hover: lines and areas have no tooltip box (it hid the trend); a crosshair and a small year pill follow the cursor, and the key under the chart switches to that year's numbers (the latest year at rest). Dots and grouped bars show a tooltip box with each series' value and a plain legend underneath; one-series bars print their values on the bars. The box is portalled into a fixed layer on `<body>` kept over the chart, so the chat panel's edge cannot clip it. The year pill is our own (`datePill` → `.viz-pill`) because bklit's rolling ticker slipped out of line inside the chat's text styles. Tailwind v4 draws `border` in the text colour (white here), so the tooltip borders carry `border-white/10`. Patched vendored files (keep the patches if you re-run shadcn): `tooltip/chart-tooltip.tsx` (`hideBox`, `formatTitle`), `tooltip/tooltip-box.tsx` (body layer, border colour), `tooltip/tooltip-content.tsx` (divider colour), `line-chart.tsx` (`floating`), `scatter-chart-shell.tsx` (fitted y). The chart colours (`--chart-*`) are set to the app's colours at the end of `globals.css`. The prompt sets the shape (verdict → stats → at most 3 `###` finding sections of ≤2 bullets and ≤1 visual → details → next) and a budget: ≤200 words of prose, ≤4 visuals, ≤4 charts (chart and plot blocks together). Comparing records in the same unit over time goes in one `plot` line, not stacked `chart`s. **Chart ids:** `tagCharts()` in `tools.ts` gives every tool series a random 5-letter id (`"chart"`); the model cites ids, and the client draws the real series from the tool output (`chartsOf()` in `parts.tsx`), so the model never retypes data. Numbers inside viz JSON go through the same number check. Web sources show as small dotted links after the fact. The chat scrolls to the top of the answer when it starts (not to the bottom), and the plan card hides once the answer arrives.
  - **Save as PDF** (`src/components/chat/PdfReport.tsx`): once there is an answer, a "PDF" button in the chat header opens a report preview over the app: a white A4 sheet with a brand line and date, the question as the title (or "<place>: what we found" with a numbered list when there are several), each answer with its charts and stats (folded notes opened; "Ask next" left out), a Sources list built from the links in the answer, and one line on how many numbers match the NASA records. No raw tool steps. "Save as PDF" calls `window.print()` with the page title set to `Earth Trend Detective - <place> - <date>` (the PDF's file name). Styles: `.pdf*` in `globals.css`; the sheet redeclares the colour and `--chart-*` tokens for paper. Keep `@page` at the top level: nested inside `@media print` it silently breaks the Turbopack CSS build. Disabled while an answer is streaming. No new dependency: charts stay vector.
  - **Memory:** a LangGraph `MemorySaver` keyed by the chat id, so follow-ups ("and in summer?") keep the earlier evidence. It lives in server memory; after a restart the chat sends its whole history again and the thread is rebuilt.
  - **Streaming:** `POST /api/chat` with `{ id, messages, view }` (AI SDK `useChat` format; `view` = what the app shows: place, layer, season, years). The reply is an AI SDK UI message stream (`@ai-sdk/langchain` `toUIMessageStream`): `data-plan`, one `dynamic-tool` part per tool call (shown as the step trail with small charts), the answer text, then `data-check`.
  - **The globe follows the investigation:** while the detective works, the globe flies to the area it is reading, dims the rest of the world (a spotlight: dark bands around the area, `shadeAround`) and locks four glowing corner brackets onto it (`cornerLines`; they close in from 25% wider over 0.55 s and breathe softly while the detective works; no scan line), and paints each grid it tests as a heat map (1° GRACE tiles or ~0.5° POWER cells, fading in north to south; faint tiles = no clear trend). A caption under it gives the place, the measure, the years and the colour scale, and while the detective works, what it is reading now. The spin stops and the dots and legend hide while a probe is shown; Reset hides it.
  - **One frame only:** the brackets and spotlight hug what is on screen: the heat map's outer squares (`cellsBox`) or the satellite map's padded edges, else the area read. The open place's thin white outline hides while the detective frames an area, and the detective's map or trend wins over the place's own then/now photos (otherwise the photos covered the detective's map, as in Delhi).
  - **Your hands win:** the camera follows the detective to each new area only until you click, drag, scroll or touch the globe. From then until the next question it stays where you put it (`touched` ref in `CesiumGlobe.tsx`; picking a place still flies there).
  - **Hover a square:** the heat-map square under the mouse shows its number, e.g. "+0.3 mm/day per decade · wetter · clear trend" (`CellTip`; found with `camera.pickEllipsoid`, no scene pick).
    - **Server:** `water_storage`, `nasa_power` and `scan_region` send two extra stream parts that the model never sees (no tokens): `data-focus` `{name, box, what}` when they start reading an area, and `data-grid` `{name, title, units, parameter, box, step, years, season?, cells: [lat, lon, perDecade, significant][]}` with every cell's trend (types `GlobeFocus`, `GlobeGrid` in `view.ts`). Tools get the stream writer as `config.writer` (LangGraph's `getWriter()` is empty inside `ToolNode` tools); `safe()` in `tools.ts` puts it in an `AsyncLocalStorage` (`globeWriter` in `src/lib/agent/globe.ts`, with `toGlobe` and `focusOn`) so the research functions can send without passing it around. Every place tool (`find_place`, `region_trend`, `compare_places`, the season, month and daily tools) also flies the globe to the place first (`lookAt` in `tools.ts`), so the camera moves before the numbers arrive.
    - **`data-imagery`** `{name, layer, title, source, matrixSet, maxLevel, ext, time, label, before?, beforeLabel?, box | null, legend {stops, min, max} | null}` (type `GlobeImagery`): a real NASA satellite map (any GIBS layer) laid over the area, or over the whole Earth when `box` is null. With `before`, the globe shows a before/after split (drag the line). Sent by `show_satellite_map` and `measure_satellite`.
    - **Client:** `probeOf()` in `src/lib/probe.ts` builds the globe's view of the newest answer that read any area. The model reads several areas at once (the basin, then each country), so the camera frames all of them together (or just the newest when they are more than 50° apart), and the heat map merges the answer's grids of the first grid's measure (calls finish in any order; a cell read twice is drawn once), so it covers everything read and stays while other areas are read; the caption names the areas. Colours and words come from `scaleFor()` (water: brown = losing, teal = gaining; heat: blue to red), and the scale's end is the 90th percentile of the cells' rates, so one extreme cell doesn't wash the rest out. `Detective.tsx` passes a new probe only when something drawn changed, so the heat map doesn't restart on every streamed token. The drawing is in `CesiumGlobe.tsx` (`ProbeCard`, and the heat-map and outline effects).
    - **A satellite map and a trend heat map together:** `measure_satellite` sends both (the map of the latest date, then the trend grid). `probeOf()` keeps both and says which came last (`latest`); a then/now split map wins over a later single-date map, since the answer describes the split; the globe shows that one, and the caption gets a **Satellite map | Trend** switch. When seasons arrive as separate grids in any order, the whole-year grid (no `season`) leads the merge. Compare mode always shows the grid.
    - Name a box in `place` ("Tigris–Euphrates basin"), or the caption shows its coordinates.
  - **Any NASA satellite measurement, anywhere (`src/lib/agent/satellite.ts`, `png.ts`).** The detective is not limited to our files and POWER: it can read any of the ~1,000 raster layers in NASA GIBS (vegetation, snow, land and sea temperature, chlorophyll, sea ice, rain, soil moisture, aerosols/haze, NO₂, night lights, fire, true colour…).
    - `find_satellite_layers {search}`: searches the GIBS WMTS capabilities (EPSG:4326, ~5 MB, cached a day in `os.tmpdir()/earth-trend-detective/`). The ranking uses synonyms ("greenness" → NDVI, "night lights" → Black Marble), prefers monthly layers with a colormap and long records, and pushes orbit tracks and labels down. The prompt also lists verified ids (`SAT_LAYERS` in `tools.ts`) so common questions skip the search.
    - `show_satellite_map {layer, place | box | wholeEarth, date?, compareDate?}`: puts the map on the globe (a split with `compareDate`) and returns what it shows: the area mean on each date, the typical range (p10–p90), the share with data, the change.
    - `measure_satellite {layer, place | box, months?, from?, to?}`: reads the layer's real values every year (each chosen month; the 15th for daily layers), up to 360 map requests, about 3–4 s for 80 maps. It drops dates with under half the best coverage and years missing over half the months, then runs the same Mann-Kendall/Sen test as everything else (≥8 years). Returns the whole-area verdict, how many cells are rising or falling, the strongest cells and the series (a chart id), and sends the trend grid as `parameter: "SAT_<layer>"`.
    - **How values are read:** GIBS data layers are palette PNGs where the palette index is the colormap entry, so each pixel maps back to a number: the middle of its range, an open-ended range's finite end, a catch-all end bucket (more than 10× the usual width, e.g. LST's "below −73 °C") at its inner edge so the legend reads −73…77 °C, not −173…228, NaN for no data and for transparent classes such as water in NDVI, and K → °C. `png.ts` is a small PNG decoder (8-bit, palette/grey/RGB/RGBA, no interlace). Each area is read from at most ~60,000 pixels at the finest zoom that fits, weighted by cos(latitude); cells need ≥30% valid pixels.
    - **Pictures without a data scale** (true colour, Black Marble night lights): `show_satellite_map` reads their brightness instead (0–100, plus `brightShare`, the share of the area brighter than 25%: the lit area at night). Black Marble exists only for 2012 and 2016 (the daily night radiance has clouds and moonlight), so night lights are a two-date change, never a trend. Lagos 2012 → 2016: lit area 46% → 55%.
    - A city's map covers at least ~5° around it (`padded`), so it is not a speck from orbit. Colour-scale titles that contradict the layer (MERRA-2 extinction's scale says "Scattering") are replaced by the layer's title. Legend numbers ≥ 100,000 are written as "8 × 10¹⁴" (NO₂).
    - **The prompt:** in every answer about a place, show the matching satellite map (with a then/now split for change), and measure the satellite record for vegetation, snow, heat, sea temperature, algae, sea ice, haze, NO₂ before ever saying the data is unavailable.
    - Checked 15 Nov: "Is the UK getting greener?" (NDVI, 81 maps, catches the 2018/2022/2025 droughts) "Is the sea around Japan getting warmer?" (MUR SST split 2003 | 2025, 225-cell warming map, +0.51 °C/decade), "Is air pollution getting worse over northern India?" (MERRA-2 AOD split plus a 216-cell trend map and OMI NO₂, rising in winter) and "Are city lights growing around Lagos?".
  - **LangSmith tracing:** set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY` and `LANGSMITH_PROJECT` in `.env`. Each answer is one `detective` run with the plan, every tool call and the check; the route waits for traces to finish sending after the reply (`after(awaitAllCallbacks)`).
  - **For the voice layer (Medhu):** `import { askDetective } from "@/lib/agent"` (server only). `askDetective({ threadId, text, view })` returns `{ text, rich, show, check }`: `text` is the answer with the viz blocks stripped (for speaking), `rich` is the full markdown with blocks (for a screen), the `show_in_app` view changes to apply in the app (the last one wins), and the number check. Use the same `threadId` for one conversation.
- **No router (removed 16 Nov).** There used to be a fast router for spoken messages (a decision model, `typesafe-ai/jev-1.14.0`, plus a small extractor model) that turned "fly to Kerala" into a screen change without the detective. It is gone: typed and spoken messages both go straight to the detective, which changes the screen with its `show_in_app` tool and answers. One model path, fewer keys and calls.
  - **Working bar:** while the detective is busy, a thin green light glides back and forth along a faint track at the top edge, the macOS indeterminate progress bar: its fading tail stretches at speed and shrinks at each end (`.busy-bar` in `globals.css`; a gentle pulse with reduced motion). While listening, the light sits in the middle and grows with your voice.
- **Voice.** Hold **Space** anywhere outside a text box and let go to send, or tap the mic in the chat box (it stops when you stop talking). The text goes through `send(text, true)` in `Detective.tsx` to the detective, like a typed question, and opens the chat.
  - **Speech-to-text: ElevenLabs Scribe v2 through the Vercel AI Gateway** (`elevenlabs/scribe-v2`, `experimental_transcribe` with `gateway.transcriptionModel` from `ai`; the same `AI_GATEWAY_API_KEY` as the detective, no ElevenLabs key). The browser (`src/lib/voice/mic.ts`, mic capture with end-of-speech detection) posts 16 kHz float32 PCM to `POST /api/voice/stt` (`src/app/api/voice/stt/route.ts`), which wraps it as a 16-bit WAV and transcribes it; returns `{ text, rejected, audio_s, ms }`. The key never reaches the browser. Works on a hosted deploy; no Python needed. (Whisper on this machine was replaced on 16 Nov.)
  - **Run:** nothing extra for speech-to-text. `npm run voice` is only for the Piper voice below.
  - **Headset button (for the stage: CMF Neckband Pro, AirPods, any Bluetooth headset):** click or press a key on the page once (browsers only allow audio after a gesture), then press the headset's play/pause button to start listening and press it again to send. A press during an answer stops it and listens. It works while the browser is not in front. How (`src/lib/voice/headset.ts`, from the branch): headset buttons reach a page only through the browser's media controls, so the page plays an inaudible audio loop to own the media session and handles play/pause, stop, toggle-microphone and hang-up; `Detective.tsx` arms it and calls `listen(true)`. If Spotify or YouTube starts playing, it takes the button over: pause it, then click the page once. The mic is the system input: in macOS Sound settings, pick the neckband as input (or keep the laptop mic if it hears you better).
  - **Spoken answers:** a question asked by voice gets its answer spoken: the verdict block's title and text, never the whole answer (`speakReply` in `Detective.tsx`; a greeting with no verdict speaks its first two sentences). The voice is **Piper** (`en_US-lessac-medium`, a neural voice, from Medhu's branch) in the optional local voice service (`npm run voice`, `voice/server.py`, now Piper only), proxied by `src/app/api/voice/[...path]/route.ts` (`/tts`, `/health`): `POST /tts` with `{text}` returns a WAV, about 0.3 s a sentence once warm; it loads in its own process, and `/health` reports `tts`. `src/lib/voice/speak.ts` asks for every sentence at once and plays them in order, so speech starts after the first; `%`, `/decade`, `−` and `°C` are turned into words first. If the service is down or Piper failed, the browser's own voice reads it instead (an Enhanced or Premium English voice first). Another Piper voice: `PIPER_VOICE=en_US-amy-medium npm run voice` (downloaded on first start). Starting to listen (mic, Space, headset button) cuts it off. The prompt makes the verdict's text the answer's main findings in one or two sentences a listener understands without the screen (no caveats, symbols, at most one number), and keeps stats that seem to contradict it (an average that rose while the ice shrank) out of the stats block.
- **Hand control (Jarvis mode):** the "Hand control" button bottom-left of the globe, or the H key, turns on the webcam and steers the globe with one hand (`src/components/globe/HandControl.tsx`, styles in `hands.css`). Kept deliberately simple, two poses move things and everything else moves nothing: **open hand** (five fingers out) and the globe follows the hand, north stays up; **thumb and index tips touching** (pinch) and moving the hand up zooms in, down zooms out; with the before/after comparison on, a pinch moved **sideways** slides the comparison line instead (each pinch picks zoom or slide from its first ~2% of movement and keeps it until you let go, so zooming never nudges the line; the line listens for a `hand-split` window event with a pixel delta); **all five fingertips bunched together**, fingers apart after a pinch, or any other pose = hands off, so you can move your hand back into place without moving the globe. Motion is relative (the globe moves by how far the hand moves, never jumps to where the hand is) and linear. The palm centre (wrist + knuckles) is tracked, smoothed with a One Euro filter; a pose must hold 3 frames before it counts, and motion freezes the moment the pose starts changing. The pinch has hysteresis (starts below 0.33 hand-size, holds until 0.55). The hand drives the Cesium camera directly (`camera.rotate` around the Earth's axis, `camera.zoomIn`), and a `hand-active` event keeps the idle spin asleep. Tuning constants at the top of the file (`TURN_SPEED`, `ZOOM_SPEED`, `HOLD_FRAMES`). MediaPipe Hand Landmarker (`@mediapipe/tasks-vision` 1.1.1, GPU, one hand) runs in the browser, offline: the model `public/mediapipe/hand_landmarker.task` (7.8 MB) is committed, and the wasm runtime is copied to `public/mediapipe/wasm` (gitignored) by `scripts/copy-cesium.mjs` on install. Stage tips: light on your hand, plain background, hand 40–70 cm from the camera.
  - Not taken from the branch: the regex command parser (`nlu.ts`, `brain.ts`; the detective handles commands), the NDVI computer-vision service and the voice dock.

Still to do:
- Click anywhere on the globe for a live report (search by name works already).
- PM2.5 as a question (SST, haze/AOD and NO₂ now work through the satellite tools); guided mode (§6 item 6).
- A precomputed fallback for the "Brazil" live demo in case the venue Wi-Fi or NASA POWER fails on stage (the six demo cases are all local files already).

## 9. Gotchas checklist

- [ ] Kelvin → °C for every `temp_*` Giovanni file (POWER files are already °C).
- [ ] GPM rain mm/hr → mm/day (×24). POWER rain is already mm/day.
- [ ] GLDAS evap kg/m²/s → mm/day (×86400).
- [ ] PM2.5 components kg/m³ → µg/m³ (×1e9), combine with the formula in §2.5.
- [ ] Column names differ: POWER CSVs use `date`, Giovanni CSVs use `time`.
- [ ] Groundwater is daily; aggregate to monthly before trend tests.
- [ ] End dates differ: GPM rain ends 2025-09, MOPITT CO ends 2025-01, others 2025-12, sea level Nov 2026.
- [ ] Partial first year (AOD starts 2002-07, SST 2002-08): drop incomplete years when aggregating annually.
- [ ] The `india` box in Giovanni files includes neighbouring countries and ocean; label it "India region (box)".
- [ ] Amaravati and Vijayawada share one NASA grid cell; only amaravati is included.
- [ ] POWER live: `-999` = missing; month 13 = annual; box ≥ 2°.
- [ ] Sea level file: skip `HDR` lines; x-axis is decimal year.
- [ ] Data sources must be credited (NASA POWER, NASA GES DISC Giovanni, NASA PO.DAAC NASA-SSH, NASA JPL GRACE/GRACE-FO). Put this on the About page and the README.

## 10. Demo script (~3 minutes)

1. **Hook (20 s):** "NASA has 2,000+ Earth variables. Picking one and proving it's really changing takes a scientist. We made every student a detective."
2. **Author's own case (30 s):** load Wisconsin aerosol, summer only → trend + p-value. "This is the exact example from the challenge video. Our app reproduces it in one click."
3. **India story (45 s):** guided mode: "Where? Delhi. What worries you? Air." → AOD + PM2.5 rising, verdict, AI explanation. Then heatwave days per year for Delhi/Jodhpur.
4. **Same cause, opposite trend (30 s):** rainfall map: Western Ghats vs Rajasthan vs Northeast, arrows in opposite directions.
5. **Anywhere on Earth (30 s):** a judge types a place (e.g. "Brazil") → live NASA POWER fetch → instant verdict.
6. **Global close (15 s):** Arctic sea ice + global sea level. "Every result is a statistical test on real NASA data."

Rehearse with the network off for steps 2–4 and 6 (all from local files) so only step 5 depends on the internet.

## 11. Suggested build order

**Backend (Medhu):**

1. `src/lib/types.ts` (shared with frontend) and `src/lib/catalog.ts` (variable + region + file mapping from §2 and §5.3).
2. CSV loaders + unit conversion → `/api/series` for one variable (temperature) end to end.
3. `src/lib/stats.ts` (Mann-Kendall, Sen, deseasonalize) → `/api/trend`. Run the sanity checks in §7.
4. Fill in the catalog for all files; `/api/catalog`.
5. `/api/live` (POWER point + sampling), `/api/extremes`, `/api/compare`.
6. `/api/explain` last.

**Frontend (Atharv):**

1. Explore page against mocked responses that follow §5 types (don't wait for the backend).
2. Chart + verdict card.
3. Pickers (variable/region/time) wired to `/api/catalog` + `/api/series`.
4. Demo cases page.
5. Guided detective mode.
6. Map + compare view, AI panel, polish.

**Integration point:** as soon as `/api/series` and `/api/trend` work for temperature, swap mocks for real calls.

## 12. How the data was obtained (for questions from judges)

- **NASA POWER** (power.larc.nasa.gov): monthly regional/point and daily point API, no login.
- **NASA Giovanni** (giovanni.gsfc.nasa.gov, Earthdata login): "Time Series, Area-Averaged" (ArAvTs) service for each variable × region box; NASA computes the area average server-side and returns one value per time step. Downloaded as NetCDF, converted to CSV with xarray.
- **NASA PO.DAAC** NASA-SSH Global Mean Sea Level indicator (doi:10.5067/NSIND-GMSV1).
- **NASA PO.DAAC** GRACE/GRACE-FO JPL mascon RL06.3 v04 CRI (Earthdata login), shrunk to a 1° land grid by `scripts/grace-to-grid.py` (§2.6c).

Nothing was modified except: region averaging (POWER regional, average of grid cells), NetCDF → CSV conversion, and dropping empty rows. Unit conversions happen in the app, not in the files.

## 13. Open decisions (decide in the first hour)

1. Backend in Next.js Route Handlers (recommended) or a separate Python service? (The repo is set up for Route Handlers.)
2. Chart library (e.g. Recharts / Chart.js / ECharts). Map: **decided**, CesiumJS globe with NASA GIBS imagery (see §8). Charts: **decided**, hand-written SVG (see `src/components/report/charts.tsx`).
3. AI explanations: yes/no, which provider + key (Azure OpenAI available).
4. Deploy target for the demo (Vercel is simplest for Next.js) and a local fallback on the laptop.
5. ~~Remove the Earthdata username line from the data READMEs if the site will be public.~~ **Done (14 Nov):** removed from `README.md` and `02_india_satellite_giovanni/README.txt`. It is still in git history (commit `b291266`); rewrite history before making the repo public if that matters.

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
│   └── explain/route.ts           (optional, LLM)
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

### 5.4 As built (backend, 14 Nov). Where the code differs from 5.1–5.3

`src/lib/types.ts` is the source of truth; `docs/API.md` has every param and demo URL.

- **`/api/series` returns the trend inline by default** (`SeriesWithTrend = Series & { trend }`); `trend=0` turns it off. `/api/live` and `/api/extremes` do the same.
- **Monthly trends are tested on anomalies** (seasonal cycle removed), even when the chart shows raw values. `trend.fitLine` is shifted back onto the raw values; `trend.seasonalCycleRemoved = true`. Pass `trendRaw=1` to test the raw values.
- Extra `TrendResult` fields: `ols { slopePerDecade, pValue }` (t-test second opinion), `yearsToSignificance` (rough "not significant yet" estimate), `message`.
- `soil_moisture` is split in two because the units differ: `soil_wetness` (POWER, 0–1) and `soil_moisture` (GLDAS, mm).
- New variable `heat_index_days` (days per year with a "feels like" temperature above 41 °C).
- All extreme indices are also normal variables, so `/api/series?variable=heatwave_days&region=rajasthan_jodhpur` works.
- Giovanni region names are merged into the POWER ids: `andhra` → `andhra_pradesh`, `himalaya` → `himalaya_uttarakhand_hp`, `delhi` → `delhi_ncr`. `?source=power|giovanni|power_daily` forces a dataset.
- `Availability` has a `frequency` field. `/api/explain` returns `{ text, ai }`: `ai: false` means there's no LLM key and the text is a template.
- `/api/live` also returns `samples: [lat, lon][]` (grid points used). Place names are looked up with Nominatim *with the country outline*, so ocean points are dropped.

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
- **Report** (`src/components/report/Report.tsx`, charts in `charts.tsx`, tooltips and icons in `ui.tsx`, all hand-written SVG). Opens on the **left** (bottom sheet under 760px); the right side is kept free for the planned chatbot, and the globe frames the place in the space left over. Copy is for the public: every term (per decade, p-value, NDVI, stripes, trend line, record years) has an (i) tooltip that says what it is. Sections, top to bottom:
  1. Headline: arrow icon, the answer in words ("Getting wetter", "No clear trend"), one plain sentence with the years and real values, and a "Very likely real" / "Could be chance" badge whose tooltip explains the p-value.
  2. Stripes: one coloured stripe per year with a two-colour key (warming stripes; rain and plant cover use their own ramps). Years outside the tested range are dimmed.
  3. Two tiles (with up/down arrows): change every 10 years; how many of the 10 hottest/wettest/greenest years fell in the last 15 (and how many chance alone would give). Total change and "is it real" live in the headline, not repeated here.
  4. "{Measure} each year": dots + the Sen's-slope trend line (bright colour by direction), axis unit, and a two-handle **years to test** slider. Every number is recomputed for the chosen years and season. A season is picked from the seasons bars (6); while one is picked, a "Summer only ✕" pill next to the heading goes back to the whole year.
  5. Then and now, from space: GIBS maps of two years side by side on the globe with a draggable line, for every question. The maps are clipped to the open place's box (cities: ±0.6°), so Mumbai shows only Mumbai; the World view shows the whole globe. Map choice (Photo / Rain / Plant cover / Ground heat; default from `DEFAULT_MAP`: temperature → Photo, rainfall → Rain, vegetation → Plant cover). Rain is GIBS `MERRA2_Precipitation_Bias_Corrected_Monthly` (1981–2025, ~50 km squares, so cities show as a few blocks), compared in each place's rainy-season month (`compareMonth`: India July, Mediterranean/Middle East/US southwest/Europe January, East Africa April), Then and Now year pickers (2001–2025), and "Play the years" steps Now forward one year every 1.7 s. On by default.
  6. Which season is changing most: one bar per season with icons; solid = clear trend, pale = could be chance (also written next to the bar); clicking one switches the chart to it.
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
- Shortcuts: ⌘1–8 questions, ⌘K search, Esc back to the whole Earth.
- Sanity numbers (full record): world +0.16 °C/decade, Arctic +0.44 (about 2.7×), India +0.12; NDVI world +1.9 %/decade, Punjab +5.9, Rajasthan +15.6, Amazon +0.2.

Still to do:
- Click anywhere on the globe for a live report (search by name works already).
- Ocean warming (SST) and PM2.5 as questions; guided mode (§6 item 6).
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
- [ ] Data sources must be credited (NASA POWER, NASA GES DISC Giovanni, NASA PO.DAAC NASA-SSH). Put this on the About page and the README.

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

Nothing was modified except: region averaging (POWER regional, average of grid cells), NetCDF → CSV conversion, and dropping empty rows. Unit conversions happen in the app, not in the files.

## 13. Open decisions (decide in the first hour)

1. Backend in Next.js Route Handlers (recommended) or a separate Python service? (The repo is set up for Route Handlers.)
2. Chart library (e.g. Recharts / Chart.js / ECharts). Map: **decided**, CesiumJS globe with NASA GIBS imagery (see §8). Charts: **decided**, hand-written SVG (see `src/components/report/charts.tsx`).
3. AI explanations: yes/no, which provider + key (Azure OpenAI available).
4. Deploy target for the demo (Vercel is simplest for Next.js) and a local fallback on the laptop.
5. ~~Remove the Earthdata username line from the data READMEs if the site will be public.~~ **Done (14 Nov):** removed from `README.md` and `02_india_satellite_giovanni/README.txt`. It is still in git history (commit `b291266`); rewrite history before making the repo public if that matters.

## 14. Voice: speech-to-speech (built 14 Nov, Medhu)

Full details: `docs/VOICE.md`. Summary:
- **Run:** `npm run voice` (local service on :8765; first run installs and downloads models) + `npm run dev`. The assistant panel sits on the **right** (the space kept free for the chatbot); tap the mic, hold Space, or tick Hands-free. Typing works too.
- **Speech-to-text:** Whisper large-v3-turbo, local and offline. Preferred engine is **whisper.cpp** (CUDA on Windows, Metal on macOS) with **flash attention** and a shortened audio window for short commands. Fallback is faster-whisper (CTranslate2, fp16). Note: CTranslate2's Windows wheels have no flash-attention kernels, which is why whisper.cpp is preferred.
- **Text-to-speech:** Piper (`en_US-lessac-medium`), in its own process, one sentence at a time so speech starts quickly. Falls back to the browser voice if the service is down.
- **No hallucination by design:** a grammar (`src/lib/voice/nlu.ts`) maps speech to commands. The brain (`src/lib/voice/brain.ts`) drives `Workspace` and fills answer templates with numbers from the same `src/lib/series.ts` loaders and trend test as the report. No LLM writes answers; anything unrecognised gets "I can only act on questions about the NASA data here".
- **Computer vision** (`voice/vision.py`): pixel-level NDVI change detection on GIBS MODIS imagery. It compares 9 images per period, counts a pixel only if a per-pixel t-test says the change is consistent, and reports the area weighted by latitude and where the change is concentrated. The change map is draped on the globe (`overlay` prop on `CesiumGlobe`). Amazon 2001–03 vs 2023–25: 11.9% of the land lost greenness, centred near 8° S, 56° W (the arc of deforestation), while the region-wide NDVI trend is about flat.
- **New data:** `07_world_soil_power/`, NASA POWER root-zone soil wetness for 20 world regions (`scripts/fetch-world-soil.mjs`), wired as `soil` sources in `src/lib/regions.ts`. The Drought question and "overlay soil moisture" now work worldwide.
- **Frontend touch points (Atharv):**
  - `Workspace.tsx`: renders `<VoiceDock>`, exposes `AppControl`, reserves `VOICE_SPACE` on the right in the camera inset, and `find()` now returns the region.
  - `CesiumGlobe.tsx`: optional `overlay` prop.
  - `globals.css`: `@import "tailwindcss" source("..")`, so Tailwind doesn't scan the multi-GB model folder (that crashed Turbopack).
- **Checks without a browser:** `npx tsx scripts/check-nlu.mts`, `SCRIPT="Take me to the Amazon.|…" npx tsx scripts/check-voice.mts`, and `voice/selftest.py` (Piper → Whisper round trip with timings).

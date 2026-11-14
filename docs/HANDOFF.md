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
| `02_india_satellite_giovanni/` | 23 series: MODIS aerosol, GPM rain, MERRA-2 temp, GLDAS soil/snow/evap for 8 Indian regions | monthly, varies (see below) | one CSV per series, `time,<VAR_ID>` |
| `03_india_daily_nasa_power/` | 15 locations, daily mean/max/min temp, rain, humidity | daily 1981-01-01 → 2025-12-31 | one wide CSV per location |
| `04_world_giovanni/` | 57 series: world, continents, poles, Amazon, Sahara, Wisconsin, oceans, air composition, groundwater | monthly (groundwater daily) | one CSV per series, `time,<VAR_ID>` |
| `05_global_sea_level/` | NASA-SSH global mean sea level | ~weekly 1993 → Nov 2026 | text file with `HDR` header lines |

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
| `rain_` | GPM_3IMERGM_07_precipitation | GPM IMERG rainfall | mm/hr → ×24 = mm/day | 1998-01 → 2025-09 | india, western_ghats, rajasthan, northeast, andhra, punjab |
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
| `temp_` | MERRA-2 air temp | K → °C | 1980-01 → 2025-12 | world, asia, africa, europe, north_america, south_america, arctic, antarctic, amazon, sahara, wisconsin |
| `rain_` | GPM IMERG rain | mm/hr ×24 → mm/day | 1998-01 → 2025-09 | world, asia, africa, europe, north_america, south_america, amazon, sahara, wisconsin |
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
| Deforestation / vegetation | none | ❌ (NDVI not available as a time series here; leave out or mark "coming soon") |

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

**Explicitly out of scope:** vegetation/NDVI, per-city sea level, non-linear trend models.

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

- **Charts:** line chart with the raw series (light), optional 12-month rolling mean, trend line from `fitLine`, shaded season band when a season filter is on.
- **Verdict card** next to the chart: big slope-per-decade number, coloured badge (significant / not significant), p-value, n, period, source.
- **Region picker:** dropdown of presets + a map click (lat/lon) + a search box (place name → `/api/live?q=`). Show a loading state for live calls (5–10 s).
- **Variable picker** grouped by theme: 🌡️ Heat · 💧 Water · 🌫️ Air · 🌊 Ocean & Ice.
- Always show the plain-English definition under the variable name.
- Every chart shows a source line, e.g. "Data: NASA MERRA-2 via Giovanni".
- Mobile-friendly enough for a judge's phone, but optimise for a laptop/projector demo.
- Keep a static fallback for demo cases (precomputed JSON) in case the API breaks on stage.

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
2. Chart library (e.g. Recharts / Chart.js / ECharts) and map library (e.g. Leaflet / MapLibre).
3. AI explanations: yes/no, which provider + key (Azure OpenAI available).
4. Deploy target for the demo (Vercel is simplest for Next.js) and a local fallback on the laptop.
5. ~~Remove the Earthdata username line from the data READMEs if the site will be public.~~ **Done (14 Nov):** removed from `README.md` and `02_india_satellite_giovanni/README.txt`. It is still in git history (commit `b291266`); rewrite history before making the repo public if that matters.

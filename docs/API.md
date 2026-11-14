# Backend API (for the frontend)

All types live in `src/lib/types.ts`. All responses are JSON; errors are `{ "error": "message" }` with 4xx/5xx.
Units are already converted for display (°C, mm/day, µg/m³, %, ...).

## GET /api/catalog
`{ variables, regions, availability }` drives every dropdown. `availability` has one row per (variable, region, source),
so filter it to know which regions a variable has. `source` is `giovanni | power | power_daily | nasa_ssh`.

## GET /api/series  → `SeriesWithTrend`
| param | values | default |
|---|---|---|
| `variable`, `region` | ids from the catalog | required |
| `start`, `end` | `YYYY` or `YYYY-MM` | full record |
| `season` | `all DJF MAM JJA SON monsoon` (`JJAS` also accepted) | `all` |
| `agg` | `monthly` / `annual` | native |
| `deseasonalize` | `1` → monthly anomalies (unit gets " (anomaly)") | off |
| `trend` | `0` to skip the inline trend | on |
| `trendRaw` | `1` to test raw monthly values | off |
| `source` | force a dataset (`power`, `giovanni`, ...) | best available |
| `threshold` | for extreme-index variables (e.g. 45 for heatwave days) | variable default |

The response is `{ meta, points, trend }`, so **one call gives the chart and the verdict**.
On monthly data the trend is tested on anomalies (seasonal cycle removed; `trend.seasonalCycleRemoved = true`), and
`trend.fitLine` is shifted to sit on the raw values, so you can draw it straight onto the chart.

Extreme-event variables (`heatwave_days`, `warm_nights`, `extreme_rain_days`, `dry_spell`, `heat_index_days`) are annual
series for the 15 daily locations, so they go through `/api/series` like everything else.

## POST /api/trend  → `TrendResult`
Body: a `Series` (`{ meta, points }`) or just `{ points }`.

## GET /api/compare?variable=&regions=a,b,c  → `{ series[], trends[] }`
Accepts the same transform params as `/api/series`. Use it for "same cause, opposite trend".

## GET /api/extremes?location=&index=  → `SeriesWithTrend` (annual)
`index` = `heatwave_days | warm_nights | extreme_rain_days | max_dry_spell | heat_index`, optional `threshold`.
This is the same as `/api/series?variable=<extreme variable>&region=<location>`.

## GET /api/live  → `SeriesWithTrend & { samples: [lat, lon][] }`
`variable` + one of: `lat`&`lon`, `bbox=lonMin,latMin,lonMax,latMax`, or `q=<place name>` (OpenStreetMap lookup).
Variables: temperature, temperature_max, temperature_min, rainfall, soil_wetness, humidity, aerosol, sunlight, cloud_cover, wind.
Big places are averaged over ≤ 20 grid points inside the country/state outline (`samples` lets you plot them on the map).
**Takes 2–10 s on the first call** (results are cached in memory after that), so show a loading state. Same transform params as `/api/series`.

## POST /api/explain  → `{ text, ai }`
Body `{ meta, trend }`. Uses Azure OpenAI if `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`
are set in `.env.local`. Otherwise it returns a template explanation with `ai: false`, so only label it "AI" when `ai` is true.

## Handy demo calls
- Wisconsin smoke (author's example): `/api/series?variable=aerosol&region=wisconsin&season=JJA`
- Arctic: `/api/series?variable=sea_ice&region=arctic`, `/api/series?variable=temperature&region=arctic`
- Delhi air: `/api/series?variable=pm25&region=delhi_ncr`, `/api/series?variable=aerosol&region=delhi_ncr`
- Sea level: `/api/series?variable=sea_level&region=world`
- Heatwaves: `/api/series?variable=heatwave_days&region=rajasthan_jodhpur`
- Groundwater: `/api/series?variable=groundwater&region=punjab`
- Opposite trends: `/api/compare?variable=rainfall&regions=western_ghats,rajasthan,northeast`
- Anywhere: `/api/live?variable=temperature&q=Brazil`

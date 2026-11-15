# Earth Trend Detective

NASA Space Apps Challenge 2026: **Be An Earth System Trend Detective!**

Pick a place on a 3D globe and a question (is it getting hotter? drier? hazier? is the groundwater running out?). The app plots NASA's record for that place and tests whether the change is a real trend or could be chance (Mann-Kendall test, p < 0.05). It then says the answer in plain words.

## What it does

The five steps from the challenge brief, all on one screen:

1. **Choose what to measure:** temperature, rainfall, vegetation, haze, drought, sea ice, sea level, groundwater.
2. **Choose a region:** about 40 preset places (India in depth, the continents, the oceans, the whole world), or type any place on Earth. Places without a preset file are fetched live from NASA POWER.
3. **Choose the years,** and optionally one season (summer only, monsoon only).
4. **See the time series** and its trend line.
5. **Test the trend:** Mann-Kendall test with Sen's slope. The verdict is "clear trend" or "could be chance", with the change per decade.

On top of that:

- **Six one-click demo cases,** including the challenge author's own example (summer wildfire smoke over Wisconsin), the Arctic, Delhi's air, sea level, Rajasthan heatwaves and Punjab groundwater.
- **Satellite photos of then and now,** split left and right on the globe with a slider.
- **AI detective:** ask anything in plain words, typed or spoken. It plans the evidence and pulls NASA data for any area. It puts the satellite maps on the globe, tests every grid cell and paints a heat map of where things are changing (hover a square for its number). It answers with charts and a verdict.
  - **Data it pulls:** NASA POWER climate data, GRACE groundwater, and any of about 1,000 NASA GIBS satellite layers.
  - **Fact check:** every number in an answer is checked against the NASA data the detective fetched.

## Run it

You need Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

For a smoother demo, use the production build: `npm run build && npm start`.

The charts, trend tests and demo cases work offline from the files in `public/trend_detective_data/`. The live parts need the internet and a `.env` file in the project folder:

| Variable | What it is for |
|---|---|
| `AI_GATEWAY_API_KEY` | The AI detective (Vercel AI Gateway) |
| `PARALLEL_WEB_SEARCH_KEY` | Web search inside the detective's answers (optional) |
| `VOICE_URL` | Address of the speech-to-text server (optional; defaults to the local one) |

**Voice input (optional):** run `npm run voice` next to the app. It runs Whisper offline on this machine. On a Mac, first install whisper.cpp with `brew install whisper-cpp`. The first run downloads the model.

## How the trend test works

- One value per year (a season's months only, when a season is picked), so the yearly cycle cannot fake a trend.
- **Mann-Kendall test:** does the record rise or fall more often than chance would allow? Below p = 0.05 is a clear trend, the rule the challenge author uses.
- **Sen's slope:** the median of all year-to-year slopes, reported as change per decade. One odd year cannot pull it.
- Records shorter than 10 years show their mean and each year instead of a trend.

## Data sources

All data is real NASA data:

- **NASA POWER** (Langley Research Center): temperature, rainfall, humidity, soil wetness and more, 1981 to 2025, and live for any place.
- **NASA GES DISC, through Giovanni:** MERRA-2 air temperature and sea ice, GPM IMERG rainfall, MODIS Aqua aerosol (haze), GLDAS groundwater, MOPITT carbon monoxide.
- **NASA PO.DAAC:** NASA-SSH global mean sea level from satellite altimetry, 1993 onward.
- **NASA JPL GRACE and GRACE-FO** mascons: water stored on land, 2002 onward.
- **NASA GIBS / Worldview** (EOSDIS): satellite maps on the globe (MODIS vegetation, land surface temperature, VIIRS night lights and others). The vegetation values for preset places were read back from GIBS map colours. They are close to, but not, NASA's official area averages.

The 3D globe is [CesiumJS](https://cesium.com/platform/cesiumjs/).

## Team

Atharv (frontend) and Medhu (backend). Project notes for the team are in [`docs/HANDOFF.md`](docs/HANDOFF.md).

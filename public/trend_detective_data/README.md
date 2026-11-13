# Trend Detective - NASA data pack
Downloaded 2026-11-13/14 from NASA POWER, NASA Giovanni (Earthdata account atharv714) and NASA PO.DAAC.
Each folder has its own README with units, conversions and region boxes.

| Folder | What | Coverage |
|---|---|---|
| 01_india_monthly_nasa_power | 9 variables x 16 Indian regions/cities (temp, max temp, rain, soil wetness, humidity, aerosol, sunlight, cloud, wind) | monthly 1981-2025 |
| 02_india_satellite_giovanni | MODIS aerosol, GPM rain, MERRA-2 temp, GLDAS soil moisture/snow/evaporation for 8 Indian regions | monthly, 1980/1998/2000/2002-2025 |
| 03_india_daily_nasa_power | daily mean/max/min temp, rain, humidity for 15 Indian locations | daily 1981-2025 |
| 04_world_giovanni | world, continents, Arctic/Antarctic, Amazon, Sahara, Wisconsin + oceans: temp, rain, aerosol, sea surface temp, sea ice, CO, methane, PM2.5 components, groundwater (Punjab/India) | monthly (groundwater daily) |
| 05_global_sea_level | NASA-SSH global mean sea level, cm vs 1993 | ~weekly 1993-Nov 2026 |

## Themes -> files
- Global warming: 01 T2M/T2M_MAX, 02 temp_*, 03 daily max/min, 04 temp_*
- Rainfall variability: 01 PRECTOTCORR, 02 rain_*, 03 daily rain, 04 rain_*
- Soil moisture & drought: 01 GWETROOT, 02 soil_*, 02 evap_*, 04 groundwater_*
- Ocean warming: 04 sst_*
- Glacier & ice: 02 snow_himalaya, 04 seaice_arctic / seaice_antarctic
- Sea level rise: 05
- Atmospheric composition: 01 AOD_55, 02 aod_*, 04 aod_*, co_*, ch4_500hpa_*, pm25_*
- Not included: vegetation / deforestation (NDVI) - not available as a time series in these tools

## Live data for any other region
NASA POWER API works directly from a browser (no login, CORS OK):
https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR&community=AG&latitude=-10&longitude=-55&start=1981&end=2025&format=JSON
Regional endpoint: 1 parameter per request, box must be 2-10 degrees each side.

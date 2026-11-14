NASA Giovanni area-averaged monthly time series (downloaded 2026-11-13)
Source: https://giovanni.gsfc.nasa.gov  service = "Time Series, Area-Averaged" (ArAvTs)
Each CSV: time (YYYY-MM), value. Original NetCDF files are in giovanni_nc/. _index.csv lists every file.

Variables (Giovanni ID -> meaning, units):
  aod_*   MYD08_M3_6_1_Aerosol_Optical_Depth_Land_Ocean_Mean_Mean  MODIS-Aqua aerosol optical depth 550nm (unitless). 2002-07..2025-12
  rain_*  GPM_3IMERGM_07_precipitation        GPM IMERG precipitation, mm/hr (x 24 = mm/day). 1998-01..2025-09
  temp_*  M2TMNXSLV_5_12_4_T2M                MERRA-2 2 m air temperature, Kelvin (- 273.15 = degC). 1980-01..2025-12
  soil_*  GLDAS_NOAH025_M_2_1_RootMoist_inst  GLDAS root-zone soil moisture, kg/m^2. 2000-01..2025-12
  snow_*  GLDAS_NOAH025_M_2_1_SWE_inst        GLDAS snow water equivalent, kg/m^2 (= mm of water). 2000-01..2025-12
  evap_*  GLDAS_NOAH025_M_2_1_Evap_tavg       GLDAS evapotranspiration, kg/m^2/s (x 86400 = mm/day). 2000-01..2025-12

Regions (bbox = lon_min,lat_min,lon_max,lat_max):
  india 68,6,98,37 (box also covers parts of neighbours/ocean) | delhi 76.8,28.4,77.4,28.9
  punjab 73.9,29.5,76.9,32.5 | rajasthan 69.5,24.5,76.5,30 | western_ghats 73,10,77,16
  himalaya 76.5,29.5,80.5,33 | andhra 77,13,84.5,19.5 | northeast 89.5,22,97,29

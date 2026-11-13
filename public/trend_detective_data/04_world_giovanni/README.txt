NASA Giovanni area-averaged time series - WORLD pack (downloaded 2026-11-14)
CSV columns: time, value. _index.csv lists ID, dates, units for every file. Originals in netcdf_originals/.

Variable groups (file prefix -> source, units, conversion):
  temp_*        MERRA-2 2 m air temperature, K (minus 273.15 = degC). 1980-01..2025-12
  rain_*        GPM IMERG precipitation, mm/hr (x24 = mm/day). 1998-01..2025-09
  aod_*         MODIS-Aqua aerosol optical depth 550 nm, unitless. 2002-07..2025-12
  sst_*         MODIS-Aqua sea surface temperature (day, 11 micron), degC. 2002-08..2025-12
  seaice_*      MERRA-2 sea-ice covered fraction of ocean (0-1). 1980-01..2025-12
  co_*          MOPITT carbon monoxide total column (day), mol/cm^2. 2000-03..2025-01
  ch4_500hpa_*  AIRS methane at 500 hPa (mid-troposphere), ppbv. 2002-09..2025-12
  pm25_bc/oc/dust/seasalt/so4_*  MERRA-2 surface mass concentration of PM2.5 components, kg/m^3 (x1e9 = ug/m^3)
                Common MERRA-2 PM2.5 estimate: dust25 + seasalt25 + bc + 1.4*oc + 1.375*so4
  groundwater_* GLDAS CLSM groundwater storage, mm, DAILY. 2003-02-01..2025-12-31

Regions (bbox lon_min,lat_min,lon_max,lat_max):
  world -180,-90,180,90 | asia 60,5,150,55 | africa -20,-35,52,37 | europe -10,35,40,70
  north_america -170,15,-50,72 | south_america -82,-56,-34,13 | arctic -180,66.5,180,90
  antarctic -180,-90,180,-60 | amazon -75,-15,-45,5 | sahara -15,15,35,30
  wisconsin -92.9,42.5,-86.8,47.1 (the challenge author's own example region)
  india 68,6,98,37 | delhi 76.8,28.4,77.4,28.9 | punjab 73.9,29.5,76.9,32.5
  bay_of_bengal 80,10,95,22 | arabian_sea 55,8,75,22 | north_atlantic -60,20,-10,60 | pacific_tropics -180,-10,-80,10

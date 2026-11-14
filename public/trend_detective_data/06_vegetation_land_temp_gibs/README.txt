NASA GIBS-derived vegetation (NDVI/EVI) series (downloaded 2026-11-14)
CSV columns: time (YYYY-MM), <value column>, valid_pixels, area_coverage. _index_<layer>.csv lists mean, trend/decade and coverage per file.

Layers in this folder:
  ndvi_*  column NDVI: Vegetation greenness (NDVI), MODIS/Terra monthly; unitless, about -0.1 to 1 (higher = greener). 32 regions.
  evi_*  column EVI: Enhanced Vegetation Index (EVI), MODIS/Terra monthly; unitless (higher = greener; less saturated than NDVI over dense forest). 32 regions.

How these were made (be honest about this with judges):
  Source: NASA GIBS (Global Imagery Browse Services) WMTS tiles of the MODIS/Terra monthly layers (NDVI/EVI = MOD13A3 v061, 1 km). GIBS has no numeric download,
  so each tile pixel colour was converted back to a value using NASA's own GIBS colormap (exact colour match, 100% of pixels), at tile zoom level 3 (~7.8 km per pixel).
  Each month and region value = cos(latitude)-weighted mean of all valid land pixels inside the box. This is NOT an official NASA area-average product;
  it is our own aggregation of NASA imagery. Resolution of the value is about 0.01 NDVI/EVI (colormap bin width), fine for trends.
  valid_pixels = number of valid pixels used; area_coverage = fraction of the box area that had valid data that month (ocean, cloud, snow, desert-fill reduce it).

Land surface temperature (MODIS/Terra) was also extracted but is NOT included: it shows a fake sharp cooling after ~2020 (Terra overpass drift) that would give wrong cooling trends. Use MERRA-2/POWER temperature (folders 01-04) for warming.

Known limits:
  - Month 2025-04 is missing in the GIBS NDVI/EVI layers (row absent). Antarctic box has no data. Arctic/Siberia/Europe winter months have fewer valid pixels (snow, polar night),
    so use the same calendar month across years (or annual means of full-coverage months) when judging trends there.
  - Pixels with NDVI/EVI below -0.1 are transparent in GIBS and excluded (water/ice/cloud).
  - Large boxes (world, continents, asia...) include ocean; area_coverage shows how much was land.
  - Region-wide NDVI does NOT show a decline for Amazon or Borneo (trend is about flat). Deforestation is local patches inside a huge box; do not claim "Amazon is browning" in the pitch.
    Strong, defensible greening: China, India (Punjab, Rajasthan, central India, Gangetic plain, Andhra), Sahel, Western Ghats. Check each with the trend test before saying it.

Regions (bbox lon_min,lat_min,lon_max,lat_max): africa, amazon, andhra, arctic, asia, australia, borneo, central_india, china, congo, delhi, east_africa, europe, gangetic_plain, himalaya, india, kerala, mediterranean, middle_east, north_america, northeast, punjab, rajasthan, sahara, sahel, siberia, south_america, southeast_asia, us_southwest, western_ghats, wisconsin, world. Boxes are the same as in folders 02/04, plus: borneo 108,-4,119,7 | congo 12,-5,30,5 | sahel -17,12,40,18 | china 100,20,122,42 | siberia 60,50,140,70 | australia 113,-39,154,-11 | middle_east 34,12,60,38 | mediterranean -10,30,40,45 | east_africa 29,-12,52,15 | southeast_asia 92,-10,141,25 | us_southwest -120,30,-103,42 | kerala 74.8,8,77.5,12.5 | central_india 76,20,83,25 | gangetic_plain 80,24,88,28

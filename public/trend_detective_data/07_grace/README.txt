GRACE / GRACE-FO water stored on land, every land area on Earth
================================================================
Source: NASA JPL GRACE and GRACE-FO mascon solution RL06.3 version 04, with the
Coastline Resolution Improvement (CRI) filter. NASA PO.DAAC collection
TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4 (CMR C3195527175-POCLOUD).
File: GRCTellus.JPL.200204_202609.GLO.RL06.3M.MSCNv04CRI.nc (Earthdata login).

What it measures: the change in all water stored in a column of land
(groundwater + soil moisture + snow and ice + lakes and rivers), in mm of
water, as a difference from the 2004.0-2009.999 average.

Made by scripts/grace-to-grid.py:
  - JPL's CRI scale factors applied (recommended for land hydrology)
  - 0.5-degree cells averaged to 1 degree (GRACE resolves ~300 km anyway)
  - ocean dropped: 22,794 land cells

Files
  meta.json  {source, units, months: ["2002-04", ...], cells: [[lat, lon], ...]}
             lat/lon are 1-degree cell centres (lon -179.5..179.5)
  grace.bin  int16 little-endian, mm, cell-major:
             cell i = values [i*M, (i+1)*M), M = len(months); -32768 = missing

Months: 2002-04 to 2026-09, 259 months. Months are missing where the
satellites skipped them, and there is a gap between GRACE (ended 2017-06) and
GRACE-FO (began 2018-06).

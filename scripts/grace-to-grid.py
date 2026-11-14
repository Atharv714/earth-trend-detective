"""Shrink the GRACE/GRACE-FO JPL mascon file to a 1° land grid the server can read.

Input: GRCTellus.JPL.*.RL06.3M.MSCNv04CRI.nc (PO.DAAC collection C3195527175-POCLOUD,
needs an Earthdata login), saved as data-raw/grace_mascon.nc.

Output, in public/trend_detective_data/07_grace/:
  meta.json   months ("YYYY-MM"), and the 1° cells kept (lat/lon of each cell centre)
  grace.bin   int16 little-endian, water storage anomaly in mm, cell-major:
              cell i occupies values [i*M, (i+1)*M) where M = number of months.
              -32768 = missing.

Each 1° cell is the mean of its four 0.5° cells, with JPL's CRI scale factors
applied (recommended for land hydrology). Ocean cells are dropped. GRACE's true
resolution is about 3° (300 km), so the 1° grid loses nothing real.

Usage: python3 -I scripts/grace-to-grid.py data-raw/grace_mascon.nc
"""

import datetime as dt
import json
import pathlib
import sys
import warnings

import h5py
import numpy as np

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "trend_detective_data" / "07_grace"


def main(src: str) -> None:
    f = h5py.File(src, "r")
    lwe = f["lwe_thickness"][:]  # (time, lat 360, lon 720), cm
    scale = f["scale_factor"][:]
    land = f["land_mask"][:] > 0
    days = f["time"][:]

    lwe[lwe == -99999] = np.nan
    scale = np.where(scale == -99999, 1.0, scale)
    lwe = lwe * scale[None, :, :] * 10.0  # cm -> mm
    lwe[:, ~land] = np.nan

    # 0.5° -> 1°: lat −89.75..89.75 (360) and lon 0.25..359.75 (720) pair up exactly.
    t = lwe.shape[0]
    blocks = lwe.reshape(t, 180, 2, 360, 2)
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-ocean blocks
        grid = np.nanmean(blocks, axis=(2, 4))  # (time, 180, 360)

    start = dt.date(2002, 1, 1)
    months = []
    for d in days:
        day = start + dt.timedelta(days=float(d))
        months.append(f"{day.year}-{day.month:02d}")
    # Two solutions can land in one calendar month near the mission gap; keep the first.
    keep_t = [i for i, m in enumerate(months) if m not in months[:i]]
    months = [months[i] for i in keep_t]
    grid = grid[keep_t]

    lats = np.arange(180) - 89.5
    lons = np.arange(360) + 0.5
    lons = np.where(lons > 180, lons - 360, lons)  # -179.5..179.5

    cells, series = [], []
    for i in range(180):
        for j in range(360):
            s = grid[:, i, j]
            if np.isnan(s).all():
                continue
            cells.append([float(lats[i]), float(lons[j])])
            series.append(np.where(np.isnan(s), -32768, np.round(s)).astype("<i2"))

    OUT.mkdir(parents=True, exist_ok=True)
    np.stack(series).tofile(OUT / "grace.bin")
    meta = {
        "source": "NASA JPL GRACE/GRACE-FO mascon RL06.3 v04 CRI (PO.DAAC TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4)",
        "units": "mm of water, anomaly vs the 2004.0-2009.999 mean",
        "months": months,
        "cells": cells,
    }
    (OUT / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(f"{len(cells)} land cells x {len(months)} months, {months[0]}..{months[-1]}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data-raw/grace_mascon.nc")

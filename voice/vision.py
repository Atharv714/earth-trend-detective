"""
Computer-vision change detection on NASA GIBS MODIS NDVI imagery.

GIBS serves NDVI only as coloured images. We turn every pixel's colour back into an NDVI value with NASA's own
GIBS colormap (exact colour match), build a per-pixel composite for a "then" and a "now" period (several months x
several years, so clouds and one odd year don't decide the answer), and compare them pixel by pixel:

  * change = median(now samples) - median(then samples)
  * a pixel counts as changed only if |change| >= 0.05 NDVI and a per-pixel Welch t-test says the difference is
    consistent across the images (|t| >= 2.1, about p < 0.05)
  * areas are cos(latitude)-weighted, so a pixel near the equator counts more than one near the pole

Images and results are cached on disk, so a region that was analysed once works offline.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
WMS_DIR = CACHE / "wms"
MAP_DIR = CACHE / "maps"
RES_DIR = CACHE / "results"
for d in (WMS_DIR, MAP_DIR, RES_DIR):
    d.mkdir(parents=True, exist_ok=True)

LAYER = "MODIS_Terra_L3_NDVI_Monthly"
COLORMAP_URL = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml"
WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
FIRST_YEAR, LAST_YEAR = 2001, 2025
MISSING = {(2025, 4)}  # absent in the GIBS layer
UA = {"User-Agent": "earth-trend-detective/0.1 (NASA Space Apps 2026 student project)"}

MIN_DELTA = 0.05
STRONG_DELTA = 0.10
T_CRIT = 2.1


def _get(url: str, timeout: float = 30) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


_lut: dict[int, float] | None = None


def colormap() -> dict[int, float]:
    """packed RGB -> NDVI (midpoint of the colour's bin). Transparent/no-data colours are left out."""
    global _lut
    if _lut is not None:
        return _lut
    path = CACHE / "MODIS_L3_NDVI.xml"
    if not path.exists():
        path.write_bytes(_get(COLORMAP_URL))
    lut: dict[int, float] = {}
    for e in ET.parse(path).getroot().iter("ColorMapEntry"):
        if e.get("transparent") == "true" or e.get("nodata") == "true":
            continue
        r, g, b = (int(x) for x in e.get("rgb").split(","))
        lo, hi = (float(x) for x in e.get("value").strip("[]()").split(","))
        lut[(r << 16) | (g << 8) | b] = (lo + hi) / 2
    _lut = lut
    return lut


def _size(box: tuple[float, float, float, float], max_side: int = 720) -> tuple[int, int]:
    lon0, lat0, lon1, lat1 = box
    w, h = lon1 - lon0, lat1 - lat0
    if w >= h:
        return max_side, max(16, round(max_side * h / w))
    return max(16, round(max_side * w / h)), max_side


def fetch_ndvi(box, year: int, month: int, size) -> np.ndarray | None:
    """One month of NDVI as a float array (NaN = no data). None if the month is unavailable."""
    if (year, month) in MISSING:
        return None
    lon0, lat0, lon1, lat1 = box
    w, h = size
    url = (f"{WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS={LAYER}&CRS=EPSG:4326&STYLES="
           f"&BBOX={lat0},{lon0},{lat1},{lon1}&WIDTH={w}&HEIGHT={h}&FORMAT=image/png&TRANSPARENT=TRUE"
           f"&TIME={year}-{month:02d}-01")
    key = hashlib.sha1(url.encode()).hexdigest()
    path = WMS_DIR / f"{key}.png"
    if path.exists():
        data = path.read_bytes()
    else:
        try:
            data = _get(url)
        except Exception:
            return None
        if not data.startswith(b"\x89PNG"):
            return None
        path.write_bytes(data)
    img = np.asarray(Image.open(BytesIO(data)).convert("RGBA"))
    rgb = (img[..., 0].astype(np.int32) << 16) | (img[..., 1].astype(np.int32) << 8) | img[..., 2]
    lut = colormap()
    keys = np.fromiter(lut.keys(), dtype=np.int32)
    vals = np.fromiter(lut.values(), dtype=np.float64)
    order = np.argsort(keys)
    keys, vals = keys[order], vals[order]
    idx = np.clip(np.searchsorted(keys, rgb), 0, len(keys) - 1)
    out = np.where((keys[idx] == rgb) & (img[..., 3] > 0), vals[idx], np.nan)
    return out


def _months(month: int) -> list[int]:
    return [((month - 2 + k) % 12) + 1 for k in range(3)]  # month-1, month, month+1


def _stack(box, years, months, size):
    jobs = [(y, m) for y in years for m in months]
    with ThreadPoolExecutor(max_workers=6) as ex:
        arrs = list(ex.map(lambda ym: fetch_ndvi(box, ym[0], ym[1], size), jobs))
    used = [f"{y}-{m:02d}" for (y, m), a in zip(jobs, arrs) if a is not None]
    arrs = [a for a in arrs if a is not None]
    if not arrs:
        return None, used
    return np.stack(arrs), used


def _welch_t(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    import warnings

    with np.errstate(invalid="ignore", divide="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        na = np.sum(~np.isnan(a), axis=0)
        nb = np.sum(~np.isnan(b), axis=0)
        va = np.nanvar(a, axis=0, ddof=1)
        vb = np.nanvar(b, axis=0, ddof=1)
        se = np.sqrt(va / na + vb / nb)
        se = np.where(se < 0.005, 0.005, se)  # colour bins are 0.005 wide; never divide by ~0
        return (np.nanmean(b, axis=0) - np.nanmean(a, axis=0)) / se


COMPASS = [["north-west", "north", "north-east"], ["west", "centre", "east"], ["south-west", "south", "south-east"]]


def change_detection(box, then: int, now: int, month: int | None = None, span: int = 3) -> dict:
    lon0, lat0, lon1, lat1 = box
    if not (-180 <= lon0 < lon1 <= 180 and -90 <= lat0 < lat1 <= 90):
        raise ValueError("bbox must be lonMin,latMin,lonMax,latMax inside the globe")
    span = max(1, min(5, span))
    month = month or 8
    then = max(FIRST_YEAR, min(then, LAST_YEAR - span))
    now = min(LAST_YEAR, max(now, then + span))
    years_then = list(range(then, then + span))
    years_now = list(range(now - span + 1, now + 1))
    months = _months(month)
    size = _size(box)

    rkey = hashlib.sha1(json.dumps([box, years_then, years_now, months, size, MIN_DELTA, T_CRIT]).encode()).hexdigest()[:24]
    rpath = RES_DIR / f"{rkey}.json"
    if rpath.exists():
        res = json.loads(rpath.read_text())
        res["cached"] = True
        res["ms"] = 0
        return res

    t0 = time.perf_counter()
    a, used_a = _stack(box, years_then, months, size)
    b, used_b = _stack(box, years_now, months, size)
    if a is None or b is None:
        raise RuntimeError("Could not get NASA GIBS imagery for one of the periods (offline and not cached?)")

    with np.errstate(invalid="ignore"):
        import warnings

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med_a = np.nanmedian(a, axis=0)
            med_b = np.nanmedian(b, axis=0)
        cnt_a = np.sum(~np.isnan(a), axis=0)
        cnt_b = np.sum(~np.isnan(b), axis=0)
        valid = (cnt_a >= 2) & (cnt_b >= 2)
        delta = np.where(valid, med_b - med_a, np.nan)
        t = np.where(valid, _welch_t(a, b), 0.0)

    h, w = delta.shape
    lats = lat1 - (np.arange(h) + 0.5) * (lat1 - lat0) / h
    lons = lon0 + (np.arange(w) + 0.5) * (lon1 - lon0) / w
    wts = np.repeat(np.cos(np.radians(lats))[:, None], w, axis=1)
    wv = np.where(valid, wts, 0)
    total = wv.sum()
    if total <= 0:
        raise RuntimeError("No valid land pixels in both periods (ocean, snow or cloud everywhere)")

    sig = valid & (np.abs(t) >= T_CRIT)
    loss = sig & (delta <= -MIN_DELTA)
    gain = sig & (delta >= MIN_DELTA)
    strong_loss = loss & (delta <= -STRONG_DELTA)
    strong_gain = gain & (delta >= STRONG_DELTA)
    pct = lambda m: round(float((wts * m).sum() / total * 100), 1)

    # Where is the change concentrated? 3x3 compass grid over the box.
    cells = []
    for i in range(3):
        for j in range(3):
            ys = slice(i * h // 3, (i + 1) * h // 3)
            xs = slice(j * w // 3, (j + 1) * w // 3)
            cw = wv[ys, xs].sum()
            if cw <= 0:
                continue
            lw = (wts[ys, xs] * loss[ys, xs]).sum()
            gw = (wts[ys, xs] * gain[ys, xs]).sum()
            cells.append({"where": COMPASS[i][j], "loss_pct": round(float(lw / cw * 100), 1),
                          "gain_pct": round(float(gw / cw * 100), 1), "valid_share": round(float(cw / total), 3)})

    def centroid(mask):
        m = wts * mask
        s = m.sum()
        if s <= 0:
            return None
        return [round(float((m.sum(axis=0) * lons).sum() / s), 2), round(float((m.sum(axis=1) * lats).sum() / s), 2)]

    # Change map: brown = lost greenness, green = gained, faint = change not consistent across images.
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    d = np.clip(np.nan_to_num(delta) / 0.2, -1, 1)
    neg, pos = d < 0, d > 0
    white = np.array([245, 245, 240], dtype=np.float64)
    brown = np.array([166, 97, 26], dtype=np.float64)
    green = np.array([1, 133, 113], dtype=np.float64)
    col = np.repeat(white[None, None, :], h, 0).repeat(w, 1)
    col[neg] = white + (brown - white) * (-d[neg])[:, None]
    col[pos] = white + (green - white) * (d[pos])[:, None]
    rgba[..., :3] = col.astype(np.uint8)
    big = np.abs(np.nan_to_num(delta)) >= MIN_DELTA
    # Consistent change: solid. Big but inconsistent: faint. Unchanged or no data: clear, so the globe shows through.
    rgba[..., 3] = np.where(valid & big, np.where(sig, 235, 60), 0)
    buf = BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
    (MAP_DIR / f"{rkey}.png").write_bytes(buf.getvalue())

    wmean = lambda x: float(np.nansum(np.where(valid, x, 0) * wts) / total)
    res = {
        "key": rkey,
        "map": f"/cv/map/{rkey}.png",
        "bbox": list(box),
        "size": [w, h],
        "pixel_km": round(111.32 * (lon1 - lon0) / w * math.cos(math.radians((lat0 + lat1) / 2)), 1),
        "then": {"years": [years_then[0], years_then[-1]], "images": len(used_a), "dates": used_a},
        "now": {"years": [years_now[0], years_now[-1]], "images": len(used_b), "dates": used_b},
        "months": months,
        "valid_pct": round(float(valid.mean() * 100), 1),
        "ndvi_then": round(wmean(med_a), 3),
        "ndvi_now": round(wmean(med_b), 3),
        "mean_change": round(wmean(delta), 3),
        "loss_pct": pct(loss),
        "gain_pct": pct(gain),
        "strong_loss_pct": pct(strong_loss),
        "strong_gain_pct": pct(strong_gain),
        "loss_centroid": centroid(loss),
        "gain_centroid": centroid(gain),
        "cells": cells,
        "method": (f"NDVI read from NASA GIBS MODIS/Terra monthly images (colour -> value with NASA's colormap), "
                   f"median of {len(used_a)} and {len(used_b)} images per period, ~{round(111.32 * (lon1 - lon0) / w, 1)} km pixels. "
                   f"A pixel counts as changed if NDVI moved by at least {MIN_DELTA} and a per-pixel t-test says the "
                   f"move is consistent across the images (|t| >= {T_CRIT})."),
        "source": "NASA GIBS, MODIS/Terra MOD13A3 NDVI (monthly, 1 km)",
        "cached": False,
        "ms": round((time.perf_counter() - t0) * 1000),
    }
    rpath.write_text(json.dumps(res))
    return res

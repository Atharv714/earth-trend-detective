"""Pick the least cloudy MODIS true-colour day per place per year.

Daily satellite photos are often cloudy or have gaps between orbits. For each
place in src/lib/regions.ts and each year, this samples a few days in that
place's clearest season from NASA GIBS (small WMS thumbnails), scores how much
of the area is cloud or missing, and keeps the best day.

    python3 scripts/pick-clear-dates.py      # writes src/lib/clear-dates.json

Takes a few minutes. Re-run when places are added.
"""

import io
import json
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor"
WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
YEARS = range(2001, 2026)
PER_YEAR = 8

# Clearest season per place (months). Monsoon India is clear in late winter
# (January has fog over the northern plains),
# the Amazon in its dry season, the poles only in their summer.
SEASON = {
    "india": [2, 3],
    "northeast": [11, 12],
    "amazon": [7, 8, 9],
    "south_america": [7, 8, 9],
    "arctic": [6, 7, 8],
    "antarctic": [12, 1],
    "europe": [6, 7, 8],
    "north_america": [6, 7, 8],
    "wisconsin": [6, 7, 8],
    "asia": [4, 5],
    "africa": [1, 2],
    "sahara": [1, 2, 3],
}
INDIA = {"punjab", "rajasthan", "gangetic_plain", "himalaya", "western_ghats", "andhra",
         "kerala", "central_india", "tamil_nadu", "delhi", "mumbai", "amaravati",
         "bengaluru", "kolkata", "chennai"}


def regions():
    src = (ROOT / "src/lib/regions.ts").read_text()
    out = {}
    for line in src.splitlines():
        m = re.search(r'id: "(\w+)"', line)
        if not m or m.group(1) == "world":
            continue
        rid = m.group(1)
        if b := re.search(r"box\(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\)", line):
            out[rid] = [float(x) for x in b.groups()]
        elif b := re.search(r"bbox: \[([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\]", line):
            out[rid] = [float(x) for x in b.groups()]
        else:
            lat = float(re.search(r"lat: ([-\d.]+)", line).group(1))
            lon = float(re.search(r"lon: ([-\d.]+)", line).group(1))
            out[rid] = [lon - 0.6, lat - 0.6, lon + 0.6, lat + 0.6]
    return out


def candidates(rid, year):
    months = SEASON.get(rid) or (SEASON["india"] if rid in INDIA else [6, 7, 8])
    days = []
    for m in months:
        y = year + 1 if (m < months[0]) else year  # windows like Dec-Jan roll over
        start = date(y, m, 1)
        days += [start + timedelta(days=d) for d in range(0, 28, 3)]
    step = max(1, len(days) // PER_YEAR)
    return [d for d in days[::step] if d < date(2026, 11, 1)][:PER_YEAR]


def score(bbox, day):
    lon0, lat0, lon1, lat1 = bbox
    lat0, lat1 = max(lat0, -89.9), min(lat1, 89.9)
    w = 120
    h = max(24, min(160, int(w * (lat1 - lat0) / max(1e-6, lon1 - lon0))))
    q = urllib.parse.urlencode({
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.1.1", "LAYERS": LAYER,
        "SRS": "EPSG:4326", "BBOX": f"{lon0},{lat0},{lon1},{lat1}", "WIDTH": w, "HEIGHT": h,
        "FORMAT": "image/jpeg", "TIME": day.isoformat(),
    })
    try:
        with urllib.request.urlopen(f"{WMS}?{q}", timeout=40) as r:
            img = Image.open(io.BytesIO(r.read())).convert("RGB")
    except Exception:
        return 9.0
    raw = img.tobytes()
    n = len(raw) // 3
    cloud = haze = gap = 0
    for i in range(0, len(raw), 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        lo, hi = min(r, g, b), max(r, g, b)
        if hi < 10:
            gap += 1  # no data between satellite passes
        elif lo > 165 and hi - lo < 40:
            cloud += 1
        elif lo > 105 and hi - lo < 22:
            haze += 1  # grey fog or smoke
    return (cloud + 0.6 * haze + 3 * gap) / n


def main():
    regs = regions()
    jobs = [(rid, y, d) for rid in regs for y in YEARS for d in candidates(rid, y)]
    print(f"{len(regs)} places, {len(jobs)} thumbnails", file=sys.stderr)
    with ThreadPoolExecutor(12) as pool:
        scores = list(pool.map(lambda j: score(regs[j[0]], j[2]), jobs))
    best = {}
    for (rid, y, d), s in zip(jobs, scores):
        cur = best.setdefault(rid, {}).get(str(y))
        if cur is None or s < cur[1]:
            best[rid][str(y)] = (d.isoformat(), round(s, 3))
    out = {rid: {y: v[0] for y, v in sorted(ys.items())} for rid, ys in sorted(best.items())}
    path = ROOT / "src/lib/clear-dates.json"
    path.write_text(json.dumps(out, indent=1) + "\n")
    worst = sorted(((v[1], rid, y) for rid, ys in best.items() for y, v in ys.items()), reverse=True)[:8]
    print("wrote", path, "| cloudiest picks:", worst, file=sys.stderr)


if __name__ == "__main__":
    main()

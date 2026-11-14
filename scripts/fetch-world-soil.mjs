// Downloads NASA POWER root-zone soil wetness (GWETROOT, monthly 1981-2025) for the world
// hotspot boxes that have no soil record yet, so the drought question and voice overlays work offline.
// Each box value = mean of a 4x4 grid of points inside the box (points over open water are dropped).
//   node scripts/fetch-world-soil.mjs
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const OUT = "public/trend_detective_data/07_world_soil_power";
const BOXES = {
  asia: [60, 5, 150, 55],
  africa: [-20, -35, 52, 37],
  europe: [-10, 35, 40, 70],
  north_america: [-170, 15, -50, 72],
  south_america: [-82, -56, -34, 13],
  australia: [113, -39, 154, -11],
  siberia: [60, 50, 140, 70],
  amazon: [-75, -15, -45, 5],
  congo: [12, -5, 30, 5],
  borneo: [108, -4, 119, 7],
  southeast_asia: [92, -10, 141, 25],
  china: [100, 20, 122, 42],
  sahara: [-15, 15, 35, 30],
  sahel: [-17, 12, 40, 18],
  east_africa: [29, -12, 52, 15],
  middle_east: [34, 12, 60, 38],
  mediterranean: [-10, 30, 40, 45],
  us_southwest: [-120, 30, -103, 42],
  wisconsin: [-92.9, 42.5, -86.8, 47.1],
  india: [68, 6, 98, 37],
};
const N = 4;

async function point(lat, lon, tries = 3) {
  const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=GWETROOT&community=AG&latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start=1981&end=2025&format=JSON`;
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (r.ok) return (await r.json()).properties.parameter.GWETROOT;
    } catch {}
    await new Promise((res) => setTimeout(res, 2000 * (k + 1)));
  }
  return null;
}

mkdirSync(OUT, { recursive: true });
for (const [id, [x0, y0, x1, y1]] of Object.entries(BOXES)) {
  const file = `${OUT}/soil_${id}.csv`;
  if (existsSync(file)) continue;
  const pts = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) pts.push([y0 + ((i + 0.5) * (y1 - y0)) / N, x0 + ((j + 0.5) * (x1 - x0)) / N]);
  const recs = [];
  for (let k = 0; k < pts.length; k += 4) recs.push(...(await Promise.all(pts.slice(k, k + 4).map(([a, b]) => point(a, b)))));
  const sum = new Map();
  let used = 0;
  for (const rec of recs) {
    if (!rec) continue;
    const vals = Object.entries(rec).filter(([k, v]) => !k.endsWith("13") && v > -998);
    if (vals.length < 400) continue; // open water: POWER returns -999 (fill)
    used++;
    for (const [k, v] of vals) {
      const a = sum.get(k) ?? [0, 0];
      sum.set(k, [a[0] + v, a[1] + 1]);
    }
  }
  const need = Math.ceil(used * 0.8);
  const rows = [...sum.entries()].filter(([, [, n]]) => n >= need).sort(([a], [b]) => a.localeCompare(b));
  writeFileSync(file, "date,GWETROOT\n" + rows.map(([k, [s, n]]) => `${k.slice(0, 4)}-${k.slice(4)},${(s / n).toFixed(4)}`).join("\n") + "\n");
  console.log(`${id}: ${used}/${pts.length} land points, ${rows.length} months`);
}
writeFileSync(
  `${OUT}/README.txt`,
  `NASA POWER root-zone soil wetness (GWETROOT, 0 = dry, 1 = saturated), monthly 1981-2025, downloaded ${new Date().toISOString().slice(0, 10)}.
Each region = mean of a ${N}x${N} grid of POWER points inside its box (points over open water dropped). Boxes as in src/lib/regions.ts.
Source: NASA Langley Research Center POWER Project (power.larc.nasa.gov), MERRA-2 based. Made by scripts/fetch-world-soil.mjs.
`,
);

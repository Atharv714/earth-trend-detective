import type { NextRequest } from "next/server";
import type { Region } from "@/lib/types";
import { HttpError, errorResponse, parseAgg, parseBool, parseNum, parseSeason, required } from "@/lib/server/http";
import { loadLive } from "@/lib/server/power";
import { finish } from "@/lib/server/series";

// GET /api/live?variable=&(lat&lon | bbox=lonMin,latMin,lonMax,latMax | q=place)&start=&end=&season=&agg=&deseasonalize=&trend=
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    let bbox: Region["bbox"] | undefined;
    if (q.get("bbox")) {
      const b = q.get("bbox")!.split(",").map(Number);
      if (b.length !== 4 || b.some((x) => !Number.isFinite(x)) || b[0] > b[2] || b[1] > b[3])
        throw new HttpError(400, "bbox must be lonMin,latMin,lonMax,latMax");
      bbox = b as Region["bbox"];
    }
    const { samples, ...base } = await loadLive({
      variable: required(q, "variable"),
      lat: parseNum(q.get("lat"), "lat"),
      lon: parseNum(q.get("lon"), "lon"),
      bbox,
      q: q.get("q") ?? undefined,
    });
    const series = finish(base, {
      start: q.get("start") ?? undefined,
      end: q.get("end") ?? undefined,
      season: parseSeason(q.get("season")),
      agg: parseAgg(q.get("agg")),
      deseasonalize: parseBool(q.get("deseasonalize")),
      trend: q.get("trend") === null ? true : parseBool(q.get("trend")),
      trendRaw: parseBool(q.get("trendRaw")),
    });
    return Response.json({ ...series, samples });
  } catch (e) {
    return errorResponse(e);
  }
}

import type { NextRequest } from "next/server";
import { errorResponse, parseAgg, parseBool, parseNum, parseSeason, required } from "@/lib/server/http";
import { getSeries } from "@/lib/server/series";

// GET /api/series?variable=&region=&start=&end=&season=&agg=&deseasonalize=&trend=&source=&threshold=
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const series = await getSeries(required(q, "variable"), required(q, "region"), {
      start: q.get("start") ?? undefined,
      end: q.get("end") ?? undefined,
      season: parseSeason(q.get("season")),
      agg: parseAgg(q.get("agg")),
      deseasonalize: parseBool(q.get("deseasonalize")),
      trend: q.get("trend") === null ? true : parseBool(q.get("trend")),
      trendRaw: parseBool(q.get("trendRaw")),
      source: q.get("source") ?? undefined,
      threshold: parseNum(q.get("threshold"), "threshold"),
    });
    return Response.json(series);
  } catch (e) {
    return errorResponse(e);
  }
}

import type { NextRequest } from "next/server";
import type { CompareResponse } from "@/lib/types";
import { HttpError, errorResponse, parseAgg, parseBool, parseNum, parseSeason, required } from "@/lib/server/http";
import { getSeries } from "@/lib/server/series";

// GET /api/compare?variable=&regions=a,b,c&start=&end=&season=&agg=&deseasonalize=
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const variable = required(q, "variable");
    const regions = required(q, "regions").split(",").map((s) => s.trim()).filter(Boolean);
    if (regions.length > 12) throw new HttpError(400, "At most 12 regions");
    const opts = {
      start: q.get("start") ?? undefined,
      end: q.get("end") ?? undefined,
      season: parseSeason(q.get("season")),
      agg: parseAgg(q.get("agg")),
      deseasonalize: parseBool(q.get("deseasonalize")),
      threshold: parseNum(q.get("threshold"), "threshold"),
      trend: true,
    };
    const all = await Promise.all(regions.map((r) => getSeries(variable, r, opts)));
    const out: CompareResponse = {
      series: all.map(({ trend: _t, ...s }) => s),
      trends: all.map((s) => s.trend!),
    };
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}

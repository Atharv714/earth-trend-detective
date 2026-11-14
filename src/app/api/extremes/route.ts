import type { NextRequest } from "next/server";
import type { ExtremeIndex } from "@/lib/types";
import { EXTREME_VARIABLES } from "@/lib/server/catalog";
import { HttpError, errorResponse, parseBool, parseNum, required } from "@/lib/server/http";
import { getSeries } from "@/lib/server/series";

const INDEX_TO_VARIABLE = Object.fromEntries(Object.entries(EXTREME_VARIABLES).map(([v, e]) => [e.index, v])) as Record<
  ExtremeIndex,
  string
>;

// GET /api/extremes?location=&index=heatwave_days|warm_nights|extreme_rain_days|max_dry_spell|heat_index&threshold=&start=&end=
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const index = required(q, "index") as ExtremeIndex;
    const variable = INDEX_TO_VARIABLE[index];
    if (!variable) throw new HttpError(400, `Unknown index "${index}". Use one of: ${Object.keys(INDEX_TO_VARIABLE).join(", ")}`);
    const series = await getSeries(variable, required(q, "location"), {
      threshold: parseNum(q.get("threshold"), "threshold"),
      start: q.get("start") ?? undefined,
      end: q.get("end") ?? undefined,
      trend: q.get("trend") === null ? true : parseBool(q.get("trend")),
    });
    return Response.json(series);
  } catch (e) {
    return errorResponse(e);
  }
}

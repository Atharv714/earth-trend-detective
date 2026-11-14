import type { Point, Series } from "@/lib/types";
import { computeTrend } from "@/lib/stats";
import { HttpError, errorResponse } from "@/lib/server/http";
import { trendFor } from "@/lib/server/series";

// POST /api/trend  body: Series | { points: Point[] }
export async function POST(req: Request) {
  try {
    let body: Partial<Series> & { raw?: boolean };
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Body must be JSON: a Series or { points }");
    }
    if (!Array.isArray(body.points)) throw new HttpError(400, "Body needs a points array of { t, v }");
    const points = body.points as Point[];
    if (body.meta?.variable && body.meta.frequency) return Response.json(trendFor(body as Series, undefined, !!body.raw));
    return Response.json(computeTrend(points));
  } catch (e) {
    return errorResponse(e);
  }
}

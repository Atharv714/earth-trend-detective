import type { Season } from "@/lib/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: e instanceof Error ? e.message : "Internal error" }, { status: 500 });
}

const SEASONS: Season[] = ["all", "DJF", "MAM", "JJA", "SON", "monsoon"];

export function parseSeason(s: string | null): Season {
  if (!s) return "all";
  const found = SEASONS.find((x) => x.toLowerCase() === s.toLowerCase() || (s.toLowerCase() === "jjas" && x === "monsoon"));
  if (!found) throw new HttpError(400, `Unknown season "${s}". Use one of: ${SEASONS.join(", ")} (or JJAS).`);
  return found;
}

export const parseBool = (s: string | null) => s !== null && ["1", "true", "yes", "on"].includes(s.toLowerCase());

export function parseAgg(s: string | null): "monthly" | "annual" | undefined {
  if (!s) return undefined;
  if (s === "monthly" || s === "annual") return s;
  throw new HttpError(400, `Unknown agg "${s}". Use monthly or annual.`);
}

export function parseNum(s: string | null, name: string): number | undefined {
  if (s === null || s === "") return undefined;
  const x = Number(s);
  if (!Number.isFinite(x)) throw new HttpError(400, `${name} must be a number`);
  return x;
}

export function required(params: URLSearchParams, name: string): string {
  const v = params.get(name);
  if (!v) throw new HttpError(400, `Missing required parameter "${name}"`);
  return v;
}

import type { ExplainResponse, SeriesMeta, TrendResult } from "@/lib/types";
import { fmt, fmtP } from "@/lib/stats";
import { HttpError, errorResponse } from "@/lib/server/http";

// POST /api/explain  body: { meta: SeriesMeta, trend: TrendResult }
// Uses Azure OpenAI when AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT are set;
// otherwise returns a non-AI template explanation (ai: false) so the UI never breaks.
export async function POST(req: Request) {
  try {
    let body: { meta?: SeriesMeta; trend?: TrendResult };
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Body must be JSON: { meta, trend }");
    }
    const { meta, trend } = body;
    if (!meta?.label || !trend || typeof trend.pValue !== "number") throw new HttpError(400, "Body needs { meta, trend }");

    const facts =
      `Variable: ${meta.label} (${meta.unit}). Region: ${meta.regionLabel}. Period: ${meta.start} to ${meta.end}` +
      `${meta.season ? `, season ${meta.season} only` : ""}. Data source: ${meta.source}. ` +
      `Sen's slope: ${fmt(trend.slopePerDecade)} ${meta.unit} per decade; Mann-Kendall ${fmtP(trend.pValue)} ` +
      `(${trend.significant ? "significant" : "not significant"} at p < 0.05); n = ${trend.n}.`;

    const { AZURE_OPENAI_ENDPOINT: ep, AZURE_OPENAI_API_KEY: key, AZURE_OPENAI_DEPLOYMENT: dep } = process.env;
    if (!ep || !key || !dep) return Response.json(fallback(meta, trend) satisfies ExplainResponse);

    const version = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";
    const res = await fetch(`${ep.replace(/\/$/, "")}/openai/deployments/${dep}/chat/completions?api-version=${version}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": key },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        temperature: 0.4,
        max_tokens: 250,
        messages: [
          {
            role: "system",
            content:
              "You explain Earth science trends to high-school students in 3-4 short sentences. Say what the numbers mean, " +
              "give one or two plausible physical or human causes (hedged: 'may', 'could'), and if the trend is not significant, " +
              "say it could be natural variability. Never invent numbers beyond those given. No markdown.",
          },
          { role: "user", content: facts },
        ],
      }),
    });
    if (!res.ok) return Response.json(fallback(meta, trend));
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content?.trim();
    return Response.json((text ? { text, ai: true } : fallback(meta, trend)) satisfies ExplainResponse);
  } catch (e) {
    return errorResponse(e);
  }
}

function fallback(meta: SeriesMeta, trend: TrendResult): ExplainResponse {
  const sig = trend.significant
    ? `With ${fmtP(trend.pValue)}, a change this steady is very unlikely to be just random ups and downs.`
    : `Because p is above 0.05, the change could still be natural year-to-year variability; a longer record would tell us more.`;
  return {
    ai: false,
    text: `${trend.verdict} The slope comes from Sen's method (the median of the slopes between every pair of points), which is not thrown off by a few extreme years. ${sig}`,
  };
}

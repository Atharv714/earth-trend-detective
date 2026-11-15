import type { NextRequest } from "next/server";

// Same-origin proxy to the local voice service (speech-to-text and Piper text-to-speech) (voice/server.py).
// Keeps the browser on one origin and turns "service not running" into a clear JSON error.
const VOICE_URL = process.env.VOICE_URL ?? "http://127.0.0.1:8765";
const ALLOWED = /^(health|stt|tts)$/;

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const sub = path.join("/");
  if (!ALLOWED.test(sub)) return Response.json({ error: "Unknown voice endpoint" }, { status: 404 });
  const url = `${VOICE_URL}/${sub}${req.nextUrl.search}`;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/octet-stream" },
      body: req.method === "POST" ? await req.arrayBuffer() : undefined,
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    const headers = new Headers();
    for (const h of ["content-type", "cache-control"]) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return Response.json(
      { error: "The voice service is not running. Start it with: npm run voice" },
      { status: 503 },
    );
  }
}

export const GET = forward;
export const POST = forward;

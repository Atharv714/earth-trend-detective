// The router: one message in, who handles it and what to change on screen out.
// Used by the chat box and the voice layer (HANDOFF §15).
import { routeMessage } from "@/lib/router";
import type { View } from "@/lib/agent/view";

export async function POST(req: Request) {
  const { text, view = null } = (await req.json()) as { text?: string; view?: View | null };
  if (!text?.trim()) return Response.json({ error: "Send the text to route." }, { status: 400 });
  try {
    return Response.json(await routeMessage(text.trim(), view, req.signal));
  } catch (e) {
    console.error("[router]", e);
    return Response.json({ error: e instanceof Error ? e.message : "The router failed." }, { status: 502 });
  }
}

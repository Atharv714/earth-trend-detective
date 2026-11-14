// Ask the router from the browser. Null when it fails: the caller then sends
// the message to the detective, which can do everything the router can.

import type { View } from "../agent/view";
import type { Routed } from "./types";

export async function routeText(text: string, view: View | null, signal?: AbortSignal): Promise<Routed | null> {
  try {
    const res = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, view }),
      signal,
    });
    return res.ok ? ((await res.json()) as Routed) : null;
  } catch {
    return null;
  }
}

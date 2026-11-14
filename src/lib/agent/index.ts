// Ask the detective. Two ways in:
//   streamDetective: for the chat (/api/chat), streams every step
//   askDetective:    one finished answer as plain text, e.g. for the voice layer
// Both share threads, so a spoken follow-up continues a typed conversation.
//
// Tracing: with LANGSMITH_TRACING=true and LANGSMITH_API_KEY in .env, every
// run (plan, each tool, each model call, the check) shows up in LangSmith
// under LANGSMITH_PROJECT, tagged with its thread.
import "server-only";

import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { detectiveGraph, MODEL } from "./graph";
import type { CheckData, View, ViewChange } from "./view";

const config = (threadId: string, view: View | null, signal?: AbortSignal) => ({
  configurable: { thread_id: threadId },
  // Each round is investigate + tools; plan and check add two more.
  // No step budget: LangGraph needs some ceiling (its default, 25, would stop
  // after ~11 tool rounds), so this one only catches a runaway loop.
  recursionLimit: 500,
  runName: "detective",
  tags: ["earth-trend-detective"],
  metadata: { thread_id: threadId, model: MODEL, place: view?.place ?? null, layer: view?.layer ?? null },
  signal,
});

/** Has this thread run before on this server? Then it only needs the new message. */
async function known(threadId: string) {
  const state = await detectiveGraph().getState({ configurable: { thread_id: threadId } });
  return ((state.values as { messages?: BaseMessage[] }).messages?.length ?? 0) > 0;
}

/**
 * Stream one answer. `history` is the whole conversation; a thread the server
 * already knows only takes the newest message from it.
 */
export async function streamDetective({ threadId, history, view, signal }: { threadId: string; history: BaseMessage[]; view: View | null; signal?: AbortSignal }) {
  const messages = (await known(threadId)) ? history.slice(-1) : history;
  return detectiveGraph().stream({ messages, view }, { ...config(threadId, view, signal), streamMode: ["values", "messages", "custom"] as const });
}

export interface Answer {
  /** The answer as plain markdown, without its ```viz blocks (nothing to draw in speech). */
  text: string;
  /** The full answer, viz blocks included, as the chat shows it. */
  rich: string;
  /** App changes the detective asked for (show_in_app). */
  show: ViewChange[];
  check: CheckData | null;
}

const withoutBlocks = (t: string) =>
  t
    .replace(/```(viz|json)[^\n]*\n[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** One question in, one finished answer out. */
export async function askDetective({ threadId, text, view = null }: { threadId: string; text: string; view?: View | null }): Promise<Answer> {
  const before = (await detectiveGraph().getState({ configurable: { thread_id: threadId } })).values as { messages?: BaseMessage[] };
  const start = before.messages?.length ?? 0;
  const out = await detectiveGraph().invoke({ messages: [new HumanMessage(text)], view }, config(threadId, view));
  const fresh = (out.messages as BaseMessage[]).slice(start);
  const last = fresh.filter((m) => AIMessage.isInstance(m)).at(-1);
  const show = fresh
    .filter((m): m is ToolMessage => ToolMessage.isInstance(m) && m.name === "show_in_app")
    .map((m) => JSON.parse(m.text) as ViewChange | { error: string })
    .filter((v): v is ViewChange => !("error" in v));
  const rich = last?.text ?? "";
  return { text: withoutBlocks(rich), rich, show, check: out.check ?? null };
}

export type { View, ViewChange } from "./view";

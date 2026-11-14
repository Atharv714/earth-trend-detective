// The detective as a LangGraph graph:
//
//   make_plan ──▶ investigate ◀──▶ tools     (one round = the model's tool calls, run together)
//                     │
//                     ▼
//                  verify ──▶ end
//
// make_plan:   a quick structured call that sets the goal and steps (shown in the chat)
// investigate: the model with the tools; loops until it has the evidence and answers (no step budget)
// verify:      traces every number in the answer back to a tool result
//
// Conversations are kept per thread by the checkpointer, so follow-up
// questions ("and in summer?") have the earlier evidence to hand.
import "server-only";

import { randomUUID } from "node:crypto";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, MemorySaver, MessagesAnnotation, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { traceNumbers } from "./check";
import { DETECTIVE, PLANNER, situation } from "./prompts";
import { TOOLS } from "./tools";
import type { CheckData, PlanData, View } from "./view";


const GATEWAY = "https://ai-gateway.vercel.sh/v1";
export const MODEL = "openai/gpt-6-luna";

/**
 * How hard the model thinks before each step (low, medium, high, xhigh).
 * The investigation runs on high: the questions are research questions, and
 * a wrong turn costs more than the extra seconds. The plan is a quick sketch.
 */
type Effort = "low" | "medium" | "high" | "xhigh";
const INVESTIGATE_EFFORT: Effort = "high";
const PLAN_EFFORT: Effort = "low";

function chatModel(effort: Effort) {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is missing from .env");
  return new ChatOpenAI({
    model: MODEL,
    apiKey,
    configuration: { baseURL: GATEWAY },
    streamUsage: true,
    reasoning: { effort },
    // The gateway serves this model from Bedrock and OpenAI, and each keeps its
    // own prompt cache, so stay on one. Bedrock measured ~40% faster (14 Nov:
    // first token 1.3 s vs 1.9 s, tool call 1.0 s vs 1.7 s, 240 vs 143 tokens/s).
    // OpenAI is only the fallback if Bedrock fails.
    modelKwargs: { providerOptions: { gateway: { order: ["bedrock", "openai"] } } },
  });
}

const State = Annotation.Root({
  ...MessagesAnnotation.spec,
  /** What the app shows, refreshed with every message. */
  view: Annotation<View | null>({ reducer: (_, b) => b, default: () => null }),
  plan: Annotation<PlanData | null>({ reducer: (_, b) => b, default: () => null }),
  check: Annotation<CheckData | null>({ reducer: (_, b) => b, default: () => null }),
});

type S = typeof State.State;

const PlanSchema = z.object({
  needsData: z.boolean(),
  goal: z.string(),
  steps: z.array(z.string()).max(8),
});

/** The conversation as plain text turns: the planner needs no tool traffic. */
function transcript(messages: BaseMessage[], last = 8): BaseMessage[] {
  return messages
    .filter((m) => HumanMessage.isInstance(m) || (AIMessage.isInstance(m) && m.text))
    .slice(-last)
    .map((m) => (HumanMessage.isInstance(m) ? new HumanMessage(m.text) : new AIMessage(m.text)));
}

/** Messages since the person last spoke. */
function sinceQuestion(messages: BaseMessage[]) {
  let i = messages.length - 1;
  while (i >= 0 && !HumanMessage.isInstance(messages[i])) i--;
  return { question: messages[i], after: messages.slice(i + 1) };
}

export function buildGraph() {
  const model = chatModel(INVESTIGATE_EFFORT);
  // "nostream": the plan is shown as its own card, not as answer text.
  const planner = chatModel(PLAN_EFFORT).withStructuredOutput(PlanSchema, { name: "plan" }).withConfig({ tags: ["nostream"], runName: "plan" });
  const withTools = model.bindTools(TOOLS);
  const toolNode = new ToolNode(TOOLS);

  async function makePlan(state: S, config: LangGraphRunnableConfig) {
    const p = await planner.invoke([new SystemMessage(PLANNER), ...transcript(state.messages)], config);
    const data: PlanData = { goal: p.goal, steps: p.needsData ? p.steps : [] };
    if (data.steps.length) config.writer?.({ type: "plan", id: `plan-${randomUUID()}`, ...data });
    return { plan: data, check: null };
  }

  async function investigate(state: S, config: LangGraphRunnableConfig) {
    // Prompt caching reuses the longest prefix already seen: tools, the fixed
    // instructions, then the conversation, which only grows. The situation
    // note is the same for every round of an answer, so it does not break it.
    const messages = [new SystemMessage(DETECTIVE), new SystemMessage(situation(state.view, state.plan)), ...state.messages];
    const reply = await withTools.invoke(messages, config);
    return { messages: [reply] };
  }

  async function verify(state: S, config: LangGraphRunnableConfig) {
    const { question, after } = sinceQuestion(state.messages);
    const answer = after.at(-1);
    if (!answer || !AIMessage.isInstance(answer)) return {};
    // Earlier tool results count too: a follow-up may quote them.
    const sources = [
      ...state.messages.filter((m) => ToolMessage.isInstance(m)).map((m) => m.text),
      question?.text ?? "",
      JSON.stringify(state.view ?? {}),
    ];
    const result = traceNumbers(answer.text, sources);
    if (result.total) config.writer?.({ type: "check", id: `check-${randomUUID()}`, ...result });
    return { check: result };
  }

  const route = (state: S) => {
    const last = state.messages.at(-1);
    return last && AIMessage.isInstance(last) && last.tool_calls?.length ? "tools" : "verify";
  };

  return new StateGraph(State)
    .addNode("make_plan", makePlan)
    .addNode("investigate", investigate)
    .addNode("tools", toolNode)
    .addNode("verify", verify)
    .addEdge(START, "make_plan")
    .addEdge("make_plan", "investigate")
    .addConditionalEdges("investigate", route, ["tools", "verify"])
    .addEdge("tools", "investigate")
    .addEdge("verify", END)
    .compile({ checkpointer, name: "earth-trend-detective" });
}

/** Threads live in memory: a server restart forgets them, and the chat re-sends its history. */
const checkpointer = new MemorySaver();

let graph: ReturnType<typeof buildGraph> | null = null;
export const detectiveGraph = () => (graph ??= buildGraph());

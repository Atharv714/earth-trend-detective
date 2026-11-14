// The chat: the browser's messages in, the detective's steps streamed back
// (plan, tool calls and results, answer text, number check) as an AI SDK
// UI message stream for useChat.
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { after } from "next/server";
import { streamDetective, type View } from "@/lib/agent";

interface Body {
  id: string;
  messages: UIMessage[];
  view?: View | null;
}

export async function POST(req: Request) {
  const { id, messages, view = null } = (await req.json()) as Body;
  if (!id || !Array.isArray(messages) || !messages.length) {
    return Response.json({ error: "Send a chat id and at least one message." }, { status: 400 });
  }

  const stream = await streamDetective({ threadId: id, history: await toBaseMessages(messages), view, signal: req.signal });

  // Let LangSmith finish sending the trace after the reply is done.
  after(awaitAllCallbacks);

  return createUIMessageStreamResponse({
    stream: toUIMessageStream(stream, {
      onError: (e) => console.error("[detective]", e),
    }),
  });
}

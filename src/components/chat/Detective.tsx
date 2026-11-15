"use client";

// The detective: a chat on the right that investigates with NASA records
// (src/lib/agent) and can open what it finds on the globe.

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { LAYER_INFO } from "@/lib/layers";
import type { CheckData, PlanData, View, ViewChange } from "@/lib/agent/view";
import { probeOf, type Probe } from "@/lib/probe";
import { routeText } from "@/lib/router/client";
import { isEmpty, type UiPatch } from "@/lib/router/types";
import { HeadsetButton } from "@/lib/voice/headset";
import { Mic, transcribe } from "@/lib/voice/mic";
import { speak, stopSpeaking, unlockSpeech } from "@/lib/voice/speak";
import { Answer, pieces } from "./blocks";
import { Check, Plan, Trail, chartsOf, parseOutput, toolParts, type ChartSpec } from "./parts";
import { PdfReport, hasReport } from "./PdfReport";

const TRANSPORT = new DefaultChatTransport({ api: "/api/chat" });

interface Props {
  open: boolean;
  view: View;
  onShow: (v: ViewChange) => void;
  /** What the detective is looking at, for the globe. */
  onProbe: (p: Probe | null) => void;
  /** Change the screen as the router asked; says what it did and returns the new view. */
  onApply: (p: UiPatch) => Promise<{ said: string; view: View; failed?: boolean }>;
  /** Listening, working or idle, for the bar along the top. */
  onActivity: (a: Activity) => void;
  onOpen: () => void;
  onClose: () => void;
}

export type Activity = "idle" | "listen" | "work";

/** The mic level, 0 to 1, as a CSS variable the bar reads. Raw levels jump every few ms,
 *  so it follows an envelope (quick to rise, slow to fall) and is written once a frame. */
let level = 0;
let frame = 0;
const setLevel = (l: number) => {
  const v = Math.sqrt(l);
  level = l === 0 ? 0 : level + (v - level) * (v > level ? 0.3 : 0.06);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    document.documentElement.style.setProperty("--mic-level", level.toFixed(3));
  });
};

function suggestions(v: View): string[] {
  if (v.place && v.placeName) {
    return [
      `${LAYER_INFO[v.layer].question.replace(/\?$/, "")} in ${v.placeName}? Why?`,
      `Which season changed most in ${v.placeName}?`,
      `How does ${v.placeName} compare with the whole Earth?`,
    ];
  }
  return [
    "Is Delhi’s air getting worse than the rest of the world?",
    "Where in India is rainfall changing fastest?",
    "Is Lagos getting hotter?",
    "Is the Arctic sea ice really shrinking?",
  ];
}

export function Detective({ open, view, onShow, onProbe, onApply, onActivity, onOpen, onClose }: Props) {
  const { messages, sendMessage, status, stop, error, regenerate, clearError } = useChat({ transport: TRANSPORT });
  /** The message being routed (screen changes stay out of the chat; only the detective's turns go in). */
  const [routing, setRouting] = useState<string | null>(null);
  const busy = status === "submitted" || status === "streaming" || routing !== null;
  /** Voice: recording, or waiting for Whisper. */
  const [voice, setVoice] = useState<"idle" | "listen" | "hear">("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);

  useEffect(
    () => onActivity(voice === "listen" ? "listen" : busy || voice === "hear" ? "work" : "idle"),
    [busy, voice, onActivity],
  );

  const [text, setText] = useState("");
  /** The report preview (save the conversation as a PDF). */
  const [report, setReport] = useState(false);
  const closeReport = useCallback(() => setReport(false), []);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Follow the investigation as it runs, unless the reader scrolled up. Once
  // the answer starts, bring its top into view and stop there, so the reader
  // starts at the verdict instead of chasing the bottom of a growing answer.
  const pinned = useRef(true);
  const anchored = useRef(new Set<string>());
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const last = messages.at(-1);
    const answering = last?.role === "assistant" && last.parts.some((p) => p.type === "text" && p.text.trim());
    if (answering && !anchored.current.has(last.id)) {
      anchored.current.add(last.id);
      const top = el.querySelector<HTMLElement>(`[data-answer="${last.id}"]`);
      if (top && pinned.current) el.scrollTop = Math.max(0, top.offsetTop - el.offsetTop - 12);
      pinned.current = false;
      return;
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Every chart any tool returned in this conversation, by id, for the answers to place.
  const charts = useMemo(() => {
    const m = new Map<string, ChartSpec>();
    for (const msg of messages) for (const t of toolParts(msg)) for (const c of chartsOf(t)) m.set(c.id, c);
    return m;
  }, [messages]);

  // Open what the detective asks to show, once per call.
  const shown = useRef(new Set<string>());
  const showRef = useRef(onShow);
  useEffect(() => {
    showRef.current = onShow;
  }, [onShow]);
  useEffect(() => {
    for (const m of messages) {
      for (const p of toolParts(m)) {
        if (p.toolName !== "show_in_app" || p.state !== "output-available" || shown.current.has(p.toolCallId)) continue;
        shown.current.add(p.toolCallId);
        const out = parseOutput(p.output) as (ViewChange & { error?: string }) | null;
        if (out && !out.error) showRef.current(out);
      }
    }
  }, [messages]);

  // The globe follows the investigation: the areas of the newest answer that
  // read any, framed together, with its widest heat map.
  const live = status === "submitted" || status === "streaming";
  const probe = useMemo<Probe | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const p = probeOf(
        m.parts.map((x) => ("data" in x ? { type: x.type, data: { ...(x.data as object), id: "id" in x ? x.id : undefined } } : { type: x.type })),
        live && i === messages.length - 1,
      );
      if (p) return p;
    }
    return null;
  }, [messages, live]);
  // Every streamed token makes a new probe object: hand the globe one only when
  // something it draws changed, so the heat map and the sweep don't restart.
  const probeKey = probe ? [probe.focus?.id, probe.focus?.name, probe.focus?.what, probe.grid?.id, probe.imagery?.id, probe.scanning].join("/") : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onProbe(probe), [probeKey, onProbe]);

  // A spoken question gets its answer spoken: the verdict's title and its one-line
  // finding, not the whole answer (the screen has the rest).
  const speakReply = useRef(false);
  const lastStatus = useRef(status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = status;
    if (status === "ready" && (was === "streaming" || was === "submitted") && speakReply.current) {
      speakReply.current = false;
      const m = messages.at(-1);
      if (m?.role !== "assistant") return;
      const all = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
      const verdict = pieces(all).find((p) => p.kind === "viz" && p.spec?.type === "verdict");
      const v = verdict?.kind === "viz" ? verdict.spec : null;
      if (v) return void speak(`${String(v.title ?? "")}. ${String(v.text ?? "")}`);
      // No verdict (a greeting or a method question): its first two sentences.
      const plain = pieces(all).filter((p) => p.kind === "md").map((p) => (p.kind === "md" ? p.text : "")).join(" ");
      void speak(plain.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "));
    }
    if (status === "error") speakReply.current = false;
  }, [status, messages]);

  // Typed questions go straight to the detective. Only speech goes through the
  // router, which can turn "fly to Kerala" into a screen change with no chat turn.
  const send = async (q: string, spoken = false) => {
    const t = q.trim();
    if (!t || busy) return;
    if (error) clearError();
    speakReply.current = spoken;
    pinned.current = true;
    setText("");
    if (spoken) setRouting(t);
    try {
      // The router decides in under a second: change the screen, ask the
      // detective, or both. Anything it is unsure of goes to the detective.
      const r = spoken ? await routeText(t, view) : null;
      // A screen change happens on the globe and stays out of the chat. If it
      // can't be done (a place that can't be found), the detective takes it.
      if (r && r.route === "ui" && !isEmpty(r.patch)) {
        const done = await onApply(r.patch);
        if (!done.failed) {
          speakReply.current = false;
          return void speak(done.said);
        }
      }
      let now = view;
      if (r && r.route === "both" && !isEmpty(r.patch)) {
        const done = await onApply(r.patch);
        if (!done.failed) now = done.view;
      }
      if (!open) onOpen();
      // What the app shows goes with every question, so "here" means something.
      sendMessage({ text: t }, { body: { view: now } });
    } finally {
      setRouting(null);
    }
  };

  // Voice (Whisper on this machine, voice/server.py). Tap the mic and it stops when
  // you stop talking; or hold Space anywhere outside a text box and let go to send.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  const mic = useRef<Mic | null>(null);
  const take = useRef<{ stop: () => void } | null>(null);
  const listen = useCallback(async (hold: boolean) => {
    if (take.current) return take.current.stop();
    stopSpeaking();
    setVoiceError(null);
    try {
      mic.current ??= new Mic();
      await mic.current.open();
      const rec = mic.current.record({ onLevel: setLevel, silenceMs: hold ? 60_000 : 900 });
      take.current = rec;
      setVoice("listen");
      const pcm = await rec.done;
      take.current = null;
      setLevel(0);
      if (!pcm) return setVoice("idle");
      setVoice("hear");
      const { text } = await transcribe(pcm);
      setVoice("idle");
      if (text) await sendRef.current(text, true);
    } catch (e) {
      take.current = null;
      setLevel(0);
      setVoice("idle");
      setVoiceError(e instanceof Error ? e.message : "The microphone did not start.");
      onOpen();
    }
  }, [onOpen]);
  const stopListening = useCallback(() => take.current?.stop(), []);

  useEffect(() => {
    const field = (e: globalThis.KeyboardEvent) => (e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]");
    const down = (e: globalThis.KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || field(e)) return;
      e.preventDefault();
      void listen(true);
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.code === "Space" && !field(e)) stopListening();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [listen, stopListening]);

  useEffect(() => () => mic.current?.close(), []);

  // Headset button (CMF Neckband Pro, AirPods, any Bluetooth headset): press to talk, press
  // again to send; a press during an answer stops it and listens. It arms on the first click or
  // key on the page (autoplay rules), then works even when the browser is not in front.
  const press = useRef(() => {});
  useEffect(() => {
    press.current = () => {
      if (!take.current && busy) void stop();
      void listen(true);
    };
  });
  const headset = useRef<HeadsetButton | null>(null);
  useEffect(() => {
    const h = (headset.current = new HeadsetButton());
    h.onPress = () => press.current();
    const arm = () => {
      unlockSpeech();
      void h.arm();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (!h.key(e)) arm();
    };
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", key);
      h.disarm();
    };
  }, []);
  useEffect(() => headset.current?.setMicActive(voice === "listen"), [voice]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(text);
    }
  };

  // Grow the box with the question, up to a few lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const last = messages.at(-1);

  return (
    <aside className="chat" aria-label="Ask the detective" hidden={!open}>
      <header className="chat-head">
        <div>
          <h2>Ask the detective</h2>
          <p>Answers come from NASA records, tested for real trends.</p>
        </div>
        {hasReport(messages) && (
          <button
            type="button"
            className="chat-export"
            onClick={() => setReport(true)}
            disabled={busy}
            title={busy ? "Wait for the answer to finish" : "Save every answer as a PDF report"}
          >
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M8 2.5v7M5 6.75 8 9.75l3-3M3 11.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" />
            </svg>
            PDF
          </button>
        )}
        <button type="button" className="chat-close" onClick={onClose} aria-label="Close the detective" title="Close (⌘J)">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>

      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        aria-live="polite"
      >
        {!messages.length && (
          <div className="chat-empty">
            <p>Ask about any place and any change: heat, rain, haze, green cover, ice, the sea. The detective tests the record, compares it, and opens the report.</p>
            <div className="chat-suggest">
              {suggestions(view).map((s) => (
                <button key={s} type="button" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <p key={m.id} className="chat-q">
              {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
            </p>
          ) : (
            <Reply key={m.id} message={m} live={busy && m === last} charts={charts} onAsk={busy ? undefined : send} />
          ),
        )}

        {voice === "hear" && (
          <div className="chat-thinking">
            <span className="spinner" aria-hidden />
            Hearing you
          </div>
        )}

        {status === "submitted" && last?.role === "user" && (
          <div className="chat-thinking">
            <span className="spinner" aria-hidden />
            Reading the question
          </div>
        )}

        {voiceError && (
          <div className="chat-error" role="alert">
            <p>Voice: {voiceError}</p>
          </div>
        )}

        {error && (
          <div className="chat-error" role="alert">
            <p>The detective could not answer: {error.message || "the connection dropped"}.</p>
            <button type="button" onClick={() => regenerate({ body: { view } })}>
              Try again
            </button>
          </div>
        )}
      </div>

      <form className="chat-input" onSubmit={onSubmit}>
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            voice === "listen" ? "Listening…" : view.placeName ? `Ask about ${view.placeName}, or anywhere` : "Ask about any place on Earth"
          }
          aria-label="Your question"
        />
        <button
          type="button"
          className="chat-mic"
          aria-pressed={voice === "listen"}
          disabled={voice === "hear"}
          onClick={() => void listen(false)}
          aria-label={voice === "listen" ? "Stop listening" : "Speak"}
          title={voice === "listen" ? "Stop listening" : "Speak (or hold Space, or press your headset button)"}
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
            <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25" />
          </svg>
        </button>
        {busy ? (
          <button type="button" className="chat-send" onClick={() => stop()} disabled={routing !== null} aria-label="Stop" title="Stop">
            <svg viewBox="0 0 16 16" aria-hidden>
              <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button type="submit" className="chat-send" disabled={!text.trim()} aria-label="Ask" title="Ask (Enter)">
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
            </svg>
          </button>
        )}
      </form>
      {report && <PdfReport messages={messages} view={view} charts={charts} onClose={closeReport} />}
    </aside>
  );
}

function Reply({ message, live, charts, onAsk }: { message: UIMessage; live: boolean; charts: Map<string, ChartSpec>; onAsk?: (q: string) => void }) {
  const dataOf = <T,>(type: string) => {
    const p = message.parts.find((x) => x.type === type);
    return p && "data" in p ? (p.data as T) : null;
  };
  const plan = dataOf<PlanData>("data-plan");
  const check = dataOf<CheckData>("data-check");
  const tools = toolParts(message);
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

  return (
    <article className="chat-a">
      {plan && !text && <Plan data={plan} done={tools.filter((t) => t.state === "output-available" || t.state === "output-error").length} answering={!!text} />}
      {tools.length > 0 && <Trail tools={tools} live={live && !text} />}
      {text && (
        <div data-answer={message.id}>
          <Answer text={text} charts={charts} onAsk={onAsk} live={live} />
        </div>
      )}
      {live && !text && !tools.some((t) => t.state === "input-streaming" || t.state === "input-available") && (
        <div className="chat-thinking">
          <span className="spinner" aria-hidden />
          {tools.length ? "Weighing the evidence" : "Planning"}
        </div>
      )}
      {check && !live && <Check data={check} />}
    </article>
  );
}

"use client";

// Speech-to-speech assistant: tap the mic (or hold Space) and talk; it acts on the globe and report
// and answers out loud. Hands-free mode keeps listening after each answer.
import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, toSpeech, type AppControl, type AppState, type Card, type Reply } from "@/lib/voice/brain";
import { Mic, Speaker, health, transcribe } from "@/lib/voice/audio";
import { VoiceCard } from "./cards";
import "./voice.css";

type Status = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

interface Turn {
  id: number;
  who: "you" | "ai";
  text: string;
  card?: Card;
  timing?: { stt?: number; brain?: number; voice?: number; engine?: string };
  note?: string;
}

interface Props {
  state: AppState;
  control: AppControl;
}

let turnId = 0;

export function VoiceDock({ state, control }: Props) {
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [handsFree, setHandsFree] = useState(false);
  const [level, setLevel] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [svc, setSvc] = useState<{ ok: boolean; text: string }>({ ok: false, text: "Connecting to the voice service…" });
  const [typed, setTyped] = useState("");

  const mic = useRef<Mic | null>(null);
  const speaker = useRef<Speaker | null>(null);
  const rec = useRef<{ stop: () => void } | null>(null);
  const handsFreeRef = useRef(false);
  const busy = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  const push = useCallback((t: Omit<Turn, "id">) => {
    const id = ++turnId;
    setTurns((ts) => [...ts.slice(-30), { ...t, id }]);
    return id;
  }, []);
  const patch = useCallback((id: number, p: Partial<Turn>) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t))), []);

  const brainRef = useRef<Brain | null>(null);
  /** Built on first use (inside an event), so render never touches refs. */
  const getBrain = useCallback(() => {
    brainRef.current ??= new Brain(
      () => stateRef.current,
      control,
      (text) => {
        // Interim progress ("Comparing satellite images…"): show and say it while the work runs.
        push({ who: "ai", text, note: "working" });
        void speaker.current?.speak(toSpeech(text));
      },
    );
    return brainRef.current;
  }, [control, push]);

  // Speaker + service health.
  useEffect(() => {
    const sp = new Speaker();
    sp.onState = (on) => setStatus((s) => (on ? "speaking" : s === "speaking" ? "idle" : s));
    speaker.current = sp;
    let alive = true;
    const poll = async () => {
      const h = await health();
      if (!alive) return;
      if (!h) {
        setSvc({ ok: false, text: "Voice service offline: typing works, answers use the browser voice. Start it with npm run voice." });
        sp.fallback = true;
      } else if (!h.ready) setSvc({ ok: false, text: h.error ? `Voice service error: ${h.error}` : "Loading Whisper and Piper…" });
      else {
        const s = h.stt as { model?: string; device?: string; flash_attention?: boolean } | undefined;
        setSvc({ ok: true, text: `Whisper ${s?.model ?? ""} · ${s?.device === "cuda" ? "GPU" : "CPU"}${s?.flash_attention ? " · flash attention" : ""} · offline` });
        sp.fallback = false;
      }
      if (alive && (!h || !h.ready)) setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      alive = false;
      sp.stop();
      mic.current?.close();
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  /** Text in → action + spoken answer. */
  const ask = useCallback(
    async (text: string, stt?: number) => {
      const clean = text.trim();
      if (!clean) return;
      push({ who: "you", text: clean });
      setStatus("thinking");
      const t0 = performance.now();
      let reply: Reply;
      try {
        reply = await getBrain().handle(clean);
      } catch (e) {
        reply = { intent: "unknown", text: `Something went wrong: ${(e as Error).message}` };
      }
      const brainMs = Math.round(performance.now() - t0);
      if (reply.intent === "stop") {
        speaker.current?.stop();
        setStatus("idle");
        return;
      }
      const id = push({ who: "ai", text: reply.text, card: reply.card, timing: { stt, brain: brainMs } });
      const sp = speaker.current!;
      sp.onFirstAudio = (ms, engine) => patch(id, { timing: { stt, brain: brainMs, voice: ms, engine } });
      await sp.speak(reply.speech ?? toSpeech(reply.text));
      setStatus("idle");
    },
    [getBrain, push, patch],
  );

  const listenRef = useRef<(o: { waitForSpeech: boolean }) => Promise<void>>(async () => {});
  /** One utterance: record → Whisper → ask. */
  const listen = useCallback(
    async (opts: { waitForSpeech: boolean }) => {
      if (busy.current) return;
      busy.current = true;
      speaker.current?.stop(); // barge-in
      speaker.current?.unlock();
      try {
        if (!mic.current) {
          mic.current = new Mic();
          await mic.current.open();
        }
        setStatus("listening");
        const r = mic.current.record({ waitForSpeech: opts.waitForSpeech, onLevel: setLevel, maxMs: 15000 });
        rec.current = r;
        const pcm = await r.done;
        rec.current = null;
        setLevel(0);
        if (!pcm || pcm.length < 3200) {
          setStatus("idle");
          return;
        }
        setStatus("transcribing");
        const res = await transcribe(pcm);
        if (!res.text) {
          push({ who: "ai", text: "I didn't catch that. Try again?", note: res.rejected ?? undefined });
          setStatus("idle");
          return;
        }
        busy.current = false;
        await ask(res.text, res.ms);
      } catch (e) {
        const msg = (e as Error).message;
        push({
          who: "ai",
          text: /Permission|NotAllowed/i.test(msg) ? "I need microphone permission to listen." : `Listening failed: ${msg}`,
        });
        setStatus("idle");
      } finally {
        busy.current = false;
        rec.current = null;
      }
      if (handsFreeRef.current) setTimeout(() => handsFreeRef.current && void listenRef.current({ waitForSpeech: true }), 250);
    },
    [ask, push],
  );
  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  const tap = useCallback(() => {
    if (rec.current) return rec.current.stop(); // second tap: done talking
    if (status === "speaking") speaker.current?.stop();
    void listen({ waitForSpeech: false });
  }, [listen, status]);

  const toggleHandsFree = useCallback(() => {
    const on = !handsFreeRef.current;
    handsFreeRef.current = on;
    setHandsFree(on);
    if (on) void listen({ waitForSpeech: true });
    else rec.current?.stop();
  }, [listen]);

  // Hold Space to talk (when not typing).
  useEffect(() => {
    let held = false;
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e) || e.repeat || held) return;
      e.preventDefault();
      held = true;
      speaker.current?.stop();
      void listen({ waitForSpeech: false });
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held) return;
      held = false;
      rec.current?.stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [listen]);

  const label: Record<Status, string> = {
    idle: handsFree ? "Listening for you…" : "Tap or hold Space to talk",
    listening: "Listening…",
    transcribing: "Whisper is transcribing…",
    thinking: "Checking the data…",
    speaking: "Speaking (tap to interrupt)",
  };

  if (!open)
    return (
      <button type="button" className="vd-pill" onClick={() => setOpen(true)} aria-label="Open voice assistant">
        <MicIcon /> Ask out loud
      </button>
    );

  return (
    <aside className="vd" aria-label="Voice assistant" data-status={status}>
      <header className="vd-head">
        <div>
          <strong>Trend Detective</strong>
          <span className={`vd-svc ${svc.ok ? "is-ok" : ""}`}>{svc.text}</span>
        </div>
        <button type="button" className="vd-x" onClick={() => setOpen(false)} aria-label="Minimise">
          –
        </button>
      </header>

      <div className="vd-log" ref={logRef} aria-live="polite">
        {turns.length === 0 && (
          <div className="vd-empty">
            <p>Ask out loud. Every answer comes from the NASA data on screen.</p>
            <ul>
              <li>“Take me to the Amazon.”</li>
              <li>“Select vegetation.”</li>
              <li>“Compare historical and recent satellite observations.”</li>
              <li>“Overlay precipitation and soil moisture.”</li>
              <li>“Calculate the trend slope and significance.”</li>
              <li>“What else should I investigate?”</li>
            </ul>
          </div>
        )}
        {turns.map((t) => (
          <div key={t.id} className={`vd-turn is-${t.who}${t.note === "working" ? " is-working" : ""}`}>
            <p>{t.text}</p>
            {t.card && <VoiceCard card={t.card} onSay={(s) => void ask(s)} />}
            {t.timing && (
              <span className="vd-timing">
                {t.timing.stt !== undefined && `heard ${t.timing.stt} ms · `}
                answered {t.timing.brain} ms
                {t.timing.voice !== undefined && ` · voice ${t.timing.voice} ms${t.timing.engine === "browser" ? " (browser)" : ""}`}
              </span>
            )}
          </div>
        ))}
      </div>

      <footer className="vd-foot">
        <button type="button" className="vd-mic" onClick={tap} aria-label={label[status]} data-status={status}>
          <span className="vd-ring" style={{ transform: `scale(${1 + level * 0.6})` }} />
          <MicIcon />
        </button>
        <div className="vd-status">
          <span>{label[status]}</span>
          <label className="vd-hf">
            <input type="checkbox" checked={handsFree} onChange={toggleHandsFree} /> Hands-free
          </label>
        </div>
        <form
          className="vd-type"
          onSubmit={(e) => {
            e.preventDefault();
            speaker.current?.unlock();
            const t = typed;
            setTyped("");
            void ask(t);
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="…or type a question" aria-label="Type a question" />
        </form>
      </footer>
    </aside>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

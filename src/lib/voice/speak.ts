// Speaking answers aloud. Piper (a neural voice in the local voice service, voice/server.py)
// when it is running, otherwise the browser's own voice. Only the short spoken line is read
// (the verdict, see Detective.tsx), never the whole answer. Taken from the voice branch (Medhu):
// every sentence is synthesised at once and they play in order, so the first starts in ~0.2 s.

let ctx: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;
/** Bumped by every speak() and stop, so an older answer still synthesising never plays. */
let gen = 0;

/** Markdown and symbols into words a voice reads naturally. */
export function forSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/\/\s*decade/g, " per decade")
    .replace(/\/\s*year/g, " per year")
    .replace(/°\s*C\b/g, " degrees")
    .replace(/[−–](?=\d)/g, "minus ")
    .replace(/\+(?=\d)/g, "plus ")
    .replace(/\s*;\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentences, with very short ones kept with their neighbour. */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const p of (text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [text]).map((x) => x.trim()).filter(Boolean)) {
    if (out.length && (p.length < 25 || out[out.length - 1].length < 25)) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out;
}

/** Call from a click or key press once: browsers start audio only after a gesture. */
export function unlockSpeech() {
  if (typeof window === "undefined") return;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

async function piper(text: string): Promise<AudioBuffer> {
  const res = await fetch("/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Piper ${res.status}`);
  return ctx!.decodeAudioData(await res.arrayBuffer());
}

function play(buf: AudioBuffer, mine: number) {
  return new Promise<void>((resolve) => {
    if (mine !== gen || !ctx) return resolve();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => resolve();
    playing = src;
    src.start();
  });
}

export async function speak(text: string) {
  if (typeof window === "undefined") return;
  stopSpeaking();
  const mine = gen;
  const parts = sentences(forSpeech(text));
  if (!parts.length) return;
  unlockSpeech();
  const jobs = parts.map(piper);
  jobs.forEach((j) => j.catch(() => {}));
  try {
    for (const job of jobs) {
      const buf = await job;
      if (mine !== gen) return;
      await play(buf, mine);
    }
  } catch {
    // The voice service is down or has no voice yet: the browser's voice reads it instead.
    if (mine === gen) browserVoice(parts);
  }
}

export function stopSpeaking() {
  gen++;
  try {
    playing?.stop();
  } catch {}
  playing = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
}

/* The fallback: the browser's voice, an enhanced or premium English one first. */

function pickVoice(): SpeechSynthesisVoice | null {
  const all = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const rank = (v: SpeechSynthesisVoice) =>
    (/premium/i.test(v.name) ? 8 : 0) +
    (/enhanced/i.test(v.name) ? 6 : 0) +
    (/^(Samantha|Daniel|Karen|Moira|Serena|Ava|Zoe|Evan|Google UK English Female)/.test(v.name) ? 4 : 0) +
    (v.lang === "en-US" || v.lang === "en-GB" || v.lang === "en-IN" ? 2 : 0) +
    (v.localService ? 1 : 0);
  return all.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

function browserVoice(parts: string[]) {
  if (!("speechSynthesis" in window)) return;
  const v = pickVoice();
  for (const p of parts) {
    const u = new SpeechSynthesisUtterance(p);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }
}

// Voices load late in Chrome: ask once early so the fallback has them.
if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.getVoices();

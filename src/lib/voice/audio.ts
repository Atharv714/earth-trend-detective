// Microphone capture with end-of-speech detection, Whisper transcription, and Piper playback.
// Audio goes to the local voice service as raw 16 kHz float32 PCM: no encoding or decoding on either side.

export interface SttResult {
  text: string;
  raw?: string;
  rejected?: string | null;
  confidence?: number;
  audio_s?: number;
  ms: number;
}

/* ------------------------------------------------------------------ */
/* Capture                                                             */

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("tap", Tap);
`;

export interface CaptureOptions {
  /** Called with the input level 0..1 for the meter. */
  onLevel?: (level: number) => void;
  /** Called when speech starts (hands-free mode). */
  onSpeech?: () => void;
  /** Silence after speech that ends the utterance. */
  silenceMs?: number;
  maxMs?: number;
  /** Hands-free: wait for speech before recording; otherwise record from the start. */
  waitForSpeech?: boolean;
}

export class Mic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;

  async open() {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "tap");
    this.src.connect(this.node);
  }

  close() {
    this.node?.disconnect();
    this.src?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = this.node = this.src = this.stream = null;
  }

  /**
   * Record one utterance. Resolves with 16 kHz mono PCM when the speaker stops
   * (silenceMs of quiet after speech), on stop(), or at maxMs.
   */
  record(opts: CaptureOptions = {}): { done: Promise<Float32Array | null>; stop: () => void } {
    const ctx = this.ctx!;
    const node = this.node!;
    const rate = ctx.sampleRate;
    const silenceMs = opts.silenceMs ?? 750;
    const maxMs = opts.maxMs ?? 15000;
    const chunks: Float32Array[] = [];
    const pre: Float32Array[] = []; // ~300 ms kept before speech starts (hands-free)
    let preLen = 0;
    let speaking = !opts.waitForSpeech;
    let heard = false;
    let quietFor = 0;
    let total = 0;
    let noise = 0.004;
    let resolve!: (v: Float32Array | null) => void;
    const done = new Promise<Float32Array | null>((r) => (resolve = r));
    let finished = false;

    const finish = (keep: boolean) => {
      if (finished) return;
      finished = true;
      node.port.onmessage = null;
      if (!keep || !heard || !chunks.length) return resolve(null);
      void downsample(concat(chunks), rate).then(resolve);
    };

    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const buf = e.data;
      const ms = (buf.length / rate) * 1000;
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      opts.onLevel?.(Math.min(1, rms * 12));
      const loud = rms > Math.max(0.012, noise * 3.2);
      if (!loud) noise = noise * 0.995 + rms * 0.005; // track the room's noise floor

      if (!speaking) {
        pre.push(buf);
        preLen += ms;
        while (preLen > 300 && pre.length > 1) preLen -= (pre.shift()!.length / rate) * 1000;
        if (loud) {
          speaking = true;
          heard = true;
          chunks.push(...pre);
          opts.onSpeech?.();
        }
        return;
      }
      chunks.push(buf);
      total += ms;
      if (loud) {
        heard = true;
        quietFor = 0;
      } else quietFor += ms;
      if ((heard && quietFor >= silenceMs) || total >= maxMs) finish(true);
      else if (!heard && total >= 6000) finish(false); // tapped but never spoke
    };

    return {
      done,
      stop: () => {
        heard = heard || chunks.length > 0;
        finish(true);
      },
    };
  }
}

function concat(chunks: Float32Array[]) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Proper resampling to 16 kHz through an OfflineAudioContext (band-limited, a few ms). */
async function downsample(pcm: Float32Array, rate: number): Promise<Float32Array> {
  if (rate === 16000) return pcm;
  const len = Math.ceil((pcm.length * 16000) / rate);
  const off = new OfflineAudioContext(1, len, 16000);
  const buf = off.createBuffer(1, pcm.length, rate);
  buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0).slice();
}

/* ------------------------------------------------------------------ */
/* Speech to text                                                      */

export async function transcribe(pcm: Float32Array): Promise<SttResult> {
  const t0 = performance.now();
  const res = await fetch("/api/voice/stt", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: pcm.buffer as ArrayBuffer,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? `Speech recognition failed (${res.status})`);
  return { ...j, ms: Math.round(performance.now() - t0) };
}

export async function health(): Promise<{ ready: boolean; error?: string | null; stt?: Record<string, unknown> } | null> {
  try {
    const r = await fetch("/api/voice/health", { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Text to speech                                                      */

/** Split into sentences so the first one can play while the rest are synthesised. */
export function sentences(text: string): string[] {
  const parts = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [text];
  const out: string[] = [];
  for (const p of parts.map((s) => s.trim()).filter(Boolean)) {
    // Keep very short pieces with the previous one ("p equals 0.03." etc.).
    if (out.length && (p.length < 25 || out[out.length - 1].length < 25)) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out;
}

export class Speaker {
  private ctx: AudioContext | null = null;
  private current: AudioBufferSourceNode | null = null;
  private gen = 0;
  /** Use the browser's built-in voice when the local service is down. */
  fallback = false;
  onState?: (speaking: boolean) => void;
  /** ms from speak() to the first sound. */
  onFirstAudio?: (ms: number, engine: "piper" | "browser") => void;

  private audio() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a user gesture once, so autoplay rules let us speak later. */
  unlock() {
    this.audio();
  }

  stop() {
    this.gen++;
    try {
      this.current?.stop();
    } catch {}
    this.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.onState?.(false);
  }

  async speak(text: string) {
    this.stop();
    const gen = this.gen;
    const parts = sentences(text);
    if (!parts.length) return;
    const t0 = performance.now();
    this.onState?.(true);
    if (this.fallback) return this.browser(parts, gen, t0);

    const ctx = this.audio();
    // Start synthesising every sentence now; play them in order as they arrive.
    const jobs = parts.map((p) => synth(ctx, p));
    try {
      for (let i = 0; i < jobs.length; i++) {
        const buf = await jobs[i];
        if (gen !== this.gen) return;
        if (i === 0) this.onFirstAudio?.(Math.round(performance.now() - t0), "piper");
        await this.play(ctx, buf, gen);
        if (gen !== this.gen) return;
      }
    } catch {
      if (gen !== this.gen) return;
      this.fallback = true;
      return this.browser(parts, gen, t0);
    }
    if (gen === this.gen) this.onState?.(false);
  }

  private play(ctx: AudioContext, buf: AudioBuffer, gen: number) {
    return new Promise<void>((resolve) => {
      if (gen !== this.gen) return resolve();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => resolve();
      this.current = src;
      src.start();
    });
  }

  private browser(parts: string[], gen: number, t0: number) {
    return new Promise<void>((resolve) => {
      if (typeof speechSynthesis === "undefined") return resolve();
      const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("en") && v.localService) ?? null;
      parts.forEach((p, i) => {
        const u = new SpeechSynthesisUtterance(p);
        if (voice) u.voice = voice;
        u.rate = 1.05;
        if (i === 0) u.onstart = () => this.onFirstAudio?.(Math.round(performance.now() - t0), "browser");
        if (i === parts.length - 1)
          u.onend = () => {
            if (gen === this.gen) this.onState?.(false);
            resolve();
          };
        speechSynthesis.speak(u);
      });
    });
  }
}

async function synth(ctx: AudioContext, text: string): Promise<AudioBuffer> {
  const res = await fetch("/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

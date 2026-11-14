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

  deviceId: string | null = null;

  async open(deviceId: string | null = null) {
    if (this.ctx && deviceId === this.deviceId) return;
    if (this.ctx) this.close();
    this.deviceId = deviceId;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
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
  /** One context per output device, so the same voice plays on all of them at once. */
  private ctxs = new Map<string, AudioContext>();
  private current: AudioBufferSourceNode[] = [];
  private gen = 0;
  /** Output device ids; empty = the system default. */
  private sinks: string[] = [];
  /** Use the browser's built-in voice when the local service is down. */
  fallback = false;
  onState?: (speaking: boolean) => void;
  /** ms from speak() to the first sound. */
  onFirstAudio?: (ms: number, engine: "piper" | "browser") => void;

  setSinks(ids: string[]) {
    const want = ids.length ? ids : [""];
    for (const [id, ctx] of this.ctxs) {
      if (!want.includes(id)) {
        void ctx.close();
        this.ctxs.delete(id);
      }
    }
    this.sinks = ids;
  }

  private contexts(): AudioContext[] {
    const want = this.sinks.length ? this.sinks : [""];
    return want.map((id) => {
      let ctx = this.ctxs.get(id);
      if (!ctx) {
        ctx = id ? makeContext(id) : new AudioContext();
        this.ctxs.set(id, ctx);
      }
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    });
  }

  /** Call from a user gesture once, so autoplay rules let us speak later. */
  unlock() {
    this.contexts();
  }

  stop() {
    this.gen++;
    for (const src of this.current) {
      try {
        src.stop();
      } catch {}
    }
    this.current = [];
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

    const ctxs = this.contexts();
    // Start synthesising every sentence now; play them in order as they arrive.
    const jobs = parts.map((p) => synth(ctxs[0], p));
    try {
      for (let i = 0; i < jobs.length; i++) {
        const buf = await jobs[i];
        if (gen !== this.gen) return;
        if (i === 0) this.onFirstAudio?.(Math.round(performance.now() - t0), "piper");
        await this.play(ctxs, buf, gen);
        if (gen !== this.gen) return;
      }
    } catch {
      if (gen !== this.gen) return;
      this.fallback = true;
      return this.browser(parts, gen, t0);
    }
    if (gen === this.gen) this.onState?.(false);
  }

  /** The same buffer on every output, started together; resolves when the longest finishes. */
  private play(ctxs: AudioContext[], buf: AudioBuffer, gen: number) {
    if (gen !== this.gen) return Promise.resolve();
    return Promise.all(
      ctxs.map(
        (ctx) =>
          new Promise<void>((resolve) => {
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            src.onended = () => resolve();
            this.current.push(src);
            src.start();
          }),
      ),
    ).then(() => {
      this.current = [];
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

function makeContext(sinkId: string): AudioContext {
  try {
    // Chrome/Edge 110+: pick the output device when creating the context.
    return new AudioContext({ sinkId } as AudioContextOptions);
  } catch {
    const ctx = new AudioContext();
    const c = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    void c.setSinkId?.(sinkId).catch(() => {});
    return ctx;
  }
}

/* ------------------------------------------------------------------ */
/* Devices                                                             */

export interface AudioDevice {
  id: string;
  label: string;
}

const HEADSET = /hands-?free|headset|headphone|neckband|cmf|nothing|buds|airpods|bluetooth|\bbt\b/i;
const BIG_SPEAKER = /hdmi|display ?audio|displayport|monitor|\btv\b|nvidia high definition|intel\(r\) display/i;

export async function listDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind: MediaDeviceKind) =>
    all
      .filter((d) => d.kind === kind && d.deviceId !== "communications")
      .map((d) => ({ id: d.deviceId, label: d.label || (d.deviceId === "default" ? "System default" : "Unnamed device") }));
  return { inputs: pick("audioinput"), outputs: pick("audiooutput") };
}

/** Prefer a headset / neckband mic when one is connected. */
export function preferredInput(inputs: AudioDevice[]): string | null {
  return inputs.find((d) => d.id !== "default" && HEADSET.test(d.label))?.id ?? null;
}

/**
 * Presentation default: the headset AND the HDMI/display speakers together when both are present.
 * Never the "default" alias next to a real device (that would play twice on the same one).
 */
export function preferredOutputs(outputs: AudioDevice[]): string[] {
  const real = outputs.filter((d) => d.id !== "default");
  // A Bluetooth headset shows up twice on Windows: "Headphones" (stereo, A2DP) and "Headset … Hands-Free"
  // (used while its mic is open). We keep the mic open, so the hands-free one is the live one; pick only one.
  const headsets = real.filter((d) => HEADSET.test(d.label) && !BIG_SPEAKER.test(d.label));
  const headset = headsets.find((d) => /hands-?free/i.test(d.label)) ?? headsets[0];
  const big = real.filter((d) => BIG_SPEAKER.test(d.label));
  const chosen = [...big, ...(headset ? [headset] : [])];
  return [...new Set(chosen.map((d) => d.id))];
}

/** Whether this browser can send audio to a chosen device (Chrome/Edge yes, Safari/Firefox no). */
export const canPickOutput = () => typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

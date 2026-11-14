// Microphone capture with end-of-speech detection, and Whisper transcription
// through the local service (voice/server.py). Taken from the voice branch (Medhu), speech-to-text only.
// Audio goes to the service as raw 16 kHz float32 PCM: no encoding or decoding on either side.

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


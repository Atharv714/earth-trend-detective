// Speech to text: ElevenLabs Scribe v2 through the Vercel AI Gateway (same
// AI_GATEWAY_API_KEY as the detective). The browser sends 16 kHz mono float32
// PCM (src/lib/voice/mic.ts); it goes on as a 16-bit WAV.
import { experimental_transcribe as transcribe, gateway } from "ai";

const MODEL = "elevenlabs/scribe-v2";
const RATE = 16000;
/** Spoken commands are short: cap at 30 s. */
const MAX_SAMPLES = RATE * 30;

/** float32 [-1, 1] mono PCM -> 16-bit WAV file. */
function wav(pcm: Float32Array): Uint8Array {
  const v = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true); // bytes per second
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true);
  return new Uint8Array(v.buffer);
}

export async function POST(req: Request) {
  if (!process.env.AI_GATEWAY_API_KEY) return Response.json({ error: "AI_GATEWAY_API_KEY is missing from .env" }, { status: 503 });

  const t0 = performance.now();
  const buf = await req.arrayBuffer();
  const pcm = new Float32Array(buf, 0, Math.floor(buf.byteLength / 4)).subarray(0, MAX_SAMPLES);
  if (pcm.length < RATE / 10) return Response.json({ text: "", rejected: "too short", audio_s: pcm.length / RATE, ms: 0 });

  try {
    const result = await transcribe({
      model: gateway.transcriptionModel(MODEL),
      audio: wav(pcm),
      abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]),
    });
    const text = result.text.trim();
    return Response.json({
      text,
      raw: text,
      rejected: text ? null : "no speech",
      audio_s: Math.round((pcm.length / RATE) * 100) / 100,
      ms: Math.round(performance.now() - t0),
    });
  } catch (e) {
    console.error("[scribe]", e);
    return Response.json({ error: "Speech recognition failed (Scribe v2 via AI Gateway)." }, { status: 502 });
  }
}

"""
Round-trip check of the running voice service: Piper speaks each phrase, Whisper transcribes it back.
Prints the transcript and the latency of each step.   .venv/Scripts/python selftest.py
"""

import io
import json
import time
import urllib.request
import wave

import numpy as np

URL = "http://127.0.0.1:8765"
PHRASES = [
    "Take me to the Amazon.",
    "Select vegetation.",
    "Compare historical and recent satellite observations using computer vision.",
    "Reveal NDVI trends across the region.",
    "Overlay precipitation and soil moisture.",
    "Calculate the trend slope and statistical significance.",
    "What else should I investigate?",
    "Show me rainfall in Rajasthan from 2005 to 2020.",
]


def post(path, data, ctype):
    req = urllib.request.Request(URL + path, data=data, headers={"content-type": ctype})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req) as r:
        body = r.read()
        return body, (time.perf_counter() - t0) * 1000, dict(r.headers)


def to16k(wav_bytes):
    with wave.open(io.BytesIO(wav_bytes)) as w:
        rate = w.getframerate()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    n = int(len(pcm) * 16000 / rate)
    return np.interp(np.linspace(0, len(pcm) - 1, n), np.arange(len(pcm)), pcm).astype(np.float32)


print(json.loads(urllib.request.urlopen(URL + "/health").read()))
for p in PHRASES:
    wav, tts_ms, h = post("/tts", json.dumps({"text": p}).encode(), "application/json")
    audio = to16k(wav)
    # A little silence either side, like a real recording.
    audio = np.concatenate([np.zeros(4000, np.float32), audio, np.zeros(6000, np.float32)])
    body, stt_ms, _ = post("/stt", audio.tobytes(), "application/octet-stream")
    r = json.loads(body)
    print(f"tts {tts_ms:5.0f} ms (synth {h.get('x-synth-ms', h.get('X-Synth-Ms'))} ms) | stt {stt_ms:5.0f} ms "
          f"(model {r['ms']} ms, {r['audio_s']} s audio) | {r['text']!r}")

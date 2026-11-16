"""
Earth Trend Detective: local Piper voice that speaks the detective's answers (optional).

  POST /tts        {text, lengthScale?} -> audio/wav
  GET  /health

Speech-to-text is not here: the app uses ElevenLabs Scribe v2 through the Vercel AI Gateway
(src/app/api/voice/stt/route.ts).
Without this service the browser's own voice speaks instead.
"""

from __future__ import annotations

import io
import logging
import os
import sys
import threading
import time
import wave
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
MODELS.mkdir(exist_ok=True)

log = logging.getLogger("voice")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def no_throttle(pid: int | None = None) -> None:
    """
    Windows puts window-less background processes in "efficiency mode" (EcoQoS): low clocks, efficiency cores.
    That made models ~8x slower inside the service than in a terminal. Opt this process (or a child) out of it.
    """
    if sys.platform != "win32":
        return
    import ctypes
    from ctypes import wintypes

    class State(ctypes.Structure):
        _fields_ = [("Version", wintypes.ULONG), ("ControlMask", wintypes.ULONG), ("StateMask", wintypes.ULONG)]

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    PROCESS_SET_INFORMATION = 0x0200
    handle = k32.OpenProcess(PROCESS_SET_INFORMATION, False, pid) if pid else k32.GetCurrentProcess()
    if not handle:
        return
    # ProcessPowerThrottling = 4; control EXECUTION_SPEED (1) with state 0 = never throttle.
    st = State(1, 1, 0)
    k32.SetProcessInformation(handle, 4, ctypes.byref(st), ctypes.sizeof(st))
    k32.SetPriorityClass(handle, 0x8000)  # ABOVE_NORMAL_PRIORITY_CLASS
    if pid:
        k32.CloseHandle(handle)


no_throttle()

# ---------------------------------------------------------------------------
# Text to speech: Piper (taken from the voice branch, Medhu)
# ---------------------------------------------------------------------------

PIPER_VOICE = os.environ.get("PIPER_VOICE", "en_US-lessac-medium")


def _tts_worker(conn, voice_path: str) -> None:
    """Separate process, so a slow synthesis never blocks the server."""
    from piper import PiperVoice

    no_throttle()
    voice = PiperVoice.load(voice_path)
    conn.send(("ready", voice.config.sample_rate))
    while True:
        msg = conn.recv()
        if msg is None:
            return
        text, length_scale = msg
        buf = io.BytesIO()
        try:
            with wave.open(buf, "wb") as wav:
                if hasattr(voice, "synthesize_wav"):  # piper-tts >= 1.3
                    from piper import SynthesisConfig

                    voice.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=length_scale))
                else:
                    voice.synthesize(text, wav, length_scale=length_scale)
            conn.send(("ok", buf.getvalue()))
        except Exception as e:  # keep the worker alive
            conn.send(("error", str(e)))


class Tts:
    def __init__(self) -> None:
        self.conn = None
        self.proc = None
        self.rate = 22050
        self.lock = threading.Lock()

    def load(self) -> None:
        import multiprocessing as mp

        path = MODELS / "piper" / f"{PIPER_VOICE}.onnx"
        if not path.exists():
            from prewarm import download_piper

            download_piper(PIPER_VOICE)
        ctx = mp.get_context("spawn")
        parent, child = ctx.Pipe()
        self.proc = ctx.Process(target=_tts_worker, args=(child, str(path)), daemon=True)
        self.proc.start()
        status, rate = parent.recv()
        self.conn, self.rate = parent, rate
        self.synth("Ready.")
        log.info("Piper ready: %s @ %d Hz (worker pid %s)", PIPER_VOICE, self.rate, self.proc.pid)

    def synth(self, text: str, length_scale: float | None = None) -> bytes:
        with self.lock:
            self.conn.send((text, length_scale))
            status, data = self.conn.recv()
        if status != "ok":
            raise RuntimeError(data)
        return data


tts = Tts()

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Earth Trend Detective voice service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["X-Audio-S", "X-Synth-Ms"])

state = {"tts": False, "tts_error": None}


@app.on_event("startup")
def _startup() -> None:
    def load_tts() -> None:
        try:
            tts.load()
            state["tts"] = True
        except Exception as e:  # report on /health; the browser voice stands in
            log.exception("Piper failed to start; answers use the browser voice")
            state["tts_error"] = str(e)

    threading.Thread(target=load_tts, daemon=True).start()


@app.get("/health")
def health() -> dict:
    return {"ready": state["tts"], "tts": PIPER_VOICE if state["tts"] else None, "tts_error": state["tts_error"]}


@app.post("/tts")
async def speak(req: Request) -> Response:
    if not state["tts"]:
        raise HTTPException(503, state["tts_error"] or "The voice is still loading")
    data = await req.json()
    text = str(data.get("text", "")).strip()[:1000]
    if not text:
        raise HTTPException(400, "Empty text")
    t0 = time.perf_counter()
    wav = await run_in_threadpool(tts.synth, text, data.get("lengthScale"))
    ms = round((time.perf_counter() - t0) * 1000)
    return Response(wav, media_type="audio/wav", headers={"X-Synth-Ms": str(ms), "Cache-Control": "no-store"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("VOICE_PORT", "8765")), log_level="info")

"""
Earth Trend Detective: local speech-to-text (taken from Medhu's voice service, speech-to-text only).

  POST /stt        16 kHz mono float32 PCM (application/octet-stream) or any audio file -> {text, ...}
  GET  /health

The text goes to the same router as the chat box (src/lib/router), so voice and typing behave the same.

Speech-to-text: Whisper large-v3-turbo on whisper.cpp (CUDA / Metal, flash attention, 15 s audio window);
falls back to faster-whisper (CTranslate2 fp16) when whisper.cpp isn't installed.
Runs offline once the model is downloaded (see prewarm.py).
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import sys
import threading
import time
import wave
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
CACHE = HERE / "cache"
MODELS.mkdir(exist_ok=True)
CACHE.mkdir(exist_ok=True)

log = logging.getLogger("voice")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def _add_nvidia_dll_dirs() -> None:
    """pip's nvidia-cublas/cudnn wheels put DLLs in site-packages/nvidia/*/bin; Windows needs them on the path."""
    if sys.platform != "win32":
        return
    import site

    for sp in site.getsitepackages():
        root = Path(sp) / "nvidia"
        if not root.exists():
            continue
        for bin_dir in root.glob("*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")


_add_nvidia_dll_dirs()


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

# Once the model is on disk, never touch the network for it: start-up works with Wi-Fi off.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
if any((MODELS / "whisper").glob("models--*/snapshots/*/model.bin")):
    os.environ.setdefault("HF_HUB_OFFLINE", "1")

# ---------------------------------------------------------------------------
# Speech to text
# ---------------------------------------------------------------------------

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")

# Words Whisper should expect. Biases decoding toward our place and science names.
VOCAB = (
    "Earth Trend Detective. NASA. NDVI, EVI, vegetation, greenness, precipitation, rainfall, soil moisture, "
    "groundwater, aerosol, haze, sea ice, sea level, Mann-Kendall, Sen's slope, p-value, trend, significance. "
    "Amazon, Amazon Basin, Congo, Borneo, Sahel, Sahara, Siberia, Arctic, Antarctica, Wisconsin, Punjab, Rajasthan, "
    "Kerala, Western Ghats, Himalaya, Gangetic plain, Andhra Pradesh, Amaravati, Delhi, Mumbai, Chennai, Kolkata, "
    "Bengaluru, Tamil Nadu, Mediterranean, Middle East, East Africa, Southeast Asia, US Southwest."
)

# Classic Whisper hallucinations on silence or noise.
HALLUCINATIONS = {
    "", "you", "thank you", "thank you.", "thanks for watching", "thanks for watching!", "thank you for watching",
    "thank you for watching.", "bye", "bye.", "so", "okay", ".", "...", "subtitles by the amara.org community",
}


class Stt:
    def __init__(self) -> None:
        self.model = None
        self.info: dict = {}
        self.lock = threading.Lock()

    def load(self) -> None:
        from faster_whisper import WhisperModel
        import ctranslate2

        cuda = ctranslate2.get_cuda_device_count() > 0
        device = "cuda" if cuda else "cpu"
        compute = "float16" if cuda else "int8"
        flash = False
        t0 = time.perf_counter()
        if not cuda and sys.platform == "darwin":
            try:  # Apple GPU (CTranslate2 "mps" backend is experimental): fall back to CPU if it fails
                self.model = WhisperModel(WHISPER_MODEL, device="mps", compute_type="float16",
                                          download_root=str(MODELS / "whisper"))
                device, compute = "mps", "float16"
            except Exception as e:
                log.warning("Apple GPU backend unavailable (%s); using CPU int8", e)
        if cuda:
            try:
                self.model = WhisperModel(WHISPER_MODEL, device=device, compute_type=compute, flash_attention=True,
                                          download_root=str(MODELS / "whisper"))
                flash = True
            except Exception as e:  # flash attention needs an Ampere+ GPU and a CT2 build with it
                log.warning("Flash attention unavailable (%s); loading without it", e)
        if self.model is None:
            self.model = WhisperModel(WHISPER_MODEL, device=device, compute_type=compute,
                                      cpu_threads=max(4, (os.cpu_count() or 8) - 2),
                                      download_root=str(MODELS / "whisper"))
        load_s = time.perf_counter() - t0
        # Warm up with a voice-like signal: silence would be cut by the VAD and never reach the decoder,
        # hiding a build without flash-attention kernels (CTranslate2's Windows wheels) until the first real request.
        t1 = time.perf_counter()
        try:
            self._warm()
        except RuntimeError as e:
            if not flash:
                raise
            log.warning("Flash attention failed at run time (%s); reloading without it", e)
            self.model = WhisperModel(WHISPER_MODEL, device=device, compute_type=compute,
                                      download_root=str(MODELS / "whisper"))
            flash = False
            self._warm()
        self.info = {"engine": "faster-whisper", "model": WHISPER_MODEL, "device": device, "compute_type": compute, "flash_attention": flash,
                     "load_s": round(load_s, 2), "warmup_s": round(time.perf_counter() - t1, 2)}
        log.info("Whisper ready: %s", self.info)

    def _warm(self) -> None:
        segs, _ = self.model.transcribe(spoken_sample(), language="en", beam_size=1, vad_filter=False,
                                        without_timestamps=True)
        list(segs)

    def transcribe(self, audio: np.ndarray, prompt: str | None = None) -> dict:
        t0 = time.perf_counter()
        with self.lock:
            segments, info = self.model.transcribe(
                audio,
                language="en",
                beam_size=1,  # greedy: fastest, and accurate enough for short commands
                temperature=0.0,
                condition_on_previous_text=False,
                without_timestamps=True,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 200},
                hotwords=VOCAB if prompt is None else f"{VOCAB} {prompt}",
                no_speech_threshold=0.6,
                log_prob_threshold=-1.0,
            )
            segs = list(segments)
        text = " ".join(s.text.strip() for s in segs).strip()
        no_speech = max((s.no_speech_prob for s in segs), default=1.0)
        logprob = float(np.mean([s.avg_logprob for s in segs])) if segs else -10.0
        rejected = None
        if text.lower().strip(" .!?") in {h.strip(" .!?") for h in HALLUCINATIONS}:
            rejected = "empty or filler"
        elif no_speech > 0.8 and logprob < -0.8:
            rejected = "no speech"
        return {
            "text": "" if rejected else text,
            "raw": text,
            "rejected": rejected,
            "confidence": round(float(np.exp(logprob)), 3),
            "audio_s": round(len(audio) / 16000, 2),
            "speech_s": round(getattr(info, "duration_after_vad", info.duration), 2),
            "ms": round((time.perf_counter() - t0) * 1000),
        }


def trim_silence(audio: np.ndarray) -> np.ndarray | None:
    """Cut leading/trailing silence (energy-based). None when there's no speech at all."""
    frame = 480  # 30 ms
    n = len(audio) // frame
    if n == 0:
        return None
    rms = np.sqrt(np.mean(audio[: n * frame].reshape(n, frame) ** 2, axis=1))
    floor = np.percentile(rms, 10)
    loud = np.where(rms > max(0.008, floor * 3))[0]
    if len(loud) < 3:  # under ~90 ms of sound
        return None
    a = max(0, (loud[0] - 7) * frame)  # keep 210 ms before
    b = min(len(audio), (loud[-1] + 10) * frame)  # and 300 ms after
    return audio[a:b]


def spoken_sample() -> np.ndarray:
    """A real spoken phrase at 16 kHz for warm-up (macOS `say`). Tones make Whisper loop; noise is the fallback."""
    try:
        import subprocess
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "warm.wav"
            subprocess.run(["say", "-o", str(path), "--data-format=LEI16@16000", "Take me to the Amazon rainforest."],
                           check=True, capture_output=True, timeout=10)
            with wave.open(str(path)) as w:
                return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    except Exception:
        rng = np.random.default_rng(0)
        return (rng.standard_normal(16000) * 0.01).astype(np.float32)


WHISPERCPP_DIR = MODELS / "whispercpp"
WHISPERCPP_MODEL = os.environ.get("WHISPERCPP_MODEL", "ggml-large-v3-turbo-q8_0.bin")
WHISPERCPP_PORT = int(os.environ.get("WHISPERCPP_PORT", "8766"))


def whispercpp_binary() -> str | None:
    import shutil

    found = list(WHISPERCPP_DIR.glob("bin/**/whisper-server.exe")) + list(WHISPERCPP_DIR.glob("bin/**/whisper-server"))
    return str(found[0]) if found else shutil.which("whisper-server")


class WhisperCpp:
    """
    Whisper large-v3-turbo on whisper.cpp: CUDA (Windows/Linux) or Metal (macOS), flash attention on.
    Runs whisper.cpp's own HTTP server as a child process; audio goes over localhost as 16-bit WAV.
    """

    def __init__(self) -> None:
        self.proc = None
        self.info: dict = {}
        self.lock = threading.Lock()
        # Shrinks the encoder's 30 s window to the length of a spoken command (768 frames = 15.4 s).
        self.audio_ctx = int(os.environ.get("WHISPER_AUDIO_CTX", "768"))

    @staticmethod
    def available() -> bool:
        return bool(whispercpp_binary()) and (WHISPERCPP_DIR / WHISPERCPP_MODEL).exists()

    def load(self) -> None:
        import atexit
        import subprocess
        import urllib.request

        exe = whispercpp_binary()
        args = [exe, "-m", str(WHISPERCPP_DIR / WHISPERCPP_MODEL), "--host", "127.0.0.1", "--port", str(WHISPERCPP_PORT),
                "-l", "en", "-fa", "-nf", "-bo", "1", "-t", "4", "-ac", str(self.audio_ctx)]
        t0 = time.perf_counter()
        log_file = open(CACHE / "whisper-server.log", "w")
        self.proc = subprocess.Popen(args, stdout=log_file, stderr=subprocess.STDOUT, cwd=str(Path(exe).parent))
        atexit.register(self.proc.kill)
        no_throttle(self.proc.pid)
        for _ in range(600):
            if self.proc.poll() is not None:
                raise RuntimeError(f"whisper-server exited ({self.proc.returncode}); see voice/cache/whisper-server.log")
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{WHISPERCPP_PORT}/", timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        load_s = time.perf_counter() - t0
        t1 = time.perf_counter()
        warm = spoken_sample()
        for _ in range(2):  # first call builds CUDA kernels; second shows steady-state speed
            self._infer(warm, None)
        log_text = (CACHE / "whisper-server.log").read_text(errors="ignore")
        gpu = "CUDA" if "CUDA" in log_text or "cuda" in log_text else ("Metal" if "Metal" in log_text else "CPU")
        flash = "flash_attn = 1" in log_text or "flash attn = 1" in log_text or "flash_attn    = 1" in log_text
        self.info = {"engine": "whisper.cpp", "model": WHISPERCPP_MODEL.replace("ggml-", "").replace(".bin", ""),
                     "device": "cuda" if gpu == "CUDA" else gpu.lower(), "flash_attention": flash or "-fa" in args,
                     "audio_ctx": self.audio_ctx, "load_s": round(load_s, 2), "warmup_s": round(time.perf_counter() - t1, 2)}
        log.info("whisper.cpp ready: %s", self.info)

    def _infer(self, audio: np.ndarray, prompt: str | None) -> str:
        import urllib.request
        import uuid

        wav = io.BytesIO()
        with wave.open(wav, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
        boundary = uuid.uuid4().hex
        fields = {"temperature": "0.0", "response_format": "json", "prompt": prompt or VOCAB}
        body = b""
        for k, v in fields.items():
            body += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\n'
                 f"Content-Type: audio/wav\r\n\r\n").encode() + wav.getvalue() + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(f"http://127.0.0.1:{WHISPERCPP_PORT}/inference", data=body,
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            import json

            return json.loads(r.read()).get("text", "").strip()

    def transcribe(self, audio: np.ndarray, prompt: str | None = None) -> dict:
        t0 = time.perf_counter()
        speech = trim_silence(audio)
        if speech is None:
            return {"text": "", "raw": "", "rejected": "no speech", "audio_s": round(len(audio) / 16000, 2), "ms": 0}
        speech = speech[: int(self.audio_ctx / 1500 * 30 * 16000)] if self.audio_ctx else speech
        with self.lock:
            text = self._infer(speech, f"{VOCAB} {prompt}" if prompt else None)
        text = " ".join(re.sub(r"\[[^\]]*\]|\([^)]*\)", "", text).split())  # [BLANK_AUDIO], (music), line breaks
        rejected = "empty or filler" if text.lower().strip(" .!?") in {h.strip(" .!?") for h in HALLUCINATIONS} else None
        return {"text": "" if rejected else text, "raw": text, "rejected": rejected,
                "audio_s": round(len(audio) / 16000, 2), "speech_s": round(len(speech) / 16000, 2),
                "ms": round((time.perf_counter() - t0) * 1000)}


STT_ENGINE = os.environ.get("STT_ENGINE", "auto")  # auto | whispercpp | faster-whisper
stt = WhisperCpp() if (STT_ENGINE == "whispercpp" or (STT_ENGINE == "auto" and WhisperCpp.available())) else Stt()

# ---------------------------------------------------------------------------
# Text to speech: Piper (taken from the voice branch, Medhu)
# ---------------------------------------------------------------------------

PIPER_VOICE = os.environ.get("PIPER_VOICE", "en_US-lessac-medium")


def _tts_worker(conn, voice_path: str) -> None:
    """Separate process: Piper's ONNX threads run 5-10x slower when they share a process with CUDA Whisper."""
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

state = {"ready": False, "error": None, "tts": False, "tts_error": None}
loaded = threading.Event()  # set once loading ends, ready or failed


@app.on_event("startup")
def _startup() -> None:
    def load() -> None:
        try:
            global stt
            try:
                stt.load()
            except Exception:
                if not isinstance(stt, WhisperCpp) or STT_ENGINE == "whispercpp":
                    raise
                log.exception("whisper.cpp failed to start; falling back to faster-whisper")
                stt = Stt()
                stt.load()
            state["ready"] = True
        except Exception as e:  # report on /health instead of crashing
            log.exception("Model load failed")
            state["error"] = str(e)
        finally:
            loaded.set()

    def load_tts() -> None:
        # Its own thread: a missing voice never stops speech-to-text, the browser voice stands in.
        try:
            tts.load()
            state["tts"] = True
        except Exception as e:
            log.exception("Piper failed to start; answers use the browser voice")
            state["tts_error"] = str(e)

    threading.Thread(target=load, daemon=True).start()
    threading.Thread(target=load_tts, daemon=True).start()


@app.get("/health")
def health() -> dict:
    return {"ready": state["ready"], "error": state["error"], "stt": stt.info,
            "tts": PIPER_VOICE if state["tts"] else None, "tts_error": state["tts_error"]}


async def _need_ready() -> None:
    # Speech that arrives while the model is still loading waits for it instead of failing.
    if not loaded.is_set():
        await asyncio.to_thread(loaded.wait, 30)
    if not state["ready"]:
        raise HTTPException(503, state["error"] or "Models are still loading")


@app.post("/stt")
async def transcribe(req: Request) -> dict:
    await _need_ready()
    body = await req.body()
    if not body:
        raise HTTPException(400, "Empty audio")
    ctype = req.headers.get("content-type", "")
    if ctype.startswith("application/octet-stream"):
        audio = np.frombuffer(body, dtype=np.float32)
    else:
        from faster_whisper import decode_audio

        audio = decode_audio(io.BytesIO(body), sampling_rate=16000)
    if len(audio) < 1600:
        return {"text": "", "rejected": "too short", "ms": 0, "audio_s": len(audio) / 16000}
    audio = audio[: 16000 * 30]  # commands are short; cap at 30 s
    return await run_in_threadpool(stt.transcribe, audio, req.query_params.get("prompt"))


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

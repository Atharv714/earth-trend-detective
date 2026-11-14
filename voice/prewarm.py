"""
Download everything the voice service needs, so the demo runs offline:
  * Whisper large-v3-turbo (CTranslate2)   * Piper voice   * NDVI change maps for the demo regions

    .venv/Scripts/python prewarm.py            (Windows)
    .venv/bin/python prewarm.py                (macOS / Linux)
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"

PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

# Regions the demo is likely to analyse (same boxes as src/lib/regions.ts) and the month GIBS compares.
DEMO_BOXES = {
    "amazon": ((-75, -15, -45, 5), 8),
    "congo": ((12, -5, 30, 5), 7),
    "borneo": ((108, -4, 119, 7), 8),
    "punjab": ((73.9, 29.5, 76.9, 32.5), 9),
    "rajasthan": ((69.5, 24.5, 76.5, 30), 9),
    "sahel": ((-17, 12, 40, 18), 9),
    "china": ((100, 20, 122, 42), 8),
    "india": ((68, 6, 98, 37), 10),
}


def download_piper(voice: str) -> None:
    lang, rest = voice.split("_", 1)
    region = f"{lang}_{rest.split('-')[0]}"
    name, quality = rest.split("-")[1], rest.split("-")[2]
    out = MODELS / "piper"
    out.mkdir(parents=True, exist_ok=True)
    for ext in (".onnx", ".onnx.json"):
        dst = out / f"{voice}{ext}"
        if dst.exists():
            continue
        url = f"{PIPER_BASE}/{lang}/{region}/{name}/{quality}/{voice}{ext}"
        print("downloading", url)
        urllib.request.urlretrieve(url, dst)


WHISPERCPP_RELEASE = "v1.9.0"  # last release with prebuilt Windows CUDA binaries


def download_whispercpp() -> None:
    """whisper.cpp (flash attention, CUDA/Metal) + the large-v3-turbo model in its format."""
    import platform
    import shutil
    import zipfile

    out = MODELS / "whispercpp"
    out.mkdir(parents=True, exist_ok=True)
    model = out / "ggml-large-v3-turbo-q8_0.bin"
    if not model.exists():
        url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin"
        print("downloading", url)
        urllib.request.urlretrieve(url, model.with_suffix(".part"))
        model.with_suffix(".part").rename(model)
    if sys.platform == "win32":
        if not list(out.glob("bin/**/whisper-server.exe")):
            url = f"https://github.com/ggml-org/whisper.cpp/releases/download/{WHISPERCPP_RELEASE}/whisper-cublas-12.4.0-bin-x64.zip"
            print("downloading", url)
            zpath = out / "bin.zip"
            urllib.request.urlretrieve(url, zpath)
            with zipfile.ZipFile(zpath) as z:
                z.extractall(out / "bin")
            zpath.unlink()
    elif not shutil.which("whisper-server"):
        hint = "brew install whisper-cpp" if platform.system() == "Darwin" else "build whisper.cpp with -DGGML_CUDA=ON"
        print(f"whisper.cpp not found: {hint} (falls back to faster-whisper until then)")


def main() -> None:
    import os

    voice = os.environ.get("PIPER_VOICE", "en_US-lessac-medium")
    download_piper(voice)
    print("piper voice ok")
    download_whispercpp()
    print("whisper.cpp ok")

    from faster_whisper import WhisperModel

    WhisperModel(os.environ.get("WHISPER_MODEL", "large-v3-turbo"), device="cpu", compute_type="int8",
                 download_root=str(MODELS / "whisper"))
    print("whisper model ok")

    if "--no-cv" in sys.argv:
        return
    from vision import change_detection

    for name, (box, month) in DEMO_BOXES.items():
        try:
            r = change_detection(box, 2002, 2024, month)
            print(f"cv {name}: loss {r['loss_pct']}%  gain {r['gain_pct']}%  ({r['ms']} ms)")
        except Exception as e:
            print(f"cv {name}: FAILED {e}")


if __name__ == "__main__":
    main()

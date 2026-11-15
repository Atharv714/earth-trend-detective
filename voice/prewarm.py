"""
Download the speech-to-text models, so the demo runs offline:
  * whisper.cpp large-v3-turbo (Metal / CUDA)   * Whisper large-v3-turbo for faster-whisper (the fallback)
  * the Piper voice that speaks answers

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

    import shutil

    download_piper(os.environ.get("PIPER_VOICE", "en_US-lessac-medium"))
    print("piper voice ok")
    download_whispercpp()
    print("whisper.cpp ok")
    if shutil.which("whisper-server") or list((MODELS / "whispercpp").glob("bin/**/whisper-server*")):
        return  # the faster-whisper copy (~1.6 GB) is only the fallback when whisper.cpp is missing

    from faster_whisper import WhisperModel

    WhisperModel(os.environ.get("WHISPER_MODEL", "large-v3-turbo"), device="cpu", compute_type="int8",
                 download_root=str(MODELS / "whisper"))
    print("whisper model ok")


if __name__ == "__main__":
    main()

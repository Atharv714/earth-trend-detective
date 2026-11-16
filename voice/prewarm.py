"""
Download the Piper voice that speaks answers, so it runs offline.

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


def main() -> None:
    import os

    download_piper(os.environ.get("PIPER_VOICE", "en_US-lessac-medium"))
    print("piper voice ok")


if __name__ == "__main__":
    main()

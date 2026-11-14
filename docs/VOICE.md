# Voice: speech-to-speech Trend Detective

Talk to the app; it moves the globe, runs the analysis and answers out loud. Everything runs **locally and offline**
(after a one-time setup): no cloud speech API, and **no language model writes the answers**, so nothing is made up.

```
 mic ─► AudioWorklet (end-of-speech detection, 16 kHz PCM)
          │  /api/voice/stt  (Next proxy)
          ▼
   voice/server.py ── Whisper large-v3-turbo · whisper.cpp · CUDA (Win) / Metal (Mac) · flash attention
                      (fallback: faster-whisper / CTranslate2 fp16)
          │  text
          ▼
   src/lib/voice/nlu.ts    grammar + fuzzy place matching → a command (or "I didn't understand")
   src/lib/voice/brain.ts  drives the globe/report, computes the answer from the same data + Mann-Kendall/Sen
                           code as the report, or calls the computer-vision service
          │  answer text (every number from the data)
          ▼
   voice/server.py ── Piper TTS, one request per sentence; the first sentence plays while the rest render
          ▼
       speaker
```

## Run it

```bash
npm run voice          # first run: creates voice/.venv, installs, downloads Whisper + Piper + demo CV maps, then serves :8765
npm run dev            # in another terminal
```

`npm run voice -- setup` re-installs and re-downloads (run it once with internet before a demo).
The panel's header shows `Whisper large-v3-turbo · GPU · flash attention · offline` when it's ready.
If the service isn't running, typing still works and answers use the browser's built-in voice.

**Talk:** tap the mic (it stops by itself when you stop speaking), or **hold Space**. Tick *Hands-free* to keep listening
after every answer. Tap the mic while it talks to interrupt.

## What you can say

| Say | It does |
|---|---|
| "Take me to the Amazon" / "Fly to Brazil" | Flies the globe there and gives the headline trend (unknown places: live NASA POWER lookup, needs internet) |
| "Select vegetation" / "Show rainfall" | Switches the question; says the definition and the trend |
| "Compare historical and recent satellite observations (using computer vision)" | Turns on the then-and-now maps and runs **pixel-by-pixel NDVI change detection** (below); drapes the change map on the globe |
| "Reveal the NDVI trend across the region" | Trend for the whole region, plus the pixel results if the CV ran |
| "Overlay precipitation and soil moisture" | Chart of the measurements together (standard deviations from their own average), each trend, and the year-to-year correlation with p-value |
| "Calculate the trend slope and statistical significance" | Sen's slope, % per decade, Mann-Kendall p, n, and the record-years count |
| "What else should I investigate?" | Up to 3 ranked leads from the data (unexplored measures here, the CV loss hotspot, the fastest change elsewhere). "The first one" runs it |
| "Only summer" · "From 2005 to 2020" · "Last 20 years" · "Whole record" | Season / years, then the re-tested trend |
| "Compare with the world" · "Why is this happening?" · "Where does the data come from?" | Comparison · general drivers + an offer to test clues · data source |
| "What is NDVI / a p-value / Sen's slope / Mann-Kendall?" | Fixed, checked definitions |
| "Play the Arctic story" · "Hide the change map" · "Go home" · "Repeat" · "Stop" · "Help" | |

## Why it doesn't hallucinate

* **No LLM in the loop.** Commands are recognised by a grammar; answers are templates filled with computed numbers.
  Anything it can't map to a command gets "I can only act on questions about the NASA data here", never a guess.
* **Same numbers as the screen:** the brain uses `src/lib/series.ts` (the report's loaders and trend test).
* **Honest wording:** not significant → "could be chance"; tiny but significant → "small, but steady"; correlation →
  "move together", never "caused by"; "why" gives general, well-established drivers and offers to test them.
* **Whisper guards:** VAD trims silence, `condition_on_previous_text=False`, temperature 0, a vocabulary hint with our
  place and science names, and the classic silence hallucinations ("Thank you.", "Thanks for watching") are dropped.

## Speed (RTX 4060 laptop, measured by `voice/selftest.py`)

| Step | Time |
|---|---|
| Whisper large-v3-turbo (q8_0), whisper.cpp, CUDA, **flash attention on**, audio window 768 (15 s) | **140–160 ms** per command |
| Brain (parse + data + trend test) | 1–75 ms (cached files) |
| Piper, first sentence | **70–200 ms** (the rest render while it plays) |

So an answer starts about **0.3–0.4 s** after you stop talking (plus the 0.75 s of silence that ends the recording).
Whisper understood 8 of the 8 demo commands; "NDVI" sometimes comes out as "and DVI", which the parser maps back.

Things that mattered:
* **whisper.cpp instead of faster-whisper.** CTranslate2's Windows wheels have no flash-attention kernels, and it always
  encodes a full 30 s window (~330 ms here). whisper.cpp has flash attention on CUDA and Metal and lets us shrink the
  encoder window to the length of a command (`WHISPER_AUDIO_CTX`, default 768).
* **Windows "efficiency mode".** Window-less background processes get throttled (EcoQoS), which made Piper ~8x slower.
  `no_throttle()` in `server.py` opts the service, the Piper worker and whisper-server out and raises their priority.
* **Piper runs in its own process** and every sentence is requested at once; playback starts with the first.
* Warm-up uses a real spoken phrase (a test tone sends Whisper into a decode loop).

macOS: `brew install whisper-cpp` gives `whisper-server` with Metal + flash attention; the service finds it on PATH.
Without it, the service falls back to faster-whisper on CPU (int8): slower (about 1–2 s) but still offline.

## Computer vision: where did the land change?

`voice/vision.py`. GIBS serves MODIS NDVI only as coloured images, so for each pixel we turn the colour back into NDVI
with NASA's own colormap (exact match), then:

1. **Composite:** median of 3 months × 3 years per period (e.g. Jul–Sep 2001–2003 vs 2023–2025), so clouds and one odd year don't decide it.
2. **Change:** now − then per pixel (~3–5 km pixels).
3. **Consistency test:** a pixel counts only if NDVI moved ≥ 0.05 **and** a per-pixel Welch t-test across the images gives |t| ≥ 2.1 (≈ p < 0.05).
4. **Area:** cos(latitude)-weighted % of land that lost / gained greenness; a 3×3 compass grid says where it's concentrated, plus the centre of the losses.

Results and images are cached in `voice/cache/`, so a region analysed once works offline (`prewarm.py` does the demo regions).
Region-wide Amazon NDVI is about flat; the pixel map is what shows where forest was lost. That's the story to tell.

## Files

* `voice/server.py` (STT/TTS/CV HTTP service), `voice/vision.py`, `voice/prewarm.py`, `voice/requirements.txt`
* `src/app/api/voice/[...path]/route.ts` same-origin proxy (`VOICE_URL`, default `http://127.0.0.1:8765`)
* `src/lib/voice/{nlu,brain,audio}.ts`, `src/components/voice/{VoiceDock,cards}.tsx`, `voice.css`
* `scripts/check-voice.mts`: run spoken commands against the real data without a browser:
  `SCRIPT="Take me to the Amazon.|Select vegetation.|What else should I investigate?" npx tsx scripts/check-voice.mts`
* `scripts/fetch-world-soil.mjs` → `public/trend_detective_data/07_world_soil_power/` (NASA POWER soil wetness for 20 world regions, so "overlay soil moisture" works outside India)

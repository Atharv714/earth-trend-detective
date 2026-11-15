// Headset button → talk (from the voice branch, Medhu). Bluetooth headset / neckband buttons (CMF Neckband Pro's knob, AirPods, etc.)
// reach a web page only through the browser's media controls (Media Session API), and the browser only
// routes them to a tab that owns an active media session. So once armed we keep an inaudible audio loop
// playing, and listen for every action a headset can send: play/pause (AVRCP), toggle-microphone and
// hang-up (hands-free calls). The button then works even when the tab or browser isn't focused.

type Handler = () => void;

/** 10 s of near-silence (±1 LSB dither at 8 kHz): long enough to count as real media, inaudible. */
function silentWav(): string {
  const rate = 8000;
  const n = rate * 10;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const s = (o: number, str: string) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, i % 2 ? 1 : -1, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

const ACTIONS = ["play", "pause", "stop", "togglemicrophone", "hangup"] as const;

export class HeadsetButton {
  private el: HTMLAudioElement | null = null;
  private last = 0;
  armed = false;
  onPress: Handler = () => {};
  onState: (armed: boolean) => void = () => {};

  /** Must be called from a user gesture (click / key), because of autoplay rules. */
  async arm() {
    if (this.armed || typeof window === "undefined" || !("mediaSession" in navigator)) return;
    if (!this.el) {
      this.el = new Audio(silentWav());
      this.el.loop = true;
      this.el.volume = 1; // muted media doesn't get a media session
    }
    try {
      await this.el.play();
    } catch {
      return; // no gesture yet: try again on the next one
    }
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({
      title: "Trend Detective: press to talk",
      artist: "Earth Trend Detective",
      album: "Voice assistant",
    });
    ms.playbackState = "playing";
    for (const a of ACTIONS) {
      try {
        ms.setActionHandler(a as MediaSessionAction, () => this.press());
      } catch {
        // Older browsers don't know togglemicrophone / hangup.
      }
    }
    // If something pauses our loop (another app grabbing audio focus), take it back on the next press.
    this.el.onpause = () => {
      if (this.armed) void this.el?.play().catch(() => {});
    };
    this.armed = true;
    this.onState(true);
  }

  private press() {
    const now = performance.now();
    if (now - this.last < 450) return; // some headsets send two actions per click
    this.last = now;
    // Keep the session "playing" so the next click arrives as an action again.
    navigator.mediaSession.playbackState = "playing";
    if (this.el?.paused) void this.el.play().catch(() => {});
    this.onPress();
  }

  /** Stop the loop and let go of the buttons. */
  disarm() {
    if (!this.armed) return;
    this.armed = false;
    if (this.el) {
      this.el.onpause = null;
      this.el.pause();
    }
    for (const a of ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(a as MediaSessionAction, null);
      } catch {}
    }
    this.onState(false);
  }

  /** Mirror the mic state in the browser's call controls, where supported. */
  setMicActive(on: boolean) {
    const ms = navigator.mediaSession as MediaSession & { setMicrophoneActive?: (a: boolean) => void };
    try {
      ms.setMicrophoneActive?.(on);
    } catch {}
  }

  /** Keyboard media keys (focused tab), e.g. a headset that shows up as a keyboard. */
  key(e: KeyboardEvent): boolean {
    if (e.key === "MediaPlayPause" || e.key === "MediaPlay" || e.key === "MediaPause" || e.code === "MediaPlayPause") {
      e.preventDefault();
      this.press();
      return true;
    }
    return false;
  }
}

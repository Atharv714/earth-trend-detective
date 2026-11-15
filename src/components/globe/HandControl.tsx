"use client";

// Steer the globe with one hand in front of the webcam (MediaPipe Hand Landmarker, in the browser).
//   open hand (five fingers): the globe follows the hand
//   all five fingertips bunched together: hands off, nothing moves
//   thumb and index tips touching: move up to zoom in, down to zoom out
//   with the before/after comparison on, a pinch moved sideways slides its line instead
//   fingers apart (no pinch) or any other pose: nothing moves
// Movement is relative (the globe moves by how far the hand moves) and linear. The palm centre is
// smoothed with a One Euro filter, and a pose must hold 3 frames before it counts.
// The runtime (public/mediapipe/wasm, copied on install) and the model (public/mediapipe) are
// served by the app, so it works offline. Toggle with the button or the H key.

import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { CesiumWidget, PerspectiveFrustum } from "cesium";
import { useEffect, useRef, useState } from "react";
import type { Cesium } from "@/lib/cesium";
import "./hands.css";

/** Sent to the globe's canvas while the hand moves it, so the idle spin stays asleep. */
export const HAND_ACTIVE_EVENT = "hand-active";
/** Sent on window with a pixel delta (detail) to slide the before/after line (CesiumGlobe.tsx, Split). */
export const HAND_SPLIT_EVENT = "hand-split";

type Mode = "none" | "off" | "turn" | "zoom" | "slide";

const LABEL: Record<Mode, string> = {
  none: "Show your hand to the camera",
  off: "Hands off · open hand to turn, pinch to zoom",
  turn: "Turning · bunch your fingers to stop",
  zoom: "Up to zoom in, down to zoom out",
  slide: "Sliding the line · open your fingers to stop",
};

/** Frames a new pose must hold before it counts. */
const HOLD_FRAMES = 3;
/** Screen pixels of drag per camera width of hand travel, as a share of the screen width. */
const TURN_SPEED = 1.6;
/** Zoom: the height changes by e^(camera widths moved × this). A third of the view is about 3×. */
const ZOOM_SPEED = 3.5;
/** The comparison line moves this many screen widths per camera width of hand travel. */
const SLIDE_SPEED = 1.2;
/** How far (in camera widths) a pinch moves before it decides: zoom (up/down) or slide (sideways). */
const AXIS_LOCK = 0.02;
const MIN_HEIGHT = 300;
const MAX_HEIGHT = 4e7;

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Hand size: wrist to the middle knuckle, so the thresholds hold near or far from the camera. */
const size = (h: NormalizedLandmark[]) => dist(h[0], h[9]) || 1e-3;
const TIPS = [4, 8, 12, 16, 20];

/** All five fingertips bunched together. */
const bunched = (h: NormalizedLandmark[]) => {
  const c = TIPS.reduce((a, i) => ({ x: a.x + h[i].x / 5, y: a.y + h[i].y / 5, z: a.z + h[i].z / 5 }), { x: 0, y: 0, z: 0 });
  return Math.max(...TIPS.map((i) => dist(h[i], c))) < size(h) * 0.45;
};
/** Thumb–index tip distance for the hand's size (a pinch is small). */
const pinchRatio = (h: NormalizedLandmark[]) => dist(h[4], h[8]) / size(h);
/** Four fingers out: each tip farther from the wrist than its middle joint. */
const open = (h: NormalizedLandmark[]) =>
  [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ].every(([tip, pip]) => dist(h[0], h[tip]) > dist(h[0], h[pip]) * 1.12);

/** One Euro filter (Casiez et al., CHI 2012): steady when still, little lag when fast. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  reset() {
    this.x = null;
    this.dx = 0;
  }
  filter(v: number, t: number) {
    if (this.x == null) {
      this.x = v;
      this.t = t;
      return v;
    }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.t = t;
    const alpha = (fc: number) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
    this.dx += alpha(1) * ((v - this.x) / dt - this.dx);
    this.x += alpha(1.4 + 3 * Math.abs(this.dx)) * (v - this.x);
    return this.x;
  }
}

export function HandControl({ C, widget, left, bottom }: { C: Cesium; widget: CesiumWidget; left: number; bottom: number }) {
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("none");
  const video = useRef<HTMLVideoElement>(null);
  const bones = useRef<HTMLCanvasElement>(null);

  // H turns it on and off (not while typing).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "h" || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
      setOn((o) => !o);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    if (!on) return;
    const canvas = widget.scene.canvas;
    const camera = widget.camera;
    let dead = false;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;
    let frame = 0;
    let connections: { start: number; end: number }[] = [];

    const moved = () => {
      widget.scene.requestRender();
      canvas.dispatchEvent(new Event(HAND_ACTIVE_EVENT));
    };

    /** Turn the globe as if the hand dragged its surface by (dx, dy) screen pixels; north stays up. */
    const orbit = (dx: number, dy: number) => {
      const h = camera.positionCartographic.height;
      const fovy = (camera.frustum as PerspectiveFrustum).fovy ?? 1;
      const radPerPx = (Math.min(h, 1.2e7) * 2 * Math.tan(fovy / 2)) / canvas.clientHeight / 6.371e6;
      const p = C.Cartesian3.normalize(camera.position, new C.Cartesian3());
      const toNorth = Math.acos(Math.min(1, Math.max(-1, p.z)));
      camera.rotate(C.Cartesian3.UNIT_Z, (dx * radPerPx) / Math.max(Math.sin(toNorth), 0.25));
      const up = Math.min(toNorth - 0.05, Math.max(-(Math.PI - toNorth - 0.05), dy * radPerPx));
      const east = C.Cartesian3.cross(C.Cartesian3.UNIT_Z, p, new C.Cartesian3());
      if (C.Cartesian3.magnitude(east) > 1e-6) camera.rotate(C.Cartesian3.normalize(east, east), up);
      moved();
    };

    /** Multiply the camera's height by factor (below 1 is in). */
    const zoom = (factor: number) => {
      const h = camera.positionCartographic.height;
      camera.zoomIn(h - Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h * factor)));
      moved();
    };

    let mode: Mode = "none";
    let pending: Mode = "none";
    let held = 0;
    let pinched = false;
    const fx = new OneEuro();
    const fy = new OneEuro();
    let last: { x: number; y: number } | null = null;
    // Each pinch does one job: zoom or slide, picked by its first movement, kept until it lets go.
    let axis: "zoom" | "slide" | null = null;
    let travel = { x: 0, y: 0 };
    const comparing = () => !!document.querySelector(".split");

    const draw = (hand: NormalizedLandmark[] | undefined) => {
      const c = bones.current;
      const g = c?.getContext("2d");
      if (!c || !g) return;
      g.clearRect(0, 0, c.width, c.height);
      if (!hand) return;
      const P = (l: NormalizedLandmark) => [(1 - l.x) * c.width, l.y * c.height] as const;
      g.lineWidth = 2;
      g.strokeStyle = mode === "turn" ? "#7fe0ff" : mode === "zoom" || mode === "slide" ? "#ffd27a" : "rgba(255,255,255,0.7)";
      g.fillStyle = "#fff";
      for (const { start, end } of connections) {
        const [ax, ay] = P(hand[start]);
        const [bx, by] = P(hand[end]);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
      for (const l of hand) {
        const [x, y] = P(l);
        g.beginPath();
        g.arc(x, y, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    };

    const setBoth = (m: Mode) => {
      if (m === mode) return;
      if (m === "turn" || m === "zoom") camera.cancelFlight();
      mode = m;
      axis = null;
      travel = { x: 0, y: 0 };
      setMode(m);
    };

    const step = (hand: NormalizedLandmark[] | undefined, now: number) => {
      draw(hand);
      if (!hand) {
        setBoth("none");
        pending = "none";
        held = 0;
        pinched = false;
        fx.reset();
        fy.reset();
        last = null;
        return;
      }

      // The palm centre (wrist and knuckles): it barely moves when the fingers change pose.
      const raw = {
        x: 1 - (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5, // mirrored: right is right
        y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
      };
      const pos = { x: fx.filter(raw.x, now), y: fy.filter(raw.y, now) };

      // Bunched fingertips first: there the thumb and index touch too, but it means stop.
      const all = bunched(hand);
      const r = pinchRatio(hand);
      pinched = !all && (pinched ? r < 0.55 : r < 0.33);
      const want: Mode = all ? "off" : pinched ? "zoom" : open(hand) ? "turn" : "off";

      if (want === pending) held++;
      else {
        pending = want;
        held = 1;
      }
      if (want !== mode && held >= HOLD_FRAMES) setBoth(want);
      if (mode === "none") setBoth("off");

      // Move only while the pose agrees with the mode: the moment it starts to change, freeze.
      if (last && want === mode) {
        const dx = pos.x - last.x;
        const dy = pos.y - last.y;
        if (mode === "turn") orbit(dx * window.innerWidth * TURN_SPEED, dy * window.innerWidth * TURN_SPEED);
        else if (mode === "zoom") {
          if (!axis) {
            // Without the comparison on, a pinch only zooms. With it, wait for the hand to show its direction.
            if (!comparing()) axis = "zoom";
            else {
              travel = { x: travel.x + Math.abs(dx), y: travel.y + Math.abs(dy) };
              if (travel.x + travel.y > AXIS_LOCK) {
                axis = travel.x > travel.y ? "slide" : "zoom";
                if (axis === "slide") setMode("slide");
              }
            }
          }
          if (axis === "zoom" && Math.abs(dy) > 1e-4) zoom(Math.exp(dy * ZOOM_SPEED));
          else if (axis === "slide") window.dispatchEvent(new CustomEvent(HAND_SPLIT_EVENT, { detail: dx * window.innerWidth * SLIDE_SPEED }));
        }
      }
      last = pos;
    };

    (async () => {
      try {
        setStatus("loading");
        setError(null);
        const [{ FilesetResolver, HandLandmarker }, media] = await Promise.all([
          import("@mediapipe/tasks-vision"),
          navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false }),
        ]);
        stream = media;
        if (dead) return;
        connections = HandLandmarker.HAND_CONNECTIONS;
        const files = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        landmarker = await HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        const v = video.current;
        if (dead || !v) return;
        v.srcObject = stream;
        await v.play();
        setStatus("ready");
        let seen = -1;
        const loop = (now: number) => {
          if (dead) return;
          if (v.readyState >= 2 && v.currentTime !== seen) {
            seen = v.currentTime;
            step(landmarker!.detectForVideo(v, now).landmarks[0], now);
          }
          frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
      } catch (e) {
        if (dead) return;
        setStatus("error");
        setError(e instanceof Error && e.name === "NotAllowedError" ? "Camera blocked: allow it in the address bar." : (e as Error).message || "The camera did not start.");
      }
    })();

    return () => {
      dead = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
      setMode("none");
    };
  }, [on, C, widget]);

  return (
    <div className="hands" style={{ left, bottom }}>
      {on && (
        <div className="hands-cam" data-mode={mode}>
          <video ref={video} muted playsInline />
          <canvas ref={bones} width={192} height={144} />
          <p className="hands-status">{status === "loading" ? "Starting the camera…" : status === "error" ? error : LABEL[mode]}</p>
        </div>
      )}
      <button type="button" className="hands-toggle" aria-pressed={on} onClick={() => setOn((o) => !o)} title="Steer the globe with your hand (H)">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-7.5v-1a1.5 1.5 0 0 1 3 0V12m0-6.5a1.5 1.5 0 0 1 3 0V13m0-4.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.6-2.2L3.6 16a1.6 1.6 0 0 1 2.4-2.1L8 16" />
        </svg>
        {on ? "Hands on" : "Hand control"}
      </button>
    </div>
  );
}

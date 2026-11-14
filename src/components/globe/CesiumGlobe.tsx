"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Cartesian3,
  CesiumWidget,
  ImageryLayer,
  PerspectiveFrustum,
  PointPrimitiveCollection,
  PolylineCollection,
  Rectangle,
} from "cesium";
import { loadCesium, type Cesium } from "@/lib/cesium";
import { BASE, BORDERS, regionBox, tileUrl, type TileSource } from "@/lib/gibs";
import type { Region } from "@/lib/regions";

export interface Compare {
  source: TileSource;
  before: { time: string; label: string };
  after: { time: string; label: string };
}

interface Props {
  regions: Region[];
  colors: Record<string, string | undefined>;
  selected: Region | null;
  onSelect: (id: string | null) => void;
  /** Two years of imagery side by side, shown only when asked for. */
  compare: Compare | null;
  /** Screen space covered by floating UI, so the camera frames the area in what is left. */
  inset: { left: number; top: number; right: number; bottom: number };
  resetToken: number;
  /** A picture draped over a box on the globe (the voice assistant's computer-vision change map). */
  overlay?: { url: string; bbox: [number, number, number, number] } | null;
}

interface Scene {
  C: Cesium;
  widget: CesiumWidget;
  points: PointPrimitiveCollection;
  outline: PolylineCollection;
}

const HOME = { lon: 62, lat: 18, height: 2.1e7 };
/** Quiet seconds on the home view before the Earth starts turning. */
const IDLE_SECONDS = 3;
/** One full turn in about two minutes. */
const SPIN_DEG_PER_S = 3;

export default function CesiumGlobe(props: Props) {
  const { regions, colors, selected, onSelect, compare, inset, resetToken, overlay } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);

  const onSelectRef = useRef(onSelect);
  const regionsRef = useRef(regions);
  useEffect(() => {
    onSelectRef.current = onSelect;
    regionsRef.current = regions;
  }, [onSelect, regions]);

  // Start Cesium once.
  useEffect(() => {
    let dead = false;
    let widget: CesiumWidget | undefined;

    loadCesium().then(
      (C) => {
        if (dead || !hostRef.current) return;
        const credits = document.createElement("div");
        widget = new C.CesiumWidget(hostRef.current, {
          baseLayer: new C.ImageryLayer(provider(C, BASE)),
          creditContainer: credits,
          requestRenderMode: true,
          maximumRenderTimeChange: Infinity,
          // Retina at full density is 4x the pixels; 1.5x looks as sharp and keeps the frame rate up.
          useBrowserRecommendedResolution: false,
          msaaSamples: 1,
        });
        const s = widget.scene;
        // The graphics chip, not JavaScript, was the limit: 1.5x density stuttered
        // while moving (13 slow frames in 3 s) and 1x was a steady 60 fps. So draw
        // at 1x while the camera moves and go back to sharp 1.5x once it stops.
        const dpr = window.devicePixelRatio;
        const sharp = Math.min(dpr, 1.5) / dpr;
        const fast = 1 / dpr;
        widget.resolutionScale = sharp;
        widget.camera.moveStart.addEventListener(() => (widget!.resolutionScale = fast));
        widget.camera.moveEnd.addEventListener(() => {
          widget!.resolutionScale = sharp;
          s.requestRender();
        });
        s.globe.baseColor = C.Color.BLACK;
        s.globe.tileCacheSize = 400;
        s.backgroundColor = C.Color.fromCssColorString("#000005");
        s.screenSpaceCameraController.minimumZoomDistance = 30_000;
        s.screenSpaceCameraController.maximumZoomDistance = 4e7;
        if (s.skyAtmosphere) s.skyAtmosphere.show = true;

        const overlay = (src: TileSource, alpha: number) => {
          const l = s.imageryLayers.addImageryProvider(provider(C, src));
          l.alpha = alpha;
          return l;
        };
        // Borders only: a labels layer doubles the tile traffic for little gain.
        overlay(BORDERS, 0.55);

        const points = s.primitives.add(new C.PointPrimitiveCollection()) as PointPrimitiveCollection;
        const outline = s.primitives.add(new C.PolylineCollection()) as PolylineCollection;

        widget.camera.setView({ destination: C.Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height) });

        const handler = new C.ScreenSpaceEventHandler(s.canvas);
        // Find the dot under the mouse with plain maths. scene.pick() redraws
        // the whole globe off-screen and cost ~85 ms per mouse move.
        const screen = new C.Cartesian2();
        const toEye = new C.Cartesian3();
        const pickId = (pos: { x: number; y: number }) => {
          const eye = widget!.camera.positionWC;
          let best: string | null = null;
          let bestD = Infinity;
          for (let i = 0; i < points.length; i++) {
            const p = points.get(i);
            // Skip dots on the far side of the Earth.
            C.Cartesian3.subtract(eye, p.position, toEye);
            if (C.Cartesian3.dot(toEye, p.position) <= 0) continue;
            if (!C.SceneTransforms.worldToWindowCoordinates(s, p.position, screen)) continue;
            const d = Math.hypot(screen.x - pos.x, screen.y - pos.y);
            if (d <= p.pixelSize / 2 + 5 && d < bestD) {
              bestD = d;
              best = p.id as string;
            }
          }
          return best;
        };
        // At most once per frame, and never while dragging the globe or when no dots are shown.
        let queued: { x: number; y: number } | null = null;
        let lastId: string | null = null;
        let dragging = false;
        s.canvas.addEventListener("pointerdown", () => (dragging = true));
        window.addEventListener("pointerup", () => (dragging = false));
        handler.setInputAction((e: { endPosition: { x: number; y: number } }) => {
          if (dragging || points.length === 0) {
            if (lastId) {
              lastId = null;
              s.canvas.style.cursor = "";
              setHover(null);
            }
            return;
          }
          const first = !queued;
          queued = { x: e.endPosition.x, y: e.endPosition.y };
          if (!first) return;
          requestAnimationFrame(() => {
            const pos = queued!;
            queued = null;
            const id = pickId(pos);
            const r = id ? regionsRef.current.find((x) => x.id === id) : null;
            s.canvas.style.cursor = r ? "pointer" : "";
            if (id !== lastId || r) setHover(r ? { name: r.name, x: pos.x, y: pos.y } : null);
            lastId = id;
          });
        }, C.ScreenSpaceEventType.MOUSE_MOVE);
        handler.setInputAction((e: { position: { x: number; y: number } }) => {
          const id = pickId(e.position);
          if (id) onSelectRef.current(id);
        }, C.ScreenSpaceEventType.LEFT_CLICK);

        setScene({ C, widget, points, outline });
      },
      (e: Error) => !dead && setError(e.message),
    );

    return () => {
      dead = true;
      widget?.destroy();
    };
    // Cesium starts once; regions and onSelect are read through refs.
  }, []);

  // Markers: one dot per place, coloured by its trend. Hidden while comparing a place.
  useEffect(() => {
    if (!scene) return;
    const { C, points } = scene;
    points.removeAll();
    if (!selected) {
      for (const r of regions) {
        if (r.id === "world") continue;
        points.add({
          id: r.id,
          position: C.Cartesian3.fromDegrees(r.lon, r.lat, 2000),
          pixelSize: r.bbox ? 11 : 8,
          color: C.Color.fromCssColorString(colors[r.id] ?? "#8e8e93"),
          outlineColor: C.Color.fromCssColorString("rgba(255,255,255,0.9)"),
          outlineWidth: 1.5,
        });
      }
    }
    scene.widget.scene.requestRender();
  }, [scene, regions, colors, selected]);

  // Outline of the open place.
  useEffect(() => {
    if (!scene) return;
    const { C, outline } = scene;
    outline.removeAll();
    const box = selected && regionBox(selected);
    if (box) {
      const material = C.Material.fromType("Color", { color: C.Color.WHITE.withAlpha(0.85) });
      for (const ring of boxLines(box)) {
        outline.add({ positions: C.Cartesian3.fromDegreesArrayHeights(ring), width: 1.5, material });
      }
    }
    scene.widget.scene.requestRender();
  }, [scene, selected]);

  // Before/after imagery, split left and right.
  const beforeT = compare?.before.time;
  const afterT = compare?.after.time;
  const source = compare?.source;
  useEffect(() => {
    if (!scene || !source || !beforeT || !afterT) return;
    const { C, widget } = scene;
    const layers = widget.scene.imageryLayers;
    // Only inside the open place's box: Mumbai shows Mumbai, not the whole world.
    const box = selected && regionBox(selected);
    const rectangle = box ? C.Rectangle.fromDegrees(...box) : undefined;
    const add = (time: string, side: "LEFT" | "RIGHT") => {
      const l: ImageryLayer = new C.ImageryLayer(provider(C, source, time), { rectangle });
      l.splitDirection = C.SplitDirection[side];
      layers.add(l, 1); // just above the base
      return l;
    };
    const before = add(beforeT, "LEFT");
    const after = add(afterT, "RIGHT");
    widget.scene.requestRender();
    return () => {
      layers.remove(before, true);
      layers.remove(after, true);
      widget.scene.requestRender();
    };
  }, [scene, selected, source, beforeT, afterT]);

  // Change map from the computer-vision comparison, on top of everything.
  const overlayUrl = overlay?.url;
  const overlayBox = overlay?.bbox.join(",");
  useEffect(() => {
    if (!scene || !overlayUrl || !overlayBox) return;
    const { C, widget } = scene;
    const layers = widget.scene.imageryLayers;
    let layer: ImageryLayer | null = null;
    let gone = false;
    const [w, s0, e, n] = overlayBox.split(",").map(Number);
    C.SingleTileImageryProvider.fromUrl(overlayUrl, { rectangle: C.Rectangle.fromDegrees(w, s0, e, n) }).then((p) => {
      if (gone) return;
      layer = layers.addImageryProvider(p);
      layer.alpha = 0.9;
      widget.scene.requestRender();
    });
    return () => {
      gone = true;
      if (layer) layers.remove(layer, true);
      widget.scene.requestRender();
    };
  }, [scene, overlayUrl, overlayBox]);

  // Idle spin: on the home view, after a few quiet seconds, turn the Earth
  // slowly west to east. Any touch, drag, scroll or key stops it at once.
  useEffect(() => {
    if (!scene || selected) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { C, widget } = scene;
    const canvas = widget.scene.canvas;
    let quietSince = performance.now();
    let last = quietSince;
    let frame = 0;
    const wake = () => (quietSince = performance.now());
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      const idle = (now - quietSince) / 1000 - IDLE_SECONDS;
      if (idle > 0) {
        // Ease in over two seconds so the start is not a jolt.
        const speed = SPIN_DEG_PER_S * Math.min(idle / 2, 1);
        widget.camera.rotate(C.Cartesian3.UNIT_Z, C.Math.toRadians(speed * dt));
        widget.scene.requestRender();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const events = ["pointerdown", "wheel", "touchstart"] as const;
    for (const e of events) canvas.addEventListener(e, wake, { passive: true });
    window.addEventListener("keydown", wake);
    return () => {
      cancelAnimationFrame(frame);
      for (const e of events) canvas.removeEventListener(e, wake);
      window.removeEventListener("keydown", wake);
    };
  }, [scene, selected, resetToken]);

  // Camera: fly to the open place, or back home.
  const insetKey = `${inset.left},${inset.top},${inset.right},${inset.bottom}`;
  useEffect(() => {
    if (!scene) return;
    const { C, widget } = scene;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = widget.scene.canvas;
    const box = selected && regionBox(selected);
    const [l, t, r, b] = insetKey.split(",").map(Number);

    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const fov = (widget.camera.frustum as PerspectiveFrustum).fov ?? Math.PI / 3;
    let view: { destination: Cartesian3 | Rectangle; heading: number };
    if (!box) {
      view = framed(C, fov, W, H, HOME.lon, HOME.lat, HOME.height, l, t, r, b);
    } else if (box[2] - box[0] >= 300) {
      // Arctic or Antarctic: look straight down on the pole.
      view = framed(C, fov, W, H, 0, box[1] > 0 ? 90 : -90, 7.5e6, l, t, r, b);
    } else {
      view = { destination: paddedRect(C, box, W, H, l, t, r, b), heading: 0 };
    }
    widget.camera.flyTo({
      destination: view.destination,
      orientation: { heading: view.heading, pitch: -Math.PI / 2, roll: 0 },
      duration: reduce ? 0 : 1.8,
      easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
    });
  }, [scene, selected, insetKey, resetToken]);

  return (
    <div className="cesium-host" ref={hostRef}>
      {!scene && !error && <div className="globe-loading">Loading Earth</div>}
      {error && <div className="globe-loading">{error}</div>}
      {hover && !selected && (
        <div className="globe-label" style={{ left: hover.x, top: hover.y }}>
          {hover.name}
        </div>
      )}
      {scene && compare && (
        <Split key={selected?.id} scene={scene} inset={inset} before={compare.before.label} after={compare.after.label} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** The draggable line between the two years. */
function Split({ scene, inset, before, after }: { scene: Scene; inset: Props["inset"]; before: string; after: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => {
    const w = window.innerWidth;
    return (inset.left + (w - inset.left - inset.right) / 2) / w;
  });

  useEffect(() => setSplit(scene, pos), [scene, pos]);

  const move = (clientX: number) => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const r = host.getBoundingClientRect();
    setPos(Math.min(0.97, Math.max(0.03, (clientX - r.left) / r.width)));
  };

  return (
    <div
      ref={ref}
      className="split"
      style={{ left: `${pos * 100}%` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && move(e.clientX)}
    >
      <span className="split-tag is-before">{before}</span>
      <button
        type="button"
        className="split-knob"
        role="slider"
        aria-label="Move the line between the two years"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos * 100)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          if (e.key === "ArrowLeft") setPos((p) => Math.max(0.03, p - step));
          if (e.key === "ArrowRight") setPos((p) => Math.min(0.97, p + step));
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M6 4 2 8l4 4M10 4l4 4-4 4" />
        </svg>
      </button>
      <span className="split-tag is-after">{after}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function setSplit(s: Scene, fraction: number) {
  s.widget.scene.splitPosition = fraction;
  s.widget.scene.requestRender();
}

function provider(C: Cesium, src: TileSource, time?: string) {
  // GIBS EPSG:4326 tiles are 512 px; level 0 is two tiles of 288° each,
  // so the tile grid runs past the date line and below the South Pole.
  const p = new C.UrlTemplateImageryProvider({
    url: tileUrl(src, time),
    tilingScheme: new C.GeographicTilingScheme({
      rectangle: C.Rectangle.fromDegrees(-180, -198, 396, 90),
      numberOfLevelZeroTilesX: 2,
      numberOfLevelZeroTilesY: 1,
    }),
    rectangle: C.Rectangle.fromDegrees(-180, -90, 180, 90),
    tileWidth: 512,
    tileHeight: 512,
    maximumLevel: src.maxLevel,
    enablePickFeatures: false,
    credit: "NASA EOSDIS GIBS",
  });
  p.errorEvent.addEventListener((e: { retry: boolean }) => {
    e.retry = false; // a missing tile (no data that day) is not worth retrying
  });
  return p;
}

/** Box edges as polylines, densified so they follow the curve of the Earth. */
function boxLines([w, s, e, n]: [number, number, number, number]): number[][] {
  const h = 800;
  const along = (a: [number, number], b: [number, number]) => {
    const steps = Math.max(2, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / 0.5));
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      out.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, h);
    }
    return out;
  };
  if (e - w >= 300) {
    // A polar cap: only the circle of latitude.
    const lat = s > 0 ? s : n;
    return [along([-180, lat], [180, lat])];
  }
  return [along([w, s], [e, s]), along([e, s], [e, n]), along([e, n], [w, n]), along([w, n], [w, s])];
}

/**
 * Camera straight above a point, moved so the point shows in the middle of the
 * part of the screen not covered by panels (not the middle of the screen).
 */
function framed(
  C: Cesium,
  fov: number,
  W: number,
  H: number,
  lon: number,
  lat: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): { destination: Cartesian3; heading: number } {
  const R = 6_378_137;
  // Where the point should land, in pixels from the centre of the screen.
  const dx = (left - right) / 2;
  const dy = (top - bottom) / 2;
  // Angle from straight down to that pixel, then the arc of Earth that spans it.
  const focal = Math.max(W, H) / 2 / Math.tan(fov / 2);
  const alpha = Math.atan(Math.hypot(dx, dy) / focal);
  const k = ((R + height) / R) * Math.sin(alpha);
  const arc = k >= 1 ? 0 : Math.asin(k) - alpha;
  const theta = Math.atan2(dx, -dy); // on screen, clockwise from up
  const rad = C.Math.toRadians;

  if (Math.abs(lat) >= 89.9) {
    // Over a pole there is no "north up", so turn the view instead.
    const north = lat > 0;
    const camLat = north ? rad(90) - arc : rad(-90) + arc;
    return { destination: C.Cartesian3.fromRadians(0, camLat, height), heading: (north ? 0 : Math.PI) - theta };
  }
  // North up: step from the point the opposite way along the Earth.
  const la = rad(lat);
  const bearing = theta + Math.PI;
  const lat2 = Math.asin(Math.sin(la) * Math.cos(arc) + Math.cos(la) * Math.sin(arc) * Math.cos(bearing));
  const lon2 =
    rad(lon) +
    Math.atan2(Math.sin(bearing) * Math.sin(arc) * Math.cos(la), Math.cos(arc) - Math.sin(la) * Math.sin(lat2));
  return { destination: C.Cartesian3.fromRadians(lon2, lat2, height), heading: 0 };
}

/** Grow the box so it lands in the part of the screen not covered by panels. */
function paddedRect(
  C: Cesium,
  box: [number, number, number, number],
  W: number,
  H: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Rectangle {
  let [w, s, e, n] = box;
  const dx = e - w;
  const dy = n - s;
  w -= dx * 0.12;
  e += dx * 0.12;
  s -= dy * 0.12;
  n += dy * 0.12;
  const fh = Math.min(0.7, (left + right) / W);
  const fv = Math.min(0.7, (top + bottom) / H);
  const extraX = ((e - w) * fh) / (1 - fh);
  const shareX = left + right ? left / (left + right) : 0.5;
  w -= extraX * shareX;
  e += extraX * (1 - shareX);
  const extra = ((n - s) * fv) / (1 - fv);
  const share = top + bottom ? bottom / (top + bottom) : 0.5;
  s -= extra * share;
  n += extra * (1 - share);
  return C.Rectangle.fromDegrees(Math.max(-180, w), Math.max(-89, s), Math.min(180, e), Math.min(89, n));
}

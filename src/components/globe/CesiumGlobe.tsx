"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Cartesian3,
  CesiumWidget,
  ImageryLayer,
  PerspectiveFrustum,
  PointPrimitiveCollection,
  Polyline,
  PolylineCollection,
  Primitive,
  Rectangle,
} from "cesium";
import { loadCesium, type Cesium } from "@/lib/cesium";
import { HAND_ACTIVE_EVENT, HAND_SPLIT_EVENT, HandControl } from "./HandControl";
import { BASE, BORDERS, regionBox, tileUrl, type TileSource } from "@/lib/gibs";
import type { Region } from "@/lib/regions";
import type { GlobeGrid } from "@/lib/agent/view";
import { fmt, limitOf, measureName, scaleFor, unitOf, type Probe } from "@/lib/probe";

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
  /** What the detective is looking at: an area outline and a heat map of grid cells. */
  probe: Probe | null;
  /** The detective is working: hold the Earth still. */
  busy: boolean;
}

interface Scene {
  C: Cesium;
  widget: CesiumWidget;
  points: PointPrimitiveCollection;
  outline: PolylineCollection;
  /** The detective's area outline and scanning line. */
  probeLines: PolylineCollection;
}

const HOME = { lon: 62, lat: 18, height: 2.1e7 };
/** Quiet seconds on the home view before the Earth starts turning. */
const IDLE_SECONDS = 3;
/** One full turn in about two minutes. */
const SPIN_DEG_PER_S = 3;

export default function CesiumGlobe(props: Props) {
  const { regions, colors, selected, onSelect, inset, resetToken, probe, busy } = props;
  // The detective's map or trend squares win over the place's own then/now photos: a
  // trend (one number for all years) under a date slider reads as if it belonged to a date.
  const compare = probe?.imagery || probe?.grid ? null : props.compare;
  const hostRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  // With both a satellite map and a heat map, the newest shows; the card switches.
  const both = probe?.imagery && probe.grid ? `${probe.imagery.id}|${probe.grid.id}` : null;
  const [picked, setPicked] = useState<{ key: string; show: "imagery" | "grid" } | null>(null);
  const showing = both && picked?.key === both ? picked.show : probe?.latest;
  const imagery = showing === "imagery" ? (probe?.imagery ?? null) : null;
  const grid = showing === "grid" ? (probe?.grid ?? null) : null;
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  // The heat-map square under the mouse: its exact number.
  const [cell, setCell] = useState<{ grid: string; v: number; sig: number; x: number; y: number } | null>(null);
  const gridRef = useRef(grid);
  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

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
        const probeLines = s.primitives.add(new C.PolylineCollection()) as PolylineCollection;

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
        // The heat-map square under the mouse: the cell whose box holds that spot on the ground.
        const pickCell = (pos: { x: number; y: number }) => {
          const g = gridRef.current;
          const at = g && widget!.camera.pickEllipsoid(new C.Cartesian2(pos.x, pos.y));
          if (!g || !at) return null;
          const c = C.Cartographic.fromCartesian(at);
          const lat = C.Math.toDegrees(c.latitude);
          const lon = C.Math.toDegrees(c.longitude);
          const [hx, hy] = [g.step[0] / 2, g.step[1] / 2];
          const hit = g.cells.find(([y, x]) => Math.abs(lat - y) <= hy && Math.abs(lon - x) <= hx);
          return hit ? { grid: g.id, v: hit[2], sig: hit[3], x: pos.x, y: pos.y } : null;
        };
        s.canvas.addEventListener("pointerleave", () => setCell(null));
        handler.setInputAction((e: { endPosition: { x: number; y: number } }) => {
          if (dragging || (points.length === 0 && !gridRef.current)) {
            setCell(null);
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
            if (gridRef.current) return setCell(pickCell(pos));
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

        setScene({ C, widget, points, outline, probeLines });
      },
      (e: Error) => !dead && setError(e.message),
    );

    return () => {
      dead = true;
      widget?.destroy();
    };
    // Cesium starts once; regions and onSelect are read through refs.
  }, []);

  // Markers: one dot per place, coloured by its trend. Hidden while comparing
  // a place, and under the detective's heat map.
  const gridShown = !!grid || !!imagery;
  useEffect(() => {
    if (!scene) return;
    const { C, points } = scene;
    points.removeAll();
    if (!selected && !gridShown) {
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
  }, [scene, regions, colors, selected, gridShown]);

  // Outline of the open place. The detective's corner brackets replace it while it shows an area:
  // two frames at once read as clutter.
  const framing = !!probe?.focus;
  useEffect(() => {
    if (!scene) return;
    const { C, outline } = scene;
    outline.removeAll();
    const box = !framing && selected && regionBox(selected);
    if (box) {
      const material = C.Material.fromType("Color", { color: C.Color.WHITE.withAlpha(0.85) });
      for (const ring of boxLines(box)) {
        outline.add({ positions: C.Cartesian3.fromDegreesArrayHeights(ring), width: 1.5, material });
      }
    }
    scene.widget.scene.requestRender();
  }, [scene, selected, framing]);

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

  // The detective's satellite map: a GIBS layer for one date, or two dates
  // split left and right.
  useEffect(() => {
    if (!scene || !imagery) return;
    const { C, widget } = scene;
    const layers = widget.scene.imageryLayers;
    const src: TileSource = { layer: imagery.layer, matrixSet: imagery.matrixSet, maxLevel: imagery.maxLevel, ext: imagery.ext };
    const rectangle = imagery.box ? C.Rectangle.fromDegrees(...imagery.box) : undefined;
    const add = (time: string | undefined, side?: "LEFT" | "RIGHT") => {
      const l: ImageryLayer = new C.ImageryLayer(provider(C, src, time), { rectangle, alpha: 0 });
      if (side) l.splitDirection = C.SplitDirection[side];
      layers.add(l, 1); // just above the base, under the borders
      return l;
    };
    const shown = [add(imagery.time, imagery.before ? "RIGHT" : undefined)];
    if (imagery.before) shown.push(add(imagery.before, "LEFT"));
    // Fade in over half a second, so the map arrives instead of popping.
    const start = performance.now();
    let frame = 0;
    const fade = (now: number) => {
      const t = Math.min(1, (now - start) / 500);
      for (const l of shown) l.alpha = t * 0.95;
      widget.scene.requestRender();
      if (t < 1) frame = requestAnimationFrame(fade);
    };
    frame = requestAnimationFrame(fade);
    return () => {
      cancelAnimationFrame(frame);
      for (const l of shown) layers.remove(l, true);
      widget.scene.requestRender();
    };
  }, [scene, imagery]);

  // Idle spin: on the home view, after a few quiet seconds, turn the Earth
  // slowly west to east. Any touch, drag, scroll or key stops it at once.
  const still = busy || !!probe;
  useEffect(() => {
    if (!scene || selected || still) return;
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
    const events = ["pointerdown", "wheel", "touchstart", HAND_ACTIVE_EVENT] as const;
    for (const e of events) canvas.addEventListener(e, wake, { passive: true });
    window.addEventListener("keydown", wake);
    return () => {
      cancelAnimationFrame(frame);
      for (const e of events) canvas.removeEventListener(e, wake);
      window.removeEventListener("keydown", wake);
    };
  }, [scene, selected, still, resetToken]);

  // The detective's heat map: one tile per grid cell, coloured by its trend
  // (faint where there is no clear trend). Tiles appear north to south, like
  // a scanner passing over, once per new grid.
  useEffect(() => {
    if (!scene || !grid) return;
    const { C, widget } = scene;
    const s = widget.scene;
    const scale = scaleFor(grid.parameter);
    const limit = limitOf(grid);
    const [dx, dy] = grid.step.map((v) => (v * 0.92) / 2);
    const target = grid.cells.map(([, , v, sig]) => C.Color.fromCssColorString(scale.color(v / limit)).withAlpha(sig ? 0.82 : 0.28));
    const prim = new C.Primitive({
      geometryInstances: grid.cells.map(
        ([lat, lon], i) =>
          new C.GeometryInstance({
            id: i,
            geometry: new C.RectangleGeometry({
              rectangle: C.Rectangle.fromDegrees(lon - dx, Math.max(-89.9, lat - dy), lon + dx, Math.min(89.9, lat + dy)),
              height: 1500,
              vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
            }),
            attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(target[i].withAlpha(0)) },
          }),
      ),
      appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }),
      asynchronous: false,
    }) as Primitive;
    s.primitives.add(prim);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [, south, , north] = grid.box;
    const SWEEP = reduce ? 0 : 1100;
    const FADE = reduce ? 1 : 350;
    const delay = grid.cells.map(([lat]) => ((north - lat) / (north - south || 1)) * SWEEP);
    let start = 0;
    let frame = 0;
    const tick = (now: number) => {
      s.requestRender();
      if (!prim.ready) return void (frame = requestAnimationFrame(tick));
      start ||= now;
      let done = true;
      for (let i = 0; i < target.length; i++) {
        const k = Math.min(1, Math.max(0, (now - start - delay[i]) / FADE));
        if (k < 1) done = false;
        const a = prim.getGeometryInstanceAttributes(i);
        if (a) a.color = C.ColorGeometryInstanceAttribute.toValue(target[i].withAlpha(target[i].alpha * k), a.color as Uint8Array);
      }
      if (!done) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      s.primitives.remove(prim);
      s.requestRender();
    };
  }, [scene, grid]);

  // The area the detective is reading: the rest of the world dims (a spotlight)
  // and four corner brackets lock onto the area. While it works the brackets
  // breathe softly; nothing sweeps across.
  const focus = probe?.focus ?? null;
  const scanning = !!probe?.scanning;
  // Brackets and spotlight hug what is on screen: the heat map's squares, or the satellite map's
  // edges (padded wider than the area read), so nothing shown sits in the dimmed part.
  const frame = grid ? cellsBox(grid) : (imagery?.box ?? focus?.box ?? null);
  const frameKey = frame?.join(",") ?? null;
  useEffect(() => {
    if (!scene || !frameKey) return;
    const box = frameKey.split(",").map(Number) as [number, number, number, number];
    const { C, widget, probeLines } = scene;
    const s = widget.scene;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Spotlight: dark bands around the area, just above the ground and under the heat map.
    const shade = C.Color.BLACK.withAlpha(0.5);
    const bands = shadeAround(box);
    const dim = new C.Primitive({
      geometryInstances: bands.map(
        (r, i) =>
          new C.GeometryInstance({
            id: i,
            geometry: new C.RectangleGeometry({ rectangle: C.Rectangle.fromDegrees(...r), height: 600, vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
            attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(shade.withAlpha(0)) },
          }),
      ),
      appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }),
      asynchronous: false,
    }) as Primitive;
    s.primitives.add(dim);

    // Corner brackets, one glow material each so their brightness can change.
    const brackets = cornerLines(box, 0, 3000).map(() =>
      probeLines.add({
        positions: [],
        width: 6,
        material: C.Material.fromType("PolylineGlow", { color: C.Color.WHITE.withAlpha(0), glowPower: 0.25, taperPower: 1 }),
      }),
    ) as Polyline[];

    const LOCK = reduce ? 1 : 550;
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = now - t0;
      // Ease out: the brackets close in from 25% wider and settle.
      const k = Math.min(1, t / LOCK);
      const ease = 1 - (1 - k) ** 3;
      const rings = cornerLines(box, 0.25 * (1 - ease), 3000);
      const breathe = scanning && !reduce && k === 1 ? 0.7 + 0.3 * Math.cos(((t - LOCK) / 2400) * Math.PI * 2) : 1;
      brackets.forEach((b, i) => {
        b.positions = C.Cartesian3.fromDegreesArrayHeights(rings[i]);
        (b.material.uniforms.color as InstanceType<Cesium["Color"]>).alpha = 0.95 * ease * breathe;
      });
      if (dim.ready) {
        for (let i = 0; i < bands.length; i++) {
          const a = dim.getGeometryInstanceAttributes(i);
          if (a) a.color = C.ColorGeometryInstanceAttribute.toValue(shade.withAlpha(shade.alpha * ease), a.color as Uint8Array);
        }
      }
      s.requestRender();
      if (k < 1 || !dim.ready || (scanning && !reduce)) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      probeLines.removeAll();
      s.primitives.remove(dim);
      s.requestRender();
    };
  }, [scene, frameKey, scanning]);

  // Camera: fly to the open place, or back home.
  const insetKey = `${inset.left},${inset.top},${inset.right},${inset.bottom}`;
  const focusBox = focus?.box ?? null;
  const focusId = focus?.id ?? null;
  const aim = useRef<{ selected: Region | null; focusId: string | null; on: "place" | "probe" }>({ selected: null, focusId: null, on: "place" });
  // Once you zoom, drag or turn the globe during an answer, the camera stops chasing the
  // detective's new areas until the next question: it never pulls the view out of your hands.
  const touched = useRef(false);
  useEffect(() => {
    if (busy) touched.current = false;
  }, [busy]);
  useEffect(() => {
    if (!scene) return;
    const canvas = scene.widget.scene.canvas;
    const mine = () => (touched.current = true);
    const events = ["pointerdown", "wheel", "touchstart"] as const;
    for (const e of events) canvas.addEventListener(e, mine, { passive: true });
    return () => {
      for (const e of events) canvas.removeEventListener(e, mine);
    };
  }, [scene]);
  useEffect(() => {
    if (!scene) return;
    const { C, widget } = scene;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = widget.scene.canvas;
    // Whichever changed last wins: the open place, or the area the detective just started reading.
    const was = aim.current;
    const followed = focusId !== was.focusId && !!focusId && was.focusId !== null;
    if (followed && touched.current && selected === was.selected) {
      was.focusId = focusId;
      return;
    }
    if (focusId !== was.focusId && focusId) was.on = "probe";
    else if (selected !== was.selected || !focusId) was.on = "place";
    was.selected = selected;
    was.focusId = focusId;
    const box = was.on === "probe" && focusBox ? atLeast(focusBox, 10) : selected && regionBox(selected);
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
    // focusBox changes only with focusId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, selected, focusId, insetKey, resetToken]);

  return (
    <div className="cesium-host" ref={hostRef}>
      {!scene && !error && <div className="globe-loading">Loading Earth</div>}
      {error && <div className="globe-loading">{error}</div>}
      {hover && !selected && (
        <div className="globe-label" style={{ left: hover.x, top: hover.y }}>
          {hover.name}
        </div>
      )}
      {grid && cell?.grid === grid.id && <CellTip grid={grid} v={cell.v} sig={cell.sig} x={cell.x} y={cell.y} />}
      {scene && probe && (grid || probe.focus || imagery) && (
        <ProbeCard probe={probe} grid={grid} imagery={imagery} inset={inset} onSwitch={both ? (show) => setPicked({ key: both, show }) : undefined} />
      )}
      {scene && <HandControl C={scene.C} widget={scene.widget} left={inset.left + 16} bottom={inset.bottom + 16} />}
      {scene && compare && (
        <Split key={selected?.id} scene={scene} inset={inset} before={compare.before.label} after={compare.after.label} />
      )}
      {scene && imagery?.before && (
        <Split key={imagery.id} scene={scene} inset={inset} before={imagery.beforeLabel ?? imagery.before} after={imagery.label} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** What the heat map shows, in a caption under the area: place, measure, colour key. */
function ProbeCard({
  probe,
  grid,
  imagery,
  inset,
  onSwitch,
}: {
  probe: Probe;
  grid: Probe["grid"];
  imagery: Probe["imagery"];
  inset: Props["inset"];
  /** Both a satellite map and a heat map exist: switch between them. */
  onSwitch?: (show: "imagery" | "grid") => void;
}) {
  const { focus, scanning } = probe;
  const toggle = onSwitch && (
    <div className="probe-switch" role="group" aria-label="What the globe shows">
      <button type="button" aria-pressed={!!imagery} onClick={() => onSwitch("imagery")}>
        Satellite map
      </button>
      <button type="button" aria-pressed={!!grid} onClick={() => onSwitch("grid")}>
        Trend
      </button>
    </div>
  );
  const style = { left: `calc(${inset.left}px + (100% - ${inset.left + inset.right}px) / 2)`, bottom: inset.bottom + 20 };
  if (imagery) {
    const when = imagery.before ? `${imagery.beforeLabel} vs ${imagery.label}` : imagery.label;
    return (
      <figure className="probe" style={style}>
        <p className="probe-place">
          {scanning && <span className="probe-dot" aria-hidden />}
          {imagery.name}
        </p>
        {toggle}
        <p className="probe-what">
          {imagery.title}
          {when ? ` · ${when}` : ""}
        </p>
        {imagery.legend && (
          <>
            <div className="probe-bar" style={{ background: `linear-gradient(90deg, ${imagery.legend.stops.join(",")})` }} />
            <div className="probe-ticks">
              <span>{imagery.legend.min}</span>
              <span>{imagery.legend.max}</span>
            </div>
          </>
        )}
        <figcaption>{scanning && focus ? `Now: ${focus.what.toLowerCase()}` : `NASA satellite map: ${imagery.source}`}</figcaption>
      </figure>
    );
  }
  if (!grid) {
    return (
      <div className="probe" style={style} role="status">
        <p className="probe-place">
          {scanning && <span className="probe-dot" aria-hidden />}
          {focus!.name}
        </p>
        <p className="probe-what">{scanning ? focus!.what : "Where the detective looked"}</p>
      </div>
    );
  }
  const scale = scaleFor(grid.parameter);
  const limit = limitOf(grid);
  const unit = unitOf(grid);
  return (
    <figure className="probe" style={style}>
      <p className="probe-place">
        {scanning && <span className="probe-dot" aria-hidden />}
        {grid.name}
      </p>
      {toggle}
      <p className="probe-what">
        {measureName(grid)}
        {grid.season ? `, ${grid.season}` : ""} · change per decade, {grid.years[0]}–{grid.years[1]}
      </p>
      <div className="probe-bar" style={{ background: `linear-gradient(90deg, ${scale.ramp.join(",")})` }} />
      <div className="probe-ticks">
        <span>
          {fmt(-limit)}
          {unit} {scale.down}
        </span>
        <span>
          {scale.up} {fmt(limit)}
          {unit}
        </span>
      </div>
      <figcaption>{scanning && focus ? `Now: ${focus.what.toLowerCase()}` : `${grid.cells.length} cells tested · faint ones show no clear trend`}</figcaption>
    </figure>
  );
}

/** One heat-map square's number, by the mouse: "+0.3 mm/day per decade, clear trend". */
function CellTip({ grid, v, sig, x, y }: { grid: GlobeGrid; v: number; sig: number; x: number; y: number }) {
  const scale = scaleFor(grid.parameter);
  const unit = unitOf(grid);
  return (
    <div className="globe-label cell-tip" style={{ left: x, top: y }}>
      <strong>
        {fmt(v)}
        {unit} per decade
      </strong>
      <span>
        {v === 0 ? "no change" : v > 0 ? scale.up : scale.down} · {sig ? "clear trend" : "could be chance"}
      </span>
    </div>
  );
}

/** The heat map's outer edges: its cells' centres plus half a cell. */
function cellsBox(grid: GlobeGrid): [number, number, number, number] {
  const [hx, hy] = [grid.step[0] / 2, grid.step[1] / 2];
  const lats = grid.cells.map((c) => c[0]);
  const lons = grid.cells.map((c) => c[1]);
  if (!lats.length) return grid.box;
  return [Math.min(...lons) - hx, Math.max(-89.9, Math.min(...lats) - hy), Math.max(...lons) + hx, Math.min(89.9, Math.max(...lats) + hy)];
}

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

  // A pinch moved sideways (HandControl.tsx) slides the line by how far the hand moved.
  useEffect(() => {
    const slide = (e: Event) => {
      const width = ref.current?.parentElement?.clientWidth || window.innerWidth;
      setPos((p) => Math.min(0.97, Math.max(0.03, p + (e as CustomEvent<number>).detail / width)));
    };
    window.addEventListener(HAND_SPLIT_EVENT, slide);
    return () => window.removeEventListener(HAND_SPLIT_EVENT, slide);
  }, []);

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

/** Grow a small box around its centre so the camera keeps some surroundings in view. */
function atLeast([w, s, e, n]: [number, number, number, number], side: number): [number, number, number, number] {
  const gx = Math.max(0, side - (e - w)) / 2;
  const gy = Math.max(0, side - (n - s)) / 2;
  return [w - gx, Math.max(-89, s - gy), e + gx, Math.min(89, n + gy)];
}

/** The rest of the world around a box, as rectangles [w, s, e, n] no wider than 180°. */
function shadeAround([w, s, e, n]: [number, number, number, number]): [number, number, number, number][] {
  const halves = (south: number, north: number): [number, number, number, number][] =>
    north - south > 0.01 ? [[-180, south, 0, north], [0, south, 180, north]] : [];
  if (e - w >= 300) return s > 0 ? halves(-89.9, s) : halves(n, 89.9);
  const out = [...halves(n, 89.9), ...halves(-89.9, s)];
  if (w > -180) out.push([-180, s, w, n]);
  if (e < 180) out.push([e, s, 180, n]);
  return out;
}

/** Four L-shaped corner brackets around a box, `grow` (0 = on the box) further out. */
function cornerLines([w, s, e, n]: [number, number, number, number], grow: number, h: number): number[][] {
  if (e - w >= 300) {
    const lat = s > 0 ? s : n;
    const ring: number[] = [];
    for (let lon = -180; lon <= 180; lon += 2) ring.push(lon, lat, h);
    return [ring, [], [], []].map((r, i) => (i ? ring.slice(0, 6) : r));
  }
  const gx = ((e - w) * grow) / 2;
  const gy = ((n - s) * grow) / 2;
  [w, s, e, n] = [w - gx, Math.max(-89, s - gy), e + gx, Math.min(89, n + gy)];
  const arm = Math.min(e - w, n - s) * 0.22;
  const line = (pts: [number, number][]) => {
    const out: number[] = [];
    for (let j = 0; j < pts.length - 1; j++) {
      const [a, b] = [pts[j], pts[j + 1]];
      const steps = Math.max(2, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / 0.25));
      for (let i = j ? 1 : 0; i <= steps; i++) out.push(a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps, h);
    }
    return out;
  };
  return [
    line([[w, n - arm], [w, n], [w + arm, n]]),
    line([[e - arm, n], [e, n], [e, n - arm]]),
    line([[e, s + arm], [e, s], [e - arm, s]]),
    line([[w + arm, s], [w, s], [w, s + arm]]),
  ];
}

/** Box edges as polylines, densified so they follow the curve of the Earth. */
function boxLines([w, s, e, n]: [number, number, number, number], h = 800): number[][] {
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

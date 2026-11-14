"use client";

import dynamic from "next/dynamic";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REGIONS, sourceFor, type Layer, type Region } from "@/lib/regions";
import { findPlace } from "@/lib/live";
import type { Case } from "@/lib/cases";
import { annualize, loadMonthly, trend } from "@/lib/series";
import { LAYERS, LAYER_INFO, trendColor } from "@/lib/layers";
import { DEFAULT_MAP, MAP_LAYERS, describeDate, layerDate, mapLayer, type MapLayer } from "@/lib/gibs";
import { Panel } from "./shell/Panel";
import { Report, satYears, type Overview, type Sat } from "./report/Report";
import type { Compare } from "./globe/CesiumGlobe";
import { VoiceDock } from "./voice/VoiceDock";
import type { AppControl, AppState } from "@/lib/voice/brain";

const Globe = dynamic(() => import("./globe/CesiumGlobe"), {
  ssr: false,
  loading: () => <div className="globe-loading">Loading Earth</div>,
});

/** Floating UI the camera keeps the open place clear of (px). */
const PANEL_SPACE = 376;
/** Width the voice assistant takes on the right, plus its gutters. */
const VOICE_SPACE = 360 + 32;
const TOP_SPACE = 60;
const GUTTER = 16;

/** Width of the report on wide screens; keep in step with .report in globals.css. */
const reportWidth = (w: number) => Math.min(640, Math.round(w * 0.5));

type SP = Record<string, string | string[] | undefined>;

const yearParam = (v: SP[string]) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 1900 && n < 2100 ? n : null;
};

function useViewport() {
  const [size, setSize] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const sync = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  return size;
}

export default function Workspace({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = use(searchParams);
  const [layer, setLayer] = useState<Layer>(() => LAYERS.find((l) => l === sp.layer) ?? "warming");
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof sp.place === "string" && (sp.place.startsWith("find:") || REGIONS.some((r) => r.id === sp.place)) ? sp.place : null,
  );
  const [season, setSeason] = useState<string | null>(() => (typeof sp.season === "string" ? sp.season : null));
  /** Places found by name, with live NASA POWER data. */
  const [found, setFound] = useState<Region[]>([]);
  const [range, setRange] = useState<[number, number] | null>(() => {
    const a = yearParam(sp.from);
    const b = yearParam(sp.to);
    return a && b && b - a >= 9 ? [a, b] : null;
  });
  const [sat, setSat] = useState<Sat>(() => {
    const a = yearParam(sp.then);
    const b = yearParam(sp.now);
    return {
      on: sp.space !== "0",
      map: MAP_LAYERS.find((m) => m.id === sp.map)?.id ?? null,
      years: a && b && a < b ? [a, b] : null,
    };
  });
  const [resetToken, setResetToken] = useState(0);
  /** Computer-vision change map draped on the globe by the voice assistant. */
  const [overlay, setOverlay] = useState<{ url: string; bbox: [number, number, number, number] } | null>(null);
  const [overview, setOverview] = useState<Partial<Record<Layer, Overview>>>({});
  const requested = useRef(new Set<string>());
  const searchRef = useRef<HTMLInputElement>(null);
  const { w, h } = useViewport();
  const wide = w > 760;

  // Each place's full-record trend for the current question: the dot colours,
  // the list values and the comparison all come from it. Loaded once per layer.
  const regions = useMemo(() => [...found, ...REGIONS], [found]);

  useEffect(() => {
    for (const r of regions) {
      const src = sourceFor(r, layer);
      const key = `${layer}:${r.id}`;
      if (!src || requested.current.has(key)) continue;
      requested.current.add(key);
      loadMonthly(src).then(
        (m) => setOverview((o) => ({ ...o, [layer]: { ...o[layer], [r.id]: trend(annualize(m)) } })),
        (e: Error) => setOverview((o) => ({ ...o, [layer]: { ...o[layer], [r.id]: e } })),
      );
    }
  }, [layer, regions]);

  const results = useMemo(() => overview[layer] ?? {}, [overview, layer]);

  // Only places with a record for this question get a dot.
  const shown = useMemo(() => regions.filter((r) => sourceFor(r, layer)), [regions, layer]);

  const colors = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    for (const r of shown) {
      const t = results[r.id];
      out[r.id] = t instanceof Error ? "#48484a" : trendColor(layer, t);
    }
    return out;
  }, [layer, results, shown]);

  const selected = regions.find((r) => r.id === selectedId) ?? null;

  // Satellite maps of two years, side by side on the globe.
  const compare = useMemo<Compare | null>(() => {
    if (!selected || !sat.on) return null;
    const id: MapLayer = sat.map ?? DEFAULT_MAP[layer];
    const [first, last] = satYears(sat, range, id);
    const side = (year: number) => ({ time: layerDate(selected, id, year), label: describeDate(selected, id, year) });
    return { source: mapLayer(id), before: side(first), after: side(last) };
  }, [selected, layer, sat, range]);

  // Keep the address bar in step so any view can be shared as a link.
  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (k: string, v: string | null) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k));
    set("layer", layer);
    set("place", selectedId);
    set("season", selectedId && season ? season : null);
    set("from", selectedId && range ? String(range[0]) : null);
    set("to", selectedId && range ? String(range[1]) : null);
    set("space", selectedId && !sat.on ? "0" : null);
    set("map", selectedId && sat.map ? sat.map : null);
    set("then", selectedId && sat.years ? String(sat.years[0]) : null);
    set("now", selectedId && sat.years ? String(sat.years[1]) : null);
    window.history.replaceState(null, "", url);
  }, [layer, selectedId, range, sat, season]);

  const open = useCallback(
    (id: string | null, pool: Region[] = regions) => {
      setSelectedId(id);
      setRange(null);
      setSeason(null);
      setSat((s) => ({ on: s.on, map: null, years: null }));
      // A place without a record for this question opens on the first question it has.
      const r = pool.find((x) => x.id === id);
      if (r && !sourceFor(r, layer)) setLayer(LAYERS.find((l) => sourceFor(r, l)) ?? layer);
    },
    [regions, layer],
  );

  /** Find any place by name and open it with live NASA data. */
  const find = useCallback(
    async (query: string) => {
      const r = await findPlace(query);
      setFound((f) => [r, ...f.filter((x) => x.id !== r.id)]);
      open(r.id, [r]);
      return r;
    },
    [open],
  );

  // A shared link to a searched place: look it up again.
  const pending = useRef(selectedId?.startsWith("find:") ? selectedId.slice(5) : null);
  useEffect(() => {
    const q = pending.current;
    if (!q) return;
    pending.current = null;
    findPlace(q).then(
      (r) => setFound((f) => [r, ...f.filter((x) => x.id !== r.id)]),
      () => setSelectedId(null),
    );
  }, []);

  const openCase = useCallback((c: Case) => {
    setLayer(c.layer);
    setSelectedId(c.place);
    setRange(null);
    setSeason(c.season ?? null);
    setSat((s) => ({ on: s.on, map: null, years: null }));
  }, []);

  const reset = useCallback(() => {
    open(null);
    setResetToken((n) => n + 1);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea");
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === "k") {
          e.preventDefault();
          reset();
          requestAnimationFrame(() => searchRef.current?.focus());
        } else if (/^[1-8]$/.test(e.key)) {
          e.preventDefault();
          setLayer(LAYERS[Number(e.key) - 1]);
        }
        return;
      }
      if (e.key === "Escape") {
        if (typing) (e.target as HTMLElement).blur();
        else reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reset]);

  // Voice: the assistant reads the latest view and drives it through stable handles.
  const live = useRef({ open, find, reset, openCase });
  useEffect(() => {
    live.current = { open, find, reset, openCase };
  }, [open, find, reset, openCase]);
  const voiceControl = useMemo<AppControl>(
    () => ({
      open: (id) => live.current.open(id),
      find: (q) => live.current.find(q),
      reset: () => live.current.reset(),
      openCase: (c) => live.current.openCase(c),
      setLayer,
      setRange,
      setSeason,
      setSat,
      setOverlay,
    }),
    [],
  );
  const voiceState = useMemo<AppState>(
    () => ({ regions, selected, layer, range, season, sat }),
    [regions, selected, layer, range, season, sat],
  );

  const right = wide ? VOICE_SPACE : 0;
  const inset = selected
    ? wide
      ? { left: reportWidth(w) + GUTTER * 2, top: GUTTER, right, bottom: 0 }
      : { left: 0, top: 0, right: 0, bottom: Math.round(h * 0.64) }
    : wide
      ? { left: PANEL_SPACE, top: TOP_SPACE, right, bottom: 0 }
      : { left: 0, top: TOP_SPACE, right: 0, bottom: Math.round(h * 0.52) };

  return (
    <main className="workspace" data-open={selected ? "" : undefined} data-voice="">
      <div className="globe-layer">
        <Globe
          regions={shown}
          colors={colors}
          selected={selected}
          onSelect={open}
          compare={compare}
          inset={inset}
          resetToken={resetToken}
          overlay={selected ? overlay : null}
        />
      </div>

      {selected ? (
        <Report
          region={selected}
          layer={layer}
          onLayer={setLayer}
          onClose={reset}
          onSelect={open}
          overview={results}
          range={range}
          onRange={setRange}
          sat={sat}
          onSat={setSat}
          season={season}
          onSeason={setSeason}
        />
      ) : (
        <>
          <Panel
            ref={searchRef}
            regions={shown}
            layer={layer}
            results={results}
            colors={colors}
            onSelect={open}
            onFind={async (q) => {
              await find(q);
            }}
            onCase={openCase}
          />

          <div className="segmented is-top" role="radiogroup" aria-label="Question">
            {LAYERS.map((l, i) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={layer === l}
                title={`${LAYER_INFO[l].question} (⌘${i + 1})`}
                onClick={() => setLayer(l)}
              >
                {LAYER_INFO[l].tab}
              </button>
            ))}
          </div>

          <Legend layer={layer} />
        </>
      )}

      <p className="credit">Imagery: NASA GIBS, Blue Marble</p>

      <VoiceDock state={voiceState} control={voiceControl} />
    </main>
  );
}

function Legend({ layer }: { layer: Layer }) {
  const info = LAYER_INFO[layer];
  const end = info.rateText(info.limit);
  return (
    <figure className="legend" aria-label="Colour key">
      <figcaption>Dots: change per decade. Grey: no clear trend.</figcaption>
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${info.ramp.join(",")})` }} />
      <div className="legend-ticks">
        <span>{end.replace("+", "−")}</span>
        <span>0</span>
        <span>{end}</span>
      </div>
    </figure>
  );
}

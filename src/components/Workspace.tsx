"use client";

import dynamic from "next/dynamic";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REGIONS, sourceFor, type Layer, type Region } from "@/lib/regions";
import { findPlace } from "@/lib/live";
import { CASES, type Case } from "@/lib/cases";
import { annualize, loadMonthly, seasonsFor, trend } from "@/lib/series";
import { LAYERS, LAYER_INFO, trendColor } from "@/lib/layers";
import { DEFAULT_MAP, MAP_LAYERS, describeDate, layerDate, mapLayer, type MapLayer } from "@/lib/gibs";
import { Panel } from "./shell/Panel";
import { Report, satYears, type Overview, type Sat } from "./report/Report";
import type { Compare } from "./globe/CesiumGlobe";
import { Detective, type Activity } from "./chat/Detective";
import type { View, ViewChange } from "@/lib/agent/view";
import type { UiPatch } from "@/lib/router/types";
import type { Probe } from "@/lib/probe";

const Globe = dynamic(() => import("./globe/CesiumGlobe"), {
  ssr: false,
  loading: () => <div className="globe-loading">Loading Earth</div>,
});

/** Floating UI the camera keeps the open place clear of (px). */
const PANEL_SPACE = 376;
const TOP_SPACE = 60;
const GUTTER = 16;
/** Width of the detective chat; keep in step with .chat in globals.css. */
const CHAT_WIDTH = 380;

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
  const [chatOpen, setChatOpen] = useState(() => sp.ask === "1");
  /** Listening or working: the bar along the top. */
  const [activity, setActivity] = useState<Activity>("idle");
  /** What the detective is looking at, drawn on the globe. Escape or home hides it until it looks somewhere new. */
  const [probe, setProbe] = useState<Probe | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const probeKey = probe ? `${probe.focus?.id}|${probe.grid?.id}|${probe.imagery?.id}` : null;
  const shownProbe = probe && probeKey !== hidden ? probe : null;
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

  /** The detective opens what it found. */
  const show = useCallback(
    async (v: ViewChange) => {
      let id = v.place;
      if (v.query) {
        const r = await findPlace(v.query);
        setFound((f) => [r, ...f.filter((x) => x.id !== r.id)]);
        id = r.id;
      }
      setLayer(v.layer);
      setSelectedId(id);
      setSeason(v.season);
      setRange(v.range);
      setSat((s) => ({ on: s.on, map: null, years: null }));
    },
    [],
  );

  const view = useMemo<View>(
    () => ({ place: selectedId, placeName: selected?.name, layer, season, range }),
    [selectedId, selected, layer, season, range],
  );

  const openChat = useCallback(() => setChatOpen(true), []);

  const reset = useCallback(() => {
    open(null);
    setHidden(probeKey);
    setResetToken((n) => n + 1);
  }, [open, probeKey]);

  /**
   * Change the screen as the router asked (src/lib/router), keeping whatever it
   * didn't mention. Says in a few words what it did, and returns the new view so
   * a question asked in the same breath is answered about it.
   */
  const apply = useCallback(
    async (p: UiPatch): Promise<{ said: string; view: View; failed?: boolean }> => {
      if (p.chat !== undefined) setChatOpen(p.chat);
      if (p.home) {
        reset();
        return { said: "Back to the whole Earth.", view: { place: null, layer, season: null, range: null } };
      }
      const notes: string[] = [];
      let r = selected;
      let nextLayer = layer;
      let nextSeason = season;
      let nextRange = range;

      // A story, unless a place was named too: then the named place and question win.
      const story = !p.place && p.story ? CASES.find((c) => c.id === p.story) : undefined;
      if (story) {
        openCase(story);
        r = REGIONS.find((x) => x.id === story.place) ?? null;
        nextLayer = story.layer;
        nextSeason = story.season ?? null;
        nextRange = null;
      }

      if (p.place) {
        try {
          const next = "id" in p.place ? REGIONS.find((x) => x.id === (p.place as { id: string }).id) : await findPlace(p.place.name);
          if (next && next.id !== r?.id) {
            if (next.group === "Searched") setFound((f) => [next, ...f.filter((x) => x.id !== next.id)]);
            open(next.id, [next]);
            nextSeason = null;
            nextRange = null;
          }
          if (next) r = next;
        } catch (e) {
          return { said: e instanceof Error ? e.message : "Could not find that place.", view, failed: true };
        }
      }

      if (p.layer) {
        if (r && !sourceFor(r, p.layer)) notes.push(`${r.name} has no record for “${LAYER_INFO[p.layer].tab}”`);
        else nextLayer = p.layer;
      }
      // The place may not have the question on screen: open the first one it has.
      if (r && !sourceFor(r, nextLayer)) nextLayer = LAYERS.find((l) => sourceFor(r, l)) ?? nextLayer;
      setLayer(nextLayer);

      if (p.season !== undefined) {
        if (!r) notes.push("open a place to pick a season");
        else if (p.season === null) nextSeason = null;
        else nextSeason = closestSeason(r, p.season);
        setSeason(nextSeason);
      }
      if (p.range !== undefined) {
        if (!r) notes.push("open a place to pick years");
        else {
          // A trend needs about ten years: widen a shorter stretch back from its end.
          nextRange = p.range && p.range[1] - p.range[0] < 9 ? [p.range[1] - 9, p.range[1]] : p.range;
          setRange(nextRange);
        }
      }
      if (p.sat !== undefined) setSat((s) => ({ ...s, on: p.sat! }));

      const seasonLabel = r && nextSeason ? seasonsFor(r).find((x) => x.id === nextSeason)?.label : null;
      const parts = [
        story?.title ?? r?.name ?? "The whole Earth",
        LAYER_INFO[nextLayer].tab,
        seasonLabel,
        nextRange?.join("–"),
        p.sat === undefined ? null : p.sat ? "satellite maps on" : "satellite maps off",
        p.chat === undefined ? null : p.chat ? "detective open" : "detective closed",
      ].filter(Boolean);
      const said = `${parts.join(" · ")}.${notes.length ? ` (${notes.join("; ")}.)` : ""}`;
      return { said, view: { place: r?.id ?? null, placeName: r?.name, layer: nextLayer, season: nextSeason, range: nextRange } };
    },
    [layer, season, range, selected, view, open, openCase, reset],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea");
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === "j") {
          e.preventDefault();
          setChatOpen((o) => !o);
        } else if (e.key.toLowerCase() === "k") {
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

  const right = chatOpen && wide ? CHAT_WIDTH + GUTTER * 2 : 0;
  const inset = selected
    ? wide
      ? { left: reportWidth(w) + GUTTER * 2, top: GUTTER, right, bottom: 0 }
      : { left: 0, top: 0, right: 0, bottom: Math.round(h * 0.64) }
    : wide
      ? { left: PANEL_SPACE, top: TOP_SPACE, right, bottom: 0 }
      : { left: 0, top: TOP_SPACE, right: 0, bottom: Math.round(h * 0.52) };

  return (
    <main className="workspace" data-open={selected ? "" : undefined} data-chat={chatOpen ? "" : undefined}>
      <div className="globe-layer">
        <Globe
          regions={shown}
          colors={colors}
          selected={selected}
          onSelect={open}
          compare={compare}
          inset={inset}
          resetToken={resetToken}
          probe={shownProbe}
          busy={activity === "work"}
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
            onFind={find}
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

          {!shownProbe && <Legend layer={layer} />}
        </>
      )}

      <div className="busy-bar" data-mode={activity} aria-hidden>
        <span className="busy-level" />
        <span className="busy-run">
          <i />
        </span>
      </div>

      <Detective open={chatOpen} view={view} onShow={show} onProbe={setProbe} onApply={apply}
        onActivity={setActivity}
        onOpen={openChat}
        onClose={() => setChatOpen(false)}
      />
      {!chatOpen && (
        <button type="button" className="chat-launch" onClick={() => setChatOpen(true)} title="Ask the detective (⌘J)">
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.25" />
            <path d="m10.2 10.2 3.3 3.3" />
            <path d="M5.2 7.6 6.6 6l1.2 1.4L9 5.8" />
          </svg>
          Ask the detective
        </button>
      )}

      <p className="credit">Imagery: NASA GIBS, Blue Marble</p>
    </main>
  );
}

/** Router seasons are month ranges; pick this place's season that shares the most months. */
const SEASON_MONTHS: Record<string, number[]> = {
  djf: [12, 1, 2], winter: [12, 1, 2], mam: [3, 4, 5], summer: [3, 4, 5], jja: [6, 7, 8], son: [9, 10, 11], monsoon: [6, 7, 8, 9], post: [10, 11],
};
function closestSeason(r: Region, id: string): string | null {
  const want = SEASON_MONTHS[id];
  if (!want) return null;
  let best: string | null = null;
  let most = 0;
  for (const s of seasonsFor(r)) {
    const n = s.months.filter((m) => want.includes(m)).length;
    if (n > most) [best, most] = [s.id, n];
  }
  return best;
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

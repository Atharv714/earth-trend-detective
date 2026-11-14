"use client";

import { forwardRef, useMemo, useState, type KeyboardEvent } from "react";
import { GROUPS, sourceFor, type Layer, type Region } from "@/lib/regions";
import { LAYER_INFO } from "@/lib/layers";
import type { Overview } from "../report/Report";

interface Props {
  regions: Region[];
  layer: Layer;
  results: Overview;
  colors: Record<string, string | undefined>;
  onSelect: (id: string) => void;
}

/** The list of places. Opening one hands over to the report. */
export const Panel = forwardRef<HTMLInputElement, Props>(function Panel({ regions, layer, results, colors, onSelect }, searchRef) {
  const [query, setQuery] = useState("");
  const info = LAYER_INFO[layer];

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? regions.filter((r) => r.name.toLowerCase().includes(q)) : regions;
    return GROUPS.map((g) => ({ name: g, items: list.filter((r) => r.group === g) })).filter((g) => g.items.length);
  }, [regions, query]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button.row")];
    if (!rows.length) return;
    e.preventDefault();
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = i < 0 ? 0 : e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
    rows[next].focus();
  };

  return (
    <aside className="panel" aria-label="Places">
      <div className="panel-body" onKeyDown={onKeyDown}>
        <header className="panel-head">
          <h1>{info.question}</h1>
          <p>{info.intro}</p>
        </header>

        <label className="search">
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.75" />
            <path d="m10.5 10.5 3.5 3.5" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search places"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search places"
          />
        </label>

        <div className="list">
          {groups.map((g) => (
            <section key={g.name} aria-label={g.name}>
              <h2 className="list-heading">{g.name}</h2>
              {g.items.map((r) => {
                const has = !!sourceFor(r, layer);
                const t = results[r.id];
                let value = "–";
                if (!has) value = "No data";
                else if (t && !(t instanceof Error)) value = info.rateText(info.rate(t));
                return (
                  <button key={r.id} type="button" className="row" onClick={() => onSelect(r.id)}>
                    <span className="row-name">{r.name}</span>
                    <span className={`row-value${has && t && !(t instanceof Error) ? "" : " is-muted"}`}>
                      {value}
                      {has && <i style={{ background: colors[r.id] }} aria-hidden />}
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
          {!groups.length && <p className="list-empty">No match for “{query}”. Try a country, state or city.</p>}
        </div>
      </div>
    </aside>
  );
});

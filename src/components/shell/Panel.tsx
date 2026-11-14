"use client";

import { forwardRef, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { GROUPS, type Layer, type Region } from "@/lib/regions";
import { LAYER_INFO } from "@/lib/layers";
import { CASES, type Case } from "@/lib/cases";
import type { Overview } from "../report/Report";

interface Props {
  regions: Region[];
  layer: Layer;
  results: Overview;
  colors: Record<string, string | undefined>;
  onSelect: (id: string) => void;
  /** Look a place up by name and open it with live NASA data. */
  onFind: (query: string) => Promise<void>;
  onCase: (c: Case) => void;
}

/** The list of places. Opening one hands over to the report. */
export const Panel = forwardRef<HTMLInputElement, Props>(function Panel({ regions, layer, results, colors, onSelect, onFind, onCase }, searchRef) {
  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState<{ query: string; error?: string } | null>(null);
  const info = LAYER_INFO[layer];
  const q = query.trim();
  const busy = !!finding && !finding.error;

  const find = (e?: FormEvent) => {
    e?.preventDefault();
    if (!q || busy) return;
    setFinding({ query: q });
    onFind(q).then(
      () => setFinding(null),
      (err: Error) => setFinding({ query: q, error: err.message }),
    );
  };

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

        <form className="search" role="search" onSubmit={find}>
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.75" />
            <path d="m10.5 10.5 3.5 3.5" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search any place on Earth"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (finding?.error) setFinding(null);
            }}
            aria-label="Search any place on Earth"
          />
        </form>

        {q && (
          <button type="button" className="row find" onClick={() => find()} disabled={busy}>
            <span className="row-name">
              {busy ? `Asking NASA about ${finding.query}…` : `Get a live NASA report for “${q}”`}
            </span>
            <svg viewBox="0 0 16 16" aria-hidden>
              <circle cx="8" cy="8" r="6" />
              <path d="M2 8h12M8 2c2 2 2.6 4 2.6 6S10 12 8 14M8 2C6 4 5.4 6 5.4 8S6 12 8 14" />
            </svg>
          </button>
        )}
        {finding?.error && (
          <p className="list-empty" role="alert">
            {finding.error}
          </p>
        )}

        {!q && (
          <section className="cases" aria-label="Start with a story">
            <h2 className="list-heading">Start with a story</h2>
            {CASES.map((c) => (
              <button key={c.id} type="button" className="case" onClick={() => onCase(c)}>
                <i style={{ background: LAYER_INFO[c.layer].hue.up }} aria-hidden />
                <span>
                  {c.title}
                  <small>{c.note}</small>
                </span>
              </button>
            ))}
          </section>
        )}

        <div className="list">
          {groups.map((g) => (
            <section key={g.name} aria-label={g.name}>
              <h2 className="list-heading">{g.name}</h2>
              {g.items.map((r) => {
                const t = results[r.id];
                const ok = t && !(t instanceof Error);
                const value = ok ? info.rateText(info.rate(t)) : t === undefined ? "…" : "–";
                return (
                  <button key={r.id} type="button" className="row" onClick={() => onSelect(r.id)}>
                    <span className="row-name">{r.name}</span>
                    <span className={`row-value${ok ? "" : " is-muted"}`}>
                      {value}
                      <i style={{ background: colors[r.id] }} aria-hidden />
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
          {!groups.length && !q && <p className="list-empty">No place has a {info.tab.toLowerCase()} record yet.</p>}
        </div>
      </div>
    </aside>
  );
});

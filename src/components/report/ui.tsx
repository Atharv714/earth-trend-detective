"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatP, type Trend } from "@/lib/series";

/* ------------------------------------------------------------------ */
/* Info: a small (i) that explains a term on hover, focus or tap.      */

export function Info({ children, label = "What does this mean?" }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [box, setBox] = useState<DOMRect | null>(null);
  const show = () => ref.current && setBox(ref.current.getBoundingClientRect());
  const hide = () => setBox(null);

  useEffect(() => {
    if (!box) return;
    const close = () => setBox(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [box]);

  // The report has a backdrop filter, which traps position: fixed, so the
  // tooltip is drawn on <body>.
  let style: CSSProperties | undefined;
  if (box) {
    const W = 280;
    const left = Math.min(Math.max(8, box.left + box.width / 2 - W / 2), window.innerWidth - W - 8);
    const below = box.bottom + 180 < window.innerHeight;
    style = below ? { left, top: box.bottom + 8, width: W } : { left, bottom: window.innerHeight - box.top + 8, width: W };
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="info"
        aria-label={label}
        aria-describedby={box ? id : undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          if (box) hide();
          else show();
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="6.6" />
          <path d="M8 7.3v4" />
          <circle cx="8" cy="4.9" r="0.4" />
        </svg>
      </button>
      {box &&
        createPortal(
          <div id={id} role="tooltip" className="tip" style={style}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */

/** A rising, falling or flat arrow, so the direction reads at a glance. */
export function Trendmark({ dir, color, size = 18 }: { dir: "up" | "down" | "flat"; color?: string; size?: number }) {
  const d = dir === "up" ? "M3 13 13 3M6 3h7v7" : dir === "down" ? "M3 3l10 10M13 6v7H6" : "M2 8h12M10 4l4 4-4 4";
  return (
    <svg className="trendmark" viewBox="0 0 16 16" width={size} height={size} style={{ color }} aria-hidden>
      <path d={d} />
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  snow: (
    <path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5M6 2.8 8 4.3l2-1.5M6 13.2l2-1.5 2 1.5" />
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </>
  ),
  rain: (
    <>
      <path d="M4.5 9.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.6 1 2.5 2.5 0 0 1 .2 5z" />
      <path d="M5.5 11.5 5 13.5M8.5 11.5 8 13.5M11.5 11.5 11 13.5" />
    </>
  ),
  leaf: <path d="M3 13c0-6 4-10 10-10 0 6-4 10-10 10zM3 13l5-5" />,
  sprout: <path d="M8 14V8M8 8c0-3-2-5-5-5 0 3 2 5 5 5zM8 10c0-2.5 1.8-4.5 5-4.5 0 2.5-1.8 4.5-5 4.5z" />,
  year: (
    <>
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </>
  ),
};

/** Icon for a season. Quarters flip in the southern hemisphere. */
export function SeasonIcon({ id, south }: { id: string; south?: boolean }) {
  const map: Record<string, string> = {
    year: "year",
    winter: "snow",
    summer: "sun",
    monsoon: "rain",
    post: "leaf",
    djf: south ? "sun" : "snow",
    mam: south ? "leaf" : "sprout",
    jja: south ? "snow" : "sun",
    son: south ? "sprout" : "leaf",
  };
  return (
    <svg className="season-icon" viewBox="0 0 16 16" aria-hidden>
      {ICONS[map[id] ?? "year"]}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Is it real? A plain answer to the significance test.                */

export const PTIP = (t: Trend) => (
  <>
    <b>Could this be chance?</b> Weather is noisy, so a few hot or wet years can look like a trend by luck. We use the Mann-Kendall test,
    a standard check in climate science. It gives the chance of seeing a pattern this strong if nothing were really changing.
    <br />
    <br />
    Here that chance is <b>{t.pValue < 0.001 ? "under 0.1%" : `${(t.pValue * 100).toFixed(1)}%`}</b> ({formatP(t.pValue)}). Under 5%,
    scientists call it a real trend.
  </>
);

export function Verdict({ t }: { t: Trend }) {
  return (
    <span className="verdict" data-real={t.significant ? "" : undefined}>
      <svg viewBox="0 0 16 16" aria-hidden>
        {t.significant ? <path d="m3.5 8.5 3 3 6-7" /> : <path d="M6 6a2 2 0 1 1 2.5 1.9c-.4.1-.5.4-.5.8V9.5M8 12v.1" />}
      </svg>
      {t.significant ? "Very likely real" : "Could be chance"}
      <Info label="How sure are we?">{PTIP(t)}</Info>
    </span>
  );
}

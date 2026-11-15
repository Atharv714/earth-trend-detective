"use client";

// The detective's work as a report you can save as a PDF: every question, its
// answer with its charts, and the sources it cited, on white paper. It opens as a preview
// over the app; "Save as PDF" prints just this sheet (the browser's print dialog
// has "Save as PDF"). Print styles: `.pdf` in globals.css.

import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { CheckData, View } from "@/lib/agent/view";
import { Answer } from "./blocks";
import type { ChartSpec } from "./parts";

interface Props {
  messages: UIMessage[];
  view: View;
  charts: Map<string, ChartSpec>;
  onClose: () => void;
}

const textOf = (m: UIMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
const sentence = (q: string) => {
  const t = q.trim().replace(/\s+/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** Question and answer pairs, skipping answers that never arrived. */
function pairs(messages: UIMessage[]) {
  const out: { q: string; a: UIMessage }[] = [];
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    if (m.role === "assistant" && textOf(m).trim() && prev?.role === "user") out.push({ q: sentence(textOf(prev)), a: m });
  });
  return out;
}

/** The web pages an answer cites, once each, in order. */
function sourcesOf(text: string) {
  const seen = new Map<string, string>();
  for (const m of text.matchAll(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g)) if (!seen.has(m[2])) seen.set(m[2], m[1]);
  return [...seen].map(([url, title]) => ({ url, title }));
}

export const hasReport = (messages: UIMessage[]) => pairs(messages).length > 0;

export function PdfReport({ messages, view, charts, onClose }: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  const items = pairs(messages);
  const today = new Date();
  const date = today.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const place = view.placeName ?? null;

  // Folded notes ("How we tested this") are part of the record: open them all.
  useEffect(() => {
    sheet.current?.querySelectorAll("details").forEach((d) => (d.open = true));
  });

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    document.documentElement.classList.add("is-printing-report");
    return () => {
      window.removeEventListener("keydown", key);
      document.documentElement.classList.remove("is-printing-report");
    };
  }, [onClose]);

  // The PDF is named after the page title, so give it a useful one while printing.
  const save = () => {
    const was = document.title;
    const stamp = today.toISOString().slice(0, 10);
    document.title = `Earth Trend Detective${place ? ` - ${place}` : ""} - ${stamp}`;
    const restore = () => {
      document.title = was;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  };

  const title = items.length === 1 ? items[0].q : place ? `${place}: what we found` : "What we found";

  return createPortal(
    <div className="pdf" role="dialog" aria-modal="true" aria-label="Report preview">
      <div className="pdf-bar">
        <p>
          Your report. Press <b>Save as PDF</b> and pick <b>Save as PDF</b> as the printer.
        </p>
        <div>
          <button type="button" className="pdf-btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="pdf-btn is-primary" onClick={save} autoFocus>
            Save as PDF
          </button>
        </div>
      </div>

      <article className="pdf-sheet" ref={sheet}>
        <header className="pdf-head">
          <p className="pdf-brand">
            <span>Earth Trend Detective</span>
            <span>{date}</span>
          </p>
          <h1>{title}</h1>
          {items.length > 1 && (
            <ol className="pdf-toc">
              {items.map(({ q, a }) => (
                <li key={a.id}>{q}</li>
              ))}
            </ol>
          )}
        </header>

        {items.map(({ q, a }, i) => {
          const text = textOf(a);
          const sources = sourcesOf(text);
          const part = a.parts.find((p) => p.type === "data-check");
          const check = part && "data" in part ? (part.data as CheckData) : null;
          return (
            <section key={a.id} className="pdf-item">
              {items.length > 1 && (
                <h2 className="pdf-q">
                  <span>{i + 1}</span>
                  {q}
                </h2>
              )}
              <Answer text={text} charts={charts} />
              {(sources.length > 0 || (check && check.total > 0)) && (
                <div className="pdf-sources">
                  {sources.length > 0 && (
                    <>
                      <h3>Sources</h3>
                      <ol>
                        {sources.map((s) => (
                          <li key={s.url}>
                            {s.title} <span>{hostOf(s.url)}</span>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  {check && check.total > 0 && (
                    <p>
                      {check.traced === check.total
                        ? `All ${check.total} numbers match the NASA records the detective read.`
                        : `${check.traced} of ${check.total} numbers match the NASA records the detective read${sources.length ? "; the others come from the sources above" : ""}.`}
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}

        <footer className="pdf-foot">
          <span>Earth Trend Detective · NASA Space Apps 2026</span>
          <span>Trends show what changed, not what caused it.</span>
        </footer>
      </article>
    </div>,
    document.body,
  );
}

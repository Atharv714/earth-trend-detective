// The detective's last step: does every number in the answer come from a
// tool result (or the question)? Plain code, not a model, so it can't be
// talked round. The chat shows the result under the answer.

import type { CheckData } from "./view";

const NUMBER = /(?<![\w.])[−-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])[−-]?\d+(?:\.\d+)?/g;

const parse = (s: string) => Number(s.replace(/−/g, "-").replace(/,/g, ""));

/** Numbers that need no source: small counts, the method's own constants, decades, "1 in N". */
function exempt(raw: string, text: string, at: number): boolean {
  const v = Math.abs(parse(raw));
  if (Number.isInteger(v) && v <= 12) return true;
  if (v === 0.05 || v === 5 || v === 95 || v === 100) return true;
  const after = text.slice(at + raw.length, at + raw.length + 2);
  if (Number.isInteger(v) && v >= 1900 && v <= 2100 && v % 10 === 0 && after.startsWith("s")) return true;
  if (/\b1 in $/i.test(text.slice(Math.max(0, at - 5), at))) return true;
  return false;
}

export function numbersIn(text: string): number[] {
  return [...text.matchAll(NUMBER)].map((m) => parse(m[0])).filter(Number.isFinite);
}

/** Is `a`, as written with its decimals, a rounding of `v` (or of v in %, or of mm in cm)? */
function matches(a: number, decimals: number, pool: number[]): boolean {
  const tol = 0.5 * 10 ** -decimals + 1e-9;
  const x = Math.abs(a);
  return pool.some((v) => {
    const w = Math.abs(v);
    return Math.abs(x - w) <= tol || Math.abs(x - w * 100) <= tol || Math.abs(x - w / 10) <= tol;
  });
}

export function traceNumbers(answer: string, sources: string[]): CheckData {
  const pool = sources.flatMap(numbersIn);
  const untraced: string[] = [];
  let total = 0;
  for (const m of answer.matchAll(NUMBER)) {
    const raw = m[0];
    if (exempt(raw, answer, m.index ?? 0)) continue;
    total++;
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    if (!matches(parse(raw), decimals, pool)) untraced.push(raw);
  }
  return { total, traced: total - untraced.length, untraced: [...new Set(untraced)] };
}

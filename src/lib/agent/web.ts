// Two lookups outside our own data: the web (Parallel's Search API, key
// PARALLEL_WEB_SEARCH_KEY in .env) and NASA POWER's official parameter catalog.
import "server-only";

/* ------------------------------------------------------------------ */
/* Web search                                                          */

const PARALLEL = "https://api.parallel.ai/v1/search";

interface WebResult {
  url: string;
  title?: string | null;
  publish_date?: string | null;
  excerpts?: string[];
}

export async function webSearch({ objective, queries, max, after }: { objective: string; queries: string[]; max?: number | null; after?: string | null }) {
  const key = process.env.PARALLEL_WEB_SEARCH_KEY;
  if (!key) throw new Error("PARALLEL_WEB_SEARCH_KEY is missing from .env");
  const res = await fetch(PARALLEL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      objective,
      search_queries: queries.length ? queries : [objective.slice(0, 200)],
      // "advanced" is Parallel's most thorough mode, about 3 s.
      mode: "advanced",
      max_chars_total: 12000,
      advanced_settings: { max_results: max ?? 6, ...(after ? { source_policy: { after_date: after } } : {}) },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as { results?: WebResult[]; error?: { message?: string }; detail?: unknown };
  if (!res.ok || !json.results) throw new Error(`Web search failed (${res.status}): ${json.error?.message ?? JSON.stringify(json.detail ?? json).slice(0, 200)}`);
  return {
    objective,
    results: json.results.map((x) => ({ url: x.url, title: x.title ?? null, published: x.publish_date ?? null, excerpts: x.excerpts ?? [] })),
    note: "Web pages, not NASA data. Cite each fact with its URL and say how old it is.",
  };
}

/* ------------------------------------------------------------------ */
/* NASA POWER parameter catalog                                        */

interface Param {
  type?: string;
  source?: string;
  units?: string;
  name?: string;
  definition?: string;
}

let catalog: Promise<Record<string, Param>> | null = null;

function loadCatalog() {
  catalog ??= fetch("https://power.larc.nasa.gov/api/system/manager/parameters?community=AG&temporal=monthly").then(async (res) => {
    if (!res.ok) throw new Error(`NASA POWER catalog answered ${res.status}`);
    const all = (await res.json()) as Record<string, Param>;
    // Drop the hour-of-day copies (T2M_00 … T2M_23): they repeat a base parameter 24 times.
    return Object.fromEntries(Object.entries(all).filter(([k]) => !/_\d\d$/.test(k)));
  });
  catalog.catch(() => (catalog = null));
  return catalog;
}

/** Search POWER's official monthly catalog by words in the code, name or definition. */
export async function powerParameters({ search, max }: { search: string; max?: number | null }) {
  const all = await loadCatalog();
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = Object.entries(all)
    .map(([code, p]) => {
      const text = `${code} ${p.name ?? ""} ${p.definition ?? ""}`.toLowerCase();
      const head = `${code} ${p.name ?? ""}`.toLowerCase();
      const score = words.reduce((s, w) => s + (head.includes(w) ? 2 : text.includes(w) ? 1 : 0), 0);
      return { code, score, p };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, max ?? 15);
  return {
    totalParameters: Object.keys(all).length,
    matches: scored.map(({ code, p }) => ({ code, name: p.name, units: p.units, type: p.type, source: p.source, definition: p.definition?.slice(0, 300) })),
  };
}

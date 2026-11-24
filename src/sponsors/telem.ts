import { config } from "../config.js";
import { withFallback } from "./util.js";

export interface SearchResult {
  summary: string;
  sources: { title: string; url?: string }[];
  interactionId?: string;
}

// Telem AI: live web search with a trace of what was looked at (POST /v1/search).
const OFFLINE_FACTS: [RegExp, SearchResult][] = [
  [/cool|set|warm/i, { summary: "Pumpkin pie needs about 2 hours on a rack to cool and set; a slice cut early slumps and leaves wet crumbs.", sources: [{ title: "Offline note: pie cooling times" }] }],
  [/store|bought|bakery|homemade/i, { summary: "Store-bought pumpkin pies usually have a perfectly even, machine-crimped crust and a foil tin.", sources: [{ title: "Offline note: spotting a store-bought pie" }] }],
  [/bear|fur|honey/i, { summary: "Bears can smell food from over a mile away, and sticky pie filling clings to fur for hours.", sources: [{ title: "Offline note: bears and pie" }] }],
  [/porridge|goldilocks|chair|bed/i, { summary: "In the original 1837 tale, the intruder tried three bowls, three chairs and three beds before getting caught.", sources: [{ title: "Offline note: the 1837 story" }] }],
];

interface TelemResponse {
  interaction_id?: string;
  preprocessor_runs?: { output_payload?: { results?: { title?: string; url?: string; summary?: string; rank?: number }[] } }[];
}

export async function webSearch(query: string, opts: { numResults?: number; publishedAfter?: string } = {}) {
  return withFallback<SearchResult>(
    "Telem",
    `searched "${query}"`,
    config.keys.telem,
    async () => {
      const res = await fetch("https://router.telem.ai/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.keys.telem}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: { query }, search: { num_results: opts.numResults ?? 3, ...(opts.publishedAfter ? { published_after: opts.publishedAfter } : {}) } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Telem HTTP ${res.status}`);
      const body = (await res.json()) as TelemResponse;
      const results = (body.preprocessor_runs ?? [])
        .flatMap((r) => r.output_payload?.results ?? [])
        .filter((r) => r.title || r.summary)
        .slice(0, opts.numResults ? opts.numResults * 2 : 3);
      if (!results.length) throw new Error("no results");
      const summary = results.find((r) => r.summary)?.summary ?? results[0].title ?? "";
      return {
        summary: summary.length > 240 ? `${summary.slice(0, 237)}…` : summary,
        sources: results.map((r) => ({ title: r.title ?? r.url ?? "result", url: r.url })),
        interactionId: body.interaction_id,
      };
    },
    () =>
      OFFLINE_FACTS.find(([re]) => re.test(query))?.[1] ?? {
        summary: "Most Thanksgiving pie thefts happen between midnight and 3 AM, usually by a family member.",
        sources: [{ title: "Offline note: general pie folklore" }],
      },
  );
}

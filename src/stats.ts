import { nameOf } from "./engine/cast.js";
import { SUSPECTS, type SuspectId } from "./engine/types.js";
import { listCases, type CaseRecord } from "./store.js";

/** Local stand-in for the Bruin question: "across all films, who got accused most?" */
export function acrossRuns(cases: CaseRecord[]) {
  const accused: Record<string, number> = {};
  const guilty: Record<string, number> = {};
  const endings: Record<string, number> = {};
  let lies = 0;
  for (const c of cases) {
    if (c.ending.accused) accused[nameOf(c.ending.accused)] = (accused[nameOf(c.ending.accused)] ?? 0) + 1;
    for (const s of c.truth.culprits) guilty[nameOf(s)] = (guilty[nameOf(s)] ?? 0) + 1;
    endings[c.ending.title] = (endings[c.ending.title] ?? 0) + 1;
    lies += Object.values(c.lies).reduce((a, b) => a + b, 0);
  }
  const correct = cases.filter((c) => c.ending.accused && c.truth.culprits.includes(c.ending.accused)).length;
  const recent = cases.slice(0, 6).map((c) => ({
    id: c.id,
    caseNumber: c.caseNumber,
    ending: c.ending.title,
    accused: c.ending.accused,
    culprits: c.truth.culprits,
    visits: c.truth.visits,
  }));
  return { runs: cases.length, accused, guilty, endings, lies, correct, recent };
}

export async function stats() {
  return acrossRuns(await listCases());
}

/**
 * Goldilocks's casebook: what she learned from earlier cases. It goes into her prompt
 * (so past cases change her decisions) and on screen at the start of the film.
 */
export function casebook(cases: CaseRecord[]) {
  const per = Object.fromEntries(SUSPECTS.map((s) => [s, { guilty: 0, lies: 0, accused: 0 }])) as Record<SuspectId, { guilty: number; lies: number; accused: number }>;
  for (const c of cases) {
    for (const s of c.truth.culprits) per[s].guilty++;
    if (c.ending.accused) per[c.ending.accused].accused++;
    for (const s of SUSPECTS) per[s].lies += c.lies[s] ?? 0;
  }
  const total = Math.max(cases.length, cases[0]?.caseNumber ?? 0);
  const solved = cases.filter((c) => c.ending.accused && c.truth.culprits.includes(c.ending.accused)).length;
  const liar = [...SUSPECTS].sort((a, b) => per[b].lies - per[a].lies)[0];
  const caseLines = cases.slice(0, 6).map((c) => {
    const right = c.ending.accused && c.truth.culprits.includes(c.ending.accused);
    const culprits = c.truth.culprits.map(nameOf).join(" and ") || "nobody (you sleep-ate it)";
    return `Case ${c.caseNumber}: you accused ${c.ending.accused ? nameOf(c.ending.accused) : "nobody"} (${right ? "right" : "WRONG"}). Real culprit: ${culprits}.`;
  });
  const patterns = SUSPECTS.map((s) => `${nameOf(s)}: guilty ${per[s].guilty}×, caught lying ${per[s].lies}×, accused ${per[s].accused}×`);
  return {
    caseNumber: total + 1,
    prompt: cases.length ? [`Your casebook from ${cases.length} earlier case(s) in this cabin:`, ...caseLines, "Patterns:", ...patterns].join("\n") : "",
    onScreen: cases.length
      ? `Case #${total + 1}. Solved ${solved} of ${cases.length} on file.${per[liar].lies ? ` Most lies on file: ${nameOf(liar)} (${per[liar].lies}).` : ""}`
      : "Case #1. A fresh casebook.",
  };
}

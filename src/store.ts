// Where finished films live. Locally: the runs/ folder. On Vercel: Blob storage
// (used whenever BLOB_READ_WRITE_TOKEN is set). Every file is written once and never
// overwritten, so the Blob CDN never serves a stale copy.
import fs from "node:fs";
import path from "node:path";
import { list, put } from "@vercel/blob";
import { config } from "./config.js";
import type { CharacterId, Ending, Run, SuspectId, Truth } from "./engine/types.js";

/** A compact summary of one finished film, used for the casebook, memories and stats. */
export interface CaseRecord {
  id: string;
  caseNumber: number;
  createdAt: string;
  mode: Run["mode"];
  ending: Ending;
  truth: Truth;
  lies: Record<SuspectId, number>;
  /** what each character remembers going into the NEXT case */
  lastYear: Partial<Record<CharacterId, string>>;
  runUrl?: string;
}

const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const localCases = () => path.join(config.runsDir, "cases");

export async function saveRun(run: Run): Promise<string | undefined> {
  if (useBlob()) {
    const res = await put(`runs/${run.id}.json`, JSON.stringify(run), { access: "public", addRandomSuffix: false, contentType: "application/json" });
    return res.url;
  }
  const dir = path.join(config.runsDir, run.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run, null, 2));
  return undefined;
}

export async function saveCase(record: CaseRecord) {
  if (useBlob()) {
    await put(`cases/${record.createdAt.replace(/[:.]/g, "-")}_${record.id}.json`, JSON.stringify(record), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
    return;
  }
  fs.mkdirSync(localCases(), { recursive: true });
  fs.writeFileSync(path.join(localCases(), `${record.id}.json`), JSON.stringify(record, null, 2));
}

/** Most recent first. */
export async function listCases(limit = 40): Promise<CaseRecord[]> {
  if (useBlob()) {
    const { blobs } = await list({ prefix: "cases/", limit: 1000 });
    const recent = blobs.sort((a, b) => b.pathname.localeCompare(a.pathname)).slice(0, limit);
    const records = await Promise.all(recent.map(async (b) => (await fetch(b.url)).json() as Promise<CaseRecord>));
    return records;
  }
  if (!fs.existsSync(localCases())) return [];
  return fs
    .readdirSync(localCases())
    .map((f) => JSON.parse(fs.readFileSync(path.join(localCases(), f), "utf8")) as CaseRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function getRun(id: string): Promise<Run | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  if (useBlob()) {
    const { blobs } = await list({ prefix: `runs/${id}.json`, limit: 1 });
    if (!blobs[0]) return null;
    return (await fetch(blobs[0].url)).json() as Promise<Run>;
  }
  const file = path.join(config.runsDir, id, "run.json");
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Run) : null;
}

/** All films' decision rows as one CSV (header once). */
export async function decisionsCsv(): Promise<string> {
  if (useBlob()) {
    const { blobs } = await list({ prefix: "decisions/", limit: 1000 });
    const files = await Promise.all(blobs.map(async (b) => (await fetch(b.url)).text()));
    const [first, ...rest] = files;
    if (!first) return "";
    return [first.trimEnd(), ...rest.map((f) => f.split("\n").slice(1).join("\n").trimEnd())].filter(Boolean).join("\n") + "\n";
  }
  const file = path.join(config.runsDir, "decisions.csv");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export interface BruinInsights {
  generatedAt: string;
  accusations: { suspect: string; times_accused: number; times_right: number }[];
  lies: { suspect: string; lies: number; answers: number; lie_rate_pct: number }[];
  endings: { ending: string; films: number }[];
}

/** The latest results published by the Bruin pipeline (npm run bruin:sync). */
export async function latestBruinInsights(): Promise<BruinInsights | null> {
  try {
    if (useBlob()) {
      const { blobs } = await list({ prefix: "bruin/insights-", limit: 1000 });
      const latest = blobs.sort((a, b) => b.pathname.localeCompare(a.pathname))[0];
      return latest ? ((await (await fetch(latest.url)).json()) as BruinInsights) : null;
    }
    const file = path.join(config.runsDir, "bruin-insights.json");
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as BruinInsights) : null;
  } catch {
    return null;
  }
}

/** Copy a poster into Blob so it outlives Runware's temporary URL. */
export async function keepPoster(id: string, url: string): Promise<string> {
  if (!useBlob()) return url;
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const res = await put(`posters/${id}.jpg`, Buffer.from(bytes), { access: "public", addRandomSuffix: false, contentType: "image/jpeg" });
    return res.url;
  } catch {
    return url;
  }
}

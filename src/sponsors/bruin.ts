import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
import { config } from "../config.js";
import type { Run } from "../engine/types.js";
import { withFallback } from "./util.js";

// Bruin (required): every decision becomes a row. Each film's rows are published as a
// CSV (Blob on Vercel, runs/decisions.csv locally) that Bruin ingests, so you can ask
// questions across films: "which bear got accused most, and why?"
export const COLUMNS = ["run_id", "case_number", "beat", "scene", "kind", "actor", "target", "mood", "is_lie", "reason", "line", "ending", "accused", "culprits"];

export function decisionRows(run: Run) {
  return run.beats
    .filter((b) => b.actor !== "narrator" && b.kind !== "move" && b.kind !== "title")
    .map((b) => ({
      run_id: run.id,
      case_number: run.caseNumber,
      beat: b.i,
      scene: b.scene,
      kind: b.kind,
      actor: b.actor,
      target: b.target ?? "",
      mood: b.mood ?? "",
      is_lie: b.isLie ? 1 : 0,
      reason: b.reason ?? "",
      line: b.line ?? "",
      ending: run.ending?.id ?? "",
      accused: run.ending?.accused ?? "",
      culprits: (run.truth?.culprits ?? []).join("|"),
    }));
}

const cell = (v: unknown) => `"${String(v).replaceAll('"', '""').replace(/\s+/g, " ")}"`;
export const toCsv = (rows: ReturnType<typeof decisionRows>, header = true) =>
  (header ? COLUMNS.join(",") + "\n" : "") + rows.map((r) => COLUMNS.map((c) => cell(r[c as keyof typeof r])).join(",")).join("\n") + "\n";

export async function recordRun(run: Run) {
  const rows = decisionRows(run);
  let where = "runs/decisions.csv";
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const res = await put(`decisions/${run.id}.csv`, toCsv(rows), { access: "public", addRandomSuffix: false, contentType: "text/csv" });
    where = res.url;
  } else {
    const file = path.join(config.runsDir, "decisions.csv");
    fs.mkdirSync(config.runsDir, { recursive: true });
    fs.appendFileSync(file, toCsv(rows, !fs.existsSync(file)));
  }
  // Published to the public decisions feed that the Bruin pipeline (bruin/) ingests.
  return withFallback(
    "Bruin",
    `${rows.length} decisions → Bruin feed`,
    process.env.BLOB_READ_WRITE_TOKEN ? "feed" : "",
    async () => ({ rows: rows.length, where }),
    () => ({ rows: rows.length, where }),
  );
}

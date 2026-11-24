// Runs the Bruin pipeline over every film's decisions, queries its tables, and publishes
// the results as "Forest Police records" that every new film loads into its agents.
//   npm run bruin:sync
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { put } from "@vercel/blob";
import { ROOT } from "../config.js";

dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });

const bruinDir = path.join(ROOT, "bruin");
const env = { ...process.env, PATH: `${path.join(os.homedir(), ".local", "bin")}:${process.env.PATH}` };


interface QueryResult {
  columns: { name: string }[];
  rows: (string | number)[][];
}
const table = (name: string) => {
  const out = execFileSync("bruin", ["query", "--config-file", ".bruin.yml", "--connection", "duckdb-default", "--query", `SELECT * FROM analytics.${name}`, "--output", "json"], { cwd: bruinDir, env, encoding: "utf8" });
  const r = JSON.parse(out.slice(out.indexOf("{"))) as QueryResult;
  return r.rows.map((row) => Object.fromEntries(r.columns.map((c, k) => [c.name, typeof row[k] === "string" && /^\d+(\.\d+)?$/.test(row[k] as string) ? Number(row[k]) : row[k]])));
};


console.log("Running the Bruin pipeline…");
execFileSync("bruin", ["run", "--config-file", ".bruin.yml", "decisions"], { cwd: bruinDir, env, stdio: "inherit" });

const insights = {
  generatedAt: new Date().toISOString(),
  source: "Bruin pipeline bruin/decisions (analytics.accusations, analytics.lies, analytics.endings)",
  accusations: table("accusations"),
  lies: table("lies"),
  endings: table("endings"),
};
console.log(JSON.stringify(insights, null, 2));

const local = path.join(ROOT, "runs", "bruin-insights.json");
fs.mkdirSync(path.dirname(local), { recursive: true });
fs.writeFileSync(local, JSON.stringify(insights, null, 2));
if (process.env.BLOB_READ_WRITE_TOKEN) {
  const res = await put(`bruin/insights-${insights.generatedAt.replace(/[:.]/g, "-")}.json`, JSON.stringify(insights), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  console.log(`Published to ${res.url}`);
}

// Minimal Runware HTTP client: POST an array of tasks to https://api.runware.ai/v1.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const API = "https://api.runware.ai/v1";

interface RunwareError {
  code: string;
  message: string;
  parameter?: string;
}

export async function runware<T = Record<string, unknown>>(tasks: Record<string, unknown>[]): Promise<T[]> {
  if (!config.keys.runware) throw new Error("RUNWARE_API_KEY is empty in .env");
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.keys.runware}`, "Content-Type": "application/json" },
    body: JSON.stringify(tasks),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T[]; errors?: RunwareError[] };
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => `${e.code}: ${e.message}${e.parameter ? ` (${e.parameter})` : ""}`).join("; "));
  }
  if (!res.ok) throw new Error(`Runware HTTP ${res.status}`);
  return body.data ?? [];
}

export const uuid = () => crypto.randomUUID();

/** Poll an async task (e.g. 3dInference) until it succeeds. */
export async function waitFor<T extends { status?: string; progress?: number }>(taskUUID: string, label: string, timeoutMs = 10 * 60_000) {
  const started = Date.now();
  let delay = 2000;
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, delay));
    const data = await runware<T & { taskUUID: string }>([{ taskType: "getResponse", taskUUID }]);
    const result = data.find((d) => d.taskUUID === taskUUID);
    if (result?.status === "success") return result;
    process.stdout.write(`\r${label}: ${result?.status ?? "waiting"} ${result?.progress ?? ""}%   `);
    delay = Math.min(delay * 1.5, 10_000);
  }
  throw new Error(`${label} timed out`);
}

export async function download(url: string, file: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

export function dataUri(file: string) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

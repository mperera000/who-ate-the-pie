import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const env = (key: string) => (process.env[key] ?? "").trim();

export type Effort = "low" | "medium" | "high";

export const config = {
  /** Offline mode: no Claude key, or MOCK=1. Characters use canned decisions. */
  mock: env("MOCK") === "1" || !env("ANTHROPIC_API_KEY"),
  model: env("CLAUDE_MODEL") || "claude-opus-5-5",
  effort: (env("CLAUDE_EFFORT") || "low") as Effort,
  rounds: Math.max(1, Number(env("INTERROGATION_ROUNDS") || 4)),
  port: Number(env("PORT") || 5173),
  keys: {
    bruin: env("BRUIN_API_KEY"),
    band: env("BAND_API_KEY"),
    runware: env("RUNWARE_API_KEY"),
    telem: env("TELEM_API_KEY"),
    glasser: env("GLASSER_API_KEY"),
    finch: env("FINCH_API_KEY"),
  },
  runsDir: path.join(ROOT, "runs"),
  webDir: path.join(ROOT, "web"),
};

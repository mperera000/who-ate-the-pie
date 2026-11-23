// Web-standard handlers shared by the local server (src/server.ts) and Vercel (api/*.ts).
import { config } from "../config.js";
import { generateRun, type StreamEvent } from "../engine/story.js";
import { stats } from "../stats.js";
import { bandReady } from "../sponsors/band.js";
import { decisionsCsv, getRun, listCases } from "../store.js";

const MAX_FILMS_PER_DAY = Number(process.env.MAX_FILMS_PER_DAY || 40);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const sponsorStatus = () => ({
  Claude: !config.mock,
  Bruin: Boolean(config.keys.bruin),
  BAND: bandReady(),
  Runware: Boolean(config.keys.runware),
  Telem: Boolean(config.keys.telem),
  Glasser: Boolean(config.keys.glasser),
  Finch: Boolean(config.keys.finch),
});

export async function handleConfig() {
  return json({ mode: config.mock ? "offline" : "live", model: config.model, rounds: config.rounds, keys: sponsorStatus(), maxFilmsPerDay: MAX_FILMS_PER_DAY });
}

export async function handleStats() {
  return json(await stats());
}

/** GET /api/runs → recent films; GET /api/runs?id=… → one full film. */
export async function handleRuns(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const run = await getRun(id);
    return run ? json(run) : json({ error: "Not found" }, 404);
  }
  const cases = await listCases(30);
  return json(cases.map((c) => ({ id: c.id, caseNumber: c.caseNumber, createdAt: c.createdAt, mode: c.mode, status: "done", ending: c.ending.title })));
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

/** POST /api/generate → streams the film as newline-delimited JSON while the agents decide it. */
export async function handleGenerate(request: Request) {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);
  const made = (await listCases(200)).filter((c) => new Date(c.createdAt).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) === today()).length;
  if (made >= MAX_FILMS_PER_DAY) {
    return json({ error: `Today's budget of ${MAX_FILMS_PER_DAY} new films is used up. Pick a past case to watch.` }, 429);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await generateRun(send);
      } catch (error) {
        console.error("[generate] failed:", error);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}

/** GET /api/decisions.csv → every decision from every film, one row each (Bruin ingests this). */
export async function handleDecisions() {
  return new Response(await decisionsCsv(), { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
}

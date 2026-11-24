// Local dev server: serves web/ and routes /api/* to the same handlers Vercel uses.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { handleConfig, handleDecisions, handleGenerate, handleRuns, handleStats } from "./api/handlers.js";
import { config } from "./config.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
};

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  "/api/config": () => handleConfig(),
  "/api/stats": () => handleStats(),
  "/api/runs": (req) => handleRuns(req),
  "/api/generate": (req) => handleGenerate(req),
  "/api/decisions.csv": () => handleDecisions(),
};

function serveFile(res: http.ServerResponse, rel: string) {
  const file = path.resolve(config.webDir, "." + path.sep + rel);
  if (!file.startsWith(config.webDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
  const route = ROUTES[url.pathname];
  if (!route) return serveFile(res, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1)));
  try {
    const response = await route(new Request(url, { method: req.method }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) for await (const chunk of response.body) res.write(chunk);
    res.end();
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: (error as Error).message }));
  }
});

server.listen(config.port, () => {
  console.log(`Who Ate the Pie? → http://localhost:${config.port}  (${config.mock ? "offline mode: add ANTHROPIC_API_KEY to .env for live agents" : `live: ${config.model}`})`);
});

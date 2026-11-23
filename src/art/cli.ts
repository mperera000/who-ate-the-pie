// Character art with Runware.
//   npm run art -- images                 3 options per character (FLUX.2 dev)
//   npm run art -- images goldilocks 4    4 options for one character
//   npm run art -- 3d papa papa-2.png     turn a chosen image into a GLB model (Tripo 3D)
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { CABIN_PROMPT, CHARACTER_ART, NEGATIVE, promptFor } from "./characters.js";
import { dataUri, download, runware, uuid, waitFor } from "./runware.js";

const IMAGE_MODEL = "runware:400@1"; // FLUX.2 [dev]
const MODEL_3D = "tripo:v3.1@0"; // Tripo 3D v3.1, image to 3D
const charDir = path.join(config.webDir, "assets", "characters");
const modelDir = path.join(config.webDir, "assets", "models");
const manifestFile = path.join(charDir, "manifest.json");

type Manifest = Record<string, { name: string; color: string; prompt: string; images: string[]; model?: string; chosen?: string }>;
const readManifest = (): Manifest => (fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {});
const writeManifest = (m: Manifest) => {
  fs.mkdirSync(charDir, { recursive: true });
  fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2));
};

async function images(only?: string, count = 3) {
  const manifest = readManifest();
  const targets = CHARACTER_ART.filter((c) => !only || c.id === only);
  if (!targets.length) throw new Error(`Unknown character "${only}". Use: ${CHARACTER_ART.map((c) => c.id).join(", ")}`);
  let total = 0;
  await Promise.all(
    targets.map(async (c) => {
      const prompt = promptFor(c);
      const data = await runware<{ imageURL: string; cost?: number }>([
        {
          taskType: "imageInference",
          taskUUID: uuid(),
          model: IMAGE_MODEL,
          positivePrompt: prompt,
          negativePrompt: NEGATIVE,
          width: 1024,
          height: 1536,
          numberResults: count,
          outputType: "URL",
          outputFormat: "PNG",
          includeCost: true,
        },
      ]);
      const existing = manifest[c.id]?.images ?? [];
      const files: string[] = [];
      for (const [k, d] of data.entries()) {
        const file = `${c.id}-${existing.length + k + 1}.png`;
        await download(d.imageURL, path.join(charDir, file));
        files.push(file);
        total += d.cost ?? 0;
      }
      manifest[c.id] = { ...manifest[c.id], name: c.name, color: c.color, prompt, images: [...existing, ...files] };
      console.log(`✓ ${c.name}: ${files.join(", ")}`);
    }),
  );
  writeManifest(manifest);
  console.log(`Saved to web/assets/characters. Cost: $${total.toFixed(3)}. Open http://localhost:${config.port}/characters.html`);
}

async function model3d(id: string, file: string) {
  const manifest = readManifest();
  const src = path.join(charDir, file);
  if (!fs.existsSync(src)) throw new Error(`No image at web/assets/characters/${file}`);
  const taskUUID = uuid();
  console.log(`Sending ${file} to ${MODEL_3D}… (this takes a few minutes)`);
  await runware([
    {
      taskType: "3dInference",
      taskUUID,
      model: MODEL_3D,
      inputs: { images: [dataUri(src)] },
      outputFormat: "GLB",
      settings: { texture: true, pbr: true, textureQuality: "detailed", orientation: "align_image" },
      includeCost: true,
    },
  ]);
  const result = await waitFor<{ status: string; cost?: number; outputs?: { files?: { url: string }[] } }>(taskUUID, `3D ${id}`);
  const url = result.outputs?.files?.[0]?.url;
  if (!url) throw new Error("3D task finished without a model file");
  const out = path.join(modelDir, `${id}.glb`);
  await download(url, out);
  // Re-read: other 3D conversions may have updated the manifest while this one ran.
  const latest = readManifest();
  latest[id] = { ...latest[id], chosen: file, model: `models/${id}.glb` } as Manifest[string];
  writeManifest(latest);
  console.log(`\n✓ ${id} → web/assets/models/${id}.glb${result.cost ? ` ($${result.cost})` : ""}`);
}

async function scene(count = 3) {
  const dir = path.join(config.webDir, "assets", "scenes");
  const data = await runware<{ imageURL: string; cost?: number }>([
    {
      taskType: "imageInference",
      taskUUID: uuid(),
      model: IMAGE_MODEL,
      positivePrompt: CABIN_PROMPT,
      negativePrompt: "people, characters, animals, bears, text, watermark, logo, blurry, single room, exterior only",
      width: 1536,
      height: 864,
      numberResults: count,
      outputType: "URL",
      outputFormat: "PNG",
      includeCost: true,
    },
  ]);
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith("cabin-")).length : 0;
  let cost = 0;
  for (const [k, d] of data.entries()) {
    await download(d.imageURL, path.join(dir, `cabin-${existing + k + 1}.png`));
    cost += d.cost ?? 0;
  }
  console.log(`✓ ${data.length} cabin images in web/assets/scenes ($${cost.toFixed(3)})`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "images") await images(a, Number(b) || 3);
else if (cmd === "scene") await scene(Number(a) || 3);
else if (cmd === "3d" && a && b) await model3d(a, b);
else console.log("Usage:\n  npm run art -- images [character] [count]\n  npm run art -- 3d <character> <image-file>");

import { runware, uuid } from "../art/runware.js";
import { config } from "../config.js";
import type { Character, CharacterId } from "../engine/types.js";
import { NotWired, withFallback } from "./util.js";

// Runware: every character speaks with their own voice (xAI TTS through Runware).
// The returned audio URL is hosted by Runware, so nothing needs storing.
const VOICES: Record<CharacterId | "narrator", string> = {
  goldilocks: "eve",
  papa: "rex",
  mama: "carina",
  baby: "leo",
  narrator: "sal",
};

export async function voiceLine(speaker: Character | "narrator", line: string) {
  const id = speaker === "narrator" ? "narrator" : speaker.id;
  return withFallback<string | null>(
    "Runware",
    `voice (${VOICES[id]})`,
    config.keys.runware,
    async () => {
      const [result] = await runware<{ audioURL?: string; cost?: number }>([
        {
          taskType: "audioInference",
          taskUUID: uuid(),
          model: "xai:tts@0",
          speech: { text: line.slice(0, 600), voice: VOICES[id] },
          outputType: "URL",
          outputFormat: "MP3",
          includeCost: true,
        },
      ]);
      if (!result?.audioURL) throw new Error("no audioURL in response");
      return result.audioURL;
    },
    () => null,
  );
}

export async function renderImage(prompt: string) {
  return withFallback<string | null>("Runware", "render image", config.keys.runware, async () => {
    void prompt;
    throw new NotWired();
  }, () => null);
}

import { config } from "../config.js";
import type { Character } from "../engine/types.js";
import { NotWired, withFallback } from "./util.js";

// Finch: reusable agent skills. Each character "equips" one skill and the
// skill's instructions shape what they say and do.
const OFFLINE_SKILLS: Record<string, string> = {
  Investigate:
    "Notice small physical details, ask one pointed question at a time, and connect contradictions between what different people said.",
  "Guilt-trip": "Deflect suspicion by reminding people how much you've sacrificed for this family.",
  Deceive: "When cornered, tell a confident half-truth and change the subject to something louder.",
  Persuade: "Calmly steer the room's suspicion toward someone else using a tidy, logical-sounding argument.",
  Snitch: "Trade information about other people's misdeeds to get yourself out of trouble.",
};

export async function equipSkill(character: Character) {
  return withFallback(
    "Finch",
    `equip ${character.skill}`,
    config.keys.finch,
    async () => {
      // TODO: fetch the skill from Finch's API with config.keys.finch.
      throw new NotWired();
    },
    () => OFFLINE_SKILLS[character.skill] ?? "Stay in character.",
  );
}

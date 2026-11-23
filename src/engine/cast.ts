import type { Character, CharacterId, SuspectId } from "./types.js";

export const CAST: Character[] = [
  {
    id: "goldilocks",
    name: "Detective Goldilocks",
    role: "detective",
    emoji: "🕵️‍♀️",
    color: "#ffb020",
    personality:
      "A tiny, brilliant girl detective in a deerstalker and tweed cape. Once infamous for breaking into this very cabin and eating the porridge, now reformed. Smug, theatrical, Sherlock-style deductions, loves the word 'elementary'.",
    secret: "She still can't resist anything that's 'just right', and she would love a slice of that pie.",
    goal: "Find out who ate the Thanksgiving pie before the forest guests arrive at noon.",
    skill: "Investigate",
    voice: { pitch: 1.35, rate: 1.05 },
    model: "models/goldilocks.glb",
    portrait: "characters/goldilocks-1.png",
  },
  {
    id: "papa",
    name: "Papa Bear",
    role: "suspect",
    emoji: "🐻",
    color: "#ff6a3d",
    personality: "Huge, gruff, proud and loud. Gets defensive fast and sweats when nervous. Talks about his chair when he wants to change the subject.",
    secret: "The doctor put him on a strict diet two weeks ago, and he has been sneaking snacks every night since.",
    goal: "Keep everyone from finding out about his midnight snacking.",
    skill: "Deceive",
    voice: { pitch: 0.55, rate: 0.9 },
    model: "models/papa.glb",
    portrait: "characters/papa-2.png",
  },
  {
    id: "mama",
    name: "Mama Bear",
    role: "suspect",
    emoji: "🐻",
    color: "#ff9bd2",
    personality: "Sweet voice, sharp mind. Knows everything that happens in this house and enjoys being the smartest bear in the room.",
    secret: "She burned her pie on Wednesday. The one on the counter came from the forest bakery, and she passed it off as homemade.",
    goal: "Protect her reputation as the best baker in the woods, whatever it takes.",
    skill: "Persuade",
    voice: { pitch: 1.05, rate: 0.95 },
    model: "models/mama.glb",
    portrait: "characters/mama-2.png",
  },
  {
    id: "baby",
    name: "Baby Bear",
    role: "suspect",
    emoji: "🧸",
    color: "#3ee6c4",
    personality: "Small, hyper and brutally honest, except when he's in trouble. Still holds a grudge against Goldilocks for breaking his chair.",
    secret: "He broke Mama's antique porridge bowl yesterday and hid the pieces under his bed.",
    goal: "Stay out of trouble and get the biggest slice of whatever is left.",
    skill: "Snitch",
    voice: { pitch: 1.8, rate: 1.2 },
    model: "models/baby.glb",
    portrait: "characters/baby-2.png",
  },
];

export const byId = (id: CharacterId): Character => {
  const c = CAST.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown character ${id}`);
  return c;
};

export const nameOf = (id: CharacterId | SuspectId) => byId(id).name;

/** The fixed opening. Everything after it is decided by the characters. */
export const OPENING =
  "Thanksgiving Eve at the Three Bears' log cabin in the woods. Mama's pumpkin pie cools on the kitchen counter: eight perfect slices for tomorrow's forest feast. The bears go up to bed. Downstairs, the pie waits.";

// Canned decisions for offline mode (no Claude key) and for any call that fails.
// They're random on purpose, so offline runs still end differently.
import { SUSPECTS, type SuspectId } from "./types.js";

export const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
export const chance = (p: number) => Math.random() < p;

const PLAN_THOUGHTS: Record<SuspectId, string[]> = {
  papa: ["The doctor's asleep. Probably.", "A bear needs fuel. It's basically medicine."],
  mama: ["I should check on my pie. My pie.", "Nobody inspects a pie like its baker."],
  baby: ["Biggest slice goes to whoever gets there first.", "I'm not scared of the dark. Mostly."],
};

export function offlinePlan(id: SuspectId) {
  return {
    when: pick(["stay_in_bed", "midnight", "1am", "2am", "3am"] as const),
    thought: pick(PLAN_THOUGHTS[id]),
  };
}

const MIDNIGHT_THOUGHTS: Record<SuspectId, string[]> = {
  papa: ["Just one slice. The doctor will never know.", "Diet starts tomorrow. Again."],
  mama: ["Nobody will know it came from the bakery.", "A baker must taste her work."],
  baby: ["Biggest slice. Finally.", "If I hide it, it's still technically there."],
};

export function offlineMidnight(id: SuspectId, others: SuspectId[], pieOnCounter: boolean) {
  const choice = pieOnCounter ? pick(["eat_one_slice", "eat_one_slice", "eat_two_slices", "hide_the_pie", "leave_it_alone"] as const) : "leave_it_alone";
  return {
    choice,
    frame: chance(0.3) ? pick(others) : ("nobody" as const),
    clean_up: chance(0.5),
    thought: pick(MIDNIGHT_THOUGHTS[id]),
    reason: choice === "leave_it_alone" ? "Too risky tonight." : "The pie was right there.",
    mood: pick(["😋", "😏", "😰"] as const),
  };
}

const QUESTIONS = [
  "Where were you at midnight, and why is there pumpkin in your fur?",
  "Explain the crumbs. Slowly.",
  "Somebody in this cabin is lying. Is it you?",
  "Elementary question: who in this family would betray a pie?",
];

export function offlineDetective(suspicion: Record<SuspectId, number>) {
  const target = pick(SUSPECTS);
  const research = pick(["none", "none", "web", "data"] as const);
  return {
    target,
    question: pick(QUESTIONS),
    research,
    research_query: research === "web" ? "how long does pumpkin pie take to cool" : research === "data" ? "price of store-bought pumpkin pie" : "",
    reason: "Following the crumbs.",
    mood: pick(["🧐", "😏", "🙄"] as const),
    suspicion: Object.fromEntries(SUSPECTS.map((s) => [s, Math.min(100, Math.max(0, suspicion[s] + Math.round(Math.random() * 30 - 12)))])) as Record<SuspectId, number>,
  };
}

const ANSWERS: Record<SuspectId, string[]> = {
  papa: ["I was asleep in MY bed, which is too hard, by the way.", "Crumbs? Those are… porridge crumbs. Different crumbs."],
  mama: ["I baked that pie with my own two paws. Why would I eat it?", "Ask yourself who has a history of eating other bears' food, dear."],
  baby: ["I didn't do it! But I know who did. For a slice.", "I was asleep! Don't look under my bed."],
};

export function offlineAnswer(id: SuspectId, others: SuspectId[], guilty: boolean) {
  const whisperTo = chance(0.4) ? pick(others) : ("nobody" as const);
  return {
    answer: pick(ANSWERS[id]),
    is_lie: guilty ? chance(0.8) : chance(0.2),
    reason: guilty ? "Can't let them know." : "Telling it like it is.",
    mood: guilty ? pick(["😰", "😇", "😳"] as const) : pick(["😤", "🙄", "😇"] as const),
    move_to: chance(0.3) ? pick(["kitchen", "bedroom"] as const) : ("stay" as const),
    whisper_to: whisperTo,
    whisper: whisperTo === "nobody" ? "" : "Back me up and the last slice is yours.",
  };
}

export function offlineAccuse(suspicion: Record<SuspectId, number>) {
  const accused = [...SUSPECTS].sort((a, b) => suspicion[b] - suspicion[a])[0];
  return {
    accused,
    speech: "Elementary! The crumbs, the lies, the guilty fur. You ate the pie!",
    reason: "Highest suspicion after the interviews.",
    mood: "🧐" as const,
  };
}

export function offlineReact() {
  return { mood: pick(["😱", "😳", "😏", "🙄"] as const), mutter: pick(["I knew it.", "No way.", "Called it.", "Oh dear."]) };
}

export function offlineResponse(guilty: boolean) {
  const confess = guilty && chance(0.5);
  return {
    confess,
    line: confess ? "Fine! It was me! It was a very good pie!" : guilty ? "This is an outrage! I demand a recount!" : "I'm innocent! This girl has lost her deerstalker!",
    reason: confess ? "The guilt was too much." : "Not going down today.",
    mood: confess ? ("😭" as const) : ("😤" as const),
  };
}

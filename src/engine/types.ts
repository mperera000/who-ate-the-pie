export const SUSPECTS = ["papa", "mama", "baby"] as const;
export type SuspectId = (typeof SUSPECTS)[number];
export type CharacterId = "goldilocks" | SuspectId;

// The Three Bears' log cabin in the woods: the pie cools in the kitchen, three bowls sit in
// the dining room, three chairs by the parlour fireplace, three beds upstairs.
// "outside" is the front porch, where Goldilocks waits before she knocks.
export const PLACES = ["kitchen", "dining", "parlour", "bedroom", "outside"] as const;
export type Place = (typeof PLACES)[number];

export interface Character {
  id: CharacterId;
  name: string;
  role: "detective" | "suspect";
  emoji: string;
  color: string;
  personality: string;
  secret: string;
  goal: string;
  /** Finch skill name; the instruction text comes from the Finch adapter. */
  skill: string;
  voice: { pitch: number; rate: number };
  /** 3D model and portrait, relative to /assets */
  model: string;
  portrait: string;
}

export type SponsorName = "Claude" | "Bruin" | "BAND" | "Runware" | "Telem" | "Glasser" | "Finch";

export interface SponsorUse {
  sponsor: SponsorName;
  what: string;
  /** false when the offline stand-in ran instead of the real API */
  live: boolean;
  ms?: number;
  costUsd?: number;
}

export type SceneId = "cast" | "midnight" | "morning" | "interrogation" | "accusation" | "reveal";

export type BeatKind =
  | "title" // scene title card
  | "narrate" // narrator caption
  | "memory" // a character remembers last Thanksgiving / Goldilocks reads her casebook
  | "move" // a character walks to a room
  | "plan" // a bear decides when to sneak downstairs
  | "sneak" // private midnight action
  | "say" // spoken line
  | "whisper" // private BAND message
  | "research" // Telem / Glasser lookup
  | "accuse"
  | "react" // a bystander's reaction (mood + mutter)
  | "evidence" // a clue, shown as a close-up exhibit
  | "verdict" // Goldilocks's "just right" test on an answer
  | "secret" // a bear blurts out another bear's secret
  | "flashback" // lights-on replay of what a bear really did
  | "weather" // tonight's live weather at the cabin
  | "radio" // a real headline on the cabin radio
  | "wildcard" // a random twist
  | "respond"
  | "reveal";

export const MOODS = ["calm", "nervous", "smug", "angry", "sad", "shocked", "sly", "innocent", "hungry", "suspicious"] as const;

export interface Beat {
  i: number;
  scene: SceneId;
  kind: BeatKind;
  actor: CharacterId | "narrator";
  target?: CharacterId;
  place?: Place;
  line?: string;
  reason?: string;
  isLie?: boolean;
  /** hidden from the audience until the reveal */
  sealed?: boolean;
  sources?: { title: string; url?: string }[];
  suspicion?: Record<SuspectId, number>;
  pieSlices?: number;
  /** emoji the character chose to show how they feel */
  mood?: string;
  sponsors: SponsorUse[];
  /** URL of the voice clip (Runware), patched in once it's ready */
  audio?: string;
  /** what a close-up shows: the pie, a bear's chair, or a crumb trail to a bear */
  focus?: { kind: "pie" | "chair" | "trail"; who?: SuspectId };
  exhibit?: string;
  verdict?: "too_hot" | "too_cold" | "just_right";
  /** true when this line will never get a voice clip (caption only) */
  silent?: boolean;
}

export const MIDNIGHT_CHOICES = ["eat_one_slice", "eat_two_slices", "hide_the_pie", "leave_it_alone"] as const;
export type MidnightChoice = (typeof MIDNIGHT_CHOICES)[number];
export const SNEAK_TIMES = ["stay_in_bed", "midnight", "1am", "2am", "3am"] as const;

export interface Visit {
  id: SuspectId;
  time: (typeof SNEAK_TIMES)[number];
  choice: MidnightChoice | "stayed_in_bed";
  frame: SuspectId | null;
  cleanedUp: boolean;
}

export interface Truth {
  visits: Visit[];
  eaten: Record<SuspectId, number>;
  hiddenBy: SuspectId | null;
  framed: { by: SuspectId; target: SuspectId }[];
  culprits: SuspectId[];
  slicesLeft: number;
  /** the exhibits shown in the film, with what they really mean (for the debrief) */
  clues?: { exhibit: string; line: string; pointsTo: SuspectId | null; honest: boolean; why: string }[];
  /** secrets that slipped out during questioning (red herrings) */
  secretsOut?: SuspectId[];
}

export type EndingId = "case_closed" | "caught_denying" | "framed" | "wrong_suspect" | "detective_did_it";

export interface Ending {
  id: EndingId;
  title: string;
  summary: string;
  accused: SuspectId | null;
}

export interface Run {
  id: string;
  createdAt: string;
  status: "generating" | "done" | "error";
  error?: string;
  mode: "live" | "offline";
  model: string;
  /** identical for every run: proves the opening never changes */
  setupId: string;
  caseNumber: number;
  cast: Character[];
  beats: Beat[];
  truth?: Truth;
  ending?: Ending;
  lastYear: Partial<Record<CharacterId, string>>;
  weather?: { forest: string; description: string; sky: string; live: boolean };
}

import crypto from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { openCaseRoom, whisper } from "../sponsors/band.js";
import { recordRun } from "../sponsors/bruin.js";
import { equipSkill } from "../sponsors/finch.js";
import { lookupFact } from "../sponsors/glasser.js";
import { renderImage, voiceLine } from "../sponsors/runware.js";
import { webSearch } from "../sponsors/telem.js";
import { casebook } from "../stats.js";
import { WILDCARDS, liveWeather, weatherRules } from "../world.js";
import { keepPoster, latestBruinInsights, listCases, saveCase, saveRun, type BruinInsights } from "../store.js";
import { Brain } from "./brain.js";
import { CAST, OPENING, byId, nameOf } from "./cast.js";
import { offlineAccuse, offlineAnswer, offlineDetective, offlineMidnight, offlinePlan, offlineReact, offlineResponse } from "./offline.js";
import {
  MIDNIGHT_CHOICES,
  MOODS,
  SNEAK_TIMES,
  SUSPECTS,
  type Beat,
  type CharacterId,
  type Ending,
  type Place,
  type Run,
  type SponsorUse,
  type SuspectId,
  type Truth,
  type Visit,
} from "./types.js";

const TOTAL_SLICES = 8;
interface Clue {
  line: string;
  focus: NonNullable<Beat["focus"]>;
  pointsTo: SuspectId | null;
  honest: boolean;
  why: string;
}
const others = (id: SuspectId) => SUSPECTS.filter((s) => s !== id) as SuspectId[];
const nobodyOr = (ids: SuspectId[]) => z.enum(["nobody", ...ids] as [string, ...string[]]);
const mood = z.enum(MOODS).describe("The emoji that shows how you feel right now");

// Identical for every run. Shown on screen to prove the opening never changes.
export const SETUP_ID = crypto
  .createHash("sha1")
  .update(JSON.stringify({ CAST, OPENING, TOTAL_SLICES }))
  .digest("hex")
  .slice(0, 6)
  .toUpperCase();

// ---------- decision schemas (Claude must answer in exactly this shape) ----------

const planSchema = z.object({
  when: z.enum(SNEAK_TIMES).describe("When you sneak down to the kitchen tonight, or stay_in_bed"),
  thought: z.string().describe("What you mutter to yourself in bed, under 10 words"),
});

const midnightSchema = (id: SuspectId) =>
  z.object({
    choice: z.enum(MIDNIGHT_CHOICES),
    frame: nobodyOr(others(id)).describe("Smear crumbs on another bear's chair to frame them, or nobody"),
    clean_up: z
      .boolean()
      .describe("Clean up every crumb before leaving. Safer evidence-wise, but you linger and the next bear downstairs may see you."),
    thought: z.string().describe("What you mutter to yourself, in character, under 10 words"),
    reason: z.string().describe("Why you chose this, one sentence"),
    mood,
  });

const suspicionSchema = z
  .object({ papa: z.number(), mama: z.number(), baby: z.number() })
  .describe("How suspicious each bear is right now, 0 to 100");

const detectiveSchema = z.object({
  target: z.enum(SUSPECTS).describe("Which bear you question this round. You will walk over to them."),
  question: z.string().describe("Your question, spoken aloud, 14 words or fewer"),
  research: z.enum(["none", "web", "data"]).describe("Optionally check the live web (web) or a real-world dataset (data) first"),
  research_query: z.string().describe("Search query when research is web or data, otherwise empty"),
  reason: z.string().describe("Why you're asking this bear this question, one sentence"),
  mood,
  suspicion: suspicionSchema,
});

const answerSchema = (id: SuspectId) =>
  z.object({
    answer: z.string().describe("What you say aloud, 14 words or fewer"),
    is_lie: z.boolean().describe("true if your answer is a lie"),
    reason: z.string().describe("Your real motive for answering this way, one sentence"),
    mood,
    move_to: z.enum(["stay", "kitchen", "parlour", "bedroom"]).describe("Where you walk off to after answering, or stay"),
    alibi_fact: z.string().describe("Optional: one real-world fact you cite to back up your story (something from the radio news, tonight's real weather, a real event or game). Goldilocks may fact-check it on the live web. Empty if none."),
    blurt_secret: nobodyOr([KNOWS[id]]).describe("Blurt out the secret you know about another bear to shift suspicion (dramatic!), or nobody"),
    whisper_to: nobodyOr(others(id)).describe("Privately message one other bear afterwards, or nobody"),
    whisper: z.string().describe("The private message, 12 words or fewer, empty if nobody"),
  });

// Each bear knows one other bear's secret, and may blurt it out to deflect.
const KNOWS: Record<SuspectId, SuspectId> = { papa: "mama", mama: "baby", baby: "papa" };
const SECRET_SLIP: Record<SuspectId, string> = {
  mama: "Mama's 'homemade' pie came from the forest bakery!",
  papa: "Papa's on a strict diet and he's been sneaking snacks all week!",
  baby: "Baby broke Mama's antique porridge bowl and hid it under his bed!",
};

const verdictSchema = z.object({
  verdict: z.enum(["too_hot", "too_cold", "just_right"]).describe("Your famous test: too_hot = you think it's a lie, too_cold = evasive, just_right = you believe it"),
  quip: z.string().describe("Your verdict out loud, Goldilocks-style, 8 words or fewer, e.g. 'Too hot! That answer is burning with lies.'"),
  reason: z.string().describe("Why, one sentence"),
});

const factcheckSchema = z.object({
  check: z.enum(["confirmed", "busted", "unclear"]).describe("confirmed if the search results support the claim, busted if they contradict it, unclear otherwise"),
  line: z.string().describe("What you announce, Sherlock-style, 14 words or fewer"),
  reason: z.string().describe("What in the search results decided it, one sentence"),
});

const accuseSchema = z.object({
  accused: z.enum(SUSPECTS),
  speech: z.string().describe("Your dramatic, Sherlock-style accusation, 18 words or fewer"),
  reason: z.string().describe("The evidence that convinced you, one sentence"),
  mood,
});

const reactSchema = z.object({
  mood,
  mutter: z.string().describe("What you mutter under your breath, 6 words or fewer"),
});

const responseSchema = z.object({
  confess: z.boolean().describe("true if you confess to eating or hiding the pie"),
  line: z.string().describe("What you say aloud, 14 words or fewer"),
  reason: z.string().describe("Why you respond this way, one sentence"),
  mood,
});

// ---------- run bookkeeping ----------

/** What the browser receives, one JSON line at a time, while a film is being made. */
export type StreamEvent =
  | { type: "start"; run: Omit<Run, "beats"> }
  | { type: "beat"; beat: Beat }
  | { type: "patch"; i: number; audio: string; sponsors: SponsorUse[] }
  | { type: "done"; status: Run["status"]; truth?: Truth; ending?: Ending; caseNumber: number; poster?: string }
  | { type: "error"; message: string };

function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- the film ----------

export async function generateRun(onEvent?: (e: StreamEvent) => void): Promise<Run> {
  const brain = new Brain();
  const [pastCases, weather, records] = await Promise.all([listCases(), liveWeather(), latestBruinInsights()]);
  const book = casebook(pastCases);
  const run: Run = {
    id: newRunId(),
    createdAt: new Date().toISOString(),
    status: "generating",
    mode: brain.live ? "live" : "offline",
    model: brain.live ? config.model : "offline",
    setupId: SETUP_ID,
    caseNumber: book.caseNumber,
    cast: CAST,
    beats: [],
    lastYear: pastCases[0]?.lastYear ?? {},
    weather: { forest: weather.forest, description: weather.description, sky: weather.sky, live: weather.live },
  };
  const { beats: _beats, ...header } = run;
  onEvent?.({ type: "start", run: header });
  // BAND: open this case's chat room in the background; whispers wait for it.
  const room = openCaseRoom(run.caseNumber);

  // Voices are generated in the background as lines are written, then patched in.
  const voices: Promise<void>[] = [];
  const voiced = (b: Beat) =>
    Boolean(b.line) &&
    ["say", "accuse", "respond", "react", "narrate", "reveal", "evidence", "verdict", "secret", "weather", "radio", "wildcard", "records", "factcheck"].includes(b.kind) &&
    b.scene !== "cast" &&
    !(b.kind === "reveal" && b.actor !== "narrator") &&
    !b.line!.startsWith("Same setup") &&
    !b.line!.startsWith("Morning.");
  const voice = (b: Beat) => {
    voices.push(
      voiceLine(b.actor === "narrator" ? "narrator" : byId(b.actor), b.line ?? "").then(({ value, use }) => {
        if (!value) return;
        b.audio = value;
        b.sponsors.push(use);
        onEvent?.({ type: "patch", i: b.i, audio: value, sponsors: b.sponsors });
      }),
    );
  };
  const beat = (b: Omit<Beat, "i" | "sponsors"> & { sponsors?: SponsorUse[] }) => {
    const full: Beat = { ...b, i: run.beats.length, sponsors: b.sponsors ?? [] };
    const speaks = voiced(full);
    if (!speaks && full.line && full.kind !== "move" && full.kind !== "title") full.silent = true;
    run.beats.push(full);
    onEvent?.({ type: "beat", beat: full });
    if (speaks) voice(full);
    return full;
  };
  // Where everyone is right now, so the film only shows moves that change something.
  const where = {} as Record<CharacterId, Place>;
  const move = (id: CharacterId, place: Place, scene: Beat["scene"]) => {
    if (where[id] === place) return;
    where[id] = place;
    beat({ scene, kind: "move", actor: id, place });
  };

  try {
    const memory = Object.fromEntries(CAST.map((c) => [c.id, [] as string[]])) as Record<CharacterId, string[]>;
    const spoken: string[] = [];
    for (const s of SUSPECTS) memory[s].push(`You happen to know ${nameOf(KNOWS[s])}'s secret: ${SECRET_SLIP[KNOWS[s]]}`);

    // ---- Opening: skills (Finch), memories, the casebook ----
    beat({ scene: "cast", kind: "title", actor: "narrator", line: "Who Ate the Pie?" });
    const skills = {} as Record<CharacterId, string>;
    for (const c of CAST) {
      const { value, use } = await equipSkill(c);
      skills[c.id] = value;
      beat({ scene: "cast", kind: "narrate", actor: c.id, line: `${c.name} equips ${c.skill}.`, sponsors: [use] });
    }
    for (const c of CAST) {
      if (run.lastYear[c.id]) beat({ scene: "cast", kind: "memory", actor: c.id, line: `Remembers last Thanksgiving: ${run.lastYear[c.id]}` });
    }
    beat({ scene: "cast", kind: "memory", actor: "goldilocks", line: `Opens her casebook. ${book.onScreen}` });
    if (records) {
      const liar = [...records.lies].sort((a, b) => b.lie_rate_pct - a.lie_rate_pct)[0];
      const most = [...records.accusations].sort((a, b) => b.times_accused - a.times_accused)[0];
      beat({
        scene: "cast",
        kind: "records",
        actor: "narrator",
        line: `Forest Police records: ${liar ? `${nameOf(liar.suspect as SuspectId)} lies ${Math.round(liar.lie_rate_pct)}% of the time.` : ""} ${most ? `${nameOf(most.suspect as SuspectId)} is the usual suspect.` : ""}`.trim(),
        reason: "Every bear knows the records, and so does Goldilocks.",
        sponsors: [{ sponsor: "Bruin", what: `records from ${records.endings.reduce((n, e) => n + e.films, 0)} films`, live: true }],
      });
    }

    const system = (id: CharacterId) => {
      const c = byId(id);
      return [
        `You are ${c.name}, a character in a short animated Thanksgiving whodunit, "Who Ate the Pie?", a twist on Goldilocks and the Three Bears. Stay fully in character.`,
        `Personality: ${c.personality}`,
        `Secret (never reveal it unless you decide to): ${c.secret}`,
        `Goal: ${c.goal}`,
        `Skill, ${c.skill}: ${skills[id]}`,
        run.lastYear[id] ? `Memory from last Thanksgiving: ${run.lastYear[id]}` : "",
        id === "goldilocks" ? book.prompt : "",
        weatherRules(weather),
        recordsBrief(records, id),
        "Nothing is scripted: you decide what you do. Lying is allowed when it serves your goal, but always fill in is_lie honestly. This is a 90-second film, so every spoken line must be short, punchy, funny and family-friendly.",
      ]
        .filter(Boolean)
        .join("\n");
    };
    const context = (id: CharacterId) =>
      [
        `What you privately know:\n${memory[id].map((m) => `- ${m}`).join("\n") || "- nothing yet"}`,
        `What has been said out loud so far:\n${spoken.slice(-14).join("\n") || "(nothing yet)"}`,
      ].join("\n\n");

    // ---- Scene 1: Midnight in the kitchen ----
    beat({ scene: "midnight", kind: "title", actor: "narrator", line: "Midnight in the Kitchen" });
    for (const s of SUSPECTS) move(s, "bedroom", "midnight");
    move("goldilocks", "outside", "midnight");
    beat({ scene: "midnight", kind: "narrate", actor: "narrator", line: "Thanksgiving Eve. Mama's pumpkin pie cools in the kitchen. The bears go up to bed.", pieSlices: TOTAL_SLICES });
    beat({
      scene: "midnight",
      kind: "weather",
      actor: "narrator",
      line: `Live tonight in ${weather.forest}: ${weather.description}.`,
      reason: weatherRules(weather),
    });

    // Each bear decides, alone in bed, whether and when to sneak down.
    const plans = await Promise.all(
      SUSPECTS.map(async (id) => {
        const { value, use } = await brain.decide(
          `${nameOf(id)}: plan`,
          planSchema,
          system(id),
          `It's Thanksgiving Eve. You're lying in your bed upstairs in the cabin. ${OPENING}\n\n${context(id)}\n\nDo you sneak down to the kitchen tonight? If so, when?`,
          () => offlinePlan(id),
        );
        return { id, ...value, use };
      }),
    );
    for (const p of plans) {
      beat({ scene: "midnight", kind: "plan", actor: p.id, line: p.thought, reason: p.when === "stay_in_bed" ? "Stays in bed." : `Plans to sneak down at ${p.when}.`, sealed: true, sponsors: [p.use] });
    }

    const truth: Truth = { visits: [], eaten: { papa: 0, mama: 0, baby: 0 }, hiddenBy: null, framed: [], culprits: [], slicesLeft: TOTAL_SLICES, clues: [], secretsOut: [] };
    const order = plans
      .filter((p) => p.when !== "stay_in_bed")
      .sort((a, b) => SNEAK_TIMES.indexOf(a.when) - SNEAK_TIMES.indexOf(b.when) || SUSPECTS.indexOf(a.id) - SUSPECTS.indexOf(b.id));
    for (const p of plans.filter((p) => p.when === "stay_in_bed")) {
      truth.visits.push({ id: p.id, time: "stay_in_bed", choice: "stayed_in_bed", frame: null, cleanedUp: false });
      memory[p.id].push("Last night you stayed in bed and never went downstairs.");
    }

    let lingering: SuspectId | null = null;
    for (const p of order) {
      const id = p.id;
      const dark = weather.effects.fog || (weather.effects.powerCut && (p.when === "2am" || p.when === "3am"));
      if (lingering && !dark) memory[id].push(`When you crept downstairs at ${p.when}, you saw ${nameOf(lingering)} tiptoeing out of the kitchen.`);
      const onCounter = truth.hiddenBy === null && truth.slicesLeft > 0;
      const situation = onCounter
        ? `It's ${p.when}. You've crept into the kitchen. The pie is on the counter with ${truth.slicesLeft} of ${TOTAL_SLICES} slices left. Nobody is watching.`
        : `It's ${p.when}. You've crept into the kitchen, but the pie is not on the counter anymore. Someone got here first.`;
      const { value: d, use } = await brain.decide(
        `${nameOf(id)}: midnight`,
        midnightSchema(id),
        system(id),
        `${situation}\n\n${context(id)}\n\nDecide what you do in the kitchen right now.`,
        () => offlineMidnight(id, others(id), onCounter),
      );

      move(id, "kitchen", "midnight");
      let did = "left the pie alone";
      if (onCounter && (d.choice === "eat_one_slice" || d.choice === "eat_two_slices")) {
        const n = Math.min(d.choice === "eat_two_slices" ? 2 : 1, truth.slicesLeft);
        truth.eaten[id] += n;
        truth.slicesLeft -= n;
        did = `ate ${n} slice${n > 1 ? "s" : ""} of the pie`;
      } else if (onCounter && d.choice === "hide_the_pie") {
        truth.hiddenBy = id;
        did = `hid the rest of the pie (${truth.slicesLeft} slices) under Baby Bear's bed`;
      }
      const frame = d.frame !== "nobody" ? (d.frame as SuspectId) : null;
      if (frame) {
        truth.framed.push({ by: id, target: frame });
        did += ` and smeared crumbs on ${nameOf(frame)}'s chair`;
      }
      did += d.clean_up ? ", then carefully cleaned up every crumb" : ", then hurried back to bed without cleaning up";
      truth.visits.push({ id, time: p.when, choice: onCounter ? d.choice : "leave_it_alone", frame, cleanedUp: d.clean_up });
      memory[id].push(`At ${p.when} you ${did}.`);
      beat({
        scene: "midnight",
        kind: "sneak",
        actor: id,
        place: "kitchen",
        line: d.thought,
        reason: `${did}. ${d.reason}`,
        mood: d.mood,
        sealed: true,
        pieSlices: truth.hiddenBy ? 0 : truth.slicesLeft,
        sponsors: [use],
      });
      move(id, "bedroom", "midnight");
      lingering = d.clean_up || weather.effects.moonlight ? id : null;
    }
    if (order.length === 0) beat({ scene: "midnight", kind: "narrate", actor: "narrator", line: "Not a single bear stirs all night. And yet…" });

    // ---- Scene 2: The morning after ----
    truth.culprits = SUSPECTS.filter((s) => truth.eaten[s] > 0 || truth.hiddenBy === s);
    beat({ scene: "morning", kind: "title", actor: "narrator", line: "The Morning After" });
    {
      const { value: r, use: telem } = await webSearch("funny animal news this week");
      const pickTitle = r.sources.map((x) => x.title.replace(/^watch:?\s+/i, "")).find((t) => t.split(" ").length >= 5 && !/^(top|best)\s+\d/i.test(t) && !/\b(funniest|compilation|week)\b/i.test(t));
      const headline = (telem.live && pickTitle ? pickTitle : "Local moose wins pie-eating contest, refuses to share his recipe").replace(/\s+[|\-–—]\s+[^|\-–—]+$/, "").slice(0, 110);
      beat({ scene: "morning", kind: "radio", actor: "narrator", line: `On the radio: "${headline}."`, sources: r.sources.slice(0, 1), sponsors: [{ ...telem, what: "today's headline" }] });
      for (const c of CAST) memory[c.id].push(`This morning the cabin radio said: "${headline}". You may use it as an alibi, an excuse or a distraction.`);
      spoken.push(`Radio: ${headline}`);
    }
    for (const s of SUSPECTS) move(s, "kitchen", "morning");
    move("goldilocks", "kitchen", "morning");

    // Every clue below follows from a choice a bear made at midnight.
    // Layered clues. Each records who it really points to and whether it's honest,
    // so the viewer's debrief can explain true leads and red herrings.
    const FUR: Record<SuspectId, string> = { papa: "dark amber", mama: "honey-gold", baby: "pale peach" };
    const clues: Clue[] = [];
    if (truth.culprits.length === 0) clues.push({ line: "The pie is GONE. Only an empty tin, licked suspiciously clean.", focus: { kind: "pie" }, pointsTo: null, honest: true, why: "Nobody in the family touched it." });
    else if (truth.hiddenBy) clues.push({ line: "The whole pie has vanished. Just a ring where the tin sat.", focus: { kind: "pie" }, pointsTo: null, honest: true, why: "Someone hid it rather than ate it." });
    else clues.push({ line: `Only ${truth.slicesLeft} of ${TOTAL_SLICES} slices remain.`, focus: { kind: "pie" }, pointsTo: null, honest: true, why: "How much was taken, not who took it." });
    const sloppy = truth.visits.filter((v) => v.choice !== "stayed_in_bed" && v.choice !== "leave_it_alone" && !v.cleanedUp);
    sloppy.forEach((v, k) => {
      if (k % 2 === 0) clues.push({ line: `A tuft of ${FUR[v.id]} fur is stuck to the pie tin.`, focus: { kind: "pie" }, pointsTo: v.id, honest: true, why: `${FUR[v.id][0].toUpperCase()}${FUR[v.id].slice(1)} is ${nameOf(v.id)}'s fur color.` });
      else clues.push({ line: `A trail of crumbs leads from the kitchen… to ${nameOf(v.id)}'s chair.`, focus: { kind: "trail", who: v.id }, pointsTo: v.id, honest: true, why: `${nameOf(v.id)} ate without cleaning up.` });
    });
    const greedy = truth.visits.find((v) => v.choice === "eat_two_slices");
    if (greedy) clues.push({ line: "Two slices were taken in one go. A big appetite… or a small bear with big ideas?", focus: { kind: "pie" }, pointsTo: greedy.id, honest: true, why: `${nameOf(greedy.id)} took two slices at once.` });
    const clockVisit = truth.visits.find((v) => v.choice !== "stayed_in_bed" && !v.cleanedUp);
    if (clockVisit) clues.push({ line: `The kitchen clock was knocked crooked. It stopped at ${clockVisit.time === "midnight" ? "12:00" : clockVisit.time.replace("am", ":00")}.`, focus: { kind: "pie" }, pointsTo: clockVisit.id, honest: true, why: `${nameOf(clockVisit.id)} was in the kitchen at ${clockVisit.time}; check who has no alibi then.` });
    if (weather.effects.mud) {
      const muddy = truth.visits.find((v) => v.choice !== "stayed_in_bed" && !v.cleanedUp);
      if (muddy) clues.push({ line: `Muddy paw prints by the counter. ${({ papa: "Big", mama: "Medium", baby: "Small" } as const)[muddy.id]}-sized.`, focus: { kind: "pie" }, pointsTo: muddy.id, honest: true, why: `Rain made ${nameOf(muddy.id)}'s paws muddy.` });
    }
    for (const f of truth.framed) clues.push({ line: `Crumbs smeared all over ${nameOf(f.target)}'s chair.`, focus: { kind: "chair", who: f.target }, pointsTo: f.target, honest: false, why: `Planted by ${nameOf(f.by)} to frame ${nameOf(f.target)}.` });
    if (clues.length === 1) clues.push({ line: "Not a single other crumb anywhere. A professional job.", focus: { kind: "pie" }, pointsTo: null, honest: true, why: "Whoever did it cleaned up." });
    // Keep the pie clue, then up to two more, always including a red herring when there is one.
    const herring = clues.find((c) => !c.honest);
    const leads = clues.slice(1).filter((c) => c.honest);
    const chosen = [clues[0], ...leads.slice(0, herring ? 1 : 2), ...(herring ? [herring] : [])].slice(0, 3);
    truth.clues = chosen.map((c, k) => ({ exhibit: "ABC"[k], line: c.line, pointsTo: c.pointsTo, honest: c.honest, why: c.why }));
    const evidence = chosen.map((c) => c.line);
    chosen.forEach((c, k) => {
      beat({ scene: "morning", kind: "evidence", actor: "narrator", line: c.line, focus: c.focus, exhibit: "ABC"[k], pieSlices: truth.hiddenBy || truth.culprits.length === 0 ? 0 : truth.slicesLeft });
    });
    spoken.push(`Narrator: ${evidence.join(" ")}`);
    for (const c of CAST) memory[c.id].push(`This morning everyone saw: ${evidence.join(" ")}`);

    // ---- Scene 3: The interrogation ----
    beat({ scene: "interrogation", kind: "title", actor: "narrator", line: "The Interrogation" });
    for (const c of CAST) move(c.id, "parlour", "interrogation");
    let suspicion: Record<SuspectId, number> = { papa: 33, mama: 33, baby: 33 };
    const wildcardRound = Math.min(2, config.rounds);
    for (let round = 1; round <= config.rounds; round++) {
      if (round === wildcardRound) {
        const twist = WILDCARDS[Math.floor(Math.random() * WILDCARDS.length)];
        beat({ scene: "interrogation", kind: "wildcard", actor: "narrator", line: twist });
        for (const c of CAST) memory[c.id].push(`Surprise just now: ${twist}`);
        spoken.push(`(Twist: ${twist})`);
      }
      const { value: q, use } = await brain.decide(
        `Goldilocks: round ${round}`,
        detectiveSchema,
        system("goldilocks"),
        `Round ${round} of ${config.rounds}. Where everyone is: ${SUSPECTS.map((s) => `${nameOf(s)} in the ${where[s]}`).join(", ")}.\n\n${context("goldilocks")}\n\nYour current suspicion: ${JSON.stringify(suspicion)}\n\nPick which bear to question next and what to ask. You may research first.`,
        () => offlineDetective(suspicion),
      );
      suspicion = q.suspicion;
      const target = q.target as SuspectId;

      if (q.research !== "none" && q.research_query.trim()) {
        if (q.research === "web") {
          const { value: r, use: telem } = await webSearch(q.research_query);
          memory.goldilocks.push(`You searched the web for "${q.research_query}": ${r.summary}`);
          beat({ scene: "interrogation", kind: "research", actor: "goldilocks", line: r.summary, reason: `Searched: ${q.research_query}`, sources: r.sources, sponsors: [telem] });
        } else {
          const { value: f, use: glasser } = await lookupFact(q.research_query);
          memory.goldilocks.push(`You looked up "${q.research_query}": ${f.fact}`);
          beat({ scene: "interrogation", kind: "research", actor: "goldilocks", line: f.fact, reason: `Looked up: ${q.research_query}`, sources: [{ title: f.provider }], sponsors: [{ ...glasser, costUsd: f.costUsd }] });
        }
      }

      move("goldilocks", where[target], "interrogation");
      beat({ scene: "interrogation", kind: "say", actor: "goldilocks", target, line: q.question, reason: q.reason, mood: q.mood, suspicion, sponsors: [use] });
      spoken.push(`Detective Goldilocks (to ${nameOf(target)}): ${q.question}`);

      const guilty = truth.culprits.includes(target);
      const { value: a, use: aUse } = await brain.decide(
        `${nameOf(target)}: answer`,
        answerSchema(target),
        system(target),
        `You're in the ${where[target]}. Detective Goldilocks just asked you, in front of everyone: "${q.question}"\n\n${context(target)}\n\nAnswer her. You can back your story with a real-world fact (the radio news, tonight's weather, a real event), but she may check it on the live web. Then decide whether to walk off somewhere and whether to privately message another bear.`,
        () => offlineAnswer(target, others(target), guilty),
      );
      beat({ scene: "interrogation", kind: "say", actor: target, target: "goldilocks", line: a.answer, reason: a.reason, isLie: a.is_lie, mood: a.mood, sponsors: [aUse] });
      spoken.push(`${nameOf(target)}: ${a.answer}`);
      memory[target].push(`You told Goldilocks: "${a.answer}"${a.is_lie ? " (a lie)" : ""}.`);

      if (a.blurt_secret !== "nobody") {
        const exposed = a.blurt_secret as SuspectId;
        (truth.secretsOut ??= []).push(exposed);
        const line = `${nameOf(target)} blurts it out: ${SECRET_SLIP[exposed]}`;
        beat({ scene: "interrogation", kind: "secret", actor: target, target: exposed, line, reason: "Deflecting suspicion onto someone else." });
        spoken.push(`${nameOf(target)} (blurting): ${SECRET_SLIP[exposed]}`);
        for (const c of CAST) memory[c.id].push(`Everyone just learned: ${SECRET_SLIP[exposed]}`);
      }

      // Live fact-check (Telem) of a real-world claim in the alibi, once per film.
      if (a.alibi_fact.trim() && !run.beats.some((b) => b.kind === "factcheck")) {
        const claim = a.alibi_fact.trim();
        const { value: found, use: telem } = await webSearch(claim);
        const { value: fc, use: fcUse } = await brain.decide(
          "Goldilocks: fact-check",
          factcheckSchema,
          system("goldilocks"),
          `${nameOf(target)} backed their story with this claim: "${claim}". You searched the live web. Results:\n${found.summary}\nSources: ${found.sources.map((s) => s.title).join("; ")}\n\nDoes the evidence confirm or bust the claim?`,
          () => ({ check: "unclear" as const, line: "The web is silent on that. Suspicious.", reason: "No clear results." }),
        );
        beat({ scene: "interrogation", kind: "factcheck", actor: "goldilocks", target, line: fc.line, reason: fc.reason, claim, check: fc.check, sources: found.sources.slice(0, 2), sponsors: [{ ...telem, what: `fact-check: ${claim.slice(0, 40)}` }, fcUse] });
        memory.goldilocks.push(`You fact-checked ${nameOf(target)}'s claim "${claim}": ${fc.check}.`);
        for (const c of CAST) if (c.id !== "goldilocks") memory[c.id].push(`Goldilocks fact-checked ${nameOf(target)}'s claim "${claim}" on the web: ${fc.check.toUpperCase()}.`);
        spoken.push(`Detective Goldilocks (fact-check): ${fc.line}`);
      }

      // Goldilocks's "just right" test on the answer.
      const { value: v, use: vUse } = await brain.decide(
        "Goldilocks: just-right test",
        verdictSchema,
        system("goldilocks"),
        `${nameOf(target)} just answered you: "${a.answer}"\n\n${context("goldilocks")}\n\nApply your famous test: is that answer too hot (a lie), too cold (evasive) or just right (true)?`,
        () => ({ verdict: a.is_lie ? ("too_hot" as const) : ("just_right" as const), quip: a.is_lie ? "Too hot! That answer is burning with lies." : "Hmm. Just right.", reason: "Gut feeling." }),
      );
      beat({ scene: "interrogation", kind: "verdict", actor: "goldilocks", target, line: v.quip, reason: v.reason, verdict: v.verdict, sponsors: [vUse] });
      spoken.push(`Detective Goldilocks: ${v.quip}`);

      if (a.whisper_to !== "nobody" && a.whisper.trim()) {
        const to = a.whisper_to as SuspectId;
        move(target, where[to], "interrogation");
        const { value: roomId, use: roomUse } = await room;
        const { use: band } = await whisper(roomId, target, to, a.whisper);
        if (roomUse.live && !run.beats.some((b) => b.sponsors.some((u) => u.what.startsWith("case room")))) band.what += ` · ${roomUse.what}`;
        memory[to].push(`${nameOf(target)} privately whispered to you: "${a.whisper}"`);
        beat({ scene: "interrogation", kind: "whisper", actor: target, target: to, line: a.whisper, sponsors: [band] });
      } else if (a.move_to !== "stay") {
        move(target, a.move_to as Place, "interrogation");
        spoken.push(`(${nameOf(target)} walks off to the ${a.move_to}.)`);
      }
    }

    // ---- Scene 4: The accusation ----
    beat({ scene: "accusation", kind: "title", actor: "narrator", line: "The Accusation" });
    for (const c of CAST) move(c.id, "parlour", "accusation");
    const { value: acc, use: accUse } = await brain.decide(
      "Goldilocks: accusation",
      accuseSchema,
      system("goldilocks"),
      `The forest guests arrive in five minutes. Everyone is gathered by the parlour fireplace. Time to name the pie thief.\n\n${context("goldilocks")}\n\nYour suspicion: ${JSON.stringify(suspicion)}`,
      () => offlineAccuse(suspicion),
    );
    const accused = acc.accused as SuspectId;
    beat({ scene: "accusation", kind: "accuse", actor: "goldilocks", target: accused, line: acc.speech, reason: acc.reason, mood: acc.mood, suspicion, sponsors: [accUse] });
    spoken.push(`Detective Goldilocks: ${acc.speech}`);

    // The other bears react, each in their own way.
    const reactions = await Promise.all(
      others(accused).slice(0, 1).map(async (id) => {
        const { value, use } = await brain.decide(
          `${nameOf(id)}: reaction`,
          reactSchema,
          system(id),
          `Goldilocks just accused ${nameOf(accused)}: "${acc.speech}"\n\n${context(id)}\n\nHow do you react?`,
          () => offlineReact(),
        );
        return { id, ...value, use };
      }),
    );
    for (const r of reactions) beat({ scene: "accusation", kind: "react", actor: r.id, target: accused, line: r.mutter, mood: r.mood, sponsors: [r.use] });

    const accusedGuilty = truth.culprits.includes(accused);
    const { value: resp, use: respUse } = await brain.decide(
      `${nameOf(accused)}: response`,
      responseSchema,
      system(accused),
      `Detective Goldilocks has just accused you, in front of the whole family: "${acc.speech}"\n\n${context(accused)}\n\nRespond. Do you confess?`,
      () => offlineResponse(accusedGuilty),
    );
    beat({ scene: "accusation", kind: "respond", actor: accused, target: "goldilocks", line: resp.line, reason: resp.reason, mood: resp.mood, isLie: accusedGuilty ? !resp.confess : resp.confess, sponsors: [respUse] });

    // ---- Scene 5: The reveal ----
    const ending = decideEnding(truth, accused, resp.confess);
    const posterJob = renderImage(posterPrompt(ending, truth, accused));
    run.truth = truth;
    run.ending = ending;
    beat({ scene: "reveal", kind: "title", actor: "narrator", line: "What Really Happened" });
    for (const v of [...truth.visits].sort((x, y) => SNEAK_TIMES.indexOf(x.time) - SNEAK_TIMES.indexOf(y.time))) {
      const parts: string[] = [];
      if (v.choice === "stayed_in_bed") parts.push("stayed in bed all night");
      else parts.push(`crept down at ${v.time}`);
      if (truth.eaten[v.id]) parts.push(`ate ${truth.eaten[v.id]} slice${truth.eaten[v.id] > 1 ? "s" : ""}`);
      if (truth.hiddenBy === v.id) parts.push("hid the pie under Baby Bear's bed");
      if (v.frame) parts.push(`framed ${nameOf(v.frame)}`);
      if (v.choice !== "stayed_in_bed" && v.choice === "leave_it_alone" && !v.frame) parts.push("touched nothing");
      beat({ scene: "reveal", kind: "flashback", actor: v.id, place: v.choice === "stayed_in_bed" ? "bedroom" : "kitchen", line: `${nameOf(v.id)} ${parts.join(", ")}.` });
    }
    beat({ scene: "reveal", kind: "title", actor: "narrator", line: ending.title });
    beat({ scene: "reveal", kind: "reveal", actor: "narrator", line: ending.summary });

    // ---- Wrap up: decision log (Bruin), voices, then save the case ----
    run.status = "done";
    const { use: bruinUse } = await recordRun(run);
    beat({ scene: "reveal", kind: "narrate", actor: "narrator", line: `Same setup, ${SETUP_ID}, every time. Every choice after it was made by the characters.`, sponsors: [bruinUse] });
    await Promise.allSettled(voices);
    const poster = await posterJob;
    if (poster.value) run.poster = await keepPoster(run.id, poster.value);
    const runUrl = await saveRun(run);
    await saveCase({
      id: run.id,
      caseNumber: run.caseNumber,
      createdAt: run.createdAt,
      mode: run.mode,
      ending,
      truth,
      lies: Object.fromEntries(SUSPECTS.map((s) => [s, run.beats.filter((b) => b.actor === s && b.isLie).length])) as Record<SuspectId, number>,
      lastYear: nextYearMemory(truth, accused, resp.confess),
      runUrl,
    });
    onEvent?.({ type: "done", status: "done", truth, ending, caseNumber: run.caseNumber, poster: run.poster });
    console.log(`[run ${run.id}] Case #${run.caseNumber}: ${ending.title}. ${brain.calls} Claude calls, ${brain.failures} fell back offline`);
  } catch (error) {
    run.status = "error";
    run.error = (error as Error).message;
    onEvent?.({ type: "error", message: run.error });
    throw error;
  }
  return run;
}

function decideEnding(truth: Truth, accused: SuspectId, confessed: boolean): Ending {
  const a = nameOf(accused);
  if (truth.culprits.length === 0) {
    return {
      id: "detective_did_it",
      title: "Old Habits",
      summary: `No bear touched the pie. At 3 AM a certain golden-haired detective sleepwalked into the kitchen, found a pie that was just right, and ate it. ${a} was innocent all along.`,
      accused,
    };
  }
  const real = truth.culprits.map(nameOf).join(" and ");
  if (truth.culprits.includes(accused)) {
    return confessed
      ? { id: "case_closed", title: "Case Closed", summary: `${a} cracked under pressure and confessed. Elementary.`, accused }
      : { id: "caught_denying", title: "Caught, Still Denying", summary: `Goldilocks was right about ${a}, who is still denying everything.`, accused };
  }
  const framer = truth.framed.find((f) => f.target === accused);
  if (framer) {
    return { id: "framed", title: "Framed!", summary: `${nameOf(framer.by)} smeared crumbs on ${a}'s chair, and Goldilocks fell for it. The real pie thief: ${real}.`, accused };
  }
  return { id: "wrong_suspect", title: "Wrong Bear", summary: `${a} was innocent. The real pie thief: ${real}.`, accused };
}

function nextYearMemory(truth: Truth, accused: SuspectId, confessed: boolean): Run["lastYear"] {
  const memory: Run["lastYear"] = {};
  const right = truth.culprits.includes(accused);
  memory.goldilocks = right
    ? `You correctly caught ${nameOf(accused)}${confessed ? ", who confessed" : ""}.`
    : `You wrongly accused ${nameOf(accused)}. The real culprit was ${truth.culprits.map(nameOf).join(" and ") || "you, sleepwalking"}. Embarrassing.`;
  for (const v of truth.visits) {
    const s = v.id;
    if (s === accused && !right) memory[s] = "You were wrongly accused of eating the pie, and you still hold a grudge against Goldilocks.";
    else if (s === accused) memory[s] = "You got caught eating the pie, and the family still teases you about it.";
    else if (truth.culprits.includes(s)) memory[s] = "You ate the pie and got away with it. Nobody knows.";
    else memory[s] = "You watched the pie drama from the sidelines.";
  }
  return memory;
}

export type { Visit };

/** What the Bruin records tell each character going into this case. */
function recordsBrief(records: BruinInsights | null, id: CharacterId) {
  if (!records) return "";
  const films = records.endings.reduce((n, e) => n + e.films, 0);
  const lies = records.lies.map((l) => `${nameOf(l.suspect as SuspectId)} lies ${Math.round(l.lie_rate_pct)}% of the time`).join(", ");
  const acc = records.accusations.map((a) => `${nameOf(a.suspect as SuspectId)} accused ${a.times_accused}× (guilty ${a.times_right}×)`).join(", ");
  if (id === "goldilocks") return `Forest Police records from ${films} past films (Bruin): ${lies}. ${acc}. Use them, but remember records aren't proof.`;
  const me = records.lies.find((l) => l.suspect === id);
  return `Everyone has seen the Forest Police records (Bruin): ${lies}. ${me ? `Your own record: you lie ${Math.round(me.lie_rate_pct)}% of the time, and Goldilocks knows it.` : ""}`;
}

const LOOKS: Record<CharacterId, string> = {
  goldilocks: "a tiny girl detective with a huge cloud of golden curls, a houndstooth deerstalker hat and a tweed cape, holding a magnifying glass",
  papa: "a huge burly brown bear in a red plaid flannel shirt and suspenders",
  mama: "a tall honey-gold bear with a long neck, a pink cardigan, pearls and a pumpkin apron",
  baby: "a tiny peach-colored bear cub with a giant head, a striped shirt and red overalls",
};

/** A poster for this exact ending. */
function posterPrompt(ending: Ending, truth: Truth, accused: SuspectId) {
  const culprit = truth.culprits[0];
  const scene =
    ending.id === "detective_did_it"
      ? `${LOOKS.goldilocks} caught red-handed with pumpkin pie crumbs on her face while ${LOOKS.papa}, ${LOOKS.mama} and ${LOOKS.baby} stare at her in shock`
      : ending.id === "case_closed" || ending.id === "caught_denying"
        ? `${LOOKS.goldilocks} pointing her magnifying glass at ${LOOKS[accused]}, who is caught holding a slice of pumpkin pie${ending.id === "caught_denying" ? " and protesting innocently" : " and looking guilty"}`
        : `${LOOKS.goldilocks} accusing ${LOOKS[accused]}, who looks shocked and innocent, while behind them ${culprit ? LOOKS[culprit] : "a shadowy figure"} sneaks away with the pumpkin pie`;
  return `Storybook movie poster illustration, portrait composition: ${scene}. Inside a cozy log cabin by the fireplace, dramatic warm spotlight, soft watercolor and gouache style, whimsical, family-friendly, no text.`;
}

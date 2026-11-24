// Plays a film as the agents make it: a camera moves around the Bears' cabin, characters
// walk, talk (Runware voices) and lie, and every decision lands in the log.
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUSPECTS = ["papa", "mama", "baby"];
const SPONSOR_ORDER = ["Claude", "Bruin", "BAND", "Runware", "Telem"];
const SCENES = { cast: "Opening", midnight: "Scene 1", morning: "Scene 2", interrogation: "Scene 3", accusation: "Scene 4", reveal: "Finale" };
const SPOKEN = ["say", "accuse", "respond", "react", "narrate", "reveal"];

// Rooms in the cabin set image (percent of the frame). floor = where feet go.
const ROOMS = {
  kitchen: { x: 11, y: 12, w: 38, h: 33, floor: 44 },
  dining: { x: 51, y: 12, w: 37, h: 33, floor: 44 },
  parlour: { x: 11, y: 49, w: 38, h: 41, floor: 89 },
  bedroom: { x: 51, y: 49, w: 37, h: 41, floor: 89 },
  outside: { x: 0, y: 55, w: 10, h: 35, floor: 92 },
};
const PIE_AT = { x: 19, y: 38 };
// Sprite heights, as % of the frame height (storybook sizes).
const HEIGHT = { papa: 27, mama: 26, goldilocks: 19, baby: 15 };
// Reading time: every line stays up long enough to read comfortably.
const READ = (s) => Math.max(4000, words(s) * 380);
const GAP = 450;
// Where each character stands inside a room, as a fraction of its width.
const SPOT = { papa: 0.16, goldilocks: 0.42, mama: 0.64, baby: 0.86 };
const WIDE = { s: 1, X: 0, Y: 0 };

const state = { run: null, cast: {}, pos: {}, shot: WIDE, token: 0, playing: false, generating: false, voices: [] };

// ---------- setup ----------
async function init() {
  const cfg = await (await fetch("/api/config")).json();
  const mode = $("#mode");
  mode.textContent = cfg.mode === "live" ? `Live agents · ${cfg.model}` : "Offline mode";
  mode.className = `pill ${cfg.mode}`;
  $("#sponsors").innerHTML = SPONSOR_ORDER.map((s) => `<span class="sponsor ${cfg.keys[s] ? "on" : "off"}">${s}</span>`).join("");
  loadVoices();
  window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
  $("#play").addEventListener("click", togglePlay);
  $("#new").addEventListener("click", newRun);
  $("#record").addEventListener("click", recordFilm);
  $("#runs").addEventListener("change", () => play($("#runs").value));
  drawPie(8);
  const runs = await refreshRuns(new URLSearchParams(location.search).get("case"));
  if (runs.length) await prepare(await fetchRun($("#runs").value));
  else {
    $("#log").innerHTML = `<li class="empty">No films yet. Click <b>Open a new case</b> and the agents will make one live.</li>`;
    caption("Click Open a new case. Four AI agents decide everything that happens.");
  }
}

function loadVoices() {
  state.voices = (window.speechSynthesis?.getVoices() ?? []).filter((v) => v.lang?.startsWith("en"));
}

async function refreshRuns(selectId) {
  const runs = await (await fetch("/api/runs")).json();
  $("#runs").innerHTML = runs
    .map((r) => {
      const when = new Date(r.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `<option value="${r.id}">Case #${r.caseNumber} · ${r.ending} · ${when}</option>`;
    })
    .join("");
  if (selectId && runs.some((r) => r.id === selectId)) $("#runs").value = selectId;
  return runs;
}

const fetchRun = async (id) => (await fetch(`/api/runs?id=${encodeURIComponent(id)}`)).json();

// ---------- camera + stage ----------
function shotFor(room) {
  const r = ROOMS[room];
  if (!r) return WIDE;
  const s = Math.min(100 / r.w, 100 / r.h) * 0.94;
  const clamp = (v) => Math.min(0, Math.max(100 - 100 * s, v));
  return { s, X: clamp(50 - s * (r.x + r.w / 2)), Y: clamp(50 - s * (r.y + r.h / 2)) };
}

function setCamera(shot) {
  if (state.shot.s === shot.s && state.shot.X === shot.X && state.shot.Y === shot.Y) return false;
  state.shot = shot;
  $("#camera").style.transform = `translate(${shot.X}%, ${shot.Y}%) scale(${shot.s})`;
  return true;
}

// Tight shot on a clue: the pie, a bear's chair, or the whole crumb trail.
function closeUp(focus) {
  if (!focus) return shotFor("kitchen");
  if (focus.kind === "trail") {
    const s = 1.55;
    return { s, X: Math.min(0, Math.max(100 - 100 * s, 50 - s * 34)), Y: Math.min(0, Math.max(100 - 100 * s, 50 - s * 58)) };
  }
  const p = focus.kind === "pie" ? PIE_AT : { x: ROOMS.parlour.x + ROOMS.parlour.w * (SPOT[focus.who] ?? 0.5), y: ROOMS.parlour.floor - 8 };
  const s = 3.4;
  const clamp = (v) => Math.min(0, Math.max(100 - 100 * s, v));
  return { s, X: clamp(50 - s * p.x), Y: clamp(50 - s * p.y) };
}

// A wobbly line of crumbs from the pie, down the stairs, to a bear's chair.
function crumbTrail(who) {
  const end = { x: ROOMS.parlour.x + ROOMS.parlour.w * (SPOT[who] ?? 0.5), y: ROOMS.parlour.floor - 0.5 };
  const start = { x: PIE_AT.x + 4, y: ROOMS.kitchen.floor - 0.5 };
  const pts = [];
  const steps = 30;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const x = start.x + (end.x - start.x) * t + Math.sin(t * 11) * 1.2;
    const y = start.y + (end.y - start.y) * Math.min(1, Math.max(0, (t - 0.3) / 0.45));
    pts.push(`<circle class="crumb" cx="${x.toFixed(2)}" cy="${(y * 0.5625).toFixed(2)}" r="${(0.22 + (k % 3) * 0.07).toFixed(2)}" style="animation-delay:${k * 55}ms"/>`);
  }
  $("#crumbs").innerHTML = pts.join("");
}

function stamp(text, cls = "") {
  const el = $("#stamp");
  el.textContent = text;
  el.className = `stamp ${cls}`;
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add("slam");
}

// The case board: clues pinned as the film goes.
function pin({ tag, text, kind = "clue", color }) {
  const board = $("#board");
  board.querySelector(".empty")?.remove();
  const card = document.createElement("div");
  card.className = `card ${kind}`;
  if (color) card.style.setProperty("--c", color);
  card.style.setProperty("--tilt", `${(Math.random() * 4 - 2).toFixed(1)}deg`);
  card.innerHTML = `<span class="tag">${escapeHtml(tag)}</span>${escapeHtml(text)}`;
  board.append(card);
}

const toStage = (p) => ({ x: state.shot.X + state.shot.s * p.x, y: state.shot.Y + state.shot.s * p.y });

function drawPie(slices) {
  let out = `<circle r="46" fill="#3a2a1a" stroke="#ffb020" stroke-width="3"/>`;
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((k + 1) / 8) * Math.PI * 2 - Math.PI / 2;
    const p = (a) => `${(Math.cos(a) * 42).toFixed(2)} ${(Math.sin(a) * 42).toFixed(2)}`;
    const here = k < slices;
    out += `<path d="M0 0 L${p(a0)} A42 42 0 0 1 ${p(a1)} Z" fill="${here ? "#ff9a3c" : "transparent"}" stroke="${here ? "#ffd08a" : "#ffffff22"}" stroke-width="1.5" style="transition:fill .6s"/>`;
  }
  $("#pie").innerHTML = out;
}

function slot(id, place) {
  const r = ROOMS[place] ?? ROOMS.parlour;
  const idx = state.run.cast.findIndex((c) => c.id === id);
  void idx;
  if (place === "outside") return { x: 7, y: r.floor };
  return { x: r.x + r.w * (SPOT[id] ?? 0.5), y: r.floor };
}

function placeActor(id, place) {
  const el = document.getElementById(`actor-${id}`);
  const p = slot(id, place);
  const before = state.pos[id];
  state.pos[id] = { ...p, place };
  if (before && (before.x !== p.x || before.y !== p.y)) {
    // Walk: waddle while sliding, and lean the way we're going.
    el.classList.toggle("left", p.x < before.x);
    el.classList.add("walking");
    clearTimeout(el._walk);
    el._walk = setTimeout(() => el.classList.remove("walking"), 950);
  }
  el.style.left = `${p.x}%`;
  el.style.top = `${p.y}%`;
}

function face(id, targetId) {
  const el = document.getElementById(`actor-${id}`);
  const a = state.pos[id];
  const t = state.pos[targetId];
  if (el && a && t) el.classList.toggle("left", t.x < a.x);
}

function animate(id, cls, ms = 900) {
  const el = document.getElementById(`actor-${id}`);
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

function buildActors() {
  $("#actors").innerHTML = state.run.cast
    .map(
      (c) => `<div class="actor" id="actor-${c.id}" style="--c:${c.color}; --h:${HEIGHT[c.id] ?? 25}%">
        <div class="body"><img src="/assets/cutouts/${c.id}.png" alt="${c.name}" draggable="false"/></div>
        <span class="sweat" aria-hidden="true"><i></i><i></i><i></i></span><span class="name">${c.name}</span></div>`,
    )
    .join("");
  for (const c of state.run.cast) placeActor(c.id, c.role === "detective" ? "outside" : "bedroom");
  $("#meters").innerHTML = SUSPECTS.map((id) => {
    const c = state.cast[id];
    return `<div class="meter" style="--c:${c.color}"><span>${c.name.split(" ")[0]}</span><div class="track"><div class="fill" id="meter-${id}"></div></div></div>`;
  }).join("");
}

// Mood shows through body language: nervous bears sweat and tremble, smug ones lean back.
function setMood(id, mood) {
  const el = document.getElementById(`actor-${id}`);
  if (!el || !mood) return;
  el.dataset.mood = mood;
}

function setSuspicion(s) {
  if (!s) return;
  for (const id of SUSPECTS) {
    const el = document.getElementById(`meter-${id}`);
    if (el) el.style.width = `${Math.max(2, Math.min(100, s[id] ?? 0))}%`;
  }
}

function showBubble(actor, text, thought = false) {
  const b = $("#bubble");
  const c = state.cast[actor];
  const p = toStage(state.pos[actor]);
  b.className = `bubble fade-in${thought ? " thought" : ""}`;
  b.style.setProperty("--c", c.color);
  b.innerHTML = `<span class="who">${c.name}${thought ? " (thinking)" : ""}</span>${escapeHtml(text)}`;
  const head = toStage({ x: state.pos[actor].x, y: state.pos[actor].y - (HEIGHT[actor] ?? 25) }).y;
  b.style.left = `${Math.min(78, Math.max(22, p.x))}%`;
  b.style.top = `${Math.max(20, head - 1)}%`;
  b.hidden = false;
  document.getElementById(`actor-${actor}`)?.classList.add("speaking");
}

function clearTransient() {
  $("#bubble").hidden = true;
  $("#caption").hidden = true;
  $("#research").hidden = true;
  $("#wires").innerHTML = "";
  $("#stamp").hidden = true;
  $("#stage").classList.remove("clue-focus");
  document.querySelectorAll(".actor.speaking").forEach((a) => a.classList.remove("speaking"));
}

function caption(html, raw = false) {
  const el = $("#caption");
  el.innerHTML = raw ? html : escapeHtml(html);
  el.hidden = false;
  el.classList.remove("fade-in");
  void el.offsetWidth;
  el.classList.add("fade-in");
}

const escapeHtml = (s = "") => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const words = (s = "") => s.split(/\s+/).length;

// ---------- decision log ----------
function logEntry(beat) {
  const actor = beat.actor === "narrator" ? null : state.cast[beat.actor];
  const suspect = actor?.role === "suspect";
  const sealedLine = beat.sealed;
  const sealedWhy = beat.sealed || (suspect && beat.reason && beat.scene !== "reveal");
  const name = (id) => state.cast[id]?.name ?? "";
  const label =
    { sneak: "midnight move", plan: "in bed, plans", memory: "remembers", react: "reacts", say: beat.target ? `to ${name(beat.target)}` : "says", whisper: `whispers to ${name(beat.target)}`, research: "research", accuse: `accuses ${name(beat.target)}`, respond: "responds", reveal: "truth" }[beat.kind] ?? "";
  const li = document.createElement("li");
  li.className = `entry${sealedLine || sealedWhy ? " sealed" : ""}`;
  li.style.setProperty("--c", actor?.color ?? "#6b74c9");
  li.innerHTML = `
    <div class="head"><span><span class="actor-name">${actor ? actor.name : "Narrator"}</span> ${escapeHtml(label)} ${beat.mood ?? ""}</span><span>${SCENES[beat.scene] ?? ""}</span></div>
    ${beat.line ? `<div class="line ${sealedLine ? "sealable" : ""}">${escapeHtml(beat.line)}</div>` : ""}
    ${beat.reason ? `<div class="why ${sealedWhy ? "sealable" : ""}">${escapeHtml(beat.reason)}</div>` : ""}
    ${beat.isLie ? `<span class="flag hidden-flag" hidden>[LIE]</span>` : ""}
    ${sealedLine || sealedWhy ? `<span class="seal">[SEALED UNTIL THE REVEAL]</span>` : ""}
    <div class="chips">${(beat.sponsors ?? [])
      .filter((u) => u.sponsor !== "Finch")
      .map((u) => `<span class="chip ${u.live ? "live" : ""}">${u.sponsor} · ${escapeHtml(u.what)}${u.ms ? ` · ${(u.ms / 1000).toFixed(1)}s` : ""}${u.costUsd ? ` · $${u.costUsd.toFixed(3)}` : ""}</span>`)
      .join("")}</div>`;
  $("#log").prepend(li);
}

function unsealLog() {
  document.querySelectorAll(".entry.sealed").forEach((li) => li.classList.remove("sealed"));
  document.querySelectorAll(".hidden-flag").forEach((f) => (f.hidden = false));
}

// ---------- voice ----------
const speed = () => Number($("#speed").value) || 1;
const wait = (ms) => sleep(ms / speed());

async function speak(beat, fallbackMs, token) {
  if (beat.silent) return wait(READ(beat.line));
  // A voice clip may still be on its way from Runware: give it a moment.
  for (let t = 0; !beat.audio && state.run.status === "generating" && t < 3000 && token === state.token; t += 200) await sleep(200);
  if (beat.audio) {
    const audio = new Audio(beat.audio);
    audio.playbackRate = speed();
    state.audio = audio;
    await Promise.race([
      new Promise((r) => {
        audio.onended = r;
        audio.onerror = r;
        audio.play().catch(r);
      }),
      sleep(20000),
    ]);
    return;
  }
  if (beat.actor !== "narrator" && window.speechSynthesis) {
    const c = state.cast[beat.actor];
    const u = new SpeechSynthesisUtterance(beat.line);
    const idx = state.run.cast.findIndex((x) => x.id === beat.actor);
    if (state.voices.length) u.voice = state.voices[(idx * 3) % state.voices.length];
    u.pitch = Math.min(2, c.voice.pitch);
    u.rate = Math.min(2, c.voice.rate * speed());
    const done = new Promise((r) => {
      u.onend = r;
      u.onerror = r;
    });
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    await Promise.race([done, sleep(fallbackMs * 2.5)]);
    return;
  }
  await wait(fallbackMs);
}

// Voice the line, but never move on before it's been readable for a while, then breathe.
async function speakAtLeast(b, token) {
  const started = Date.now();
  await speak(b, READ(b.line), token);
  const left = READ(b.line) / speed() - (Date.now() - started);
  if (left > 0) await sleep(Math.min(left, 2500));
  await wait(GAP);
}

// ---------- playback ----------
async function prepare(run) {
  state.run = run;
  state.cast = Object.fromEntries(run.cast.map((c) => [c.id, c]));
  $("#log").innerHTML = "";
  $("#end").hidden = true;
  $("#title").hidden = true;
  $("#stage").classList.remove("is-night", "is-flashback");
  delete $("#stage").dataset.sky;
  $("#crumbs").innerHTML = "";
  state.guess = null;
  $("#debrief").hidden = true;
  $("#guess").hidden = true;
  $("#board").innerHTML = `<p class="empty">Clues get pinned here as Goldilocks finds them.</p>`;
  $("#hud-case").textContent = `Case #${run.caseNumber} · setup ${run.setupId}`;
  clearTransient();
  setCamera(WIDE);
  buildActors();
  drawPie(8);
  setSuspicion({ papa: 33, mama: 33, baby: 33 });
}

function togglePlay() {
  if (state.playing) stop();
  else if (state.run) play(state.run.id);
}

function stop() {
  state.token++;
  state.playing = false;
  window.speechSynthesis?.cancel();
  state.audio?.pause();
  $("#play").textContent = "Replay";
}

async function play(id, run) {
  stop();
  const token = ++state.token;
  state.playing = true;
  $("#play").textContent = "Stop";
  await prepare(run ?? (await fetchRun(id)));
  await playLoaded(token);
}

function shotForBeat(b) {
  if (b.kind === "title" || b.scene === "cast") return WIDE;
  if (b.scene === "midnight") return b.kind === "plan" ? shotFor("bedroom") : b.kind === "narrate" || b.kind === "sneak" ? shotFor("kitchen") : null;
  if (b.kind === "flashback") return shotFor(b.place === "bedroom" ? "bedroom" : "kitchen");
  if (b.scene === "reveal") return WIDE;
  if (b.kind === "evidence") return closeUp(b.focus);
  if (b.kind === "weather" || b.kind === "wildcard") return WIDE;
  if (b.scene === "morning") return shotFor("kitchen");
  return shotFor("parlour");
}

async function playLoaded(token) {
  const beats = () => state.run.beats;
  let i = 0;
  while (token === state.token) {
    if (i >= beats().length) {
      if (state.run.status !== "generating") break;
      await sleep(300);
      continue;
    }
    const b = beats()[i];
    // Moves happen together, then the camera settles.
    if (b.kind === "move") {
      while (i < beats().length && beats()[i].kind === "move") moveBeat(beats()[i++]);
      await wait(900);
      continue;
    }
    // The opening's skill and memory beats play as one short montage.
    if (b.scene === "cast" && (b.kind === "narrate" || b.kind === "memory")) {
      const group = [];
      while (i < beats().length && beats()[i].scene === "cast" && beats()[i].kind === b.kind) group.push(beats()[i++]);
      await showGroup(group, token);
      continue;
    }
    i++;
    await showBeat(b, token);
  }
  if (token === state.token) {
    clearTransient();
    if (state.run.status === "done") await showEnd();
    if (state.run.status === "error") caption(`This film hit a problem: ${state.run.error ?? "unknown error"}`);
    stop();
  }
}

function moveBeat(b) {
  const el = document.getElementById(`actor-${b.actor}`);
  const night = b.scene === "midnight";
  el.classList.toggle("asleep", night && b.place === "bedroom");
  el.classList.toggle("offstage", b.place === "outside" && (b.scene === "midnight" || b.scene === "cast"));
  placeActor(b.actor, b.place);
}

async function showGroup(group, token) {
  // The opening's skills and memories go straight to the case file, not the screen.
  for (const b of group) logEntry(b);
  const book = group.find((b) => b.kind === "memory" && b.actor === "goldilocks" && b.line.startsWith("Opens"));
  if (book) pin({ tag: "Casebook", text: book.line.replace(/^Opens her casebook\. /, ""), kind: "note" });
  void token;
}

async function showBeat(b, token) {
  clearTransient();
  const shot = shotForBeat(b);
  if (shot && setCamera(shot)) await wait(1100);
  if (b.pieSlices !== undefined) drawPie(b.pieSlices);
  if (b.suspicion) setSuspicion(b.suspicion);
  if (b.mood && b.actor !== "narrator") setMood(b.actor, b.mood);

  switch (b.kind) {
    case "title": {
      if (b.scene === "reveal" && b.line === "What Really Happened") await askForGuess(token);
      if (b.scene === "reveal" && b.line !== "What Really Happened") $("#stage").classList.remove("is-flashback");
      const card = $("#title");
      const opening = b.scene === "cast";
      const sub = opening ? `Case #${state.run.caseNumber} · setup ${state.run.setupId} · a film the characters write themselves` : SCENES[b.scene];
      card.innerHTML = `<div class="fade-in"><p>${sub}</p><h2>${escapeHtml(b.line)}</h2></div>`;
      card.hidden = false;
      if (b.scene === "midnight") $("#stage").classList.add("is-night");
      if (b.scene === "morning") {
        $("#stage").classList.remove("is-night");
        document.querySelectorAll(".actor").forEach((a) => a.classList.remove("asleep"));
      }
      if (b.scene === "reveal") unsealLog();
      await wait(opening ? 3200 : 2200);
      card.hidden = true;
      if (b.scene === "reveal") logEntry({ ...b, kind: "reveal", line: `Ending: ${b.line}` });
      return;
    }
    case "narrate":
    case "reveal": {
      logEntry(b);
      if (b.line.startsWith("Same setup")) return;
      caption(b.line);
      await speakAtLeast(b, token);
      return;
    }
    case "weather": {
      const sky = state.run.weather?.sky ?? "clear";
      $("#stage").dataset.sky = sky;
      $("#hud-case").textContent = `Case #${state.run.caseNumber} · ${state.run.weather?.forest ?? ""} · live weather`;
      stamp(`Live: ${sky}`, "weather");
      caption(b.line);
      logEntry(b);
      pin({ tag: "Live weather", text: `${b.line.replace(/^Live tonight in /, "")}`, kind: "note" });
      await speakAtLeast(b, token);
      return;
    }
    case "radio": {
      $("#stage").classList.add("radio-on");
      stamp("On air", "radio");
      caption(b.line);
      logEntry(b);
      pin({ tag: "Radio · real news", text: b.line.replace(/^On the radio: /, "") });
      await speakAtLeast(b, token);
      $("#stage").classList.remove("radio-on");
      return;
    }
    case "wildcard": {
      stamp("Twist!", "secret");
      document.querySelectorAll(".actor").forEach((a) => a.classList.add("jump"));
      setTimeout(() => document.querySelectorAll(".actor").forEach((a) => a.classList.remove("jump")), 700);
      caption(b.line);
      logEntry(b);
      pin({ tag: "Twist", text: b.line, kind: "secret" });
      await speakAtLeast(b, token);
      return;
    }
    case "evidence": {
      $("#stage").classList.add("clue-focus");
      if (b.focus?.kind === "trail") crumbTrail(b.focus.who);
      stamp(`Exhibit ${b.exhibit ?? ""}`, "exhibit");
      caption(b.line);
      logEntry(b);
      pin({ tag: `Exhibit ${b.exhibit}`, text: b.line });
      await speakAtLeast(b, token);
      return;
    }
    case "verdict": {
      const label = { too_hot: "Too hot", too_cold: "Too cold", just_right: "Just right" }[b.verdict] ?? "";
      showBubble("goldilocks", b.line);
      stamp(label, b.verdict);
      logEntry(b);
      pin({ tag: `${state.cast[b.target]?.name.split(" ")[0]}'s answer`, text: label, kind: b.verdict, color: state.cast[b.target]?.color });
      await speakAtLeast(b, token);
      return;
    }
    case "secret": {
      animate(b.actor, "point", 1200);
      setTimeout(() => animate(b.target, "shake", 900), 500);
      stamp("Secret out!", "secret");
      showBubble(b.actor, b.line.replace(/^.*?blurts it out: /, ""));
      logEntry(b);
      pin({ tag: "Red herring?", text: b.line.replace(/^.*?blurts it out: /, ""), kind: "secret" });
      await speakAtLeast(b, token);
      return;
    }
    case "flashback": {
      $("#stage").classList.add("is-flashback");
      document.getElementById(`actor-${b.actor}`)?.classList.remove("asleep", "offstage");
      placeActor(b.actor, b.place ?? "kitchen");
      await wait(900);
      caption(b.line);
      logEntry(b);
      animate(b.actor, "sneaky", 2000);
      await wait(READ(b.line));
      return;
    }
    case "plan":
    case "sneak": {
      showBubble(b.actor, b.line, true);
      logEntry(b);
      if (b.kind === "sneak") animate(b.actor, "sneaky", 2000);
      await wait(b.kind === "plan" ? 2200 : READ(b.line));
      return;
    }
    case "react": {
      if (b.target) face(b.actor, b.target);
      animate(b.actor, "jump");
      showBubble(b.actor, b.line);
      logEntry(b);
      await speakAtLeast(b, token);
      return;
    }
    case "say":
    case "accuse":
    case "respond": {
      if (b.target) face(b.actor, b.target);
      if (b.kind === "accuse") {
        document.getElementById(`actor-${b.target}`)?.classList.add("accused");
        animate(b.actor, "point", 1200);
        setTimeout(() => animate(b.target, "shake", 900), 600);
      }
      if (b.kind === "respond") animate(b.actor, b.isLie ? "shake" : "jump");
      showBubble(b.actor, b.line);
      logEntry(b);
      await speakAtLeast(b, token);
      return;
    }
    case "whisper": {
      face(b.actor, b.target);
      animate(b.actor, "lean", 1600);
      const a = state.pos[b.actor];
      const t = state.pos[b.target];
      $("#wires").innerHTML = `<path class="wire" d="M${a.x} ${(a.y - 7) * 0.5625} Q${(a.x + t.x) / 2} ${Math.min(a.y, t.y) * 0.5625 - 8} ${t.x} ${(t.y - 7) * 0.5625}"/>`;
      showBubble(b.actor, `(whispering to ${state.cast[b.target].name}) ${b.line}`, true);
      $("#bubble").classList.add("whisper");
      logEntry(b);
      pin({ tag: `Whisper · ${state.cast[b.actor].name.split(" ")[0]} to ${state.cast[b.target].name.split(" ")[0]}`, text: b.line, kind: "note" });
      await wait(READ(b.line) + 800);
      return;
    }
    case "research": {
      const card = $("#research");
      const use = b.sponsors[0];
      card.innerHTML = `<b>${use?.sponsor === "Glasser" ? "Glasser" : "Telem · live search"}</b> · ${escapeHtml(b.reason ?? "")}<br/>${escapeHtml(b.line)}${
        b.sources?.length ? `<small>Sources: ${b.sources.slice(0, 2).map((s) => escapeHtml(s.title)).join(" · ")}</small>` : ""
      }`;
      card.className = "research fade-in";
      card.hidden = false;
      logEntry(b);
      pin({ tag: "Research", text: b.line.slice(0, 120) });
      await wait(READ(b.line));
      return;
    }
  }
}

// Same setup, different endings: one row per recent case.
const CHOICE_ICON = { eat_one_slice: "ate 1", eat_two_slices: "ate 2", hide_the_pie: "hid it", leave_it_alone: "nothing", stayed_in_bed: "slept" };
function endingsGrid(recent = []) {
  if (recent.length < 2) return "";
  const bears = SUSPECTS.map((id) => state.cast[id]);
  return `<table class="grid"><thead><tr><th>Case</th>${bears.map((c) => `<th>${c.name.split(" ")[0]}</th>`).join("")}<th>Accused</th><th>Ending</th></tr></thead><tbody>${recent
    .map((r) => {
      const v = Object.fromEntries((r.visits ?? []).map((x) => [x.id, x]));
      return `<tr class="${r.id === state.run.id ? "current" : ""}"><td>#${r.caseNumber}</td>${bears
        .map((c) => `<td>${CHOICE_ICON[v[c.id]?.choice] ?? "?"}${v[c.id]?.frame ? ", framed" : ""}</td>`)
        .join("")}<td>${r.accused ? state.cast[r.accused].name.split(" ")[0] : "-"}</td><td>${escapeHtml(r.ending)}</td></tr>`;
    })
    .join("")}</tbody></table><p class="stats">What each bear really did at midnight, case by case.</p>`;
}

// ---------- play detective ----------
async function askForGuess(token) {
  clearTransient();
  setCamera(WIDE);
  const box = $("#guess");
  const recording = $("#rec") && !$("#rec").hidden;
  box.innerHTML = `<div class="fade-in"><p class="eyebrow">Your turn, detective</p><h2>Who ate the pie?</h2>
    <div class="suspects">${SUSPECTS.map((id) => `<button class="pick" data-id="${id}" style="--c:${state.cast[id].color}"><img src="/assets/cutouts/${id}.png" alt=""/><span>${state.cast[id].name}</span></button>`).join("")}</div>
    <button class="skip">Skip, just show me</button><p class="hint">Look back at the exhibits on the case board. Which clues are real, and which were planted?</p></div>`;
  box.hidden = false;
  const choice = await new Promise((resolve) => {
    box.querySelectorAll(".pick").forEach((b) => (b.onclick = () => resolve(b.dataset.id)));
    box.querySelector(".skip").onclick = () => resolve(null);
    setTimeout(() => resolve(null), recording ? 6000 : 45000);
    const check = setInterval(() => { if (token !== state.token) { clearInterval(check); resolve(null); } }, 300);
  });
  state.guess = choice;
  if (choice) {
    box.querySelector(`.pick[data-id="${choice}"]`)?.classList.add("chosen");
    await sleep(700);
  }
  box.hidden = true;
}

// After the reveal: what each clue really meant, and the reasoning trap (if any) that fooled you.
function renderDebrief() {
  const run = state.run;
  const t = run.truth;
  if (!t) return;
  const name = (id) => state.cast[id]?.name ?? id;
  const culprits = t.culprits ?? [];
  const g = state.guess;
  const accused = run.ending?.accused;
  const liars = new Set(run.beats.filter((b) => b.isLie && SUSPECTS.includes(b.actor)).map((b) => b.actor));
  let verdict, lesson;
  if (!g) {
    verdict = "You didn't make a guess this time.";
    lesson = "Next case, pick a suspect before the reveal and see if you can out-think Goldilocks.";
  } else if (culprits.includes(g)) {
    const key = (t.clues ?? []).find((c) => c.honest && c.pointsTo === g);
    verdict = `You guessed ${name(g)}. Correct!${accused && !culprits.includes(accused) ? " You beat Goldilocks, who accused the wrong bear." : ""}`;
    lesson = key ? `The clue that cracked it: Exhibit ${key.exhibit}. ${key.why}` : "You read the testimony right: the guilty bear's story didn't hold together.";
  } else {
    verdict = `You guessed ${name(g)}. Not this time: it was ${culprits.map(name).join(" and ") || "nobody in the family"}.`;
    const framed = t.framed?.find((f) => f.target === g);
    if (framed) lesson = `Planted evidence fooled you. ${name(framed.by)} smeared crumbs on ${name(g)}'s chair. Evidence can be faked, so ask who benefits from it.`;
    else if ((t.secretsOut ?? []).includes(g)) lesson = `A secret isn't a confession. ${name(g)}'s secret came out, but it had nothing to do with the pie. That's a red herring.`;
    else if (liars.has(g)) lesson = `Liars aren't always thieves. ${name(g)} lied to protect a different secret, not to cover up the pie.`;
    else if (g === accused) lesson = "You followed the detective. Even Goldilocks gets it wrong, so trust the evidence, not the confidence.";
    else lesson = "The physical evidence pointed elsewhere. Fur, crumbs and clocks don't lie, but bears do.";
  }
  $("#debrief").innerHTML = `<h2>Detective debrief</h2>
    <p class="verdict ${g && culprits.includes(g) ? "right" : "wrong"}">${escapeHtml(verdict)}</p>
    <p class="lesson"><b>Lesson:</b> ${escapeHtml(lesson)}</p>
    <ol class="clues">${(t.clues ?? [])
      .map((c) => `<li><span class="label ${c.honest ? "lead" : "herring"}">${c.honest ? (c.pointsTo ? "True lead" : "Background") : "Red herring"}</span> <b>Exhibit ${c.exhibit}:</b> ${escapeHtml(c.line)} <i>${escapeHtml(c.why)}</i></li>`)
      .join("")}${(t.secretsOut ?? []).map((s) => `<li><span class="label herring">Red herring</span> <b>${escapeHtml(name(s))}'s secret</b> came out, but it wasn't about the pie.</li>`).join("")}</ol>`;
  $("#debrief").hidden = false;
}

async function showEnd() {
  renderDebrief();
  setCamera(WIDE);
  const stats = await (await fetch("/api/stats")).json();
  const e = state.run.ending;
  if (!e) return;
  $("#end").innerHTML = `<div class="fade-in">
    <p class="stats">THE ENDING THE AGENTS CHOSE · CASE #${state.run.caseNumber}</p>
    <h2>${escapeHtml(e.title)}</h2>
    <p class="summary">${escapeHtml(e.summary)}</p>
    ${endingsGrid(stats.recent)}
    <p class="stats">Same setup (${state.run.setupId}) every time. Across <b>${stats.runs}</b> films, Goldilocks was right <b>${stats.correct}</b> times and the bears told <b>${stats.lies}</b> lies.</p>
  </div>`;
  $("#end").hidden = false;
}

// ---------- make a new film (streamed live from the agents) ----------
async function newRun() {
  if (state.generating) return;
  stop();
  const btn = $("#new");
  btn.disabled = true;
  btn.textContent = "Agents are deciding…";
  state.generating = true;
  const token = ++state.token;
  try {
    const res = await fetch("/api/generate", { method: "POST" });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let started = false;
    let player;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const e = JSON.parse(line);
        if (e.type === "start") {
          await prepare({ ...e.run, beats: [] });
          history.replaceState(null, "", `?case=${e.run.id}`);
          started = true;
          state.playing = true;
          $("#play").textContent = "Stop";
          player = playLoaded(token);
        } else if (e.type === "beat") state.run.beats.push(e.beat);
        else if (e.type === "patch") {
          const b = state.run.beats[e.i];
          if (b) {
            b.audio = e.audio;
            b.sponsors = e.sponsors;
          }
        } else if (e.type === "done") Object.assign(state.run, { status: "done", truth: e.truth, ending: e.ending });
        else if (e.type === "error") Object.assign(state.run, { status: "error", error: e.message });
      }
    }
    if (started && state.run.status === "generating") Object.assign(state.run, { status: "error", error: "the connection closed early" });
    await refreshRuns(state.run?.id);
    await player;
  } catch (error) {
    caption(`Couldn't make a new film: ${error.message}`);
  } finally {
    state.generating = false;
    btn.disabled = false;
    btn.textContent = "Open a new case";
  }
}

// ---------- record & download ----------
async function recordFilm() {
  if (!state.run || state.run.status !== "done") {
    caption("Pick a finished case (or wait for this one to finish), then record it.");
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
    caption("Recording needs desktop Chrome or Edge.");
    return;
  }
  const btn = $("#record");
  let stream;
  try {
    caption("Choose “This tab” and turn on tab audio, then the film plays from the start.");
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", frameRate: 30 },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    });
  } catch {
    caption("Recording was cancelled.");
    return;
  }
  const [track] = stream.getVideoTracks();
  try {
    if (window.CropTarget && track.cropTo) await track.cropTo(await window.CropTarget.fromElement($("#stage")));
  } catch {
    /* cropping is a nice-to-have */
  }
  const type = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const finished = new Promise((r) => (recorder.onstop = r));
  btn.classList.add("recording");
  btn.textContent = "● Recording…";
  $("#speed").value = "1";
  recorder.start(1000);
  $("#rec").hidden = false;
  await play(state.run.id, state.run);
  await sleep(4000);
  $("#rec").hidden = true;
  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  await finished;
  const ext = type?.includes("mp4") ? "mp4" : "webm";
  const url = URL.createObjectURL(new Blob(chunks, { type: type ?? "video/webm" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `who-ate-the-pie-case-${state.run.caseNumber}.${ext}` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  btn.classList.remove("recording");
  btn.textContent = "Record & download";
}

init();

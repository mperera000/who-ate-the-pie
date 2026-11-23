// Plays a film as the agents make it: a camera moves around the Bears' cabin, characters
// walk, talk (Runware voices) and lie, and every decision lands in the log.
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUSPECTS = ["papa", "mama", "baby"];
const SPONSOR_ORDER = ["Claude", "Bruin", "BAND", "Runware", "Telem", "Finch"];
const SCENES = { cast: "Opening", midnight: "Scene 1", morning: "Scene 2", interrogation: "Scene 3", accusation: "Scene 4", reveal: "Finale" };
const SPOKEN = ["say", "accuse", "respond", "react", "narrate", "reveal"];

// Rooms in the cabin set image (percent of the frame). floor = where feet go.
const ROOMS = {
  kitchen: { x: 15, y: 11, w: 34, h: 37, floor: 47 },
  dining: { x: 52, y: 11, w: 34, h: 37, floor: 47 },
  parlour: { x: 15, y: 53, w: 34, h: 39, floor: 91 },
  bedroom: { x: 52, y: 53, w: 34, h: 39, floor: 91 },
  outside: { x: 0, y: 55, w: 13, h: 40, floor: 93 },
};
// Sprite heights, as % of the frame height (storybook sizes).
const HEIGHT = { papa: 31, mama: 29, goldilocks: 22, baby: 18 };
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
    $("#log").innerHTML = `<li class="empty">No films yet. Click <b>✨ Make a new film</b> and the agents will make one live.</li>`;
    caption("Click ✨ Make a new film. Four AI agents will decide everything that happens.");
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
        <span class="mood"></span><span class="name">${c.name}</span></div>`,
    )
    .join("");
  for (const c of state.run.cast) placeActor(c.id, c.role === "detective" ? "outside" : "bedroom");
  $("#meters").innerHTML = SUSPECTS.map((id) => {
    const c = state.cast[id];
    return `<div class="meter" style="--c:${c.color}">${c.name}<div class="track"><div class="fill" id="meter-${id}"></div></div></div>`;
  }).join("");
}

function setMood(id, mood) {
  const el = document.querySelector(`#actor-${id} .mood`);
  if (!el || !mood) return;
  el.textContent = mood;
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
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
    ${beat.isLie ? `<span class="flag hidden-flag" hidden>🤥 That was a lie</span>` : ""}
    ${sealedLine || sealedWhy ? `<span class="seal">🔒 Sealed until the reveal</span>` : ""}
    <div class="chips">${(beat.sponsors ?? [])
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
  if (beat.silent) return wait(Math.max(1500, words(beat.line) * 230));
  // A voice clip may still be on its way from Runware: give it a moment.
  for (let t = 0; !beat.audio && state.run.status === "generating" && t < 3000 && token === state.token; t += 200) await sleep(200);
  if (beat.audio) {
    const audio = new Audio(beat.audio);
    audio.playbackRate = 1.15 * speed();
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

// ---------- playback ----------
async function prepare(run) {
  state.run = run;
  state.cast = Object.fromEntries(run.cast.map((c) => [c.id, c]));
  $("#log").innerHTML = "";
  $("#end").hidden = true;
  $("#title").hidden = true;
  $("#stage").classList.remove("is-night");
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
  $("#play").textContent = "▶ Play";
}

async function play(id, run) {
  stop();
  const token = ++state.token;
  state.playing = true;
  $("#play").textContent = "⏹ Stop";
  await prepare(run ?? (await fetchRun(id)));
  await playLoaded(token);
}

function shotForBeat(b) {
  if (b.kind === "title" || b.scene === "cast" || b.scene === "reveal") return WIDE;
  if (b.scene === "midnight") return b.kind === "plan" ? shotFor("bedroom") : b.kind === "narrate" || b.kind === "sneak" ? shotFor("kitchen") : null;
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
  clearTransient();
  for (const b of group) logEntry(b);
  if (group[0].kind === "narrate") {
    caption(`Skills equipped: ${group.map((b) => b.line.replace(/^.* equips /, "").replace(/\.$/, "")).join(" · ")}`);
    await wait(2000);
  } else {
    caption(`<div class="memories">${group.map((b) => `<div><b>${escapeHtml(state.cast[b.actor]?.name ?? "")}</b> ${escapeHtml(b.line)}</div>`).join("")}</div>`, true);
    await wait(1800 + group.length * 450);
  }
  void token;
}

async function showBeat(b, token) {
  clearTransient();
  const shot = shotForBeat(b);
  if (shot && setCamera(shot)) await wait(900);
  if (b.pieSlices !== undefined) drawPie(b.pieSlices);
  if (b.suspicion) setSuspicion(b.suspicion);
  if (b.mood && b.actor !== "narrator") setMood(b.actor, b.mood);

  switch (b.kind) {
    case "title": {
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
      await wait(opening ? 2200 : 1400);
      card.hidden = true;
      if (b.scene === "reveal") logEntry({ ...b, kind: "reveal", line: `Ending: ${b.line}` });
      return;
    }
    case "narrate":
    case "reveal": {
      logEntry(b);
      if (b.line.startsWith("Same setup")) return;
      caption(b.line);
      if (b.actor !== "narrator") {
        animate(b.actor, b.kind === "reveal" ? "jump" : "nod");
        await wait(b.kind === "reveal" ? 1500 : 1200);
        return;
      }
      await speak(b, Math.max(1800, words(b.line) * 300), token);
      return;
    }
    case "plan":
    case "sneak": {
      showBubble(b.actor, b.line, true);
      logEntry(b);
      if (b.kind === "sneak") animate(b.actor, "sneaky", 2000);
      await wait(b.kind === "plan" ? 1250 : Math.max(1800, words(b.line) * 240));
      return;
    }
    case "react": {
      if (b.target) face(b.actor, b.target);
      animate(b.actor, "jump");
      showBubble(b.actor, b.line);
      logEntry(b);
      await speak(b, 1300, token);
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
      await speak(b, Math.max(1800, words(b.line) * 330), token);
      return;
    }
    case "whisper": {
      face(b.actor, b.target);
      animate(b.actor, "lean", 1600);
      const a = state.pos[b.actor];
      const t = state.pos[b.target];
      $("#wires").innerHTML = `<path class="wire" d="M${a.x} ${(a.y - 7) * 0.5625} Q${(a.x + t.x) / 2} ${Math.min(a.y, t.y) * 0.5625 - 8} ${t.x} ${(t.y - 7) * 0.5625}"/>`;
      caption(`${state.cast[b.actor].name} sends ${state.cast[b.target].name} a private message (BAND)…`);
      logEntry(b);
      await wait(1600);
      return;
    }
    case "research": {
      const card = $("#research");
      const use = b.sponsors[0];
      card.innerHTML = `<b>${use?.sponsor === "Glasser" ? "🔭 Glasser" : "🛰️ Telem"}</b> · ${escapeHtml(b.reason ?? "")}<br/>${escapeHtml(b.line)}${
        b.sources?.length ? `<small>Sources: ${b.sources.slice(0, 2).map((s) => escapeHtml(s.title)).join(" · ")}</small>` : ""
      }`;
      card.className = "research fade-in";
      card.hidden = false;
      logEntry(b);
      await wait(2600);
      return;
    }
  }
}

// Same setup, different endings: one row per recent case.
const CHOICE_ICON = { eat_one_slice: "🥧", eat_two_slices: "🥧🥧", hide_the_pie: "🫣", leave_it_alone: "😇", stayed_in_bed: "💤" };
function endingsGrid(recent = []) {
  if (recent.length < 2) return "";
  const bears = SUSPECTS.map((id) => state.cast[id]);
  return `<table class="grid"><thead><tr><th>Case</th>${bears.map((c) => `<th>${c.name.split(" ")[0]}</th>`).join("")}<th>Accused</th><th>Ending</th></tr></thead><tbody>${recent
    .map((r) => {
      const v = Object.fromEntries((r.visits ?? []).map((x) => [x.id, x]));
      return `<tr class="${r.id === state.run.id ? "current" : ""}"><td>#${r.caseNumber}</td>${bears
        .map((c) => `<td>${CHOICE_ICON[v[c.id]?.choice] ?? "?"}${v[c.id]?.frame ? "🫵" : ""}</td>`)
        .join("")}<td>${r.accused ? state.cast[r.accused].name.split(" ")[0] : "-"}</td><td>${escapeHtml(r.ending)}</td></tr>`;
    })
    .join("")}</tbody></table><p class="stats">🥧 ate · 🫣 hid the pie · 🫵 framed someone · 😇 touched nothing · 💤 stayed in bed</p>`;
}

async function showEnd() {
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
          $("#play").textContent = "⏹ Stop";
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
    btn.textContent = "✨ Make a new film";
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
  btn.textContent = "⏺ Record & download";
}

init();

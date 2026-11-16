// Story Universe: mobile web app, Campfire design (Direction B: the story path).
// Static, no build step. Talks only to the `story`, `produce` and `family` Edge Functions.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $("#view");
const dock = $("#dock");
const sheet = $("#sheet");
const audio = $("#audio");

// ---------- Utilities ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const P = 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  back: `<svg viewBox="0 0 24 24" ${P} aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
  close: `<svg viewBox="0 0 24 24" ${P} aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`,
  chev: `<svg width="22" height="22" viewBox="0 0 24 24" ${P} aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" ${P} aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>`,
  plus: `<svg width="24" height="24" viewBox="0 0 24 24" ${P} aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>`,
  bang: `<svg viewBox="0 0 24 24" fill="none" stroke="#4a3323" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 6v7M12 17.5v.5"/></svg>`,
  speak: `<svg width="20" height="20" viewBox="0 0 24 24" ${P} aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6"/></svg>`,
  flame: `<svg width="84" height="112" viewBox="0 0 96 128" aria-hidden="true"><path d="M48 4C62 30 88 46 88 82a40 40 0 0 1-80 0C8 62 18 50 28 42c0 16 8 26 18 26C46 42 34 26 48 4z" fill="#f0632b"/><path d="M50 52c8 14 20 22 20 40a22 22 0 0 1-44 0c0-10 6-16 12-20 0 8 4 12 10 12 0-14-6-20 2-32z" fill="#ffb703"/></svg>`,
  idea: `<svg width="26" height="26" viewBox="0 0 24 24" ${P} aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
};

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isError ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ""), isError ? 6000 : 2800);
}

const COLORS = ["lake", "pine", "ember", "flame"];
const colorFor = (i) => COLORS[((i % 4) + 4) % 4];
const AV = [["#2d7fb8", "#fff"], ["#ffb703", "#4a3323"], ["#2e7d5b", "#fff"], ["#f0632b", "#fff"], ["#f3e8d3", "#4a3323"], ["#d7e8f5", "#4a3323"]];
// Initials: one letter, or two when another family member shares the first letter.
const initials = (m) => {
  const n = (m.name || "?").trim();
  const clash = (cache.family ?? []).some((o) => o.id !== m.id && (o.name || "").trim().charAt(0).toUpperCase() === n.charAt(0).toUpperCase());
  return clash ? n.charAt(0).toUpperCase() + n.charAt(1).toLowerCase() : n.charAt(0).toUpperCase();
};
const avatar = (m, i, cls = "") => {
  const [bg, fg] = AV[i % AV.length];
  return `<span class="av ${cls}" style="background:${bg};color:${fg}" aria-hidden="true">${esc(initials(m))}</span>`;
};

function coverTile(u, i, cls = "") {
  const color = colorFor(i);
  return `<div class="cover ${color} ${cls}">${u.cover_url ? `<img src="${esc(u.cover_url)}" alt="Cover of ${esc(u.title)}" loading="lazy">`
    : `<span class="c1"></span><span class="c2"></span><span class="c3"></span><span class="ct">${esc(u.title)}</span>`}</div>`;
}

const sortedChapters = (u) => [...(u.chapters ?? [])].sort((a, b) => a.number - b.number);
const isBedtimeHour = () => { const h = new Date().getHours(); return h >= 17 || h < 6; };
const fmtTime = (s) => { if (!isFinite(s)) return "0:00"; s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const ageOf = (m) => {
  if (!m.birth_month) return null;
  const y = (Date.now() - Date.parse(m.birth_month)) / (365.25 * 864e5);
  return y < 0 ? null : Math.floor(y);
};
const namesList = (names) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
const scriptText = (t) => esc(t).replace(/\[([^\]]{1,40})\]/g, '<span class="atag">$1</span>');
const speakerLabel = (s) => (s === "NARRATOR" ? "Narrator" : s);

function dayKicker() {
  const d = new Date();
  const day = d.toLocaleDateString("en-US", { weekday: "long" });
  const h = d.getHours();
  return `${day} ${h < 12 && h >= 5 ? "morning" : h < 17 && h >= 5 ? "afternoon" : h < 20 && h >= 5 ? "evening" : "night"}`;
}

// The story path: Told, Written, Checked, Recorded.
// `review` is only known on the chapter screen; lists infer from status.
function stageOf(ch, review) {
  const s = ch.status;
  const written = !!(ch.script ?? true);
  let checked = s === "approved" || s === "produced" || (s === "draft" && review?.verdict === "pass");
  const recorded = s === "produced";
  const warn = s === "needs_fix" || s === "blocked";
  let next;
  if (recorded) next = { label: "Play", tone: "pine" };
  else if (s === "approved") next = { label: "Next: record", tone: "flame" };
  else if (s === "needs_fix") next = { label: "Needs a fix", tone: "flame" };
  else if (s === "blocked") next = { label: "Needs a rewrite", tone: "ember" };
  else if (checked) next = { label: "Next: approve", tone: "flame" };
  else next = { label: "Next: check", tone: "flame" };
  const done = [true, written, checked, recorded];
  const cur = done.indexOf(false);
  return { done, cur, warn, next };
}

function pathHtml(st, big = false) {
  const names = ["Told", "Written", "Checked", "Recorded"];
  return `<div class="path ${big ? "big" : ""}" role="img" aria-label="Story path: ${names.map((n, i) => `${n} ${st.done[i] ? "done" : i === st.cur ? "next" : "not yet"}`).join(", ")}">${names.map((n, i) => {
    const cls = st.done[i] ? "done" : i === st.cur ? (st.warn && i === 2 ? "cur warn" : "cur") : "";
    const inner = big && st.done[i] ? ICON.check.replace("<svg", '<svg width="16" height="16"') : big && cls.includes("warn") ? ICON.bang.replace("<svg", '<svg width="18" height="18"') : "";
    const bar = i < 3 ? `<span class="bar ${st.done[i + 1] ? "done" : ""}"></span>` : "";
    return `<div class="stop ${cls}"><span class="d">${inner}</span>${n}</div>${bar}`;
  }).join("")}</div>`;
}

// ---------- API ----------

class PasscodeError extends Error {}

async function call(fn, action, params = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "x-family-passcode": store.get("passcode", ""),
      },
      body: JSON.stringify({ action, ...params }),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check the connection and try again.");
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON (gateway timeout etc.) */ }
  if (res.status === 401 && body?.error === "Wrong passcode") throw new PasscodeError("Wrong passcode");
  if (res.status === 504 || res.status === 546) throw new Error("The server took too long. It may still finish: wait a minute, then refresh.");
  if (!body) throw new Error(`Server error (${res.status})`);
  if (!body.ok) throw new Error(body.error || `Server error (${res.status})`);
  return body.data;
}
const story = (action, params) => call("story", action, params);
const produce = (action, params) => call("produce", action, params);
const familyApi = (action, params) => call("family", action, params);

const cache = { universes: null, family: null, voices: null, covers: null };
async function getFamily(fresh = false) {
  if (fresh || !cache.family) cache.family = await familyApi("list");
  return cache.family;
}
const familyOrdered = (fam) => [...kidsOldestFirst(fam), ...fam.filter((m) => m.role === "parent"), ...fam.filter((m) => m.role !== "kid" && m.role !== "parent")];
const kidsOldestFirst = (fam) => fam.filter((m) => m.role === "kid").sort((a, b) => String(a.birth_month ?? "9").localeCompare(String(b.birth_month ?? "9")));
async function getCovers(fresh = false) {
  if (fresh || !cache.covers) cache.covers = (await produce("media")).covers;
  return cache.covers;
}
async function getUniverses(fresh = false) {
  if (fresh || !cache.universes) {
    const [list, covers] = await Promise.all([story("list_universes"), getCovers(fresh)]);
    cache.universes = list.map((u) => ({ ...u, cover_url: covers[u.id] ?? null }));
  }
  return cache.universes;
}
async function getUniverse(id) {
  const [u, covers] = await Promise.all([story("get_universe", { universe_id: id }), getCovers()]);
  return { ...u, cover_url: covers[id] ?? null };
}
async function getChapterFull(id) {
  const [ch, m] = await Promise.all([story("get_chapter", { chapter_id: id }), produce("media", { chapter_id: id })]);
  cache.covers = m.covers;
  const u = await getUniverse(ch.universe_id);
  return { ch: { ...ch, audio_url: m.audio_url, preview_url: m.preview_url, cover_url: u.cover_url, universe_title: u.title }, u };
}
// Lists don't carry the review, so a draft that already passed its check would read "Next: check".
// Look up reviews for draft chapters (reads only, a handful at most).
const reviewCache = new Map();
async function draftReviews(chapters) {
  const drafts = chapters.filter((c) => c.status === "draft" && !reviewCache.has(c.id)).slice(0, 6);
  await Promise.all(drafts.map((c) => story("get_chapter", { chapter_id: c.id }).then((full) => reviewCache.set(c.id, full.review ?? null)).catch(() => {})));
}
const listStage = (c) => stageOf(c, c.status === "draft" ? reviewCache.get(c.id) : undefined);

// Stable color index for a universe (its position in the library).
const universeIndex = (id) => Math.max(0, (cache.universes ?? []).findIndex((u) => u.id === id));

// ---------- Sheets ----------

let wakeLock = null;
async function holdAwake(on) {
  try {
    if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported or denied */ }
}

const KID_PROMPTS = [
  "What should happen next?",
  "Who should be the bravest in this chapter?",
  "What would you pack for this adventure?",
  "What's the funniest thing that could happen?",
  "What sound does this story make?",
];

// steps: [{ label, run: async (prev) => result }]; opts: { title, kicker, kid }
async function busy(steps, opts = {}) {
  sheet.hidden = false;
  sheet.onclick = null;
  holdAwake(true);
  const start = Date.now();
  const prompt = opts.kid ? KID_PROMPTS[Math.floor(Math.random() * KID_PROMPTS.length)] : null;
  let result;
  try {
    for (let i = 0; i < steps.length; i++) {
      sheet.innerHTML = `<div class="panel" role="alertdialog" aria-live="polite" aria-label="${esc(opts.title ?? steps[i].label)}">
        <div class="flamebox">${ICON.flame}</div>
        <div class="title-block" style="margin:0">${opts.kicker ? `<div class="kick">${esc(opts.kicker)}</div>` : ""}
          <h2>${esc(opts.title ?? steps[i].label)}</h2>
          <div class="soft small">${esc(opts.hint ?? "Up to a minute or two. Keep this screen open.")} <span class="elapsed">0:00</span></div></div>
        ${steps.length > 1 ? `<div class="steps">${steps.map((s, j) => `<div class="step ${j < i ? "done" : j === i ? "now" : "todo"}"><span class="ic">${j < i ? ICON.check.replace("<svg", '<svg width="14" height="14"') : ""}</span>${esc(s.label)}</div>`).join("")}</div>` : ""}
        ${prompt ? `<div class="card tint-flame"><div class="kick" style="color:var(--bark)">While you wait, ask ${esc(opts.kid)}</div>
          <div style="font:500 21px/1.25 var(--display);margin-top:6px">${esc(prompt)}</div></div>` : ""}
      </div>`;
      const el = $(".elapsed", sheet);
      const timer = setInterval(() => (el.textContent = fmtTime((Date.now() - start) / 1000)), 500);
      try { result = await steps[i].run(result); } finally { clearInterval(timer); }
    }
    return result;
  } finally {
    closeSheet();
    holdAwake(false);
  }
}

function closeSheet() { sheet.onclick = null; sheet.hidden = true; sheet.innerHTML = ""; }

function confirmSheet({ title, body, ok = "OK", cancel = "Not now" }) {
  return new Promise((resolve) => {
    sheet.hidden = false;
    sheet.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><span class="grab"></span>
      <h2>${esc(title)}</h2>${body ? `<div class="soft">${body}</div>` : ""}
      <button class="btn quiet" data-cancel>${esc(cancel)}</button>
      <button class="btn" data-ok>${esc(ok)}</button></div>`;
    const done = (v) => { closeSheet(); resolve(v); };
    $("[data-ok]", sheet).onclick = () => done(true);
    $("[data-cancel]", sheet).onclick = () => done(false);
    sheet.onclick = (e) => { if (e.target === sheet) done(false); };
  });
}

function notesSheet({ title, intro, ok, required = true }) {
  return new Promise((resolve) => {
    sheet.hidden = false;
    sheet.innerHTML = `<form class="panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><span class="grab"></span>
      <h2>${esc(title)}</h2>${intro ? `<div class="soft">${esc(intro)}</div>` : ""}
      <label class="field"><span>What should change?</span>
        <textarea id="ns" rows="4" placeholder="e.g. Make the owl less spooky, and end with everyone at home"></textarea></label>
      <button class="btn quiet" type="button" data-cancel>Cancel</button>
      <button class="btn" type="submit">${esc(ok)}</button></form>`;
    const done = (v) => { closeSheet(); resolve(v); };
    $("[data-cancel]", sheet).onclick = () => done(null);
    sheet.onclick = (e) => { if (e.target === sheet) done(null); };
    $("form", sheet).onsubmit = (e) => {
      e.preventDefault();
      const v = $("#ns", sheet).value.trim();
      if (required && !v) return $("#ns", sheet).focus();
      done(v);
    };
    setTimeout(() => $("#ns", sheet)?.focus(), 60);
  });
}

// Add or edit a family member. Resolves to the saved member, or null.
function personSheet(member = null, presetRole = "kid") {
  return new Promise((resolve) => {
    let role = member?.role ?? presetRole;
    const editing = !!member;
    sheet.hidden = false;
    sheet.innerHTML = `<form class="panel" role="dialog" aria-modal="true" aria-label="${editing ? "Edit" : "Add someone"}" id="ap"><span class="grab"></span>
      <h2>${editing ? esc(member.name) : "Add someone"}</h2>
      <label class="field"><span>Name</span>
        <input type="text" id="ap-name" maxlength="40" autocomplete="off" autocapitalize="words" enterkeyhint="next" required value="${esc(member?.name ?? "")}"></label>
      <div><span class="lab">Who are they?</span>
        <div class="seg" id="ap-role">${[["kid", "Kid"], ["parent", "Grown-up"], ["other", "Other"]].map(([v, l]) =>
          `<button type="button" data-role="${v}" aria-pressed="${v === role}">${l}</button>`).join("")}</div></div>
      <label class="field" id="ap-bm-wrap"><span>Birth month <span class="soft" style="font-weight:400">(sets the story's age level)</span></span>
        <input type="month" id="ap-bm" max="${new Date().toISOString().slice(0, 7)}" value="${esc(member?.birth_month ? String(member.birth_month).slice(0, 7) : "")}"></label>
      <label class="field"><span>Something stories should know <span class="soft" style="font-weight:400">(optional)</span></span>
        <input type="text" id="ap-notes" maxlength="500" placeholder="e.g. Grandma, lives in Texas, loves birds" value="${esc(member?.notes ?? "")}"></label>
      <button class="btn quiet" type="button" data-cancel>Cancel</button>
      <button class="btn" type="submit" id="ap-save">${editing ? "Save" : "Add to the crew"}</button></form>`;
    const done = (v) => { closeSheet(); resolve(v); };
    const syncRole = () => {
      $$("#ap-role [data-role]", sheet).forEach((b) => b.setAttribute("aria-pressed", b.dataset.role === role));
      $("#ap-bm-wrap", sheet).classList.toggle("hidden", role !== "kid");
    };
    $$("#ap-role [data-role]", sheet).forEach((b) => (b.onclick = () => { role = b.dataset.role; syncRole(); }));
    syncRole();
    $("[data-cancel]", sheet).onclick = () => done(null);
    sheet.onclick = (e) => { if (e.target === sheet) done(null); };
    $("#ap", sheet).onsubmit = async (e) => {
      e.preventDefault();
      const name = $("#ap-name", sheet).value.trim();
      if (!name) return $("#ap-name", sheet).focus();
      const save = $("#ap-save", sheet);
      save.disabled = true;
      const fields = {
        name, role,
        birth_month: role === "kid" ? $("#ap-bm", sheet).value || undefined : undefined,
        notes: $("#ap-notes", sheet).value.trim() || undefined,
      };
      try {
        const saved = editing ? await familyApi("update", { id: member.id, ...fields }) : await familyApi("add", fields);
        cache.family = null;
        toast(editing ? "Saved" : `${saved.name} joined the crew`);
        done(saved);
      } catch (err) {
        if (err instanceof PasscodeError) { done(null); store.del("passcode"); return route(); }
        toast(err.message || String(err), true);
        save.disabled = false;
      }
    };
    if (!editing) setTimeout(() => $("#ap-name", sheet)?.focus(), 60);
  });
}

async function attempt(fn) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof PasscodeError) { store.del("passcode"); route(); return; }
    console.error(e);
    toast(e.message || String(e), true);
  }
}
const handleLoadError = (e, retry) => { if (e instanceof PasscodeError) { store.del("passcode"); return route(); } errorView(e, retry); };

// ---------- Layout ----------

function setDock(html) {
  dock.innerHTML = html ? `<div class="inner">${html}</div>` : "";
  requestAnimationFrame(() => document.documentElement.style.setProperty("--dock-h", `${dock.offsetHeight}px`));
}
const backBtn = (href) => `<a class="icon-btn" href="${href}" aria-label="Back">${ICON.back}</a>`;
function setTab(name) {
  $$("#tabs a").forEach((a) => (a.dataset.tab === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
}
function loading() {
  setDock("");
  view.innerHTML = `<div class="row" style="min-height:60dvh;justify-content:center"><div class="spinner" aria-label="Loading"></div></div>`;
}
function errorView(e, retry) {
  view.innerHTML = `<div class="title-block" style="padding-top:28dvh"><h1 style="font-size:30px">That didn't load</h1>
    <p class="soft">${esc(e.message || e)}</p></div>`;
  setDock(`<button class="btn" id="retry">Try again</button>`);
  $("#retry").onclick = retry;
}

// ---------- Passcode ----------

function screenLock(message = "") {
  document.body.classList.add("locked");
  document.body.classList.remove("night");
  setDock("");
  view.innerHTML = `<form class="lock" id="lock" autocomplete="on">
    <img class="mark" src="icon.svg" alt="" style="width:72px;height:72px">
    <div class="title-block" style="margin:0"><h1>Story Universe</h1><p class="soft" style="margin:0">Enter the family passcode.</p></div>
    <input type="text" name="username" value="family" autocomplete="username" hidden>
    <label class="field"><span>Family passcode</span>
      <input type="password" id="pc" autocomplete="current-password" inputmode="text" required autofocus></label>
    ${message ? `<p style="margin:0;font-weight:600">${esc(message)}</p>` : ""}
    <button class="btn" type="submit">Unlock</button>
  </form>`;
  $("#lock").onsubmit = async (e) => {
    e.preventDefault();
    const pc = $("#pc").value.trim();
    if (!pc) return;
    store.set("passcode", pc);
    try {
      cache.family = await familyApi("list");
      document.body.classList.remove("locked");
      route();
    } catch (err) {
      store.del("passcode");
      screenLock(err instanceof PasscodeError ? "That passcode didn't work." : err.message);
    }
  };
}

// ---------- Tonight ----------

async function screenTonight() {
  setTab("tonight");
  if (!cache.universes) loading();
  const draw = (universes, fam) => {
    const played = new Set(store.get("played", []));
    const kids = kidsOldestFirst(fam ?? []).map((k) => k.name);
    let upNext = null;
    const waiting = [];
    universes.forEach((u, ui) => {
      const chs = sortedChapters(u);
      const next = chs.find((c) => c.status === "produced" && !played.has(c.id));
      if (next && !upNext) upNext = { u, c: next, ui };
      for (const c of chs) if (c.status !== "produced") waiting.push({ u, c, ui });
    });
    view.innerHTML = `
      <div class="title-block"><div class="kick">${esc(dayKicker())}</div>
        <h1>${kids.length ? `${esc(namesList(kids))} ${kids.length === 1 ? "is" : "are"} ready.` : "Story Universe"}</h1></div>
      ${upNext ? `<a class="card tap" href="#/play/${upNext.c.id}" style="display:flex;gap:14px;align-items:center">
          ${coverTile(upNext.u, upNext.ui, "small")}
          <span class="grow"><span class="badge pine"><span class="dot" style="background:var(--pine)"></span>Play next</span>
            <span style="display:block;font:600 20px/1.15 var(--display);margin-top:8px">Chapter ${upNext.c.number}. ${esc(upNext.c.title)}</span>
            <span class="soft small" style="display:block">${esc(upNext.u.title)}</span></span>
          <span class="mic" style="width:52px;height:52px" aria-hidden="true">${ICON.play.replace("<svg", '<svg width="22" height="22"')}</span></a>` : ""}
      ${waiting.length ? `<div class="section-head"><h2>Needs a grown-up</h2></div><div class="list">${waiting.slice(0, 4).map(({ u, c }) => {
        const st = listStage(c);
        return `<a class="card tap" href="#/c/${c.id}"><div class="chrow"><span class="grow"><span class="t">Chapter ${c.number}. ${esc(c.title ?? "Untitled")}</span>
          <span class="soft small" style="display:block">${esc(u.title)}</span></span><span class="badge ${st.next.tone}">${esc(st.next.label)}</span></div>${pathHtml(st)}</a>`;
      }).join("")}</div>` : ""}
      <a class="feature tap" href="#/tell" style="background:var(--flame-tint);margin-top:${waiting.length || upNext ? 24 : 0}px">
        <span class="ico" style="background:var(--flame);color:var(--bark)">${ICON.idea}</span>
        <span class="grow"><span class="t">Got a new idea?</span><span class="s">Hand the phone over and let them tell it.</span></span>${ICON.chev}</a>
      ${!universes.length ? `<p class="soft" style="margin-top:18px">No universes yet. The first idea starts one.</p>` : ""}
      <p style="margin-top:36px"><button class="link" id="lockNow">Lock the app</button></p>`;
    $("#lockNow").onclick = () => { store.del("passcode"); route(); };
  };
  if (cache.universes) draw(cache.universes, cache.family);
  try {
    const [u, f] = await Promise.all([getUniverses(true), getFamily()]);
    await draftReviews(u.flatMap((x) => x.chapters ?? []));
    draw(u, f);
  } catch (e) { if (!cache.universes) handleLoadError(e, screenTonight); else if (e instanceof PasscodeError) { store.del("passcode"); route(); } else toast(e.message, true); }
}

// ---------- Library ----------

async function screenLibrary() {
  setTab("library");
  if (!cache.universes) loading();
  setDock("");
  const draw = (universes) => {
    const tab = store.get("libTab", "universes");
    const played = new Set(store.get("played", []));
    const episodes = universes.flatMap((u, ui) => sortedChapters(u).filter((c) => c.status === "produced").map((c) => ({ u, c, ui })));
    view.innerHTML = `
      <div class="title-block"><div class="kick">Library</div><h1>Our stories</h1></div>
      <div class="seg" id="libseg" style="margin-bottom:20px">
        <button data-t="universes" aria-pressed="${tab === "universes"}">Universes</button>
        <button data-t="episodes" aria-pressed="${tab === "episodes"}">Episodes</button></div>
      ${tab === "universes" ? `<div class="shelf">
          ${universes.map((u, i) => `<a class="book tap" href="#/u/${u.id}">${coverTile(u, i)}
            <span style="font:600 17px/1.15 var(--display)">${esc(u.title)}</span>
            <span class="bs">${(u.chapters ?? []).length} chapter${(u.chapters ?? []).length === 1 ? "" : "s"}</span></a>`).join("")}
          <a class="book tap" href="#/tell"><span class="new"><span class="icon-btn" style="width:52px;height:52px">${ICON.plus}</span>Start a new universe</span>
            <span class="bs">From a kid's idea</span></a></div>`
        : episodes.length ? `<div class="list">${episodes.map(({ u, c, ui }) => `
          <a class="card tap" href="#/play/${c.id}" style="display:flex;gap:14px;align-items:center;padding:12px 14px">${coverTile(u, ui, "small")}
            <span class="grow"><span style="display:block;font-weight:700">Chapter ${c.number}. ${esc(c.title)}</span>
            <span class="soft small" style="display:block">${esc(u.title)}${played.has(c.id) ? " · played" : ""}</span></span>
            <span class="mic" style="width:46px;height:46px" aria-hidden="true">${ICON.play.replace("<svg", '<svg width="20" height="20"')}</span></a>`).join("")}</div>`
        : `<div class="card"><p style="margin:0">No episodes yet.</p><p class="soft small" style="margin:6px 0 0">When a chapter is checked and recorded, it shows up here.</p></div>`}`;
    $$("#libseg [data-t]").forEach((b) => (b.onclick = () => { store.set("libTab", b.dataset.t); draw(universes); }));
  };
  if (cache.universes) draw(cache.universes);
  try { draw(await getUniverses(true)); }
  catch (e) { if (!cache.universes) handleLoadError(e, screenLibrary); else toast(e.message, true); }
}

// ---------- Universe ----------

async function screenUniverse(id) {
  setTab("library");
  loading();
  let u;
  try { await getUniverses().catch(() => null); u = await getUniverse(id); await draftReviews(u.chapters ?? []); }
  catch (e) { return handleLoadError(e, () => screenUniverse(id)); }
  const b = u.book ?? {};
  const chs = sortedChapters(u);
  const color = colorFor(universeIndex(id));
  const tint = { lake: "var(--lake-tint)", pine: "var(--pine-tint)", ember: "var(--ember-tint)", flame: "var(--flame-tint)" }[color];
  const solid = { lake: "var(--lake)", pine: "var(--pine)", ember: "var(--ember)", flame: "var(--flame)" }[color];
  const quest = (b.quests ?? []).find((q) => q.status === "active") ?? (b.quests ?? [])[0];
  const qDone = quest?.done?.length ?? 0;
  const qTotal = qDone + (quest?.next?.length ?? 0);
  const family = u.characters.filter((c) => c.family_member_id).map((c) => c.name);
  const others = u.characters.filter((c) => !c.family_member_id).map((c) => c.name);
  const castLine = namesList([...family, ...others.slice(0, 1)]);
  const nextNumber = (chs.at(-1)?.number ?? 0) + 1;

  view.innerHTML = `
    <div class="uhead" style="background:${tint}">
      <span class="pc" style="width:220px;height:220px;right:-70px;top:-70px;background:${solid};opacity:.25"></span>
      <span class="pc" style="width:110px;height:110px;right:-36px;bottom:-56px;background:${solid};opacity:.4"></span>
      ${u.cover_url ? `<img class="inset" src="${esc(u.cover_url)}" alt="">` : ""}
      <div class="kick" style="margin-top:6px;color:var(--bark)">Universe</div>
      <h1>${esc(u.title)}</h1>
      ${castLine ? `<div class="cast">${esc(castLine)}</div>` : ""}
      ${qTotal ? `<div class="dots" title="${esc(quest.goal)}">${Array.from({ length: qTotal }, (_, i) => `<i class="${i < qDone ? "on" : ""}"></i>`).join("")}
        <span>${qDone} of ${qTotal} quest steps</span></div>` : ""}
    </div>
    ${(u.pending_book_updates ?? []).map((p) => `
      <div class="card tint-flame stack" style="margin-top:18px">
        <div class="kick" style="color:var(--bark)">Universe book update waiting</div>
        <ul style="margin:0;padding-left:20px">${(p.changes ?? []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <button class="btn quiet small" data-accept="${p.id}">Accept the update</button></div>`).join("")}
    <div class="section-head"><h2>Chapters</h2></div>
    <div class="list">
      ${chs.map((c) => {
        const st = listStage(c);
        return `<a class="card tap ${c.status !== "produced" ? "current" : ""}" href="${c.status === "produced" ? `#/play/${c.id}` : `#/c/${c.id}`}">
          <div class="chrow"><span class="grow"><span class="t">${c.number}. ${esc(c.title ?? "Untitled")}</span>
            <span class="soft small" style="display:block">${c.brief?.main_kid ? `For ${esc(c.brief.main_kid)}` : ""}${c.brief?.bedtime ? " · bedtime" : ""}</span></span>
            <span class="badge ${st.next.tone}">${esc(st.next.label)}</span></div>${pathHtml(st)}</a>`;
      }).join("")}
      <div class="card dashed"><span style="font-weight:700">${nextNumber}. Not told yet</span>
        <span class="soft small" style="display:block;margin-top:2px">${quest?.next?.[0] ? `Next on the quest: ${esc(quest.next[0])}` : "Whatever happens next is up to the kids."}</span></div>
    </div>
    <div class="section-head" id="voices"><h2>Who reads it</h2><button class="link" id="changeVoices">Change</button></div>
    <div class="card" id="cast"></div>
    <div class="section-head"><h2>Cover</h2></div>
    <div class="card stack">
      <label class="field"><span>Art style</span><input type="text" id="style" value="${esc(u.art_style)}"></label>
      <button class="btn quiet" id="newCover">${u.cover_url ? "Paint a new cover" : "Paint a cover"}</button>
      <p class="soft small" style="margin:0">One picture, about 30 to 60 seconds.</p>
    </div>
    <div class="section-head"><h2>Universe book</h2></div>
    <details class="card"><summary class="row" style="justify-content:space-between;min-height:32px"><b>Setting, rules and the story so far</b>${ICON.chev}</summary>
      <div class="stack small" style="margin-top:12px">
        ${b.premise ? `<p><b>Premise.</b> ${esc(b.premise)}</p>` : ""}
        ${b.setting ? `<p><b>Setting.</b> ${esc(b.setting)}</p>` : ""}
        ${b.tone ? `<p><b>Tone.</b> ${esc(b.tone)}</p>` : ""}
        ${b.world_rules?.length ? `<div><b>World rules</b><ul>${b.world_rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
        ${b.story_so_far?.length ? `<div><b>Story so far</b><ul>${b.story_so_far.map((s) => `<li>Chapter ${s.chapter}: ${esc(s.summary)}</li>`).join("")}</ul></div>` : ""}
        ${b.open_threads?.length ? `<div><b>Open threads</b><ul>${b.open_threads.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
        ${b.lessons_taught?.length ? `<div><b>Lessons taught</b><ul>${b.lessons_taught.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
      </div></details>`;

  setDock(`${backBtn("#/library")}<a class="btn" href="#/u/${id}/write">What happens next?</a>`);

  const voiceName = (vid) => cache.voices?.find((v) => v.id === vid)?.name;
  const drawCast = () => {
    $("#cast").innerHTML = `
      <div class="vrow" style="border-top:0;padding-top:0"><span>Narrator</span><span class="vp">${u.narrator_voice_id ? esc(voiceName(u.narrator_voice_id) ?? "Chosen") : "Not chosen yet"}</span></div>
      ${u.characters.map((c) => `<div class="vrow"><span>${esc(c.name)}</span><span class="vp">${c.voice_id ? esc(voiceName(c.voice_id) ?? "Own voice") : "Narrator's voice"}</span></div>`).join("")}
      ${!u.narrator_voice_id ? `<p class="small" style="margin:12px 0 0">Pick a narrator before recording.</p>` : ""}`;
  };
  drawCast();
  if (cache.voices) drawCast();

  $$("[data-accept]").forEach((btn) => (btn.onclick = () => attempt(async () => {
    await busy([{ label: "Updating the universe book", run: () => story("accept_book_update", { book_version_id: btn.dataset.accept }) }], { hint: "A few seconds." });
    toast("Universe book updated");
    screenUniverse(id);
  })));

  $("#newCover").onclick = () => attempt(async () => {
    await busy([{ label: "Painting a cover", run: () => produce("cover", { universe_id: id, style: $("#style").value.trim() || undefined }) }], { kicker: u.title });
    cache.universes = null;
    cache.covers = null;
    toast("New cover ready");
    screenUniverse(id);
  });

  $("#changeVoices").onclick = () => attempt(async () => {
    $("#changeVoices").disabled = true;
    cache.voices ??= await produce("list_voices");
    const voices = cache.voices;
    const opts = (sel) => `<option value="">${sel ? "Narrator's voice" : "Choose a voice"}</option>` +
      voices.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}${v.category && v.category !== "premade" ? ` (${esc(v.category)})` : ""}</option>`).join("");
    $("#cast").innerHTML = `<div class="stack">
      <label class="field"><span>Narrator</span><select id="v-narrator">${opts(false)}</select></label>
      ${u.characters.map((c, i) => `<label class="field"><span>${esc(c.name)}</span><select data-char="${i}">${opts(true)}</select></label>`).join("")}
      <button class="btn pine" id="saveVoices">Save voices</button></div>`;
    $("#v-narrator").value = u.narrator_voice_id ?? "";
    $$("[data-char]").forEach((s) => (s.value = u.characters[+s.dataset.char].voice_id ?? ""));
    $("#saveVoices").onclick = () => attempt(async () => {
      const narrator = $("#v-narrator").value;
      if (!narrator) return toast("Pick a narrator voice first", true);
      const map = {};
      $$("[data-char]").forEach((s) => { u.characters[+s.dataset.char].voice_id = s.value || null; if (s.value) map[u.characters[+s.dataset.char].name] = s.value; });
      await produce("cast_voices", { universe_id: id, narrator_voice_id: narrator, voices: map });
      u.narrator_voice_id = narrator;
      toast("Voices saved");
      drawCast();
      $("#changeVoices").disabled = false;
    });
  });
  if (location.hash.endsWith("#voices")) $("#voices")?.scrollIntoView();
}

// ---------- Studio (brief for the next chapter) ----------

async function screenStudio(id) {
  setTab("library");
  loading();
  let u, fam;
  try { [u, fam] = await Promise.all([getUniverse(id), getFamily()]); }
  catch (e) { return handleLoadError(e, () => screenStudio(id)); }
  let kids = kidsOldestFirst(fam);
  const pending = store.get("pendingIdea");
  const pendingHere = pending && (!pending.universe_id || pending.universe_id === id);
  const mainDefault = (pendingHere && pending.kid && kids.some((k) => k.name === pending.kid) ? pending.kid : "") || kids.find((k) => k.id === u.main_kid_id)?.name || "";
  const brief = { main_kid: mainDefault, length: "", real_life: [] };
  const next = (sortedChapters(u).at(-1)?.number ?? 0) + 1;

  view.innerHTML = `
    <div class="topbar"><div class="kick">${esc(u.title)}</div></div>
    <div class="title-block"><h1>Chapter ${next}</h1><p class="soft" style="margin:0">Tell the writer what this one needs.</p></div>
    <h2 style="margin-top:8px">Who is it for?</h2>
    <div class="chips" id="kids"></div>
    <div class="card" style="margin-top:20px;padding:10px 18px">
      <label class="switch"><span><b>Bedtime</b><br><span class="soft small">Calm, cozy, no cliffhanger</span></span>
        <input type="checkbox" id="bedtime" ${isBedtimeHour() ? "checked" : ""}></label></div>
    <h2>Length</h2>
    <div class="seg" id="len">${[["", "Auto"], ["short", "Short"], ["medium", "Medium"], ["long", "Long"]].map(([v, l]) =>
      `<button data-len="${v}" aria-pressed="${brief.length === v}">${l}</button>`).join("")}</div>
    <p class="soft small" style="margin-top:8px">Auto fits the listener's age.</p>
    <h2>The kid's idea</h2>
    <textarea id="idea" rows="4" placeholder="Leave empty to just carry on the story">${esc(pendingHere ? pending.text ?? "" : "")}</textarea>
    <h2>From real life</h2>
    <p class="soft small">Lessons, school topics, where Dad is this week. Woven in, never a lecture.</p>
    <div class="row"><input type="text" id="rlInput" class="grow" placeholder="e.g. Dad is in Chile this week" enterkeyhint="done">
      <button class="btn quiet small" id="rlAdd">Add</button></div>
    <div class="chips" id="rl" style="margin-top:10px"></div>
    <h2>Notes for the writer</h2>
    <textarea id="notes" rows="3" placeholder="Optional"></textarea>`;

  const drawKids = () => {
    $("#kids").innerHTML = kids.map((k) => `<button class="chip" data-kid="${esc(k.name)}" aria-pressed="${brief.main_kid === k.name}">${esc(k.name)}</button>`).join("") +
      `<button class="chip add" id="addKid">+ Add someone</button>`;
    $$("#kids [data-kid]").forEach((b) => (b.onclick = () => {
      brief.main_kid = brief.main_kid === b.dataset.kid ? "" : b.dataset.kid;
      $$("#kids [data-kid]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.kid === brief.main_kid));
    }));
    $("#addKid").onclick = async () => {
      const m = await personSheet(null, "kid");
      if (!m) return;
      try { kids = kidsOldestFirst(await getFamily(true)); } catch { if (m.role === "kid") kids = [...kids, m]; }
      if (m.role === "kid") brief.main_kid = m.name;
      drawKids();
    };
  };
  const drawRealLife = () => {
    $("#rl").innerHTML = brief.real_life.map((r, i) => `<button class="chip tag" data-rm="${i}" aria-label="Remove ${esc(r)}">${esc(r)} ✕</button>`).join("");
    $$("[data-rm]").forEach((b) => (b.onclick = () => { brief.real_life.splice(+b.dataset.rm, 1); drawRealLife(); }));
  };
  drawKids();
  drawRealLife();
  $$("#len [data-len]").forEach((b) => (b.onclick = () => {
    brief.length = b.dataset.len;
    $$("#len [data-len]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  }));
  const addRl = () => { const v = $("#rlInput").value.trim(); if (v) { brief.real_life.push(v); $("#rlInput").value = ""; drawRealLife(); } };
  $("#rlAdd").onclick = addRl;
  $("#rlInput").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addRl(); } };

  setDock(`${backBtn(`#/u/${id}`)}<button class="btn" id="write">Write chapter ${next}</button>`);
  $("#write").onclick = () => attempt(async () => {
    if ($("#rlInput").value.trim()) addRl();
    const payload = {
      main_kid: brief.main_kid || undefined,
      bedtime: $("#bedtime").checked,
      length: brief.length || undefined,
      idea: $("#idea").value.trim() || undefined,
      real_life: brief.real_life.length ? brief.real_life : undefined,
      notes: $("#notes").value.trim() || undefined,
    };
    let chapterId = null;
    try {
      await busy([
        { label: `Writing chapter ${next}`, run: async () => { const ch = await story("write_chapter", { universe_id: id, brief: payload }); chapterId = ch.id; store.del("pendingIdea"); return ch; } },
        { label: "Grown-up check", run: (ch) => story("review_chapter", { chapter_id: ch.id }) },
      ], { title: `Writing chapter ${next}`, kicker: u.title, kid: brief.main_kid || kids[0]?.name, hint: "About a minute or two. You can set the phone down." });
    } finally {
      cache.universes = null;
      if (chapterId) location.hash = `#/c/${chapterId}`;
    }
  });
}

// ---------- Chapter (the next step on the path) ----------

async function screenChapter(id) {
  setTab("library");
  loading();
  let ch, u;
  try { await getUniverses().catch(() => null); ({ ch, u } = await getChapterFull(id)); }
  catch (e) { return handleLoadError(e, () => screenChapter(id)); }
  const r = ch.review;
  reviewCache.set(ch.id, r ?? null);
  const st = stageOf(ch, r);
  const script = ch.script ?? [];
  const chars = script.reduce((n, l) => n + l.text.length, 0);
  const minutes = Math.max(1, Math.round(chars / 900));
  const flagged = new Set((r?.reasons ?? []).filter((x) => Number.isInteger(x.line)).map((x) => x.line));
  const main = ch.brief?.main_kid;
  const pending = u.pending_book_updates ?? [];
  const status = ch.status;

  const checkCard = () => {
    if (!r) return "";
    const s = r.scores ?? {};
    const checks = [
      [ch.brief?.bedtime ? "Calm, sleepy ending" : "Not too scary", (s.scariness ?? 5) <= 2 && (!ch.brief?.bedtime || (s.stimulation ?? 5) <= 2)],
      [`Right for ${main ? `${esc(main)}` : "the kids"}`, (s.age_fit ?? 0) >= 4],
      ["Fits our family's values", (s.values_fit ?? 0) >= 4],
    ];
    const tone = r.verdict === "pass" ? "tint-pine" : r.verdict === "fix" ? "tint-flame" : "tint-ember";
    const head = r.verdict === "pass" ? (ch.brief?.bedtime ? "Gentle enough for bedtime" : "Ready for daytime")
      : r.verdict === "fix" ? "The check found something to fix" : "This one can't be approved";
    return `<div class="card ${tone} stack">
      <h3>${head}</h3>
      ${checks.map(([t, ok]) => `<div class="chk"><span class="m ${ok ? "" : "warn"}">${ok ? ICON.check : ICON.bang}</span>${t}</div>`).join("")}
      ${(r.reasons ?? []).map((x) => `<div class="note"><span class="badge ${x.severity === "high" ? "ember" : x.severity === "medium" ? "flame" : ""}" style="background:var(--white)">${esc(x.severity === "low" ? "Small" : x.severity === "medium" ? "Medium" : "Big")}</span>
        <span class="grow">${esc(x.issue)}${Number.isInteger(x.line) ? `<button class="lnk" data-line="${x.line}">See line ${x.line}</button>` : ""}</span></div>`).join("")}
      ${r.fix_instructions ? `<div class="note"><span class="grow"><b>Suggested fix:</b> ${esc(r.fix_instructions)}</span></div>` : ""}
    </div>`;
  };

  const endLines = script.slice(-3);
  view.innerHTML = `
    <div class="topbar"><div class="kick">${esc(u.title)} · Chapter ${ch.number}</div></div>
    <div class="title-block"><h1 style="font-size:34px">${esc(ch.title ?? "Untitled")}</h1>
      <div class="chips">${main ? `<span class="badge">For ${esc(main)}</span>` : ""}${ch.brief?.bedtime ? `<span class="badge">Bedtime</span>` : ""}<span class="badge">About ${minutes} min</span></div></div>
    ${pathHtml(st, true)}
    <div class="stack" style="margin-top:22px">
      ${!r && status === "draft" ? `<div class="card tint-flame"><h3>Not checked yet</h3><p class="small" style="margin:6px 0 0">Every chapter gets a grown-up check for scariness, bedtime calm, age fit and family values before anyone hears it.</p></div>` : ""}
      ${status !== "approved" && status !== "produced" ? checkCard() : ""}
      ${status === "approved" && pending.length ? pending.map((p) => `<div class="card tint-flame stack">
        <div class="kick" style="color:var(--bark)">Universe book update waiting</div>
        <ul style="margin:0;padding-left:20px" class="small">${(p.changes ?? []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <button class="btn quiet small" data-accept="${p.id}">Accept the update</button></div>`).join("") : ""}
      ${status === "approved" ? `<div class="card" id="readers">
          <div class="row" style="justify-content:space-between;padding-bottom:8px"><h3>Who reads it</h3><a class="link" href="#/u/${u.id}#voices">Change</a></div>
          ${["NARRATOR", ...new Set(script.map((l) => l.speaker).filter((s) => s !== "NARRATOR"))].map((sp) => {
            const c = u.characters.find((x) => x.name === sp);
            const label = sp === "NARRATOR" ? (u.narrator_voice_id ? "Chosen" : "Not chosen yet") : c?.voice_id ? "Own voice" : "Narrator's voice";
            return `<div class="vrow"><span>${esc(speakerLabel(sp))}</span><span class="vp">${label}</span></div>`;
          }).join("")}</div>
        <p class="soft small" style="margin:0">About ${minutes} minutes. Uses roughly ${chars.toLocaleString()} of this month's 90,000 voice credits.</p>
        ${!u.narrator_voice_id ? `<div class="card tint-flame"><b>Pick a narrator first.</b> <a href="#/u/${u.id}#voices">Choose voices</a></div>` : ""}` : ""}
      ${ch.preview_url && status !== "produced" ? `<div class="card stack"><div class="kick">Short sample</div>
        <audio controls preload="none" src="${esc(ch.preview_url)}" style="width:100%"></audio></div>` : ""}
      ${endLines.length ? `<div class="card stack"><div class="kick">How it ends</div>
        ${endLines.map((l) => `<p class="story">${scriptText(l.text)}</p>`).join("")}
        <details id="full"><summary><span class="link" style="display:inline-flex;align-items:center">Read the whole chapter</span></summary>
          <div class="script">${script.map((l, i) => `<div class="line ${flagged.has(i) ? "flag" : ""}" id="line-${i}">
            <span class="no">${i}</span><span class="who">${esc(speakerLabel(l.speaker))}</span><p class="story">${scriptText(l.text)}</p></div>`).join("")}</div></details></div>` : ""}
    </div>`;

  $$("[data-line]").forEach((b) => (b.onclick = () => {
    $("#full").open = true;
    const el = $(`#line-${b.dataset.line}`);
    if (!el) return;
    $$(".line.focus").forEach((x) => x.classList.remove("focus"));
    el.classList.add("focus");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  $$("[data-accept]").forEach((btn) => (btn.onclick = () => attempt(async () => {
    await busy([{ label: "Updating the universe book", run: () => story("accept_book_update", { book_version_id: btn.dataset.accept }) }], { hint: "A few seconds." });
    toast("Universe book updated");
    screenChapter(id);
  })));

  const checkStep = { label: "Grown-up check", run: () => story("review_chapter", { chapter_id: id }) };
  const revise = (needNotes) => attempt(async () => {
    const feedback = await notesSheet({
      title: needNotes ? "Ask for a change" : "Fix it",
      intro: needNotes ? null : "The check's suggested fix is included. Add anything else you want changed.",
      ok: "Rewrite and check again", required: needNotes && !r?.fix_instructions,
    });
    if (feedback === null) return;
    if (!feedback && !r?.fix_instructions) return toast("Add a note about what should change", true);
    await busy([{ label: "Rewriting the chapter", run: () => story("revise_chapter", { chapter_id: id, feedback: feedback || undefined }) }, checkStep],
      { title: "Rewriting the chapter", kicker: `${u.title} · Chapter ${ch.number}`, kid: main });
    cache.universes = null;
    screenChapter(id);
  });
  const approve = (override) => attempt(async () => {
    if (override) {
      const ok = await confirmSheet({ title: "Keep it anyway?", body: "The check asked for a fix. As the parent you can approve it as it is. This is noted.", ok: "Keep it anyway", cancel: "Go back" });
      if (!ok) return;
    }
    const out = await busy([{ label: "Approving and updating the universe book", run: () => story("approve_chapter", { chapter_id: id, override: override || undefined }) }],
      { kicker: `${u.title} · Chapter ${ch.number}`, hint: "The universe book remembers what happened, so later chapters stay consistent. About a minute." });
    cache.universes = null;
    const accept = await confirmSheet({
      title: "Update the universe book?",
      body: `<ul style="margin:0;padding-left:20px">${(out.changes ?? []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`,
      ok: "Accept the update", cancel: "Later",
    });
    if (accept && out.book_version_id) await busy([{ label: "Updating the universe book", run: () => story("accept_book_update", { book_version_id: out.book_version_id }) }], { hint: "A few seconds." });
    screenChapter(id);
  });
  const record = (sample) => attempt(async () => {
    if (!u.narrator_voice_id) { location.hash = `#/u/${u.id}#voices`; return toast("Pick a narrator voice first", true); }
    if (!sample) {
      const ok = await confirmSheet({ title: "Record the whole chapter?", body: `About ${minutes} minutes of audio, roughly ${chars.toLocaleString()} voice credits. Takes up to two minutes.`, ok: "Record it" });
      if (!ok) return;
    }
    await busy([{ label: sample ? "Recording a short sample" : "Recording the chapter", run: () => produce("narrate", { chapter_id: id, max_lines: sample ? 8 : undefined }) }],
      { kicker: `${u.title} · Chapter ${ch.number}`, hint: sample ? "About 20 to 40 seconds." : "Every character gets their own voice. Up to two minutes." });
    cache.universes = null;
    if (sample) { toast("Sample ready"); screenChapter(id); } else location.hash = `#/play/${id}`;
  });

  const back = backBtn(`#/u/${u.id}`);
  if (!r && status === "draft") {
    setDock(`${back}<button class="btn" id="a">Run the grown-up check</button>`);
    $("#a").onclick = () => attempt(async () => { await busy([checkStep], { kicker: u.title, hint: "Usually under a minute." }); screenChapter(id); });
  } else if (status === "draft" && r?.verdict === "pass") {
    setDock(`${back}<div class="col"><button class="link" id="b">Ask for a change</button><button class="btn" id="a">Approve chapter</button></div>`);
    $("#a").onclick = () => approve(false);
    $("#b").onclick = () => revise(true);
  } else if (status === "needs_fix") {
    setDock(`${back}<div class="col"><button class="link" id="b">Keep it anyway</button><button class="btn" id="a">Fix it</button></div>`);
    $("#a").onclick = () => revise(false);
    $("#b").onclick = () => approve(true);
  } else if (status === "blocked") {
    setDock(`${back}<button class="btn" id="a">Rewrite it</button>`);
    $("#a").onclick = () => revise(true);
  } else if (status === "approved") {
    setDock(`${back}<div class="col"><button class="link" id="b">Hear a short sample first</button><button class="btn" id="a">Record it for tonight</button></div>`);
    $("#a").onclick = () => record(false);
    $("#b").onclick = () => record(true);
  } else if (status === "produced") {
    setDock(`${back}<a class="btn" href="#/play/${id}">${ICON.play.replace("<svg", '<svg width="20" height="20"')}Play</a>`);
  } else {
    setDock(back);
  }
}

// ---------- Tell ----------

const tellDraft = () => store.get("capture", { kid: "", text: "", restated: null, target: null });
const saveTell = (d) => store.set("capture", d);

async function screenTell() {
  setTab("tell");
  loading();
  let fam, universes;
  try { [fam, universes] = await Promise.all([getFamily(), getUniverses()]); }
  catch (e) { return handleLoadError(e, screenTell); }
  let people = familyOrdered(fam);
  const d = { target: null, ...tellDraft() };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;

  const draw = () => {
    const r = d.restated;
    const sorted = r ? [...universes].sort((a, b) => (b.title === r.best_universe) - (a.title === r.best_universe)) : universes;
    if (r && !d.target) d.target = r.best_universe === "NEW" || !sorted.length ? "NEW" : sorted[0].id;
    view.innerHTML = `
      <div class="title-block"><div class="kick">Tell</div><h1>Who's telling?</h1></div>
      <div class="people" id="people" role="group" aria-label="Who's telling">
        ${people.map((m, i) => `<button class="person" data-kid="${esc(m.name)}" aria-pressed="${d.kid === m.name}">${avatar(m, i)}${esc(m.name)}</button>`).join("")}
        <button class="person" id="addPerson"><span class="av add" aria-hidden="true">+</span>Add</button>
      </div>
      <div class="card stack" style="margin-top:16px">
        <div class="kick" style="color:${rec ? "var(--pine)" : "var(--bark-soft)"}">${rec ? `Listening${d.kid ? ` to ${esc(d.kid)}` : ""}` : "The idea"}</div>
        <label><span class="hidden">The idea</span><textarea id="idea" class="story-input" rows="5" placeholder="Tap the mic and let them talk, or type it here.">${esc(d.text)}</textarea></label>
      </div>
      ${r ? `
        <div class="section-head"><h2>Said back${d.kid ? ` to ${esc(d.kid)}` : ""}</h2></div>
        <div class="card stack">
          <p style="font:500 21px/1.35 var(--display);margin:0" class="say-back">${esc(r.for_kid)}</p>
          <div class="row"><button class="btn quiet small" id="readAloud">${ICON.speak} Read it aloud</button></div>
          <p class="soft small" style="margin:0">${esc(r.for_parent)}</p>
        </div>
        <div class="section-head"><h2>Where does it go?</h2></div>
        <div class="list" role="radiogroup" aria-label="Where does it go" style="gap:10px">
          ${sorted.map((u) => `<button class="radio" role="radio" data-target="${u.id}" aria-checked="${d.target === u.id}"><i></i>${esc(u.title)}, chapter ${(sortedChapters(u).at(-1)?.number ?? 0) + 1}${u.title === r.best_universe ? `<span class="fit">Best fit</span>` : ""}</button>`).join("")}
          <button class="radio" role="radio" data-target="NEW" aria-checked="${d.target === "NEW"}"><i></i>A brand new universe${r.best_universe === "NEW" ? `<span class="fit">Best fit</span>` : ""}</button>
        </div>
        <p style="margin-top:20px"><button class="link" id="clear">Clear and start over</button></p>` : ""}`;

    $$("#people [data-kid]").forEach((b) => (b.onclick = () => { d.kid = d.kid === b.dataset.kid ? "" : b.dataset.kid; saveTell(d); draw(); }));
    $("#addPerson").onclick = async () => {
      const m = await personSheet(null, "kid");
      if (!m) return;
      try { people = familyOrdered(await getFamily(true)); } catch { people = [...people, m]; }
      d.kid = m.name; saveTell(d); draw();
    };
    const ta = $("#idea");
    ta.oninput = () => { d.text = ta.value; saveTell(d); syncDock(); };
    if (r) {
      $("#readAloud").onclick = () => {
        if (!("speechSynthesis" in window)) return toast("This browser can't read aloud.");
        speechSynthesis.cancel();
        const ut = new SpeechSynthesisUtterance(r.for_kid);
        ut.rate = 0.92;
        speechSynthesis.speak(ut);
      };
      $$("[data-target]").forEach((b) => (b.onclick = () => { d.target = b.dataset.target; saveTell(d); draw(); }));
      $("#clear").onclick = () => { Object.assign(d, { kid: d.kid, text: "", restated: null, target: null }); saveTell(d); draw(); };
    }
    drawDock();
  };

  const syncDock = () => { const b = $("#sayBack"); if (b) b.disabled = !d.text.trim(); };
  const micBtn = (primary) => SR ? `<button class="mic ${rec ? "on" : primary ? "" : "dark"}" id="mic" aria-label="${rec ? "Stop listening" : "Start listening"}">${rec ? ICON.stop : ICON.mic}</button>` : "";
  const drawDock = () => {
    const r = d.restated;
    if (!r) {
      setDock(`${micBtn(true)}<button class="btn dark" id="sayBack" ${d.text.trim() ? "" : "disabled"}>Say it back</button>`);
      $("#sayBack").onclick = sayBack;
    } else {
      const target = universes.find((u) => u.id === d.target);
      const label = d.target === "NEW" || !target ? "Start this universe" : `Write chapter ${(sortedChapters(target).at(-1)?.number ?? 0) + 1}`;
      setDock(`${micBtn(false)}<button class="btn" id="go">${esc(label)}</button>`);
      $("#go").onclick = go;
    }
    if (SR) $("#mic").onclick = toggleMic;
  };

  const sayBack = () => attempt(async () => {
    if (rec) rec.stop();
    d.restated = await busy([{ label: "Listening to the idea", run: () => story("restate_idea", { text: d.text, kid: d.kid || undefined }) }], { hint: "Usually 10 to 20 seconds." });
    d.target = null;
    saveTell(d);
    draw();
    requestAnimationFrame(() => $(".say-back")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  });

  const go = () => attempt(async () => {
    const r = d.restated;
    if (d.target && d.target !== "NEW") {
      store.set("pendingIdea", { text: r.for_parent, kid: d.kid, universe_id: d.target });
      saveTell({ kid: "", text: "", restated: null, target: null });
      location.hash = `#/u/${d.target}/write`;
      return;
    }
    const ok = await confirmSheet({ title: "Start a new universe?", body: "The world, the cast and a quest that can run for many chapters get written from this idea. About a minute.", ok: "Start it" });
    if (!ok) return;
    const out = await busy([{ label: "Building a new universe", run: () => story("create_universe", { idea: `${d.text}\n\nSummary: ${r.for_parent}`, main_kid: d.kid || undefined }) }],
      { kid: d.kid, hint: "About a minute. You can set the phone down." });
    cache.universes = null;
    store.set("pendingIdea", { text: r.for_parent, kid: d.kid, universe_id: out.universe.id });
    saveTell({ kid: "", text: "", restated: null, target: null });
    location.hash = `#/u/${out.universe.id}`;
    toast("New universe ready");
  });

  const toggleMic = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    const base = d.text ? d.text.replace(/\s*$/, " ") : "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      d.text = base + text;
      const ta = $("#idea");
      if (ta) ta.value = d.text;
      saveTell(d);
      syncDock();
    };
    rec.onerror = (e) => { if (e.error !== "aborted" && e.error !== "no-speech") toast(`Mic: ${e.error}`, true); };
    rec.onend = () => { rec = null; if (location.hash.startsWith("#/tell")) draw(); };
    rec.start();
    draw();
  };

  draw();
}

// ---------- Crew ----------

async function screenCrew() {
  setTab("crew");
  loading();
  let fam;
  try { fam = familyOrdered(await getFamily(true)); }
  catch (e) { return handleLoadError(e, screenCrew); }
  const draw = () => {
    view.innerHTML = `
      <div class="title-block"><div class="kick">Crew</div><h1>Our crew</h1>
        <p class="soft" style="margin:0">Everyone who can show up in a story. Tap someone to edit.</p></div>
      <div class="list" style="gap:10px">${fam.map((m, i) => {
        const a = ageOf(m);
        const sub = [m.role === "kid" ? (a !== null ? `${a} year${a === 1 ? "" : "s"} old` : "Kid") : m.role === "parent" ? "Grown-up" : "Other", m.notes].filter(Boolean).join(" · ");
        return `<button class="card tap" data-id="${m.id}" style="display:flex;gap:12px;align-items:center;text-align:left;font:inherit;color:inherit;padding:12px 14px;cursor:pointer;width:100%">
          ${avatar(m, i, "sm")}<span class="grow"><b style="display:block">${esc(m.name)}</b><span class="soft small">${esc(sub)}</span></span>${ICON.chev}</button>`;
      }).join("")}</div>`;
    $$("[data-id]").forEach((b) => (b.onclick = async () => {
      const m = fam.find((x) => x.id === b.dataset.id);
      const saved = await personSheet(m);
      if (saved) { try { fam = familyOrdered(await getFamily(true)); } catch { /* keep */ } draw(); }
    }));
  };
  draw();
  setDock(`<button class="btn" id="add">${ICON.plus.replace('width="24" height="24"', 'width="22" height="22"')}Add someone</button>`);
  $("#add").onclick = async () => {
    const m = await personSheet(null, "kid");
    if (m) { try { fam = familyOrdered(await getFamily(true)); } catch { fam = [...fam, m]; } draw(); }
  };
}

// ---------- Player (Night). The <audio> lives outside the view so playback continues. ----------

const now = { chapter: null, universe: null, sleepAt: null, sleepMin: 0 };
const SLEEP_STEPS = [0, 10, 20, 30];

function markPlayed(id) {
  const played = new Set(store.get("played", []));
  played.add(id);
  store.set("played", [...played].slice(-500));
}
audio.addEventListener("ended", () => { if (now.chapter) markPlayed(now.chapter.id); now.sleepAt = null; now.sleepMin = 0; });
audio.addEventListener("timeupdate", () => {
  if (now.sleepAt && Date.now() >= now.sleepAt) { fadeOutAndPause(); now.sleepAt = null; now.sleepMin = 0; }
  if (now.chapter) store.set("resume", { id: now.chapter.id, t: audio.currentTime });
});
function fadeOutAndPause() {
  const start = audio.volume;
  let v = start;
  const t = setInterval(() => {
    v -= 0.05;
    if (v <= 0) { clearInterval(t); audio.pause(); audio.volume = start; } else audio.volume = v;
  }, 150);
}
function setMediaSession(ch) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: `Chapter ${ch.number}. ${ch.title ?? ""}`,
    artist: ch.universe_title ?? "Story Universe",
    album: "Story Universe",
    artwork: ch.cover_url ? [{ src: ch.cover_url, sizes: "1024x1536", type: "image/png" }] : [],
  });
  navigator.mediaSession.setActionHandler("play", () => audio.play());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("seekbackward", () => (audio.currentTime -= 15));
  navigator.mediaSession.setActionHandler("seekforward", () => (audio.currentTime += 15));
}

async function screenPlayer(id) {
  setTab("tonight");
  if (!id) {
    if (now.chapter) { location.hash = `#/play/${now.chapter.id}`; return; }
    store.set("libTab", "episodes");
    location.hash = "#/library";
    return;
  }
  loading();
  let ch, u;
  try {
    if (now.chapter?.id === id) ({ chapter: ch, universe: u } = now);
    else ({ ch, u } = await getChapterFull(id));
  } catch (e) { return handleLoadError(e, () => screenPlayer(id)); }
  const src = ch.audio_url || ch.preview_url;
  if (!src) {
    view.innerHTML = `<div class="title-block" style="padding-top:24dvh"><h1 style="font-size:30px">Not recorded yet</h1><p class="soft">This chapter hasn't been recorded.</p></div>`;
    setDock(`${backBtn(`#/c/${id}`)}<a class="btn" href="#/c/${id}">Open the chapter</a>`);
    return;
  }
  if (now.chapter?.id !== id) {
    now.chapter = ch;
    now.universe = u;
    audio.src = src;
    const resume = store.get("resume");
    if (resume?.id === id && resume.t > 5) audio.addEventListener("loadedmetadata", () => (audio.currentTime = resume.t), { once: true });
    setMediaSession(ch);
  }
  const nextCh = sortedChapters(u).find((c) => c.number > ch.number && c.status === "produced");
  document.body.classList.add("night");
  setDock("");
  view.innerHTML = `
    <div class="glow" aria-hidden="true"></div>
    <div class="player">
      <div class="top"><a class="icon-btn" href="#/u/${u.id}" aria-label="Close player">${ICON.close}</a>
        <div class="kick">${esc(dayKicker())}${!ch.audio_url ? " · sample" : ""}</div><span style="width:48px"></span></div>
      <div class="mid">
        ${ch.cover_url ? `<img class="art" src="${esc(ch.cover_url)}" alt="">` : ""}
        <h1>${esc(u.title)}</h1>
        <div style="font-size:17px;color:rgba(251,243,228,.9)">Chapter ${ch.number}. ${esc(ch.title)}</div>
        <button class="big-play" id="pp" aria-label="Play">${ICON.play}</button>
        <div class="prog"><input type="range" id="seek" min="0" max="1000" value="0" aria-label="Position">
          <div class="times"><span id="cur">0:00</span><span id="dur">0:00</span></div></div>
      </div>
      <div class="pills">
        <button class="pill" id="rew" aria-label="Back 15 seconds">Back 15</button>
        <button class="pill" id="sleep">Sleep timer off</button>
        <button class="pill" id="fwd" aria-label="Ahead 15 seconds">Ahead 15</button>
      </div>
      ${nextCh ? `<a class="upnext" href="#/play/${nextCh.id}">Up next: Chapter ${nextCh.number}</a>` : ""}
    </div>`;

  const pp = $("#pp"), seek = $("#seek"), cur = $("#cur"), dur = $("#dur"), sleepBtn = $("#sleep");
  const sync = () => {
    if (!document.body.contains(pp)) return detach();
    pp.innerHTML = audio.paused ? ICON.play : ICON.pause;
    pp.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
    cur.textContent = fmtTime(audio.currentTime);
    dur.textContent = fmtTime(audio.duration);
    if (audio.duration && !seek.matches(":active")) seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
    sleepBtn.textContent = now.sleepAt ? `Sleep in ${Math.max(1, Math.ceil((now.sleepAt - Date.now()) / 60000))} min` : "Sleep timer off";
    sleepBtn.classList.toggle("on", !!now.sleepAt);
  };
  const evs = ["play", "pause", "timeupdate", "loadedmetadata", "ended"];
  const detach = () => evs.forEach((e) => audio.removeEventListener(e, sync));
  evs.forEach((e) => audio.addEventListener(e, sync));
  sync();

  pp.onclick = () => (audio.paused ? audio.play().catch((e) => toast(e.message, true)) : audio.pause());
  $("#rew").onclick = () => (audio.currentTime = Math.max(0, audio.currentTime - 15));
  $("#fwd").onclick = () => (audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15));
  seek.oninput = () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; };
  sleepBtn.onclick = () => {
    const i = SLEEP_STEPS.indexOf(now.sleepMin);
    now.sleepMin = SLEEP_STEPS[(i + 1) % SLEEP_STEPS.length];
    now.sleepAt = now.sleepMin ? Date.now() + now.sleepMin * 60_000 : null;
    sync();
  };
}

// ---------- Router ----------

async function route() {
  closeSheet();
  if (!store.get("passcode")) return screenLock();
  document.body.classList.remove("locked");
  const [path] = location.hash.replace(/^#/, "").split(/[?#]/);
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "play") document.body.classList.remove("night");
  window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
  if (!parts.length) return screenTonight();
  if (parts[0] === "library") return screenLibrary();
  if (parts[0] === "tell") return screenTell();
  if (parts[0] === "capture") { location.replace("#/tell"); return; }
  if (parts[0] === "crew") return screenCrew();
  if (parts[0] === "u" && parts[2] === "write") return screenStudio(parts[1]);
  if (parts[0] === "u") return screenUniverse(parts[1]);
  if (parts[0] === "c") return screenChapter(parts[1]);
  if (parts[0] === "play") return screenPlayer(parts[1]);
  location.hash = "#/";
}

window.addEventListener("hashchange", route);
route();

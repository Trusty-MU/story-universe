// Story Universe: phase 1 mobile web app.
// Static, no build step. Talks only to the `story` and `produce` Edge Functions.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $("#view");
const dock = $("#dock");
const sheet = $("#sheet");
const audio = $("#audio");

// ---------- Small utilities ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const ICON = {
  back: `<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>`,
  chev: `<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 5l7 7-7 7"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>`,
  mic: `<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>`,
  speak: `<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/></svg>`,
};

const STATUS_LABEL = {
  draft: "Draft", needs_fix: "Needs fix", blocked: "Blocked", approved: "Approved", produced: "Ready to play",
};

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isError ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ""), isError ? 6000 : 2800);
}

function coverImg(url, title, cls = "cover") {
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="Cover of ${esc(title)}" loading="lazy">`
    : `<div class="cover-ph ${cls === "cover" ? "" : cls}">${esc(title)}</div>`;
}

const sortedChapters = (u) => [...(u.chapters ?? [])].sort((a, b) => a.number - b.number);
const isBedtimeHour = () => { const h = new Date().getHours(); return h >= 17 || h < 6; };
const fmtTime = (s) => { if (!isFinite(s)) return "0:00"; s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// Render audio tags like [warmly] as quiet stage directions.
const scriptText = (t) => esc(t).replace(/\[([^\]]{1,40})\]/g, '<span class="atag">$1</span>');

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

// Light cache so tab switches feel instant; screens refresh in the background.
const cache = { universes: null, family: null, voices: null, covers: null };
async function getFamily() { return (cache.family ??= await familyApi("list")); }
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
// A universe with its cover URL.
async function getUniverse(id) {
  const [u, covers] = await Promise.all([story("get_universe", { universe_id: id }), getCovers()]);
  return { ...u, cover_url: covers[id] ?? null };
}
// A chapter with its universe, cover and signed audio URLs.
async function getChapterFull(id) {
  const [ch, m] = await Promise.all([story("get_chapter", { chapter_id: id }), produce("media", { chapter_id: id })]);
  cache.covers = m.covers;
  const u = await getUniverse(ch.universe_id);
  return { ch: { ...ch, audio_url: m.audio_url, preview_url: m.preview_url, cover_url: u.cover_url, universe_title: u.title }, u };
}

// ---------- Busy sheet (long AI calls take 30 to 90 s) ----------

let wakeLock = null;
async function holdAwake(on) {
  try {
    if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported or denied */ }
}

async function busy(steps) {
  // steps: [{ label, hint, run: async (prev) => result }]
  sheet.hidden = false;
  sheet.onclick = null;
  holdAwake(true);
  const start = Date.now();
  let result;
  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      sheet.innerHTML = `<div class="panel stack" role="alertdialog" aria-live="polite">
        <div class="row"><div class="spinner" aria-hidden="true"></div>
          <div class="grow"><div class="eyebrow">${steps.length > 1 ? `Step ${i + 1} of ${steps.length}` : "Working"}</div>
          <h3>${esc(s.label)}</h3></div></div>
        <p class="muted small">${esc(s.hint ?? "This can take up to a minute or two. Keep this screen open.")}</p>
        <p class="small muted">Elapsed <span class="elapsed">0:00</span></p></div>`;
      const el = $(".elapsed", sheet);
      const timer = setInterval(() => (el.textContent = fmtTime((Date.now() - start) / 1000)), 500);
      try { result = await s.run(result); } finally { clearInterval(timer); }
    }
    return result;
  } finally {
    sheet.hidden = true;
    sheet.innerHTML = "";
    holdAwake(false);
  }
}

function confirmSheet({ title, body, ok = "OK", cancel = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    sheet.hidden = false;
    sheet.innerHTML = `<div class="panel stack" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3>${body ? `<div class="muted">${body}</div>` : ""}
      <button class="btn ${danger ? "danger" : ""}" data-ok>${esc(ok)}</button>
      <button class="btn secondary" data-cancel>${esc(cancel)}</button></div>`;
    const done = (v) => { sheet.onclick = null; sheet.hidden = true; sheet.innerHTML = ""; resolve(v); };
    $("[data-ok]", sheet).onclick = () => done(true);
    $("[data-cancel]", sheet).onclick = () => done(false);
    sheet.onclick = (e) => { if (e.target === sheet) done(false); };
  });
}

// Add a family member. Resolves to the new member, or null if cancelled.
function addPersonSheet(presetRole = "kid") {
  return new Promise((resolve) => {
    let role = presetRole;
    sheet.hidden = false;
    sheet.innerHTML = `<form class="panel stack" role="dialog" aria-modal="true" aria-labelledby="ap-title" id="ap">
      <h3 id="ap-title">Add someone to the family</h3>
      <label class="field"><span>Name</span>
        <input type="text" id="ap-name" maxlength="40" autocomplete="off" autocapitalize="words" enterkeyhint="next" required></label>
      <div><span style="display:block;font-weight:600;margin-bottom:6px">Who are they?</span>
        <div class="seg" id="ap-role">${[["kid", "Kid"], ["parent", "Parent"], ["other", "Other"]].map(([v, l]) =>
          `<button type="button" data-role="${v}" aria-pressed="${v === role}">${l}</button>`).join("")}</div></div>
      <label class="field" id="ap-bm-wrap"><span>Birth month <span class="muted small">(optional, sets the story's age level)</span></span>
        <input type="month" id="ap-bm" max="${new Date().toISOString().slice(0, 7)}"></label>
      <label class="field"><span>Notes <span class="muted small">(optional)</span></span>
        <input type="text" id="ap-notes" maxlength="500" placeholder="e.g. Grandma, lives in Texas, loves birds"></label>
      <button class="btn" type="submit" id="ap-save">Add to family</button>
      <button class="btn secondary" type="button" data-cancel>Cancel</button></form>`;
    const done = (v) => { sheet.onclick = null; sheet.hidden = true; sheet.innerHTML = ""; resolve(v); };
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
      save.textContent = "Adding…";
      try {
        const member = await familyApi("add", {
          name, role,
          birth_month: role === "kid" ? $("#ap-bm", sheet).value || undefined : undefined,
          notes: $("#ap-notes", sheet).value.trim() || undefined,
        });
        cache.family = null;
        toast(`${member.name} added`);
        done(member);
      } catch (err) {
        if (err instanceof PasscodeError) { done(null); store.del("passcode"); return route(); }
        toast(err.message || String(err), true);
        save.disabled = false;
        save.textContent = "Add to family";
      }
    };
    setTimeout(() => $("#ap-name", sheet)?.focus(), 50);
  });
}

// Run an action with consistent error handling.
async function attempt(fn) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof PasscodeError) { store.del("passcode"); route(); return; }
    console.error(e);
    toast(e.message || String(e), true);
  }
}

// ---------- Layout helpers ----------

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
  view.innerHTML = `<div class="row" style="min-height:50dvh;justify-content:center"><div class="spinner" aria-label="Loading"></div></div>`;
}

function errorView(e, retry) {
  view.innerHTML = `<div class="stack" style="padding-top:30dvh"><h2>Something went wrong</h2>
    <p class="muted">${esc(e.message || e)}</p><button class="btn" id="retry">Try again</button></div>`;
  $("#retry").onclick = retry;
}

// ---------- Screens ----------

// Passcode
function screenLock(message = "") {
  document.body.classList.add("locked");
  setDock("");
  view.innerHTML = `<form class="lock" id="lock" autocomplete="on">
    <img class="mark" src="icon.svg" alt="">
    <div><h1>Story Universe</h1><p class="muted">Enter the family passcode to continue.</p></div>
    <input type="text" name="username" value="family" autocomplete="username" hidden>
    <label class="field"><span>Family passcode</span>
      <input type="password" id="pc" autocomplete="current-password" required autofocus></label>
    ${message ? `<p style="color:var(--block)">${esc(message)}</p>` : ""}
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

// Home / Library
async function screenLibrary() {
  setTab("library");
  setDock(`<a class="btn" href="#/capture">New story idea</a>`);
  if (!cache.universes) loading();
  const draw = (universes) => {
    const played = new Set(store.get("played", []));
    const upNext = [];
    const needsYou = [];
    for (const u of universes) {
      const chs = sortedChapters(u);
      const next = chs.find((c) => c.status === "produced" && !played.has(c.id));
      if (next) upNext.push({ u, c: next });
      for (const c of chs) if (c.status !== "produced") needsYou.push({ u, c });
    }
    const greeting = isBedtimeHour() ? "Good evening" : "Hello";
    view.innerHTML = `
      <div class="eyebrow">${greeting}</div>
      <h1>Story Universe</h1>
      ${upNext.length ? `<h2>Play next</h2><div class="list">${upNext.slice(0, 3).map(({ u, c }) => `
        <a class="next-up" href="#/play/${c.id}">
          ${coverImg(u.cover_url, u.title, "")}
          <div class="grow"><div class="small muted">${esc(u.title)}</div>
          <div class="t" style="font-weight:700">Chapter ${c.number}: ${esc(c.title)}</div></div>
          <span class="play-dot" aria-hidden="true">${ICON.play}</span></a>`).join("")}</div>` : ""}
      ${needsYou.length ? `<h2>Needs a parent</h2><div class="list">${needsYou.slice(0, 5).map(({ u, c }) => `
        <a class="item" href="#/c/${c.id}"><div class="grow"><div class="t">Chapter ${c.number}: ${esc(c.title ?? "Untitled")}</div>
        <div class="s">${esc(u.title)}</div></div><span class="badge ${c.status}">${STATUS_LABEL[c.status] ?? c.status}</span>${ICON.chev}</a>`).join("")}</div>` : ""}
      <h2>Universes</h2>
      ${universes.length ? `<div class="shelf">${universes.map((u) => {
        const chs = u.chapters ?? [];
        return `<a class="book" href="#/u/${u.id}">${coverImg(u.cover_url, u.title)}
          <div class="bt">${esc(u.title)}</div><div class="bs">${chs.length} chapter${chs.length === 1 ? "" : "s"}</div></a>`;
      }).join("")}</div>` : `<div class="card"><p>No universes yet.</p><p class="muted small">Tap “New story idea” to start the first one.</p></div>`}
      <p class="small muted" style="margin-top:32px"><button class="btn ghost small" id="lockNow">Lock app</button></p>`;
    $("#lockNow").onclick = () => { store.del("passcode"); route(); };
  };
  if (cache.universes) draw(cache.universes);
  try { draw(await getUniverses(true)); }
  catch (e) { if (e instanceof PasscodeError) { store.del("passcode"); return route(); } if (!cache.universes) errorView(e, screenLibrary); else toast(e.message, true); }
}

// Capture
const captureDraft = () => store.get("capture", { kid: "", text: "", restated: null });
const saveCapture = (d) => store.set("capture", d);

async function screenCapture() {
  setTab("capture");
  loading();
  let fam, universes;
  try { [fam, universes] = await Promise.all([getFamily(), getUniverses()]); }
  catch (e) { if (e instanceof PasscodeError) { store.del("passcode"); return route(); } return errorView(e, screenCapture); }
  let people = fam; // kids first, then parents and others (sorted by the family function)
  const d = captureDraft();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  const draw = () => {
    const r = d.restated;
    view.innerHTML = `
      <div class="eyebrow">Capture</div><h1>Whose idea is it?</h1>
      <div class="chips" style="margin-top:14px" id="kids">${people.map((k) =>
        `<button class="chip" aria-pressed="${d.kid === k.name}" data-kid="${esc(k.name)}">${esc(k.name)}</button>`).join("")}
        <button class="chip add" id="addPerson">+ Add someone</button></div>
      <h2>What's the idea?</h2>
      <label class="field"><span class="hidden">Idea</span>
        <textarea id="idea" rows="6" placeholder="Type it, tap the mic and let them talk, or use the keyboard's dictation.">${esc(d.text)}</textarea></label>
      ${r ? `
        <h2>Say it back</h2>
        <div class="card stack">
          <p class="say-back">${esc(r.for_kid)}</p>
          <button class="btn secondary small" id="readAloud">${ICON.speak.replace("<svg", '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"')} Read it aloud</button>
        </div>
        <div class="card stack" style="margin-top:12px">
          <div class="eyebrow">For you</div><p>${esc(r.for_parent)}</p>
          ${r.story_elements?.length ? `<div class="chips">${r.story_elements.map((s) => `<span class="chip tag">${esc(s)}</span>`).join("")}</div>` : ""}
        </div>
        <h2>Where should it go?</h2>
        <div class="list">
          ${[...universes].sort((a, b) => (b.title === r.best_universe) - (a.title === r.best_universe)).map((u) => `
            <a class="item" href="#/u/${u.id}/write?from=capture">${coverImg(u.cover_url, u.title, "thumb")}
              <div class="grow"><div class="t">Next chapter of ${esc(u.title)}</div>
              ${u.title === r.best_universe ? `<div class="s">Best fit</div>` : ""}</div>${ICON.chev}</a>`).join("")}
          <button class="item" id="newUniverse" style="font:inherit;color:inherit;text-align:left;width:100%">
            <div class="cover-ph thumb" style="font-size:24px">+</div>
            <div class="grow"><div class="t">Start a new universe</div>${r.best_universe === "NEW" ? `<div class="s">Best fit</div>` : ""}</div>${ICON.chev}</button>
        </div>
        <button class="btn ghost small" id="clear" style="margin-top:20px">Clear and start over</button>` : ""}`;

    $$("#kids [data-kid]").forEach((b) => (b.onclick = () => { d.kid = d.kid === b.dataset.kid ? "" : b.dataset.kid; d.restated = null; saveCapture(d); draw(); }));
    $("#addPerson").onclick = async () => {
      const m = await addPersonSheet("kid");
      if (!m) return;
      try { people = await getFamily(); } catch { people = [...people, m]; }
      d.kid = m.name; d.restated = null; saveCapture(d); draw();
    };
    const ta = $("#idea");
    ta.oninput = () => { d.text = ta.value; saveCapture(d); };
    if (r) {
      $("#readAloud").onclick = () => {
        if (!("speechSynthesis" in window)) return toast("This browser can't read aloud.");
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(r.for_kid);
        u.rate = 0.92;
        speechSynthesis.speak(u);
      };
      $("#newUniverse").onclick = () => attempt(async () => {
        const ok = await confirmSheet({
          title: "Start a new universe?",
          body: "Claude will design the world, the cast and an overall quest from this idea. It takes about a minute.",
          ok: "Create universe",
        });
        if (!ok) return;
        const out = await busy([{
          label: "Designing a new universe",
          run: () => story("create_universe", { idea: `${d.text}\n\nSummary: ${r.for_parent}`, main_kid: d.kid || undefined }),
        }]);
        cache.universes = null;
        store.set("pendingIdea", { text: r.for_parent, kid: d.kid });
        saveCapture({ kid: "", text: "", restated: null });
        location.hash = `#/u/${out.universe.id}`;
        toast("Universe created");
      });
      $("#clear").onclick = () => { saveCapture({ kid: "", text: "", restated: null }); Object.assign(d, captureDraft()); draw(); };
      $$('a[href*="from=capture"]').forEach((a) => (a.onclick = () => store.set("pendingIdea", { text: r.for_parent, kid: d.kid })));
    }
    drawDock();
  };

  let rec = null;
  const drawDock = () => {
    setDock(`${SR ? `<button class="icon-btn mic ${rec ? "on" : ""}" id="mic" aria-label="${rec ? "Stop listening" : "Dictate"}">${ICON.mic}</button>` : ""}
      <button class="btn" id="restate" ${d.text.trim() ? "" : "disabled"}>${d.restated ? "Say it back again" : "Say it back"}</button>`);
    $("#idea").addEventListener("input", () => ($("#restate").disabled = !d.text.trim()));
    if (SR) $("#mic").onclick = toggleMic;
    $("#restate").onclick = () => attempt(async () => {
      if (rec) rec.stop();
      d.restated = await busy([{
        label: "Listening to the idea",
        hint: "Usually 10 to 20 seconds.",
        run: () => story("restate_idea", { text: d.text, kid: d.kid || undefined }),
      }]);
      saveCapture(d);
      draw();
      requestAnimationFrame(() => $(".say-back")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    });
  };

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
      $("#idea").value = d.text;
      saveCapture(d);
    };
    rec.onerror = (e) => { if (e.error !== "aborted" && e.error !== "no-speech") toast(`Mic: ${e.error}`, true); };
    rec.onend = () => { rec = null; drawDock(); };
    rec.start();
    drawDock();
  };

  draw();
}

// Universe
async function screenUniverse(id) {
  setTab("library");
  loading();
  setDock(`${backBtn("#/")}<a class="btn" href="#/u/${id}/write">Write next chapter</a>`);
  let u;
  try { u = await getUniverse(id); }
  catch (e) { if (e instanceof PasscodeError) { store.del("passcode"); return route(); } return errorView(e, () => screenUniverse(id)); }
  const b = u.book ?? {};
  const chs = sortedChapters(u);
  view.innerHTML = `
    <div class="hero">${coverImg(u.cover_url, u.title)}
      <div class="grow"><div class="eyebrow">Universe</div><h1 style="font-size:26px">${esc(u.title)}</h1>
      <p class="small muted" style="margin-top:6px">${chs.length} chapter${chs.length === 1 ? "" : "s"}</p></div></div>
    ${u.pending_book_updates?.length ? u.pending_book_updates.map((p) => `
      <div class="card stack" style="margin-top:18px;border-color:var(--accent)">
        <div class="eyebrow">Universe book update waiting</div>
        <ul class="plain small">${(p.changes ?? []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <button class="btn small" data-accept="${p.id}">Accept update</button></div>`).join("") : ""}
    <p style="margin-top:18px">${esc(b.premise)}</p>
    <h2>Chapters</h2>
    ${chs.length ? `<div class="list">${chs.map((c) => `
      <a class="item" href="${c.status === "produced" ? `#/play/${c.id}` : `#/c/${c.id}`}">
        <div class="grow"><div class="t">${c.number}. ${esc(c.title ?? "Untitled")}</div>
        <div class="s">${c.brief?.main_kid ? `For ${esc(c.brief.main_kid)}` : ""}${c.brief?.bedtime ? " · bedtime" : ""}</div></div>
        <span class="badge ${c.status}">${STATUS_LABEL[c.status] ?? c.status}</span>${ICON.chev}</a>`).join("")}</div>`
      : `<p class="muted">No chapters yet. Tap “Write next chapter”.</p>`}
    ${b.quests?.length ? `<h2>Quest</h2>${b.quests.map((q) => `<div class="card stack" style="margin-bottom:10px">
      <div class="row"><h3 class="grow">${esc(q.goal)}</h3><span class="badge ${q.status === "complete" ? "pass" : ""}">${esc(q.status)}</span></div>
      ${q.done?.length ? `<ul class="plain small">${q.done.map((s) => `<li><s class="muted">${esc(s)}</s></li>`).join("")}</ul>` : ""}
      ${q.next?.length ? `<ul class="plain small">${q.next.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</div>`).join("")}` : ""}
    <h2>Cast and voices</h2>
    <div class="card stack" id="cast">
      <p class="small muted">Each character can have their own voice. The narrator voice is required before making audio.</p>
      <button class="btn secondary small" id="loadVoices">Choose voices</button>
    </div>
    <h2>Cover</h2>
    <div class="card stack">
      <label class="field"><span>Art style</span><input type="text" id="style" value="${esc(u.art_style)}"></label>
      <button class="btn secondary" id="newCover">${u.cover_url ? "Make a new cover" : "Make a cover"}</button>
      <p class="small muted">Uses one OpenAI image (about 30 to 60 seconds).</p>
    </div>
    <h2>Universe book</h2>
    <details class="card"><summary>Setting, rules and story so far</summary>
      <div class="stack small" style="margin-top:10px">
        ${b.setting ? `<p><b>Setting.</b> ${esc(b.setting)}</p>` : ""}
        ${b.tone ? `<p><b>Tone.</b> ${esc(b.tone)}</p>` : ""}
        ${b.world_rules?.length ? `<div><b>World rules</b><ul class="plain">${b.world_rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
        ${b.story_so_far?.length ? `<div><b>Story so far</b><ul class="plain">${b.story_so_far.map((s) => `<li>Ch. ${s.chapter}: ${esc(s.summary)}</li>`).join("")}</ul></div>` : ""}
        ${b.open_threads?.length ? `<div><b>Open threads</b><ul class="plain">${b.open_threads.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
        ${b.lessons_taught?.length ? `<div><b>Lessons taught</b><ul class="plain">${b.lessons_taught.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
      </div></details>`;

  $$("[data-accept]").forEach((btn) => (btn.onclick = () => attempt(async () => {
    await busy([{ label: "Updating the universe book", hint: "A few seconds.", run: () => story("accept_book_update", { book_version_id: btn.dataset.accept }) }]);
    toast("Universe book updated");
    screenUniverse(id);
  })));

  $("#newCover").onclick = () => attempt(async () => {
    await busy([{ label: "Painting a cover", run: () => produce("cover", { universe_id: id, style: $("#style").value.trim() || undefined }) }]);
    cache.universes = null;
    cache.covers = null;
    toast("New cover ready");
    screenUniverse(id);
  });

  $("#loadVoices").onclick = () => attempt(async () => {
    $("#loadVoices").disabled = true;
    cache.voices ??= await produce("list_voices");
    const voices = cache.voices;
    const opts = (sel) => `<option value="">${sel ? "Same as narrator" : "Choose a voice"}</option>` +
      voices.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}${v.category && v.category !== "premade" ? ` (${esc(v.category)})` : ""}</option>`).join("");
    $("#cast").innerHTML = `
      <label class="field"><span>Narrator</span><select id="v-narrator">${opts(false)}</select></label>
      ${u.characters.map((c, i) => `<label class="field"><span>${esc(c.name)}</span><select data-char="${i}">${opts(true)}</select></label>`).join("")}
      <button class="btn" id="saveVoices">Save voices</button>`;
    $("#v-narrator").value = u.narrator_voice_id ?? "";
    $$("[data-char]").forEach((s) => (s.value = u.characters[+s.dataset.char].voice_id ?? ""));
    $("#saveVoices").onclick = () => attempt(async () => {
      const narrator = $("#v-narrator").value;
      if (!narrator) return toast("Pick a narrator voice first", true);
      const map = {};
      $$("[data-char]").forEach((s) => { if (s.value) map[u.characters[+s.dataset.char].name] = s.value; });
      await produce("cast_voices", { universe_id: id, narrator_voice_id: narrator, voices: map });
      u.narrator_voice_id = narrator;
      toast("Voices saved");
    });
  });
}

// Chapter studio
async function screenStudio(id) {
  setTab("library");
  loading();
  let u, fam;
  try { [u, fam] = await Promise.all([getUniverse(id), getFamily()]); }
  catch (e) { if (e instanceof PasscodeError) { store.del("passcode"); return route(); } return errorView(e, () => screenStudio(id)); }
  let kids = fam.filter((m) => m.role === "kid");
  const pending = store.get("pendingIdea");
  const mainDefault = pending?.kid || kids.find((k) => k.id === u.main_kid_id)?.name || "";
  const brief = { main_kid: mainDefault, bedtime: isBedtimeHour(), length: "", idea: pending?.text ?? "", real_life: [], notes: "" };
  const next = (sortedChapters(u).at(-1)?.number ?? 0) + 1;

  const drawRealLife = () => {
    $("#rl").innerHTML = brief.real_life.map((r, i) => `<button class="chip tag" data-rm="${i}" aria-label="Remove ${esc(r)}">${esc(r)} ✕</button>`).join("");
    $$("[data-rm]").forEach((b) => (b.onclick = () => { brief.real_life.splice(+b.dataset.rm, 1); drawRealLife(); }));
  };

  view.innerHTML = `
    <div class="eyebrow">${esc(u.title)}</div><h1>Chapter ${next}</h1>
    <h2>Who is it for?</h2>
    <div class="chips" id="kids"></div>
    <div class="card" style="margin-top:20px">
      <label class="switch"><span><b>Bedtime</b><br><span class="small muted">Calm, cozy, no cliffhanger</span></span>
        <input type="checkbox" id="bedtime" ${brief.bedtime ? "checked" : ""}></label></div>
    <h2>Length</h2>
    <div class="seg" id="len">${[["", "Auto"], ["short", "Short"], ["medium", "Medium"], ["long", "Long"]].map(([v, l]) =>
      `<button data-len="${v}" aria-pressed="${brief.length === v}">${l}</button>`).join("")}</div>
    <p class="small muted" style="margin-top:6px">Auto picks a length for the listener's age.</p>
    <h2>Kid's idea</h2>
    <textarea id="idea" rows="4" placeholder="Leave empty to just continue the story">${esc(brief.idea)}</textarea>
    <h2>From real life</h2>
    <p class="small muted">Lessons, school topics, where Dad is traveling. Added naturally, never as a lecture.</p>
    <div class="row"><input type="text" id="rlInput" class="grow" placeholder="e.g. Dad is in Chile this week" enterkeyhint="done">
      <button class="btn secondary small" id="rlAdd">Add</button></div>
    <div class="chips" id="rl" style="margin-top:10px"></div>
    <h2>Notes for the writer</h2>
    <textarea id="notes" rows="3" placeholder="Optional"></textarea>`;
  drawRealLife();

  const drawKids = () => {
    $("#kids").innerHTML = kids.map((k) => `<button class="chip" data-kid="${esc(k.name)}" aria-pressed="${brief.main_kid === k.name}">${esc(k.name)}</button>`).join("") +
      `<button class="chip add" id="addKid">+ Add someone</button>`;
    $$("#kids [data-kid]").forEach((b) => (b.onclick = () => {
      brief.main_kid = brief.main_kid === b.dataset.kid ? "" : b.dataset.kid;
      $$("#kids [data-kid]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.kid === brief.main_kid));
    }));
    $("#addKid").onclick = async () => {
      const m = await addPersonSheet("kid");
      if (!m) return;
      try { kids = (await getFamily()).filter((x) => x.role === "kid"); } catch { if (m.role === "kid") kids = [...kids, m]; }
      if (m.role === "kid") brief.main_kid = m.name;
      drawKids();
    };
  };
  drawKids();
  $$("#len [data-len]").forEach((b) => (b.onclick = () => {
    brief.length = b.dataset.len;
    $$("#len [data-len]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  }));
  const addRl = () => { const v = $("#rlInput").value.trim(); if (v) { brief.real_life.push(v); $("#rlInput").value = ""; drawRealLife(); } };
  $("#rlAdd").onclick = addRl;
  $("#rlInput").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addRl(); } };

  setDock(`${backBtn(`#/u/${id}`)}<button class="btn" id="write">Write and review</button>`);
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
        { label: `Writing chapter ${next}`, hint: "Claude is writing with the universe book. Usually 30 to 90 seconds.",
          run: async () => { const ch = await story("write_chapter", { universe_id: id, brief: payload }); chapterId = ch.id; store.del("pendingIdea"); return ch; } },
        { label: "Safety and values review", hint: "Checking scariness, bedtime calm, age fit and family values.",
          run: (ch) => story("review_chapter", { chapter_id: ch.id }) },
      ]);
    } finally {
      cache.universes = null;
      if (chapterId) location.hash = `#/c/${chapterId}`;
    }
  });
}

// Review
async function screenReview(id) {
  setTab("library");
  loading();
  let ch, u;
  try { ({ ch, u } = await getChapterFull(id)); } catch (e) { if (e instanceof PasscodeError) { store.del("passcode"); return route(); } return errorView(e, () => screenReview(id)); }
  const r = ch.review;
  const verdict = r?.verdict ?? "none";
  const flagged = new Set((r?.reasons ?? []).filter((x) => Number.isInteger(x.line)).map((x) => x.line));
  const chars = (ch.script ?? []).reduce((n, l) => n + l.text.length, 0);
  const pendingUpdate = (u.pending_book_updates ?? []).length > 0;
  const VERDICT = {
    pass: ["Passed review", "Safe to approve. Any notes below are minor."],
    fix: ["Needs a fix", "The reviewer wants changes. Revise, or approve anyway if you disagree."],
    block: ["Blocked", "This can't be approved. Revise it, with your own notes if helpful."],
    none: ["Not reviewed yet", "Run the safety review before approving."],
  };
  const scoreRow = (label, v, invert) => {
    const goodness = invert ? 6 - v : v; // always show "more bar = better"
    return `<span>${label}</span><div class="meter" title="${v} of 5"><i style="width:${(goodness / 5) * 100}%"></i></div>`;
  };

  view.innerHTML = `
    <div class="eyebrow">${esc(u.title)} · Chapter ${ch.number}</div>
    <h1>${esc(ch.title ?? "Untitled")}</h1>
    <div class="chips" style="margin-top:10px">
      <span class="badge ${ch.status}">${STATUS_LABEL[ch.status] ?? ch.status}</span>
      ${ch.brief?.main_kid ? `<span class="badge">For ${esc(ch.brief.main_kid)}</span>` : ""}
      ${ch.brief?.bedtime ? `<span class="badge">Bedtime</span>` : ""}
      <span class="badge">${(ch.script ?? []).length} lines · ~${Math.round(chars / 900)} min</span></div>
    ${ch.brief?.summary ? `<p style="margin-top:14px">${esc(ch.brief.summary)}</p>` : ""}
    <div class="verdict ${verdict}" style="margin-top:16px">
      <h3>${VERDICT[verdict][0]}</h3><p class="small" style="margin:4px 0 0">${VERDICT[verdict][1]}</p>
      ${r?.scores ? `<div class="scores">
        ${scoreRow("Calm, not scary", r.scores.scariness, true)}
        ${scoreRow("Gentle energy", r.scores.stimulation, true)}
        ${scoreRow("Age fit", r.scores.age_fit)}
        ${scoreRow("Values fit", r.scores.values_fit)}
        ${scoreRow("Continuity", r.scores.continuity)}</div>` : ""}
      ${(r?.reasons ?? []).map((x) => `<div class="reason"><span class="badge ${x.severity === "high" ? "block" : x.severity === "medium" ? "fix" : ""}">${esc(x.severity)}</span>
        <div class="grow small">${esc(x.issue)} ${Number.isInteger(x.line) ? `<button data-line="${x.line}">Line ${x.line}</button>` : ""}</div></div>`).join("")}
      ${r?.fix_instructions ? `<p class="small" style="margin-top:10px"><b>Suggested fix:</b> ${esc(r.fix_instructions)}</p>` : ""}
    </div>
    ${ch.status !== "approved" && ch.status !== "produced" ? `
      <h2>Your notes</h2>
      <textarea id="feedback" rows="3" placeholder="Optional: what should change? e.g. make the owl less spooky"></textarea>` : ""}
    ${pendingUpdate && ch.status === "approved" ? `<div class="card stack" style="margin-top:20px;border-color:var(--accent)">
      <div class="eyebrow">Universe book update waiting</div>
      ${u.pending_book_updates.map((p) => `<ul class="plain small">${(p.changes ?? []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <button class="btn small" data-accept="${p.id}">Accept update</button>`).join("")}</div>` : ""}
    ${ch.status === "approved" && !u.narrator_voice_id ? `<div class="card" style="margin-top:20px"><p>Pick a narrator voice before making audio.</p>
      <a class="btn secondary small" href="#/u/${u.id}">Choose voices</a></div>` : ""}
    ${ch.preview_url && ch.status !== "produced" ? `<div class="card stack" style="margin-top:20px"><div class="eyebrow">Audio preview</div>
      <audio controls preload="none" src="${esc(ch.preview_url)}" style="width:100%"></audio></div>` : ""}
    <h2>Script</h2>
    <div class="script">${(ch.script ?? []).map((l, i) => `
      <div class="line ${l.speaker === "NARRATOR" ? "narrator" : ""} ${flagged.has(i) ? "flag" : ""}" id="line-${i}">
        <span class="no">${i}</span><div class="who">${esc(l.speaker === "NARRATOR" ? "Narrator" : l.speaker)}</div>
        <div>${scriptText(l.text)}</div></div>`).join("")}</div>`;

  $$("[data-line]").forEach((b) => (b.onclick = () => {
    const el = $(`#line-${b.dataset.line}`);
    if (!el) return;
    $$(".line.focus").forEach((x) => x.classList.remove("focus"));
    el.classList.add("focus");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  $$("[data-accept]").forEach((btn) => (btn.onclick = () => attempt(async () => {
    await busy([{ label: "Updating the universe book", hint: "A few seconds.", run: () => story("accept_book_update", { book_version_id: btn.dataset.accept }) }]);
    toast("Universe book updated");
    screenReview(id);
  })));

  const reviewStep = { label: "Safety and values review", hint: "Checking scariness, bedtime calm, age fit and family values.", run: () => story("review_chapter", { chapter_id: id }) };
  const revise = () => attempt(async () => {
    const feedback = $("#feedback")?.value.trim();
    if (!r?.fix_instructions && !feedback) { $("#feedback")?.focus(); return toast("Add a note about what should change", true); }
    await busy([{ label: "Revising the chapter", hint: "Keeping what works, changing what the notes ask. 30 to 90 seconds.", run: () => story("revise_chapter", { chapter_id: id, feedback: feedback || undefined }) }, reviewStep]);
    cache.universes = null;
    screenReview(id);
  });
  const approve = (override) => attempt(async () => {
    if (override) {
      const ok = await confirmSheet({ title: "Approve over the reviewer?", body: "The reviewer asked for a fix. You can approve anyway as the parent. This is recorded.", ok: "Approve anyway" });
      if (!ok) return;
    }
    const out = await busy([{ label: "Approving and updating the universe book", hint: "Claude records what happened so future chapters stay consistent. 30 to 90 seconds.", run: () => story("approve_chapter", { chapter_id: id, override: override || undefined }) }]);
    cache.universes = null;
    const accept = await confirmSheet({
      title: "Update the universe book?",
      body: `<ul class="plain small">${(out.changes ?? []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`,
      ok: "Accept update", cancel: "Later",
    });
    if (accept && out.book_version_id) await busy([{ label: "Updating the universe book", hint: "A few seconds.", run: () => story("accept_book_update", { book_version_id: out.book_version_id }) }]);
    screenReview(id);
  });
  const narrate = (preview) => attempt(async () => {
    if (!u.narrator_voice_id) { location.hash = `#/u/${u.id}`; return toast("Pick a narrator voice first", true); }
    if (!preview) {
      const ok = await confirmSheet({
        title: "Make the full episode?",
        body: `Uses about ${chars.toLocaleString()} ElevenLabs credits (90,000 a month on Starter). It can take a minute or two.`,
        ok: "Make audio",
      });
      if (!ok) return;
    }
    const out = await busy([{ label: preview ? "Recording a short preview" : "Recording the episode", hint: preview ? "About 20 to 40 seconds." : "Every character gets their own voice. Up to 2 minutes.", run: () => produce("narrate", { chapter_id: id, max_lines: preview ? 8 : undefined }) }]);
    cache.universes = null;
    if (preview) { toast("Preview ready"); screenReview(id); }
    else location.hash = `#/play/${id}`;
  });

  const back = backBtn(`#/u/${u.id}`);
  if (!r && (ch.status === "draft")) {
    setDock(`${back}<button class="btn" id="a">Run safety review</button>`);
    $("#a").onclick = () => attempt(async () => { await busy([reviewStep]); screenReview(id); });
  } else if (ch.status === "draft" && verdict === "pass") {
    setDock(`${back}<div class="col"><button class="btn secondary small" style="width:100%" id="b">Revise with my notes</button><button class="btn" id="a">Approve chapter</button></div>`);
    $("#a").onclick = () => approve(false);
    $("#b").onclick = revise;
  } else if (ch.status === "needs_fix") {
    setDock(`${back}<div class="col"><button class="btn secondary small" style="width:100%" id="b">Approve anyway</button><button class="btn" id="a">Revise with fixes</button></div>`);
    $("#a").onclick = revise;
    $("#b").onclick = () => approve(true);
  } else if (ch.status === "blocked") {
    setDock(`${back}<button class="btn" id="a">Revise</button>`);
    $("#a").onclick = revise;
  } else if (ch.status === "approved") {
    setDock(`${back}<div class="col"><button class="btn secondary small" style="width:100%" id="b">Listen to a short preview first</button><button class="btn" id="a">Make audio episode</button></div>`);
    $("#a").onclick = () => narrate(false);
    $("#b").onclick = () => narrate(true);
  } else if (ch.status === "produced") {
    setDock(`${back}<a class="btn" href="#/play/${id}">Play episode</a>`);
  } else {
    setDock(back);
  }
}

// Player. The <audio> element lives outside the view so playback continues across screens.
const now = { chapter: null, universe: null, sleepAt: null, sleepMin: 0 };

function markPlayed(id) {
  const played = new Set(store.get("played", []));
  played.add(id);
  store.set("played", [...played].slice(-500));
}

audio.addEventListener("ended", () => {
  if (now.chapter) markPlayed(now.chapter.id);
  now.sleepAt = null;
});
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
    title: `Chapter ${ch.number}: ${ch.title ?? ""}`,
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
  setTab("play");
  if (!id) {
    // Listen tab: what's playing, else every ready episode.
    if (now.chapter) return screenPlayer(now.chapter.id);
    loading();
    setDock("");
    let universes;
    try { universes = await getUniverses(true); }
    catch (e) { if (e instanceof PasscodeError) { store.del("passcode"); return route(); } return errorView(e, () => screenPlayer()); }
    const played = new Set(store.get("played", []));
    const ready = universes.flatMap((u) => sortedChapters(u).filter((c) => c.status === "produced").map((c) => ({ u, c })));
    view.innerHTML = `<div class="eyebrow">Listen</div><h1>Episodes</h1>
      ${ready.length ? `<div class="list" style="margin-top:16px">${ready.map(({ u, c }) => `
        <a class="item" href="#/play/${c.id}">${coverImg(u.cover_url, u.title, "thumb")}
          <div class="grow"><div class="t">${c.number}. ${esc(c.title)}</div><div class="s">${esc(u.title)}${played.has(c.id) ? " · played" : ""}</div></div>
          <span class="play-dot" style="width:44px;height:44px" aria-hidden="true">${ICON.play}</span></a>`).join("")}</div>`
        : `<div class="card" style="margin-top:16px"><p>No episodes yet.</p><p class="small muted">Approve a chapter, then tap “Make audio episode”.</p></div>`}`;
    return;
  }

  loading();
  let ch, u;
  try {
    if (now.chapter?.id === id) ({ chapter: ch, universe: u } = now);
    else ({ ch, u } = await getChapterFull(id));
  } catch (e) { if (e instanceof PasscodeError) { store.del("passcode"); return route(); } return errorView(e, () => screenPlayer(id)); }
  const src = ch.audio_url || ch.preview_url;
  if (!src) {
    view.innerHTML = `<div class="stack" style="padding-top:20dvh"><h2>No audio yet</h2><p class="muted">This chapter hasn't been recorded.</p></div>`;
    setDock(`${backBtn(`#/c/${id}`)}<a class="btn" href="#/c/${id}">Open chapter</a>`);
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
  const chs = sortedChapters(u);
  const nextCh = chs.find((c) => c.number > ch.number && c.status === "produced");

  view.innerHTML = `
    <div class="player">
      <div class="eyebrow">${esc(u.title)}${!ch.audio_url ? " · preview" : ""}</div>
      ${ch.cover_url ? `<img class="art" src="${esc(ch.cover_url)}" alt="">` : `<div class="art cover-ph">${esc(u.title)}</div>`}
      <div><h1 style="font-size:24px">Chapter ${ch.number}</h1><p class="muted" style="margin:4px 0 0">${esc(ch.title)}</p></div>
      ${nextCh ? `<a class="btn ghost small" href="#/play/${nextCh.id}">Up next: Chapter ${nextCh.number}</a>` : ""}
      <div style="width:100%"><div class="eyebrow" style="margin-bottom:6px">Sleep timer</div>
        <div class="seg" id="sleep">${[["0", "Off"], ["10", "10 min"], ["20", "20 min"], ["30", "30 min"]].map(([v, l]) => `<button data-sleep="${v}">${l}</button>`).join("")}</div></div>
      <div class="scrub"><input type="range" id="seek" min="0" max="1000" value="0" aria-label="Position">
        <div class="times"><span id="cur">0:00</span><span id="dur">0:00</span></div></div>
    </div>`;

  setDock(`<div class="transport">
      <button class="skip" id="rew" aria-label="Back 15 seconds">-15</button>
      <button class="big-play" id="pp" aria-label="Play">${ICON.play}</button>
      <button class="skip" id="fwd" aria-label="Forward 15 seconds">+15</button></div>`);

  const pp = $("#pp"), seek = $("#seek"), cur = $("#cur"), dur = $("#dur");
  const sync = () => {
    if (!document.body.contains(pp)) return detach();
    pp.innerHTML = audio.paused ? ICON.play : ICON.pause;
    pp.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
    cur.textContent = fmtTime(audio.currentTime);
    dur.textContent = fmtTime(audio.duration);
    if (audio.duration && !seek.matches(":active")) seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
    const mode = now.sleepAt ? String(now.sleepMin) : "0";
    $$("#sleep [data-sleep]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sleep === mode));
  };
  const evs = ["play", "pause", "timeupdate", "loadedmetadata", "ended"];
  const detach = () => evs.forEach((e) => audio.removeEventListener(e, sync));
  evs.forEach((e) => audio.addEventListener(e, sync));
  sync();

  pp.onclick = () => (audio.paused ? audio.play().catch((e) => toast(e.message, true)) : audio.pause());
  $("#rew").onclick = () => (audio.currentTime = Math.max(0, audio.currentTime - 15));
  $("#fwd").onclick = () => (audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15));
  seek.oninput = () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; };
  $$("#sleep [data-sleep]").forEach((b) => (b.onclick = () => {
    const v = b.dataset.sleep;
    now.sleepMin = +v || 0;
    now.sleepAt = now.sleepMin ? Date.now() + now.sleepMin * 60_000 : null;
    sync();
    if (v !== "0") toast(`Fades out in ${v} minutes (or at the end of the chapter)`);
  }));
}

// ---------- Router ----------

async function route() {
  sheet.hidden = true;
  if (!store.get("passcode")) return screenLock();
  document.body.classList.remove("locked");
  const [path, query] = location.hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
  if (!parts.length) return screenLibrary();
  if (parts[0] === "capture") return screenCapture();
  if (parts[0] === "u" && parts[2] === "write") return screenStudio(parts[1], new URLSearchParams(query));
  if (parts[0] === "u") return screenUniverse(parts[1]);
  if (parts[0] === "c") return screenReview(parts[1]);
  if (parts[0] === "play") return screenPlayer(parts[1]);
  location.hash = "#/";
}

window.addEventListener("hashchange", route);
route();

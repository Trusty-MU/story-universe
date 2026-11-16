// Story Universe: the animated loading screen and the "how it works" tutorial.
// The splash markup lives in index.html so it paints before any script or font loads.
// The tutorial shows every time the app opens unless a parent switches it off on the last card.

const KEY = "intro.skip";
const prefsGet = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const prefsSet = (v) => { try { v ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch { /* private mode */ } };

// ---------- Splash ----------

const SPLASH_MIN_MS = 1500;
const SPLASH_MAX_MS = 5000;
const started = performance.now();

// Hide the splash once `ready` settles, but never before it has shown for SPLASH_MIN_MS.
export async function hideSplash(ready) {
  const el = document.getElementById("splash");
  if (!el) return;
  await Promise.race([Promise.resolve(ready).catch(() => {}), wait(SPLASH_MAX_MS)]);
  const left = SPLASH_MIN_MS - (performance.now() - started);
  if (left > 0) await wait(left);
  el.classList.add("out");
  await wait(reduced() ? 0 : 450);
  el.remove();
}

// ---------- Tutorial ----------

const MIC = `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
const TICK = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>`;
const PLAY = `<svg viewBox="0 0 24 24" width="40" height="40" fill="#fff" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>`;

const path = (lit) => `<div class="ti-path">${["Told", "Written", "Checked", "Recorded"].map((s, i) =>
  `${i ? `<span class="ti-bar${i <= lit ? " on" : ""}" style="--d:${i * 0.35}s"></span>` : ""}<span class="ti-stop${i <= lit ? " on" : ""}" style="--d:${i * 0.35}s"><i></i>${s}</span>`).join("")}</div>`;

const SLIDES = [
  {
    kick: "1 · Told",
    title: "A kid tells the idea",
    body: "Tap Tell, hand over the phone and let them talk. Story Universe says the idea back so they know it was heard.",
    art: `<div class="ti-art ti-tell">
      <div class="ti-mic">${MIC}<span class="ti-ring"></span><span class="ti-ring r2"></span></div>
      <div class="ti-bubble"><span>A goose</span> <span>with a very</span> <span>long scarf…</span></div>
    </div>`,
  },
  {
    kick: "2 · Written",
    title: "It's written into the universe",
    body: "The idea becomes the next chapter. The universe book remembers every name, place and quest, so the story keeps going.",
    art: `<div class="ti-art ti-write">
      <div class="ti-page"><span></span><span></span><span></span><span></span><span class="short"></span></div>
      ${path(1)}
    </div>`,
  },
  {
    kick: "3 · Checked",
    title: "A grown-up checks it first",
    body: "Every chapter gets a check: calm for bedtime, right for their age, true to our family's values. Nothing plays until you approve it.",
    art: `<div class="ti-art ti-check">
      <div class="ti-card">
        <div class="ti-row" style="--d:.2s"><b>${TICK}</b>Calm, sleepy ending</div>
        <div class="ti-row" style="--d:.7s"><b>${TICK}</b>Right for their age</div>
        <div class="ti-row" style="--d:1.2s"><b>${TICK}</b>Fits our values</div>
      </div>
    </div>`,
  },
  {
    kick: "4 · Recorded",
    title: "Hear it tonight",
    body: "Each character gets their own voice. Press play, set the sleep timer, and the story carries them off to sleep.",
    night: true,
    art: `<div class="ti-art ti-listen">
      <div class="ti-glow"></div>
      <div class="ti-waves"><span></span><span></span><span></span><span></span><span></span></div>
      <div class="ti-play">${PLAY}</div>
    </div>`,
  },
];

let open = false;

// Show the tutorial. `force` ignores the parent's "don't show" switch (the replay button).
export function showTutorial({ force = false } = {}) {
  if (open || (!force && prefsGet())) return Promise.resolve();
  open = true;
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.id = "tutorial";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "How Story Universe works");
    document.body.appendChild(root);
    let i = 0;

    const draw = () => {
      const s = SLIDES[i];
      const last = i === SLIDES.length - 1;
      root.className = s.night ? "night" : "";
      root.innerHTML = `
        <div class="ti-top"><span class="ti-dots" aria-hidden="true">${SLIDES.map((_, n) => `<i class="${n === i ? "on" : ""}"></i>`).join("")}</span>
          <button class="ti-skip" data-skip>${last ? "" : "Skip"}</button></div>
        <div class="ti-slide" aria-live="polite">
          ${s.art}
          <div class="ti-text">
            <div class="ti-kick">${s.kick}</div>
            <h2>${s.title}</h2>
            <p>${s.body}</p>
          </div>
        </div>
        <div class="ti-dock">
          ${last ? `<label class="ti-pref"><input type="checkbox" id="tiSkip" ${prefsGet() ? "checked" : ""}> Don't show this when the app opens</label>` : ""}
          <div class="ti-btns">
            ${i ? `<button class="ti-back" data-back aria-label="Back"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>` : ""}
            <button class="ti-next" data-next>${last ? "Let's go" : "Next"}</button>
          </div>
        </div>`;
      root.querySelector("[data-next]").onclick = () => (last ? done() : go(1));
      root.querySelector("[data-back]")?.addEventListener("click", () => go(-1));
      const skip = root.querySelector("[data-skip]");
      if (last) skip.hidden = true; else skip.onclick = done;
      root.querySelector("#tiSkip")?.addEventListener("change", (e) => prefsSet(e.target.checked));
      root.querySelector("[data-next]").focus({ preventScroll: true });
    };
    const go = (d) => { i = Math.max(0, Math.min(SLIDES.length - 1, i + d)); draw(); };
    const done = () => {
      root.classList.add("out");
      setTimeout(() => { root.remove(); open = false; resolve(); }, reduced() ? 0 : 300);
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") done();
    };
    document.addEventListener("keydown", onKey);

    // Swipe left/right between cards.
    let x0 = null;
    root.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
    root.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    });

    draw();
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function reduced() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }

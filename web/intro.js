// Campfire: the animated loading screen and the "how it works" tutorial.
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
// The tutorial is the pitch and the how-to in one: why it's called Campfire, who it's for,
// what it makes possible, and the four-step loop. Copy follows the Campfire voice
// (short, concrete, warm not sweet; the software never gets the verb). See CLAUDE.md, Brand.

const TICK = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>`;
const PLAY = `<svg viewBox="0 0 24 24" width="38" height="38" fill="#fff" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>`;
const FLAME = (w = 56) => `<svg class="ti-flame" width="${w}" height="${Math.round(w * 4 / 3)}" viewBox="0 0 96 128" aria-hidden="true"><path d="M48 4C62 30 88 46 88 82a40 40 0 0 1-80 0C8 62 18 50 28 42c0 16 8 26 18 26C46 42 34 26 48 4z" fill="#f0632b"/><path d="M50 52c8 14 20 22 20 40a22 22 0 0 1-44 0c0-10 6-16 12-20 0 8 4 12 10 12 0-14-6-20 2-32z" fill="#ffb703"/></svg>`;
const NOTE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="#4a3323" aria-hidden="true"><path d="M9 17.5A2.5 2.5 0 1 1 7 15V5l11-2v11.5A2.5 2.5 0 1 1 16 12V6.3L9 7.6z"/></svg>`;
const HEART = `<svg viewBox="0 0 24 24" width="22" height="22" fill="#2e7d5b" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`;

// A family member, drawn as flat paper-cut shapes: a round head on a rounded body.
const person = (cls, color, size, delay) =>
  `<span class="ti-person ${cls}" style="--c:${color};--s:${size}px;--d:${delay}s"><i></i><b></b></span>`;

const SLIDES = [
  {
    night: true,
    kick: "Why Campfire",
    title: "Every family has a campfire",
    body: "It's the circle where stories get told, the same ones, again and again. Campfire brings that circle to bedtime, even on nights someone is far from home.",
    art: `<div class="ti-art ti-camp">
      <span class="ti-star" style="left:12%;top:10%;--d:0s"></span><span class="ti-star" style="left:30%;top:2%;--d:.8s"></span>
      <span class="ti-star" style="left:70%;top:6%;--d:1.4s"></span><span class="ti-star" style="left:88%;top:22%;--d:.4s"></span>
      <span class="ti-moon"></span>
      <div class="ti-fireglow"></div>
      <div class="ti-circle">
        ${person("l", "#2d7fb8", 58, 0.2)}${person("l", "#ffb703", 40, 0.45)}${person("l", "#2e7d5b", 30, 0.7)}
        <span class="ti-fire">${FLAME(52)}<span class="ti-logs"></span><span class="ti-spark" style="--d:0s"></span><span class="ti-spark" style="--d:.9s;left:60%"></span></span>
        ${person("r", "#fde3d6", 54, 0.35)}${person("r", "#d7e8f5", 38, 0.6)}
      </div>
    </div>`,
  },
  {
    kick: "1 · Tell",
    title: "Anyone can start a story",
    body: "A kid's wild idea, a lesson you want to teach, something from today. Say it or type it in Tell. Campfire says it back so you know it was heard right.",
    art: `<div class="ti-art ti-tellers">
      <div class="ti-bubbles">
        <span class="ti-bub" style="--d:.2s">A goose with a very long scarf</span>
        <span class="ti-bub alt" style="--d:1s">Sharing is brave too</span>
        <span class="ti-bub" style="--d:1.8s">Dad's trip to Chile!</span>
      </div>
      <div class="ti-crew">
        <span class="ti-av" style="background:#2d7fb8;color:#fff">Le</span><span class="ti-av" style="background:#ffb703">Ly</span>
        <span class="ti-av" style="background:#2e7d5b;color:#fff">Lu</span><span class="ti-av" style="background:#f3e8d3">Dad</span><span class="ti-av" style="background:#fde3d6">Mom</span>
      </div>
    </div>`,
  },
  {
    kick: "2 · Written",
    title: "Every story becomes a universe",
    body: "Characters, places and quests carry from one chapter to the next. Campfire remembers it all, so tonight picks up where last night left off.",
    art: `<div class="ti-art ti-universe">
      <div class="ti-fan">
        <span class="ti-ch" style="--r:-13deg;--x:-46px;--d:.5s"></span><span class="ti-ch" style="--r:-5deg;--x:-20px;--d:.8s"></span><span class="ti-ch" style="--r:7deg;--x:30px;--d:1.1s"></span>
        <span class="ti-cover"><i></i><i></i><b>The Lamplighters of Pebble Point</b></span>
      </div>
      <div class="ti-quest">${[0, 1, 2, 3, 4].map((n) => `<i style="--d:${1.3 + n * 0.25}s" class="${n < 3 ? "on" : ""}"></i>`).join("")}<span>quest steps</span></div>
    </div>`,
  },
  {
    kick: "Make it yours",
    title: "Lessons inside. Songs to sing along.",
    body: "Tuck in what matters this week: kindness, courage, a school topic, where Dad is traveling. Each universe can have its own short theme song.",
    art: `<div class="ti-art ti-extras">
      <div class="ti-lesson"><span class="ti-ic" style="background:#fff">${HEART}</span><span class="ti-kk">Lesson</span><b>Brave means asking for help</b></div>
      <div class="ti-song"><span class="ti-ic" style="background:#fff">${NOTE}</span><span class="ti-kk">Theme song</span><b>The Lamplighter Song</b>
        <span class="ti-notes"><i style="--d:0s">${NOTE}</i><i style="--d:.7s">${NOTE}</i><i style="--d:1.4s">${NOTE}</i></span></div>
    </div>`,
  },
  {
    kick: "3 · Checked",
    title: "A grown-up hears it first",
    body: "Every chapter is checked for bedtime calm, the right age and your family's values. Nothing plays until you approve it.",
    fine: "You give the idea, the people and the lesson. Campfire uses AI to write it down and read it aloud, like a scribe. It never makes up a story on its own.",
    art: `<div class="ti-art ti-check">
      <div class="ti-card">
        <div class="ti-row" style="--d:.2s"><b>${TICK}</b>Calm, sleepy ending</div>
        <div class="ti-row" style="--d:.6s"><b>${TICK}</b>Right for their age</div>
        <div class="ti-row" style="--d:1s"><b>${TICK}</b>Fits our family's values</div>
        <span class="ti-stamp" style="--d:1.5s">Approved</span>
      </div>
    </div>`,
  },
  {
    night: true,
    kick: "4 · Recorded",
    title: "Hear it tonight. Keep it forever.",
    body: "Every character gets a voice. Night by night your Library fills with stories they'll ask for again, and still have when they're grown.",
    art: `<div class="ti-art ti-shelf">
      <div class="ti-fireglow"></div>
      <div class="ti-books">
        <span style="--c:#2d7fb8;--d:.1s"></span><span style="--c:#2e7d5b;--d:.3s"></span><span style="--c:#ffb703;--d:.5s"></span><span style="--c:#f0632b;--d:.7s"></span><span style="--c:#d7e8f5;--d:.9s"></span>
      </div>
      <span class="ti-shelfline"></span>
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
    root.setAttribute("aria-label", "Welcome to Campfire");
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
            ${s.fine ? `<p class="ti-fine">${s.fine}</p>` : ""}
          </div>
        </div>
        <div class="ti-dock">
          ${last ? `<label class="ti-pref"><input type="checkbox" id="tiSkip" ${prefsGet() ? "checked" : ""}> Don't show this when the app opens</label>` : ""}
          <div class="ti-btns">
            ${i ? `<button class="ti-back" data-back aria-label="Back"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>` : ""}
            <button class="ti-next" data-next>${last ? "Gather round" : "Next"}</button>
          </div>
        </div>`;
      root.querySelector("[data-next]").onclick = () => (last ? done() : go(1));
      root.querySelector("[data-back]")?.addEventListener("click", () => go(-1));
      const skip = root.querySelector("[data-skip]");
      if (last) skip.hidden = true; else skip.onclick = done;
      root.querySelector("#tiSkip")?.addEventListener("change", (e) => prefsSet(e.target.checked));
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

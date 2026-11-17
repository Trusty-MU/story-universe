// Story Universe: theme songs for a book (a "universe" in the database).
// Same path as chapters: write lyrics -> grown-up check -> (revise -> check)* -> approve -> record.
// Recording uses ElevenLabs Music (music_v1 composition plan, exact section lengths).
// Suno is a manual alternative: the app copies lyrics and style, and the MP3 is uploaded back.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ELEVEN = (Deno.env.get("ELEVENLABS_API_KEY") ?? "").trim();
const PASSCODE = Deno.env.get("FAMILY_PASSCODE");
const MODEL = "claude-sonnet-5-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-family-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new Error(`Missing or invalid ${what}`);
  return v;
};

// ---------- Claude (JSON schema structured output, one call per request) ----------

function strict(schema: any): any {
  if (Array.isArray(schema)) return schema.map(strict);
  if (schema && typeof schema === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(schema)) out[k] = strict(v);
    if (out.type === "object") out.additionalProperties = false;
    return out;
  }
  return schema;
}

async function claude(system: string, prompt: string, schema: Record<string, unknown>, maxTokens = 4000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens, system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema: strict(schema) } },
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const body = await res.json();
  if (body.stop_reason === "max_tokens") throw new Error("Claude ran out of output space (max_tokens)");
  if (body.stop_reason === "refusal") throw new Error("Claude declined this request");
  const text = body.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no output");
  return JSON.parse(text);
}

// ---------- Family, values, song rules ----------

type Member = { name: string; role: string; birth_month: string | null; notes: string | null };
const age = (m: Member) => (m.birth_month ? Math.round(((Date.now() - Date.parse(m.birth_month)) / (365.25 * 864e5)) * 10) / 10 : null);

async function family(): Promise<Member[]> {
  const { data } = await sb.from("family_members").select("name,role,birth_month,notes");
  return (data ?? []) as Member[];
}
const familyText = (ms: Member[]) =>
  ms.map((m) => `- ${m.name} (${m.role}${age(m) !== null ? `, age ${age(m)}` : ""})${m.notes ? `: ${m.notes}` : ""}`).join("\n");

const VALUES = `FAMILY VALUES
This is a Christian family. Every song must fit a Christian worldview.
- Celebrate kindness, honesty, courage, gratitude, forgiveness, sharing, obedience to parents, and loving siblings.
- Imaginative fantasy is welcome. Never present witchcraft, sorcery, spirits, or the occult as good. No mocking of faith.
- No crude or potty humor, no name-calling, no romance, no violence, nothing unsafe a child could copy.`;

const MOODS: Record<string, { label: string; styles: string[] }> = {
  lullaby: { label: "a gentle bedtime lullaby", styles: ["gentle children's lullaby", "soft acoustic guitar", "celesta", "warm soft vocals", "slow tempo around 70 bpm", "cozy and calm"] },
  singalong: { label: "a bright sing-along", styles: ["upbeat children's sing-along", "ukulele", "hand claps", "glockenspiel", "bright warm vocals", "around 110 bpm", "simple catchy chorus"] },
  adventure: { label: "a brave, playful adventure song", styles: ["playful adventure song for kids", "light drums", "acoustic guitar", "whistling", "small brass hits", "around 118 bpm", "brave and fun"] },
};
const NEGATIVE = ["scary", "dark", "aggressive", "distorted guitar", "heavy bass drops", "explicit lyrics", "shouting"];
const LENGTH_S: Record<string, number> = { short: 90, medium: 120, long: 150 };

const KINDS = ["intro", "verse", "chorus", "bridge", "outro"];
const songSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: KINDS },
          name: { type: "string", description: "e.g. Verse 1, Chorus" },
          seconds: { type: "integer" },
          lines: { type: "array", items: { type: "string" } },
        },
        required: ["kind", "name", "seconds", "lines"],
      },
    },
    summary: { type: "string", description: "One sentence for the parent about what the song is about" },
  },
  required: ["title", "sections", "summary"],
};

const reviewSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fix", "block"] },
    scores: {
      type: "object",
      description: "1 to 5, 5 is best",
      properties: { calm_and_kind: { type: "integer" }, age_fit: { type: "integer" }, values_fit: { type: "integer" }, singable: { type: "integer" } },
      required: ["calm_and_kind", "age_fit", "values_fit", "singable"],
    },
    reasons: {
      type: "array",
      items: { type: "object", properties: { issue: { type: "string" }, severity: { type: "string", enum: ["low", "medium", "high"] } }, required: ["issue", "severity"] },
    },
    fix_instructions: { type: "string" },
  },
  required: ["verdict", "scores", "reasons", "fix_instructions"],
};

const SONG_RULES = `SONG RULES
- Original lyrics only. Never quote or imitate an existing song's lyrics or melody.
- Simple words a 3-year-old can sing back. Short lines (under 50 characters). Strong, easy rhymes.
- The chorus is the heart: 2 to 4 lines, repeated word for word every time it appears, and it names the book's world or heroes.
- Use the kids' real names and the book's characters. Include every family kid somehow.
- Never invent a family surname or new facts about the real family.
- Sections in order, e.g. intro (instrumental or 1 line), verse, chorus, verse, chorus, optional bridge, final chorus, optional short outro.
- Give each section a length in seconds so the whole song adds up to the target length. Verses 18 to 26 s, choruses 16 to 22 s, intro and outro 4 to 10 s. 2 to 8 lines per section (an instrumental intro may have none).`;

// Fit section lengths to the target exactly, within ElevenLabs' 3 to 120 s per section.
function fitDurations(sections: { seconds: number }[], target: number) {
  const total = sections.reduce((n, s) => n + Math.max(1, s.seconds), 0) || 1;
  const ms = sections.map((s) => Math.min(120000, Math.max(3000, Math.round((Math.max(1, s.seconds) / total) * target * 1000))));
  const diff = target * 1000 - ms.reduce((n, x) => n + x, 0);
  const i = ms.indexOf(Math.max(...ms));
  ms[i] = Math.min(120000, Math.max(3000, ms[i] + diff));
  return sections.map((s, n) => ({ ...s, seconds: Math.round(ms[n] / 1000), ms: ms[n] }));
}

type Section = { kind: string; name: string; seconds: number; lines: string[]; ms?: number };

function cleanSections(raw: Section[], target: number) {
  const secs = (raw ?? []).filter((s) => KINDS.includes(s.kind)).slice(0, 12).map((s) => ({
    kind: s.kind,
    name: String(s.name || s.kind).slice(0, 60),
    seconds: Number(s.seconds) || 20,
    lines: (s.lines ?? []).map((l) => String(l).trim()).filter(Boolean).slice(0, 12).map((l) => l.slice(0, 180)),
  }));
  if (!secs.length) throw new Error("The song came back empty. Try again.");
  return fitDurations(secs, target);
}

const lyricsText = (sections: Section[]) => sections.map((s) => `[${s.name}]\n${s.lines.join("\n")}`).join("\n\n");

async function loadBook(uid: string) {
  const { data: u, error } = await sb.from("universes").select("id,title,book").eq("id", uid).single();
  if (error || !u) throw new Error("That book doesn't exist anymore");
  const { data: chars } = await sb.from("characters").select("name,description,personality").eq("universe_id", uid);
  return { ...u, characters: chars ?? [] };
}

async function loadSong(sid: string) {
  const { data, error } = await sb.from("songs").select("*").eq("id", sid).single();
  if (error || !data) throw new Error("That song doesn't exist anymore");
  return data;
}

async function sign(path: string | null) {
  if (!path) return null;
  const { data } = await sb.storage.from("audio").createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl ?? null;
}

// ---------- Actions ----------

type Brief = { for_kid?: string; mood?: string; length?: string; notes?: string };

async function list(p: { universe_id?: string }) {
  let q = sb.from("songs").select("id,universe_id,title,status,target_seconds,source,audio_path,brief,created_at,universes(title)").order("created_at", { ascending: false });
  if (p.universe_id) q = q.eq("universe_id", id(p.universe_id, "book"));
  const { data, error } = await q;
  if (error) throw error;
  return await Promise.all((data ?? []).map(async (s: any) => ({
    ...s, book_title: s.universes?.title ?? null, universes: undefined, audio_url: await sign(s.audio_path),
  })));
}

async function get(p: { song_id: string }) {
  const s = await loadSong(id(p.song_id, "song"));
  const { data: u } = await sb.from("universes").select("id,title").eq("id", s.universe_id).single();
  return { ...s, book_title: u?.title ?? null, audio_url: await sign(s.audio_path), lyrics_text: s.sections ? lyricsText(s.sections) : s.lyrics };
}

async function write(p: { universe_id: string; brief?: Brief }) {
  const uid = id(p.universe_id, "book");
  const brief: Brief = p.brief ?? {};
  const mood = MOODS[brief.mood ?? ""] ? brief.mood! : "singalong";
  const target = LENGTH_S[brief.length ?? ""] ?? 120;
  const [members, u] = await Promise.all([family(), loadBook(uid)]);
  const kid = members.find((m) => m.name === brief.for_kid && m.role === "kid");
  const out = await claude(
    `You write short, original theme songs for a family's ongoing bedtime-story books. Your songs are warm, simple and singable, like the best preschool songs, never cheesy or preachy.\n\nFAMILY\n${familyText(members)}\n\n${VALUES}\n\n${SONG_RULES}`,
    `Write a theme song for the book "${u.title}".
STORY MEMORY (premise, setting, characters, quests, running details):
${JSON.stringify(u.book)}
CHARACTERS: ${u.characters.map((c: { name: string; description: string }) => `${c.name} (${c.description})`).join("; ")}

STYLE: ${MOODS[mood].label}.
TARGET LENGTH: ${target} seconds in total.
${kid ? `MAIN SINGER-ALONG: ${kid.name}, age ${age(kid)}. Pitch the words for that age.` : "Pitch the words for ages 2 to 7."}
${brief.notes ? `PARENT NOTES: ${brief.notes}` : ""}`,
    songSchema,
  );
  const sections = cleanSections(out.sections, target);
  const { data: row, error } = await sb.from("songs").insert({
    universe_id: uid, title: String(out.title).slice(0, 120), lyrics: lyricsText(sections), sections,
    style: { mood, positive: MOODS[mood].styles, negative: NEGATIVE, summary: out.summary },
    target_seconds: target, source: "elevenlabs", status: "draft", brief: { ...brief, mood, length: brief.length ?? "medium" },
  }).select("id,title").single();
  if (error) throw error;
  return row;
}

async function review(p: { song_id: string }) {
  const s = await loadSong(id(p.song_id, "song"));
  const members = await family();
  const kid = members.find((m) => m.name === s.brief?.for_kid);
  const out = await claude(
    `You are the safety and values reviewer for a family song app. You protect young children. Be strict: when in doubt, choose "fix". Use "block" only for content that should never be heard. You do not praise.\n\nFAMILY\n${familyText(members)}\n\n${VALUES}`,
    `Review these theme song lyrics.
LISTENERS: ${kid ? `${kid.name}, age ${age(kid)}` : "kids 1 to 7"}; younger siblings will sing along.
STYLE: ${s.style?.mood ?? "sing-along"}.
${s.brief?.notes ? `PARENT REQUESTED (allowed; only check it is handled gently): ${s.brief.notes}` : ""}

CHECK: anything scary or unkind; age fit (simple words, short lines); fit with the family values; nothing that copies a known song's lyrics; singable (chorus repeats, lines not too long); kids' real names used warmly.

LYRICS
${s.sections ? lyricsText(s.sections) : s.lyrics}

Choose "pass" when every remaining issue is low severity (list them anyway). "fix" for medium or high issues, with concrete fix_instructions. If "pass", fix_instructions is empty.`,
    reviewSchema,
  );
  const status = out.verdict === "pass" ? "draft" : out.verdict === "fix" ? "needs_fix" : "blocked";
  await sb.from("reviews").insert({ subject_type: "song", subject_id: s.id, verdict: out.verdict, reasons: out.reasons, suggested_fix: out.fix_instructions });
  await sb.from("songs").update({ review: out, status, updated_at: new Date().toISOString() }).eq("id", s.id);
  return { song_id: s.id, status, review: out };
}

async function revise(p: { song_id: string; feedback?: string }) {
  const s = await loadSong(id(p.song_id, "song"));
  if (s.status === "approved" || s.status === "produced") throw new Error("An approved song can't be changed");
  const notes = [s.review?.fix_instructions, p.feedback ? `Parent feedback: ${p.feedback}` : ""].filter(Boolean).join("\n");
  if (!notes) throw new Error("Nothing to change: no check notes or feedback");
  const [members, u] = await Promise.all([family(), loadBook(s.universe_id)]);
  const target = s.target_seconds ?? 120;
  const out = await claude(
    `You are revising a family theme song. Keep everything that works; change only what the notes require.\n\nFAMILY\n${familyText(members)}\n\n${VALUES}\n\n${SONG_RULES}`,
    `BOOK: ${u.title}\nSTORY MEMORY: ${JSON.stringify(u.book)}\nSTYLE: ${s.style?.mood}. TARGET LENGTH: ${target} seconds.\n\nCURRENT SONG "${s.title}"\n${lyricsText(s.sections ?? [])}\n\nREVISION NOTES\n${notes}\n\nReturn the full revised song.`,
    songSchema,
  );
  const sections = cleanSections(out.sections, target);
  await sb.from("songs").update({
    title: String(out.title).slice(0, 120), sections, lyrics: lyricsText(sections), review: null, status: "draft",
    style: { ...s.style, summary: out.summary }, updated_at: new Date().toISOString(),
  }).eq("id", s.id);
  return { song_id: s.id, title: out.title };
}

async function approve(p: { song_id: string; override?: boolean }) {
  const s = await loadSong(id(p.song_id, "song"));
  const passed = s.status === "draft" && s.review?.verdict === "pass";
  const overridable = p.override === true && s.status === "needs_fix";
  if (!passed && !overridable) throw new Error("Only a song that passed its check can be approved (a parent can override a 'fix', never a 'block')");
  if (overridable) await sb.from("reviews").insert({ subject_type: "song", subject_id: s.id, verdict: "pass", reasons: [{ issue: "Parent approved over reviewer's fix request", severity: "low" }] });
  await sb.from("songs").update({ status: "approved", approved: true, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", s.id);
  return { song_id: s.id, status: "approved" };
}

async function record(p: { song_id: string; max_seconds?: number }) {
  const s = await loadSong(id(p.song_id, "song"));
  if (s.status !== "approved" && s.status !== "produced") throw new Error("Approve the song before recording it");
  if (!ELEVEN) throw new Error("ElevenLabs key is missing");
  let sections: Section[] = s.sections ?? [];
  // Test hook: a short sample of just the first sections (keeps credit use tiny).
  if (p.max_seconds) {
    sections = fitDurations(sections.slice(0, 2), Math.max(6, Math.min(30, Math.round(p.max_seconds))));
  }
  const plan = {
    positive_global_styles: s.style?.positive ?? MOODS.singalong.styles,
    negative_global_styles: s.style?.negative ?? NEGATIVE,
    sections: sections.map((x) => ({
      section_name: x.name.slice(0, 100),
      positive_local_styles: x.kind === "chorus" ? ["full, joyful", "kids singing along"] : x.kind === "intro" || x.kind === "outro" ? ["instrumental", "soft"] : ["clear vocals"],
      negative_local_styles: [],
      duration_ms: x.ms ?? x.seconds * 1000,
      lines: x.lines.slice(0, 30),
    })),
  };
  const r = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": ELEVEN, "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: "music_v1", composition_plan: plan, respect_sections_durations: true }),
  });
  if (!r.ok) throw new Error(`ElevenLabs Music ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const audio = new Uint8Array(await r.arrayBuffer());
  const path = `${s.universe_id}/song-${s.id}${p.max_seconds ? "-sample" : ""}.mp3`;
  const { error } = await sb.storage.from("audio").upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (error) throw error;
  const seconds = Math.round(plan.sections.reduce((n, x) => n + x.duration_ms, 0) / 1000);
  if (!p.max_seconds) {
    await sb.from("songs").update({ audio_path: path, status: "produced", source: "elevenlabs", duration_seconds: seconds, updated_at: new Date().toISOString() }).eq("id", s.id);
  }
  return { song_id: s.id, path, url: await sign(path), seconds, credits_estimate: Math.round((seconds / 60) * 900) };
}

// Suno: the app uploads the MP3 straight to storage with a one-time signed URL, then attaches it.
async function uploadUrl(p: { song_id: string }) {
  const s = await loadSong(id(p.song_id, "song"));
  if (s.status !== "approved" && s.status !== "produced") throw new Error("Approve the song before adding a recording");
  const path = `${s.universe_id}/song-${s.id}-suno.mp3`;
  const { data, error } = await sb.storage.from("audio").createSignedUploadUrl(path, { upsert: true });
  if (error) throw error;
  return { path, upload_url: data.signedUrl, token: data.token };
}

async function attachUpload(p: { song_id: string; seconds?: number }) {
  const s = await loadSong(id(p.song_id, "song"));
  const path = `${s.universe_id}/song-${s.id}-suno.mp3`;
  const { data } = await sb.storage.from("audio").list(s.universe_id, { search: `song-${s.id}-suno.mp3` });
  if (!(data ?? []).some((f) => f.name === `song-${s.id}-suno.mp3`)) throw new Error("The upload didn't arrive. Try again.");
  await sb.from("songs").update({
    audio_path: path, source: "suno", status: "produced", duration_seconds: p.seconds ? Math.round(p.seconds) : null, updated_at: new Date().toISOString(),
  }).eq("id", s.id);
  return { song_id: s.id, url: await sign(path) };
}

async function remove(p: { song_id: string }) {
  const s = await loadSong(id(p.song_id, "song"));
  const files = ["", "-sample", "-suno"].map((x) => `${s.universe_id}/song-${s.id}${x}.mp3`);
  if (s.audio_path && !files.includes(s.audio_path)) files.push(s.audio_path);
  await sb.storage.from("audio").remove(files);
  await sb.from("reviews").delete().eq("subject_type", "song").eq("subject_id", s.id);
  const { error } = await sb.from("songs").delete().eq("id", s.id);
  if (error) throw error;
  return { deleted: "song", title: s.title };
}

const ACTIONS: Record<string, (p: any) => Promise<unknown>> = {
  list, get, write, review, revise, approve, record,
  upload_url: uploadUrl, attach_upload: attachUpload, delete: remove,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (PASSCODE && req.headers.get("x-family-passcode") !== PASSCODE) return json({ error: "Wrong passcode" }, 401);
  try {
    const { action, ...params } = await req.json();
    const fn = ACTIONS[action];
    if (!fn) return json({ error: `Unknown action: ${action}` }, 400);
    return json({ ok: true, data: await fn(params) });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

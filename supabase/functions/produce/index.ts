// Story Universe: production (narration audio and covers).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ELEVEN = Deno.env.get("ELEVENLABS_API_KEY")!.trim();
const OPENAI = Deno.env.get("OPENAI_API_KEY")!;
const PASSCODE = Deno.env.get("FAMILY_PASSCODE");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-family-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Line = { speaker: string; text: string };

async function signed(bucket: string, path: string) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) throw error;
  return data.signedUrl;
}

async function listVoices() {
  const r = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", { headers: { "xi-api-key": ELEVEN } });
  if (!r.ok) throw new Error(`ElevenLabs voices ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.voices ?? []).map((v: any) => ({ id: v.voice_id, name: v.name, category: v.category, labels: v.labels, description: v.description }));
}

// Assign voices to the cast and save them on the characters.
async function castVoices(p: { universe_id: string; narrator_voice_id: string; voices: Record<string, string> }) {
  await sb.from("universes").update({ narrator_voice_id: p.narrator_voice_id }).eq("id", p.universe_id);
  for (const [name, voice_id] of Object.entries(p.voices)) {
    await sb.from("characters").update({ voice_id }).eq("universe_id", p.universe_id).eq("name", name);
  }
  return { ok: true };
}

// Split a script into chunks under the 2,000 character request limit.
function chunk(lines: Line[], max = 1800) {
  const out: Line[][] = [];
  let cur: Line[] = [];
  let len = 0;
  for (const l of lines) {
    if (len + l.text.length > max && cur.length) { out.push(cur); cur = []; len = 0; }
    cur.push(l); len += l.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function narrate(p: { chapter_id: string; max_lines?: number }) {
  const { data: ch, error } = await sb.from("chapters").select("*").eq("id", p.chapter_id).single();
  if (error) throw error;
  const { data: u } = await sb.from("universes").select("id,narrator_voice_id,voice_seed").eq("id", ch.universe_id).single();
  const { data: chars } = await sb.from("characters").select("name,voice_id").eq("universe_id", ch.universe_id);
  const voiceFor = (speaker: string) =>
    speaker === "NARRATOR" ? u!.narrator_voice_id : chars?.find((c) => c.name === speaker)?.voice_id ?? u!.narrator_voice_id;
  if (!u?.narrator_voice_id) throw new Error("Pick a narrator voice for this universe first");

  const lines = (ch.script as Line[]).slice(0, p.max_lines ?? 10_000);
  // Run up to 3 ElevenLabs requests at once (Starter plan concurrency) to stay under the
  // ~150 s request limit, then join the parts in script order.
  const groups = chunk(lines);
  const parts: Uint8Array[] = new Array(groups.length);
  const speak = async (group: Line[]) => {
    const r = await fetch("https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": ELEVEN, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: "eleven_v4",
        seed: u.voice_seed,
        inputs: group.map((l) => ({ text: l.text, voice_id: voiceFor(l.speaker) })),
      }),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 400)}`);
    return new Uint8Array(await r.arrayBuffer());
  };
  let next = 0;
  const worker = async () => {
    while (next < groups.length) { const i = next++; parts[i] = await speak(groups[i]); }
  };
  await Promise.all(Array.from({ length: Math.min(3, groups.length) }, worker));
  // MP3 frames can be concatenated directly.
  const total = parts.reduce((n, b) => n + b.length, 0);
  const audio = new Uint8Array(total);
  let off = 0;
  for (const b of parts) { audio.set(b, off); off += b.length; }

  const path = `${ch.universe_id}/chapter-${ch.number}${p.max_lines ? "-preview" : ""}.mp3`;
  const { error: upErr } = await sb.storage.from("audio").upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (upErr) throw upErr;
  if (!p.max_lines) await sb.from("chapters").update({ audio_path: path, status: "produced" }).eq("id", ch.id);
  return { path, url: await signed("audio", path), requests: parts.length, characters: lines.reduce((n, l) => n + l.text.length, 0) };
}

async function cover(p: { universe_id: string; style?: string; quality?: "low" | "medium" | "high" }) {
  const { data: u, error } = await sb.from("universes").select("id,title,art_style,book").eq("id", p.universe_id).single();
  if (error) throw error;
  const { data: chars } = await sb.from("characters").select("name,look,family_member_id").eq("universe_id", u.id);
  const style = p.style ?? u.art_style;
  const prompt = `A children's picture-book cover for "${u.title}".
Art style: ${style}. Hand-made illustration look with visible texture. Not a 3D animated look, not glossy CGI.
Scene: ${u.book?.premise ?? ""}
Setting: ${u.book?.setting ?? ""}
Characters on the cover:
${(chars ?? []).map((c) => `- ${c.name}: ${c.look}`).join("\n")}
Warm, gentle and inviting for children ages 1 to 7. Nothing scary. Put the title "${u.title}" in clear, friendly hand-lettered type at the top.`;

  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2.5-sunburst", prompt, size: "1024x1536", quality: p.quality ?? "medium", output_format: "png" }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json();
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const path = `${u.id}/cover-${Date.now()}.png`;
  const { error: upErr } = await sb.storage.from("covers").upload(path, bytes, { contentType: "image/png" });
  if (upErr) throw upErr;
  const { data: row } = await sb.from("covers").insert({ universe_id: u.id, style, prompt, image_path: path }).select().single();
  return { cover_id: row?.id, path, url: await signed("covers", path), usage: j.usage ?? null };
}

// Signed URLs the app needs: the current cover of every universe, plus a chapter's audio.
// Cover: the chosen one, else the newest. Missing files come back as null.
async function media(p: { chapter_id?: string }) {
  const trySign = async (bucket: string, path?: string | null) => {
    if (!path) return null;
    const { data } = await sb.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
    return data?.signedUrl ?? null;
  };
  const { data: rows } = await sb.from("covers").select("universe_id,image_path")
    .order("chosen", { ascending: false }).order("created_at", { ascending: false });
  const covers: Record<string, string | null> = {};
  for (const r of rows ?? []) if (!(r.universe_id in covers)) covers[r.universe_id] = await trySign("covers", r.image_path);
  let audio_url = null, preview_url = null;
  if (p.chapter_id) {
    const { data: ch } = await sb.from("chapters").select("universe_id,number,audio_path").eq("id", p.chapter_id).single();
    if (ch) {
      audio_url = await trySign("audio", ch.audio_path);
      preview_url = await trySign("audio", `${ch.universe_id}/chapter-${ch.number}-preview.mp3`);
    }
  }
  return { covers, audio_url, preview_url };
}

const ACTIONS: Record<string, (p: any) => Promise<unknown>> = {
  media,
  list_voices: listVoices,
  cast_voices: castVoices,
  narrate,
  cover,
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

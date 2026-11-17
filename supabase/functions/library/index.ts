// Story Universe: library housekeeping (delete a book or a chapter, with its files).
// "Book" is what the family sees; in the database it is a universe.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const PASSCODE = Deno.env.get("FAMILY_PASSCODE");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-family-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(v: unknown, what: string) {
  if (typeof v !== "string" || !UUID.test(v)) throw new Error(`Missing or invalid ${what}`);
  return v;
}

// Remove every file in a bucket folder (one level deep, which is how files are stored).
async function removeFolder(bucket: string, folder: string) {
  let removed = 0;
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(folder, { limit: 100 });
    if (error) throw error;
    const files = (data ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`);
    if (!files.length) return removed;
    const { error: rmErr } = await sb.storage.from(bucket).remove(files);
    if (rmErr) throw rmErr;
    removed += files.length;
    if (files.length < 100) return removed;
  }
}

async function exists(bucket: string, folder: string, name: string) {
  const { data } = await sb.storage.from(bucket).list(folder, { search: name, limit: 10 });
  return (data ?? []).some((f) => f.name === name);
}

async function deleteBook(p: { universe_id: string }) {
  const uid = id(p.universe_id, "book");
  const { data: u, error } = await sb.from("universes").select("id,title").eq("id", uid).single();
  if (error || !u) throw new Error("That book doesn't exist anymore");
  const { data: chs } = await sb.from("chapters").select("id").eq("universe_id", uid);
  const chapterIds = (chs ?? []).map((c) => c.id);
  // Files first, so nothing is left orphaned if a later step fails.
  const audio = await removeFolder("audio", uid);
  const covers = await removeFolder("covers", uid);
  if (chapterIds.length) await sb.from("reviews").delete().eq("subject_type", "chapter").in("subject_id", chapterIds);
  // Cascades to characters, chapters, book_versions, covers and songs.
  const { error: delErr } = await sb.from("universes").delete().eq("id", uid);
  if (delErr) throw delErr;
  return { deleted: "book", title: u.title, chapters: chapterIds.length, files: audio + covers };
}

type Book = { story_so_far?: { chapter: number; summary: string }[] } & Record<string, unknown>;

async function deleteChapter(p: { chapter_id: string }) {
  const cid = id(p.chapter_id, "chapter");
  const { data: ch, error } = await sb.from("chapters").select("id,universe_id,number,title,audio_path").eq("id", cid).single();
  if (error || !ch) throw new Error("That chapter doesn't exist anymore");
  const uid = ch.universe_id;

  // 1. Story memory: if this chapter's update is the newest accepted one, roll back to the one before it.
  //    Otherwise just drop its summary line. Unaccepted proposals for it are discarded either way.
  const { data: versions } = await sb.from("book_versions").select("id,chapter_id,book,accepted,created_at")
    .eq("universe_id", uid).eq("accepted", true).order("created_at", { ascending: false });
  const accepted = versions ?? [];
  let memory = "unchanged";
  if (accepted[0]?.chapter_id === cid && accepted[1]) {
    await sb.from("universes").update({ book: accepted[1].book, updated_at: new Date().toISOString() }).eq("id", uid);
    memory = "rolled back";
  } else if (accepted.some((v) => v.chapter_id === cid)) {
    const { data: u } = await sb.from("universes").select("book").eq("id", uid).single();
    const book = (u?.book ?? {}) as Book;
    if (Array.isArray(book.story_so_far)) {
      book.story_so_far = book.story_so_far
        .filter((s) => s.chapter !== ch.number)
        .map((s) => (s.chapter > ch.number ? { ...s, chapter: s.chapter - 1 } : s));
      await sb.from("universes").update({ book }).eq("id", uid);
      memory = "summary removed";
    }
  }
  await sb.from("book_versions").delete().eq("chapter_id", cid);

  // 2. Its files and reviews, then the row.
  const folderFiles = [`chapter-${ch.number}.mp3`, `chapter-${ch.number}-preview.mp3`];
  const toRemove = folderFiles.map((f) => `${uid}/${f}`);
  if (ch.audio_path && !toRemove.includes(ch.audio_path)) toRemove.push(ch.audio_path);
  await sb.storage.from("audio").remove(toRemove);
  await sb.from("reviews").delete().eq("subject_type", "chapter").eq("subject_id", cid);
  const { error: delErr } = await sb.from("chapters").delete().eq("id", cid);
  if (delErr) throw delErr;

  // 3. Renumber later chapters (ascending, so the unique (universe, number) key never collides)
  //    and move their audio files to match, since previews are found by chapter number.
  const { data: later } = await sb.from("chapters").select("id,number,audio_path").eq("universe_id", uid)
    .gt("number", ch.number).order("number", { ascending: true });
  for (const c of later ?? []) {
    const n = c.number - 1;
    const upd: Record<string, unknown> = { number: n };
    for (const [from, to] of [[`chapter-${c.number}.mp3`, `chapter-${n}.mp3`], [`chapter-${c.number}-preview.mp3`, `chapter-${n}-preview.mp3`]]) {
      if (await exists("audio", uid, from)) {
        await sb.storage.from("audio").move(`${uid}/${from}`, `${uid}/${to}`);
        if (c.audio_path === `${uid}/${from}`) upd.audio_path = `${uid}/${to}`;
      }
    }
    const { error: upErr } = await sb.from("chapters").update(upd).eq("id", c.id);
    if (upErr) throw upErr;
  }
  await sb.from("universes").update({ updated_at: new Date().toISOString() }).eq("id", uid);
  return { deleted: "chapter", title: ch.title, universe_id: uid, renumbered: (later ?? []).length, memory };
}

const ACTIONS: Record<string, (p: any) => Promise<unknown>> = {
  delete_book: deleteBook,
  delete_chapter: deleteChapter,
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

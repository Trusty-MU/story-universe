// Story Universe: story engine.
// One function, many actions. The app sends { action, ...params }.
// All database access uses the service role; tables have RLS with no policies.

import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const PASSCODE = Deno.env.get("FAMILY_PASSCODE"); // when set, every request must send it

const WRITER_MODEL = "claude-sonnet-5-5";
const FAST_MODEL = "claude-haiku-5-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-family-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ---------- Claude helper (JSON schema structured outputs) ----------

type Tool = { name: string; description: string; input_schema: Record<string, unknown> };

// Structured outputs require additionalProperties: false on every object.
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

async function claude(opts: { model?: string; system: string; prompt: string; tool: Tool; maxTokens?: number }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? WRITER_MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      output_config: { format: { type: "json_schema", schema: strict(opts.tool.input_schema) } },
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

// ---------- Family context and house rules ----------

type Member = { id: string; name: string; role: string; birth_month: string | null; notes: string | null };

function age(m: Member): number | null {
  if (!m.birth_month) return null;
  const years = (Date.now() - Date.parse(m.birth_month)) / (365.25 * 864e5);
  return Math.round(years * 10) / 10;
}

async function family(): Promise<Member[]> {
  const { data, error } = await sb.from("family_members").select("id,name,role,birth_month,notes");
  if (error) throw error;
  return data as Member[];
}

function familyText(members: Member[]) {
  return members
    .map((m) => {
      const a = age(m);
      return `- ${m.name} (${m.role}${a !== null ? `, age ${a}` : ""})${m.notes ? `: ${m.notes}` : ""}`;
    })
    .join("\n");
}

const VALUES = `FAMILY VALUES
This is a Christian family. Every story must fit a Christian worldview.
- Celebrate kindness, honesty, courage, gratitude, forgiveness, sharing, obedience to parents, and loving siblings.
- Imaginative fantasy is welcome (talking animals, faraway lands, inventions, wonders).
- Never present witchcraft, sorcery, spirits, or the occult as good or as a source of power. No mocking of faith.
- No crude or potty humor, no name-calling that goes unaddressed, no disrespect toward parents that is rewarded.
- No romance, no real-world weapons, no violence beyond gentle cartoon bumps, nothing kids could copy that is unsafe.`;

function ageGuide(a: number | null) {
  if (a === null) return "Write for ages 3 to 7.";
  if (a < 2.5)
    return `The main listener is about ${a}. Use very simple sentences, sounds, repetition and gentle rhythm. About 300 words.`;
  if (a < 5)
    return `The main listener is about ${a}. Short scenes, simple sentences, lots of repetition and a fun refrain, one clear problem solved by the end, gentle humor, no villains beyond mild mischief, never separated from family for long. About 600 words.`;
  return `The main listener is about ${a}. A real quest with teamwork, problem solving and humor, mild suspense that always resolves safely, characters who make choices and learn. About 1,100 to 1,400 words.`;
}

const LENGTH_WORDS: Record<string, string> = {
  short: "About 500 words.",
  medium: "About 900 words.",
  long: "About 1,400 words.",
};

const BEDTIME_RULES = `BEDTIME MODE
This chapter is heard at bedtime. Keep the energy low and cozy: no cliffhanger, no chases, no loud moments, no peril. Slow the pace in the second half. End with everyone safe, settled and sleepy, with a warm, calm final line.`;

const SCRIPT_RULES = `SCRIPT FORMAT
Write the chapter as a narration script for multi-voice audio.
- Each line has a speaker and text. The speaker is "NARRATOR" or the exact name of a character in the cast.
- The narrator carries the story. Dialogue lines are short and natural for each character's age and personality.
- Start most lines with one audio tag in square brackets to direct delivery, for example [warmly], [softly], [excited], [whispers], [giggles], [gasps], [curious], [slowly], [proudly], [yawns]. Use at most one more tag inside a line. Tags describe how a line sounds (emotion, volume, pace, a laugh, a sigh, a yawn), never a physical action like [pointing] or [clapping]. Never put words meant to be spoken inside brackets.
- Keep each line under 400 characters.
- Use the kids' real names for their characters. Include every family kid in the cast in some way.
- Never invent a family surname or new facts about the real family beyond the family profile and the parent's brief.`;

// ---------- Tool schemas ----------

const bookSchema = {
  type: "object",
  properties: {
    premise: { type: "string" },
    setting: { type: "string" },
    tone: { type: "string" },
    world_rules: { type: "array", items: { type: "string" } },
    story_so_far: {
      type: "array",
      items: { type: "object", properties: { chapter: { type: "integer" }, summary: { type: "string" } }, required: ["chapter", "summary"] },
    },
    quests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          goal: { type: "string" },
          done: { type: "array", items: { type: "string" } },
          next: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["active", "complete"] },
        },
        required: ["goal", "done", "next", "status"],
      },
    },
    open_threads: { type: "array", items: { type: "string" } },
    running_details: { type: "array", items: { type: "string" } },
    lessons_taught: { type: "array", items: { type: "string" } },
  },
  required: ["premise", "setting", "tone", "world_rules", "story_so_far", "quests", "open_threads", "running_details", "lessons_taught"],
};

const characterSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    family_member: { type: "string", description: "Name of the real family member this character is, or empty" },
    description: { type: "string" },
    personality: { type: "string" },
    look: { type: "string", description: "Visual description for illustration" },
  },
  required: ["name", "family_member", "description", "personality", "look"],
};

const scriptSchema = {
  type: "array",
  items: { type: "object", properties: { speaker: { type: "string" }, text: { type: "string" } }, required: ["speaker", "text"] },
};

const TOOLS = {
  universe: {
    name: "save_universe",
    description: "Save a new story universe",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        book: bookSchema,
        characters: { type: "array", items: characterSchema },
        art_style: { type: "string", description: "A specific illustration style for the cover, not a generic 3D animated look" },
        theme_song_idea: { type: "string" },
      },
      required: ["title", "book", "characters", "art_style", "theme_song_idea"],
    },
  },
  restate: {
    name: "save_restatement",
    description: "Save the restated idea",
    input_schema: {
      type: "object",
      properties: {
        for_kid: { type: "string", description: "Two to four short sentences, said back to the child, ending with 'Did I get that right?'" },
        for_parent: { type: "string", description: "One-paragraph summary of the idea for the parent" },
        story_elements: { type: "array", items: { type: "string" } },
        best_universe: { type: "string", description: "Title of the existing universe it fits best, or NEW" },
      },
      required: ["for_kid", "for_parent", "story_elements", "best_universe"],
    },
  },
  chapter: {
    name: "save_chapter",
    description: "Save the chapter script",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string", description: "Two sentences for the parent" },
        script: scriptSchema,
        new_characters: { type: "array", items: characterSchema },
      },
      required: ["title", "summary", "script", "new_characters"],
    },
  },
  review: {
    name: "save_review",
    description: "Save the safety and values review",
    input_schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["pass", "fix", "block"] },
        scores: {
          type: "object",
          description: "1 is best, 5 is worst for scariness and stimulation; 5 is best for the others",
          properties: {
            scariness: { type: "integer" },
            stimulation: { type: "integer" },
            age_fit: { type: "integer" },
            values_fit: { type: "integer" },
            continuity: { type: "integer" },
          },
          required: ["scariness", "stimulation", "age_fit", "values_fit", "continuity"],
        },
        reasons: {
          type: "array",
          items: {
            type: "object",
            properties: { issue: { type: "string" }, line: { type: "integer" }, severity: { type: "string", enum: ["low", "medium", "high"] } },
            required: ["issue", "severity"],
          },
        },
        fix_instructions: { type: "string" },
      },
      required: ["verdict", "scores", "reasons", "fix_instructions"],
    },
  },
  bookUpdate: {
    name: "save_book_update",
    description: "Save the updated universe book",
    input_schema: {
      type: "object",
      properties: { book: bookSchema, changes: { type: "array", items: { type: "string" } } },
      required: ["book", "changes"],
    },
  },
} satisfies Record<string, Tool>;

// ---------- Data helpers ----------

async function loadUniverse(id: string) {
  const { data: u, error } = await sb.from("universes").select("*").eq("id", id).single();
  if (error) throw error;
  const { data: chars } = await sb.from("characters").select("*").eq("universe_id", id);
  return { ...u, characters: chars ?? [] };
}

function castText(chars: { name: string; description: string; personality: string }[]) {
  return chars.map((c) => `- ${c.name}: ${c.description} Personality: ${c.personality}`).join("\n");
}

async function saveCharacters(universeId: string, chars: Record<string, string>[], members: Member[]) {
  if (!chars?.length) return;
  const rows = chars.map((c) => ({
    universe_id: universeId,
    name: c.name,
    family_member_id: members.find((m) => m.name.toLowerCase() === (c.family_member ?? "").toLowerCase())?.id ?? null,
    description: c.description,
    personality: c.personality,
    look: c.look,
  }));
  const { error } = await sb.from("characters").upsert(rows, { onConflict: "universe_id,name", ignoreDuplicates: true });
  if (error) throw error;
}

// ---------- Actions ----------

async function createUniverse(p: { idea: string; main_kid?: string; title?: string; notes?: string }) {
  const members = await family();
  const main = members.find((m) => m.name === p.main_kid);
  const out = await claude({
    system: `You design story universes for a family audio-story app. You create a living "universe book" that a writer will use to keep every future chapter consistent.\n\nFAMILY\n${familyText(members)}\n\n${VALUES}`,
    prompt: `Create a new story universe from this idea.\n\nIDEA: ${p.idea}\n${p.title ? `TITLE WISH: ${p.title}\n` : ""}${main ? `MAIN LISTENER: ${main.name}\n${ageGuide(age(main))}\n` : ""}${p.notes ? `PARENT NOTES: ${p.notes}\n` : ""}
Include Levi, Lydia and Luke as characters, each true to their age. Add up to three invented characters. Give the universe one overall quest with three to five steps that can unfold over many chapters. story_so_far starts empty. Choose a distinctive illustration style (for example watercolor storybook, gouache, cut-paper collage, linocut, colored pencil, mid-century illustration) instead of a generic 3D animated look.`,
    tool: TOOLS.universe,
    maxTokens: 8000,
  });
  const { data: u, error } = await sb
    .from("universes")
    .insert({ title: out.title, main_kid_id: main?.id ?? null, book: out.book, art_style: out.art_style })
    .select()
    .single();
  if (error) throw error;
  await saveCharacters(u.id, out.characters, members);
  await sb.from("book_versions").insert({ universe_id: u.id, book: out.book, changes: ["Universe created"], accepted: true });
  return { universe: await loadUniverse(u.id), theme_song_idea: out.theme_song_idea };
}

async function restateIdea(p: { text: string; kid?: string }) {
  const members = await family();
  const { data: universes } = await sb.from("universes").select("title");
  const kid = members.find((m) => m.name === p.kid);
  return await claude({
    model: FAST_MODEL,
    system: `You help a parent capture a child's story idea. Children ramble; find what they actually want in the story. ${VALUES}`,
    prompt: `${kid ? `${kid.name} (age ${age(kid)})` : "A child"} shared this story idea (it may be a rough voice transcript):\n\n"${p.text}"\n\nExisting universes: ${(universes ?? []).map((u) => u.title).join(", ") || "none yet"}.\nRestate it back to the child in their own excited words, simple enough for their age.`,
    tool: TOOLS.restate,
    maxTokens: 3000,
  });
}

type Brief = {
  main_kid?: string;
  bedtime?: boolean;
  length?: "short" | "medium" | "long";
  real_life?: string[];
  idea?: string;
  notes?: string;
};

async function writeChapter(p: { universe_id: string; brief?: Brief }) {
  const brief = p.brief ?? {};
  const members = await family();
  const u = await loadUniverse(p.universe_id);
  const main = members.find((m) => m.name === brief.main_kid) ?? members.find((m) => m.id === u.main_kid_id);
  const { data: last } = await sb
    .from("chapters").select("number,script").eq("universe_id", u.id).order("number", { ascending: false }).limit(1);
  const number = (last?.[0]?.number ?? 0) + 1;
  const prevEnding = last?.[0]?.script ? (last[0].script as { speaker: string; text: string }[]).slice(-6).map((l) => `${l.speaker}: ${l.text}`).join("\n") : "";

  const out = await claude({
    system: `You are a warm, gifted children's audio-story writer, in the spirit of the best kids' story podcasts. You write chapters for one family's ongoing story universe.\n\nFAMILY\n${familyText(members)}\n\n${VALUES}\n\n${SCRIPT_RULES}`,
    prompt: `UNIVERSE: ${u.title}
UNIVERSE BOOK (the source of truth for continuity):
${JSON.stringify(u.book, null, 1)}

CAST
${castText(u.characters)}

${prevEnding ? `HOW THE LAST CHAPTER ENDED\n${prevEnding}\n\n` : ""}WRITE CHAPTER ${number}.
${ageGuide(main ? age(main) : null)}${brief.length ? ` Target length: ${LENGTH_WORDS[brief.length]}` : ""}
${main ? `Make ${main.name} central to this chapter.` : ""}
${brief.bedtime ? BEDTIME_RULES : "Daytime listening: a little more energy is fine, and a gentle cliffhanger is allowed."}
${brief.idea ? `KID'S IDEA TO INCLUDE: ${brief.idea}` : "No new idea: continue the story naturally and move the quest forward one step."}
${brief.real_life?.length ? `WEAVE IN FROM REAL LIFE (naturally, not as a lecture): ${brief.real_life.join("; ")}` : ""}
${brief.notes ? `PARENT NOTES: ${brief.notes}` : ""}
Stay consistent with the universe book: names, world rules, what has already happened, and open threads. Do not repeat a lesson already taught unless asked.`,
    tool: TOOLS.chapter,
    maxTokens: 12000,
  });

  await saveCharacters(u.id, out.new_characters, members);
  const { data: ch, error } = await sb
    .from("chapters")
    .insert({ universe_id: u.id, number, title: out.title, brief: { ...brief, main_kid: main?.name, summary: out.summary }, script: out.script, status: "draft" })
    .select()
    .single();
  if (error) throw error;
  return ch;
}

function parentAsks(brief: Brief | null | undefined) {
  const items = [...(brief?.real_life ?? []), brief?.idea ? `Kid's idea: ${brief.idea}` : "", brief?.notes ? `Notes: ${brief.notes}` : ""].filter(Boolean);
  if (!items.length) return "";
  return `PARENT REQUESTED (allowed; do not ask to remove these, only check they are handled gently and age-appropriately):\n- ${items.join("\n- ")}`;
}

async function reviewChapter(p: { chapter_id: string }) {
  const members = await family();
  const { data: ch, error } = await sb.from("chapters").select("*").eq("id", p.chapter_id).single();
  if (error) throw error;
  const u = await loadUniverse(ch.universe_id);
  const main = members.find((m) => m.name === ch.brief?.main_kid);
  const out = await claude({
    system: `You are the safety and values reviewer for a family audio-story app. You protect young children. Be strict: when in doubt, choose "fix". Use "block" only for content that should never be heard. You are not the writer and you do not praise.\n\nFAMILY\n${familyText(members)}\n\n${VALUES}`,
    prompt: `Review this chapter script.

LISTENERS: ${main ? `${main.name}, age ${age(main)}` : "kids 1 to 7"}, plus younger siblings may hear it.
${ch.brief?.bedtime ? BEDTIME_RULES : "Daytime listening."}
${parentAsks(ch.brief)}

CHECK
1. Scariness for the youngest likely listener (peril, darkness, separation from parents, villains, loud surprises).
2. Stimulation level, especially for bedtime.
3. Age fit: vocabulary, length, complexity.
4. Values fit with the family values.
5. Continuity with the universe book (names, rules, past events).
6. Anything unsafe a child could copy, or anything mean that goes unaddressed.
7. Script rules: valid speakers, audio tags used correctly.

UNIVERSE BOOK
${JSON.stringify(u.book)}
CAST: ${u.characters.map((c: { name: string }) => c.name).join(", ")}

SCRIPT (line numbers start at 0)
${(ch.script as { speaker: string; text: string }[]).map((l, i) => `${i}. ${l.speaker}: ${l.text}`).join("\n")}

Choose "pass" when every remaining issue is low severity (list them anyway so the parent can see them). Choose "fix" only for medium or high severity issues, and give concrete fix_instructions a writer can follow. If "pass", fix_instructions is empty.`,
    tool: TOOLS.review,
    maxTokens: 8000,
  });

  await sb.from("reviews").insert({
    subject_type: "chapter", subject_id: ch.id, verdict: out.verdict, reasons: out.reasons, suggested_fix: out.fix_instructions,
  });
  const status = out.verdict === "pass" ? "draft" : out.verdict === "fix" ? "needs_fix" : "blocked";
  await sb.from("chapters").update({ review: out, status }).eq("id", ch.id);
  return { chapter_id: ch.id, status, review: out };
}

async function reviseChapter(p: { chapter_id: string; feedback?: string }) {
  const members = await family();
  const { data: ch, error } = await sb.from("chapters").select("*").eq("id", p.chapter_id).single();
  if (error) throw error;
  if (ch.status === "approved" || ch.status === "produced") throw new Error("Approved chapters can't be revised");
  const u = await loadUniverse(ch.universe_id);
  const instructions = [ch.review?.fix_instructions, p.feedback].filter(Boolean).join("\nParent feedback: ");
  if (!instructions) throw new Error("Nothing to revise: no review fixes or feedback");
  const out = await claude({
    system: `You are a children's audio-story writer revising a chapter. Keep everything that works; change only what the notes require.\n\nFAMILY\n${familyText(members)}\n\n${VALUES}\n\n${SCRIPT_RULES}`,
    prompt: `UNIVERSE BOOK\n${JSON.stringify(u.book)}\nCAST\n${castText(u.characters)}\n\n${ch.brief?.bedtime ? BEDTIME_RULES : ""}\n\nCURRENT SCRIPT (chapter ${ch.number}: ${ch.title})\n${JSON.stringify(ch.script)}\n\nREVISION NOTES\n${instructions}\n\nReturn the full revised chapter.`,
    tool: TOOLS.chapter,
    maxTokens: 12000,
  });
  await saveCharacters(u.id, out.new_characters, members);
  await sb.from("chapters").update({
    title: out.title, script: out.script, status: "draft", review: null, brief: { ...ch.brief, summary: out.summary },
  }).eq("id", ch.id);
  return { chapter_id: ch.id, title: out.title, summary: out.summary };
}

async function approveChapter(p: { chapter_id: string; override?: boolean }) {
  const { data: ch, error } = await sb.from("chapters").select("*").eq("id", p.chapter_id).single();
  if (error) throw error;
  const passed = ch.status === "draft" && ch.review?.verdict === "pass";
  const overridable = p.override === true && ch.status === "needs_fix"; // parent may approve over "fix", never over "block"
  if (!passed && !overridable) throw new Error("Only a chapter that passed review can be approved (a parent can override a 'fix', never a 'block')");
  if (overridable) await sb.from("reviews").insert({ subject_type: "chapter", subject_id: ch.id, verdict: "pass", reasons: [{ issue: "Parent approved over reviewer's fix request", severity: "low" }] });
  const u = await loadUniverse(ch.universe_id);
  const out = await claude({
    system: "You maintain the universe book for a family's ongoing audio-story series. The book must stay complete but concise: a future writer reads only the book, never the old chapters.",
    prompt: `CURRENT BOOK\n${JSON.stringify(u.book, null, 1)}\n\nNEW CHAPTER ${ch.number}: ${ch.title}\n${(ch.script as { speaker: string; text: string }[]).map((l) => `${l.speaker}: ${l.text}`).join("\n")}\n\nUpdate the book: add a one or two sentence summary for this chapter to story_so_far, update quest progress (move steps from next to done), add or close open threads, add new running details (places, objects, jokes, names), and add any lesson taught. Keep every existing fact unless this chapter changed it. List each change in plain words.`,
    tool: TOOLS.bookUpdate,
    maxTokens: 10000,
  });
  await sb.from("chapters").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", ch.id);
  const { data: v } = await sb
    .from("book_versions").insert({ universe_id: u.id, chapter_id: ch.id, book: out.book, changes: out.changes, accepted: false }).select().single();
  return { chapter_id: ch.id, book_version_id: v?.id, changes: out.changes };
}

async function acceptBookUpdate(p: { book_version_id: string }) {
  const { data: v, error } = await sb.from("book_versions").select("*").eq("id", p.book_version_id).single();
  if (error) throw error;
  await sb.from("universes").update({ book: v.book, updated_at: new Date().toISOString() }).eq("id", v.universe_id);
  await sb.from("book_versions").update({ accepted: true }).eq("id", v.id);
  return { universe_id: v.universe_id, accepted: true };
}

async function listUniverses() {
  const { data, error } = await sb
    .from("universes").select("id,title,art_style,updated_at,chapters(id,number,title,status)").order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function getChapter(p: { chapter_id: string }) {
  const { data, error } = await sb.from("chapters").select("*").eq("id", p.chapter_id).single();
  if (error) throw error;
  return data;
}

async function getUniverse(p: { universe_id: string }) {
  const u = await loadUniverse(p.universe_id);
  const { data: chapters } = await sb.from("chapters").select("id,number,title,status,brief").eq("universe_id", u.id).order("number");
  const { data: pending } = await sb.from("book_versions").select("id,changes,created_at").eq("universe_id", u.id).eq("accepted", false);
  return { ...u, chapters, pending_book_updates: pending };
}

const ACTIONS: Record<string, (p: any) => Promise<unknown>> = {
  create_universe: createUniverse,
  restate_idea: restateIdea,
  write_chapter: writeChapter,
  review_chapter: reviewChapter,
  revise_chapter: reviseChapter,
  approve_chapter: approveChapter,
  accept_book_update: acceptBookUpdate,
  list_universes: listUniverses,
  get_universe: getUniverse,
  get_chapter: getChapter,
  family: family,
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

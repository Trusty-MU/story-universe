# Story Universe: handoff for Claude Code

The app is called **Campfire** in everything the family sees (title, home screen, splash); the repo, Supabase project and code names stay "Story Universe". A family app for Blake: turn the family's story ideas (from a kid or a grown-up) into ongoing "universes" with reviewed chapters, multi-voice narrated episodes, short theme songs and book covers. MVP is for one family only: no logins, no payments, parent-operated, played over a speaker.

- Living MVP spec (Claude Docs): https://claude.ai/artifact/8aGwjQ7r9QdGwEzS1YnT3J
- Claude project "Kids Story App" has `claude/product-discovery-notes.md` with all product decisions and parked ideas.

## Family and values (drives every prompt)
- Kids (ages as of Nov 2026): Levi 6.5, Lydia 3.5, Luke ~1.9. Blake (dad) travels for work; Mom is home base.
- Christian family. Nothing may conflict with a Christian worldview. Imaginative fantasy is fine; no witchcraft or occult presented as good.
- Every generated item gets a safety and values review. Parents approve before kids hear anything. A parent may override a "fix" verdict, never a "block".
- Bedtime mode: calm, no cliffhangers, sleepy ending.

## Brand: Campfire (keep every screen, prompt and doc consistent with this)
- **Name and idea.** The app is Campfire. People have always gathered round a fire to be together and share stories; that circle is the heart of the brand. Campfire brings that circle to bedtime, even on nights someone is far from home. It's about the people you love inside stories that become memories, not about the software.
- **Who it's for.** Grown-ups run it (Mom at home, Dad traveling, later grandparents); kids are the listeners and often the idea-makers. **Anyone in the family can start a story**: a kid's wild idea, a lesson a parent wants to teach, something from today. Never write copy that assumes only a kid (or only a parent) tells the idea. Say "add a story idea", "anyone can start a story".
- **What it makes possible (the big picture to keep telling):** ongoing books that remember characters, places and quests; lessons and real life woven in (kindness, courage, school topics, Dad's travels); a short theme song per book (built: lullaby, sing-along or adventure, 1:30 to 2:30, checked before recording); a grown-up check before anything plays; one voice per character; a Library the kids keep when they're grown.
- **Core loop and words.** Tell → Written → Checked → Recorded (the 4-stop "story path" shown on every chapter). Words we use: Tell, Book, Chapter, Library, Crew, Goodnight, Gather round. **Never say "universe" to the family**: every idea becomes a new **book** or the next **chapter** of an existing one. The running memory of a book (code: "universe book", `book` jsonb) is called **story memory** on screen. "Universe" stays only in code, tables and API names. Words we never use: generate, content, AI-powered, magic, personalized, engagement, screen time, smart, seamless, unlock, empower.
- **Voice.** Short, concrete, warm not sweet. Sentence case; caps only on small kicker labels. No emoji. Write to the grown-up. Nostalgia by scene, never by statement. **The software never gets the verb**: people tell, hear, approve; Campfire writes it down and remembers. Primary buttons are verbs ("What happens next?", "Record it for tonight", "Gather round").
- **The AI line, said plainly, once (tutorial card 5):** "You give the idea, the people and the lesson. Campfire uses AI to write it down and read it aloud, like a scribe. It never makes up a story on its own." A grown-up hears every chapter first.
- **Visual system.** Campfire Design System (Blake's): https://claude.ai/artifact/9wWUgU1QxuEhkKtjdXqqZ4. Paper `#fbf3e4` ground, Bark `#4a3323` text, Ember `#f0632b` one primary action per screen, Flame `#ffb703`, Pine `#2e7d5b` done/approved, Lake `#2d7fb8` links/away, Night `#1b2233` only while a story plays (with the ember glow). Fredoka display, Figtree body, Fraunces for story text only. Flat: no shadows, no gradients except the ember glow; pills for anything pressable; flat paper-cut shapes for illustration. UI directions canvas (B was chosen): https://claude.ai/artifact/DJFvZSDah3p3Ps1h67Z9iF.
- **Tutorial storyboard (`web/intro.js`), the pitch and the how-to in one, shown on every app open unless switched off:**
  1. *Why Campfire* (night): "People have always gathered round a fire." Family circle gathers round a fire under the stars; Campfire brings that circle to bedtime.
  2. *1 · Tell*: "Anyone can start a story." Bubbles from kids and grown-ups.
  3. *2 · Written*: "Every idea becomes a book" (a new book, or the next chapter of one you already love). Chapters fan out behind a cover; quest steps fill.
  4. *Make it yours*: "Lessons inside. Songs to sing along."
  5. *3 · Checked*: "A grown-up hears it first," plus the AI line.
  6. *4 · Recorded* (night): "Hear it tonight. Keep it forever." Library shelf fills; button "Gather round".
  The splash says "Campfire / Tell it. Check it. Hear it tonight."

## Infrastructure
- Supabase project "Story Universe", ref `bxrifunbkyhnzpstkgxw`, org "Trusty" (free plan), us-east-1.
- Edge Function secrets (set by Blake, never in chat or code): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`. `FAMILY_PASSCODE` is set (Nov 16, 2026): every request must send it in the `x-family-passcode` header. Blake knows the value; never write it into the repo.
- Database: see `supabase/migrations/`. RLS on, no policies: only Edge Functions (service role) touch data. Storage buckets are private (`family-photos`, `audio`, `covers`, `captures`); the app gets signed URLs.
- ElevenLabs: Starter plan, 90,000 credits/month (reset ~Dec 3). Key permissions include voices, models, user read, TTS, dialogue, music.
- OpenAI: org verified; GPT Image 2.x models available.
- Hosting plan: GitHub Pages from `Trusty-MU/story-universe` (public repo, Pages source = GitHub Actions). The app is static and calls the Edge Functions.

## Edge Functions
### `story` (supabase/functions/story/index.ts)
POST `{ action, ...params }`. Actions: `create_universe`, `restate_idea`, `write_chapter`, `review_chapter`, `revise_chapter`, `approve_chapter` (optional `override`), `accept_book_update`, `list_universes`, `get_universe`, `get_chapter`, `family`.
- Models: `claude-sonnet-5-5` (writing, review, book updates), `claude-haiku-5-5` (restating kid ideas).
- Structured output uses `output_config.format` JSON schema. Forced `tool_choice` is NOT supported on these models (returns 400). The `strict()` helper adds `additionalProperties: false` everywhere.
- The reviewer receives the parent's brief (`parentAsks`) so it doesn't strip requested real-life details.
- Flow: write -> review -> (revise -> review)* -> approve (proposes a book update) -> accept_book_update.
- Each Claude call takes 30 to 90 seconds; the free plan's request limit is ~150 s, so keep one Claude call per request.

### `produce` (supabase/functions/produce/index.ts)
Actions: `media` (signed URLs: current cover per universe, plus `audio_url`/`preview_url` for an optional `chapter_id`), `list_voices`, `cast_voices`, `narrate` (`max_lines` for previews), `cover`.
- Narration: ElevenLabs `POST /v1/text-to-dialogue`, `model_id: eleven_v4`, per-line `voice_id`, universe `voice_seed`. Max 2,000 chars per request, so the script is chunked at 1,800, up to 3 chunks are requested in parallel, and MP3s are concatenated in order.
- Covers: OpenAI `gpt-image-2.5-sunburst`, 1024x1536, medium quality, PNG; returns base64 only.
- Not built yet: theme songs (ElevenLabs Music with section plan + length cap ~1:30 to 2:30; Suno as copy-paste), kids' photos as cover references, safety review of image prompts and lyrics.

### `family` (supabase/functions/family/index.ts)
Actions: `list` (kids first, youngest first, then parents and others), `add` (`{name, role: kid|parent|other, birth_month?: 'YYYY-MM', notes?}`; validates, friendly error on duplicate names), `update` (`{id, ...fields}`). Same passcode check. The app uses it for the family chips and the "+ Add someone" sheet on Capture and Chapter studio.

### `library` (supabase/functions/library/index.ts)
Delete actions (the app shows "Delete this book" at the bottom of a book page and "Delete this chapter" at the bottom of a chapter page, each behind a confirm sheet):
- `delete_book` `{universe_id}`: removes the folder's files in `audio` and `covers`, the chapter reviews, then the universe row (cascades to characters, chapters, book_versions, covers, songs).
- `delete_chapter` `{chapter_id}`: story memory first (if this chapter's accepted update is the newest, roll `universes.book` back to the previous accepted version; otherwise drop its `story_so_far` line and shift later numbers), deletes its book_versions, audio files and reviews, then renumbers later chapters down by one and moves their `chapter-N.mp3` / `chapter-N-preview.mp3` files to match.
- Tested Nov 17, 2026 on a throwaway book (DB logic, renumbering and memory rollback). File removal and moves have not yet run against real recordings.

### `songs` (supabase/functions/songs/index.ts)
Theme songs per book, on their own short path: Written → Checked → Recorded. Actions: `list` (`universe_id?`), `get`, `write` (`{universe_id, brief: {mood: lullaby|singalong|adventure, length: short|medium|long (90/120/150 s), for_kid?, notes?}}`), `review`, `revise` (`feedback?`), `approve` (`override?`, a "fix" only, never a "block"), `record` (`max_seconds?` makes a short test sample), `upload_url` + `attach_upload` (Suno MP3 uploaded straight to storage with a signed upload URL), `delete`.
- Lyrics: `claude-sonnet-5-5` from the story memory and characters, with the family values and song rules (original lyrics only, short singable lines, repeated chorus, real kid names). Sections with seconds are stored in `songs.sections`; durations are fitted so the total is exactly the target.
- Recording: ElevenLabs Music `POST /v1/music`, `model_id: music_v1`, `composition_plan` (`positive_global_styles`, `negative_global_styles`, `sections[]` with `section_name`, `duration_ms` 3,000 to 120,000, `lines`), `respect_sections_durations: true`. Cost: 900 credits per minute (a 2:00 song is about 1,800 credits). A 12 s test took about 4 s.
- Files: `audio/<universe_id>/song-<id>.mp3` (ElevenLabs), `-suno.mp3` (upload), `-sample.mp3` (test). Deleting a book removes them with the folder.
- Columns added Nov 17, 2026 (`supabase/migrations/20261117000000_songs_workflow.sql`): `status`, `review`, `brief`, `sections`, `approved_at`, `updated_at`.
- App: book page has a Songs list and "Write a theme song" (`#/u/:id/song`); song page `#/s/:id` (check card, the words, record, Copy for Suno, Add the Suno MP3, delete); player `#/play/song/:id` (the same night player as chapters); Library has a Songs tab; Tonight shows "Sing first" chips once a song is recorded.

### `check-secrets`
Reports only whether each secret is set. Safe to delete later.

## Testing from SQL (no direct network from some sandboxes)
`select dev.call_story('{"action":"..."}'::jsonb);` returns a pg_net request id; read the result with `select status_code, content from net._http_response where id = <id>;` after the call finishes. `dev.call_produce` is the same for `produce`. Now that the passcode is set, use the two-argument versions: `dev.call_story(body, '<passcode>')`.

## Test data in the database
Universe "The Lamplighters of Pebble Point" (`99f5f72a-f033-4506-b699-ebcdf3c1b8ea`): chapter 1 approved and book updated; chapter 2 (`4c69ba45-b4f5-4489-bc40-70ac5b42f136`, Lydia, bedtime) passed review, awaiting approval. Voices cast (narrator George `JBFqnCBsd6RMkjVDRZzb`; Blake's account also has "Blake V's Voice" `7N7SaJuJfuF87NUrzhvl` and a designed "Lydia" voice `OSEHFvgeHaiMsiMlCLQK`). One cover generated; a 72-second chapter 2 preview narrated.

## Known issues and next steps
1. Chapter 1 asks Mom permission twice (revision artifact). Consider a "tighten" pass or telling the reviser not to duplicate beats.
2. Done: mobile web app in `web/` (vanilla JS, no build), deployed by `.github/workflows/pages.yml` from `main`. Design: Campfire design system, canvas Direction B "the story path" (https://claude.ai/artifact/DJFvZSDah3p3Ps1h67Z9iF). Light paper UI, Night only on the player, one ember action per screen in a bottom dock above four tabs: Tonight (play next, chapters that need a grown-up), Library (Books grid, episodes), Tell (who's telling, mic, say it back, pick where it goes), Crew (family list, add/edit via `family`). Universe page shows each chapter on a 4-stop path (Told, Written, Checked, Recorded) with its next step; Studio writes then checks; the Chapter page shows only the next step (check, approve/ask for a change, fix/keep anyway, record/sample, play). Player: night with ember glow, sleep timer, lock-screen controls, resume. Startup: animated splash (inline in `index.html`, min 1.5 s, leaves when the first screen has data), then a 6-card animated tutorial (`web/intro.js`, storyboard in Brand above) on every open unless switched off on its last card (`localStorage` key `intro.skip`); "How it works" on Tonight replays it. Cache busting: asset URLs carry `?v=__V__`, which the Pages workflow replaces with the commit SHA (Pages serves `max-age=600`, and phones were showing stale JS). Keep the `?v=__V__` suffix on any new script, stylesheet or module import. Lists look up reviews for draft chapters via `get_chapter` so "passed" drafts read "Next: approve".
3. Done: `FAMILY_PASSCODE` set.
4. Done: theme songs (see `songs` above). Next: voice design for kid voices, optional Blake narrator voice.
5. Import past stories from ChatGPT and Claude data exports plus Suno MP3s (Blake will provide later).
6. Measure cost per full episode (Claude + ElevenLabs credits + image).
7. story `create_universe` prompt hardcodes "Include Levi, Lydia and Luke"; new kids added via the `family` function won't be auto-included until that prompt reads kids from `family_members`.
8. `restate_idea` (story function) always words the say-back for a child (`for_kid`), even when a grown-up added the idea. Make it adapt to who added it (role from `family_members`).
9. Done: theme songs are built, so the tutorial's song card is true. Not yet run end to end in the app: a full ElevenLabs recording and a Suno MP3 attach (the signed upload itself was tested).

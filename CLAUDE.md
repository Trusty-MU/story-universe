# Story Universe: handoff for Claude Code

A family app for Blake: turn his kids' story ideas into ongoing "universes" with reviewed chapters, multi-voice narrated episodes, short theme songs and book covers. MVP is for one family only: no logins, no payments, parent-operated, played over a speaker.

- Living MVP spec (Claude Docs): https://claude.ai/artifact/8aGwjQ7r9QdGwEzS1YnT3J
- Claude project "Kids Story App" has `claude/product-discovery-notes.md` with all product decisions and parked ideas.

## Family and values (drives every prompt)
- Kids (ages as of Nov 2026): Levi 6.5, Lydia 3.5, Luke ~1.9. Blake (dad) travels for work; Mom is home base.
- Christian family. Nothing may conflict with a Christian worldview. Imaginative fantasy is fine; no witchcraft or occult presented as good.
- Every generated item gets a safety and values review. Parents approve before kids hear anything. A parent may override a "fix" verdict, never a "block".
- Bedtime mode: calm, no cliffhangers, sleepy ending.

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

### `check-secrets`
Reports only whether each secret is set. Safe to delete later.

## Testing from SQL (no direct network from some sandboxes)
`select dev.call_story('{"action":"..."}'::jsonb);` returns a pg_net request id; read the result with `select status_code, content from net._http_response where id = <id>;` after the call finishes. `dev.call_produce` is the same for `produce`. Now that the passcode is set, use the two-argument versions: `dev.call_story(body, '<passcode>')`.

## Test data in the database
Universe "The Lamplighters of Pebble Point" (`99f5f72a-f033-4506-b699-ebcdf3c1b8ea`): chapter 1 approved and book updated; chapter 2 (`4c69ba45-b4f5-4489-bc40-70ac5b42f136`, Lydia, bedtime) passed review, awaiting approval. Voices cast (narrator George `JBFqnCBsd6RMkjVDRZzb`; Blake's account also has "Blake V's Voice" `7N7SaJuJfuF87NUrzhvl` and a designed "Lydia" voice `OSEHFvgeHaiMsiMlCLQK`). One cover generated; a 72-second chapter 2 preview narrated.

## Known issues and next steps
1. Chapter 1 asks Mom permission twice (revision artifact). Consider a "tighten" pass or telling the reviser not to duplicate beats.
2. Done: phase 1 mobile web app in `web/` (vanilla JS, no build). Deployed by `.github/workflows/pages.yml`. Screens: passcode, Library, Capture (dictation via Web Speech API, restate, read aloud), Universe (book, quests, voices, covers, book updates), Chapter studio (write then auto review), Review (verdict, scores, revise, approve/override, narrate preview/full), Player (lock screen controls, sleep timer, resume).
3. Done: `FAMILY_PASSCODE` set.
4. Theme songs (ElevenLabs Music), then voice design for kid voices, optional Blake narrator voice.
5. Import past stories from ChatGPT and Claude data exports plus Suno MP3s (Blake will provide later).
6. Measure cost per full episode (Claude + ElevenLabs credits + image).

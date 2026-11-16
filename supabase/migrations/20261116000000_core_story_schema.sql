-- Core schema for Story Universe (applied Nov 16, 2026 via Supabase MCP).
-- No user logins: RLS is on with no policies, so only Edge Functions (service role) can read or write.

create type chapter_status as enum ('draft', 'needs_fix', 'blocked', 'approved', 'produced');
create type review_verdict as enum ('pass', 'fix', 'block');
create type idea_source as enum ('voice', 'text', 'journal_photo', 'import');
create type song_source as enum ('elevenlabs', 'suno', 'import');

create table family_members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text not null check (role in ('kid', 'parent', 'other')),
  birth_month date,
  notes text,
  photo_path text,
  created_at timestamptz not null default now()
);

create table universes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  main_kid_id uuid references family_members(id),
  book jsonb not null default '{}'::jsonb,
  art_style text,
  voice_seed integer not null default (floor(random() * 1000000))::int,
  narrator_voice_id text,
  imported boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table characters (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid not null references universes(id) on delete cascade,
  name text not null,
  family_member_id uuid references family_members(id),
  description text,
  personality text,
  look text,
  voice_id text,
  voice_name text,
  created_at timestamptz not null default now(),
  unique (universe_id, name)
);

create table ideas (
  id uuid primary key default gen_random_uuid(),
  source idea_source not null,
  kid_id uuid references family_members(id),
  universe_id uuid references universes(id) on delete set null,
  raw_text text,
  media_path text,
  restated text,
  confirmed boolean not null default false,
  used_in_chapter_id uuid,
  created_at timestamptz not null default now()
);

create table chapters (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid not null references universes(id) on delete cascade,
  number integer not null,
  title text,
  brief jsonb not null default '{}'::jsonb,
  script jsonb,
  status chapter_status not null default 'draft',
  review jsonb,
  audio_path text,
  duration_seconds integer,
  imported boolean not null default false,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (universe_id, number)
);

alter table ideas add constraint ideas_chapter_fk foreign key (used_in_chapter_id) references chapters(id) on delete set null;

create table reviews (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('chapter', 'song', 'cover_prompt', 'book_update')),
  subject_id uuid not null,
  verdict review_verdict not null,
  reasons jsonb not null default '[]'::jsonb,
  suggested_fix text,
  created_at timestamptz not null default now()
);

create table book_versions (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid not null references universes(id) on delete cascade,
  chapter_id uuid references chapters(id) on delete set null,
  book jsonb not null,
  changes jsonb,
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);

create table songs (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  title text not null,
  lyrics text,
  style jsonb not null default '{}'::jsonb,
  target_seconds integer default 120,
  source song_source not null,
  audio_path text,
  duration_seconds integer,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table covers (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid not null references universes(id) on delete cascade,
  style text,
  prompt text,
  image_path text,
  chosen boolean not null default false,
  created_at timestamptz not null default now()
);

create index on characters (universe_id);
create index on chapters (universe_id, number);
create index on songs (universe_id);
create index on covers (universe_id);
create index on book_versions (universe_id, created_at desc);
create index on reviews (subject_type, subject_id);

alter table family_members enable row level security;
alter table universes enable row level security;
alter table characters enable row level security;
alter table ideas enable row level security;
alter table chapters enable row level security;
alter table reviews enable row level security;
alter table book_versions enable row level security;
alter table songs enable row level security;
alter table covers enable row level security;

insert into storage.buckets (id, name, public) values
  ('family-photos', 'family-photos', false),
  ('audio', 'audio', false),
  ('covers', 'covers', false),
  ('captures', 'captures', false)
on conflict (id) do nothing;

-- Family members (approximate birth months from ages given Nov 2026)
insert into family_members (name, role, birth_month) values
  ('Levi', 'kid', date '2020-05-01'),
  ('Lydia', 'kid', date '2023-05-01'),
  ('Luke', 'kid', date '2025-01-01'),
  ('Blake', 'parent', null);

-- Dev helpers (second migration, Nov 16, 2026): pg_net lives in the extensions schema;
-- a private "dev" schema holds call_story / call_produce wrappers used for testing
-- (they POST to the Edge Functions with the anon key). Not exposed to the API.
create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;
create schema if not exists dev;
revoke all on schema dev from public, anon, authenticated;

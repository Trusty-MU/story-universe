-- Theme songs follow the same path as chapters: written, checked, approved, recorded (applied Nov 17, 2026).
alter table songs add column if not exists status chapter_status not null default 'draft';
alter table songs add column if not exists review jsonb;
alter table songs add column if not exists brief jsonb not null default '{}'::jsonb;
alter table songs add column if not exists sections jsonb;
alter table songs add column if not exists approved_at timestamptz;
alter table songs add column if not exists updated_at timestamptz not null default now();

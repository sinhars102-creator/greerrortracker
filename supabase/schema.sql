-- GRE Mistake Tracker — full schema
-- Run this in the Supabase SQL Editor (Project -> SQL Editor -> New query)

-- ============================================================
-- ENTRIES (the core mistake log)
-- ============================================================
create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  section text not null check (section in ('Quant', 'Verbal')),
  subtype text not null,
  question_text text not null default '',
  passage text not null default '',
  your_answer text not null default '',
  correct_answer text not null default '',
  notes text not null default '',
  tags text[] not null default '{}',
  mistake_types text[] not null default '{}',
  insight text not null default '',
  related_entry_ids uuid[] not null default '{}',
  repeated_by_ids uuid[] not null default '{}',
  has_image boolean not null default false,
  image_path text, -- path within the 'screenshots' storage bucket, if any
  blanks jsonb, -- cached extracted answer-choice structure, see README for shape
  last_attempt jsonb, -- cached last graded practice attempt
  solution jsonb, -- cached per-blank solution explanations (array of strings, parallel to blanks), fetched on-demand via "Show solution"
  review_count int not null default 0,
  last_reviewed date,
  next_review date not null default current_date,
  mastered boolean not null default false,
  total_attempts int not null default 0,
  wrong_attempts int not null default 0,
  pending boolean not null default false,
  rc_group_id uuid, -- shared across entries logged together as one Reading Comprehension batch (same passage), so they can be practiced in sequence
  rc_group_order int, -- position of this question within its rc_group_id batch
  import_source text, -- for PDF-imported entries: a hash+filename identifying the source document, so re-importing the same doc can be deduped; null for manually/extension-logged entries
  import_ref text, -- for PDF-imported entries: "Section N QX" within import_source, the dedup key alongside it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- for installs that already ran the create table above before `solution` existed
alter table entries add column if not exists solution jsonb;
-- for installs that already ran the create table above before RC batch grouping existed
alter table entries add column if not exists rc_group_id uuid;
alter table entries add column if not exists rc_group_order int;
-- for installs that already ran the create table above before PDF import existed
alter table entries add column if not exists import_source text;
alter table entries add column if not exists import_ref text;

create index if not exists entries_user_id_idx on entries(user_id);
create index if not exists entries_next_review_idx on entries(user_id, next_review) where not mastered;
create index if not exists entries_section_idx on entries(user_id, section);
create index if not exists entries_import_lookup_idx on entries(user_id, import_source, import_ref);

alter table entries enable row level security;

create policy "Users can view their own entries"
  on entries for select using (auth.uid() = user_id);
create policy "Users can insert their own entries"
  on entries for insert with check (auth.uid() = user_id);
create policy "Users can update their own entries"
  on entries for update using (auth.uid() = user_id);
create policy "Users can delete their own entries"
  on entries for delete using (auth.uid() = user_id);

-- ============================================================
-- WORD TRAPS (Verbal: literal-vs-figurative meaning mistakes)
-- ============================================================
create table if not exists word_traps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  literal_meaning text not null default '',
  actual_meaning text not null default '',
  context text not null default '',
  note text not null default '',
  source text not null default 'user', -- 'user' | 'auto' | 'seed'
  linked_entry_id uuid references entries(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table word_traps enable row level security;
create policy "Users manage their own word traps"
  on word_traps for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- QUANT TRAPS (Quant: recurring conceptual/formula mistakes)
-- ============================================================
create table if not exists quant_traps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trap_name text not null,
  what_happened text not null default '',
  correct_rule text not null default '',
  checkpoint text not null default '',
  source text not null default 'user',
  linked_entry_id uuid references entries(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table quant_traps enable row level security;
create policy "Users manage their own quant traps"
  on quant_traps for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- FOCUS LISTS (curated pre-test checklists, cached AI output)
-- ============================================================
create table if not exists focus_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  items jsonb not null default '[]',
  generated_at timestamptz not null default now(),
  entry_count int not null default 0
);

alter table focus_lists enable row level security;
create policy "Users manage their own focus lists"
  on focus_lists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- INSIGHTS (cached "Work On This" diagnostic output)
-- ============================================================
create table if not exists insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  entry_count int not null default 0
);

alter table insights enable row level security;
create policy "Users manage their own insights"
  on insights for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- VOCAB REVIEW (spaced-repetition vocab quizzing, separate from the
-- mistake-log review cycle — the base word list lives in code, this
-- table only holds user-added words)
-- ============================================================
create table if not exists vocab_words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  meaning text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists vocab_words_user_word_idx on vocab_words(user_id, word);

alter table vocab_words enable row level security;
create policy "Users manage their own vocab words"
  on vocab_words for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- VOCAB PROGRESS (per-word spaced-repetition state)
-- ============================================================
create table if not exists vocab_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  bucket text not null check (bucket in ('learnt', 'revise', 'learning')),
  streak int not null default 0,
  review_count int not null default 0,
  last_reviewed timestamptz,
  next_due_at timestamptz not null default now(),
  hook text not null default '',
  updated_at timestamptz not null default now()
);

create unique index if not exists vocab_progress_user_word_idx on vocab_progress(user_id, word);

alter table vocab_progress enable row level security;
create policy "Users manage their own vocab progress"
  on vocab_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- VOCAB GROUPS (saved clusters of similar-meaning words, reviewable
-- together as their own session)
-- ============================================================
create table if not exists vocab_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  words text[] not null default '{}',
  source text not null default 'user', -- 'user' | 'auto'
  created_at timestamptz not null default now()
);

-- for installs that already ran the create table above before `source` existed
alter table vocab_groups add column if not exists source text not null default 'user';

alter table vocab_groups enable row level security;
create policy "Users manage their own vocab groups"
  on vocab_groups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- APP SETTINGS (single row) — currently just which AI provider is active
-- (see lib/anthropic.js, lib/gemini.js, lib/groq.js). Read on every AI call,
-- so select is open to any client (no secrets here); only an authenticated
-- session can flip it, via the switch in the header (components/AppShell.js).
-- ============================================================
create table if not exists app_settings (
  id boolean primary key default true check (id),
  ai_provider text not null default 'anthropic' check (ai_provider in ('anthropic', 'gemini', 'openai', 'groq')),
  updated_at timestamptz not null default now()
);

-- for installs that already ran the create table above before 'groq'/'openai' existed
alter table app_settings drop constraint if exists app_settings_ai_provider_check;
alter table app_settings add constraint app_settings_ai_provider_check check (ai_provider in ('anthropic', 'gemini', 'openai', 'groq'));

insert into app_settings (id, ai_provider) values (true, 'anthropic') on conflict (id) do nothing;

alter table app_settings enable row level security;
create policy "Anyone can read the app settings"
  on app_settings for select using (true);
create policy "Authenticated users can update the app settings"
  on app_settings for update using (auth.role() = 'authenticated');

-- ============================================================
-- PDF SCANS (app/import) — caches the section-structure scan of a PDF,
-- keyed by a content hash, so re-uploading the same document skips a
-- redundant Claude call instead of re-scanning it from scratch.
-- ============================================================
create table if not exists pdf_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  doc_hash text not null,
  filename text not null default '',
  sections jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create unique index if not exists pdf_scans_user_hash_idx on pdf_scans(user_id, doc_hash);

alter table pdf_scans enable row level security;
create policy "Users manage their own pdf scans"
  on pdf_scans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- updated_at auto-touch trigger for entries
-- ============================================================
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists entries_touch_updated_at on entries;
create trigger entries_touch_updated_at
  before update on entries
  for each row execute function touch_updated_at();

-- ============================================================
-- STORAGE BUCKET for screenshots
-- Run this section, or create the bucket manually in the Storage tab:
--   name: screenshots, public: false
-- ============================================================
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

create policy "Users can upload their own screenshots"
  on storage.objects for insert
  with check (bucket_id = 'screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can view their own screenshots"
  on storage.objects for select
  using (bucket_id = 'screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own screenshots"
  on storage.objects for delete
  using (bucket_id = 'screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================
-- STORAGE BUCKET for PDF imports (app/import) — holds the source PDF just
-- long enough for the server to read it for extraction; the app deletes it
-- afterward.
--   name: imports, public: false
-- ============================================================
insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

create policy "Users can upload their own import PDFs"
  on storage.objects for insert
  with check (bucket_id = 'imports' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can view their own import PDFs"
  on storage.objects for select
  using (bucket_id = 'imports' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own import PDFs"
  on storage.objects for delete
  using (bucket_id = 'imports' and auth.uid()::text = (storage.foldername(name))[1]);

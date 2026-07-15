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
  review_count int not null default 0,
  last_reviewed date,
  next_review date not null default current_date,
  mastered boolean not null default false,
  total_attempts int not null default 0,
  wrong_attempts int not null default 0,
  pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entries_user_id_idx on entries(user_id);
create index if not exists entries_next_review_idx on entries(user_id, next_review) where not mastered;
create index if not exists entries_section_idx on entries(user_id, section);

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

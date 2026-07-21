# GRE Error Ledger — Web

A real, deployed version of the GRE mistake tracker: Next.js + Supabase (database, storage, auth) + your own Anthropic API key. Built to eliminate the constraints we kept hitting in the Claude.ai artifact sandbox — no more blocked downloads, no more blocked clipboard, no more shared session rate limits, no more storage size ceilings.

## What's already working

- **Auth** — email magic-link sign-in via Supabase Auth. Every user's data is isolated by Row Level Security.
- **Log Mistake** — paste/upload/drag-drop a screenshot, auto-compressed client-side, uploaded to Supabase Storage. Logging itself never calls AI unless there's a screenshot to read: if you typed the question by hand, the entry saves with zero API calls. If there's a screenshot, `/api/extract-question` transcribes the question (and passage, for Reading Comprehension) in the background — extraction only, no mistake-type analysis. Reading Comprehension supports batch logging: one shared passage, multiple question screenshots, each becoming its own entry.
- **Classify (on-demand)** — a "Classify" button per entry on the All Entries page calls `/api/classify` to assign mistake-type tags, write a diagnostic insight sentence, find related prior mistakes, and auto-detect word/quant traps (deduped by word/trap name). Not automatic — you decide which entries are worth the AI call.
- **Dashboard** — stats and charts (by error type, by topic).
- **All Entries** — list, search, filter by section, expand, edit, classify, delete. Supports `?entry=<id>` for deep-linking a specific card open, used by Focus List, Error Buckets, and Repeated Errors.
- **Review** — spaced repetition (1/3/7/14/30 day intervals): pick an answer, get graded instantly against the cached correct answer.
- **Practice Arena** — Quant/Verbal test mode pulling from the whole question bank (not just what's due), with live score and streak tracking.
- **Vocab Review** — separate spaced-repetition word quiz (72 built-in words + your own), graded via `/api/grade-vocab`. Add words with just a name and `/api/define-words` looks up the meaning; `/api/group-vocab` clusters your list into synonym groups you can review together.
- **Word Traps** & **Quant Traps** pages — list, manually add, and delete. Auto-detected entries (from Classify) are tagged distinctly from user-added ones.
- **Focus List** — builds a prioritized pre-test checklist via `/api/focus-list` from your mistakes and word traps, cached in `focus_lists`. Filterable by All/Quant/Verbal, checkbox state persists, flags itself stale when your entry count has changed since it was built.
- **Work On This** — blunt per-subtype diagnosis via `/api/insight`, cached in `insights`. Quant subtypes get a flat list of key facts missed; Verbal subtypes get an ordered framework to run every time.
- **Error Buckets** — client-side aggregation of every (section, subtype, mistake type) combination, color-coded by frequency (Critical/Recurring/Isolated), collapsible to the underlying questions.
- **Repeated Errors** — Verbal questions missed 2+ times, grouped by subtype, worst-first.
- **API routes** — `/api/extract-question`, `/api/classify`, `/api/extract-options`, `/api/insight`, `/api/focus-list`, `/api/grade-vocab`, `/api/define-words`, `/api/group-vocab`.

## What's left

- **Backup/export** — less critical now since data lives in a real database, but a JSON export button is a quick add if you want it.
- **Related-entry backrefs** — when `/api/classify` flags a mistake as related to prior ones, the entry's `relatedEntryIds` gets set, but the prior entries' `repeatedByIds` don't currently get updated to point back. Straightforward to add in `app/entries/page.js`'s classify handler.

## Setup

### 1. Create a Supabase project
[supabase.com](https://supabase.com) → New Project (free tier is plenty for this).

### 2. Run the schema
Project → SQL Editor → New query → paste the entire contents of `supabase/schema.sql` → Run.

This creates all tables, RLS policies, and the `screenshots` storage bucket in one shot.

### 3. Get your keys
- Supabase: Project Settings → API → copy the **Project URL** and **anon public** key.
- Anthropic: [console.anthropic.com](https://console.anthropic.com) → API Keys → create one.

### 4. Configure environment
```bash
cp .env.example .env.local
# fill in the three values
```

### 5. Install and run
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to `/login`. Enter your email, check your inbox for the magic link.

## Deploying

1. Push this repo to GitHub.
2. [vercel.com](https://vercel.com) → New Project → import the repo.
3. Add the same three environment variables from `.env.local` in Vercel's project settings.
4. Deploy. Done — real hosting, no sandbox restrictions of any kind.

## Notes on the migration from the artifact version

- `window.storage` (5MB-per-key limit, occasional "internal server error", shared session rate limits) → replaced entirely by Supabase Postgres + Storage. No practical size ceiling at this scale.
- The artifact's built-in Anthropic proxy (shared, rate-limited per session) → replaced by direct calls to `api.anthropic.com` using your own key in `lib/anthropic.js`. Billed to your own Anthropic account, no shared throttle with anyone else.
- Screenshot compression logic (`lib/entries.js` → `compressImageDataUrl`) is the same canvas-based approach from the artifact — kept because smaller images are just generally better, not because Supabase Storage needs it the way `window.storage` did.

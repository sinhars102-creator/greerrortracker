# GRE Error Ledger — Web

A real, deployed version of the GRE mistake tracker: Next.js + Supabase (database, storage, auth) + your own Anthropic API key. Built to eliminate the constraints we kept hitting in the Claude.ai artifact sandbox — no more blocked downloads, no more blocked clipboard, no more shared session rate limits, no more storage size ceilings.

## What's already working

- **Auth** — email magic-link sign-in via Supabase Auth. Every user's data is isolated by Row Level Security.
- **Log Mistake** — paste/upload/drag-drop a screenshot, auto-compressed client-side, uploaded to Supabase Storage. Classification runs server-side via `/api/classify` using **your own** Anthropic API key — no shared throttle. Word traps and quant traps are auto-detected and logged in the background when the classifier finds one, deduped by word/trap name.
- **Dashboard** — stats and charts (by error type, by topic).
- **All Entries** — list, search, filter by section, expand, edit, delete. Supports `?entry=<id>` for deep-linking a specific card open, used by Focus List, Error Buckets, and Repeated Errors.
- **Review** — spaced repetition (1/3/7/14/30 day intervals), with a pre-session **Quick Check / Deep Practice** mode toggle.
- **Practice Arena** — Quant/Verbal test mode pulling from the whole question bank (not just what's due), with live score and streak tracking. Same mode toggle as Review.
- **Deep Practice mode** (Review + Practice Arena) — write your reasoning per blank, and on Verbal questions tag why each unselected option is wrong (star up to 2 as the "closest trap" for an elaboration note). Graded by `/api/grade`; the graded result — including per-option tag verdicts — is persisted to the entry's `last_attempt` column.
- **Word Traps** & **Quant Traps** pages — list, manually add, and delete. Auto-detected entries are tagged distinctly from user-added ones.
- **Focus List** — builds a prioritized pre-test checklist via `/api/focus-list` from your mistakes and word traps, cached in `focus_lists`. Filterable by All/Quant/Verbal, checkbox state persists, flags itself stale when your entry count has changed since it was built.
- **Work On This** — blunt per-subtype diagnosis via `/api/insight`, cached in `insights`. Quant subtypes get a flat list of key facts missed; Verbal subtypes get an ordered framework to run every time.
- **Error Buckets** — client-side aggregation of every (section, subtype, mistake type) combination, color-coded by frequency (Critical/Recurring/Isolated), collapsible to the underlying questions.
- **Repeated Errors** — Verbal questions missed 2+ times, grouped by subtype, worst-first.
- **API routes** — `/api/classify`, `/api/extract-options`, `/api/grade`, `/api/insight`, `/api/focus-list` — all prompts ported directly from the version we refined all day in the artifact.

## What's left

- **Backup/export** — less critical now since data lives in a real database, but a JSON export button is a quick add if you want it.
- **Related-entry backrefs** — when `/api/classify` flags a new mistake as related to prior ones, the new entry's `relatedEntryIds` gets set, but the prior entries' `repeatedByIds` don't currently get updated to point back. Straightforward to add in `app/log/page.js`'s classification block.

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

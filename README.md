# GRE Error Ledger — Web

A real, deployed version of the GRE mistake tracker: Next.js + Supabase (database, storage, auth) + your own Anthropic API key. Built to eliminate the constraints we kept hitting in the Claude.ai artifact sandbox — no more blocked downloads, no more blocked clipboard, no more shared session rate limits, no more storage size ceilings.

## What's already working

- **Auth** — email magic-link sign-in via Supabase Auth. Every user's data is isolated by Row Level Security.
- **Log Mistake** — paste/upload/drag-drop a screenshot, auto-compressed client-side, uploaded to Supabase Storage. Classification runs server-side via `/api/classify` using **your own** Anthropic API key — no shared throttle.
- **Dashboard** — stats and charts (by error type, by topic).
- **All Entries** — list, search, filter by section, expand, edit, delete.
- **Review** — spaced repetition (1/3/7/14/30 day intervals), Quick Check mode: pick an answer, get graded instantly, no reasoning required.
- **API routes** — `/api/classify`, `/api/extract-options`, `/api/grade`, `/api/insight`, `/api/focus-list` — all prompts ported directly from the version we refined all day in the artifact.

## What's stubbed for you to extend (all in Claude Code, following the same patterns)

These all existed in the artifact and are genuinely valuable, but porting every single one today would have meant a much longer wait for a working foundation. The **hard part — architecture, auth, data layer, and API routes — is done**. Each of these is now "just" a new page or component following the exact patterns already in `app/review/page.js` and `app/log/page.js`:

- **Deep Practice mode** (write reasoning + trap tags, graded by `/api/grade` — the route already exists and is fully ported, just needs the richer UI wired to it, same as the artifact's `ReviewCard`)
- **Practice Arena** (Quant/Verbal test mode with score/streak, pulling from the whole question bank instead of just due ones)
- **Word Traps** & **Quant Traps** pages (schema tables already exist: `word_traps`, `quant_traps` — the classify API route already extracts these automatically, just needs list/add UI)
- **Focus List** page (API route `/api/focus-list` already exists and works — needs the checklist UI)
- **Work On This** page (API route `/api/insight` already exists and works — needs the diagnosis/framework UI)
- **Error Buckets** & **Repeated Errors** pages (pure client-side aggregation over `entries`, no new API needed — same logic as the artifact, just re-pointed at Supabase data)
- **Backup/export** (less critical now since data lives in a real database, but a JSON export button is a quick add if you want it)

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

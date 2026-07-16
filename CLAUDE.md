# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

A GRE mistake tracker: Next.js 16 + Supabase (Postgres, Auth, Storage) + the user's own Anthropic API key. It's the "real deployed" successor to a Claude.ai-artifact prototype — see README.md for the full migration story and the list of features that are stubbed out but not yet built (Deep Practice mode, Practice Arena, Word/Quant Traps pages, Focus List page, Work On This page, Error Buckets, backup/export).

**Before writing any code**, read the relevant guide in `node_modules/next/dist/docs/` — this Next.js version (16.2.10) has breaking changes vs. training data. Heed deprecation notices.

## Commands

```bash
npm install
npm run dev      # start dev server
npm run build
npm run start
npm run lint      # eslint (flat config, eslint-config-next core-web-vitals)
```

No test suite exists in this repo currently.

## Setup

Copy `.env.example` to `.env.local` and fill in three values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`. The Supabase schema (tables, RLS policies, storage bucket) lives entirely in `supabase/schema.sql` — run it once in the Supabase SQL Editor to provision a new project. There are no migration files; schema changes are made by editing `supabase/schema.sql` directly and re-running the relevant statements against the project.

## Architecture

**Data flow**: Client Components call helper functions in `lib/entries.js`, which use the browser Supabase client (`lib/supabase/client.js`) to talk directly to Postgres — there is no server-side data-fetching layer for CRUD. The AI-powered features (classification, grading, etc.) instead go through Next.js API routes under `app/api/*/route.js`, which call `lib/anthropic.js` server-side because that's the only place `ANTHROPIC_API_KEY` is available.

**Auth**: Magic-link only (`supabase.auth.signInWithOtp`), no passwords. `middleware.js` → `lib/supabase/middleware.js` runs on every non-static request, refreshes the Supabase session, and redirects unauthenticated users to `/login` (except `/login` and `/auth/*` themselves). `app/auth/callback/route.js` exchanges the magic-link code for a session and redirects to `/dashboard`. All tables use Postgres RLS keyed on `auth.uid() = user_id`, so authorization is enforced at the database layer, not in application code — new tables should follow the same RLS policy pattern already in `supabase/schema.sql`.

**Row/entry mapping**: `lib/entries.js` maintains a manual mapping between snake_case DB columns and camelCase JS objects (`rowToEntry` / `entryToRow`). When adding a new column to `entries`, update both functions and the schema together.

**AI calls**: `lib/anthropic.js` exports `callClaude(content, maxTokens)`, a thin wrapper around the Messages API (`claude-sonnet-4-6`) that accepts either a plain string or a multimodal content array (image + text) and throws on error/empty/truncated responses. `extractJSON()` is the standard way every API route parses model output — it tolerates markdown fences, smart quotes, and trailing commas. Every route under `app/api/*/route.js` follows the same shape: build a prompt string (optionally with an image content block), call `callClaude`, `extractJSON` the result, validate/whitelist fields before returning JSON. Follow this pattern for new AI-backed routes rather than inventing a new one.

**Async/optimistic writes**: `app/log/page.js` is the reference pattern for "save immediately, enrich in the background" — it creates the DB row first (marked `pending: true`), then independently fires off screenshot upload and AI classification, updating the row when each resolves. Screenshot upload failures do not block classification and vice versa.

**Screenshots**: Client-side compressed to a JPEG data URL (`compressImageDataUrl` in `lib/entries.js`, canvas-based) before upload to the private `screenshots` Supabase Storage bucket at `{userId}/{entryId}.jpg`. Reads go through short-lived signed URLs (`getScreenshotUrl`), never public URLs.

**Review/spaced repetition**: `app/review/page.js` implements fixed-interval spaced repetition (1/3/7/14/30 days, see `INTERVALS`) with "Quick Check" grading — answer options are extracted once via `/api/extract-options` and cached on the entry (`blanks` column) so repeat reviews don't re-call the model.

**Styling**: No component library. Plain inline `style={}` objects plus a small set of global utility classes (`.card`, `.btn`, `.btn-primary`, `.pill`, etc.) and CSS custom properties (`--bg`, `--panel`, `--text`, `--muted`, `--amber`, `--quant`, `--verbal`, ...) defined in `app/globals.css`. Tailwind is imported but the app is not written in Tailwind utility classes — match the existing inline-style + CSS-variable convention rather than introducing Tailwind classes or a component library.

**Path alias**: `@/*` maps to the repo root (see `jsconfig.json`), e.g. `@/lib/entries`, `@/components/AppShell`.

**Page structure**: Every authenticated page is a `"use client"` component wrapped in `<AppShell>` (`components/AppShell.js`), which renders the tab nav (Dashboard / Log Mistake / Review / All Entries) and sign-out button. New authenticated pages should follow this same wrapper pattern.

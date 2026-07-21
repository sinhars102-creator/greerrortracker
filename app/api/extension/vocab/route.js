import { NextResponse } from "next/server";
import { defineWords } from "@/lib/anthropic";
import { authenticateExtensionRequest } from "@/lib/extensionAuth";
import { BASE_WORDS } from "@/lib/baseWords";

export const maxDuration = 30;

// Chrome extension: logging one or more words straight to Vocab Review, no
// screenshot involved. Meanings are looked up via AI; words already in the
// user's list (built-in or custom) are skipped rather than duplicated.
export async function POST(request) {
  const auth = await authenticateExtensionRequest(request);
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const rawWords = Array.isArray(body.words)
      ? body.words
      : typeof body.words === "string"
      ? body.words.split(",")
      : [];

    const words = [];
    const seen = new Set();
    for (const w of rawWords) {
      const trimmed = typeof w === "string" ? w.trim() : "";
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(trimmed);
    }
    if (words.length === 0) {
      return NextResponse.json({ error: "No words given" }, { status: 400 });
    }

    const { data: existingRows, error: existingErr } = await supabase.from("vocab_words").select("word");
    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });

    const existingKeys = new Set([
      ...BASE_WORDS.map((x) => x.w.toLowerCase()),
      ...(existingRows || []).map((r) => r.word.toLowerCase()),
    ]);

    const skipped = [];
    const toDefine = [];
    for (const w of words) {
      if (existingKeys.has(w.toLowerCase())) skipped.push(w);
      else toDefine.push(w);
    }

    const added = [];
    const failed = [];
    if (toDefine.length) {
      const definitions = await defineWords(toDefine);
      const byWord = new Map(definitions.map((d) => [d.word.toLowerCase(), d.meaning]));
      const rows = [];
      for (const w of toDefine) {
        const meaning = byWord.get(w.toLowerCase());
        if (meaning) {
          rows.push({ user_id: user.id, word: w, meaning });
          added.push(w);
        } else {
          failed.push(w);
        }
      }
      if (rows.length) {
        const { error: insertErr } = await supabase.from("vocab_words").insert(rows);
        if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ added, skipped, failed });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}

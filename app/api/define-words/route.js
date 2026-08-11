import { NextResponse } from "next/server";
import { defineWords } from "@/lib/anthropic";

// defineWords() can make two sequential Claude calls (initial pass + a
// retry for any words it missed), each often taking several seconds —
// easy to exceed Vercel's default serverless timeout. The extension's
// equivalent route (app/api/extension/vocab) already extends this; this
// route calls the same underlying function and needs the same protection.
export const maxDuration = 30;

export async function POST(request) {
  try {
    const { words } = await request.json();
    if (!Array.isArray(words) || words.length === 0) {
      return NextResponse.json({ error: "No words given" }, { status: 400 });
    }
    const definitions = await defineWords(words);
    return NextResponse.json({ definitions });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}

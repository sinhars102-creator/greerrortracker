import { NextResponse } from "next/server";
import { defineWords } from "@/lib/anthropic";

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

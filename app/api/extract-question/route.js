import { NextResponse } from "next/server";
import { extractQuestionFromImage } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { image, subtype, needsPassage } = await request.json();
    if (!image) {
      return NextResponse.json({ error: "No image given" }, { status: 400 });
    }

    const result = await extractQuestionFromImage({ image, subtype, needsPassage });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}

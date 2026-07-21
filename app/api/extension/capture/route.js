import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractQuestionFromImage, QUANT_SUBTYPES, VERBAL_SUBTYPES } from "@/lib/anthropic";

export const maxDuration = 30;

// Bearer-token auth for the Chrome extension — it has no cookies, just the
// user's Supabase access token (handed over via the /extension "Start
// Logging" page). Passing it as the Authorization header on a plain
// supabase-js client makes PostgREST/Storage evaluate auth.uid() as this
// user, so the same RLS policies as the browser client apply unchanged.
async function authenticate(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }) };

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }) };

  return { supabase, user };
}

export async function POST(request) {
  const auth = await authenticate(request);
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  try {
    const { image, section, subtype, correctAnswer } = await request.json();
    if (!image || !image.base64) {
      return NextResponse.json({ error: "No image given" }, { status: 400 });
    }
    if (section !== "Quant" && section !== "Verbal") {
      return NextResponse.json({ error: "Invalid section" }, { status: 400 });
    }
    const validSubtypes = section === "Quant" ? QUANT_SUBTYPES : VERBAL_SUBTYPES;
    if (!validSubtypes.includes(subtype)) {
      return NextResponse.json({ error: "Invalid subtype" }, { status: 400 });
    }

    // 1. Create the entry immediately, pending transcription.
    const { data: row, error: insertErr } = await supabase
      .from("entries")
      .insert({
        user_id: user.id,
        section,
        subtype,
        question_text: "(transcribing…)",
        passage: "",
        correct_answer: typeof correctAnswer === "string" ? correctAnswer : "",
        tags: [],
        mistake_types: [],
        has_image: false,
        pending: true,
      })
      .select()
      .single();
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // 2. Upload the screenshot — failure here shouldn't block extraction.
    try {
      const path = `${user.id}/${row.id}.jpg`;
      const bytes = Buffer.from(image.base64, "base64");
      const { error: uploadErr } = await supabase.storage
        .from("screenshots")
        .upload(path, bytes, { contentType: image.mediaType || "image/jpeg", upsert: true });
      if (!uploadErr) {
        await supabase.from("entries").update({ has_image: true, image_path: path }).eq("id", row.id);
      }
    } catch {
      // Screenshot upload is best-effort; the entry itself already exists.
    }

    // 3. Transcribe the question. Never leave the entry stuck pending.
    const needsPassage = subtype === "Reading Comprehension";
    let questionText = "(see screenshot)";
    let passage = "";
    let extractionFailed = false;
    try {
      const result = await extractQuestionFromImage({ image, subtype, needsPassage });
      if (result.error) {
        extractionFailed = true;
      } else {
        questionText = result.questionText || "(see screenshot)";
        passage = result.passage || "";
      }
    } catch {
      extractionFailed = true;
    }

    await supabase.from("entries").update({ question_text: questionText, passage, pending: false }).eq("id", row.id);

    return NextResponse.json({ ok: true, entryId: row.id, questionText, extractionFailed });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  const auth = await authenticate(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  try {
    const { entryId, correctAnswer } = await request.json();
    if (!entryId || typeof correctAnswer !== "string") {
      return NextResponse.json({ error: "entryId and correctAnswer are required" }, { status: 400 });
    }

    // RLS (user_id = auth.uid()) rejects this update if entryId isn't the caller's.
    const { error } = await supabase.from("entries").update({ correct_answer: correctAnswer }).eq("id", entryId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}

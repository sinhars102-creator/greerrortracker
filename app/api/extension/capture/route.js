import { NextResponse, after } from "next/server";
import { extractQuestionFromImage, QUANT_SUBTYPES, VERBAL_SUBTYPES } from "@/lib/anthropic";
import { authenticateExtensionRequest } from "@/lib/extensionAuth";

export const maxDuration = 30;

export async function POST(request) {
  const auth = await authenticateExtensionRequest(request);
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  try {
    const { image, section, subtype, correctAnswer, gotWrong, yourAnswer } = await request.json();
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

    // 1. Create the entry immediately, pending transcription. gotWrong
    // (default false — only the popup's checkbox opts an entry into
    // counting as a real wrong attempt) records this as a real first
    // attempt right away, wrong or not, so a missed question lands
    // straight in the Mistakes tier without waiting on a later in-app
    // review to mark it wrong.
    const wasWrong = gotWrong === true;
    const { data: row, error: insertErr } = await supabase
      .from("entries")
      .insert({
        user_id: user.id,
        section,
        subtype,
        question_text: "(transcribing…)",
        passage: "",
        correct_answer: typeof correctAnswer === "string" ? correctAnswer : "",
        your_answer: typeof yourAnswer === "string" ? yourAnswer : "",
        tags: [],
        mistake_types: [],
        has_image: false,
        pending: true,
        total_attempts: 1,
        wrong_attempts: wasWrong ? 1 : 0,
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

    // 3. Transcribe the question — by far the slowest step (a full Claude
    // vision call, worse on Reading Comprehension passages), which used to
    // make the extension popup sit on "Capturing…" for the whole thing.
    // Deferred to run after the response is sent (same "save immediately,
    // enrich in background" pattern as the web app's own log flow, see
    // app/log/page.js) so the popup can close the moment the entry and its
    // screenshot exist — the entry just carries "(transcribing…)" until
    // this finishes and fills it in.
    const needsPassage = subtype === "Reading Comprehension";
    after(async () => {
      let questionText = "(see screenshot)";
      let passage = "";
      try {
        const result = await extractQuestionFromImage({ image, subtype, needsPassage });
        if (result.error) {
          console.error("[extension/capture] extraction returned error:", result.error);
        } else {
          questionText = result.questionText || "(see screenshot)";
          passage = result.passage || "";
        }
      } catch (extractErr) {
        console.error("[extension/capture] extraction threw:", extractErr);
      }
      await supabase.from("entries").update({ question_text: questionText, passage, pending: false }).eq("id", row.id);
    });

    return NextResponse.json({ ok: true, entryId: row.id, pending: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  const auth = await authenticateExtensionRequest(request);
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

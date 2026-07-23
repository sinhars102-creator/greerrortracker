import { NextResponse } from "next/server";
import { extractQuestionsFromPdf, scanPdfSections } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// The PDF is uploaded to private Storage by the client first (see
// lib/entries.js uploadImportPdf) rather than inlined as base64 in this
// request — a large practice-test PDF blows past the JSON body size limit
// and gets silently truncated before this handler ever runs.
//
// Two modes, sharing the same downloaded PDF bytes:
//   "scan"    — identify the document's section structure, so the caller
//               can ask "which questions from Section N" without already
//               knowing PDF page numbers.
//   "extract" — pull specific (section, question) selections into entries,
//               then delete the temp file.
export async function POST(request) {
  try {
    const { pdfPath, mode, selections } = await request.json();
    if (!pdfPath) {
      return NextResponse.json({ error: "No PDF given" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { data: fileBlob, error: downloadErr } = await supabase.storage.from("imports").download(pdfPath);
    if (downloadErr) {
      return NextResponse.json({ error: downloadErr.message }, { status: 500 });
    }
    const buf = Buffer.from(await fileBlob.arrayBuffer());
    const pdfBase64 = buf.toString("base64");

    if (mode === "scan") {
      const result = await scanPdfSections({ pdfBase64 });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });
      return NextResponse.json(result);
    }

    if (!Array.isArray(selections) || selections.length === 0) {
      return NextResponse.json({ error: "No question numbers given" }, { status: 400 });
    }
    // Not deleted here — the client may re-extract a different selection
    // from the same upload (e.g. via the review screen's Back button). It's
    // deleted client-side once entries are actually committed.
    const result = await extractQuestionsFromPdf({ pdfBase64, selections });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}

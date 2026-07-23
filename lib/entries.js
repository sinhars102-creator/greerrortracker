import { createClient } from "@/lib/supabase/client";

// --- DB row <-> JS object mapping -------------------------------------------------

function rowToEntry(row) {
  return {
    id: row.id,
    section: row.section,
    subtype: row.subtype,
    questionText: row.question_text,
    passage: row.passage,
    yourAnswer: row.your_answer,
    correctAnswer: row.correct_answer,
    notes: row.notes,
    tags: row.tags || [],
    mistakeTypes: row.mistake_types || [],
    insight: row.insight,
    relatedEntryIds: row.related_entry_ids || [],
    repeatedByIds: row.repeated_by_ids || [],
    hasImage: row.has_image,
    imagePath: row.image_path,
    blanks: row.blanks,
    lastAttempt: row.last_attempt,
    solution: row.solution,
    reviewCount: row.review_count,
    lastReviewed: row.last_reviewed,
    nextReview: row.next_review,
    mastered: row.mastered,
    totalAttempts: row.total_attempts,
    wrongAttempts: row.wrong_attempts,
    pending: row.pending,
    rcGroupId: row.rc_group_id,
    rcGroupOrder: row.rc_group_order,
    importSource: row.import_source,
    importRef: row.import_ref,
    createdAt: row.created_at,
  };
}

function entryToRow(e, userId) {
  const row = { user_id: userId };
  if (e.section !== undefined) row.section = e.section;
  if (e.subtype !== undefined) row.subtype = e.subtype;
  if (e.questionText !== undefined) row.question_text = e.questionText;
  if (e.passage !== undefined) row.passage = e.passage;
  if (e.yourAnswer !== undefined) row.your_answer = e.yourAnswer;
  if (e.correctAnswer !== undefined) row.correct_answer = e.correctAnswer;
  if (e.notes !== undefined) row.notes = e.notes;
  if (e.tags !== undefined) row.tags = e.tags;
  if (e.mistakeTypes !== undefined) row.mistake_types = e.mistakeTypes;
  if (e.insight !== undefined) row.insight = e.insight;
  if (e.relatedEntryIds !== undefined) row.related_entry_ids = e.relatedEntryIds;
  if (e.repeatedByIds !== undefined) row.repeated_by_ids = e.repeatedByIds;
  if (e.hasImage !== undefined) row.has_image = e.hasImage;
  if (e.imagePath !== undefined) row.image_path = e.imagePath;
  if (e.blanks !== undefined) row.blanks = e.blanks;
  if (e.lastAttempt !== undefined) row.last_attempt = e.lastAttempt;
  if (e.solution !== undefined) row.solution = e.solution;
  if (e.reviewCount !== undefined) row.review_count = e.reviewCount;
  if (e.lastReviewed !== undefined) row.last_reviewed = e.lastReviewed;
  if (e.nextReview !== undefined) row.next_review = e.nextReview;
  if (e.mastered !== undefined) row.mastered = e.mastered;
  if (e.totalAttempts !== undefined) row.total_attempts = e.totalAttempts;
  if (e.wrongAttempts !== undefined) row.wrong_attempts = e.wrongAttempts;
  if (e.pending !== undefined) row.pending = e.pending;
  if (e.rcGroupId !== undefined) row.rc_group_id = e.rcGroupId;
  if (e.rcGroupOrder !== undefined) row.rc_group_order = e.rcGroupOrder;
  if (e.importSource !== undefined) row.import_source = e.importSource;
  if (e.importRef !== undefined) row.import_ref = e.importRef;
  return row;
}

// --- Sequential grouping (Reading Comprehension batches) ------------------------

// Entries logged together as one RC batch share rcGroupId and should always be
// practiced/reviewed back-to-back, in rcGroupOrder — not scattered by shuffle
// or by whichever ones happen to be due. Returns an array of groups (each an
// array of entries, single-entry groups for anything not part of a batch), in
// first-occurrence order of `entries`.
export function groupForSequentialPractice(entries) {
  const groups = new Map(); // key -> entries[]
  const order = [];
  for (const e of entries) {
    const key = e.rcGroupId || e.id;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(e);
  }
  for (const key of order) {
    groups.get(key).sort((a, b) => (a.rcGroupOrder ?? 0) - (b.rcGroupOrder ?? 0));
  }
  return order.map((key) => groups.get(key));
}

// --- Entries CRUD -------------------------------------------------------------

export async function listEntries() {
  const supabase = createClient();
  const { data, error } = await supabase.from("entries").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToEntry);
}

// Which import_ref values from this document have already been logged, so
// the PDF-import review screen can flag re-imports before they're committed
// instead of silently creating duplicates.
export async function listImportedRefs(importSource) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("entries")
    .select("import_ref, created_at")
    .eq("import_source", importSource);
  if (error) throw error;
  const map = {};
  (data || []).forEach((row) => { map[row.import_ref] = row.created_at; });
  return map;
}

// --- PDF scan cache ---------------------------------------------------------
// Scanning a PDF's section structure costs a Claude call; caching it by
// content hash means re-uploading the same document (this session or a
// future one) skips that call entirely.

export async function getCachedPdfScan(docHash) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("pdf_scans")
    .select("sections")
    .eq("doc_hash", docHash)
    .maybeSingle();
  if (error) throw error;
  return data ? data.sections : null;
}

export async function savePdfScan(userId, docHash, filename, sections) {
  const supabase = createClient();
  const { error } = await supabase
    .from("pdf_scans")
    .upsert({ user_id: userId, doc_hash: docHash, filename, sections }, { onConflict: "user_id,doc_hash" });
  if (error) throw error;
}

export async function createEntry(entry, userId) {
  const supabase = createClient();
  const { data, error } = await supabase.from("entries").insert(entryToRow(entry, userId)).select().single();
  if (error) throw error;
  return rowToEntry(data);
}

export async function updateEntry(id, patch) {
  const supabase = createClient();
  const { data, error } = await supabase.from("entries").update(entryToRow(patch)).eq("id", id).select().single();
  if (error) throw error;
  return rowToEntry(data);
}

export async function deleteEntry(id) {
  const supabase = createClient();
  const { error } = await supabase.from("entries").delete().eq("id", id);
  if (error) throw error;
}

// --- Word traps -----------------------------------------------------------------

function rowToWordTrap(row) {
  return {
    id: row.id,
    word: row.word,
    literalMeaning: row.literal_meaning,
    actualMeaning: row.actual_meaning,
    context: row.context,
    note: row.note,
    source: row.source,
    linkedEntryId: row.linked_entry_id,
    createdAt: row.created_at,
  };
}

export async function listWordTraps() {
  const supabase = createClient();
  const { data, error } = await supabase.from("word_traps").select("*").order("word", { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToWordTrap);
}

export async function findWordTrapByWord(word) {
  const supabase = createClient();
  const { data, error } = await supabase.from("word_traps").select("id").ilike("word", word.trim());
  if (error) throw error;
  return (data || [])[0] || null;
}

export async function createWordTrap(trap, userId) {
  const supabase = createClient();
  const row = {
    user_id: userId,
    word: trap.word,
    literal_meaning: trap.literalMeaning || "",
    actual_meaning: trap.actualMeaning || "",
    context: trap.context || "",
    note: trap.note || "",
    source: trap.source || "user",
    linked_entry_id: trap.linkedEntryId || null,
  };
  const { data, error } = await supabase.from("word_traps").insert(row).select().single();
  if (error) throw error;
  return rowToWordTrap(data);
}

export async function deleteWordTrap(id) {
  const supabase = createClient();
  const { error } = await supabase.from("word_traps").delete().eq("id", id);
  if (error) throw error;
}

// --- Quant traps ------------------------------------------------------------------

function rowToQuantTrap(row) {
  return {
    id: row.id,
    trapName: row.trap_name,
    whatHappened: row.what_happened,
    correctRule: row.correct_rule,
    checkpoint: row.checkpoint,
    source: row.source,
    linkedEntryId: row.linked_entry_id,
    createdAt: row.created_at,
  };
}

export async function listQuantTraps() {
  const supabase = createClient();
  const { data, error } = await supabase.from("quant_traps").select("*").order("trap_name", { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToQuantTrap);
}

export async function findQuantTrapByName(trapName) {
  const supabase = createClient();
  const { data, error } = await supabase.from("quant_traps").select("id").ilike("trap_name", trapName.trim());
  if (error) throw error;
  return (data || [])[0] || null;
}

export async function createQuantTrap(trap, userId) {
  const supabase = createClient();
  const row = {
    user_id: userId,
    trap_name: trap.trapName,
    what_happened: trap.whatHappened || "",
    correct_rule: trap.correctRule || "",
    checkpoint: trap.checkpoint || "",
    source: trap.source || "user",
    linked_entry_id: trap.linkedEntryId || null,
  };
  const { data, error } = await supabase.from("quant_traps").insert(row).select().single();
  if (error) throw error;
  return rowToQuantTrap(data);
}

export async function deleteQuantTrap(id) {
  const supabase = createClient();
  const { error } = await supabase.from("quant_traps").delete().eq("id", id);
  if (error) throw error;
}

// --- Focus lists --------------------------------------------------------------

function rowToFocusList(row) {
  return { id: row.id, items: row.items || [], generatedAt: row.generated_at, entryCount: row.entry_count };
}

export async function getFocusList() {
  const supabase = createClient();
  const { data, error } = await supabase.from("focus_lists").select("*").order("generated_at", { ascending: false }).limit(1);
  if (error) throw error;
  return (data || [])[0] ? rowToFocusList(data[0]) : null;
}

export async function saveFocusList(userId, { items, entryCount }) {
  const supabase = createClient();
  await supabase.from("focus_lists").delete().eq("user_id", userId);
  const { data, error } = await supabase.from("focus_lists").insert({ user_id: userId, items, entry_count: entryCount }).select().single();
  if (error) throw error;
  return rowToFocusList(data);
}

export async function updateFocusListItems(id, items) {
  const supabase = createClient();
  const { error } = await supabase.from("focus_lists").update({ items }).eq("id", id);
  if (error) throw error;
}

// --- Insights -------------------------------------------------------------------

function rowToInsight(row) {
  return { id: row.id, data: row.data || {}, generatedAt: row.generated_at, entryCount: row.entry_count };
}

export async function getInsight() {
  const supabase = createClient();
  const { data, error } = await supabase.from("insights").select("*").order("generated_at", { ascending: false }).limit(1);
  if (error) throw error;
  return (data || [])[0] ? rowToInsight(data[0]) : null;
}

export async function saveInsight(userId, { data: insightData, entryCount }) {
  const supabase = createClient();
  await supabase.from("insights").delete().eq("user_id", userId);
  const { data, error } = await supabase.from("insights").insert({ user_id: userId, data: insightData, entry_count: entryCount }).select().single();
  if (error) throw error;
  return rowToInsight(data);
}

// --- Screenshot storage ---------------------------------------------------------

export async function uploadScreenshot(userId, entryId, blob) {
  const supabase = createClient();
  const path = `${userId}/${entryId}.jpg`;
  const { error } = await supabase.storage.from("screenshots").upload(path, blob, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw error;
  return path;
}

export async function getScreenshotUrl(path) {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from("screenshots").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// --- PDF import storage ----------------------------------------------------
// A large base64-encoded PDF inline in a JSON POST body gets truncated
// before it reaches the API route (Next.js/host body-size limits), so the
// file goes through private Storage instead — same pattern as screenshots.

export async function uploadImportPdf(userId, file) {
  const supabase = createClient();
  const path = `${userId}/${crypto.randomUUID()}.pdf`;
  const { error } = await supabase.storage.from("imports").upload(path, file, { contentType: "application/pdf" });
  if (error) throw error;
  return path;
}

export async function deleteImportPdf(path) {
  const supabase = createClient();
  await supabase.storage.from("imports").remove([path]).catch(() => {});
}

// --- Image compression (ported from the artifact) -------------------------------

export function compressImageDataUrl(dataUrl, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export function dataUrlToBlobAndParts(dataUrl) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) return null;
  const mediaType = match[1];
  const base64 = match[2];
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mediaType });
  return { blob, mediaType, base64 };
}

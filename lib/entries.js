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
    reviewCount: row.review_count,
    lastReviewed: row.last_reviewed,
    nextReview: row.next_review,
    mastered: row.mastered,
    totalAttempts: row.total_attempts,
    wrongAttempts: row.wrong_attempts,
    pending: row.pending,
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
  if (e.reviewCount !== undefined) row.review_count = e.reviewCount;
  if (e.lastReviewed !== undefined) row.last_reviewed = e.lastReviewed;
  if (e.nextReview !== undefined) row.next_review = e.nextReview;
  if (e.mastered !== undefined) row.mastered = e.mastered;
  if (e.totalAttempts !== undefined) row.total_attempts = e.totalAttempts;
  if (e.wrongAttempts !== undefined) row.wrong_attempts = e.wrongAttempts;
  if (e.pending !== undefined) row.pending = e.pending;
  return row;
}

// --- Entries CRUD -------------------------------------------------------------

export async function listEntries() {
  const supabase = createClient();
  const { data, error } = await supabase.from("entries").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToEntry);
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

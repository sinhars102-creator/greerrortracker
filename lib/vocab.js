import { createClient } from "@/lib/supabase/client";

export { BASE_WORDS } from "@/lib/baseWords";

function rowToProgress(row) {
  return {
    bucket: row.bucket,
    streak: row.streak,
    reviewCount: row.review_count,
    lastReviewed: row.last_reviewed,
    nextDueAt: row.next_due_at,
    hook: row.hook,
  };
}

export async function listVocabProgress() {
  const supabase = createClient();
  const { data, error } = await supabase.from("vocab_progress").select("*");
  if (error) throw error;
  const map = {};
  (data || []).forEach((row) => { map[row.word] = rowToProgress(row); });
  return map;
}

export async function upsertVocabProgress(userId, word, progress) {
  const supabase = createClient();
  const row = {
    user_id: userId,
    word,
    bucket: progress.bucket,
    streak: progress.streak,
    review_count: progress.reviewCount,
    last_reviewed: progress.lastReviewed,
    next_due_at: progress.nextDueAt,
    hook: progress.hook || "",
  };
  const { error } = await supabase.from("vocab_progress").upsert(row, { onConflict: "user_id,word" });
  if (error) throw error;
}

export async function listCustomVocabWords() {
  const supabase = createClient();
  const { data, error } = await supabase.from("vocab_words").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, w: r.word, m: r.meaning }));
}

export async function addCustomVocabWord(userId, w, m) {
  const supabase = createClient();
  const { error } = await supabase.from("vocab_words").insert({ user_id: userId, word: w, meaning: m });
  if (error) throw error;
}

export async function listVocabGroups() {
  const supabase = createClient();
  const { data, error } = await supabase.from("vocab_groups").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, name: r.name, words: r.words || [], source: r.source || "user" }));
}

export async function createVocabGroup(userId, name, words, source = "user") {
  const supabase = createClient();
  const { data, error } = await supabase.from("vocab_groups").insert({ user_id: userId, name, words, source }).select().single();
  if (error) throw error;
  return { id: data.id, name: data.name, words: data.words || [], source: data.source };
}

export async function deleteVocabGroup(id) {
  const supabase = createClient();
  const { error } = await supabase.from("vocab_groups").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteAutoVocabGroups(userId) {
  const supabase = createClient();
  const { error } = await supabase.from("vocab_groups").delete().eq("user_id", userId).eq("source", "auto");
  if (error) throw error;
}

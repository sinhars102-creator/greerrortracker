import { createClient } from "@/lib/supabase/client";

function rowToScore(row) {
  return {
    id: row.id,
    testDate: row.test_date,
    quantScore: row.quant_score,
    verbalScore: row.verbal_score,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function listScores() {
  const supabase = createClient();
  const { data, error } = await supabase.from("test_scores").select("*").order("test_date", { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToScore);
}

export async function createScore(score, userId) {
  const supabase = createClient();
  const row = {
    user_id: userId,
    test_date: score.testDate,
    quant_score: score.quantScore,
    verbal_score: score.verbalScore,
    notes: score.notes || "",
  };
  const { data, error } = await supabase.from("test_scores").insert(row).select().single();
  if (error) throw error;
  return rowToScore(data);
}

export async function updateScore(id, patch) {
  const supabase = createClient();
  const row = {};
  if (patch.testDate !== undefined) row.test_date = patch.testDate;
  if (patch.quantScore !== undefined) row.quant_score = patch.quantScore;
  if (patch.verbalScore !== undefined) row.verbal_score = patch.verbalScore;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { data, error } = await supabase.from("test_scores").update(row).eq("id", id).select().single();
  if (error) throw error;
  return rowToScore(data);
}

export async function deleteScore(id) {
  const supabase = createClient();
  const { error } = await supabase.from("test_scores").delete().eq("id", id);
  if (error) throw error;
}

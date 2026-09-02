import { createClient } from "@/lib/supabase/client";

function rowToEssay(row) {
  return {
    id: row.id,
    taskType: row.task_type,
    prompt: row.prompt,
    essayText: row.essay_text,
    score: row.score,
    scoreSummary: row.score_summary,
    feedback: row.feedback,
    structure: row.structure,
    createdAt: row.created_at,
  };
}

export async function listEssays() {
  const supabase = createClient();
  const { data, error } = await supabase.from("essays").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToEssay);
}

export async function createEssay(essay, userId) {
  const supabase = createClient();
  const row = {
    user_id: userId,
    task_type: essay.taskType,
    prompt: essay.prompt,
    essay_text: essay.essayText,
    score: essay.score ?? null,
    score_summary: essay.scoreSummary || "",
    feedback: essay.feedback || "",
    structure: essay.structure || null,
  };
  const { data, error } = await supabase.from("essays").insert(row).select().single();
  if (error) throw error;
  return rowToEssay(data);
}

export async function deleteEssay(id) {
  const supabase = createClient();
  const { error } = await supabase.from("essays").delete().eq("id", id);
  if (error) throw error;
}

import { createClient } from "@/lib/supabase/client";

export async function getAiProvider() {
  const supabase = createClient();
  const { data, error } = await supabase.from("app_settings").select("ai_provider").eq("id", true).maybeSingle();
  if (error) throw error;
  return (data && data.ai_provider) || "anthropic";
}

export async function setAiProvider(provider) {
  const supabase = createClient();
  const { error } = await supabase.from("app_settings").update({ ai_provider: provider }).eq("id", true);
  if (error) throw error;
}

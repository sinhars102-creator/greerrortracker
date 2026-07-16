import { createClient } from "@/lib/supabase/client";

export const BASE_WORDS = [
  { w: "Acquiescence", m: "Passive acceptance or compliance with something, without protest, even if not fully agreeing with it." },
  { w: "Ponderous", m: "Slow, heavy, and labored (in movement, speech, or style); can also mean dull and overly serious." },
  { w: "Chimerical", m: "Existing only as a fantasy; wildly unrealistic or imaginary, like a mythical creature." },
  { w: "Blase", m: "Unimpressed or indifferent, typically because of overexposure or excessive familiarity with something." },
  { w: "Jejune", m: "Naive, simplistic, and lacking depth or maturity; can also mean dull or nutritionally lacking." },
  { w: "Condones", m: "To overlook, forgive, or implicitly approve of an offense or wrongdoing, often by not objecting to it." },
  { w: "Parvenu", m: "A person who has recently acquired wealth, power, or social status but lacks the manners or background traditionally associated with that class." },
  { w: "Languor", m: "A state of physical or mental weariness, listlessness, or dreamy inactivity; a pleasant laziness." },
  { w: "Supercilious", m: "Behaving as though one is superior to others; haughty and contemptuous." },
  { w: "Dispel", m: "To drive away or eliminate something, especially a feeling, belief, or doubt." },
  { w: "Incredulous", m: "Unwilling or unable to believe something; showing disbelief or skepticism." },
  { w: "Halcyon", m: "Denoting a period of time in the past that was idyllically happy and peaceful." },
  { w: "Quirky", m: "Characterized by peculiar or unexpected traits; unconventional in a distinctive, often charming way." },
  { w: "Pejorative", m: "Expressing contempt or disapproval; a word or phrase used to belittle someone or something." },
  { w: "Vaunted", m: "Boasted about or praised excessively, often more than the thing actually deserves." },
  { w: "Vitiate", m: "To spoil, corrupt, or make ineffective; to impair the quality or validity of something." },
  { w: "Perverse", m: "Deliberately behaving in a way that is unreasonable or unacceptable, often contrary to what is expected." },
  { w: "Callous", m: "Insensitive to the feelings of others; emotionally hardened and unsympathetic." },
  { w: "Drab", m: "Lacking brightness or color; dull, dreary, and monotonous." },
  { w: "Murkiness", m: "The state of being unclear, obscure, or difficult to see through, literally or figuratively." },
  { w: "Disquisition", m: "A long, formal spoken or written discourse on a subject; a detailed, systematic treatise." },
  { w: "Ingratiating", m: "Deliberately trying to gain favor or approval, often through flattery; done to please others." },
  { w: "Unctuous", m: "Excessively flattering, smooth, or ingratiating in a way that seems insincere; oily in manner." },
  { w: "Ineluctable", m: "Impossible to avoid or escape; certain to happen." },
  { w: "Perilous", m: "Full of danger or risk; hazardous." },
  { w: "Subjugate", m: "To bring under control, especially by force; to conquer or dominate." },
  { w: "Peremptory", m: "Insisting on immediate compliance, especially in a way that doesn't allow contradiction or refusal." },
  { w: "Incongruous", m: "Out of place or not in harmony with its surroundings; inconsistent." },
  { w: "Topical", m: "Relevant to current events or of present interest." },
  { w: "Tenable", m: "Able to be defended or maintained against attack or objection; justifiable." },
  { w: "Vacuous", m: "Lacking thought, ideas, or substance; showing a lack of intelligence." },
  { w: "Deluding", m: "Persuading someone, including oneself, to believe something false; misleading." },
  { w: "Lest", m: "Conjunction meaning 'with the intention of preventing' or 'for fear that'." },
  { w: "Pacific", m: "Peaceful in nature or intent; calm and not aggressive." },
  { w: "Extraneous", m: "Irrelevant or unrelated to the subject at hand; not essential, often coming from outside." },
  { w: "Fortitude", m: "Courage and strength of mind in facing pain, danger, or adversity." },
  { w: "Reproach", m: "An expression of disapproval or blame; also, a person or thing that brings disgrace or serves as a source of shame." },
  { w: "Latitude", m: "Freedom of action, thought, or choice; the scope allowed for someone to act as they wish." },
  { w: "Reproachful", m: "Expressing disapproval or blame, often through look or tone rather than words." },
  { w: "Penetrating", m: "Sharp and insightful; showing a clear, precise understanding that cuts to the heart of a matter." },
  { w: "Comity", m: "Courtesy and mutual consideration between people or nations; a state of harmonious relations." },
  { w: "Proscribed", m: "Forbidden, especially by law or authority; banned." },
  { w: "Vitriolic", m: "Filled with bitter criticism or malice; harshly scathing in tone." },
  { w: "Borne out", m: "Confirmed or proven true, usually by subsequent events or evidence." },
  { w: "Circumspection", m: "Careful consideration of possible consequences before acting; caution and prudence." },
  { w: "Trite", m: "Overused and unoriginal, having lost its impact through repetition; cliched." },
  { w: "Derisive", m: "Expressing contempt or ridicule; mocking." },
  { w: "Obtrusive", m: "Noticeably or unpleasantly prominent; intrusive in a way that draws unwanted attention." },
  { w: "Unabashedly", m: "Without shame, embarrassment, or hesitation; openly and boldly." },
  { w: "Opprobrium", m: "Harsh public criticism or disgrace resulting from shameful conduct." },
  { w: "Spurring", m: "Encouraging or driving someone into action; prompting a response." },
  { w: "Bumbling", m: "Clumsy, awkward, and inept, especially in a way that is comically incompetent." },
  { w: "Reviled", m: "Criticized or hated intensely, often over a long period." },
  { w: "Vexation", m: "A state of annoyance, frustration, or worry." },
  { w: "Symptomatic", m: "Serving as a sign or indication of an underlying issue, often a negative one." },
  { w: "Maladaptive", m: "Failing to adjust adequately to a situation; counterproductive to coping or functioning well." },
  { w: "Nugatory", m: "Of no real value or importance; having no practical effect, often because it's been invalidated." },
  { w: "Extricating", m: "Freeing someone or something from a difficult, complicated, or restrictive situation." },
  { w: "Plucky", m: "Showing courage and determination despite difficulty or danger; spirited." },
  { w: "Balk", m: "To hesitate or refuse to proceed, often abruptly, especially due to reluctance or fear." },
  { w: "Discernment", m: "The ability to judge well; keen perception and good judgment, especially in distinguishing subtle differences." },
  { w: "Consort with", m: "To keep company with or associate with someone, often used with a negative connotation." },
  { w: "Deem", m: "To regard or consider something in a specified way; to judge or hold an opinion." },
  { w: "Bequeath", m: "To leave property or a possession to someone in a will; more broadly, to pass something down." },
  { w: "Besmirch", m: "To damage the reputation of someone or something; to sully or tarnish." },
  { w: "Pilloried", m: "Publicly criticized, mocked, or ridiculed." },
  { w: "Sclerotic", m: "Rigid and unable to adapt or change, like hardened tissue; often used of institutions or systems." },
  { w: "Ossified", m: "Having become rigid, fixed, and resistant to change." },
  { w: "Chagrin", m: "A feeling of distress, embarrassment, or annoyance caused by failure or disappointment." },
  { w: "Alacrity", m: "Brisk and eager readiness or willingness to do something." },
  { w: "Conversant with", m: "Familiar with or knowledgeable about a particular subject through experience or study." },
  { w: "Strife", m: "Angry or bitter conflict, disagreement, or struggle." },
];

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

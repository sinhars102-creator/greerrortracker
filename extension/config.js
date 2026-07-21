// Public values only — same trust level as the Next.js client bundle
// (NEXT_PUBLIC_* env vars). No secrets belong in this file.
export const APP_API_BASE = "https://gre-tracker-web.vercel.app";
export const SUPABASE_URL = "https://vflxwdetwxzxsybsganv.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmbHh3ZGV0d3h6eHN5YnNnYW52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTcwNDQsImV4cCI6MjA5OTY5MzA0NH0.hwIuSB_8_kk6d8dSvldPckThK-iHrZ6xnMq4Mmy9kIs";

export const QUANT_SUBTYPES = [
  "Arithmetic", "Algebra", "Geometry", "Number Properties",
  "Word Problems", "Data Interpretation", "Probability & Combinatorics", "Quantitative Comparison",
];
export const VERBAL_SUBTYPES = ["Sentence Equivalence", "Text Completion", "Reading Comprehension", "Vocabulary"];

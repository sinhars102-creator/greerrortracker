"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";
import {
  BASE_WORDS, listVocabProgress, upsertVocabProgress, listCustomVocabWords, addCustomVocabWord,
  listVocabGroups, createVocabGroup, deleteVocabGroup, deleteAutoVocabGroups,
} from "@/lib/vocab";

const BUCKET_INFO = {
  learnt: { label: "Learnt", color: "var(--sage)", bg: "rgba(107,144,128,0.15)" },
  revise: { label: "Needs revision", color: "var(--amber)", bg: "rgba(232,163,61,0.15)" },
  learning: { label: "Learning", color: "var(--red)", bg: "rgba(193,85,75,0.15)" },
};

// Spaced-repetition intervals, in days, before a word is due again.
// "Learnt" words stretch out further each time they're confirmed correct in a row.
const BASE_INTERVAL_DAYS = { learning: 1, revise: 3, learnt: 6 };

function computeNextDue(bucket, streak) {
  const base = BASE_INTERVAL_DAYS[bucket] || 1;
  let days = base;
  if (bucket === "learnt") {
    days = Math.min(45, base * Math.pow(1.7, Math.max(0, streak - 1)));
  }
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, Math.round(days)));
  return d.toISOString();
}

function isDue(entry) {
  if (!entry || !entry.nextDueAt) return true;
  return new Date(entry.nextDueAt).getTime() <= Date.now();
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatDue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((d - now) / 86400000);
  if (diffDays <= 0) return "due now";
  if (diffDays === 1) return "due tomorrow";
  return `due in ${diffDays}d`;
}

async function gradeAnswer(word, meaning, userAnswer, clarification, fastMode) {
  const res = await fetch("/api/grade-vocab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word, meaning, userAnswer, clarification: clarification || null, fastMode: !!fastMode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Grading failed");
  return data;
}

// Looks up definitions for words the user typed without a meaning. Returns a
// map of lowercased word -> meaning; words the model couldn't define are
// simply absent from the map.
async function defineWords(words) {
  const res = await fetch("/api/define-words", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ words }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Definition lookup failed");
  const map = {};
  (data.definitions || []).forEach((d) => { map[d.word.toLowerCase()] = d.meaning; });
  return map;
}

const eyebrow = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" };

function VocabReviewPageInner() {
  const searchParams = useSearchParams();
  const [stage, setStage] = useState("setup"); // setup | quiz | grading | clarify | result | done | browse
  const [rawInput, setRawInput] = useState("");
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState(null);
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [fastMode, setFastMode] = useState(false);
  const [error, setError] = useState("");
  const [customWords, setCustomWords] = useState([]);
  const [addWordsInput, setAddWordsInput] = useState("");
  const [addWordsMsg, setAddWordsMsg] = useState("");
  const [progress, setProgress] = useState({});
  const [sessionResults, setSessionResults] = useState({}); // word -> bucket, this session
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [userId, setUserId] = useState(null);
  const [copyMsg, setCopyMsg] = useState("");
  const [groups, setGroups] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [groupWordsInput, setGroupWordsInput] = useState("");
  const [groupMsg, setGroupMsg] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [generatingGroups, setGeneratingGroups] = useState(false);
  const [autoGroupMsg, setAutoGroupMsg] = useState("");
  const inputRef = useRef(null);

  const allWords = useMemo(() => [...BASE_WORDS, ...customWords], [customWords]);
  const wordMap = useMemo(() => Object.fromEntries(allWords.map((x) => [x.w.toLowerCase(), x])), [allWords]);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        setUserId(user.id);
        const [prog, custom, savedGroups] = await Promise.all([listVocabProgress(), listCustomVocabWords(), listVocabGroups()]);
        setProgress(prog);
        setCustomWords(custom.map((c) => ({ w: c.w, m: c.m })));
        setGroups(savedGroups);
      } catch (e) {
        setLoadError(e.message || "Couldn't load your vocab data.");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Deep-linked from the Dashboard's vocab tiles via ?words=Word1,Word2 —
  // jump straight into a session on exactly that word list once loaded.
  useEffect(() => {
    if (!loaded) return;
    const wordsParam = searchParams.get("words");
    if (!wordsParam) return;
    const names = wordsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const found = names.map((n) => wordMap[n.toLowerCase()]).filter(Boolean);
    if (found.length) startSession(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    if (stage === "quiz" && inputRef.current) inputRef.current.focus();
  }, [stage, idx]);

  async function addCustomWords() {
    setAddWordsMsg("");
    const lines = addWordsInput.split("\n").map((l) => l.trim()).filter(Boolean);
    const withMeaning = [];
    const needsMeaning = [];
    const skipped = [];
    const existingKeys = new Set(allWords.map((x) => x.w.toLowerCase()));

    for (const line of lines) {
      const m = line.match(/^(.+?)\s*[:\-—–]\s*(.+)$/);
      const w = (m ? m[1] : line).trim();
      if (!w) { skipped.push(line); continue; }
      if (existingKeys.has(w.toLowerCase())) { skipped.push(`${w} (already in list)`); continue; }
      existingKeys.add(w.toLowerCase());
      if (m && m[2].trim()) withMeaning.push({ w, m: m[2].trim() });
      else needsMeaning.push(w);
    }

    let defined = [];
    if (needsMeaning.length) {
      setAddWordsMsg(`Looking up meanings for ${needsMeaning.length} word${needsMeaning.length > 1 ? "s" : ""}…`);
      try {
        const meaningsMap = await defineWords(needsMeaning);
        defined = needsMeaning.filter((w) => meaningsMap[w.toLowerCase()]).map((w) => ({ w, m: meaningsMap[w.toLowerCase()] }));
        const failed = needsMeaning.filter((w) => !meaningsMap[w.toLowerCase()]);
        if (failed.length) skipped.push(...failed.map((w) => `${w} (couldn't find a definition)`));
      } catch (e) {
        skipped.push(...needsMeaning.map((w) => `${w} (definition lookup failed)`));
      }
    }

    const added = [...withMeaning, ...defined];
    if (added.length) {
      await Promise.all(added.map((a) => addCustomVocabWord(userId, a.w, a.m)));
      setCustomWords((prev) => [...prev, ...added]);
      setAddWordsInput("");
    }
    let msg = "";
    if (added.length) msg += `Added ${added.length} word${added.length > 1 ? "s" : ""}. `;
    if (skipped.length) msg += `Skipped: ${skipped.join(", ")}`;
    setAddWordsMsg(msg || "Nothing to add.");
  }

  async function createGroup() {
    setGroupMsg("");
    const names = groupWordsInput.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (names.length < 2) {
      setGroupMsg("Add at least 2 words to group.");
      return;
    }
    setCreatingGroup(true);
    try {
      const canonical = [];
      const needsMeaning = [];
      for (const n of names) {
        const key = n.toLowerCase();
        if (wordMap[key]) canonical.push(wordMap[key].w);
        else { needsMeaning.push(n); canonical.push(n); }
      }
      if (needsMeaning.length) {
        const meaningsMap = await defineWords(needsMeaning);
        const failed = needsMeaning.filter((w) => !meaningsMap[w.toLowerCase()]);
        if (failed.length) {
          setGroupMsg(`Couldn't find definitions for: ${failed.join(", ")}. Group not created.`);
          return;
        }
        const newlyAdded = needsMeaning.map((w) => ({ w, m: meaningsMap[w.toLowerCase()] }));
        await Promise.all(newlyAdded.map((a) => addCustomVocabWord(userId, a.w, a.m)));
        setCustomWords((prev) => [...prev, ...newlyAdded]);
      }
      const name = groupName.trim() || canonical.slice(0, 3).join(" / ");
      const group = await createVocabGroup(userId, name, canonical);
      setGroups((prev) => [...prev, group]);
      setGroupName("");
      setGroupWordsInput("");
      setGroupMsg(`Created group "${name}" with ${canonical.length} words.`);
    } catch (e) {
      setGroupMsg(e.message || "Couldn't create group.");
    } finally {
      setCreatingGroup(false);
    }
  }

  function reviewGroup(group) {
    const list = group.words.map((w) => wordMap[w.toLowerCase()]).filter(Boolean);
    if (list.length === 0) {
      setGroupMsg("None of this group's words are available anymore.");
      return;
    }
    startSession(list);
  }

  async function removeGroup(id) {
    await deleteVocabGroup(id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
  }

  async function generateGroups() {
    setAutoGroupMsg("");
    setGeneratingGroups(true);
    try {
      const res = await fetch("/api/group-vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words: allWords.map((x) => ({ w: x.w, m: x.m })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.groups.length === 0) {
        setAutoGroupMsg("Couldn't find any solid clusters in your current word list.");
        return;
      }
      await deleteAutoVocabGroups(userId);
      const created = [];
      for (const g of data.groups) {
        const saved = await createVocabGroup(userId, g.name, g.words, "auto");
        created.push(saved);
      }
      setGroups((prev) => [...prev.filter((g) => g.source !== "auto"), ...created]);
      setAutoGroupMsg(`Created ${created.length} group${created.length > 1 ? "s" : ""} from your ${allWords.length} words.`);
    } catch (e) {
      setAutoGroupMsg(e.message || "Couldn't generate groups.");
    } finally {
      setGeneratingGroups(false);
    }
  }

  function parseWords(text) {
    const names = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const found = [];
    const missing = [];
    for (const n of names) {
      const key = n.toLowerCase();
      if (wordMap[key]) found.push(wordMap[key]);
      else missing.push(n);
    }
    return { found, missing };
  }

  function startSession(list) {
    setQueue(list);
    setIdx(0);
    setAnswer("");
    setGrade(null);
    setClarifyQuestion("");
    setClarifyAnswer("");
    setSessionResults({});
    setStage("quiz");
  }

  function handleStart() {
    setError("");
    const { found, missing } = parseWords(rawInput);
    if (found.length === 0) {
      setError(missing.length ? `None of those matched the vocab list: ${missing.join(", ")}` : "Type at least one word.");
      return;
    }
    if (missing.length) setError(`Not in the list, skipped: ${missing.join(", ")}`);
    startSession(found);
  }

  function loadAll() {
    setError("");
    startSession(allWords);
  }

  function loadDue() {
    setError("");
    const due = allWords.filter((x) => isDue(progress[x.w]));
    if (due.length === 0) {
      setError("Nothing is due yet. Load all to review ahead of schedule.");
      return;
    }
    startSession(due);
  }

  async function submitAnswer() {
    if (!answer.trim()) return;
    setStage("grading");
    setError("");
    const current = queue[idx];
    try {
      const g = await gradeAnswer(current.w, current.m, answer.trim(), null, fastMode);
      if (g.decision === "clarify") {
        setClarifyQuestion(g.question);
        setStage("clarify");
      } else {
        setGrade(g);
        setStage("result");
      }
    } catch (e) {
      setError("Grading failed — check your connection and try again.");
      setStage("quiz");
    }
  }

  async function submitClarification() {
    if (!clarifyAnswer.trim()) return;
    setStage("grading");
    setError("");
    const current = queue[idx];
    try {
      const g = await gradeAnswer(current.w, current.m, answer.trim(), clarifyAnswer.trim(), fastMode);
      setGrade(g);
      setStage("result");
    } catch (e) {
      setError("Grading failed — check your connection and try again.");
      setStage("clarify");
    }
  }

  function verdictToBucket(verdict) {
    if (verdict === "correct") return "learnt";
    if (verdict === "partial") return "revise";
    return "learning";
  }

  async function commitBucket(bucket) {
    const current = queue[idx];
    const prevEntry = progress[current.w];
    const prevStreak = prevEntry && prevEntry.bucket === "learnt" ? prevEntry.streak || 1 : 0;
    const streak = bucket === "learnt" ? prevStreak + 1 : 0;
    const reviewCount = (prevEntry && prevEntry.reviewCount ? prevEntry.reviewCount : 0) + 1;
    const entry = {
      bucket,
      streak,
      reviewCount,
      lastReviewed: new Date().toISOString(),
      nextDueAt: computeNextDue(bucket, streak),
      hook: grade && grade.hook ? grade.hook : prevEntry ? prevEntry.hook : "",
    };
    await upsertVocabProgress(userId, current.w, entry).catch(() => {});
    setProgress((prev) => ({ ...prev, [current.w]: entry }));
    setSessionResults((r) => ({ ...r, [current.w]: bucket }));
    goNext();
  }

  function goNext() {
    setAnswer("");
    setGrade(null);
    setClarifyQuestion("");
    setClarifyAnswer("");
    if (idx + 1 >= queue.length) {
      setStage("done");
    } else {
      setIdx(idx + 1);
      setStage("quiz");
    }
  }

  function goPrev() {
    if (idx === 0) return;
    setAnswer("");
    setGrade(null);
    setClarifyQuestion("");
    setClarifyAnswer("");
    setIdx(idx - 1);
    setStage("quiz");
  }

  function jumpTo(i) {
    setAnswer("");
    setGrade(null);
    setClarifyQuestion("");
    setClarifyAnswer("");
    setIdx(i);
    setStage("quiz");
  }

  function moveToEnd() {
    const current = queue[idx];
    const rest = queue.filter((_, i) => i !== idx);
    const reordered = [...rest, current];
    setQueue(reordered);
    setAnswer("");
    setGrade(null);
    setClarifyQuestion("");
    setClarifyAnswer("");
    setIdx(Math.min(idx, reordered.length - 1));
    setStage("quiz");
  }

  function shuffleQueue() {
    const current = queue[idx];
    const shuffled = shuffleArray(queue);
    setQueue(shuffled);
    const newIdx = shuffled.findIndex((x) => x.w === current.w);
    setIdx(newIdx >= 0 ? newIdx : 0);
    setAnswer("");
    setGrade(null);
    setClarifyQuestion("");
    setClarifyAnswer("");
    setStage("quiz");
  }

  function restartMissed() {
    const missed = Object.entries(sessionResults)
      .filter(([, bucket]) => bucket !== "learnt")
      .map(([word]) => wordMap[word.toLowerCase()]);
    if (missed.length === 0) {
      setStage("setup");
      return;
    }
    startSession(missed);
  }

  const bucketCounts = { learnt: 0, revise: 0, learning: 0 };
  Object.values(progress).forEach((p) => {
    if (bucketCounts[p.bucket] !== undefined) bucketCounts[p.bucket]++;
  });
  const dueNowCount = allWords.filter((x) => isDue(progress[x.w])).length;

  if (!loaded) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;
  if (loadError) {
    return (
      <AppShell>
        <div className="card" style={{ padding: 22, borderLeft: "3px solid var(--red)" }}>
          <div style={{ fontSize: 14, color: "var(--red)", marginBottom: 8 }}>Couldn&apos;t load Vocab Review.</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{loadError}</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div style={eyebrow}>Vocab Review</div>
        <div style={{ display: "flex", gap: 18 }}>
          {["learnt", "revise", "learning"].map((k) => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: BUCKET_INFO[k].color }}>{bucketCounts[k]}</div>
              <div style={{ ...eyebrow, fontSize: 9 }}>{BUCKET_INFO[k].label}</div>
            </div>
          ))}
        </div>
      </div>

      {stage === "setup" && (
        <div className="card" style={{ padding: 22 }}>
          <div style={{ marginBottom: 14 }}>
            <label>Words to review — comma or newline separated</label>
            <textarea rows={3} value={rawInput} onChange={(e) => setRawInput(e.target.value)} placeholder="Acquiescence, Ponderous, Chimerical, Blase" />
          </div>
          {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, color: "var(--muted)", cursor: "pointer", textTransform: "none" }}>
            <input type="checkbox" checked={fastMode} onChange={(e) => setFastMode(e.target.checked)} style={{ width: "auto" }} />
            Fast mode — skip the clarifying-sentence step, always give a best-guess verdict
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={handleStart}>Start review</button>
            <button className="btn" onClick={loadAll}>Load all ({allWords.length})</button>
            <button className="btn" onClick={loadDue}>Load due now ({dueNowCount})</button>
            <button className="btn" onClick={() => { setCopyMsg(""); setStage("browse"); }}>View full list &amp; status</button>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", marginTop: 22, paddingTop: 18 }}>
            <label>Add new words — one per line, plain word or &quot;word: meaning&quot;</label>
            <textarea rows={3} value={addWordsInput} onChange={(e) => setAddWordsInput(e.target.value)}
              placeholder={"Sanguine\nObsequious: excessively eager to please or obey"} />
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4 }}>Words with no meaning given get one looked up automatically.</div>
            {addWordsMsg && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>{addWordsMsg}</div>}
            <div style={{ marginTop: 10 }}>
              <button className="btn" onClick={addCustomWords}>Add to list</button>
            </div>
            {customWords.length > 0 && (
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
                {customWords.length} custom word{customWords.length > 1 ? "s" : ""} added: {customWords.map((c) => c.w).join(", ")}
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--border)", marginTop: 22, paddingTop: 18 }}>
            <label>Synonym groups</label>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
              Let AI cluster your {allWords.length} words into groups of near-synonyms, so you can review words that are easy to confuse together.
            </div>
            <button className="btn btn-primary" onClick={generateGroups} disabled={generatingGroups || allWords.length < 2}>
              {generatingGroups ? "Generating…" : "Auto-generate groups"}
            </button>
            {autoGroupMsg && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>{autoGroupMsg}</div>}

            {groups.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={eyebrow}>Your groups</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  {groups.map((g) => (
                    <div key={g.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{g.name}</div>
                          {g.source === "auto" && <span className="pill" style={{ background: "var(--repeat)", color: "#0F1115" }}>auto</span>}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{g.words.join(", ")}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-primary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => reviewGroup(g)}>Review</button>
                        <button className="btn btn-red" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => removeGroup(g.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <details style={{ marginTop: 18 }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--muted)" }}>Or create a group manually</summary>
              <div style={{ marginTop: 12 }}>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name (optional)" style={{ marginBottom: 10 }} />
                <textarea rows={2} value={groupWordsInput} onChange={(e) => setGroupWordsInput(e.target.value)}
                  placeholder="Supercilious, Haughty, Condescending" />
                {groupMsg && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>{groupMsg}</div>}
                <div style={{ marginTop: 10 }}>
                  <button className="btn" onClick={createGroup} disabled={creatingGroup}>{creatingGroup ? "Creating…" : "Create group"}</button>
                </div>
              </div>
            </details>
          </div>
        </div>
      )}

      {(stage === "quiz" || stage === "grading" || stage === "clarify" || stage === "result") && queue[idx] && (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {queue.map((q, i) => {
              const entry = progress[q.w];
              const active = i === idx;
              return (
                <button key={q.w} title={q.w} onClick={() => jumpTo(i)}
                  style={{
                    width: 28, height: 28, borderRadius: 5, fontSize: 11, cursor: "pointer",
                    border: active ? "2px solid var(--text)" : "1px solid var(--border)",
                    background: entry ? BUCKET_INFO[entry.bucket].bg : "var(--panel2)",
                    color: "var(--text)",
                  }}>
                  {i + 1}
                </button>
              );
            })}
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 6 }}>
              <div style={eyebrow}>Word {idx + 1} of {queue.length}</div>
              {progress[queue[idx].w] && (
                <div style={{ ...eyebrow, color: BUCKET_INFO[progress[queue[idx].w].bucket].color }}>
                  previously: {BUCKET_INFO[progress[queue[idx].w].bucket].label} · {formatDue(progress[queue[idx].w].nextDueAt)}
                </div>
              )}
            </div>
            <div className="serif" style={{ fontSize: 28, fontStyle: "italic", marginBottom: 18 }}>{queue[idx].w}</div>

            {stage === "quiz" && (
              <>
                <textarea
                  ref={inputRef}
                  rows={3}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type what you think this word means…"
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAnswer(); }}
                />
                {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</div>}
                <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn" onClick={goPrev} disabled={idx === 0}>Previous</button>
                  <button className="btn btn-primary" onClick={submitAnswer}>Submit</button>
                  <button className="btn" onClick={() => jumpTo(idx + 1 < queue.length ? idx + 1 : idx)} disabled={idx + 1 >= queue.length}>Skip to next</button>
                  <button className="btn" onClick={moveToEnd}>Move to end</button>
                  <button className="btn" onClick={shuffleQueue}>Shuffle order</button>
                </div>
              </>
            )}

            {stage === "clarify" && (
              <>
                <div style={{ background: "var(--panel2)", border: "1px solid var(--quant)", borderRadius: 5, padding: "12px 14px", marginBottom: 14 }}>
                  <div style={{ ...eyebrow, color: "var(--quant)", marginBottom: 4 }}>Not sure yet — use it in a sentence</div>
                  <div style={{ fontSize: 13.5 }}>{clarifyQuestion}</div>
                </div>
                <textarea
                  rows={3}
                  value={clarifyAnswer}
                  onChange={(e) => setClarifyAnswer(e.target.value)}
                  placeholder={`Use "${queue[idx].w}" in a sentence…`}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitClarification(); }}
                />
                {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</div>}
                <div style={{ marginTop: 14 }}>
                  <button className="btn btn-primary" onClick={submitClarification}>Submit sentence</button>
                </div>
              </>
            )}

            {stage === "grading" && <div style={{ fontSize: 13, color: "var(--muted)" }}>Grading…</div>}

            {stage === "result" && grade && (
              <>
                <span className="pill" style={{ display: "inline-block", marginBottom: 14, background: BUCKET_INFO[verdictToBucket(grade.verdict)].bg, color: BUCKET_INFO[verdictToBucket(grade.verdict)].color, border: `1px solid ${BUCKET_INFO[verdictToBucket(grade.verdict)].color}` }}>
                  {grade.verdict}
                </span>
                <div style={{ fontSize: 14, marginBottom: 12 }}>{grade.feedback}</div>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginBottom: 16 }}>
                  <div style={{ ...eyebrow, marginBottom: 4 }}>Correct meaning</div>
                  <div style={{ fontSize: 14 }}>{queue[idx].m}</div>
                </div>
                {progress[queue[idx].w] && progress[queue[idx].w].hook && progress[queue[idx].w].hook !== grade.hook && (
                  <div style={{ background: "rgba(232,163,61,0.12)", border: "1px solid var(--amber)", borderRadius: 5, padding: "10px 14px", marginBottom: 16 }}>
                    <div style={{ ...eyebrow, color: "var(--amber)", marginBottom: 4 }}>Your saved hook</div>
                    <div style={{ fontSize: 12.5, fontStyle: "italic" }}>{progress[queue[idx].w].hook}</div>
                  </div>
                )}
                {grade.hook && (
                  <div style={{ background: "rgba(232,163,61,0.12)", border: "1px solid var(--amber)", borderRadius: 5, padding: "12px 14px", marginBottom: 16 }}>
                    <div style={{ ...eyebrow, color: "var(--amber)", marginBottom: 4 }}>Memory hook</div>
                    <div style={{ fontSize: 13, fontStyle: "italic" }}>{grade.hook}</div>
                  </div>
                )}
                <div style={{ ...eyebrow, marginBottom: 8 }}>Confirm bucket, or override</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {["learnt", "revise", "learning"].map((b) => (
                    <button key={b} className="btn"
                      style={b === verdictToBucket(grade.verdict) ? { background: BUCKET_INFO[b].color, color: "#0F1115", borderColor: BUCKET_INFO[b].color, fontWeight: 700 } : undefined}
                      onClick={() => commitBucket(b)}>
                      {BUCKET_INFO[b].label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {stage === "done" && (
        <div className="card" style={{ padding: 22 }}>
          <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 14 }}>Session complete</div>
          {["learnt", "revise", "learning"].map((b) => {
            const words = Object.entries(sessionResults).filter(([, bucket]) => bucket === b);
            if (words.length === 0) return null;
            return (
              <div key={b} style={{ marginBottom: 14 }}>
                <div style={{ ...eyebrow, color: BUCKET_INFO[b].color, marginBottom: 6 }}>{BUCKET_INFO[b].label} ({words.length})</div>
                <div style={{ fontSize: 13.5 }}>{words.map(([word]) => word).join(", ")}</div>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button className="btn btn-primary" onClick={restartMissed}>Redo what&apos;s not learnt</button>
            <button className="btn" onClick={() => setStage("setup")}>Back to setup</button>
          </div>
        </div>
      )}

      {stage === "browse" && (
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div className="serif" style={{ fontSize: 18, fontWeight: 600 }}>Full list ({allWords.length} words)</div>
            <button className="btn" onClick={async () => {
              const lines = allWords.map((x) => {
                const p = progress[x.w];
                const bucket = p ? BUCKET_INFO[p.bucket].label : "Not yet reviewed";
                const due = p ? formatDue(p.nextDueAt) : "-";
                return `${x.w} — ${bucket} — due ${due}`;
              });
              try {
                await navigator.clipboard.writeText(lines.join("\n"));
                setCopyMsg("Copied full list to clipboard.");
              } catch (e) {
                setCopyMsg("Couldn't access clipboard — select and copy manually.");
              }
            }}>
              Copy as text
            </button>
          </div>
          {copyMsg && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>{copyMsg}</div>}
          {["learnt", "revise", "learning"].map((b) => {
            const words = allWords.filter((x) => progress[x.w] && progress[x.w].bucket === b);
            if (words.length === 0) return null;
            return (
              <div key={b} style={{ marginBottom: 18 }}>
                <div style={{ ...eyebrow, color: BUCKET_INFO[b].color, marginBottom: 8 }}>{BUCKET_INFO[b].label} ({words.length})</div>
                {words.map((x) => (
                  <div key={x.w} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13.5 }}>
                    <span>{x.w}</span>
                    <span style={{ ...eyebrow, color: "var(--muted)" }}>due {formatDue(progress[x.w].nextDueAt)}</span>
                  </div>
                ))}
              </div>
            );
          })}
          {allWords.some((x) => !progress[x.w]) && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ ...eyebrow, color: "var(--muted)", marginBottom: 8 }}>
                Not yet reviewed ({allWords.filter((x) => !progress[x.w]).length})
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>
                {allWords.filter((x) => !progress[x.w]).map((x) => x.w).join(", ")}
              </div>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => setStage("setup")}>Back to setup</button>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function VocabReviewPage() {
  return (
    <Suspense fallback={<AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>}>
      <VocabReviewPageInner />
    </Suspense>
  );
}

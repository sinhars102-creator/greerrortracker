import { QUANT_SUBTYPES, VERBAL_SUBTYPES } from "./config.js";
import { beginCapture, finishCapture, cancelCapture, submitVocabWords } from "./capturePipeline.js";

const statusEl = document.getElementById("status");
const controlsEl = document.getElementById("controls");
const connectHintEl = document.getElementById("connect-hint");
const answerViewEl = document.getElementById("answer-view");
const sectionPillsEl = document.getElementById("section-pills");
const subtypePillsEl = document.getElementById("subtype-pills");
const answerInput = document.getElementById("answer");
const answerStatusEl = document.getElementById("answer-status");
const captureControlsEl = document.getElementById("capture-controls");
const vocabControlsEl = document.getElementById("vocab-controls");
const vocabWordsInput = document.getElementById("vocab-words");
const vocabStatusEl = document.getElementById("vocab-status");

function renderPills(container, options, current, onPick) {
  container.innerHTML = "";
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "pill" + (opt === current ? " active" : "");
    btn.textContent = opt;
    btn.addEventListener("click", () => onPick(opt));
    container.appendChild(btn);
  });
}

async function render() {
  const stored = await chrome.storage.local.get(["accessToken", "email", "section", "subtype", "pendingCapture"]);

  if (!stored.accessToken) {
    statusEl.textContent = "Not connected";
    statusEl.classList.remove("connected");
    controlsEl.classList.add("hidden");
    answerViewEl.classList.add("hidden");
    connectHintEl.classList.remove("hidden");
    return;
  }

  connectHintEl.classList.add("hidden");
  statusEl.textContent = `Connected as ${stored.email || "..."}`;
  statusEl.classList.add("connected");

  // Mid-capture: show the correct-answer prompt instead of the normal
  // section/subtype controls, whether this popup triggered the capture
  // itself or a hotkey press (from anywhere) did.
  if (stored.pendingCapture) {
    controlsEl.classList.add("hidden");
    answerViewEl.classList.remove("hidden");
    const capturing = stored.pendingCapture.status === "capturing";
    answerInput.disabled = capturing;
    document.getElementById("submit-answer").disabled = capturing;
    document.getElementById("skip").disabled = capturing;
    answerStatusEl.textContent = capturing ? "Capturing…" : "";
    if (!capturing) answerInput.focus();
    return;
  }

  answerViewEl.classList.add("hidden");
  controlsEl.classList.remove("hidden");

  const section = stored.section || "Quant";
  const subtypes = section === "Quant" ? QUANT_SUBTYPES : VERBAL_SUBTYPES;
  const subtype = stored.subtype && subtypes.includes(stored.subtype) ? stored.subtype : subtypes[0];
  if (subtype !== stored.subtype) await chrome.storage.local.set({ section, subtype });

  renderPills(sectionPillsEl, ["Quant", "Verbal"], section, async (picked) => {
    const newSubtypes = picked === "Quant" ? QUANT_SUBTYPES : VERBAL_SUBTYPES;
    await chrome.storage.local.set({ section: picked, subtype: newSubtypes[0] });
    render();
  });

  renderPills(subtypePillsEl, subtypes, subtype, async (picked) => {
    await chrome.storage.local.set({ subtype: picked });
    render();
  });

  const isVocab = section === "Verbal" && subtype === "Vocabulary";
  captureControlsEl.classList.toggle("hidden", isVocab);
  vocabControlsEl.classList.toggle("hidden", !isVocab);
  if (isVocab) {
    vocabStatusEl.textContent = "";
    vocabWordsInput.focus();
  }
}

// Live-update if storage changes while the popup is open (e.g. capture
// finishes, or a hotkey press elsewhere flips pendingCapture on).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") render();
});

document.getElementById("disconnect").addEventListener("click", async () => {
  await chrome.storage.local.remove(["accessToken", "refreshToken", "expiresAt", "email"]);
  render();
});

document.getElementById("capture-now").addEventListener("click", async () => {
  await beginCapture();
  render();
});

async function submitVocab() {
  if (!vocabWordsInput.value.trim()) return;
  vocabStatusEl.textContent = "Logging…";
  const result = await submitVocabWords(vocabWordsInput.value);
  vocabStatusEl.textContent = result.error || result.summary || "";
  if (result.ok) vocabWordsInput.value = "";
}

document.getElementById("log-words").addEventListener("click", submitVocab);
vocabWordsInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitVocab();
});

async function submit() {
  const correctAnswer = answerInput.value.trim();
  answerStatusEl.textContent = "Saving…";
  const result = await finishCapture(correctAnswer);
  answerInput.value = "";
  if (result.error) {
    answerStatusEl.textContent = result.error;
  }
  render();
}

document.getElementById("submit-answer").addEventListener("click", submit);
document.getElementById("skip").addEventListener("click", () => submit());
answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submit();
  if (e.key === "Escape") {
    cancelCapture().then(render);
  }
});

render();

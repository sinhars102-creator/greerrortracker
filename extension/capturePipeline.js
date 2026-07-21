import { APP_API_BASE } from "./config.js";
import { getValidAccessToken } from "./supabaseAuth.js";

// Shared between background.js (hotkey) and popup.js (button) — both are
// extension pages with identical API access, so no message-passing needed.

export function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title, message });
}

// Downscale to roughly match compressImageDataUrl in lib/entries.js, so
// extension captures cost about the same in image tokens as web uploads.
async function compressDataUrl(dataUrl, maxDim = 1600, quality = 0.85) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  const buf = await outBlob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { mediaType: "image/jpeg", base64: btoa(binary) };
}

// Step 1 — remember which tab to capture and flip the popup into
// "awaiting answer" mode. No screenshot/network work yet, so this is fast
// and safe to call as the very first thing on a hotkey press.
export async function beginCapture() {
  const { section, subtype } = await chrome.storage.local.get(["section", "subtype"]);
  if (!section || !subtype) {
    notify("GRE Capture", "Set a section/subtype in the extension popup first.");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.storage.local.set({
    pendingCapture: { status: "awaiting-answer", windowId: tab.windowId, section, subtype },
  });
}

// Step 2 — called once the user has typed (or skipped) the correct answer.
// This is when the screenshot is actually taken, uploaded, and transcribed.
export async function finishCapture(correctAnswer) {
  const { pendingCapture } = await chrome.storage.local.get(["pendingCapture"]);
  if (!pendingCapture) return { error: "Nothing pending" };
  const { windowId, section, subtype } = pendingCapture;

  await chrome.storage.local.set({ pendingCapture: { ...pendingCapture, status: "capturing" } });

  let token;
  try {
    token = await getValidAccessToken();
  } catch {
    await chrome.storage.local.remove("pendingCapture");
    return { error: "Sign-in expired — open the app and click Start Logging again." };
  }
  if (!token) {
    await chrome.storage.local.remove("pendingCapture");
    return { error: "Not connected — open the app and click Start Logging." };
  }

  let image;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 85 });
    image = await compressDataUrl(dataUrl);
  } catch (e) {
    await chrome.storage.local.remove("pendingCapture");
    return { error: `Couldn't capture the screenshot: ${e.message}` };
  }

  let result;
  try {
    const res = await fetch(`${APP_API_BASE}/api/extension/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image, section, subtype, correctAnswer }),
    });
    result = await res.json();
    if (!res.ok) throw new Error(result.error || `Request failed (${res.status})`);
  } catch (e) {
    await chrome.storage.local.remove("pendingCapture");
    return { error: `Couldn't log the question: ${e.message}` };
  }

  await chrome.storage.local.remove("pendingCapture");
  notify("Logged", result.questionText.slice(0, 120));
  return { ok: true, questionText: result.questionText };
}

export async function cancelCapture() {
  await chrome.storage.local.remove("pendingCapture");
}

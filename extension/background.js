import { beginCapture, notify } from "./capturePipeline.js";

// Received from the web app's /extension "Start Logging" page, via
// externally_connectable (scoped to that origin only in manifest.json).
// This is the only way tokens ever get into this extension — no password
// sign-in flow exists here.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type !== "gre-capture-connect") return;
  chrome.storage.local.set(
    {
      accessToken: message.accessToken,
      refreshToken: message.refreshToken,
      expiresAt: message.expiresAt,
      email: message.email || "",
    },
    () => sendResponse({ ok: true })
  );
  return true; // keep the message channel open for the async sendResponse
});

chrome.commands.onCommand.addListener(async (command) => {
  console.log("[GRE Capture] command fired:", command);
  if (command !== "capture-question") return;

  // Open the popup first, using the fresh user-gesture from the keypress —
  // openPopup() can fail if called after other async work eats the gesture,
  // so this has to happen before beginCapture()'s own awaits.
  try {
    await chrome.action.openPopup();
  } catch (e) {
    console.error("[GRE Capture] openPopup failed:", e);
    notify("GRE Capture", "Couldn't open the popup — click the toolbar icon manually.");
  }

  await beginCapture();
});

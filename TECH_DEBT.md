# Tech debt / to-do

Running list of known gaps and deferred work. Add to this as things come up; check items off (or delete) once resolved.

## Open

- **Groq vision fallback goes to Anthropic, should go to Gemini.** `lib/anthropic.js`'s `callClaude` routes any image/document call to Anthropic whenever Groq is selected (Groq has no vision model on a standard key). This means picking Groq to save money still burns Claude credits on every screenshot-based call (`extract-options`, `extract-question`, extension capture) — which is most of Practice/Review's AI cost, since nearly every logged entry has a screenshot. Gemini already handles vision and is otherwise idle when Groq is selected; the fallback should target Gemini instead of Anthropic.

- **Extension capture failures are silently swallowed.** `app/api/extension/capture/route.js` falls back to a `"(see screenshot)"` placeholder on any extraction error with no visible indicator in the extension UI — you only find out by opening the entry later. Console logging was added so failures show up in Vercel's function logs, but there's still no in-extension surfacing (e.g. a warning badge) of `extractionFailed`.

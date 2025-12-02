# Nano Prompt UI — Chrome MV3 (Side Panel)

![Nano Prompt UI – Dark](Screenshot(dark).png) ![Nano Prompt UI – Light](Screenshot(light).png)

**TL;DR:** A privacy-first Chrome extension that runs entirely on-device using Chrome's built-in **Gemini Nano** language model. Version **1.2.0** ships a major **engine + safety + design overhaul** on top of the multimodal 1.0.0 and storage/performance 1.1.0 releases — adding token-aware prompt building, cross-context warmup, a model status chip, tighter XSS + attachment validation, and a unified, flatter UI — while staying 100% local and side-panel based.

---

## ✨ Why Side Panel?

Unlike standard popups that close when you click away, **Nano Prompt UI lives in your Side Panel**.

- **True Multitasking:** Read an article on the left while the AI summarizes it on the right.
- **Persistent Sessions:** Copy text from a website and paste it into the chat without the window closing.
- **Hybrid Execution:** If the side panel / extension context can’t talk to the model, Nano Prompt can fall back to running the prompt directly in the page context (for text-only prompts), so you still get a response instead of a silent failure.

---

## 🚀 Features

### Core Capabilities

**100% Local & Private**

- Runs on Chrome’s on-device **Prompt API** (`LanguageModel` / `window.ai`).
- No calls to external servers; everything stays on your machine.

**Multi-Session Chat**

- Multiple named conversations with their own histories.
- Automatic session titles based on the first exchange.

**Rich Markdown Output**

- Headings, lists, tables, and code blocks.
- Rendered through a strict HTML sanitizer before hitting the DOM.

### 🖱️ Context Menu Integration

Right-click anywhere on the web:

- **Summarize Selection** – Bullet-point summaries of highlighted text.
- **Rewrite Selection** – Rewrite in a more formal or polished tone.
- **Translate Selection** – Translate into your chosen language.
- **Describe Image** – Right-click any image to get a detailed description.

---

## 🆕 v1.2.0 – Engine, Safety & Design Overhaul

This release focuses on the **internal engine, safety model, and UI consistency**, so the extension feels flatter, more predictable, and more robust over long use.

### 🧠 Token-Aware Prompt Engine

- **Explicit token budgets** in `constants.js` for system rules, page context, history, user query, and attachment text. The prompt builder uses these budgets to keep the model comfortably under the Gemini Nano context limit.
- **Sliding-window history** – older messages are trimmed gracefully using token estimates, preserving the initial “setup” part of the conversation when there’s room.
- **Cached prompt headers** – assistant rules and their token count are computed once and reused, reducing per-prompt overhead.
- **Token usage logging** – warns when prompt size crosses ~80% of the configured budget, making it easier to spot pathological contexts.

### 🧊 Cross-Context Warmup & Availability

**Unified warmup flow shared between background and side-panel contexts:**

- Background and UI both use a shared `chrome.storage.session` flag (e.g. `nanoPrompt.warmedUp`) to avoid redundant warmups.
- On first use, a minimal model session is created and destroyed to “prime” the engine.

**Session-scoped warmup**

- The warmup flag is cleared when Chrome restarts, so the model gets primed again only when it’s actually needed.

**Non-blocking UI**

- Warmup runs asynchronously; the side panel stays responsive while Gemini Nano prepares in the background.

### 🟢 Model Status Chip

New **model status chip** in the header that shows:

- `Ready`, `Downloading`, `Page-Mode`, `Setup needed`, `Update Chrome`, or `Unsupported`.

The chip:

- Uses a small, structured status object (`level`, `label`, `tooltip`, `showGuideLink`, flags) returned from `getModelStatusSummary()`.
- Updates live when availability checks run.
- Becomes clickable when there’s an issue and jumps straight into the **Setup Guide**.

### 🔐 Safety & Data Hygiene

**XSS-hardening for titles & inline editors**

- Session titles, template labels, and chip/tooltips are now rendered via `textContent` and an explicit HTML-escape helper instead of raw `innerHTML`.
- Inline session rename and template editing avoid any user-controlled HTML.

**Centralised attachment validation**

- A single `validateAttachment()` function enforces MIME allow-lists and size caps (e.g. ~5 MB images, ~10 MB PDFs).
- Both images and PDFs use the same validator and error messages.

**Dead-code cleanup**

- Removed unused utilities (e.g. `resizeImage`, `dataUrlToBlob`) and their dangling constants so it’s clear which helpers are actually part of the pipeline.

### 📄 PDFs, Progress & Non-Freezing Extraction

**Chunked PDF parsing**

- `pdf.js` now processes pages in an idle-friendly loop using `requestIdleCallback` (with a `setTimeout` fallback) so long documents don’t freeze the panel.

**Progress toasts**

- New `showProgressToast()` in `toast.js` displays a spinner, progress bar, and “Page X of Y” text while extraction runs.
- `attachment-handlers.js` wires `onProgress` callbacks into PDF extraction and keeps the toast in sync.

**Truncation awareness**

- Extraction still respects `PDF_MAX_CHARS`, but now reports how many pages/characters made it into the prompt.

### 🎛️ Encapsulated State & Controller Layer

**Private `appState` in `storage.js`**

- Internal state is no longer imported and mutated directly. Instead, modules call explicit getters/setters like `getSessions()`, `updateSettings(patch)`, `setActiveSnapshot(id)`, etc.

**Controller orchestration**

- `controller.js` (mentioned in docs) centralises common flows like updating templates, sessions, and status chips.
- Handlers (`chat-handlers.js`, `settings-handlers.js`, `attachment-handlers.js`) talk to storage and UI through the controller instead of each other.

### 🎨 Flatter, Unified UI

**Inline session rename (no browser popups)**

- `window.prompt()` for session renaming has been replaced with an inline text field in the session list.
- Enter saves, Escape cancels, and all behaviour is fully keyboard-accessible.

**Saved prompt templates inline**

- Templates are editable in-place with proper add/edit/delete/reset flows, using the same “capsule” UI vocabulary as the rest of the panel.

**Component vocabulary & state classes**

- New documented classes for sections, cards, chips and container states (`.is-busy`, `.is-streaming`, `.is-empty`, `.is-recording`, `.has-error`, `.is-open`, `.is-collapsed`, etc.).
- State is expressed on container elements instead of scattered inline styles, which reduces DOM mutations and keeps the UI flat and consistent.

**Density & typography tokens**

- All small spacing and font sizes now use CSS variables:
  - `--space-0`…`--space-5` for 2–12px spacing.
  - `--font-xs`, `--font-sm`, `--font-md` for 11–13px text.
- Adjusting the “thinness” of the UI is now a single dial change instead of a global search/replace.

**Standardised section headers**

- Every section header uses the same padding, font size, weight, and chip alignment through a `.section-header` pattern.

---

### Earlier releases (still included in v1.2.0)

**v1.1.0 – Storage, performance & UX**

- Per-session storage with a light `sessionMeta` index so large chat lists stay fast.
- Attachments stored separately from message text to avoid `chrome.storage` bloat.
- Session search bar for quick filtering by title/metadata.
- Context snapshots you can pin to a session and reuse without re-scraping.
- Shared global caps for all context (page, selection, PDFs) before prompt building.
- Streaming + PDF processing optimised (batched renders, early-exit, truncation feedback).
- Setup/diagnostics panel showing Prompt API availability and last warmup.
- Small UX touches like smart reply suggestions and clearer attachment lifecycle.

**v1.0.0 – Multimodal, PDFs & translation**

- Image support: attach images or right-click → **Describe image**.
- Local PDF support via bundled Mozilla PDF.js with safe page/char limits and clear errors.
- “Chat with docs”: summarise, explain or extract arguments from PDFs.
- Chrome Translation API integration with automatic detection and a clean Gemini Nano fallback.
- Baseline performance features: virtual scrolling, lazy session loading, streaming-friendly chat, theming (light/dark/system), Setup Guide, and micro-UX like typing indicators and “stop”.

**v0.9.0 – Early foundation**

- Smart auto-naming of sessions from early conversation.
- Toast notifications for key actions (copy, delete, rename, errors).
- First version of the context engine (title, URL, headings, meta description, article text).
- Early architecture for `constants.js`, `model.js` and `storage.js` that later releases built on.

---

## 🧱 Architecture (High-Level)

### 🧠 Context & Prompt Engine

- **Hybrid Scraper**
  - Content script builds a “main content” representation using semantic selectors and noise filters.
  - Early-exit + caching keep it fast even on heavy pages.
- **Context Snapshots vs Live Mode**
  - Live mode: scrape the current tab when needed.
  - Snapshot mode: reuse a frozen context (URL, title, text) stored with the session.
- **Attachment-Aware Prompt Builder**
  - `buildPromptWithContext` combines:
    - System rules,
    - Page or PDF context,
    - Attachment list / types,
    - Time hints,
    - Conversation history (summaries) and current user message.

### ⚡ Performance-Oriented UI

- **Virtualized Chat Log**
  - `virtual-scroll.js` renders only what’s visible.
- **Throttled Streaming**
  - Streaming updates are throttled and focused on a single AI message node.
- **Smart Storage I/O**
  - Session-level persistence and dirty-set tracking mean only changed sessions are written.
  - Large attachments are stored separately to avoid bloating every write.

### 🔐 Security Model

- **Local-Only AI**
  - Gemini Nano is used purely as a text generator with no arbitrary code execution or privileged actions.
- **Strict HTML Sanitization**
  - Markdown → HTML → sanitizer:
    - Whitelisted tags only (no `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, etc.).
    - Event attributes (`on*`) and inline styles are stripped.
    - Non-HTTP(S) links (e.g. `javascript:`) are blocked.
- **Protocol Safety**
  - Images are only loaded over HTTP/HTTPS.
  - System/privileged pages (`chrome://`, `edge://`, etc.) are treated as **AI-disabled**.
- **Documented Threat Model**
  - Prompt injection, URL handling, and storage behaviour are documented in `SECURITY.md`.

---

## 🛠️ Installation (Developer Mode)

1. **Download / Clone** this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `nano-prompt-ui` folder.
5. Pin the extension:
   - Click the puzzle-piece icon and pin **“Nano Prompt UI”**.

---

## ⚙️ Enable On-Device AI (Gemini Nano)

To use Nano Prompt UI, Chrome’s experimental on-device AI features must be enabled.

> 💡 Use the **Setup Guide** inside the extension’s settings to see exactly what’s missing and which flags to flip.

1. Open `chrome://flags` and enable:

   - **Prompt API for Gemini Nano**  
     `chrome://flags/#prompt-api-for-gemini-nano`
   - **Optimization Guide On Device Model**  
     `chrome://flags/#optimization-guide-on-device-model`  
     *(Set to “Enabled BypassPerfRequirement” or similar.)*

2. **Relaunch Chrome.**

### Ensure the Model Downloaded

1. Go to `chrome://components`.
2. Find **Optimization Guide On Device Model**.
3. Click **Check for update**.
4. Wait for a non-zero version and **Status: Up-to-date**.

Once done, the Setup Guide inside Nano Prompt UI should report the Prompt API as **Ready**.

---

## 📂 Project Structure

```text
nano-prompt-ui/
├── manifest.json                 # MV3 manifest (side panel entry, permissions)
├── background.js                 # Service worker, context menus, background warmup
├── content.js                    # Page scraper for titles/body/headings
├── sidepanel.html                # Main side panel UI (chat, sidebar, settings)
├── sidepanel.js                  # Bootstrapping + event wiring into handler modules
├── sidepanel.css                 # Layout, theming, toasts, virtual scroll styles
├── constants.js                  # Limits, timing, labels, model config
├── toast.js                      # Toast notification system
├── model.js                      # Gemini Nano + Translation orchestration, streaming
├── chat-handlers.js              # Chat send/stop, streaming lifecycle, smart replies
├── attachment-handlers.js        # Image/PDF attachments and pending attachment state
├── context-menu-handlers.js      # Summarize/Rewrite/Translate/Describe-image flows
├── settings-handlers.js          # Theme, language, diagnostics, and Setup Guide hooks
├── storage.js                    # Session state, IndexedDB/Chrome storage, search
├── context.js                    # Context assembly, snapshots, prompt construction
├── ui.js                         # DOM helpers, rendering, virtual scroller integration
├── utils.js                      # Markdown → HTML, sanitization, small utilities
├── pdf.js                        # PDF text extraction via local Mozilla PDF.js
├── setup-guide.js                # API checks, flag guidance, diagnostics
├── virtual-scroll.js             # Virtualized list implementation for the chat log
├── SECURITY.md                   # Security model and threat analysis
├── IMPLEMENTATION.md             # Internal implementation notes
├── README.md                     # This file
├── Screenshot.png                # Screenshot used in README
└── lib/
    ├── pdf.min.js                # Bundled Mozilla PDF.js core
    └── pdf.worker.min.js         # Bundled Mozilla PDF.js worker

```

## 🔒 Security

This extension implements defense-in-depth security. See [SECURITY.md](SECURITY.md) for:
- Detailed security layer documentation
- Prompt injection analysis
- Attack scenario mitigations

## 📜 License

The Unlicense — see `LICENSE.txt`.

## 👍 Credits

Built by **Vimal "Vibe Coded"** with AI.
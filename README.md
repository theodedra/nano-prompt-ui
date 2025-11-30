# Nano Prompt UI — Chrome MV3 (Side Panel)

![Nano Prompt UI](Screenshot(dark).png)(Screenshot(light).png)

**TL;DR:** A privacy-first Chrome extension that runs entirely on-device using Chrome's built-in **Gemini Nano** language model. Version **1.1.0** builds on the multimodal 1.0.0 release with a **storage + performance overhaul**, **smarter context handling**, **session search**, and **quality-of-life UX upgrades** — while staying 100% local and side-panel based.

---

## ✨ Why Side Panel?

Unlike standard popups that close when you click away, **Nano Prompt UI lives in your Side Panel**.

- **True Multitasking:** Read an article on the left while the AI summarizes it on the right.
- **Persistent Sessions:** Copy text from a website and paste it into the chat without the window closing.
- **Hybrid Execution:** If the Side Panel / extension context can’t talk to the model, Nano Prompt can fall back to running the prompt directly in the page context (for text-only prompts), so you still get a response instead of a silent failure.

---

## 🚀 Features

### Core Capabilities

- **100% Local & Private**
  - Runs on Chrome’s on-device **Prompt API** (`LanguageModel` / `window.ai`).  
  - No calls to external servers; everything stays on your machine.
- **Multi-Session Chat**
  - Multiple named conversations with their own histories.
  - Automatic session titles based on the first exchange.
- **Rich Markdown Output**
  - Headings, lists, tables, and code blocks.
  - Rendered through a strict HTML sanitizer before hitting the DOM.

### 🖱️ Context Menu Integration

Right-click anywhere on the web:

- **Summarize Selection** – Bullet-point summaries of highlighted text.
- **Rewrite Selection** – Rewrite in a more formal or polished tone.
- **Translate Selection** – Translate into your chosen language.
- **Describe Image** – Right-click any image to get a detailed description.

---

## 🆕 v1.1.0 – Storage, Performance & UX Upgrade

This release focuses on long-term reliability and day-to-day ergonomics.

### 📦 Smarter Sessions & Storage

- **Session-Level Storage**
  - Sessions are stored individually rather than as one giant blob.
  - `sessionMeta` keeps a light index (title, timestamps) so the sidebar loads instantly even with many chats.
- **Attachment Decoupling**
  - Big base64 image/PDF payloads are stored separately from message text.
  - Messages reference attachment IDs instead of embedding the data repeatedly.
  - Reduces `chrome.storage` pressure and makes long-running use realistic.

### 🧭 Session Search & Navigation

- **Session Search Bar**
  - New search input in the sidebar to quickly filter sessions by title and metadata.
  - Works without loading every full history into memory.
- **Cleaner Session Actions**
  - New handler modules for chat, attachments, context-menu actions, and settings keep behaviour predictable and easier to extend.

### 🧠 Context Snapshots & Safer Limits

- **Context Snapshot Mode**
  - Capture the current tab’s context once and “pin” it to the conversation.
  - Reuse the same snapshot without re-scraping the page, perfect for research flows where the article doesn’t change.
- **Non-Aggressive Global Length Caps**
  - All inbound context (page, selection, PDFs) is clamped through a single shared limit before prompt building.
  - Caps are tuned so the model still sees the same amount of information as before — the code just stops doing pointless extra work beyond that.

### ⚡ Performance Tweaks

- **Throttled Streaming Rendering**
  - Streaming updates are batched so the UI isn’t re-rendered on every token.
  - Markdown is optionally rendered less frequently while streaming for smoother typing and scrolling.
- **HTML Context Scraping Early-Exit + Cache**
  - The content script stops walking the DOM once enough text has been collected to fill the configured context budget.
  - Per-URL caching avoids re-scraping the same page when you hit “Use page context” multiple times.
- **PDF Early-Exit & Truncation Feedback**
  - PDF extraction stops reading once `PDF_MAX_CHARS` (+ a small safety margin) is reached.
  - The UI shows a small note like *“PDF text truncated at X pages / Y characters”* so you know what the model actually saw.

### 🧪 Diagnostics & Smart UX

- **Setup / Diagnostics Panel Upgrade**
  - Settings now include status text for Prompt API availability and last warmup.
  - Makes it obvious when Chrome flags or model downloads are misconfigured.
- **Smart Reply Suggestions**
  - After a response, Nano Prompt can surface quick follow-up prompts (e.g. “Summarize”, “Explain like I’m 5”, “Draft a reply”).
  - One tap to ask a natural next question without retyping.
- **Attachment Lifecycle Polish**
  - Clear separation between “pending attachments” for the next message and attachments that belong to past messages.
  - Pending attachments are visible and removable before you hit Send.

---

## 🔥 v1.0.0 Highlights (Multimodal + Translation)

> All of these features are still present in v1.1.0.

### 🖼️ Multimodal Support (Vision)

- **Image Analysis**
  - Attach images via the file button or right-click → **Describe image**.
- **Canvas Conversion**
  - Images are normalized and converted to `<canvas>` objects for the Prompt API.
  - Multiple images can be attached alongside text.

### 📄 Document Support (PDF via Mozilla PDF.js)

- **Local PDF Parsing**
  - Uses bundled **Mozilla PDF.js** (`lib/pdf.min.js`, `lib/pdf.worker.min.js`) shipped with the extension.
- **Chat with Docs**
  - Attach PDFs and ask questions:
    - Summaries,
    - Argument extraction,
    - “Explain this section” style prompts.
- **Safe Limits & Errors**
  - Hard caps on pages & characters (`PDF_MAX_PAGES`, `PDF_MAX_CHARS`).
  - Clear toast errors for oversized or malformed PDFs.
  - Truncation is explicitly surfaced in the chat.

### 🌐 Native Translation API

- **Chrome Translation Integration**
  - Uses Chrome’s experimental Translation API when available.
- **Automatic Detection & Fallback**
  - Auto-detects source language where possible.
  - Falls back to a Gemini Nano translation prompt if the API or language pack isn’t present, with a clear toast message.

### ⚡ Performance & UX (1.0.0 Baseline)

- **Virtual Scrolling**
  - Custom `VirtualScroller` renders only visible messages + a buffer.
- **Lazy Session Loading**
  - Session list loads immediately; histories are fetched when opened.
- **Streaming-Friendly Chat**
  - AI messages update in place.
  - Auto-scroll only when you’re at the bottom (no yanking if you scroll up).
- **Theming**
  - Light, Dark, and System Auto themes.
- **Setup Guide**
  - Built-in Setup Guide checks browser version, flags, and optional AI APIs.
- **Micro-UX**
  - Typing indicator, subtle toasts, and a “stop” behaviour that preserves partial output.

---

## ♻️ v0.9.0 Features (Still Relevant)

- **🏷️ Smart Auto-Naming**
  - Sessions get descriptive titles from the conversation itself.
- **🔔 Toast Notifications**
  - Non-intrusive feedback for copy, delete, rename, errors, etc.
- **🧠 Context Engine**
  - Page-aware prompts that combine:
    - Title, URL, headings, meta description,
    - Best-effort article/body text.
- **⚙️ Early Architecture**
  - `constants.js` centralises limits and strings.
  - `model.js` wraps the Prompt API.
  - `storage.js` defines the base app state shape.

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
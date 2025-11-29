# Nano Prompt UI — Chrome MV3 (Side Panel Edition)

![Nano Prompt UI](Screenshot.png)

**TL;DR:** A privacy-first Chrome extension that runs entirely on-device using Chrome's built-in **Gemini Nano** language model. Version **1.0.0** introduces **multimodal capabilities (Images & PDFs)**, **native translation**, and an **enterprise-grade performance overhaul** (virtual scrolling, lazy loading, smarter state management).

---

## ✨ Why Side Panel?

Unlike standard popups that close when you click away, **Nano Prompt UI lives in your Side Panel**.

- **True Multitasking:** Read an article on the left while the AI summarizes it on the right.
- **Persistent Sessions:** Copy text from a website and paste it into the chat without the window closing.
- **Hybrid Execution:** If the Side Panel API fails, the extension intelligently injects the model into the page context to ensure reliability.

---

## 🚀 Features

### Core Capabilities

- **100% Local & Private:** Runs on Chrome’s on-device **Prompt API** (`window.ai`). No data leaves your device.
- **Multi-Session Chat:** Maintain multiple conversations, each with its own history and auto-generated title.
- **Markdown Output:** AI responses support headings, lists, code blocks, and more, rendered safely in the UI.

### 🖱️ Context Menu Integration

Right-click anywhere on the web:

- **Summarize Selection:** Instantly generate a bulleted summary for selected text.
- **Rewrite Selection:** Rewrite text in a more formal / improved tone.
- **Translate Selection:** Instantly translate text (defaults to English; can be changed via settings).
- **Describe Image:** Right-click any image to get a detailed, AI-generated description.

---

## 🔥 v1.0.0 Highlights (Major Update)

### 🖼️ Multimodal Support (Vision)

- **Image Analysis:**
  - Attach images directly to the chat via the file attachment button.
  - Or right-click any image and choose “Describe image”.
- **Canvas Conversion:**
  - Images are automatically resized and converted to `<canvas>` elements for the Prompt API.
  - Multiple images can be attached as multimodal inputs alongside text.

### 📄 Document Support (PDF via Mozilla PDF.js)

- **Local PDF Parsing:**
  - Uses bundled **Mozilla PDF.js** (`lib/pdf.min.js`, `lib/pdf.worker.min.js`) to parse PDFs on-device.
- **Chat with Docs:**
  - Attach PDFs and ask questions about them:
    - Summarize chapters or sections.
    - Ask “What’s the main argument in this document?”
  - Supports large PDFs up to a configured limit (e.g. **50 pages by default**, configurable via `LIMITS.PDF_MAX_PAGES`).
- **Safe Limits & Feedback:**
  - Enforces `PDF_MAX_PAGES` and `PDF_MAX_CHARS` to prevent runaway processing.
  - Adds a `[PDF content truncated…]` marker when limits are reached.
  - Shows clear toasts (e.g. **PDF too large**, **Too many pages**, **PDF processing failed**).

### 🌐 Native Translation API

- **Direct Integration:**
  - Uses Chrome’s experimental **Translation API** (`window.translation`) when available for fast, high-quality translations.
- **Language Detection:**
  - Automatically detects the source language when possible.
- **Auto-Fallback:**
  - If translation / language detection APIs or language packs are missing, Nano Prompt:
    - Falls back to a Gemini Nano prompt for translation.
    - Displays a toast indicating the fallback and potential performance differences.

### ⚡ Enterprise-Grade Performance

- **Virtual Scrolling:**
  - A `VirtualScroller` renders only visible messages + a small buffer.
  - Keeps the UI smooth even with **hundreds of messages** in a single session.
- **Lazy Loading:**
  - Session metadata loads first so the UI appears quickly.
  - Full session histories are fetched on demand.
- **Streaming-Friendly:**
  - Streaming responses update a single AI message in place.
  - `ResizeObserver` keeps the viewport pinned to the bottom while you’re at the end of the chat.
  - Auto-scroll behavior avoids yanking you back down if you scroll up to read older messages.

### 🎨 Theming & UX

- **Themes:**
  - Full support for **Light**, **Dark**, and **System Auto** modes.
- **Setup Guide:**
  - Built-in **Setup Guide** modal checks:
    - Browser version & channel.
    - Prompt API availability.
    - Optional AI APIs: Translation, Language Detection, Summarization, Rewriter.
  - Shows ✅ / ❌ status and actionable instructions (which flags to enable, what still works if something is missing).
- **Micro-UX Polish:**
  - Typing indicator (“three dots” animation) while the model is thinking.
  - Smart Copy/Speak buttons that appear unobtrusively on messages.
  - Better stop behavior: stopping generation preserves partial output with clear indication.

---

## ♻️ v0.9.0 Features (Retained)

- **🏷️ Smart Auto-Naming**
  - Chat sessions automatically get descriptive titles based on the conversation context.
  - No more “New chat (42)” clutter in the session list.

- **🔔 Toast Notifications**
  - Clean visual feedback for:
    - Copy actions,
    - Saves,
    - Deletes and renames,
    - Errors (network, PDF, AI, translation).
  - Info, Success, and Error variants with subtle animations.

- **🧠 Context Engine**
  - Token/character-budget-based truncation tuned for the Gemini Nano context window.
  - Includes:
    - Page title, URL, headings, meta description.
    - Sanitized main body text (article or best-effort body).
  - Optional overrides allow “summarize this custom text” mode without page content.

- **⚙️ Architecture Overhaul (v0.9.x)**
  - `constants.js` centralizes limits, timing, and UI strings.
  - `model.js` wraps the Prompt API behind a simple interface.
  - `storage.js` standardizes state & persistence layout.

---

## 🧱 Architecture (High-Level)

### 🧠 Advanced Context Engine

- **Hybrid Scraper:**
  - Extracts a best-effort “main content” representation per page: headings, meta description, title, body text.
- **Context Caching:**
  - Per-tab context cache avoids re-scraping when you stay on the same page.
- **Attachment-Aware Prompts:**
  - The prompt builder (`buildPromptWithContext`) combines:
    - System rules,
    - Page/PDF context,
    - Attachment filenames,
    - Time hints,
    - User question.
  - All in a clean, deterministic structure.

### ⚡ Performance-Oriented UI

- **Virtualized Chat Log:**
  - `virtual-scroll.js` keeps the DOM small by only rendering visible messages.
- **Incremental Rendering:**
  - Streaming text updates a single message; no flood of DOM nodes.
- **Smart Storage I/O:**
  - Writes to `chrome.storage` are batched and scoped to changed sessions/fields to avoid quota issues.

### 🔐 Security Model

- **Read-Only AI:**
  - The extension uses local AI as a **stateless text generator**; it has no direct access to privileged APIs.
- **Strict Sanitization:**
  - AI-generated markdown is rendered to HTML and then sanitized:
    - Only whitelisted tags & attributes are allowed.
    - Dangerous URLs (e.g. `javascript:`) are blocked.
- **Protocol Safety:**
  - Image fetching restricted to **HTTP/HTTPS**.
  - Blocked schemes include `file:`, `data:`, `javascript:`, etc.
- **Restricted Pages:**
  - AI features are disabled on privileged pages like `chrome://` and `edge://`.
- **Documented Threat Model:**
  - See `SECURITY.md` for prompt injection analysis, attachment handling, and storage behavior.

---

## 🛠️ Installation (Developer Mode)

1. **Download / Clone** this repository.
2. Open `chrome://extensions` in your browser.
3. Toggle **Developer mode** (top-right corner).
4. Click **Load unpacked** and select the folder containing these files.
5. **Pin the Extension:**
   - Click the puzzle piece icon in Chrome and pin **“Nano Prompt UI”**.

---

## ⚙️ Enable On-Device AI (Gemini Nano)

To use this extension, you must enable Chrome’s experimental AI features.

> 💡 **Tip:** Use the built-in **“Setup Guide”** button in the extension settings to check your current status and get tailored instructions.

1. Open `chrome://flags` and enable:

   - **Prompt API for Gemini Nano**  
     `chrome://flags/#prompt-api-for-gemini-nano`
   - **Optimization Guide On Device Model**  
     `chrome://flags/#optimization-guide-on-device-model`  
     *(Select “Enabled BypassPerfRequirement”)*

2. **Relaunch Chrome.**

### Ensure the Model Download

1. Go to `chrome://components`.
2. Find **Optimization Guide On Device Model**.
3. Click **Check for update**.
4. Wait until you see a version number (e.g. `2024.5.21.1`) and **Status: Up-to-date**.

Once that’s done, the Setup Guide inside Nano Prompt UI should show the Prompt API as **Available**.

---

## 📂 Project Structure

```text
nano-prompt-ui/
├── manifest.json           # Extension configuration (MV3, Side Panel)
├── background.js           # Service worker & context menus (text + image)
├── content.js              # Page content scraper (title, headings, meta, body)
├── sidepanel.html          # Main UI markup (chat, settings, modals)
├── sidepanel.js            # UI event bindings & bootstrapping
├── sidepanel.css           # Styles (theme, layout, toasts, virtual scroll)
├── constants.js            # Centralized configuration (limits, strings, model config)
├── toast.js                # Toast notification system
├── model.js                # AI orchestration (Gemini Nano, translation, image desc)
├── handlers.js             # Event handlers (ask, summarize, attachments, Setup Guide)
├── storage.js              # Browser storage-backed app state & session management
├── context.js              # Context extraction, caching & prompt assembly
├── ui.js                   # Virtualized UI rendering, modals, accessibility helpers
├── utils.js                # Utilities: markdown → HTML, sanitization, helpers
├── pdf.js                  # PDF utilities using Mozilla PDF.js (text extraction, summary)
├── setup-guide.js          # Setup Guide: feature detection & flag checks
├── virtual-scroll.js       # Virtualized message list for large histories
├── SECURITY.md             # Security documentation & threat model
├── IMPLEMENTATION.md       # Internal architecture & implementation notes
├── README.md               # This file
├── Screenshot.png          # README screenshot
└── lib/                    # Embedded third-party libraries
    ├── pdf.min.js          # Mozilla PDF.js core
    └── pdf.worker.min.js   # Mozilla PDF.js worker
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
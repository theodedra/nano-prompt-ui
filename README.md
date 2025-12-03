# Nano Prompt UI

![Nano Prompt UI – Dark](assets/Screenshot(dark).png) ![Nano Prompt UI – Light](assets/Screenshot(light).png)

A privacy-first Chrome extension that runs entirely on-device using Chrome's built-in **Gemini Nano** language model. Everything stays local—no servers, no data leaves your machine.

---

## What is Nano Prompt UI?

Nano Prompt UI is a **side panel chat interface** for Chrome's experimental on-device AI (Gemini Nano). Unlike cloud-based AI assistants, it runs the model directly in your browser with zero network calls.

### Why Side Panel?

Unlike popups that close when you click away, **Nano Prompt UI lives in your Side Panel**:

- **True Multitasking** – Read an article on the left while the AI summarizes it on the right.
- **Persistent Sessions** – Copy text from a website and paste it into the chat without the window closing.
- **Hybrid Execution** – If the side panel can't reach the model, Nano Prompt falls back to running prompts in the page context, so you still get a response instead of a silent failure.

---

## Key Capabilities

### 100% Local & Private

- Runs on Chrome's on-device **Prompt API** (`LanguageModel` / `window.ai`).
- No calls to external servers; everything stays on your machine.

### Multi-Session Chat

- Multiple named conversations with their own histories.
- Automatic session titles based on the first exchange.
- Session search and context snapshots you can pin and reuse.

### Rich Markdown Output

- Headings, lists, tables, and code blocks.
- Rendered through a strict HTML sanitizer before hitting the DOM.

### Attachments & Documents

- **Images** – Attach images or right-click any image → "Describe Image".
- **PDFs** – Chat with local PDFs; summarize, explain, or extract key points.

### Context Menu Integration

Right-click anywhere on the web:

- **Summarize Selection** – Bullet-point summaries of highlighted text.
- **Rewrite Selection** – Rewrite in a more formal or polished tone.
- **Translate Selection** – Translate into your chosen language.
- **Describe Image** – Get a detailed description of any image.

### Theming

- Light, dark, and system-follow modes.

---

## Installation (Developer Mode)

1. **Download / Clone** this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `nano-prompt-ui` folder.
5. Pin the extension:
   - Click the puzzle-piece icon and pin **"Nano Prompt UI"**.

---

## Enable On-Device AI (Gemini Nano)

To use Nano Prompt UI, Chrome's experimental on-device AI features must be enabled.

> 💡 Use the **Setup Guide** inside the extension's settings to see exactly what's missing and which flags to flip.

1. Open `chrome://flags` and enable:

   - **Prompt API for Gemini Nano**  
     `chrome://flags/#prompt-api-for-gemini-nano`
   - **Optimization Guide On Device Model**  
     `chrome://flags/#optimization-guide-on-device-model`  
     *(Set to "Enabled BypassPerfRequirement" or similar.)*

2. **Relaunch Chrome.**

### Ensure the Model Downloaded

1. Go to `chrome://components`.
2. Find **Optimization Guide On Device Model**.
3. Click **Check for update**.
4. Wait for a non-zero version and **Status: Up-to-date**.

Once done, the Setup Guide inside Nano Prompt UI should report the Prompt API as **Ready**.

---

## Basic Usage

1. **Open the side panel** by clicking the Nano Prompt UI icon (or via keyboard shortcut).
2. **Start a chat** – type a question or paste content you want the AI to work with.
3. **Use page context** – the extension can automatically include the current page's content in your prompt.
4. **Attach files** – drag & drop images or PDFs, or use the attachment button.
5. **Right-click actions** – highlight text or right-click an image for quick AI actions.
6. **Manage sessions** – create, rename, search, and switch between conversations in the sidebar.

### Example Flows

| Goal | How |
|------|-----|
| Summarize an article | Open the article, open Nano Prompt, ask "Summarize this page" |
| Explain code | Paste a code snippet and ask "Explain what this does" |
| Translate text | Highlight text on any page → right-click → Translate Selection |
| Chat with a PDF | Attach a PDF and ask questions about its content |
| Describe an image | Right-click any image → Describe Image |

---

## Privacy & Security Model

Nano Prompt UI is designed with **defense-in-depth** security:

### Local-Only Processing

- **No network calls** – the AI model runs entirely on your device.
- **No telemetry** – the extension does not phone home or collect usage data.
- **Your data stays yours** – conversations are stored locally in Chrome's extension storage.

### Security Layers

- **System page blocking** – AI is disabled on `chrome://`, `edge://`, and other privileged pages.
- **Content script isolation** – page JavaScript cannot access or tamper with the extension.
- **Read-only AI** – the model generates text only; it cannot execute code, access browser APIs, or modify state.
- **HTML sanitization** – all AI output is sanitized (whitelist-only tags, no scripts, no event handlers).
- **Input validation** – attachments are validated for type and size before processing.
- **Minimal permissions** – only the permissions actually needed are requested.

### Prompt Injection

Because the AI is read-only with no execution privileges, prompt injection attacks have **limited impact**—at worst, you see odd text output. Nothing persists or executes. See [SECURITY.md](SECURITY.md) for the full threat model and mitigation details.

---

## Architecture Overview

| Layer | Description |
|-------|-------------|
| **Context Engine** | Scrapes page content (title, headings, article text) with noise filtering and caching. |
| **Prompt Builder** | Assembles system rules, page context, attachments, history, and user query within token budgets. |
| **Model Layer** | Interfaces with Chrome's Prompt API; handles streaming, warmup, and fallback modes. |
| **Virtualized UI** | Chat log uses virtual scrolling for performance; streaming updates are throttled. |
| **Storage** | Per-session persistence with dirty-set tracking; attachments stored separately to avoid bloat. |

---

## Project Structure

```
nano-prompt-ui/
├── manifest.json              # MV3 manifest (side panel, permissions)
├── background.js              # Service worker, context menus, warmup
├── content.js                 # Page content scraper (SPA-aware caching)
│
├── sidepanel.html             # Side panel markup
├── sidepanel.js               # Bootstrap + event wiring
├── sidepanel.css              # Layout, theming, styles
│
├── controller/                # Orchestrates handlers and state
│   └── controller.js
│
├── handlers/                  # Modular event handlers
│   ├── chat-handlers.js       # Re-exports + shared navigation handlers
│   ├── prompt-handlers.js     # Prompt execution, summarization, translation
│   ├── session-handlers.js    # Session switching, renaming, deletion, search
│   ├── template-handlers.js   # Template CRUD operations
│   ├── snapshot-handlers.js   # Context snapshot management
│   ├── voice-handlers.js      # Speech recognition and synthesis
│   ├── attachment-handlers.js # Image/PDF attachment handling (sequential queue)
│   ├── settings-handlers.js   # Theme, language, diagnostics hooks
│   └── context-menu-handlers.js # Routes context menu commands
│
├── ui/                        # Modular UI renderers
│   ├── index.js               # Re-exports all UI modules
│   ├── core.js                # DOM caching, busy state, status, input controls
│   ├── log-renderer.js        # Chat message rendering (with cached HTML)
│   ├── session-renderer.js    # Session list rendering
│   ├── template-renderer.js   # Template list rendering
│   ├── snapshot-renderer.js   # Context snapshot rendering
│   ├── modal-manager.js       # Modal open/close, focus trapping
│   └── attachment-renderer.js # Attachment chip rendering
│
├── core/                      # Core business logic
│   ├── context.js             # Context assembly, snapshots, prompt building, intent classification
│   ├── model.js               # Gemini Nano + Translation API interface
│   ├── storage.js             # IndexedDB, session state, persistence, markdown caching
│   └── setup-guide.js         # API availability checks, flag guidance
│
├── config/                    # Configuration constants
│   └── constants.js
│
├── utils/                     # Shared utilities
│   ├── utils.js               # Markdown → HTML, sanitization, utilities
│   ├── toast.js               # Toast notification system
│   └── virtual-scroll.js      # Virtualized chat list (performance optimized)
│
├── pdf/                       # PDF extraction module
│   ├── pdf.js                 # PDF extraction coordinator (delegates to Web Worker)
│   ├── pdf-worker.js          # Web Worker for off-thread PDF text extraction
│   └── lib/
│       ├── pdf.min.js         # Bundled Mozilla PDF.js
│       └── pdf.worker.min.js  # PDF.js worker
│
├── assets/
│   ├── Screenshot(dark).png   # Dark theme screenshot
│   └── Screenshot(light).png  # Light theme screenshot
│
├── package.json               # Dev dependencies (ESLint)
├── eslint.config.js           # Linting configuration
├── LICENSE.txt                # The Unlicense
├── SECURITY.md                # Security model and threat analysis
└── IMPLEMENTATION.md          # Internal implementation notes
```

---

## Documentation

- **[SECURITY.md](SECURITY.md)** – Security model, threat analysis, and attack mitigations
- **[IMPLEMENTATION.md](IMPLEMENTATION.md)** – Internal implementation notes
- **[GitHub Releases](../../releases)** – Version history and changelogs

---

## License

The Unlicense — see [LICENSE.txt](LICENSE.txt).

## Credits

Built by **Vimal "Vibe Coded"** with AI.

# Nano Prompt UI

![Nano Prompt UI – Dark](assets/Screenshot(dark).png) ![Nano Prompt UI – Light](assets/Screenshot(light).png)

A privacy-first Chrome extension that runs entirely on-device using Chrome's built-in **Gemini Nano** language model. Everything stays local—no servers, no data leaves your machine.

---

## What is Nano Prompt UI?

Nano Prompt UI is a **side panel chat interface** for Chrome's experimental on-device AI (Gemini Nano). Unlike cloud-based AI assistants, it runs the model directly in your browser with zero network calls.

### Why Side Panel?

- **True Multitasking** – Read an article on the left while the AI summarizes it on the right.
- **Persistent Sessions** – Copy text from a website and paste it into the chat without the window closing.
- **Hybrid Execution** – If the side panel can't reach the model, Nano Prompt falls back to running prompts in the page context, so you still get a response instead of a silent failure.

---

## Key Capabilities

- 100% local using Chrome’s Prompt API (`LanguageModel` / `window.ai`)
- Multi-session chat with titles, search, and snapshots
- Markdown rendering (sanitized), images/PDF attachments, TTS playback
- Context menu actions: summarize/rewrite/translate selection, describe image
- SPA-aware context capture via deep shadow/slot/iframe walker with noise pruning
- Warm-up via offscreen keeper with download progress and fallbacks

---

## Installation (Developer Mode)

1. Download/clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `nano-prompt-ui` folder.
5. Pin the extension.

### Enable On-Device AI (Gemini Nano)
- Enable flags: `chrome://flags/#prompt-api-for-gemini-nano` and `chrome://flags/#optimization-guide-on-device-model` (bypass perf requirement if needed).
- Relaunch Chrome.
- In `chrome://components`, check **Optimization Guide On Device Model** is up to date.

---

## Warm-up & Performance

- Offscreen-first warmup: a persistent **offscreen document** keeps a base session hot, runs a dummy inference to force delegate/shader init, and survives service-worker teardown.
- Unified warmup button/startup path now delegates to the offscreen keeper with progress reporting; a local prime fallback remains for environments without offscreen support.
- Idle-aware: the keeper releases the base session after long idle/lock, re-warms on activity, and periodically re-primes if evicted by Chrome.
- Prompt execution falls back to the offscreen session if the sidepanel context fails (DOMException, missing engine), then to page-context as a last resort.
- System pages are locked: on `chrome://`/`edge://` the primary controls stay disabled even after a prompt finishes.

---

## Architecture Overview

| Layer | Description |
|-------|-------------|
| **Context Engine** | Deep shadow/slot/iframe walker with quiescence wait, link-density pruning, dedupe, and caching. |
| **Prompt Builder** | Assembles rules, page context, attachments, history, and user query within token budgets. |
| **Model Layer** | Interfaces with Chrome's Prompt API; handles streaming, warmup, and fallbacks. |
| **Virtualized UI** | Chat log uses virtual scrolling; streaming updates are throttled. |
| **Storage** | Per-session persistence; attachments stored separately to avoid bloat. |

---

## Project Structure

```
nano-prompt-ui/

├── background.js              # Service worker, context menus, warmup orchestration
├── content.js                 # Page content scraper (SPA-aware caching)
├── eslint.config.js           # ESLint configuration (code quality rules)
├── manifest.json              # MV3 manifest (side panel, permissions)
├── package.json               # NPM package config (dev deps, scripts)
├── README.md                  # Project documentation (this file)
│
├── assets/                    # Static assets
│   ├── Screenshot(dark).png   # Dark theme screenshot
│   └── Screenshot(light).png  # Light theme screenshot
│
├── config/                    # Configuration constants
│   └── constants.js           # Timing, limits, storage keys, UI messages, validation
│
├── controller/                # Orchestration layer
│   └── controller.js          # Mediates Model, Storage, and UI layers
│
├── core/                      # Core business logic
│   ├── context.js             # Context assembly, snapshots, prompt building, intent classification
│   ├── model.js               # Gemini Nano API interface, streaming, warmup, diagnostics
│   ├── setup-guide.js         # API availability checks, flag guidance
│   └── storage.js             # IndexedDB, session state, persistence, markdown caching
│
├── docs/                      # Documentation
│   ├── IMPLEMENTATION.md      # Technical implementation details
│   ├── LICENSE.txt            # The Unlicense
│   ├── PRIVACY_POLICY.md      # Privacy policy (Chrome Web Store requirement)
│   └── SECURITY.md            # Security model and threat analysis
│
├── handlers/                  # Modular event handlers
│   ├── attachment-handlers.js # Image/PDF attachment handling (sequential queue)
│   ├── chat-handlers.js       # Re-exports + shared navigation handlers
│   ├── context-menu-handlers.js # Routes context menu commands
│   ├── prompt-handlers.js     # Prompt execution, summarization, translation
│   ├── session-handlers.js    # Session switching, renaming, deletion, search
│   ├── settings-handlers.js   # Theme, language, diagnostics hooks
│   ├── snapshot-handlers.js   # Context snapshot management
│   ├── template-handlers.js   # Template CRUD operations
│   └── voice-handlers.js      # Speech recognition and synthesis
│
├── offscreen/                 # Offscreen document (model warmup)
│   ├── offscreen.html         # Offscreen document markup
│   └── offscreen.js           # Warmed session keeper, progress reporting
│
├── pdf/                       # PDF extraction module
│   ├── lib/                   # Third-party PDF.js library
│   │   ├── pdf.min.js         # Bundled Mozilla PDF.js
│   │   └── pdf.worker.min.js  # PDF.js worker
│   ├── pdf.js                 # PDF extraction coordinator (delegates to Web Worker)
│   └── pdf-worker.js          # Web Worker for off-thread PDF text extraction
│
├── sidepanel/                 # Side panel UI
│   ├── index.css              # Layout, theming, styles
│   ├── index.html             # Side panel markup
│   └── index.js               # Bootstrap + event wiring, entry point
│
├── ui/                        # Modular UI renderers
│   ├── attachment-renderer.js # Attachment chip rendering
│   ├── core.js                # DOM caching, busy state, status, input controls
│   ├── index.js               # Re-exports all UI modules
│   ├── log-renderer.js        # Chat message rendering (with cached HTML)
│   ├── modal-manager.js       # Modal open/close, focus trapping
│   ├── session-renderer.js    # Session list rendering
│   ├── snapshot-renderer.js   # Context snapshot rendering
│   └── template-renderer.js   # Template list rendering
│
└── utils/                     # Shared utilities
    ├── toast.js               # Toast notification system
    ├── utils.js               # Markdown → HTML, sanitization, utilities
    └── virtual-scroll.js      # Virtualized chat list (performance optimized)
```

---

## Documentation

- **Privacy Policy:** [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md)
- **Security:** [docs/SECURITY.md](docs/SECURITY.md)
- **Implementation details:** [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)
- **License:** [docs/LICENSE.txt](docs/LICENSE.txt)

---

## License

The Unlicense — see [LICENSE.txt](LICENSE.txt).

## Credits

Built by **Vimal "Vibe Coded"** with AI.

# Nano Prompt UI — Chrome MV3 (Side Panel Edition)

![Nano Prompt UI](Screenshot.png)

**TL;DR:** A privacy-first Chrome extension that runs entirely on-device using Chrome's built-in **Gemini Nano** language model. Version **0.8.0** brings security hardening, performance optimizations, and polished UX improvements.

## ✨ Why Side Panel?

Unlike standard popups that close when you click away, **Nano Prompt UI lives in your Side Panel**.
* **True Multitasking:** Read an article on the left while the AI summarizes it on the right.
* **Persistent Sessions:** Copy text from a website and paste it into the chat without the window closing.
* **Hybrid Execution:** If the Side Panel API fails, the extension intelligently injects the model into the page context to ensure reliability.

## 🚀 Features

### Core Capabilities
* **100% Local & Private:** Runs on the `window.ai` (Prompt API). No data leaves your device.
* **🖱️ Context Menu Integration:**
    * **Summarize Selection:** Right-click any text to instantly generate a bulleted summary.
    * **Rewrite Selection:** Right-click to rewrite text in a formal tone.
    * **Translate to English:** Instantly translate selected text from any language.
    * **Describe Image:** Right-click any image to get an AI-generated description.

### v0.8.0 Highlights

* **⚡ Performance Overhaul:**
    * **Token-Based Context Management:** Smart truncation based on Gemini Nano's ~4K token window instead of raw character counts.
    * **ResizeObserver Scrolling:** Buttery-smooth auto-scroll during streaming responses.
    * **Debounced Tab Updates:** Reduced unnecessary refreshes when switching tabs.
    * **Optimized Storage Writes:** Context saves only on blur, not every keystroke.

* **🔒 Security Hardening:**
    * **URL Protocol Validation:** Image fetching restricted to HTTP/HTTPS only.
    * **Message Validation:** Type-checked storage prevents malformed data injection.
    * **Comprehensive Security Audit:** New `SECURITY.md` documents all security layers.

* **✨ UX Polish:**
    * **Loading Animation:** Animated three-dot indicator while AI is thinking.
    * **Smart Button Positioning:** Copy/Speak buttons appear near your cursor on long messages.
    * **Improved Stop Behavior:** Stopping generation preserves partial output with `*(stopped)*` marker.
    * **Multi-Utility Stop:** Single button stops both AI generation and speech narration.
    * **Session Auto-Cleanup:** Automatically removes oldest sessions when limit (100) is reached.

* **🐛 Bug Fixes:**
    * Fixed race condition when sending rapid queries.
    * Fixed stop button state persisting across tab switches.
    * Fixed memory leak in speech recognition cleanup.
    * Fixed timeout cleanup in image fetching.

### Architecture
* **🧠 Advanced Context Engine:**
    * **Hybrid Scraper:** Uses `TreeWalker` to clean noise from SPAs while preserving content.
    * **Smart Truncation:** Token-aware chunking for optimal context window usage.
* **⚡ Enterprise-Grade Performance:**
    * **Incremental Rendering:** DOM Fragments eliminate freezing during long chats.
    * **Smart Database I/O:** Only writes changed sessions to IndexedDB.
* **🔐 Security First:**
    * **Strict Sanitization:** `DOMParser`-based HTML sanitization prevents XSS.
    * **Protocol Safety:** AI features disabled on privileged pages (`chrome://`, `edge://`).

## 🛠️ Installation (Developer Mode)

1.  **Download/Clone** this repository.
2.  Open `chrome://extensions` in your browser.
3.  Toggle **Developer mode** (top-right corner).
4.  Click **Load unpacked** and select the folder containing these files.
5.  **Pin the Extension:** Click the puzzle piece icon in Chrome and pin "Nano Prompt UI".

## ⚙️ Enable On-Device AI (Gemini Nano)

To use this extension, you must enable Chrome's experimental AI features:

1.  Open `chrome://flags` and enable the following:
    * **Prompt API for Gemini Nano:** `chrome://flags/#prompt-api-for-gemini-nano`
    * **Optimization Guide On Device Model:** `chrome://flags/#optimization-guide-on-device-model` (Select "Enabled BypassPerfRequirement")
2.  **Relaunch Chrome.**

### Ensure the Model Download
1.  Go to `chrome://components`.
2.  Find **Optimization Guide On Device Model**.
3.  Click **Check for update**.
4.  Wait until you see a version number (e.g., `2024.5.21.1`) and Status: **Up-to-date**.

## 🔒 Security

This extension implements defense-in-depth security. See [SECURITY.md](SECURITY.md) for:
- Detailed security layer documentation
- Prompt injection analysis
- Attack scenario mitigations
- Security audit results (Grade: A+)

## 📜 License

The Unlicense — see `LICENSE.txt`.

## 👍 Credits

Built by **Vimal "Vibe Coded"** with AI.
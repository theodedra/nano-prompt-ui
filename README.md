# Nano Prompt UI — Chrome MV3 (Side Panel Edition)

![Nano Prompt UI](Screenshot.png)

**TL;DR:** A privacy-first Chrome extension that runs entirely on-device using Chrome’s built-in **Gemini Nano** language model. Version **0.7.0** introduces contextual actions (Summarize, Rewrite, Translate) directly from the right-click menu.

## ✨ Why Side Panel?

Unlike standard popups that close when you click away, **Nano Prompt UI lives in your Side Panel**.
* **True Multitasking:** Read an article on the left while the AI summarizes it on the right.
* **Persistent Sessions:** Copy text from a website and paste it into the chat without the window closing.
* **Hybrid Execution:** If the Side Panel API fails, the extension intelligently injects the model into the page context to ensure reliability.

## 🚀 Features (v0.7.0 Update)

* **100% Local & Private:** Runs on the `window.ai` (Prompt API). No data leaves your device.
* **⚡ Enterprise-Grade Performance:**
    * **Incremental Rendering:** The UI updates via DOM Fragments, eliminating freezing during long chats.
    * **Smart Database I/O:** Only writes changed sessions to IndexedDB, drastically reducing disk usage.
* **🖱️ Context Menu Integration (New!):**
    * **Summarize Selection:** Right-click any text to instantly generate a bulleted summary in the panel.
    * **Rewrite Selection:** Right-click to rewrite text (Formal tone default).
    * **Translate to English:** Instantly translate selected text from any language.
* **🧠 Advanced Context Engine:**
    * **Hybrid Scraper:** Uses `TreeWalker` technology to clean "noise" (ads, navbars) from Single Page Apps (SPAs) while preserving content structure.
    * **Smart Truncation:** Intelligently chunks long articles to fit Gemini Nano's context window.
* **🔒 Security First:**
    * **Strict Sanitization:** Replaced Regex with `DOMParser` based sanitization to prevent XSS attacks.
    * **Protocol Safety:** Automatically disables AI features on privileged pages (`chrome://`, `settings`).

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
    * **Optimization Guide On Device Model:** `chrome://flags/#optimization-guide-on-device-model` (Select "Enabled BypassPrefRequirement")
2.  **Relaunch Chrome.**

### Ensure the Model Download
1.  Go to `chrome://components`.
2.  Find **Optimization Guide On Device Model**.
3.  Click **Check for update**.
4.  Wait until you see a version number (e.g., `2024.5.21.1`) and Status: **Up-to-date**.

## 📜 License

The Unlicense — see `LICENSE.txt`.

## 👏 Credits

Built by **Vimal "Vibe Coded"** with AI.
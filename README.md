# Nano Prompt UI — Chrome MV3 (Side Panel Edition)

![Nano Prompt UI](Screenshot.png)

**TL;DR:** A privacy-first Chrome extension that runs entirely on-device using Chrome’s built-in **Gemini Nano** language model. Now powered by **IndexedDB** for high-performance history and enterprise-grade security protocols.

## ✨ Why Side Panel?

Unlike standard popups that close when you click away, **Nano Prompt UI lives in your Side Panel**.
* **True Multitasking:** Read an article on the left while the AI summarizes it on the right.
* **Persistent Sessions:** Copy text from a website and paste it into the chat without the window closing or the AI forgetting its thought process.
* **Background Processing:** Long generation tasks continue even if you switch tabs.

## 🚀 Features

* **100% Local & Private:** Runs on the `window.ai` (Prompt API) built into Chrome. No data leaves your device.
* **⚡ High-Performance Engine (v0.5.2):**
    * **IndexedDB Storage:** Chats and large attachments are now stored in an asynchronous database, eliminating UI lag and storage quotas.
    * **Zero-Latency Context:** Uses `chrome.storage.session` to cache tab data in RAM, preventing "State Amnesia" when the service worker sleeps.
* **🔒 Enhanced Security:**
    * **Deny-by-Default:** The side panel is strictly disabled on privileged pages (`chrome://`, `settings`) to prevent unauthorized access.
    * **Sanitized Inputs:** Uses advanced DOM-based sanitization (no Regex) to prevent XSS attacks from malicious web content.
* **Smart Context Engine:**
    * **One-Click Summarization:** Instantly reads the active tab to generate concise summaries.
    * **Smart Truncation:** Intelligently chunks long articles to fit the model's context window.
* **Rich Input & Media:**
    * **Multimodal Support:** Attach images to your prompts (auto-resized for performance).
    * **Voice Mode:** Built-in speech-to-text for dictating prompts.

## 🛠️ Installation (Developer Mode)

1.  **Download/Clone** this repository.
2.  Open `chrome://extensions` in your browser.
3.  Toggle **Developer mode** (top-right corner).
4.  Click **Load unpacked** and select the folder containing these files.
5.  **Pin the Extension:** Click the puzzle piece icon in Chrome and pin "Nano Prompt UI" for easy access.

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
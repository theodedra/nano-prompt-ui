# Nano Prompt UI — Chrome MV3 (On-Device AI, Local-Only)

![Nano Prompt UI](screenshot.png)

**TL;DR:** A privacy-first Chrome extension that runs entirely on-device using Chrome’s built-in **Gemini Nano** language model. No servers, no API keys, and no network calls—your data never leaves your browser.

## ✨ Features

* **100% Local & Private:** Runs on the `window.ai` (Prompt API) built into Chrome.
* **Smart Context Integration:**
  * **Summarize Tab:** One-click summarization of the active web page.
  * **Restricted Page Safety:** Automatically detects browser system pages to prevent hallucinations.
  * **Smart Context:** Automatically drops page context for short, casual chats (e.g., "Hi") to keep responses fast and relevant.
* **Session Management:**
  * Create multiple chat sessions.
  * Rename and delete sessions via the header dropdown.
  * Persistent history (saved locally).
* **Modern UI/UX:**
  * Sleek Dark Mode interface.
  * **Reverse Chronological Chat:** Newest messages appear at the top for easier access.
  * **Voice Dictation:** Built-in speech-to-text input.
* **Advanced Configuration:**
  * **Creativity (Temperature):** Adjust how imaginative or precise the AI is.
  * **Vocabulary (TopK):** Control the variety of words used.
  * **System Prompt:** Customize the AI's persona (e.g., "You are a helpful coding assistant").
* **Export Options:**
  * Copy full chat to clipboard.
  * Save chat history as a Markdown (`.md`) file.

## 🛠️ Installation (Developer Mode)

1. **Download/Clone** this repository.
2. Open `chrome://extensions` in your browser.
3. Toggle **Developer mode** (top-right corner).
4. Click **Load unpacked** and select the folder containing these files.

> **Note:** You cannot drag a `.zip` file directly. Unzip it first.

## ⚙️ Enable On-Device AI (Gemini Nano)

To use this extension, you must enable Chrome's experimental AI features:

1. Open `chrome://flags` and enable the following:
   * **Prompt API for Gemini Nano:** `chrome://flags/#prompt-api-for-gemini-nano`
   * **Optimization Guide On Device Model:** `chrome://flags/#optimization-guide-on-device-model`
   * *(If needed)* **Experimental Web Platform features:** `chrome://flags/#enable-experimental-web-platform-features`
2. **Relaunch Chrome.**

### Ensure the Model Download
1. Go to `chrome://components`.
2. Find **Optimization Guide On Device Model**.
3. Click **Check for update**.
4. Wait until you see a version number (e.g., `2024.5.21.1`) and Status: **Up-to-date**.
   * *If it says "0.0.0.0", the model is still downloading. Leave Chrome open for a while.*

## 🚀 Usage

1. **Chat:** Open the popup and start typing. The newest messages appear at the top.
2. **Sessions:** Click the **"Current Session"** dropdown in the header to switch chats, rename, or delete them. Click **`+`** to start a new chat.
3. **Summarize:** Click **"Summarize tab"** to feed the current page text into the AI.
4. **Settings:** Click the **Gear icon (⚙)** to adjust Creativity (Temperature) and Vocabulary (TopK).
5. **Dictation:** Click the **Mic icon (🎙️)** to speak your prompt.

## 🔧 Troubleshooting

* **"Model Unavailable" / "Standby":**
  * Ensure flags are enabled and you have relaunched Chrome.
  * Check `chrome://components` to ensure the model has finished downloading.
* **"Microphone access denied":**
  * Chrome extensions cannot show permission popups easily. If clicked, the extension will open a new tab to ask for permission once.
* **Permissions:**
  * This extension requests `<all_urls>` host permissions. This is strictly required to read the text content of active tabs for the "Summarize" feature.

## 📜 License

The Unlicense — see `LICENSE.txt`.

## 👏 Credits

Built by **Vimal "Vibe Coded"** with AI.

# Nano Prompt UI — Chrome MV3 (Side Panel Edition)

![Nano Prompt UI](Screenshot.png)

**TL;DR:** A privacy-first Chrome extension that runs entirely on-device using Chrome’s built-in **Gemini Nano** language model. Now updated to a **Side Panel** experience for persistent, uninterrupted AI assistance alongside your browsing.

## ✨ Why Side Panel?

Unlike standard popups that close when you click away, **Nano Prompt UI lives in your Side Panel**.
* **True Multitasking:** Read an article on the left while the AI summarizes it on the right.
* **Persistent Sessions:** Copy text from a website and paste it into the chat without the window closing or the AI forgetting its thought process.
* **Background Processing:** Long generation tasks (like summarizing a long PDF) continue even if you switch tabs.

## 🚀 Features

* **100% Local & Private:** Runs on the `window.ai` (Prompt API) built into Chrome. No data leaves your device.
* **Smart Context Engine:**
    * **One-Click Summarization:** Instantly reads the active tab to generate concise summaries.
    * **Smart Truncation:** Intelligently chunks long articles to fit the model's context window.
    * **Context Optimization:** Automatically detects casual chats (e.g., "Hi") and skips loading page context to save battery and reduce latency.
* **Robust Session Management:**
    * **Auto-Saving:** Chats are saved locally and sync metadata across devices.
    * **Session Control:** Rename, delete, or switch between multiple chat threads via the dropdown menu.
    * **Markdown Support:** Export full chat history to `.md` files.
* **Rich Input & Media:**
    * **Multimodal Support:** Attach images to your prompts (auto-resized for performance).
    * **Voice Mode:** Built-in speech-to-text for dictating prompts.
    * **Templates:** Quick-start prompts for common tasks (Translation, Proofreading, etc.).
* **Advanced Configuration:**
    * **Temperature & TopK:** Fine-tune the creativity and vocabulary of the model.
    * **System Prompt:** Customize the AI's persona (e.g., "You are a cynical senior engineer").

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
    * *If it says "0.0.0.0", the model is still downloading. Keep Chrome open.*

## 💡 Usage Tips

* **Open the Panel:** Click the extension icon to toggle the Side Panel.
* **Check Context:** Click the **Document Icon** (📄) in the top header to see exactly what text the AI is reading from your current tab.
* **Stop Generation:** If the AI starts rambling, hit the **Stop** button immediately.
* **Image Analysis:** You can attach images! The extension automatically resizes them to ensure they fit within storage limits.

## 🔧 Troubleshooting

* **"Model Unavailable":** Ensure you have relaunched Chrome after enabling flags. If it persists, the model might still be downloading in the background.
* **"Context Empty":** Some system pages (`chrome://`, `about:blank`) or complex PDF viewers cannot be read by extensions for security reasons. The extension will alert you if this happens.

## 📜 License

The Unlicense — see `LICENSE.txt`.

## 👏 Credits

Built by **Vimal "Vibe Coded"** with AI.
# Privacy Policy for Nano Prompt UI

**Last Updated: January 2025**

## Overview

Nano Prompt UI is a privacy-first Chrome extension that runs entirely on-device. **This extension does not collect, transmit, or store any personal data on external servers.** All processing occurs locally on your device using Chrome's built-in Gemini Nano language model.

## Data Collection

**We collect zero data.** This extension:
- Does not use analytics or tracking
- Does not send data to external servers
- Does not collect user information
- Does not use cookies or tracking technologies

## Local Data Storage

The extension uses Chrome's local storage mechanisms to provide functionality:

### IndexedDB (Local Database)
- **Chat sessions**: Stores your conversation history locally
- **Session metadata**: Titles, timestamps, and message counts
- **Context snapshots**: Saved page context snapshots (up to 15)
- **Attachments**: Images and PDFs you attach to messages (stored locally)
- **Templates**: Custom prompt templates you create

### Chrome Storage API
- **Settings**: Your preferences (theme, language, temperature, topK, system prompt) stored in Chrome Sync Storage (syncs across your devices if you're signed into Chrome)
- **Context drafts**: Temporary page context text stored in Session Storage (cleared when browser session ends)

All data remains on your device or in your Chrome account (for synced settings). No data is transmitted to external servers.

## Permissions Explained

This extension requires the following permissions to function:

- **`sidePanel`**: Required to display the chat interface in Chrome's side panel
- **`storage`**: Required to save your chat sessions, settings, and preferences locally
- **`unlimitedStorage`**: Required to store multiple chat sessions and attachments without size limits
- **`offscreen`**: Required to maintain a warmed AI model session for faster responses
- **`scripting`**: Required to inject content scripts for extracting page content
- **`activeTab`**: Required to read the current tab's content when you request context
- **`tabs`**: Required to detect tab changes and refresh context when navigating
- **`clipboardWrite`**: Required to copy chat history to your clipboard
- **`contextMenus`**: Required to add right-click options (Summarize, Rewrite, Translate)
- **`host_permissions`** (http/https/file): Required to read page content from websites you visit

**Important**: The extension only accesses page content when you explicitly request it (e.g., clicking "Summarize tab" or using context menu actions). It does not automatically read or transmit page content.

## Third-Party Services

### Chrome's Prompt API (Gemini Nano)
This extension uses Chrome's built-in Prompt API which runs **entirely on-device**. The Gemini Nano model is downloaded and runs locally in your browser. No data is sent to Google's servers or any external services.

### Chrome Translation API (Optional)
If enabled via Chrome flags, the extension may use Chrome's Translation API for translation features. This API also runs on-device and does not transmit data externally.

## Data Sharing

**We do not share any data** because we don't collect any data. All information stays on your device.

## Your Rights

Since all data is stored locally:
- **Access**: All your data is accessible through the extension interface
- **Deletion**: You can delete individual chat sessions or clear all data by uninstalling the extension
- **Export**: You can copy chat history using the "Copy Chat" button
- **Control**: You have full control over what data is stored (you create the sessions and content)

## Data Security

- All data is stored locally using Chrome's secure storage APIs
- No network transmission means no risk of data interception
- The extension uses Chrome's Content Security Policy for additional security
- Source code is open source and available for review

## Children's Privacy

This extension does not knowingly collect information from children. Since we don't collect any data, this is not applicable.

## Changes to This Policy

We may update this privacy policy from time to time. The "Last Updated" date at the top indicates when changes were made. We will notify users of significant changes by updating the version number in the extension manifest.

## Contact

For questions about this privacy policy or the extension:
- Open an issue on the GitHub repository (see README.md for repository link)
- Review the source code to verify our privacy claims

## Compliance

This extension complies with:
- GDPR (no data collection = no GDPR obligations)
- CCPA (no data collection = no CCPA obligations)
- Chrome Web Store policies

---

**Summary**: Nano Prompt UI is 100% local. Your data never leaves your device. No tracking, no analytics, no external servers.


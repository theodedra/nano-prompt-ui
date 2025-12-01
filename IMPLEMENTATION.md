# NanoPromptUI - Implementation Guide

Complete technical documentation for NanoPromptUI Chrome extension features and APIs.

---

## Table of Contents

1. [Chrome AI APIs](#chrome-ai-apis)
2. [API Detection Logic](#api-detection-logic)
3. [Multilingual Support](#multilingual-support)
4. [Translation Implementation](#translation-implementation)
5. [Multimodal Support (Images)](#multimodal-support-images)
6. [PDF Support](#pdf-support)
7. [Virtual Scrolling](#virtual-scrolling)
8. [Lazy Session Loading](#lazy-session-loading)
9. [Storage Architecture](#storage-architecture)
10. [Smart Replies](#smart-replies)
11. [Session Warmup](#session-warmup)
12. [Context Snapshots](#context-snapshots)
13. [Speech Synthesis](#speech-synthesis)
14. [Setup Guide](#setup-guide)

---

## Chrome AI APIs

### Supported APIs

NanoPromptUI integrates with Chrome's Built-in AI APIs:

1. **Prompt API (Gemini Nano)** - Required
   - Global constructor: `LanguageModel`
   - Flag: `chrome://flags/#prompt-api-for-gemini-nano`
   - Purpose: Main AI chat functionality
   - Languages: en, es, ja

2. **Translation API** - Optional
   - Global constructor: `Translator`
   - Flag: `chrome://flags/#translation-api`
   - Purpose: Expert translation for 12+ languages
   - Fallback: Gemini Nano (en/es/ja only)

3. **Language Detection API** - Optional
   - Global constructor: `LanguageDetector`
   - Flag: `chrome://flags/#language-detection-api`
   - Purpose: Auto-detect source language for translation
   - Fallback: Assumes English as source

4. **Summarization API** - Optional
   - Global constructor: `Summarizer`
   - Flag: `chrome://flags/#summarization-api-for-gemini-nano`
   - Purpose: Dedicated summarization model

5. **Rewriter API** - Optional
   - Global constructor: `Rewriter`
   - Flag: `chrome://flags/#rewriter-api-for-gemini-nano`
   - Purpose: Text rewriting and reformatting

---

## API Detection Logic

### Two-Tier Detection Strategy

The setup guide uses a robust two-tier approach to handle all Chrome flag variations:

#### Tier 1: Availability Check (Fast)
```javascript
const availabilityResult = await LanguageModel.availability({
  temperature: 1.0,
  topK: 40,
  expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
});
const status = typeof availabilityResult === 'object'
  ? availabilityResult.availability
  : availabilityResult;
```

**Expected responses:**
- `'readily'` - API ready immediately
- `'after-download'` - Model will download on first use
- `'no'` - API not available

#### Tier 2: Test Session (Fallback)
If Tier 1 returns `'no'` or unexpected value, create a test session to verify:

```javascript
if (!isAvailable) {
  actuallyWorks = await tryCreateSession(() => LanguageModel.create({
    systemPrompt: 'test',
    temperature: 1.0,
    topK: 40,
    expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
  }));
}
```

### Why Two Tiers?

Chrome flags have multiple options (Enabled, Enabled multilingual, Enabled Bypass), and `availability()` sometimes returns `'no'` even when the API works with alternative flag settings. Creating a test session verifies true functionality.

### Global Constructor Pattern

Chrome exposes AI APIs as global constructors in extensions:

```javascript
// ✅ CORRECT - Use global constructors directly
if (typeof LanguageModel === 'undefined') {
  return { available: false, status: 'not-supported' };
}

const availabilityResult = await LanguageModel.availability({ ... });
const testSession = await LanguageModel.create({ ... });
```

---

## Multilingual Support

### Supported Languages

**For Chat (Gemini Nano Prompt API):**
- English (en) - Default
- Spanish (es) - Requires multilingual flag
- Japanese (ja) - Requires multilingual flag

**For Translation (Chrome Translation API):**
- English, Spanish, French, German, Italian, Portuguese
- Russian, Chinese, Japanese, Korean, Arabic, Hindi
- And many others via BCP 47 language codes

### Implementation

**File:** `model.js` - `getSessionConfig()`

```javascript
function getSessionConfig(settings) {
  const userLanguage = getSettingOrDefault(settings, 'language');
  const supportedLanguages = ['en', 'es', 'ja'];
  const language = supportedLanguages.includes(userLanguage) ? userLanguage : 'en';

  return {
    topK: settings.topK,
    temperature: settings.temperature,
    systemPrompt: settings.systemPrompt,
    expectedInputs: [
      { type: 'text', languages: [language] },
      { type: 'image' }
    ],
    expectedOutputs: [{ type: 'text', format: 'plain-text', languages: [language] }]
  };
}
```

---

## Translation Implementation

### Chrome Translation API

NanoPromptUI uses Chrome's dedicated Translation API with automatic language detection.

### Translation Flow

1. **User right-clicks selected text** → "Translate" appears in context menu
2. **User clicks Translate** → Opens side panel
3. **Auto-detect source language** using Language Detector API
4. **Check if source == target** → Skip if same language
5. **Create translator** for source→target language pair
6. **Translate text** using expert translation model
7. **Display result** with language pair indicator: `Translate (es → en): ...`

**File:** `model.js` - `translateText()`

---

## Multimodal Support (Images)

### Supported Image Types

Source: https://github.com/explainers-by-googlers/prompt-api

- `HTMLCanvasElement` ✅ (used for Prompt API)
- `Blob` ✅ (used for IndexedDB storage)
- `ImageData`, `ImageBitmap`
- `HTMLImageElement`, `HTMLVideoElement`

### Implementation Flow

#### 1. Image Capture

**File:** `attachment-handlers.js`

```javascript
// Images are converted: File → Canvas → Blob (for storage)
async function fileToCanvas(file, maxWidth) {
  // ... resize image to canvas
}

async function canvasToBlob(canvas, mimeType) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, 0.95);
  });
}

// Store as Blob (IndexedDB cannot store canvas objects)
Controller.addAttachment({
  name: file.name,
  type: file.type,
  data: blob  // Blob, not canvas
});
```

#### 2. Image Sending

**File:** `model.js` - `runPrompt()`

```javascript
// Convert Blob back to Canvas for Prompt API
const canvases = await Promise.all(
  imageAttachments.map(async (att) => {
    const canvas = await blobToCanvas(att.data, LIMITS.IMAGE_MAX_WIDTH);
    return canvas;
  })
);

// Prompt API multimodal format: structured message with role and content array
promptInput = [{
  role: "user",
  content: [
    { type: "text", value: finalText },
    ...canvases.map(canvas => ({ type: "image", value: canvas }))
  ]
}];
```

### Image Limits

**File:** `constants.js`

```javascript
IMAGE_MAX_WIDTH: 1_024,             // Max width for uploaded images
IMAGE_MAX_WIDTH_DESCRIPTION: 512,   // Max width for context menu image description
IMAGE_QUALITY: 0.7,                 // JPEG compression quality
MAX_ATTACHMENTS: 3,                 // Max attachments per message
```

---

## PDF Support

### Overview

Extracts text from PDF files using Mozilla's pdf.js library (local copy in `lib/`).

**File:** `pdf.js`

### Limits

**File:** `constants.js`

```javascript
PDF_MAX_PAGES: 50,        // Maximum pages to extract
PDF_MAX_CHARS: 50_000,    // Maximum characters (~12,500 tokens)
```

### Extraction Flow

1. Load pdf.js from local `lib/` folder
2. Parse PDF pages sequentially
3. Track character budget with safety margin (`PDF_CHAR_SAFETY_MARGIN = 2_000`)
4. Early exit when budget exceeded (before processing all pages)
5. Return text with truncation metadata

```javascript
// Returns structured result with metadata
{
  text: "extracted text...",
  meta: {
    truncated: boolean,
    pagesProcessed: number,
    totalPagesEstimate: number,
    charsUsed: number
  }
}
```

### Truncation Behavior

- If text exceeds `PDF_MAX_CHARS`, appends: `[...PDF content truncated due to length...]`
- Metadata tracks whether truncation occurred and how many pages were processed

---

## Virtual Scrolling

### Overview

Renders only visible messages + buffer for performance with large chat histories.

**File:** `virtual-scroll.js`

### Activation Threshold

```javascript
static shouldEnable(itemCount) {
  // Enable virtual scrolling for lists with 200+ messages
  return itemCount >= 200;
}
```

### How It Works

1. **Estimated item height** (default 100px) used for scroll calculations
2. **Buffer zone** (5 items above/below viewport) prevents flicker
3. **Top/bottom spacers** maintain scroll position
4. **DOM node cache** (`messageNodes` Map) reuses rendered elements
5. **Scroll debouncing** (100ms) prevents excessive re-renders

### Key Methods

- `enable()` / `disable()` - Toggle virtual scrolling
- `render(messages)` - Render visible items with spacers
- `calibrateItemHeight()` - Measure actual heights after first render
- `reset()` - Clear cache on session switch
- `pruneStaleNodes()` - Remove cached nodes for deleted messages

---

## Lazy Session Loading

### Overview

Reduces startup memory by only loading current session's full data.

**File:** `storage.js`

### Activation Threshold

```javascript
// Enable lazy loading for 50+ sessions
const shouldLazyLoad = normalized.length >= 50;
appState.lazyLoadEnabled = shouldLazyLoad;
```

### How It Works

1. **Startup**: Load only session metadata (id, title, timestamp, messageCount)
2. **Session switch**: Load full session data on-demand from IndexedDB
3. **Metadata cache**: `appState.sessionMeta` holds lightweight records for all sessions
4. **Full data cache**: `appState.sessions` only contains loaded sessions

```javascript
// Lazy load on session switch
export async function setCurrentSession(sessionId) {
  if (appState.lazyLoadEnabled && !appState.sessions[sessionId]) {
    const session = await loadSession(sessionId);
    if (session) {
      appState.sessions[sessionId] = session;
    }
  }
}
```

---

## Storage Architecture

### IndexedDB Schema

**File:** `constants.js`

```javascript
STORAGE_KEYS = {
  DB_NAME: 'NanoPromptDB',
  DB_VERSION: 2,
  STORES: {
    SESSIONS: 'sessions',      // Full session data
    META: 'meta',              // Session order, current session, snapshots
    ATTACHMENTS: 'attachments' // Large blobs stored separately
  }
}
```

### Attachment Separation

Large attachments (images, PDFs) are stored in a separate `ATTACHMENTS` store to keep session records small.

**File:** `storage.js`

```javascript
// Messages store only metadata, not the actual data
function sanitizeMessageAttachments(sessionId, messageIndex, attachments) {
  // Strip data, persist to ATTACHMENTS store, return metadata only
  return { id, name, type, size };
}
```

### Dirty Session Tracking

Only modified sessions are written to IndexedDB on save:

```javascript
const dirtySessions = new Set();

// Mark session as needing save
dirtySessions.add(sessionId);

// On save, only write dirty sessions
dirtySessions.forEach(id => {
  sessionStore.put(appState.sessions[id]);
});
dirtySessions.clear();
```

### Quota Handling

**File:** `storage.js`

```javascript
tx.onerror = (event) => {
  if (event.target.error?.name === 'QuotaExceededError') {
    toast.error('Storage quota exceeded. Please delete old sessions.');
  }
};
```

---

## Smart Replies

### Overview

AI-generated follow-up suggestions displayed after each response.

**File:** `model.js`

### Configuration

```javascript
const SMART_REPLY_LIMIT = 3;           // Max suggestions
const SMART_REPLY_CONTEXT_CHARS = 600; // Context truncation
const SMART_REPLY_MAX_LENGTH = 120;    // Max chars per suggestion
```

### Implementation

```javascript
export async function generateSmartReplies(userText, aiText, settings) {
  const prompt = buildSmartReplyPrompt(userText, aiText);
  const config = {
    temperature: Math.max(0.3, baseTemp - 0.2),
    topK: 32,
    systemPrompt: 'You propose short, helpful follow-up prompts for the user to click.'
  };
  
  const raw = await suggestionSession.prompt(prompt);
  return normalizeSmartReplies(raw); // Parse, filter, truncate
}
```

---

## Session Warmup

### Overview

Pre-warms the AI engine on first sidepanel open for faster first response.

**File:** `model.js`

### Flow

1. Check in-memory flag (`hasWarmedUp`) and session storage
2. If not warmed up, create minimal session and immediately destroy
3. Mark warmed up in both memory and `chrome.storage.session`
4. Warmup persists across sidepanel reopens within same browser session

```javascript
export async function performSessionWarmup() {
  const alreadyWarmed = await checkWarmupFlag();
  if (alreadyWarmed) return { skipped: true };

  const result = await localAI.ensureEngine();
  if (result.success) {
    hasWarmedUp = true;
    syncWarmupFlag(true);
  }
  return { skipped: false, ...result };
}
```

---

## Context Snapshots

### Overview

Saved page contexts that can be reused across sessions.

**File:** `storage.js`

### Storage

```javascript
const MAX_CONTEXT_SNAPSHOTS = 15;

appState.contextSnapshots = []; // Array of saved snapshots
appState.activeSnapshotId = null; // Currently applied snapshot
```

### Snapshot Record

```javascript
{
  id: string,
  title: string,
  url: string,
  text: string,
  createdAt: number
}
```

### API

- `addContextSnapshot(payload)` - Save new snapshot (auto-caps at 15)
- `removeContextSnapshot(id)` - Delete snapshot
- `setActiveSnapshot(id)` - Apply snapshot to context
- `getActiveSnapshot()` - Get currently active snapshot

---

## Speech Synthesis

### Overview

Text-to-speech for AI responses using browser's built-in synthesis.

**File:** `model.js`

### Implementation

```javascript
export function speakText(text, callbacks = {}) {
  if (!('speechSynthesis' in window)) {
    if (onError) onError(new Error('Speech synthesis not supported'));
    return;
  }

  // Cancel any ongoing speech
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH.LANGUAGE; // 'en-US'
  
  // Handle expected user actions (cancel, interrupt) gracefully
  utterance.onerror = (event) => {
    if (SPEECH.EXPECTED_ERROR_TYPES.includes(event.error)) {
      if (onEnd) onEnd();
      return;
    }
    // ... handle actual errors
  };
  
  window.speechSynthesis.speak(utterance);
}
```

---

## Setup Guide

### Philosophy: Minimize Barriers to Entry

- **Only ONE required flag** (Prompt API)
- Extension works immediately with basic features
- Users can enable optional features as needed

### Required vs Optional APIs

#### Required (Must Have)
- **Prompt API (Gemini Nano)**
  - Flag: `chrome://flags/#prompt-api-for-gemini-nano`
  - Value: `Enabled` or `Enabled multilingual`
  - Without this: Extension won't work

#### Optional (Nice-to-Have)

All other APIs are optional with clear fallback explanations:

- **Translation API** - Fallback: Gemini Nano (en/es/ja only)
- **Language Detection API** - Fallback: Assumes English source
- **Summarization API** - Fallback: Gemini Nano with prompts
- **Rewriter API** - Fallback: Gemini Nano with prompts

### System Requirements

**Minimum:**
- Chrome 128+ with Prompt API enabled
- 22 GB free storage
- GPU (4+ GB VRAM) or CPU (16GB RAM, 4+ cores)
- Unmetered internet for model downloads

**Recommended:**
- Chrome 138+
- All APIs enabled for best experience

---

## File Structure

### Core Modules

| File | Purpose |
|------|---------|
| `model.js` | AI operations, streaming, translation, speech |
| `storage.js` | IndexedDB, session management, attachments |
| `controller.js` | Mediates between Model, Storage, and UI |
| `virtual-scroll.js` | Performance optimization for large logs |
| `pdf.js` | PDF text extraction |
| `constants.js` | All configuration values and limits |

### Handler Modules

| File | Purpose |
|------|---------|
| `chat-handlers.js` | Message sending, context menu actions |
| `settings-handlers.js` | Settings panel interactions |
| `attachment-handlers.js` | File upload processing |

### UI Modules

| File | Purpose |
|------|---------|
| `ui.js` | DOM rendering, UI state |
| `toast.js` | Toast notifications |
| `sidepanel.js` | Main entry point, event wiring |

---

## References

- [Chrome Prompt API Documentation](https://developer.chrome.com/docs/ai/prompt-api)
- [Prompt API GitHub](https://github.com/explainers-by-googlers/prompt-api)
- [Translation API](https://developer.chrome.com/docs/ai/translator-api)
- [Chrome Built-in AI APIs](https://developer.chrome.com/docs/ai/built-in-apis)

---

*Last Updated: 2025-12-01*

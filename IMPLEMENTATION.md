# NanoPromptUI - Implementation Guide

Complete technical documentation for NanoPromptUI Chrome extension features and APIs.

---

## Table of Contents

1. [Component Vocabulary](#component-vocabulary)
2. [Chrome AI APIs](#chrome-ai-apis)
3. [API Detection Logic](#api-detection-logic)
4. [Multilingual Support](#multilingual-support)
5. [Translation Implementation](#translation-implementation)
6. [Multimodal Support (Images)](#multimodal-support-images)
7. [PDF Support](#pdf-support)
8. [Virtual Scrolling](#virtual-scrolling)
9. [Lazy Session Loading](#lazy-session-loading)
10. [Storage Architecture](#storage-architecture)
11. [Smart Replies](#smart-replies)
12. [Session Warmup](#session-warmup)
13. [Context Snapshots](#context-snapshots)
14. [Speech Synthesis](#speech-synthesis)
15. [Setup Guide](#setup-guide)

---

## Component Vocabulary

This section documents the UI primitives used throughout NanoPromptUI. Use these patterns consistently when building new features.

**File:** `sidepanel.css`

### Cards

Base surface containers with rounded corners and background.

| Class | Purpose | Example |
|-------|---------|---------|
| `.card` | Base card with surface background | Generic container |
| `.card.chat` | Chat area container | Main message log area |
| `.input-card` | Input area at bottom | Message composer area |
| `.modal-card` | Modal dialog container | Settings, context modals |
| `.setup-guide-card` | Extended modal (500px, scrollable) | Setup guide dialog |

```css
/* Base pattern */
.card {
  background-color: var(--surface);
  border-radius: var(--rad);
  border: none;
}
```

### Rows

Horizontal flex containers for list items with consistent padding and hover states.

| Class | Purpose | States |
|-------|---------|--------|
| `.row` | Base row with gap, for button groups | — |
| `.session-row` | Session list item | `.is-active`, `.is-editing` |
| `.template-row` | Template list item | `.is-editing`, `.new-template` |
| `.snapshot-row` | Context snapshot list item | `.is-active` |

```css
/* Pattern: all rows share this structure */
.session-row, .template-row, .snapshot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-5);
  border-radius: var(--space-3);
  gap: var(--space-5);
}

/* Hover and active states */
.session-row:hover { background-color: var(--surface-3); }
.session-row.is-active { background-color: var(--surface); }
```

### Chips

Small inline elements for tags, status indicators, and badges.

| Class | Purpose | Example |
|-------|---------|---------|
| `.chip` | Base chip (neutral) | Token count display |
| `.chip--success` | Success state (green border) | "Ready" status |
| `.chip--error` | Error state (red border) | "Error" status |
| `.chip--warning` | Warning state (yellow border) | "Downloading" status |
| `.chip--info` | Info state (blue border) | Informational badge |
| `.chip--progress` | Progress/accent state | Active operation |
| `.attachment-chip` | File attachment badge | "image.png" chip |
| `.toast-chip` | Toast notification content | Toast message body |

```css
/* Base chip */
.chip {
  padding: var(--space-0) var(--space-3);
  border-radius: var(--space-2);
  background-color: var(--surface-2);
  color: var(--on-bg-dim);
  font-size: var(--font-xs);
  border-left: 3px solid transparent;
}

/* State variants add colored left border */
.chip--success {
  color: var(--state-success);
  border-left-color: var(--state-success);
}
```

### Buttons

#### Icon Buttons

Square buttons containing only an icon.

| Class | Purpose | Size |
|-------|---------|------|
| `.icon-button` / `.icon` | Standard icon button | 20px icon |
| `.icon-button.mini` / `.mini-icon` | Compact icon button | 18px icon, 32px container |

```css
.icon-button {
  padding: var(--space-2);
  background-color: transparent;
  color: var(--on-bg);
  border-radius: var(--space-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

#### Action Buttons

Text/icon buttons for CRUD operations.

| Class | Purpose | Hover Effect |
|-------|---------|--------------|
| `.action-btn` | Base action button | Opacity increase |
| `.action-btn.save` | Save action (green) | Green tint background |
| `.action-btn.cancel` | Cancel action (dim) | Surface background |
| `.action-btn.delete` | Delete action (red on hover) | Red tint background |
| `.action-btn.delete.is-confirming` | Confirming delete | Solid red background |

#### Button Variants

| Class | Purpose |
|-------|---------|
| `.filled` | High-emphasis button (inverted colors) |
| `.tonal` | Medium-emphasis button (surface background) |

### Inputs

Text input fields with consistent styling.

| Class | Purpose | Example |
|-------|---------|---------|
| `.input-pill` / `.field` | Base text input (pill shape) | Main message textarea |
| `.session-rename-input` | Inline rename input | Session title edit |
| `.template-edit-label` | Template label input | Template name field |
| `.template-edit-text` | Template content textarea | Template body field |
| `.session-search input` | Search input | Session filter |

```css
/* Base input pattern */
.input-pill, .field {
  background-color: var(--surface-2);
  border-radius: 16px;
  padding: var(--space-4) 14px;
  border: none;
}

/* Focus state lightens background */
.input-pill:focus-within { background-color: var(--surface); }
```

### State Classes

#### Container States

Applied to parent containers; CSS cascades to children.

| Class | Container | Effect |
|-------|-----------|--------|
| `.is-busy` | `.wrap` | Overlay effect during operations |
| `.is-streaming` | `.card.chat` | Pulses status chip |
| `.is-empty` | `.card.chat` | Centers log content |
| `.is-recording` | `.input-card` | Highlights mic button, red border |
| `.has-error` | `.input-card` | Red border, error placeholder |

#### Element States

Applied directly to individual elements.

| Class | Purpose |
|-------|---------|
| `.is-active` | Selected/current item |
| `.is-editing` | Item in edit mode |
| `.is-error` | Error state (red) |
| `.is-warning` | Warning state (yellow) |
| `.is-success` | Success state (green) |
| `.is-confirming` | Confirming destructive action |

#### Visibility States

| Class | Purpose |
|-------|---------|
| `.is-open` | Display block |
| `.is-closed` | Display none |
| `.is-collapsed` | Height 0, opacity 0 (animated) |
| `.is-expanded` | Full height, opacity 1 (animated) |
| `.is-hidden` | Opacity 0, no pointer events |
| `.is-visible` | Opacity 1, pointer events enabled |

### Other Components

| Component | Classes | Purpose |
|-----------|---------|---------|
| **Toast** | `.toast-notification`, `.toast-chip` | Floating notifications |
| **Dropdown** | `.dropdown`, `.dropdown-menu`, `.dropdown-item`, `.dropdown-trigger` | Menu system |
| **Section Header** | `.section-header`, `.log-header`, `.appbar` | Consistent header pattern |
| **Messages** | `.msg`, `.msg.user`, `.msg.ai` | Chat bubbles |
| **Info Note** | `.info-note` | Callout boxes with accent border |
| **Setup Section** | `.setup-section`, `.api-item` | Setup guide cards |

### CSS Variables

All components use these shared variables for consistency:

```css
/* Surfaces (background layers) */
--bg: #0a0a0a;           /* App background */
--surface: #141414;       /* Card background */
--surface-2: #1e1e1e;     /* Input background */
--surface-3: #282828;     /* Hover/nested background */

/* Text */
--on-bg: #e8e8e8;         /* Primary text */
--on-bg-dim: #a0a0a0;     /* Secondary text */
--accent: #4a9eff;        /* Links, highlights */

/* State colors */
--state-success: #3fb950;
--state-error: #f85149;
--state-warning: #d29922;
--state-info: #58a6ff;

/* Spacing scale */
--space-0: 2px;  --space-1: 4px;  --space-2: 6px;
--space-3: 8px;  --space-4: 10px; --space-5: 12px;

/* Typography */
--font-xs: 11px;  --font-sm: 12px;  --font-md: 13px;
```

### Quick Reference: "What pattern should I use?"

| Building... | Use |
|-------------|-----|
| A new modal dialog | `.modal-card` |
| A list of selectable items | `.session-row` or `.snapshot-row` pattern |
| A status indicator | `.chip` + state variant (`.chip--success`, etc.) |
| An icon-only button | `.icon-button` or `.mini-icon` |
| A text action button | `.action-btn` + role (`.save`, `.delete`, etc.) |
| A text input field | `.input-pill` or specific variant |
| A section with header | `.section-header` pattern |
| A callout/notice | `.info-note` |
| Showing/hiding content | `.is-open`/`.is-closed` or `.is-collapsed`/`.is-expanded` |
| Indicating selection | `.is-active` |
| Indicating an error | `.is-error` or `.chip--error` |

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

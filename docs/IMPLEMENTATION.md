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
12. [Context Snapshots](#context-snapshots)
13. [Speech Synthesis](#speech-synthesis)
14. [Setup Guide](#setup-guide)
15. [HTML Sanitization Trade-offs](#html-sanitization-trade-offs)
16. [Performance Architecture](#performance-architecture)
17. [Fallback Execution Strategy](#fallback-execution-strategy)
18. [Offscreen Warmup & Session Keeper](#offscreen-warmup--session-keeper)
19. [System Page Lock & UI Disable Rules](#system-page-lock--ui-disable-rules)

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

**File:** `core/model.js` - `getSessionConfig()`

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

**File:** `core/model.js` - `translateText()`

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
// Fast path: off-thread decoding via GPU using createImageBitmap
async function fileToCanvas(file, maxWidth) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  if (width > maxWidth) {
    height = (height * maxWidth) / width;
    width = maxWidth;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  // Instant draw from bitmap (no main thread blocking)
  ctx.drawImage(bitmap, 0, 0, width, height);
  
  // Critical: Free GPU memory immediately
  bitmap.close();
  
  return canvas;
}

// Store as Blob (IndexedDB cannot store canvas objects)
Controller.addAttachment({
  name: file.name,
  type: file.type,
  data: blob
});
```

#### 2. Image Sending

**File:** `core/model.js` - `runPrompt()`

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

**File:** `config/constants.js`

```javascript
IMAGE_MAX_WIDTH: 1_024,             // Max width for uploaded images
IMAGE_MAX_WIDTH_DESCRIPTION: 512,   // Max width for context menu image description
IMAGE_QUALITY: 0.7,                 // JPEG compression quality
MAX_ATTACHMENTS: 3,                 // Max attachments per message
```

---

## PDF Support

### Overview

Extracts text from PDF files using Mozilla's pdf.js library (local copy in `pdf/lib/`), running entirely off the main thread via a Web Worker to keep the UI responsive.

**Files:** `pdf/pdf.js` (coordinator), `pdf/pdf-worker.js` (Web Worker)

### Limits

**File:** `config/constants.js`

```javascript
PDF_MAX_PAGES: 50,        // Maximum pages to extract
PDF_MAX_CHARS: 50_000,    // Maximum characters (~12,500 tokens)
```

### Architecture

```
┌─────────────────┐         ┌──────────────────────┐
│ pdf/pdf.js      │ ──────▶ │  pdf/pdf-worker.js   │
│ (main thread)   │ ◀────── │  (Web Worker)        │
└─────────────────┘         └──────────────────────┘
     │                              │
     │ postMessage({arrayBuffer})   │
     │ ◀─ progress updates ─────────│
     │ ◀─ complete/error ───────────│
```

### Extraction Flow

1. `extractPdfText()` sends `ArrayBuffer` to worker via `postMessage`
2. Worker loads pdf.js via `importScripts()`
3. Worker parses pages sequentially, sending progress updates
4. Worker respects character budget with safety margin (`PDF_CHAR_SAFETY_MARGIN = 2_000`)
5. Worker posts completion message with text and metadata
6. Main thread receives result (no UI blocking)

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

### Sequential Processing

**File:** `handlers/attachment-handlers.js`

Multiple PDF attachments are processed sequentially (not concurrently) to avoid memory pressure:

```javascript
// Process files sequentially to avoid concurrent PDF extractions
for (const file of files.slice(0, LIMITS.MAX_ATTACHMENTS)) {
  // ... process each file
}
```

### Truncation Behavior

- If text exceeds `PDF_MAX_CHARS`, appends: `[...PDF content truncated due to length...]`
- Metadata tracks whether truncation occurred and how many pages were processed

---

## Virtual Scrolling

### Overview

Renders only visible messages + buffer for performance with large chat histories.

**File:** `utils/virtual-scroll.js`

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
5. **requestAnimationFrame** for smooth scroll handling (no setTimeout)
6. **Range change detection** skips DOM updates when viewport unchanged
7. **Stable message IDs** - Never uses array index; generates content-based keys to prevent stale cache hits after deletions

### Performance Optimizations

1. **Cached HTML rendering** - Messages store pre-rendered `htmlCache` (no markdown parsing on scroll)
2. **Lazy pruning** - `pruneStaleNodes()` only runs on message deletions, not every scroll
3. **Efficient range checking** - Skip render if `start`/`end` unchanged

```javascript
// Only prune on deletions to avoid scanning on every render
if (this.needsPrune) {
  this.pruneStaleNodes(messages);
  this.needsPrune = false;
}
```

### Key Methods

- `enable()` / `disable()` - Toggle virtual scrolling
- `render(messages)` - Render visible items with spacers
- `setMessages(messages)` - Update message list, flag for pruning on deletion
- `calibrateItemHeight()` - Measure actual heights after first render
- `reset()` - Clear cache on session switch
- `getMessageNode(message, index)` - Get cached node for streaming updates

---

## Lazy Session Loading

### Overview

Reduces startup memory by only loading current session's full data.

**File:** `core/storage.js`

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

**File:** `config/constants.js`

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

**File:** `core/storage.js`

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

### Debounced Persistence with Mutex

Rapid changes are coalesced into a single IndexedDB transaction. A mutex prevents concurrent writes:

```javascript
TIMING.SAVE_STATE_DEBOUNCE_MS: 500 // Debounce for IndexedDB writes

let saveMutex = Promise.resolve(); // Serializes all save operations

// scheduleSaveState() batches all dirty sessions (respects mutex)
// flushSaveState() for critical operations (immediate save, awaits mutex)
```

### Session Deletion with Rollback

Destructive operations use optimistic updates with rollback on failure:

```javascript
export async function deleteSession(sessionId) {
  // Cache state for potential rollback
  const cachedSession = appState.sessions[sessionId];
  
  // Optimistically update memory
  delete appState.sessions[sessionId];
  
  try {
    await dbOp(STORES.SESSIONS, 'readwrite', store => store.delete(sessionId));
    return true;
  } catch (e) {
    // Rollback memory state on failure
    appState.sessions[sessionId] = cachedSession;
    toast.error('Failed to delete session');
    return false;
  }
}
```

### Quota Handling

**File:** `core/storage.js`

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

**File:** `core/model.js`

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

## Context Snapshots

### Overview

Saved page contexts that can be reused across sessions.

**File:** `core/storage.js`

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

**File:** `core/model.js`

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
| `core/model.js` | AI operations, streaming, translation, speech |
| `core/storage.js` | IndexedDB, session management, attachments, markdown caching |
| `controller/controller.js` | Mediates between Model, Storage, and UI |
| `utils/virtual-scroll.js` | Performance optimization for large logs |
| `pdf/pdf.js` | PDF extraction coordinator (delegates to Web Worker) |
| `pdf/pdf-worker.js` | Web Worker for off-thread PDF text extraction |
| `config/constants.js` | All configuration values and limits |
| `core/context.js` | Context fetching, intent classification, token estimation |

### Handler Modules (`handlers/`)

| File | Purpose |
|------|---------|
| `chat-handlers.js` | Re-exports and shared navigation handlers |
| `prompt-handlers.js` | Prompt execution, summarization, translation |
| `session-handlers.js` | Session switching, renaming, deletion, search |
| `template-handlers.js` | Template CRUD operations |
| `snapshot-handlers.js` | Context snapshot management |
| `voice-handlers.js` | Speech recognition and synthesis |
| `attachment-handlers.js` | File upload processing (sequential queue) |
| `settings-handlers.js` | Settings panel interactions |
| `context-menu-handlers.js` | Routes context menu commands |

### UI Modules (`ui/`)

| File | Purpose |
|------|---------|
| `index.js` | Re-exports all UI modules |
| `core.js` | DOM caching, busy state, status, input controls |
| `log-renderer.js` | Chat message rendering (with cached HTML) |
| `session-renderer.js` | Session list rendering |
| `template-renderer.js` | Template list rendering |
| `snapshot-renderer.js` | Context snapshot rendering |
| `modal-manager.js` | Modal open/close, focus trapping |
| `attachment-renderer.js` | Attachment chip rendering |

### Other Modules

| File | Purpose |
|------|---------|
| `utils/toast.js` | Toast notifications |
| `sidepanel.js` | Main entry point, event wiring |
| `background.js` | Service worker, context menus, warmup |
| `content.js` | Page scraping with SPA cache invalidation |

---

## HTML Sanitization Trade-offs

### Overview

The `markdownToHtml()` function in `utils/utils.js` converts AI responses from markdown to HTML with sanitization. This section documents the intentional trade-off between maximum security and preserving useful output formatting.

### The Trade-off: Safety vs. SPA Context

**Problem:** AI responses often contain or reference page content from SPAs (Single Page Applications). This content may include structural HTML elements like divs, spans, headings, and lists that are meaningful in context.

**Decision:** We use a **balanced whitelist approach** rather than maximum restriction.

### What We Allow (and Why)

| Element | Purpose |
|---------|---------|
| `p`, `br` | Basic paragraph/line structure |
| `strong`, `em` | Emphasis in explanations |
| `code`, `pre` | Code snippets (critical for dev tool) |
| `ul`, `ol`, `li` | Lists (common in AI responses) |
| `h1`, `h2`, `h3` | Section headings |
| `a` | Links (with sanitized href) |
| `div`, `span` | Structural elements from page context |

### What We Strip (Security-Critical)

| Element/Attribute | Why Blocked |
|-------------------|-------------|
| `<script>` | XSS vector |
| `<iframe>`, `<object>`, `<embed>` | Frame injection |
| `<style>` | CSS injection |
| `on*` attributes | Event handler injection |
| `style` attribute | CSS injection |
| `javascript:` URLs | Script execution |

### Why Not Stricter?

A text-only or minimal-tag sanitizer would:

1. **Break readability** - AI responses explaining page structure become walls of text
2. **Remove code formatting** - Critical for a developer-focused tool
3. **Degrade list rendering** - Common in summaries and explanations
4. **Minimal security gain** - The AI is read-only; it cannot execute code

### Architectural Context

The sanitizer is **one layer** in a defense-in-depth model:

1. **System page blocking** - AI disabled on chrome://, edge://, etc.
2. **Content script isolation** - Chrome's built-in sandbox
3. **Read-only AI** - No execution, no API access, no persistence
4. **HTML sanitization** - Prevents XSS in rendered output
5. **Input validation** - Type checking for all stored data

See `SECURITY.md` for the complete security model.

### Maintenance Guidance

> ⚠️ **DO NOT** make the sanitizer more aggressive without reviewing this trade-off.

If considering changes:

1. Document the specific threat you're addressing
2. Test with real AI responses that reference SPA content
3. Verify that code blocks, lists, and explanatory formatting still render correctly
4. Update this section and the inline comments in `utils/utils.js`

**Files involved:**
- `utils/utils.js` - `markdownToHtml()`, `sanitizeHtmlString()`
- `ui.js` - Calls to `markdownToHtml()` in message rendering
- `config/constants.js` - `VALIDATION.ALLOWED_HTML_TAGS`, `VALIDATION.ALLOWED_LINK_ATTRIBUTES`

---

## Intent Classification

### Overview

User queries are classified to determine context handling.

**File:** `core/context.js`

### Patterns

```javascript
INTENT_PATTERNS = {
  page: /\b(summari|page|article|tab|website|context|window)\b/i,
  time: /\b(time|date|today|now)\b/i,
  location: /\b(where|location|lat|long)\b/i
}
```

Note: Word boundaries (`\b`) prevent false positives (e.g., "tabletop" won't match "page" intent).

### Token Estimation

**File:** `core/context.js`

Character-class weighted estimation for more accurate token counts:

```javascript
export function estimateTokens(text) {
  if (!text) return 0;
  
  const counts = {
    words: (text.match(/\b[a-zA-Z]{1,12}\b/g) || []).length,      // 1 token each
    longWords: (text.match(/\b[a-zA-Z]{13,}\b/g) || []).length,   // ~2.5 tokens each
    numbers: (text.match(/\d+/g) || []).length,                    // 1 token per group
    symbols: (text.match(/[^\w\s]/g) || []).length,                // 1 token each
    cjk: (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length, // 1 token each
    whitespace: (text.match(/\s+/g) || []).length                  // merged (~1 per 4)
  };
  
  let tokens = counts.words + (counts.longWords * 2.5) + counts.numbers 
             + counts.symbols + counts.cjk + Math.ceil(counts.whitespace / 4);
  
  return Math.ceil(tokens * 1.1); // 10% safety margin
}
```

---

## SPA Context Extraction & Cache Invalidation

### Overview

The context engine now uses a deep shadow walker with SPA quiescence detection to capture meaningful content from modern apps before the model prompt is built.

**File:** `content.js`

### Extraction Pipeline

1. **Quiescence wait** – A `MutationObserver` waits for ~200ms of no DOM mutations (max ~1.5s) so hydration/route changes settle before scraping.
2. **Deep traversal** – Recursive walk that:
   - Descends into open **shadow roots**
   - Follows **slot assigned nodes**
   - Traverses **same-origin iframes**
   - Preserves **heading/block boundaries** for better summaries
3. **Visibility and pruning** – Short-circuits invisible branches and skips high link-density/nav blocks to keep noise out.
4. **Noise filtering** – Drops short text nodes, excluded tags, and common noise phrases; dedupes paragraphs and caps total paragraphs.
5. **Selection priority** – If the user has a selection, it is returned immediately (no walk).
6. **Budget guard** – Enforces a ~12k char cap with a small safety margin before returning the cleaned text.

### Cache & SPA Detection

- **Cache TTL:** 30s per URL.
- **Invalidation:** Resets on `popstate`, `pushState`/`replaceState` (history change), URL change, or pathname change.
- **Async messaging:** `GET_CONTEXT` handler is fully async to accommodate the quiescence delay and deeper walk.

---

## Attachment Data Integrity

### Overview

Attachments are stored in a separate IndexedDB store to keep session records small. Write failures are now properly tracked and reported.

**File:** `core/storage.js`

### Error Handling

```javascript
// Session normalization is now fully ASYNC to prevent data loss on app close
async function normalizeSession(session) {
  // ... extract attachments ...
  
  if (attachmentPromises.length > 0) {
    // Critical: Await persistence before returning session to UI
    // Prevents "fire-and-forget" race conditions
    await Promise.all(attachmentPromises);
  }
  return session;
}
```

### Deferred Attachment Verification

If attachment writes fail during message creation, the session is flagged for verification on next load:

```javascript
// On write failure, mark session for cleanup
Promise.all(attachmentPromises).catch(async () => {
  await markSessionNeedsAttachmentVerify(sessionId);
});

// On load, verify and clean up orphaned references
if (sessionsNeedingAttachmentVerify.has(session.id)) {
  await verifySessionAttachments(session); // Removes refs to missing blobs
}
```

### Batch Session Cleanup

When `MAX_SESSIONS` is exceeded, old sessions are deleted in a single transaction:

```javascript
// Batch IndexedDB deletes in single transaction
const tx = db.transaction(storeNames, 'readwrite');
sessionsToRemove.forEach(oldId => {
  sessionStore.delete(oldId);
  // Delete attachments via index cursor
});
```

---

## Markdown HTML Caching

### Overview

Messages store pre-rendered HTML to avoid repeated markdown parsing during scroll and re-render operations.

**Files:** `core/storage.js`, `ui/log-renderer.js`

### Implementation

```javascript
// core/storage.js - upsertMessage()
if (storedMessage.text) {
  storedMessage.htmlCache = markdownToHtml(storedMessage.text);
}

// ui/log-renderer.js - createMessageElement()
const html = msg.htmlCache || markdownToHtml(msg.text);
```

### Benefits

- Virtual scroller reuses cached DOM nodes (no re-parsing)
- Session load doesn't trigger markdown parsing
- Streaming updates invalidate cache only for the active message

---

## Performance Architecture

### Context Scraping (`content.js`)
- **Quiescence-first:** Wait for DOM stability before scraping to avoid half-hydrated content.
- **Deep shadow walk:** Recurses through shadow roots, slots, and same-origin iframes; preserves headings/blocks.
- **Noise-aware:** High link-density blocks and excluded tags are pruned early; dedupes paragraphs; caps total paragraphs and chars.
- **Visibility-last:** Cheap filters run before expensive `checkVisibility` to reduce layout thrash.

### Event Delegation for Hover (`ui/core.js`)
Chat hover uses event delegation instead of per-message listeners:
1.  **Single Listener:** One `mousemove` + `scroll` listener on the log container (not N listeners per message).
2.  **Tracked State:** `currentHoveredMsg` tracks active message; class `hover-active` applied/removed on change.
3.  **Scroll Support:** Buttons follow cursor when scrolling between messages without moving the mouse.
4.  **Result:** O(1) listeners regardless of message count; correct hover state during scroll.

---

## Fallback Execution Strategy

When the Side Panel cannot access the model directly (e.g., strict CORS on images or `window.ai` limitations), the extension injects code into the `MAIN` world of the active tab.

### Privacy & Fingerprinting Protection
To prevent websites from detecting the extension or hijacking sessions:
1.  **Randomized Keys:** Storage on `window` uses a rotated UUID key (e.g., `window.__nano_a1b2c3...`) generated at startup.
2.  **Ephemeral State:** Injected scripts strictly clean up their global variables immediately after execution.
3.  **Isolation:** No static string identifiers (like `__nanoPageSessions`) are ever exposed to the page context.

---

## Offscreen Warmup & Session Keeper

- Offscreen host: `offscreen/offscreen.html` + `offscreen/offscreen.js`.
- Lifecycle: `background.js` ensures the offscreen doc exists on install/startup and delegates warm-up there before legacy warmup. The keeper warms the model with a dummy prompt, reports progress (`OFFSCREEN_WARMUP_PROGRESS`), and keeps a base session alive; prompts can clone this base to avoid KV leakage.
- Unified warmup: the Settings “Warm up” button and startup flow route through the offscreen keeper first, with a local priming fallback only if offscreen messaging fails.
- Prime behavior: `localAI.prime()` now runs a dummy prompt to force delegate/shader init when it is used as a fallback.
- Keep-alive/idle: the keeper periodically re-primes if evicted, releases the base session after extended idle/lock (via `chrome.idle`), and re-warms on activity to balance RAM use with latency.
- Fallback order (core/model.js): Extension streaming → Offscreen prompt (with re-warm retry if destroyed) → Page-context prompt (only on http/https tabs with `window.ai`).

---

## System Page Lock & UI Disable Rules

- System/privileged pages (`chrome://`, `edge://`) set a restricted state. Primary controls (Ask, Summarize, mic, attach) remain disabled even after a prompt completes.
- Busy state respects restriction: Ask/Summarize stay disabled if either busy or restricted; Stop is only enabled while busy.
- Status chip shows “System Page” and inputs swap to a disabled placeholder; menus remain closable but primary actions are blocked.

---
## References

- [Chrome Prompt API Documentation](https://developer.chrome.com/docs/ai/prompt-api)
- [Prompt API GitHub](https://github.com/explainers-by-googlers/prompt-api)
- [Translation API](https://developer.chrome.com/docs/ai/translator-api)
- [Chrome Built-in AI APIs](https://developer.chrome.com/docs/ai/built-in-apis)

---

*Last Updated: 2025-12-05 (v1.5.0)*

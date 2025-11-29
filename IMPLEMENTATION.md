# NanoPromptUI - Implementation Guide

Complete technical documentation for NanoPromptUI Chrome extension features and APIs.

---

## Table of Contents

1. [Chrome AI APIs](#chrome-ai-apis)
2. [API Detection Logic](#api-detection-logic)
3. [Multilingual Support](#multilingual-support)
4. [Translation Implementation](#translation-implementation)
5. [Image Support](#image-support)
6. [Setup Guide](#setup-guide)

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

// Helper function
async function tryCreateSession(createFn) {
  try {
    const session = await createFn();
    if (session) {
      session.destroy();
      return true;
    }
  } catch (e) {
    // Session creation failed
  }
  return false;
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

### API Access Pattern with Fallback

```javascript
function getLanguageModelAPI() {
  // In Chrome extensions, the API is a global LanguageModel constructor
  if (typeof LanguageModel !== 'undefined') {
    return LanguageModel;
  }

  // Fallback: try the namespace approach (older/alternative implementations)
  if (typeof self !== 'undefined' && self.ai && self.ai.languageModel) {
    return self.ai.languageModel;
  }
  if (typeof window !== 'undefined' && window.ai && window.ai.languageModel) {
    return window.ai.languageModel;
  }
  if (typeof globalThis !== 'undefined' && globalThis.ai && globalThis.ai.languageModel) {
    return globalThis.ai.languageModel;
  }

  return null;
}
```

### Standardized Helpers

**File:** `setup-guide.js`

```javascript
// Try to create a session to verify API works
async function tryCreateSession(createFn) {
  try {
    const session = await createFn();
    if (session) {
      session.destroy();
      return true;
    }
  } catch (e) {
    // Session creation failed
  }
  return false;
}

// Get status message based on availability result
function getStatusMessage(status, actuallyWorks) {
  if (status === 'readily' || status === 'available') {
    return 'Ready';
  } else if (status === 'after-download' || status === 'downloadable') {
    return 'Ready (model will download on first use)';
  } else if (actuallyWorks) {
    return 'Ready (Working with current flag setting)';
  } else {
    return 'Not available';
  }
}
```

### Standard API Check Pattern

```javascript
async function checkXXXAPI() {
  try {
    // 1. Check if API exists
    if (typeof XXXAPI === 'undefined') {
      return { available: false, status: 'not-supported', ... };
    }

    // 2. Check availability
    const availabilityResult = await XXXAPI.availability({ ... });
    const status = typeof availabilityResult === 'object'
      ? availabilityResult.availability
      : availabilityResult;

    let isAvailable = status === 'readily' || status === 'after-download';
    let actuallyWorks = false;

    // 3. If availability check fails, try test session using helper
    if (!isAvailable) {
      actuallyWorks = await tryCreateSession(() => XXXAPI.create({ ... }));
    }

    // 4. Combine results
    isAvailable = isAvailable || actuallyWorks;

    // 5. Generate appropriate message using helper
    const message = getStatusMessage(status, actuallyWorks);

    return {
      available: isAvailable,
      status: actuallyWorks ? 'working' : status,
      message,
      flag: 'chrome://flags/#xxx',
      flagValue: 'Enabled, Enabled Bypass, or any enabled option',
      required: true/false,
      fallback: '...' // For optional APIs
    };
  } catch (e) {
    return { available: false, status: 'error', ... };
  }
}
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

### Setup Requirements

**For Chat:**
- English only: `chrome://flags/#prompt-api-for-gemini-nano` → "Enabled"
- Spanish/Japanese: `chrome://flags/#prompt-api-for-gemini-nano` → "Enabled multilingual"

**For Translation:**
- `chrome://flags/#translation-api` → "Enabled"
- `chrome://flags/#language-detection-api` → "Enabled" (for auto-detection)

### Implementation

#### Session Configuration

When creating an AI session, the extension dynamically configures:

```javascript
{
  expectedInputs: [
    { type: 'text', languages: [selectedLanguage] },
    { type: 'image' }
  ],
  expectedOutputs: [
    { type: 'text', format: 'plain-text', languages: [selectedLanguage] }
  ]
}
```

#### Files Modified

- **constants.js** - Added `language: 'en'` to DEFAULT_SETTINGS, added LANGUAGE_LABELS and LANGUAGE_NAMES constants
- **sidepanel.html** - Added language selector dropdown
- **handlers.js** - Language selection and saving logic, uses LANGUAGE_LABELS constant
- **sidepanel.js** - Event listeners for language dropdown
- **ui.js** - Menu toggle support for language dropdown
- **model.js** - Dynamic language configuration in getSessionConfig(), uses LANGUAGE_NAMES constant

#### Storage Schema

```javascript
{
  settings: {
    temperature: 1.0,
    topK: 64,
    systemPrompt: "...",
    tone: "balanced",
    language: "en",  // User's preferred language
    theme: "auto"
  }
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

### Features

- ✅ Auto-detect source language
- ✅ 12+ supported languages
- ✅ Expert translation model (higher quality)
- ✅ Download progress monitoring
- ✅ Fallback to Gemini Nano if unavailable
- ✅ Smart same-language detection

### Code Example

```javascript
// 1. Detect source language
const detector = await LanguageDetector.create();
const results = await detector.detect(text);
const sourceLang = results[0].detectedLanguage;

// 2. Check availability for language pair
const availability = await Translator.availability({
  sourceLanguage: sourceLang,
  targetLanguage: targetLang
});

// 3. Create translator with progress monitoring
const translator = await Translator.create({
  sourceLanguage: sourceLang,
  targetLanguage: targetLang,
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${e.loaded * 100}%`);
    });
  }
});

// 4. Translate
const result = await translator.translate(text);
translator.destroy();
```

### Fallback Strategy

If Translation API unavailable, falls back to Gemini Nano's Prompt API with a translation prompt. Ensures translation always works.

---

## Image Support

### Confirmed: Chrome's Prompt API Supports Images

Source: https://github.com/explainers-by-googlers/prompt-api

**Supported image types:**
- `HTMLCanvasElement` ✅ (recommended)
- `Blob`, `ImageData`, `ImageBitmap`
- `HTMLImageElement`, `HTMLVideoElement`
- Raw bytes via `BufferSource`

### Implementation Details

#### MODEL_CONFIG

```javascript
const MODEL_CONFIG = {
  expectedInputs: [
    { type: 'text', languages: ['en'] },
    { type: 'image' }  // Multimodal support
  ],
  expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
};
```

#### File Input

```html
<input type="file" id="file-input" accept="image/*,.pdf,application/pdf" multiple hidden />
<button id="attach" class="icon" title="Attach image or PDF">
```

#### Image Processing

**File:** `handlers.js`

```javascript
// Handle image files - convert to canvas for Prompt API
if (file.type.startsWith('image/')) {
  toast.info(`Processing image: ${file.name}...`);
  const canvas = await fileToCanvas(file, LIMITS.IMAGE_MAX_WIDTH);
  addAttachment({
    name: file.name,
    type: file.type,
    data: canvas  // Store canvas directly
  });
  UI.renderAttachments(getAttachments());
  toast.success('Image processed successfully');
}

// Convert image file to canvas (required for Prompt API)
async function fileToCanvas(file, maxWidth) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        // Calculate scaled dimensions
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas);
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
```

#### Sending Images to AI

**File:** `model.js`

```javascript
// Separate images from PDFs (PDFs are already text, included in finalText)
const imageAttachments = attachments?.filter(att => att.type.startsWith('image/')) || [];

let promptInput = finalText;
if (imageAttachments.length > 0) {
  // att.data is already HTMLCanvasElement from fileToCanvas
  // Prompt API accepts canvas directly
  promptInput = [finalText, ...imageAttachments.map(att => att.data)];
}
```

#### Context Menu - Image Description

**File:** `background.js`

```javascript
// Image description enabled - multimodal now supported
chrome.contextMenus.create({
  id: 'describe_img',
  title: 'Describe image',
  contexts: ['image']
});

// Handler
else if (info.menuItemId === 'describe_img') {
  pendingAction = { action: 'CMD_DESCRIBE_IMAGE', url: info.srcUrl };
}
```

### Key Technical Points

1. **Canvas is required** - Prompt API wants `HTMLCanvasElement`, not data URLs or blobs
2. **Resize for performance** - Keep images under 1024px for faster processing
3. **expectedInputs must include image** - Or session creation fails
4. **Images must be in array format** - `[text, canvas1, canvas2]` not just `text`

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

### User Experience

**Fully Setup (Prompt API enabled):**
```
✅ All Required APIs Ready
Your setup is complete! All required APIs are available.
```

**Missing Required APIs:**
```
❌ Setup Incomplete
Some required APIs are missing. Follow the instructions below to enable them.
```

**Optional APIs Display:**
```
Optional Features (Nice-to-Have)
These features provide better performance but are not required:

⚪ Translation API
   Not detected (using Gemini Nano fallback)
   Fallback: Gemini Nano can translate but with fewer languages (en/es/ja only)

   To enable (optional):
   1. Flag: chrome://flags/#translation-api
   2. Set to: Enabled
```

### Implementation

**File:** `setup-guide.js`

```javascript
export async function getSetupStatus() {
  const apis = await checkAllAPIs();

  // Only Prompt API is absolutely required!
  const requiredAPIs = [
    apis.promptAPI
  ];

  // Everything else is optional with fallbacks
  const optionalAPIs = [
    apis.translationAPI,
    apis.languageDetectionAPI,
    apis.summarizationAPI,
    apis.rewriterAPI
  ];

  const allRequiredAvailable = requiredAPIs.every(api => api.available);
  const missingRequired = requiredAPIs.filter(api => !api.available);

  return {
    isFullySetup: allRequiredAvailable,
    missingRequired,
    requiredAPIs,
    optionalAPIs,
    browserInfo: apis.browserInfo
  };
}
```

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

## Additional Features

### PDF Support
- Extracts text from PDF files using Mozilla's pdf.js
- Maximum 50 pages per PDF
- Fully offline, no external dependencies
- See `pdf.js` for implementation

### Virtual Scrolling
- Activates automatically at 200+ messages
- Only renders visible messages + buffer
- Dramatic performance improvement for large sessions
- See `virtual-scroll.js` for implementation

### Lazy Session Loading
- Activates automatically at 50+ sessions
- Loads only metadata at startup
- Full session data loaded on-demand
- 8x faster startup with 100 sessions
- See `storage.js` for implementation

---

## References

- [Chrome Prompt API Documentation](https://developer.chrome.com/docs/ai/prompt-api)
- [Prompt API GitHub](https://github.com/explainers-by-googlers/prompt-api)
- [Translation API](https://developer.chrome.com/docs/ai/translator-api)
- [Chrome Built-in AI APIs](https://developer.chrome.com/docs/ai/built-in-apis)

---

*Last Updated: 2025-11-29*

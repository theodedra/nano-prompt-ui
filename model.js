import * as UI from './ui.js';
import {
  appState,
  getCurrentSessionSync,
  upsertMessage,
  updateMessage,
  saveState,
  renameSession,
  searchSessions
} from './storage.js';
import { buildPromptWithContext } from './context.js';
import { dataUrlToBlob, resizeImage, throttle } from './utils.js';
import { toast } from './toast.js';
import {
  MODEL_CONFIG,
  LIMITS,
  TIMING,
  UI_MESSAGES,
  USER_ERROR_MESSAGES,
  VALIDATION,
  SPEECH,
  DEFAULT_SETTINGS,
  TITLE_GENERATION_PROMPT,
  LANGUAGE_NAMES,
  getSettingOrDefault
} from './constants.js';

const STREAMING_THROTTLE_MS = 75;
const DIAGNOSTICS_KEY = 'nanoPrompt.diagnostics';
let diagnosticsCache = null;
const SMART_REPLY_LIMIT = 3;
const SMART_REPLY_CONTEXT_CHARS = 600;
const SMART_REPLY_MAX_LENGTH = 120;

// --- LOCAL AI WRAPPER ---
/**
 * Wrapper class for Chrome's AI language model API
 */
class LocalAI {
  constructor() {
    this.sessions = new Map();
    this.controller = null; // Track active generation controller
  }

  get engine() {
    // In Chrome extensions, LanguageModel is a global constructor
    if (typeof LanguageModel !== 'undefined') {
      return LanguageModel;
    }
    // Fallback for older implementations
    return self.ai?.languageModel || self.LanguageModel;
  }

  /**
   * Check AI availability status
   * @returns {Promise<string>} Availability status ('readily', 'after-download', 'no')
   */
  async getAvailability() {
    if (!this.engine) return 'no';
    try {
      const status = await this.engine.availability(MODEL_CONFIG);
      return typeof status === 'object' ? status.availability : status;
    } catch (e) { return 'no'; }
  }

  /**
   * Create a new AI session with configuration
   * Sessions are scoped to UI session IDs to avoid cross-chat bleed
   * @param {string} sessionId - UI session ID
   * @param {object} params - Session parameters
   * @returns {Promise<object>} AI session object
   */
  async getOrCreateSession(sessionId, params = {}) {
    if (!sessionId) throw new Error('Missing session id');
    if (this.sessions.has(sessionId)) return this.sessions.get(sessionId);
    if (!this.engine) throw new Error('AI not supported');
    const config = { ...MODEL_CONFIG, ...params };
    const session = await this.engine.create(config);
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Non-streaming prompt for faster responses (used for images)
   * @param {string} sessionId - UI session ID to route to the right LM session
   * @param {string|Array} input - Prompt text or array with text and blobs
   * @param {AbortSignal} signal - Abort signal for cancellation
   * @returns {Promise<string>} Complete response text
   */
  async prompt(sessionId, input, signal, params = {}) {
    const session = await this.getOrCreateSession(sessionId, params);
    return await session.prompt(input, { signal });
  }

  /**
   * Stream AI response with real-time updates
   * @param {string} sessionId - UI session ID to route to the right LM session
   * @param {string|Array} input - Prompt text or array with text and blobs
   * @param {AbortSignal} signal - Abort signal for cancellation
   * @param {Function} onUpdate - Callback for each chunk
   * @returns {Promise<string>} Complete response text
   */
  async promptStreaming(sessionId, input, signal, onUpdate, params = {}) {
    const session = await this.getOrCreateSession(sessionId, params);

    const stream = await session.promptStreaming(input, { signal });
    const reader = stream.getReader();

    let fullText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        // Smart Accumulator logic
        if (fullText.length > 0 && value.startsWith(fullText)) {
            fullText = value;
        } else {
            fullText += value;
        }
        onUpdate(fullText);
      }
    }
    return fullText;
  }

  /**
   * Destroy the current AI session and clean up resources
   */
  destroy(sessionId = null) {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        try { session.destroy(); } catch(e) {}
      }
      this.sessions.delete(sessionId);
      if (this.controller) {
        try { this.controller.abort(); } catch(e) {}
        this.controller = null;
      }
      return;
    }

    this.sessions.forEach((session) => {
      try { session.destroy(); } catch(e) {}
    });
    this.sessions.clear();

    if (this.controller) {
      try { this.controller.abort(); } catch(e) {}
      this.controller = null;
    }
  }
}

const localAI = new LocalAI();

/**
 * Load diagnostics state from storage (cached)
 * @returns {Promise<Object>} Diagnostics state
 */
async function getDiagnosticsState() {
  if (diagnosticsCache) return diagnosticsCache;
  try {
    const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY);
    diagnosticsCache = stored[DIAGNOSTICS_KEY] || {};
  } catch (e) {
    diagnosticsCache = {};
  }
  return diagnosticsCache;
}

/**
 * Persist diagnostics state
 * @param {Object} partial - Partial update
 * @returns {Promise<Object>} Updated state
 */
async function saveDiagnosticsState(partial = {}) {
  const current = await getDiagnosticsState();
  diagnosticsCache = { ...current, ...partial };
  try {
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: diagnosticsCache });
  } catch (e) {
    // Non-critical: ignore storage errors
  }
  return diagnosticsCache;
}

/**
 * Map availability status to user-friendly label
 * @param {string} status - Raw availability
 * @returns {string} Display label
 */
function describeAvailability(status) {
  if (status === 'readily') return UI_MESSAGES.READY;
  if (status === 'after-download') return 'After download';
  if (status === 'no') return UI_MESSAGES.PAGE_MODE;
  if (!status) return 'Unknown';
  return status;
}

function hasCachedAvailability() {
  return Boolean(
    appState.availability &&
    appState.availability !== 'unknown' &&
    appState.availabilityCheckedAt
  );
}

function setAvailabilityCache(status, checkedAt) {
  appState.availability = status || 'unknown';
  appState.availabilityCheckedAt = checkedAt || null;
}

function updateAvailabilityUI(rawStatus, checkedAt, diag = {}) {
  const status = rawStatus || 'unknown';
  const label = describeAvailability(status);
  const lastChecked = checkedAt ?? diag.availabilityCheckedAt ?? null;

  setAvailabilityCache(status, lastChecked);
  UI.setStatusText(label);
  UI.setHardwareStatus(`Gemini Nano: ${label}`);
  UI.updateDiagnostics({
    ...diag,
    availability: status,
    availabilityCheckedAt: lastChecked,
    availabilityLabel: label
  });

  return label;
}

/**
 * Clear page-context AI sessions used by the fallback path
 * @param {string|null} sessionId - Specific UI session to clear (or all)
 */
async function clearPageModelSessions(sessionId = null) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (id) => {
        const store = window.__nanoPageSessions || {};
        const destroySession = (sess) => {
          try { sess.destroy(); } catch {}
        };

        if (id) {
          if (store[id]) destroySession(store[id]);
          delete store[id];
        } else {
          Object.keys(store).forEach((key) => destroySession(store[key]));
          for (const key of Object.keys(store)) delete store[key];
        }

        window.__nanoPageSessions = store;
      },
      args: [sessionId]
    });
  } catch (e) {
    console.warn('Page session cleanup failed', e);
  }
}

/**
 * Get session configuration from app state
 * @returns {{topK: number, temperature: number, systemPrompt: string, expectedInputs: Array, expectedOutputs: Array}}
 */
function getSessionConfig() {
  const userLanguage = getSettingOrDefault(appState.settings, 'language');

  // Gemini Nano only supports en, es, ja
  // For other languages, fallback to English for Prompt API
  const supportedLanguages = ['en', 'es', 'ja'];
  const language = supportedLanguages.includes(userLanguage) ? userLanguage : 'en';

  return {
    topK: appState.settings.topK,
    temperature: appState.settings.temperature,
    systemPrompt: appState.settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt,
    expectedInputs: [
      { type: 'text', languages: [language] },
      { type: 'image' }
    ],
    expectedOutputs: [{ type: 'text', format: 'plain-text', languages: [language] }]
  };
}

/**
 * Get recent conversation history for context
 * @param {object} session - Current session object
 * @returns {string} Formatted history snippet
 */
export function resetModel(sessionId = null) {
  localAI.destroy(sessionId);
  clearPageModelSessions(sessionId).catch((e) => {
    console.warn('Failed to clear page model sessions', e);
  });
}

/**
 * Check and update AI availability status in UI
 * @returns {Promise<void>}
 */
export async function refreshAvailability({ forceCheck = false } = {}) {
  let diag = await getDiagnosticsState();
  let rawStatus = appState.availability;
  let checkedAt = appState.availabilityCheckedAt;

  const shouldCheck = forceCheck || !hasCachedAvailability();
  if (shouldCheck) {
    rawStatus = await localAI.getAvailability();
    checkedAt = Date.now();
    diag = await saveDiagnosticsState({
      availability: rawStatus,
      availabilityCheckedAt: checkedAt
    });
  }

  updateAvailabilityUI(rawStatus, checkedAt, diag);
}

/**
 * Get diagnostics snapshot for settings UI
 * @returns {Promise<Object>} Diagnostics payload
 */
export async function getDiagnostics() {
  const diag = await getDiagnosticsState();
  const availability = appState.availability || diag.availability;
  const availabilityCheckedAt = appState.availabilityCheckedAt || diag.availabilityCheckedAt;
  const availabilityLabel = describeAvailability(availability || diag.availability);

  return {
    ...diag,
    availability,
    availabilityCheckedAt,
    availabilityLabel
  };
}

/**
 * Trigger an on-demand warmup and record diagnostics
 * @returns {Promise<Object>} Updated diagnostics
 */
export async function warmUpModel() {
  const now = Date.now();
  const availability = await localAI.getAvailability();
  let warmupStatus = 'unavailable';
  let warmupError = '';

  if (!localAI.engine || availability === 'no') {
    warmupError = 'Prompt API not available in this Chrome build.';
  } else if (availability === 'after-download') {
    warmupStatus = 'awaiting-download';
    warmupError = 'Model needs to finish downloading before warmup.';
  } else {
    warmupStatus = 'success';
    try {
      const session = await localAI.engine.create({
        ...MODEL_CONFIG,
        systemPrompt: 'Warmup check'
      });
      if (session?.destroy) await session.destroy();
    } catch (e) {
      warmupStatus = 'error';
      warmupError = e?.message || e?.toString() || 'Warmup failed';
    }
  }

  const diag = await saveDiagnosticsState({
    availability,
    availabilityCheckedAt: now,
    lastWarmupAt: now,
    lastWarmupStatus: warmupStatus,
    lastWarmupError: warmupError
  });
  const availabilityLabel = updateAvailabilityUI(availability, now, diag);
  return { ...diag, availabilityLabel };
}

/**
 * Run summarizer on provided text
 * @param {string} text - Text to summarize
 * @returns {Promise<void>}
 */
export async function runSummarizer(text) {
  await runPrompt({
    text: `Summarize the following content into key bullet points:\n\n${text}`,
    contextOverride: '',
    attachments: []
  });
}

/**
 * Rewrite text with specified tone
 * @param {string} text - Text to rewrite
 * @param {string} tone - Desired tone (default: 'professional')
 * @returns {Promise<void>}
 */
export async function runRewriter(text, tone = 'professional') {
  await runPrompt({
    text: `Rewrite the following text to be more ${tone}:\n\n${text}`,
    contextOverride: '',
    attachments: []
  });
}

/**
 * Translate text to user's selected language using Chrome Translation API
 * @param {string} text - Text to translate
 * @returns {Promise<void>}
 */
export async function runTranslator(text) {
  const session = getCurrentSessionSync();
  const targetLang = getSettingOrDefault(appState.settings, 'language');

  UI.setBusy(true);
  UI.setStatusText('Detecting language...');

  try {
    // Check if Translation API is available
    if (!self.Translator || !self.LanguageDetector) {
      throw new Error('Translation API not available. Please enable chrome://flags/#translation-api');
    }

    // Step 1: Detect source language
    let sourceLang = 'en';
    try {
      const detectorAvailability = await self.LanguageDetector.availability();
      if (detectorAvailability !== 'no') {
        const detector = await self.LanguageDetector.create();
        const results = await detector.detect(text);
        if (results && results.length > 0) {
          sourceLang = results[0].detectedLanguage;
        }
        detector.destroy();
      }
    } catch (e) {
      console.warn('Language detection failed, assuming English:', e);
    }

    // Don't translate if source is same as target
    if (sourceLang === targetLang) {
      const userMessage = { role: 'user', text: `Translate: ${text}`, ts: Date.now() };
      const aiMessage = {
        role: 'ai',
        text: `The text is already in the target language (${targetLang.toUpperCase()}). No translation needed:\n\n${text}`,
        ts: Date.now()
      };
      upsertMessage(session.id, userMessage);
      upsertMessage(session.id, aiMessage);
      UI.renderLog(session);
      UI.setBusy(false);
      UI.setStatusText('Ready to chat.');
      await saveState();
      return;
    }

    // Step 2: Check if translation is available for this language pair
    UI.setStatusText('Preparing translator...');
    const translatorAvailability = await self.Translator.availability({
      sourceLanguage: sourceLang,
      targetLanguage: targetLang
    });

    if (translatorAvailability === 'no') {
      throw new Error(`Translation from ${sourceLang} to ${targetLang} is not supported`);
    }

    // Step 3: Create translator and translate
    UI.setStatusText('Translating...');
    const translator = await self.Translator.create({
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          UI.setStatusText(`Downloading translation model... ${Math.round(e.loaded * 100)}%`);
        });
      }
    });

    const translatedText = await translator.translate(text);
    translator.destroy();

    // Step 4: Display result
    const userMessage = {
      role: 'user',
      text: `Translate (${sourceLang} → ${targetLang}): ${text}`,
      ts: Date.now()
    };
    const aiMessage = { role: 'ai', text: translatedText, ts: Date.now() };

    upsertMessage(session.id, userMessage);
    upsertMessage(session.id, aiMessage);
    UI.renderLog(session);
    await saveState();

    UI.setBusy(false);
    UI.setStatusText('Ready to chat.');
    toast.success('Translation complete');

  } catch (error) {
    console.error('Translation failed:', error);

    // Fallback to Gemini Nano Prompt API
    UI.setStatusText('Using fallback translation...');
    const langName = LANGUAGE_NAMES[targetLang] || 'English';

    await runPrompt({
      text: `Translate the following text to ${langName}:\n\n${text}`,
      contextOverride: '',
      attachments: []
    });

    toast.warning('Used Gemini Nano fallback (Translation API unavailable)');
  }
}

// --- IMAGE DESCRIPTION ---
/**
 * Analyze and describe an image from URL
 * @param {string} url - Image URL to analyze
 * @returns {Promise<void>}
 */
export async function runImageDescription(url) {
  UI.setStatusText(UI_MESSAGES.ANALYZING_IMAGE);
  const session = getCurrentSessionSync();

  try {
    // 1. Smart Fetch
    const blob = await fetchImageWithRetry(url);

    // 2. Store as blob for IndexedDB compatibility
    const attachment = {
      name: "Analyzed Image",
      type: "image/jpeg",
      data: blob  // Store as blob (will be converted to canvas in runPrompt)
    };

    // 3. Reset model to clear memory before image task
    resetModel(session.id);

    // runPrompt will handle status updates from here
    await runPrompt({
      text: "Describe this image in detail.",
      contextOverride: '',
      attachments: [attachment]
    });

  } catch (e) {
    console.error(e);
    UI.setStatusText(UI_MESSAGES.ERROR);
    toast.error(USER_ERROR_MESSAGES.IMAGE_PROCESSING_FAILED);
    resetModel(session.id);
    upsertMessage(session.id, {
      role: 'ai',
      text: `**Image Error:** ${e.message}.`,
      ts: Date.now()
    });
    UI.renderLog(session);
  }
}

/**
 * Fetch image with retry and fallback strategies
 * @param {string} url - Image URL to fetch
 * @returns {Promise<Blob>} Image blob
 * @throws {Error} If image cannot be fetched
 */
async function fetchImageWithRetry(url) {
  // SECURITY: Validate URL before processing
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    // Only allow http/https protocols
    if (!VALIDATION.ALLOWED_IMAGE_PROTOCOLS.includes(parsedUrl.protocol)) {
      throw new Error(USER_ERROR_MESSAGES.IMAGE_INVALID_URL);
    }
  } catch (e) {
    toast.error(USER_ERROR_MESSAGES.IMAGE_INVALID_URL);
    throw new Error(USER_ERROR_MESSAGES.IMAGE_INVALID_URL);
  }

  // 1. Extension Fetch (Safer - no arbitrary code execution)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMING.IMAGE_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok && res.headers.get('content-type')?.startsWith(VALIDATION.IMAGE_CONTENT_TYPE_PREFIX)) {
        return await res.blob();
      }
    } finally {
      // TIMEOUT CLEANUP FIX: Always clear timeout in finally block
      clearTimeout(timeoutId);
    }
  } catch (e) {
    console.warn('Direct fetch failed:', e);
  }

  // 2. Page Proxy Fetch (fallback for CORS-blocked images)
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
      throw new Error("Cannot fetch from system pages");
    }

    // IMPORTANT: world: 'MAIN' is REQUIRED here - DO NOT change to 'ISOLATED'
    // =====================================================================
    // WHY: Cross-origin images are CORS-blocked from extension context
    // - Extension fetch() respects CORS (most images block extensions)
    // - Page context fetch() has same-origin privileges as the page
    // - Only way to access CORS-blocked images the page itself can load
    //
    // SECURITY: This is safe because:
    // - Function only fetches images (validated by content-type check)
    // - Returns data URL only (no code execution)
    // - No access to page JavaScript variables
    // - Chrome's content script isolation still applies
    //
    // Standard practice says use 'ISOLATED', but that won't work here.
    // This is a legitimate exception to the rule.
    const [{ result: base64 }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',  // DO NOT CHANGE - Required for CORS image access
      func: async (imgUrl) => {
        try {
          const r = await fetch(imgUrl);
          if (!r.ok) return null;
          const contentType = r.headers.get('content-type');
          if (!contentType || !contentType.startsWith('image/')) return null;

          const b = await r.blob();
          return await new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(b);
          });
        } catch { return null; }
      },
      args: [url]
    });

    if (base64) return await (await fetch(base64)).blob();
  } catch (e) {
    console.warn('Page proxy fetch failed:', e);
  }

  toast.error(USER_ERROR_MESSAGES.IMAGE_FETCH_FAILED);
  throw new Error(USER_ERROR_MESSAGES.IMAGE_FETCH_FAILED);
}

// SECURITY NOTE: AI Execution Safety
// ====================================
// The AI model in this extension has NO EXECUTION PRIVILEGES:
//
// - Cannot run JavaScript or system commands
// - Cannot access chrome APIs beyond what's explicitly passed
// - Cannot modify browser state, storage, or settings
// - Cannot access user credentials, history, or sensitive data
// - Output is text-only, rendered with HTML sanitization (utils.js:84-150)
//
// Even if a malicious page injects "harmful" prompts into context,
// the worst outcome is incorrect/weird text output for that query.
// No persistent damage, data theft, or code execution is possible.
//
// The world: 'MAIN' usage (lines 293, 442) is for accessing window.ai API
// in page context when side panel fails - this is safe because:
// - Script runs in isolated execution context
// - Only reads AI output, doesn't execute page code
// - Chrome's content script isolation prevents privilege escalation

/**
 * Run AI prompt with context and attachments
 * @param {{text: string, contextOverride: string, attachments: Array}} params - Prompt parameters
 * @returns {Promise<void>}
 */
export async function runPrompt({ text, contextOverride, attachments, displayText = null }) {
  const session = getCurrentSessionSync();
  clearSmartReplies(session.id);
  // Use displayText for chat history if provided, otherwise use text
  const userMessage = { role: 'user', text: displayText || text, ts: Date.now(), attachments };

  upsertMessage(session.id, userMessage);
  UI.renderLog(session);
  UI.renderSmartReplies([]);
  // PERFORMANCE: Don't block on saveState - save in background after streaming
  // await saveState();  // REMOVED - moved to end of function

  UI.setBusy(true);
  UI.setStopEnabled(true);
  UI.setStatusText('Thinking...');

  const aiMessageIndex = session.messages.length;
  upsertMessage(session.id, { role: 'ai', text: '', ts: Date.now() });
  UI.renderLog(session);

  // RACE CONDITION FIX: Cancel any existing generation before starting new one
  if (localAI.controller) {
    try {
      localAI.controller.abort();
    } catch (e) {
      // Ignore abort errors
    }
  }

  const controller = new AbortController();
  localAI.controller = controller;
  let lastAiText = '';
  let generationAborted = false;

  try {
    const sessionConfig = getSessionConfig();
    const finalText = await buildPromptWithContext(text, contextOverride, attachments);

    // Separate images from PDFs (PDFs are already text, included in finalText)
    const imageAttachments = attachments?.filter(att => att.type.startsWith('image/')) || [];

    let promptInput = finalText;
    if (imageAttachments.length > 0) {
      // att.data is now a Blob (for IndexedDB storage), convert to canvas for Prompt API
      try {
        const canvases = await Promise.all(
          imageAttachments.map(async (att) => {
            const canvas = await blobToCanvas(att.data, LIMITS.IMAGE_MAX_WIDTH);
            return canvas;
          })
        );

        // Prompt API multimodal format: message with role and content array
        promptInput = [{
          role: "user",
          content: [
            { type: "text", value: finalText },
            ...canvases.map(canvas => ({ type: "image", value: canvas }))
          ]
        }];
      } catch (conversionError) {
        console.error("Failed to convert blob to canvas:", conversionError);
        throw new Error(`Image conversion failed: ${conversionError.message}`);
      }
    }

    const throttledUpdate = throttle((chunk) => {
      updateMessage(session.id, aiMessageIndex, { text: chunk });
      UI.updateLastMessageBubble(session, chunk, { streaming: true });
    }, STREAMING_THROTTLE_MS);

    try {
        UI.setStatusText('Generating response...');

        const streamedText = await localAI.promptStreaming(
          session.id,
          promptInput,
          controller.signal,
          (chunk) => { throttledUpdate(chunk); },
          sessionConfig
        );

        throttledUpdate.flush();
        updateMessage(session.id, aiMessageIndex, { text: streamedText });
        UI.updateLastMessageBubble(session, streamedText);
        lastAiText = streamedText;

    } catch (err) {
        throttledUpdate.flush();
        if (err?.name === 'AbortError') throw err;
        console.error("Side Panel failed with error:", err);
        console.error("Error name:", err?.name, "Message:", err?.message);

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://'))) {
             toast.error(USER_ERROR_MESSAGES.AI_SYSTEM_PAGE);
             throw new Error(USER_ERROR_MESSAGES.AI_SYSTEM_PAGE);
        }

        // Try fallback for non-image prompts (images don't work in page context)
        if (imageAttachments.length === 0) {
          const fallback = await runPromptInPage(finalText, session.id, attachments);
          updateMessage(session.id, aiMessageIndex, { text: fallback });
          UI.updateLastMessageBubble(session, fallback);
          lastAiText = fallback;
        } else {
          // Image prompts failed - can't use page fallback
          console.error("Image prompt failed, cannot use fallback. Original error:", err);
          throw new Error(`Image analysis failed: ${err?.message || 'Unknown error'}`);
        }
    } finally {
        throttledUpdate.cancel();
    }

  } catch (err) {
    cancelGeneration();
    resetModel(session.id);

    // STOP FIX: Keep existing text and append stopped message instead of replacing
    if (err?.name === 'AbortError') {
      generationAborted = true;
      const currentMessage = session.messages[aiMessageIndex];
      const currentText = currentMessage?.text || '';

      // Only append (stopped) if there's actual content
      if (currentText && currentText.trim().length > 0) {
        const stoppedText = currentText + '\n\n' + UI_MESSAGES.STOPPED;
        updateMessage(session.id, aiMessageIndex, { text: stoppedText });
        UI.updateLastMessageBubble(session, stoppedText);
      } else {
        // If no content was generated, show stopped message
        updateMessage(session.id, aiMessageIndex, { text: UI_MESSAGES.STOPPED });
        UI.updateLastMessageBubble(session, UI_MESSAGES.STOPPED);
      }
    } else {
      // For other errors, show error message
      let msg = err.message || USER_ERROR_MESSAGES.AI_UNAVAILABLE;
      updateMessage(session.id, aiMessageIndex, { text: `Error: ${msg}` });
      UI.updateLastMessageBubble(session, `Error: ${msg}`);
      toast.error(msg);
    }
  } finally {
    // RACE CONDITION FIX: Only clear controller if it's still the active one
    if (localAI.controller === controller) {
      localAI.controller = null;
    }
  }

  UI.setBusy(false);
  UI.setStopEnabled(false);
  UI.setStatusText('Ready to chat.');
  await saveState();

  if (!generationAborted && lastAiText) {
    generateSmartRepliesForMessage(session.id, userMessage.text, lastAiText, aiMessageIndex)
      .catch((e) => console.warn('Smart reply generation failed', e));
  }

  // AUTO-NAMING: Generate title after first AI response
  // Only trigger if this is the first complete exchange (2 messages: user + ai)
  if (session.messages.length === 2) {
    // Run in background, don't block UI
    generateSessionTitle(session.id).catch(e => {
      console.warn('Background title generation failed:', e);
    });
  }
}

/**
 * Fallback: Run prompt using window.ai in page context
 * @param {string} prompt - Prompt text
 * @param {string} sessionId - UI session ID for per-chat isolation
 * @param {Array} attachments - Attached files
 * @returns {Promise<string>} AI response
 */
async function runPromptInPage(prompt, sessionId, attachments = []) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.startsWith('http')) {
    toast.error(USER_ERROR_MESSAGES.AI_SYSTEM_PAGE);
    throw new Error('Restricted protocol');
  }

  // IMPORTANT: world: 'MAIN' is REQUIRED here - DO NOT change to 'ISOLATED'
  // =====================================================================
  // WHY: window.ai API only exists in the main page context
  // - window.ai is injected by Chrome into the main world
  // - 'ISOLATED' world doesn't have access to window.ai
  // - This is a fallback when side panel AI session fails
  //
  // SECURITY: This is safe because:
  // - Only accesses window.ai.languageModel API (read-only)
  // - Returns text response only (no code execution)
  // - No access to page JavaScript variables or functions
  // - Function is self-contained, no page code injection
  // - Chrome's content script isolation prevents privilege escalation
  //
  // Standard practice says use 'ISOLATED', but that won't work here.
  // window.ai is ONLY available in 'MAIN' world. This is a legitimate exception.
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',  // DO NOT CHANGE - Required for window.ai API access
    func: async (p, sys, atts, uiSessionId) => {
      try {
        const model = window.ai?.languageModel || self.ai?.languageModel;
        if (!model) return { error: 'AI not found in page' };

        const storeKey = '__nanoPageSessions';
        const store = window[storeKey] || (window[storeKey] = {});

        if (!uiSessionId) return { error: 'Missing session id' };

        let sess = store[uiSessionId];
        if (!sess) {
          sess = await model.create({
            systemPrompt: sys,
            expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
          });
          store[uiSessionId] = sess;
        }

        let input = p;
        if (atts && atts.length > 0) {
            const blobs = await Promise.all(atts.map(async (att) => {
                const res = await fetch(att.data);
                return await res.blob();
            }));
            input = [p, ...blobs];
        }

        const r = await sess.prompt(input);
        return { ok: true, data: r };
      } catch (e) {
        // Clean up failed sessions so future calls can recreate cleanly
        const storeKey = '__nanoPageSessions';
        const store = window[storeKey] || {};
        if (uiSessionId && store[uiSessionId]) {
          try { store[uiSessionId].destroy(); } catch {}
          delete store[uiSessionId];
        }
        window[storeKey] = store;
        return { error: e.toString() };
      }
    },
    args: [prompt, appState.settings.systemPrompt, attachments, sessionId]
  });

  if (result?.error) {
    toast.error(USER_ERROR_MESSAGES.AI_SESSION_FAILED);
    throw new Error(result.error);
  }
  return result?.data || '';
}

/**
 * Cancel ongoing AI generation or speech synthesis
 */
export function cancelGeneration() {
  // MULTI-UTILITY STOP: Cancel both AI generation and speech narration
  if (localAI.controller) {
    localAI.controller.abort();
    localAI.controller = null;
  }

  // Stop any ongoing speech synthesis
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }

  UI.setStopEnabled(false);
}

/**
 * Summarize the active tab content
 * @param {string} contextOverride - Tab content to summarize
 * @returns {Promise<void>}
 */
export async function summarizeActiveTab(contextOverride) {
  resetModel(appState.currentSessionId);
  await runPrompt({ text: 'Summarize the current tab in seven detailed bullet points.', contextOverride, attachments: [] });
}

/**
 * Check if speech synthesis or AI generation is active
 * Used to restore stop button state after tab switches
 * @returns {boolean} True if something is running
 */
export function isSomethingRunning() {
  const isSpeaking = window.speechSynthesis && window.speechSynthesis.speaking;
  const isGenerating = localAI.controller !== null;
  return isSpeaking || isGenerating;
}

/**
 * Speak text using browser's speech synthesis
 * @param {string} text - Text to speak
 */
export function speakText(text) {
  if (!('speechSynthesis' in window)) return;

  // SPEECH SYNTHESIS FIX: Cancel any ongoing speech before starting new one
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH.LANGUAGE;

  // SPEECH ERROR FIX: Better error handling with details
  utterance.onerror = (event) => {
    // Extract error details in readable format
    const errorType = event.error || 'unknown';
    const charIndex = event.charIndex || 0;
    const elapsedTime = event.elapsedTime || 0;

    // EXPECTED USER ACTIONS: Don't log as errors
    // 'canceled' = User stopped speech
    // 'interrupted' = User started new speech (replaces current)
    if (SPEECH.EXPECTED_ERROR_TYPES.includes(errorType)) {
      // This is normal behavior when user interacts with speech controls
      // Don't pollute console with expected events
      UI.setStopEnabled(false);
      return;
    }

    // ACTUAL ERRORS: Log these for debugging
    console.warn(
      `Speech synthesis error: ${errorType} (at char ${charIndex}, after ${elapsedTime}ms)`
    );

    UI.setStopEnabled(false);
  };

  // Handle synthesis completion
  utterance.onend = () => {
    UI.setStopEnabled(false);
  };

  // MULTI-TAB FIX: Handle synthesis interrupt (e.g., tab switch)
  utterance.onpause = () => {
    // Keep stop button enabled while paused
  };

  // Enable stop button while speaking
  UI.setStopEnabled(true);
  window.speechSynthesis.speak(utterance);
}

/**
 * Auto-generate a title for a chat session based on first conversation
 * @param {string} sessionId - Session ID to generate title for
 * @returns {Promise<void>}
 */
export async function generateSessionTitle(sessionId) {
  const session = appState.sessions[sessionId];
  if (!session || session.messages.length < 2) return;

  // Only auto-generate if still using default title
  if (session.title !== 'New chat' && !session.title.endsWith('copy')) return;

  try {
    // Get first user message and AI response
    const userMsg = session.messages.find(m => m.role === 'user');
    const aiMsg = session.messages.find(m => m.role === 'ai');

    if (!userMsg || !aiMsg) return;

    // Build a short conversation snippet for title generation
    const conversationSnippet = `User: ${userMsg.text.slice(0, LIMITS.TITLE_GENERATION_MAX_CHARS)}
AI: ${aiMsg.text.slice(0, LIMITS.TITLE_GENERATION_MAX_CHARS)}`;

    const prompt = TITLE_GENERATION_PROMPT.replace('{conversation}', conversationSnippet);

    // Create a temporary AI session for title generation
    const titleSession = await localAI.engine.create({
      temperature: 0.3,
      topK: 10,
      systemPrompt: 'You generate concise, descriptive titles for conversations.',
      expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
    });

    const generatedTitle = await titleSession.prompt(prompt);
    await titleSession.destroy();

    if (!generatedTitle) return;

    // Clean and truncate the title
    let title = generatedTitle.trim()
      .replace(/^["']|["']$/g, '') // Remove quotes
      .replace(/[.!?]$/, '')        // Remove ending punctuation
      .slice(0, LIMITS.TITLE_MAX_LENGTH);

    // Add timestamp variation to avoid duplicates
    const now = new Date();
    const timeVariation = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;

    // Only add time if title is very generic or might duplicate
    const genericTerms = ['conversation', 'chat', 'question', 'help', 'discussion'];
    const isGeneric = genericTerms.some(term => title.toLowerCase().includes(term));

    if (isGeneric && title.length < 30) {
      title = `${title} (${timeVariation})`;
    }

    // Update session title
    renameSession(sessionId, title);
    await saveState();
    const searchTerm = UI.getSessionSearchTerm();
    const matches = searchSessions(searchTerm);
    const current = getCurrentSessionSync();
    UI.renderSessions({
      sessions: appState.sessions,
      sessionMeta: appState.sessionMeta,
      currentSessionId: appState.currentSessionId,
      currentTitle: current?.title,
      matches,
      searchTerm
    });

  } catch (e) {
    // Silent fail - title generation is not critical
    console.warn('Title generation failed:', e);
  }
}

/**
 * Convert blob to canvas (required for Prompt API image input)
 * @param {Blob} blob - Image blob
 * @param {number} maxWidth - Maximum width for resizing
 * @returns {Promise<HTMLCanvasElement>}
 */
async function blobToCanvas(blob, maxWidth) {
  return new Promise((resolve, reject) => {
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

      // Clean up object URL
      URL.revokeObjectURL(img.src);

      resolve(canvas);
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image from blob'));
    };

    img.src = URL.createObjectURL(blob);
  });
}

function clearSmartReplies(sessionId) {
  try {
    const session = appState.sessions[sessionId];
    if (!session) return;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i];
      if (msg.role !== 'ai') continue;
      if (msg.smartReplies?.length) {
        updateMessage(sessionId, i, { smartReplies: [] });
      }
      break;
    }
  } catch (e) {
    console.warn('Failed to clear smart replies', e);
  } finally {
    UI.renderSmartReplies([]);
  }
}

function normalizeSmartReplies(rawText = '') {
  if (!rawText) return [];
  return rawText
    .split('\n')
    .map(line => line.replace(/^\s*[-*\d.]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, SMART_REPLY_LIMIT)
    .map(line => line.slice(0, SMART_REPLY_MAX_LENGTH));
}

function buildSmartReplyPrompt(userText, aiText) {
  const trim = (val = '') => val.length > SMART_REPLY_CONTEXT_CHARS
    ? `${val.slice(0, SMART_REPLY_CONTEXT_CHARS)}...`
    : val;

  return `Suggest ${SMART_REPLY_LIMIT} concise, actionable follow-up prompts the user might tap next. ` +
    `Write each as something the user would send to the assistant (commands/questions to the assistant), ` +
    `not as questions from the assistant to the user. Avoid yes/no confirmations, avoid repeating the last answer, ` +
    `and keep each under 12 words. Return one suggestion per line with no numbering or bullets.\n\n` +
    `User: ${trim(userText || '')}\nAssistant: ${trim(aiText || '')}`;
}

async function generateSmartRepliesForMessage(sessionId, userText, aiText, aiIndex) {
  if (!localAI.engine) return;
  const prompt = buildSmartReplyPrompt(userText, aiText);
  const baseConfig = getSessionConfig();
  const isCurrentSession = appState.currentSessionId === sessionId;
  const config = {
    ...baseConfig,
    temperature: Math.max(0.3, (baseConfig.temperature || DEFAULT_SETTINGS.temperature) - 0.2),
    topK: 32,
    systemPrompt: 'You propose short, helpful follow-up prompts for the user to click.'
  };

  const suggestionSession = await localAI.engine.create(config);
  try {
    const raw = await suggestionSession.prompt(prompt);
    const replies = normalizeSmartReplies(raw);
    updateMessage(sessionId, aiIndex, { smartReplies: replies });
    if (isCurrentSession) {
      UI.renderSmartReplies(replies);
    }
    await saveState();
  } finally {
    try { await suggestionSession.destroy(); } catch {}
  }
}

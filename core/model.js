/**
 * Model Layer - Pure AI Operations
 *
 * Handles all AI/LLM interactions without UI or storage knowledge.
 * Side effects are performed via callbacks supplied by the controller.
 */

import { buildPromptWithContext } from './context.js';
import { throttle, nanoid } from '../utils/utils.js';
import {
  MODEL_CONFIG,
  LIMITS,
  TIMING,
  USER_ERROR_MESSAGES,
  VALIDATION,
  SPEECH,
  DEFAULT_SETTINGS,
  TITLE_GENERATION_PROMPT,
  LANGUAGE_NAMES,
  getSettingOrDefault
} from '../config/constants.js';

const STREAMING_THROTTLE_MS = 100;
const DIAGNOSTICS_KEY = 'nanoPrompt.diagnostics';
const SMART_REPLY_LIMIT = 3;
const SMART_REPLY_CONTEXT_CHARS = 600;
const SMART_REPLY_MAX_LENGTH = 120;

// FIXED: Generate a random key for page-context storage to prevent fingerprinting.
// This key rotates every time the extension reloads.
const PAGE_STORE_KEY = `__nano_${nanoid(12)}`;

let diagnosticsCache = null;

/**
 * Wrapper class for Chrome's AI language model API.
 */
class LocalAI {
  constructor() {
    this.sessions = new Map();
    this.controller = null;
    this.lastPrimedAt = 0;
  }

  get engine() {
    if (typeof LanguageModel !== 'undefined') {
      return LanguageModel;
    }
    return self.ai?.languageModel || self.LanguageModel;
  }

  /**
   * Check AI availability status.
   * @returns {Promise<string>} Availability status ('readily', 'after-download', 'downloading', 'no')
   */
  async getAvailability() {
    if (!this.engine) return 'no';
    try {
      const status = await this.engine.availability(MODEL_CONFIG);
      return typeof status === 'object' ? status.availability : status;
    } catch (e) {
      return 'no';
    }
  }

  /**
   * Create or reuse an AI session.
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
   * Non-streaming prompt.
   */
  async prompt(sessionId, input, signal, params = {}) {
    const session = await this.getOrCreateSession(sessionId, params);
    return session.prompt(input, { signal });
  }

  /**
   * Streaming prompt helper.
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

  destroy(sessionId = null) {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        try { session.destroy(); } catch { /* ignore */ }
      }
      this.sessions.delete(sessionId);
      if (this.controller) {
        try { this.controller.abort(); } catch { /* ignore */ }
        this.controller = null;
      }
      return;
    }

    this.sessions.forEach((session) => {
      try { session.destroy(); } catch { /* ignore */ }
    });
    this.sessions.clear();

    if (this.controller) {
      try { this.controller.abort(); } catch { /* ignore */ }
      this.controller = null;
    }
  }

  needsPriming() {
    return Date.now() - this.lastPrimedAt > TIMING.MODEL_PRIME_TTL_MS;
  }

  /**
   * Lightweight priming pass for faster first response.
   * @returns {Promise<boolean>} True when a priming run executed.
   */
  async prime() {
    if (!this.engine || !this.needsPriming()) return false;

    const availability = await this.getAvailability();
    if (availability === 'after-download' || availability === 'downloading' || availability === 'no') {
      return false;
    }

    let session;
    try {
      session = await this.engine.create({
        ...MODEL_CONFIG,
        systemPrompt: ' '
      });
      this.lastPrimedAt = Date.now();
      return true;
    } finally {
      if (session?.destroy) {
        try { await session.destroy(); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Ensure the model is downloaded, reporting progress when available.
   * @param {Function} onProgress - (loaded, total) progress callback
   * @returns {Promise<{status: string, downloaded: boolean}>}
   */
  async ensureModelDownloaded(onProgress) {
    if (!this.engine) throw new Error('AI engine not available');

    const availability = await this.getAvailability();
    if (availability !== 'after-download' && availability !== 'downloading') {
      return { status: availability, downloaded: false };
    }

    let session;
    try {
      session = await this.engine.create({
        ...MODEL_CONFIG,
        systemPrompt: ' ',
        monitor: (monitorHandle) => {
          if (typeof onProgress !== 'function') return;
          monitorHandle.addEventListener('downloadprogress', (e) => {
            const loaded = typeof e?.loaded === 'number' ? e.loaded : 0;
            const total = typeof e?.total === 'number' ? e.total : 1;
            onProgress(loaded, total);
          });
        }
      });
      return { status: 'readily', downloaded: true };
    } finally {
      if (session?.destroy) {
        try { await session.destroy(); } catch { /* ignore */ }
      }
    }
  }
}

const localAI = new LocalAI();

/**
 * Load diagnostics state from storage (cached).
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
 * Persist diagnostics state.
 */
async function saveDiagnosticsState(partial = {}) {
  const current = await getDiagnosticsState();
  diagnosticsCache = { ...current, ...partial };
  try {
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: diagnosticsCache });
  } catch (e) { /* ignore */ }
  return diagnosticsCache;
}

/**
 * Clear page-context AI sessions used by the fallback path.
 */
async function clearPageModelSessions(sessionId = null) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (id, storeKey) => {
        // FIXED: Use the randomized key passed from the extension
        const store = window[storeKey] || {};
        const destroySession = (sess) => {
          try { sess.destroy(); } catch { /* ignore */ }
        };

        if (id) {
          if (store[id]) destroySession(store[id]);
          delete store[id];
        } else {
          Object.keys(store).forEach((key) => destroySession(store[key]));
          for (const key of Object.keys(store)) delete store[key];
        }

        // Clean up the global if empty to reduce footprint
        if (Object.keys(store).length === 0) {
          delete window[storeKey];
        } else {
          window[storeKey] = store;
        }
      },
      args: [sessionId, PAGE_STORE_KEY]
    });
  } catch (e) {
    console.warn('Page session cleanup failed', e);
  }
}

/**
 * Build model session config from settings.
 */
function getSessionConfig(settings) {
  const userLanguage = getSettingOrDefault(settings, 'language');
  const supportedLanguages = ['en', 'es', 'ja'];
  const language = supportedLanguages.includes(userLanguage) ? userLanguage : 'en';

  return {
    topK: settings.topK,
    temperature: settings.temperature,
    systemPrompt: settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt,
    expectedInputs: [
      { type: 'text', languages: [language] },
      { type: 'image' }
    ],
    expectedOutputs: [{ type: 'text', format: 'plain-text', languages: [language] }]
  };
}

/**
 * Reset/destroy AI model session(s).
 */
export function resetModel(sessionId = null) {
  localAI.destroy(sessionId);
  clearPageModelSessions(sessionId).catch((e) => {
    console.warn('Failed to clear page model sessions', e);
  });
}

/**
 * Check AI availability and return status.
 */
export async function checkAvailability({ forceCheck = false, cachedAvailability, cachedCheckedAt } = {}) {
  let diag = await getDiagnosticsState();
  let rawStatus = cachedAvailability;
  let checkedAt = cachedCheckedAt;

  const hasCached = Boolean(rawStatus && rawStatus !== 'unknown' && checkedAt);
  const shouldCheck = forceCheck || !hasCached;

  if (shouldCheck) {
    rawStatus = await localAI.getAvailability();
    checkedAt = Date.now();
    diag = await saveDiagnosticsState({
      availability: rawStatus,
      availabilityCheckedAt: checkedAt
    });
  }

  return { status: rawStatus, checkedAt, diag };
}

/**
 * Get diagnostics snapshot.
 */
export async function getDiagnostics(cached = {}) {
  const diag = await getDiagnosticsState();
  const availability = cached.availability || diag.availability;
  const availabilityCheckedAt = cached.availabilityCheckedAt || diag.availabilityCheckedAt;

  return {
    ...diag,
    availability,
    availabilityCheckedAt
  };
}

/**
 * Trigger an on-demand warmup and record diagnostics.
 */
export async function warmUpModel() {
  const now = Date.now();
  const availability = await localAI.getAvailability();
  let warmupStatus = 'unavailable';
  let warmupError = '';

  if (!localAI.engine || availability === 'no') {
    warmupError = 'Prompt API not available in this Chrome build.';
  } else if (availability === 'after-download' || availability === 'downloading') {
    try {
      await localAI.ensureModelDownloaded();
      await localAI.prime();
      warmupStatus = 'success';
    } catch (e) {
      warmupStatus = 'awaiting-download';
      warmupError = e?.message || 'Model is still downloading.';
    }
  } else {
    try {
      await localAI.prime();
      warmupStatus = 'success';
    } catch (e) {
      warmupStatus = 'error';
      warmupError = e?.message || 'Warmup failed';
    }
  }

  const diag = await saveDiagnosticsState({
    availability,
    availabilityCheckedAt: now,
    lastWarmupAt: now,
    lastWarmupStatus: warmupStatus,
    lastWarmupError: warmupError
  });

  return { status: availability, checkedAt: now, diag, warmupStatus, warmupError };
}

/**
 * Fetch image with retry and fallback strategies.
 */
async function fetchImageWithRetry(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!VALIDATION.ALLOWED_IMAGE_PROTOCOLS.includes(parsedUrl.protocol)) {
      throw new Error(USER_ERROR_MESSAGES.IMAGE_INVALID_URL);
    }
  } catch (e) {
    throw new Error(USER_ERROR_MESSAGES.IMAGE_INVALID_URL);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMING.IMAGE_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok && res.headers.get('content-type')?.startsWith(VALIDATION.IMAGE_CONTENT_TYPE_PREFIX)) {
        return await res.blob();
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (e) {
    console.warn('Direct fetch failed:', e);
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
      throw new Error("Cannot fetch from system pages");
    }

    const [{ result: base64 }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
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

  throw new Error(USER_ERROR_MESSAGES.IMAGE_FETCH_FAILED);
}

/**
 * Convert blob to canvas (required for Prompt API image input).
 * FIXED: Uses createImageBitmap for off-thread decoding (faster, non-blocking)
 */
async function blobToCanvas(blob, maxWidth) {
  let bitmap;
  try {
    // Fast path: off-thread decoding
    bitmap = await createImageBitmap(blob);
    let { width, height } = bitmap;

    if (width > maxWidth) {
      height = (height * maxWidth) / width;
      width = maxWidth;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Draw the bitmap directly to canvas
    ctx.drawImage(bitmap, 0, 0, width, height);
    
    return canvas;
  } catch (e) {
    console.error('Bitmap creation failed', e);
    throw new Error('Failed to process image attachment');
  } finally {
    // Cleanup bitmap memory regardless of success or failure
    if (bitmap) {
      bitmap.close();
    }
  }
}

/**
 * Fallback: Run prompt using window.ai in page context.
 */
async function runPromptInPage(prompt, sessionId, systemPrompt, attachments = []) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.startsWith('http')) {
    throw new Error('Restricted protocol');
  }

  // FIXED: Blobs CANNOT be serialized via JSON args in executeScript.
  // We MUST convert to Base64 data URLs here to transport them across the boundary.
  // Note: PDF attachments have plain text data (not Blobs) and pass through unchanged.
  // They are filtered out in the inner function since PDF content is already in the prompt.
  const serializedAttachments = await Promise.all(attachments.map(async (att) => {
    if (att.data instanceof Blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve({
          ...att,
          data: reader.result // Base64 data URL string
        });
        reader.onerror = () => reject(new Error('Failed to serialize attachment'));
        reader.readAsDataURL(att.data);
      });
    }
    return att; // Non-Blob data (e.g., PDF text) - already serializable
  }));

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: async (p, sys, atts, uiSessionId, storeKey) => {
      try {
        const model = window.ai?.languageModel || self.ai?.languageModel;
        if (!model) return { error: 'AI not found in page' };

        // FIXED: Use randomized key passed from extension to prevent fingerprinting
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
          // FIXED: Only process image attachments as blobs.
          // PDF attachments have plain text data (not URLs) - their content
          // is already embedded in the prompt text via buildPromptWithContext.
          const imageAtts = atts.filter(att => att.type && att.type.startsWith('image/'));
          if (imageAtts.length > 0) {
            const blobs = await Promise.all(imageAtts.map(async (att) => {
              // Convert Data URL (Base64) back to Blob inside the page
              const res = await fetch(att.data);
              return await res.blob();
            }));
            input = [p, ...blobs];
          }
        }

        const r = await sess.prompt(input);

        // FIXED: Clean up session after successful completion (as per SECURITY.md).
        // The global state should exist only for the duration of the AI response.
        try { sess.destroy(); } catch { /* ignore */ }
        delete store[uiSessionId];

        // Clean up the global variable if the store is empty
        if (Object.keys(store).length === 0) {
          delete window[storeKey];
        }

        return { ok: true, data: r };
      } catch (e) {
        const store = window[storeKey] || {};
        if (uiSessionId && store[uiSessionId]) {
          try { store[uiSessionId].destroy(); } catch { /* ignore */ }
          delete store[uiSessionId];
        }

        // FIXED: Clean up the global variable if the store is empty
        if (Object.keys(store).length === 0) {
          delete window[storeKey];
        } else {
          window[storeKey] = store;
        }

        return { error: e.toString() };
      }
    },
    args: [prompt, systemPrompt, serializedAttachments, sessionId, PAGE_STORE_KEY]
  });

  if (result?.error) {
    throw new Error(result.error);
  }
  return result?.data || '';
}

/**
 * Run AI prompt with streaming.
 */
export async function runPrompt({ sessionId, text, contextOverride, attachments, settings }, callbacks = {}) {
  const { onChunk, onComplete, onError, onAbort } = callbacks;

  if (localAI.controller) {
    try {
      localAI.controller.abort();
    } catch (e) { /* ignore */ }
  }

  const controller = new AbortController();
  localAI.controller = controller;
  let lastAiText = '';
  let generationAborted = false;

  try {
    await localAI.ensureModelDownloaded().catch(() => {});
    await localAI.prime().catch(() => {});

    const sessionConfig = getSessionConfig(settings);
    const { prompt: finalText, tokenEstimate } = await buildPromptWithContext(text, contextOverride, attachments);

    if (tokenEstimate > LIMITS.TOTAL_TOKEN_BUDGET * 0.8) {
      console.warn(`Nano Prompt: High token usage (${tokenEstimate}/${LIMITS.TOTAL_TOKEN_BUDGET})`);
    }

    const imageAttachments = attachments?.filter(att => att.type.startsWith('image/')) || [];

    let promptInput = finalText;
    if (imageAttachments.length > 0) {
      try {
        const canvases = await Promise.all(
          imageAttachments.map(async (att) => {
            const canvas = await blobToCanvas(att.data, LIMITS.IMAGE_MAX_WIDTH);
            return canvas;
          })
        );

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
      if (onChunk) onChunk(chunk);
    }, STREAMING_THROTTLE_MS);

    try {
      const streamedText = await localAI.promptStreaming(
        sessionId,
        promptInput,
        controller.signal,
        (chunk) => { throttledUpdate(chunk); },
        sessionConfig
      );

      throttledUpdate.flush();
      lastAiText = streamedText;
      if (onComplete) onComplete(streamedText);

    } catch (err) {
      throttledUpdate.flush();
      if (err?.name === 'AbortError') throw err;
      console.error("Side Panel failed with error:", err);

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://'))) {
        throw new Error(USER_ERROR_MESSAGES.AI_SYSTEM_PAGE);
      }

      // Fallback to page context - runPromptInPage handles image attachments
      // by filtering and converting them to blobs (see lines 538-550)
      const fallback = await runPromptInPage(finalText, sessionId, settings.systemPrompt, attachments);
      lastAiText = fallback;
      if (onComplete) onComplete(fallback);
    } finally {
      throttledUpdate.cancel();
    }

  } catch (err) {
    cancelGeneration();
    resetModel(sessionId);

    if (err?.name === 'AbortError') {
      generationAborted = true;
      if (onAbort) onAbort();
    } else {
      if (onError) onError(err);
    }
  } finally {
    if (localAI.controller === controller) {
      localAI.controller = null;
    }
  }

  return { text: lastAiText, aborted: generationAborted };
}

/**
 * Run image description.
 */
export async function fetchImage(url) {
  return await fetchImageWithRetry(url);
}

export function cancelGeneration() {
  if (localAI.controller) {
    localAI.controller.abort();
    localAI.controller = null;
  }
}

export function isGenerating() {
  return localAI.controller !== null;
}

/**
 * Generate a title for a session based on conversation.
 */
export async function generateTitle(userText, aiText) {
  if (!localAI.engine) return null;

  try {
    const conversationSnippet = `User: ${userText.slice(0, LIMITS.TITLE_GENERATION_MAX_CHARS)}
AI: ${aiText.slice(0, LIMITS.TITLE_GENERATION_MAX_CHARS)}`;

    const prompt = TITLE_GENERATION_PROMPT.replace('{conversation}', conversationSnippet);

    const titleSession = await localAI.engine.create({
      temperature: 0.3,
      topK: 10,
      systemPrompt: 'You generate concise, descriptive titles for conversations.',
      expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
    });

    const generatedTitle = await titleSession.prompt(prompt);
    await titleSession.destroy();

    if (!generatedTitle) return null;

    let title = generatedTitle.trim()
      .replace(/^["']|["']$/g, '')
      .replace(/[.!?]$/, '')
      .slice(0, LIMITS.TITLE_MAX_LENGTH);

    const now = new Date();
    const timeVariation = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;

    const genericTerms = ['conversation', 'chat', 'question', 'help', 'discussion'];
    const isGeneric = genericTerms.some(term => title.toLowerCase().includes(term));

    if (isGeneric && title.length < 30) {
      title = `${title} (${timeVariation})`;
    }

    return title;

  } catch (e) {
    console.warn('Title generation failed:', e);
    return null;
  }
}

// --- SMART REPLIES ---

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

/**
 * Generate smart reply suggestions.
 */
export async function generateSmartReplies(userText, aiText, settings) {
  if (!localAI.engine) return [];

  const prompt = buildSmartReplyPrompt(userText, aiText);
  const baseConfig = getSessionConfig(settings);
  const config = {
    ...baseConfig,
    temperature: Math.max(0.3, (baseConfig.temperature || DEFAULT_SETTINGS.temperature) - 0.2),
    topK: 32,
    systemPrompt: 'You propose short, helpful follow-up prompts for the user to click.'
  };

  const suggestionSession = await localAI.engine.create(config);
  try {
    const raw = await suggestionSession.prompt(prompt);
    return normalizeSmartReplies(raw);
  } finally {
    try { await suggestionSession.destroy(); } catch { /* ignore */ }
  }
}

// --- TRANSLATION ---

/**
 * Translate text using Chrome Translation API.
 */
export async function translateText(text, targetLang, callbacks = {}) {
  const { onStatusUpdate } = callbacks;

  if (!self.Translator || !self.LanguageDetector) {
    throw new Error('Translation API not available. Please enable chrome://flags/#translation-api');
  }

  let sourceLang = 'en';
  if (onStatusUpdate) onStatusUpdate('Detecting language...');

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

  if (sourceLang === targetLang) {
    return {
      translatedText: text,
      sourceLang,
      targetLang,
      sameLanguage: true
    };
  }

  if (onStatusUpdate) onStatusUpdate('Preparing translator...');

  const translatorAvailability = await self.Translator.availability({
    sourceLanguage: sourceLang,
    targetLanguage: targetLang
  });

  if (translatorAvailability === 'no') {
    throw new Error(`Translation from ${sourceLang} to ${targetLang} is not supported`);
  }

  if (onStatusUpdate) onStatusUpdate('Translating...');

  const translator = await self.Translator.create({
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        if (onStatusUpdate) onStatusUpdate(`Downloading translation model... ${Math.round(e.loaded * 100)}%`);
      });
    }
  });

  const translatedText = await translator.translate(text);
  translator.destroy();

  return { translatedText, sourceLang, targetLang, sameLanguage: false };
}

// --- SPEECH SYNTHESIS ---

export function speakText(text, callbacks = {}) {
  const { onStart, onEnd, onError } = callbacks;

  if (!('speechSynthesis' in window)) {
    if (onError) onError(new Error('Speech synthesis not supported'));
    return;
  }

  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH.LANGUAGE;

  utterance.onerror = (event) => {
    const errorType = event.error || 'unknown';

    if (SPEECH.EXPECTED_ERROR_TYPES.includes(errorType)) {
      if (onEnd) onEnd();
      return;
    }

    console.warn(`Speech synthesis error: ${errorType}`);
    if (onError) onError(new Error(errorType));
    if (onEnd) onEnd();
  };

  utterance.onend = () => {
    if (onEnd) onEnd();
  };

  if (onStart) onStart();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeech() {
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
}

export function isSpeaking() {
  return window.speechSynthesis && window.speechSynthesis.speaking;
}

export function isSomethingRunning() {
  return isSpeaking() || isGenerating();
}

// Expose language names for controller usage.
export { LANGUAGE_NAMES };

// Expose LocalAI helpers.
export const modelClient = localAI;
export function needsModelPriming() {
  return localAI.needsPriming();
}
export function primeModel() {
  return localAI.prime();
}
export function ensureModelDownloaded(onProgress) {
  return localAI.ensureModelDownloaded(onProgress);
}
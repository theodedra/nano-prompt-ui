/**
 * Model Layer - Pure AI Operations
 * 
 * This module handles all AI/LLM interactions without knowledge of UI or storage.
 * All side effects are handled via callbacks passed by the controller.
 */

import { buildPromptWithContext, estimateTokens, applySlidingWindow } from './context.js';
import { throttle } from './utils.js';
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

const STREAMING_THROTTLE_MS = 100;
const DIAGNOSTICS_KEY = 'nanoPrompt.diagnostics';
const SESSION_WARMUP_KEY = 'nanoPrompt.warmedUp';
const DOWNLOAD_POLL_INTERVAL_MS = 2000; // Poll every 2 seconds during download
const DOWNLOAD_POLL_MAX_ATTEMPTS = 180; // Max 6 minutes of polling
let diagnosticsCache = null;
const SMART_REPLY_LIMIT = 3;
const SMART_REPLY_CONTEXT_CHARS = 600;
const SMART_REPLY_MAX_LENGTH = 120;

// In-memory warmup flag - resets when Chrome restarts (sidepanel context reloads)
let hasWarmedUp = false;

// Download state tracking
let downloadPollTimer = null;
let downloadStatusCallback = null;

// --- LOCAL AI WRAPPER ---
/**
 * Wrapper class for Chrome's AI language model API
 */
class LocalAI {
  constructor() {
    this.sessions = new Map();
    this.controller = null;
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
   * @returns {Promise<string>} Availability status ('readily', 'after-download', 'downloading', 'no')
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

  /**
   * Lightweight warmup: create and immediately destroy a minimal session
   * to prime the engine for faster first-prompt response.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async ensureEngine() {
    if (!this.engine) {
      return { success: false, error: 'AI engine not available' };
    }

    try {
      const availability = await this.getAvailability();
      if (availability === 'no') {
        return { success: false, error: 'AI not available' };
      }
      if (availability === 'after-download' || availability === 'downloading') {
        return { success: false, error: 'Model still downloading' };
      }

      // Create minimal warmup session
      const session = await this.engine.create({
        ...MODEL_CONFIG,
        systemPrompt: 'Ready'
      });
      
      // Immediately destroy - we just wanted to prime the engine
      if (session?.destroy) {
        session.destroy();
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || 'Warmup failed' };
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
 * Get session configuration from settings
 * @param {object} settings - App settings
 * @returns {{topK: number, temperature: number, systemPrompt: string, expectedInputs: Array, expectedOutputs: Array}}
 */
function getSessionConfig(settings) {
  const userLanguage = getSettingOrDefault(settings, 'language');

  // Gemini Nano only supports en, es, ja
  // For other languages, fallback to English for Prompt API
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
 * Reset/destroy AI model session
 * @param {string|null} sessionId - Session to reset
 */
export function resetModel(sessionId = null) {
  localAI.destroy(sessionId);
  clearPageModelSessions(sessionId).catch((e) => {
    console.warn('Failed to clear page model sessions', e);
  });
}

/**
 * Check AI availability and return status
 * @param {{forceCheck?: boolean, cachedAvailability?: string, cachedCheckedAt?: number}} options
 * @returns {Promise<{status: string, checkedAt: number, diag: object}>}
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
 * Start polling for availability changes when status is 'after-download'
 * @param {Function} onStatusChange - Callback when status changes
 * @returns {Function} Stop polling function
 */
export function startDownloadPolling(onStatusChange) {
  stopDownloadPolling();
  
  downloadStatusCallback = onStatusChange;
  let attempts = 0;
  
  const poll = async () => {
    attempts++;
    
    try {
      // Add timeout to availability check to prevent blocking
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Availability check timeout')), 5000)
      );
      
      let status = await Promise.race([
        localAI.getAvailability(),
        timeoutPromise
      ]);
      
      // Chrome's availability() can be stale - if still 'after-download',
      // try creating a test session to check if model is actually ready
      if (status === 'after-download' && attempts % 3 === 0) {
        try {
          console.log('Nano Prompt: Testing if model is ready via session creation...');
          const testSession = await Promise.race([
            localAI.engine.create({
              ...MODEL_CONFIG,
              systemPrompt: 'test',
              temperature: 1.0,
              topK: 1
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
          ]);
          // If we get here, session creation succeeded - model is ready!
          if (testSession?.destroy) testSession.destroy();
          status = 'readily';
          console.log('Nano Prompt: Session creation succeeded, model is ready!');
        } catch (e) {
          // Session creation failed or timed out - still downloading
          console.log('Nano Prompt: Session creation test failed, still downloading');
        }
      }
      
      if (status === 'readily' || status === 'no') {
        console.log('Nano Prompt: Model download complete, status:', status);
        
        // Save callback BEFORE stopping (stopDownloadPolling clears it)
        const callback = downloadStatusCallback;
        stopDownloadPolling();
        
        // Also update diagnostics
        await saveDiagnosticsState({
          availability: status,
          availabilityCheckedAt: Date.now()
        });
        
        // Invoke callback after diagnostics are updated
        if (callback) {
          try {
            await callback(status);
          } catch (e) {
            console.warn('Nano Prompt: Status change callback error:', e);
          }
        }
        
        return;
      }
      
      // Still downloading - continue polling (unless we've hit max attempts)
      if (attempts < DOWNLOAD_POLL_MAX_ATTEMPTS) {
        downloadPollTimer = setTimeout(poll, DOWNLOAD_POLL_INTERVAL_MS);
      } else {
        console.warn('Nano Prompt: Download polling timed out after', attempts, 'attempts');
        stopDownloadPolling();
      }
    } catch (e) {
      // Timeout or other error - continue polling
      if (e.message !== 'Availability check timeout') {
        console.warn('Nano Prompt: Download poll error:', e);
      }
      if (attempts < DOWNLOAD_POLL_MAX_ATTEMPTS) {
        downloadPollTimer = setTimeout(poll, DOWNLOAD_POLL_INTERVAL_MS);
      }
    }
  };
  
  // Start polling immediately (don't wait for first interval)
  // Use setTimeout(0) to avoid blocking the caller
  downloadPollTimer = setTimeout(poll, 0);
  
  return stopDownloadPolling;
}

export function stopDownloadPolling() {
  if (downloadPollTimer) {
    clearTimeout(downloadPollTimer);
    downloadPollTimer = null;
  }
  downloadStatusCallback = null;
}

export function isDownloadPolling() {
  return downloadPollTimer !== null;
}

/**
 * Get diagnostics snapshot
 * @param {{availability?: string, availabilityCheckedAt?: number}} cached - Cached values
 * @returns {Promise<Object>} Diagnostics payload
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
 * Trigger an on-demand warmup and record diagnostics
 * @returns {Promise<{status: string, checkedAt: number, diag: object, warmupStatus: string, warmupError: string}>}
 */
export async function warmUpModel() {
  const now = Date.now();
  const availability = await localAI.getAvailability();
  let warmupStatus = 'unavailable';
  let warmupError = '';

  if (!localAI.engine || availability === 'no') {
    warmupError = 'Prompt API not available in this Chrome build.';
  } else if (availability === 'after-download' || availability === 'downloading') {
    warmupStatus = 'awaiting-download';
    warmupError = 'Model is still downloading.';
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

  if (warmupStatus === 'success') {
    hasWarmedUp = true;
    syncWarmupFlag(true);
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
 * Sync warmup flag to chrome.storage.session for cross-context sharing
 * @param {boolean} value - Warmup state to persist
 */
async function syncWarmupFlag(value) {
  try {
    await chrome.storage.session.set({ [SESSION_WARMUP_KEY]: value });
  } catch (e) {
    // Non-critical: session storage may not be available
  }
}

/**
 * Check if warmup has already been performed (checks storage for cross-context sync)
 * @returns {Promise<boolean>}
 */
async function checkWarmupFlag() {
  if (hasWarmedUp) return true;
  
  try {
    const result = await chrome.storage.session.get(SESSION_WARMUP_KEY);
    if (result[SESSION_WARMUP_KEY]) {
      hasWarmedUp = true;
      return true;
    }
  } catch (e) {
    // Non-critical: fall back to in-memory flag
  }
  
  return false;
}

/**
 * One-time session warmup - runs ensureEngine() on first sidepanel open
 * Skips warmup if already performed in this browser session.
 * @param {Object} callbacks - Optional callbacks for status updates
 * @param {Function} callbacks.onDownloadStart - Called when model download starts
 * @param {Function} callbacks.onDownloadProgress - Called with download progress (0-1)
 * @param {Function} callbacks.onDownloadComplete - Called when download completes
 * @returns {Promise<{skipped: boolean, success?: boolean, error?: string, downloaded?: boolean}>}
 */
export async function performSessionWarmup(callbacks = {}) {
  const { onDownloadStart, onDownloadProgress, onDownloadComplete } = callbacks;
  
  // Check both in-memory and session storage flags
  const alreadyWarmed = await checkWarmupFlag();
  if (alreadyWarmed) {
    return { skipped: true };
  }

  const availability = await localAI.getAvailability();
  
  // Handle both 'after-download' and 'downloading' states
  if (availability === 'after-download' || availability === 'downloading') {
    if (onDownloadStart) onDownloadStart();
    
    try {
      // Create a session - this triggers download and waits for completion
      const session = await localAI.engine.create({
        ...MODEL_CONFIG,
        systemPrompt: 'Warmup',
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            if (onDownloadProgress) onDownloadProgress(e.loaded);
          });
        }
      });
      
      if (session?.destroy) {
        session.destroy();
      }
      
      hasWarmedUp = true;
      syncWarmupFlag(true);
      
      if (onDownloadComplete) onDownloadComplete();
      
      return { skipped: false, success: true, downloaded: true };
      
    } catch (e) {
      return { skipped: false, success: false, error: e?.message || 'Download failed' };
    }
  }
  
  // Normal warmup path (model already available)
  const result = await localAI.ensureEngine();

  if (result.success) {
    hasWarmedUp = true;
    syncWarmupFlag(true);
  }

  return { skipped: false, ...result };
}

export function isWarmedUp() {
  return hasWarmedUp;
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
 * Convert blob to canvas (required for Prompt API image input)
 * @param {Blob} blob - Image blob
 * @param {number} maxWidth - Maximum width for resizing
 * @returns {Promise<HTMLCanvasElement>}
 */
async function blobToCanvas(blob, maxWidth) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
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

/**
 * Fallback: Run prompt using window.ai in page context
 * @param {string} prompt - Prompt text
 * @param {string} sessionId - UI session ID for per-chat isolation
 * @param {string} systemPrompt - System prompt
 * @param {Array} attachments - Attached files
 * @returns {Promise<string>} AI response
 */
async function runPromptInPage(prompt, sessionId, systemPrompt, attachments = []) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.startsWith('http')) {
    throw new Error('Restricted protocol');
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
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
    args: [prompt, systemPrompt, attachments, sessionId]
  });

  if (result?.error) {
    throw new Error(result.error);
  }
  return result?.data || '';
}

/**
 * Run AI prompt with streaming
 * @param {object} params - Prompt parameters
 * @param {string} params.sessionId - Session ID
 * @param {string} params.text - Prompt text
 * @param {string} params.contextOverride - Context override
 * @param {Array} params.attachments - Attachments
 * @param {object} params.settings - App settings
 * @param {object} callbacks - Callback functions
 * @param {Function} callbacks.onChunk - Called with each streaming chunk
 * @param {Function} callbacks.onComplete - Called when complete with final text
 * @param {Function} callbacks.onError - Called on error with error object
 * @param {Function} callbacks.onAbort - Called when generation is aborted
 * @returns {Promise<{text: string, aborted: boolean}>}
 */
export async function runPrompt({ sessionId, text, contextOverride, attachments, settings }, callbacks = {}) {
  const { onChunk, onComplete, onError, onAbort } = callbacks;
  
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
    const sessionConfig = getSessionConfig(settings);
    const { prompt: finalText, tokenEstimate } = await buildPromptWithContext(text, contextOverride, attachments);

    // Log token estimate for debugging long sessions
    if (tokenEstimate > LIMITS.TOTAL_TOKEN_BUDGET * 0.8) {
      console.warn(`Nano Prompt: High token usage (${tokenEstimate}/${LIMITS.TOTAL_TOKEN_BUDGET})`);
    }

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

      // Try fallback for non-image prompts (images don't work in page context)
      if (imageAttachments.length === 0) {
        const fallback = await runPromptInPage(finalText, sessionId, settings.systemPrompt, attachments);
        lastAiText = fallback;
        if (onComplete) onComplete(fallback);
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
    resetModel(sessionId);

    if (err?.name === 'AbortError') {
      generationAborted = true;
      if (onAbort) onAbort();
    } else {
      if (onError) onError(err);
    }
  } finally {
    // RACE CONDITION FIX: Only clear controller if it's still the active one
    if (localAI.controller === controller) {
      localAI.controller = null;
    }
  }

  return { text: lastAiText, aborted: generationAborted };
}

/**
 * Run image description
 * @param {string} url - Image URL
 * @returns {Promise<Blob>} Image blob ready for prompt
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
 * Generate a title for a session based on conversation
 * @param {string} userText - First user message
 * @param {string} aiText - First AI response
 * @returns {Promise<string|null>} Generated title or null
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
 * Generate smart reply suggestions
 * @param {string} userText - User's message
 * @param {string} aiText - AI's response
 * @param {object} settings - App settings
 * @returns {Promise<string[]>} Array of reply suggestions
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
    try { await suggestionSession.destroy(); } catch {}
  }
}

// --- TRANSLATION ---

/**
 * Translate text using Chrome Translation API
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code
 * @param {object} callbacks - Callback functions
 * @returns {Promise<{translatedText: string, sourceLang: string, usedFallback: boolean}>}
 */
export async function translateText(text, targetLang, callbacks = {}) {
  const { onStatusUpdate } = callbacks;
  
  // Check if Translation API is available
  if (!self.Translator || !self.LanguageDetector) {
    throw new Error('Translation API not available. Please enable chrome://flags/#translation-api');
  }

  // Step 1: Detect source language
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

  // Step 2: Check if translation is available for this language pair
  if (onStatusUpdate) onStatusUpdate('Preparing translator...');
  
  const translatorAvailability = await self.Translator.availability({
    sourceLanguage: sourceLang,
    targetLanguage: targetLang
  });

  if (translatorAvailability === 'no') {
    throw new Error(`Translation from ${sourceLang} to ${targetLang} is not supported`);
  }

  // Step 3: Create translator and translate
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

/**
 * Speak text using browser's speech synthesis
 * @param {string} text - Text to speak
 * @param {object} callbacks - Callback functions
 */
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
    
    // EXPECTED USER ACTIONS: Don't report as errors
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

// --- EXPORTS FOR LANGUAGE NAMES (used by controller) ---
export { LANGUAGE_NAMES };

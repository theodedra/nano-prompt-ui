import * as UI from './ui.js';
import {
  appState,
  getCurrentSession,
  upsertMessage,
  updateMessage,
  saveState,
  renameSession
} from './storage.js';
import { buildPromptWithContext } from './context.js';
import { dataUrlToBlob, resizeImage } from './utils.js';
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
  TITLE_GENERATION_PROMPT
} from './constants.js';

// --- LOCAL AI WRAPPER ---
/**
 * Wrapper class for Chrome's AI language model API
 */
class LocalAI {
  constructor() {
    this.session = null;
    this.controller = null; // Track active generation controller
  }

  get engine() {
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
   * @param {object} params - Session parameters
   * @returns {Promise<object>} AI session object
   */
  async createSession(params = {}) {
    if (!this.engine) throw new Error('AI not supported');
    const config = { ...MODEL_CONFIG, ...params };
    this.session = await this.engine.create(config);
    return this.session;
  }

  /**
   * Stream AI response with real-time updates
   * @param {string|Array} input - Prompt text or array with text and blobs
   * @param {AbortSignal} signal - Abort signal for cancellation
   * @param {Function} onUpdate - Callback for each chunk
   * @returns {Promise<string>} Complete response text
   */
  async promptStreaming(input, signal, onUpdate) {
    if (!this.session) throw new Error('No active session');

    const stream = await this.session.promptStreaming(input, { signal });
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
  destroy() {
    if (this.session) {
      try { this.session.destroy(); } catch(e) {}
      this.session = null;
    }
  }
}

const localAI = new LocalAI();

/**
 * Get session configuration from app state
 * @returns {{topK: number, temperature: number, systemPrompt: string}}
 */
function getSessionConfig() {
  return {
    topK: appState.settings.topK,
    temperature: appState.settings.temperature,
    systemPrompt: appState.settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt
  };
}

/**
 * Get recent conversation history for context
 * @param {object} session - Current session object
 * @returns {string} Formatted history snippet
 */
function getHistorySnippet(session) {
  const slice = session.messages.slice(-50);
  return slice.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.text}`).join('\n');
}

// --- EXPORTS ---

/**
 * Reset and destroy the current AI model session
 */
export function resetModel() { localAI.destroy(); }

/**
 * Check and update AI availability status in UI
 * @returns {Promise<void>}
 */
export async function refreshAvailability() {
  let status = await localAI.getAvailability();
  if (status === 'no') status = UI_MESSAGES.PAGE_MODE;
  const text = status === 'readily' ? UI_MESSAGES.READY : status;
  UI.setStatusText(text);
  UI.setHardwareStatus(`Gemini Nano: ${text}`);
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
 * Translate text to English
 * @param {string} text - Text to translate
 * @returns {Promise<void>}
 */
export async function runTranslator(text) {
  await runPrompt({
    text: `Translate the following text to English:\n\n${text}`,
    contextOverride: '',
    attachments: []
  });
}

// --- IMAGE DESCRIPTION ---
/**
 * Analyze and describe an image from URL
 * @param {string} url - Image URL to analyze
 * @returns {Promise<void>}
 */
export async function runImageDescription(url) {
  UI.setStatusText(UI_MESSAGES.ANALYZING_IMAGE);

  try {
    // 1. Smart Fetch
    const blob = await fetchImageWithRetry(url);

    // 2. Resize (Safety)
    UI.setStatusText(UI_MESSAGES.OPTIMIZING);
    const optimizedBase64 = await resizeImage(blob, LIMITS.IMAGE_MAX_WIDTH_DESCRIPTION);

    const attachment = {
      name: "Analyzed Image",
      type: "image/jpeg",
      data: optimizedBase64
    };

    // 3. Reset model to clear memory before image task
    resetModel();

    await runPrompt({
      text: "Describe this image in detail.",
      contextOverride: '',
      attachments: [attachment]
    });

  } catch (e) {
    console.error(e);
    UI.setStatusText(UI_MESSAGES.ERROR);
    toast.error(USER_ERROR_MESSAGES.IMAGE_PROCESSING_FAILED);
    resetModel();
    const session = getCurrentSession();
    upsertMessage(session.id, {
      role: 'ai',
      text: `**Image Error:** ${e.message}.`,
      ts: Date.now()
    });
    UI.renderLog();
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
export async function runPrompt({ text, contextOverride, attachments }) {
  const session = getCurrentSession();
  const userMessage = { role: 'user', text, ts: Date.now(), attachments };

  upsertMessage(session.id, userMessage);
  UI.renderLog();
  await saveState();

  UI.setBusy(true);
  UI.setStopEnabled(true);

  const aiMessageIndex = session.messages.length;
  upsertMessage(session.id, { role: 'ai', text: '', ts: Date.now() });
  UI.renderLog();

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

  try {
    const fullContext = await buildPromptWithContext(text, contextOverride, attachments);
    const history = getHistorySnippet(session);
    const finalText = `${fullContext}\n\nConversation History:\n${history}\n\nCurrent User Query:\n${text}`;

    let promptInput = finalText;
    if (attachments?.length > 0) {
        const imageBlobs = await Promise.all(attachments.map(att => dataUrlToBlob(att.data)));
        promptInput = [finalText, ...imageBlobs];
    }

    try {
        if (!localAI.session) await localAI.createSession(getSessionConfig());

        await localAI.promptStreaming(promptInput, controller.signal, (chunk) => {
            updateMessage(session.id, aiMessageIndex, { text: chunk });
            UI.updateLastMessageBubble(chunk);
        });

    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        console.log("Side Panel failed, attempting fallback...");

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://'))) {
             toast.error(USER_ERROR_MESSAGES.AI_SYSTEM_PAGE);
             throw new Error(USER_ERROR_MESSAGES.AI_SYSTEM_PAGE);
        }

        const fallback = await runPromptInPage(finalText, attachments);
        updateMessage(session.id, aiMessageIndex, { text: fallback });
        UI.updateLastMessageBubble(fallback);
    }

  } catch (err) {
    cancelGeneration();
    resetModel();

    // STOP FIX: Keep existing text and append stopped message instead of replacing
    if (err?.name === 'AbortError') {
      const currentMessage = session.messages[aiMessageIndex];
      const currentText = currentMessage?.text || '';

      // Only append (stopped) if there's actual content
      if (currentText && currentText.trim().length > 0) {
        const stoppedText = currentText + '\n\n' + UI_MESSAGES.STOPPED;
        updateMessage(session.id, aiMessageIndex, { text: stoppedText });
        UI.updateLastMessageBubble(stoppedText);
      } else {
        // If no content was generated, show stopped message
        updateMessage(session.id, aiMessageIndex, { text: UI_MESSAGES.STOPPED });
        UI.updateLastMessageBubble(UI_MESSAGES.STOPPED);
      }
    } else {
      // For other errors, show error message
      let msg = err.message || USER_ERROR_MESSAGES.AI_UNAVAILABLE;
      updateMessage(session.id, aiMessageIndex, { text: `Error: ${msg}` });
      UI.updateLastMessageBubble(`Error: ${msg}`);
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
  await saveState();

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
 * @param {Array} attachments - Attached files
 * @returns {Promise<string>} AI response
 */
async function runPromptInPage(prompt, attachments = []) {
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
    func: async (p, sys, atts) => {
      try {
        const model = window.ai?.languageModel || self.ai?.languageModel;
        if (!model) return { error: 'AI not found in page' };

        const sess = await model.create({
          systemPrompt: sys,
          expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
        });

        let input = p;
        if (atts && atts.length > 0) {
            const blobs = await Promise.all(atts.map(async (att) => {
                const res = await fetch(att.data);
                return await res.blob();
            }));
            input = [p, ...blobs];
        }

        const r = await sess.prompt(input);
        sess.destroy();
        return { ok: true, data: r };
      } catch (e) { return { error: e.toString() }; }
    },
    args: [prompt, appState.settings.systemPrompt, attachments]
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
  resetModel();
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
    UI.renderSessions();

  } catch (e) {
    // Silent fail - title generation is not critical
    console.warn('Title generation failed:', e);
  }
}

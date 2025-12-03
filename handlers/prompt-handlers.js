/**
 * Prompt Handlers - Prompt execution and AI interaction handlers
 *
 * Handles sending prompts to AI, summarization, translation, and related features.
 */

import * as Controller from '../controller/index.js';
import * as Model from '../model.js';
import { fetchContext } from '../context.js';
import { classifyIntent } from '../prompt-builder.js';
import {
  LIMITS,
  UI_MESSAGES,
  USER_ERROR_MESSAGES,
  INTENT_TYPES,
  getSettingOrDefault
} from '../constants.js';
import { handleError, handleErrorReturnEmpty } from '../utils/errors.js';

// Smart reply generation queue management
let currentSmartReplyGenerationToken = 0;

/**
 * Refresh context draft from active tab
 * @param {boolean} force - Force refresh ignoring cache
 * @param {boolean} shouldSave - Whether to persist to storage
 * @returns {Promise<string>} Context text
 */
export async function refreshContextDraft(force = false, shouldSave = true) {
  try {
    const ctx = await fetchContext(force);
    const text = ctx?.text || '';

    Controller.setRestrictedState(Boolean(ctx?.isRestricted));
    Controller.restoreStopButtonState(Model.isSomethingRunning());
    Controller.setContextDraft(text);

    if (shouldSave) {
      await Controller.persistContextDraft(text);
    }

    Controller.setContextText(text);
    return text;
  } catch (e) {
    return handleErrorReturnEmpty(e, {
      operation: 'Context refresh',
      fallbackMessage: 'CONTEXT_FETCH_FAILED'
    });
  }
}

/**
 * Setup prompt execution: create messages and prepare UI state
 * @param {Object} session - Current session
 * @param {string} text - Prompt text
 * @param {string} displayText - Display text for user message
 * @param {Array} attachments - Attachments
 * @returns {{userMessage: Object, aiMessageIndex: number}} User message and AI message index
 */
function setupPromptMessages(session, text, displayText, attachments) {
  Controller.renderSmartReplies([]);

  const userMessage = {
    role: 'user',
    text: displayText || text,
    ts: Date.now(),
    attachments
  };
  Controller.addMessage(session.id, userMessage);
  Controller.refreshLog();

  // Set up AI message placeholder
  Controller.setBusy(true);
  Controller.setStopEnabled(true);
  Controller.setStatus('Thinking...');

  const aiMessageIndex = session.messages.length;
  Controller.addMessage(session.id, { role: 'ai', text: '', ts: Date.now() });
  Controller.refreshLog();

  return { userMessage, aiMessageIndex };
}

/**
 * Create callback handlers for prompt execution
 * @param {Object} session - Current session
 * @param {number} aiMessageIndex - Index of AI message
 * @param {Function} onCompleteCallback - Callback to store final text
 * @returns {Object} Callback handlers object
 */
function createPromptCallbacks(session, aiMessageIndex, onCompleteCallback) {
  return {
    onChunk: (chunk) => {
      Controller.patchMessage(session.id, aiMessageIndex, { text: chunk });
      Controller.updateLastBubble(chunk, { streaming: true });
    },
    onComplete: (finalText) => {
      Controller.patchMessage(session.id, aiMessageIndex, { text: finalText });
      Controller.updateLastBubble(finalText);
      onCompleteCallback(finalText);
    },
    onError: (err) => {
      const errorInfo = handleError(err, {
        operation: 'Prompt execution',
        fallbackMessage: 'AI_UNAVAILABLE',
        showToast: true,
        logError: true
      });
      const msg = errorInfo.userMessage;
      Controller.patchMessage(session.id, aiMessageIndex, { text: `Error: ${msg}` });
      Controller.updateLastBubble(`Error: ${msg}`);
    },
    onAbort: () => {
      const currentMessage = session.messages[aiMessageIndex];
      const currentText = currentMessage?.text || '';

      if (currentText && currentText.trim().length > 0) {
        const stoppedText = currentText + '\n\n' + UI_MESSAGES.STOPPED;
        Controller.patchMessage(session.id, aiMessageIndex, { text: stoppedText });
        Controller.updateLastBubble(stoppedText);
      } else {
        Controller.patchMessage(session.id, aiMessageIndex, { text: UI_MESSAGES.STOPPED });
        Controller.updateLastBubble(UI_MESSAGES.STOPPED);
      }
    }
  };
}

/**
 * Cleanup after prompt execution: reset UI state and persist
 * @returns {Promise<void>}
 */
async function cleanupPromptExecution() {
  Controller.setBusy(false);
  Controller.setStopEnabled(false);
  Controller.setStatus('Ready to chat.');
  await Controller.persistState();
}

/**
 * Handle post-processing tasks after prompt execution
 * @param {Object} result - Prompt execution result
 * @param {string} lastAiText - Final AI response text
 * @param {Object} session - Current session
 * @param {Object} userMessage - User message object
 * @param {number} aiMessageIndex - Index of AI message
 */
function handlePromptPostProcessing(result, lastAiText, session, userMessage, aiMessageIndex) {
  if (!result.aborted && lastAiText) {
    generateSmartRepliesBackground(session.id, userMessage.text, lastAiText, aiMessageIndex);
  }

  if (session.messages.length === 2) {
    generateTitleBackground(session.id);
  }
}

/**
 * Run a prompt through the AI
 * @param {string} text - Prompt text
 * @param {string} contextOverride - Context to use
 * @param {Array} attachments - Attachments
 * @param {string} displayText - Text to show in chat (optional)
 */
export async function executePrompt(text, contextOverride, attachments, displayText = null) {
  const session = Controller.getCurrentSession();
  const settings = Controller.getSettings();

  const { userMessage, aiMessageIndex } = setupPromptMessages(session, text, displayText, attachments);

  let lastAiText = '';
  const storeFinalText = (finalText) => { lastAiText = finalText; };

  const callbacks = createPromptCallbacks(session, aiMessageIndex, storeFinalText);

  const result = await Model.runPrompt({
    sessionId: session.id,
    text,
    contextOverride,
    attachments,
    settings
  }, callbacks);

  await cleanupPromptExecution();
  handlePromptPostProcessing(result, lastAiText, session, userMessage, aiMessageIndex);
}

/**
 * Generate smart replies in the background
 * @param {string} sessionId - Session ID
 * @param {string} userText - User's message text
 * @param {string} aiText - AI's response text
 * @param {number} aiIndex - Index of AI message
 */
export async function generateSmartRepliesBackground(sessionId, userText, aiText, aiIndex) {
  // Cancel previous generation by incrementing token
  currentSmartReplyGenerationToken++;
  const generationToken = currentSmartReplyGenerationToken;

  try {
    const settings = Controller.getSettings();
    const replies = await Model.generateSmartReplies(userText, aiText, settings);

    // Only apply results if this generation is still current
    if (generationToken !== currentSmartReplyGenerationToken) {
      return; // Stale generation, ignore results
    }

    Controller.patchMessage(sessionId, aiIndex, { smartReplies: replies });

    // Double-check token before rendering (race condition protection)
    if (generationToken === currentSmartReplyGenerationToken) {
      if (Controller.getCurrentSessionId() === sessionId) {
        Controller.renderSmartReplies(replies);
      }
      await Controller.persistState();
    }
  } catch (e) {
    // Only log error if this generation is still current
    if (generationToken === currentSmartReplyGenerationToken) {
      handleError(e, {
        operation: 'Smart reply generation',
        showToast: false, // Background operation, don't show toast
        logError: true
      });
    }
  }
}

/**
 * Generate title in the background for new sessions
 * @param {string} sessionId - Session ID
 */
export async function generateTitleBackground(sessionId) {
  try {
    const session = Controller.getSession(sessionId);
    if (!session || session.messages.length < 2) return;
    if (session.title !== 'New chat' && !session.title.endsWith('copy')) return;

    const userMsg = session.messages.find(m => m.role === 'user');
    const aiMsg = session.messages.find(m => m.role === 'ai');
    if (!userMsg || !aiMsg) return;

    const title = await Model.generateTitle(userMsg.text, aiMsg.text);
    if (title) {
      await Controller.updateSessionTitle(sessionId, title);
    }
  } catch (e) {
    handleError(e, {
      operation: 'Background title generation',
      showToast: false, // Background operation, don't show toast
      logError: true
    });
  }
}

/**
 * Handle Ask button click - send prompt to AI
 * @returns {Promise<void>}
 */
export async function handleAskClick(overrideText = null) {
  if (overrideText?.preventDefault) overrideText.preventDefault();

  const rawInput = typeof overrideText === 'string' ? overrideText : Controller.getInputValue();
  const text = (rawInput || '').trim() || 'Hello';
  const attachments = Controller.getAttachments();

  Controller.setInputValue('');
  Controller.clearAttachments();

  let contextOverride = Controller.getContextText();
  const intent = classifyIntent(text);

  if (text.length < LIMITS.SHORT_QUERY_THRESHOLD && intent === INTENT_TYPES.NONE) {
    contextOverride = '';
  } else if (contextOverride.includes('[System Page]')) {
    contextOverride = await refreshContextDraft(true);
    if (contextOverride.includes('[System Page]') && intent !== INTENT_TYPES.PAGE) {
      contextOverride = '';
    }
  }

  try {
    await executePrompt(text, contextOverride, attachments);
  } catch (e) {
    handleError(e, {
      operation: 'Prompt execution',
      fallbackMessage: 'AI_SESSION_FAILED',
      showToast: true,
      logError: true
    });
    Controller.setStatus(UI_MESSAGES.ERROR);
  }
}

/**
 * Handle Summarize Tab button click
 * @returns {Promise<void>}
 */
export async function handleSummarizeClick() {
  Controller.setStatus(UI_MESSAGES.READING_TAB);
  const session = Controller.getCurrentSession();
  Model.resetModel(session.id);
  const freshText = await refreshContextDraft(true);
  await executePrompt('Summarize the current tab in seven detailed bullet points.', freshText, []);
}

// --- TRANSLATION & SUMMARIZER (using model via controller) ---

/**
 * Run summarizer on provided text
 * @param {string} text - Text to summarize
 */
export async function runSummarizer(text) {
  await executePrompt(
    `Summarize the following content into key bullet points:\n\n${text}`,
    '',
    []
  );
}

/**
 * Rewrite text with specified tone
 * @param {string} text - Text to rewrite
 * @param {string} tone - Desired tone (default: 'professional')
 */
export async function runRewriter(text, tone = 'professional') {
  await executePrompt(
    `Rewrite the following text to be more ${tone}:\n\n${text}`,
    '',
    []
  );
}

/**
 * Translate text to user's selected language
 * @param {string} text - Text to translate
 */
export async function runTranslator(text) {
  const settings = Controller.getSettings();
  const targetLang = getSettingOrDefault(settings, 'language');
  const session = Controller.getCurrentSession();

  Controller.setBusy(true);
  Controller.setStatus('Detecting language...');

  try {
    const result = await Model.translateText(text, targetLang, {
      onStatusUpdate: (status) => Controller.setStatus(status)
    });

    if (result.sameLanguage) {
      // Same language - show message
      const userMessage = { role: 'user', text: `Translate: ${text}`, ts: Date.now() };
      const aiMessage = {
        role: 'ai',
        text: `The text is already in the target language (${targetLang.toUpperCase()}). No translation needed:\n\n${text}`,
        ts: Date.now()
      };
      Controller.addMessage(session.id, userMessage);
      Controller.addMessage(session.id, aiMessage);
      Controller.refreshLog();
    } else {
      // Show translated result
      const userMessage = {
        role: 'user',
        text: `Translate (${result.sourceLang} → ${result.targetLang}): ${text}`,
        ts: Date.now()
      };
      const aiMessage = { role: 'ai', text: result.translatedText, ts: Date.now() };

      Controller.addMessage(session.id, userMessage);
      Controller.addMessage(session.id, aiMessage);
      Controller.refreshLog();
      Controller.showToast('success', 'Translation complete');
    }

    Controller.setBusy(false);
    Controller.setStatus('Ready to chat.');
    await Controller.persistState();

  } catch (error) {
    handleError(error, {
      operation: 'Translation',
      showToast: false, // We'll show a warning toast below after fallback
      logError: true
    });

    // Fallback to Gemini Nano Prompt API
    Controller.setStatus('Using fallback translation...');
    const langName = Model.LANGUAGE_NAMES[targetLang] || 'English';

    try {
      await executePrompt(
        `Translate the following text to ${langName}:\n\n${text}`,
        '',
        []
      );
      Controller.showToast('warning', 'Used Gemini Nano fallback (Translation API unavailable)');
    } catch (fallbackError) {
      handleError(fallbackError, {
        operation: 'Translation fallback',
        fallbackMessage: 'AI_SESSION_FAILED',
        showToast: true,
        logError: true
      });
    }
  }
}

/**
 * Analyze and describe an image from URL
 * @param {string} url - Image URL to analyze
 */
export async function runImageDescription(url) {
  Controller.setStatus(UI_MESSAGES.ANALYZING_IMAGE);
  const session = Controller.getCurrentSession();

  try {
    const blob = await Model.fetchImage(url);

    const attachment = {
      name: "Analyzed Image",
      type: "image/jpeg",
      data: blob
    };

    Model.resetModel(session.id);

    await executePrompt("Describe this image in detail.", '', [attachment]);

  } catch (e) {
    const errorInfo = handleError(e, {
      operation: 'Image description',
      fallbackMessage: 'IMAGE_PROCESSING_FAILED',
      showToast: true,
      logError: true
    });
    Controller.setStatus(UI_MESSAGES.ERROR);
    Model.resetModel(session.id);

    Controller.addMessage(session.id, {
      role: 'ai',
      text: `**Image Error:** ${errorInfo.userMessage}`,
      ts: Date.now()
    });
    Controller.refreshLog();
  }
}



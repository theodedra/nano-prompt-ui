/**
 * Chat Handlers - UI Event Handlers
 * 
 * Handles user interactions and dispatches to controller.
 * Does NOT directly access storage or model - only through controller.
 */

import * as Controller from './controller.js';
import * as Model from './model.js';
import { fetchContext, classifyIntent } from './context.js';
import { debounce } from './utils.js';
import {
  TIMING,
  LIMITS,
  UI_MESSAGES,
  USER_ERROR_MESSAGES,
  INTENT_TYPES,
  getSettingOrDefault
} from './constants.js';
import { registerContextMenuHandlers } from './context-menu-handlers.js';

let recognition;
let recognizing = false;
let tabListenersAttached = false;
let confirmingDeleteId = null;
let isSnapshotBusy = false;

/**
 * Refresh context draft from active tab
 * @param {boolean} force - Force refresh ignoring cache
 * @param {boolean} shouldSave - Whether to persist to storage
 * @returns {Promise<string>} Context text
 */
async function refreshContextDraft(force = false, shouldSave = true) {
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
    console.warn('Context refresh failed', e);
    Controller.showToast('error', USER_ERROR_MESSAGES.CONTEXT_FETCH_FAILED);
    return '';
  }
}

/**
 * Set up tab listeners for automatic context synchronization
 */
function ensureTabContextSync() {
  if (tabListenersAttached) return;
  if (!chrome?.tabs?.onActivated) return;

  const debouncedUpdate = debounce(() => {
    refreshContextDraft(false, false);
  }, TIMING.TAB_UPDATE_DEBOUNCE_MS);

  chrome.tabs.onActivated.addListener(() => debouncedUpdate());
  chrome.tabs.onUpdated.addListener((id, info, tab) => {
    if (tab?.active && info.status === 'complete') debouncedUpdate();
  });
  tabListenersAttached = true;
}

function getSnapshotHost(url = '') {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

function clampLabel(text = '', max = 80) {
  if (!text) return 'Saved page';
  return text.length > max ? text.slice(0, max - 1) + '...' : text;
}

function getSessionMarkdown(sessionId) {
  const session = Controller.getSession(sessionId);
  if (!session) return '';
  return session.messages.map(m => `### ${m.role === 'user' ? 'User' : 'Nano'}\n${m.text}`).join('\n\n');
}

function getSessionPlaintext(sessionId) {
  const session = Controller.getSession(sessionId);
  if (!session) return '';
  return session.messages.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.text}`).join('\n\n');
}

async function applySnapshot(snapshot, { announce = false } = {}) {
  if (!snapshot) return;
  Controller.activateSnapshot(snapshot.id);
  Controller.setContextText(snapshot.text);
  Controller.setContextDraft(snapshot.text);
  await Controller.persistContextDraft(snapshot.text);
  Controller.setRestrictedState(false);
  Controller.renderContextUI();
  await Controller.persistState();
  if (announce) Controller.showToast('success', 'Using saved context');
}

async function applySnapshotById(id) {
  if (!id) return;
  const snapshot = Controller.getSnapshotById(id);
  if (!snapshot) return;
  await applySnapshot(snapshot, { announce: true });
}

async function handleDeleteSnapshot(id) {
  if (!id) return;
  const activeSnapshotId = Controller.getActiveContextSnapshot()?.id;
  const wasActive = activeSnapshotId === id;
  const removed = Controller.deleteSnapshot(id);
  if (!removed) return;

  if (wasActive) {
    // Get first remaining snapshot
    const snapshots = Controller.getSession(Controller.getCurrentSessionId())?.contextSnapshots || [];
    if (snapshots[0]) {
      await applySnapshot(snapshots[0]);
    } else {
      await useLiveContext({ quiet: true });
    }
  } else {
    Controller.renderContextUI();
    await Controller.persistState();
  }
  Controller.showToast('success', 'Snapshot deleted');
}

async function useLiveContext({ quiet = false } = {}) {
  if (isSnapshotBusy) return;
  isSnapshotBusy = true;
  try {
    Controller.activateSnapshot(null);
    Controller.renderContextUI();

    const liveCtx = await fetchContext(true, { respectSnapshot: false });
    const liveText = liveCtx?.text || '';
    Controller.setContextText(liveText);
    Controller.setContextDraft(liveText);
    await Controller.persistContextDraft(liveText);
    Controller.setRestrictedState(Boolean(liveCtx?.isRestricted));

    await Controller.persistState();
    if (!quiet) Controller.showToast('success', 'Live tab context restored');
  } catch (e) {
    console.warn('Failed to refresh live context', e);
    Controller.showToast('error', 'Could not refresh live context.');
  } finally {
    isSnapshotBusy = false;
  }
}

export async function handleSaveSnapshotClick() {
  if (isSnapshotBusy) return;
  isSnapshotBusy = true;
  try {
    const ctx = await fetchContext(true, { respectSnapshot: false });
    if (ctx?.isRestricted || !ctx?.text) {
      Controller.showToast('error', 'Context not available on this page.');
      return;
    }

    const snapshot = Controller.saveSnapshot({
      title: clampLabel(ctx.title || getSnapshotHost(ctx.url)),
      url: ctx.url || '',
      text: ctx.text,
      createdAt: Date.now()
    });

    if (snapshot) {
      await applySnapshot(snapshot, { announce: true });
    } else {
      Controller.showToast('error', 'Could not save context snapshot.');
    }
  } catch (e) {
    console.warn('Snapshot save failed', e);
    Controller.showToast('error', 'Failed to save context snapshot.');
  } finally {
    isSnapshotBusy = false;
  }
}

export async function handleUseLiveContext(event) {
  event?.preventDefault();
  await useLiveContext();
}

export async function handleSnapshotListClick(event) {
  const useBtn = event.target.closest('.use-snapshot');
  const deleteBtn = event.target.closest('.delete-snapshot');

  if (useBtn?.dataset?.id) {
    event.preventDefault();
    await applySnapshotById(useBtn.dataset.id);
    return;
  }

  if (deleteBtn?.dataset?.id) {
    event.preventDefault();
    await handleDeleteSnapshot(deleteBtn.dataset.id);
  }
}

/**
 * Initialize the extension and load saved state
 * @returns {Promise<void>}
 */
export async function bootstrap() {
  registerContextMenuHandlers();
  
  // Load state is handled by storage module import
  const { loadState, appState, getPendingAttachments, BLANK_TEMPLATE_ID } = await import('./storage.js');
  await loadState();

  Controller.applyTheme(getSettingOrDefault(appState.settings, 'theme'));

  Controller.setSessionSearchTerm(Controller.getSessionSearchTerm());
  
  // Import UI for template initialization
  const UI = await import('./ui.js');
  UI.updateTemplates(appState.templates, BLANK_TEMPLATE_ID);
  
  Controller.renderSessionsList();
  Controller.setContextText(appState.contextDraft);
  UI.renderPendingAttachments(getPendingAttachments());
  Controller.renderCurrentLog();
  Controller.renderContextUI();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mic_setup') === 'true') {
    setTimeout(() => handleMicClick(), TIMING.MIC_SETUP_DELAY_MS);
    return;
  }

  ensureTabContextSync();
  await refreshContextDraft(true);

  chrome.runtime.sendMessage({ action: 'PANEL_READY' });
}

/**
 * Run a prompt through the AI
 * @param {string} text - Prompt text
 * @param {string} contextOverride - Context to use
 * @param {Array} attachments - Attachments
 * @param {string} displayText - Text to show in chat (optional)
 */
async function executePrompt(text, contextOverride, attachments, displayText = null) {
  const session = Controller.getCurrentSession();
  const settings = Controller.getSettings();
  
  // Clear smart replies
  Controller.renderSmartReplies([]);
  
  // Add user message
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
  
  let lastAiText = '';
  
  const result = await Model.runPrompt({
    sessionId: session.id,
    text,
    contextOverride,
    attachments,
    settings
  }, {
    onChunk: (chunk) => {
      Controller.patchMessage(session.id, aiMessageIndex, { text: chunk });
      Controller.updateLastBubble(chunk, { streaming: true });
    },
    onComplete: (finalText) => {
      Controller.patchMessage(session.id, aiMessageIndex, { text: finalText });
      Controller.updateLastBubble(finalText);
      lastAiText = finalText;
    },
    onError: (err) => {
      const msg = err.message || USER_ERROR_MESSAGES.AI_UNAVAILABLE;
      Controller.patchMessage(session.id, aiMessageIndex, { text: `Error: ${msg}` });
      Controller.updateLastBubble(`Error: ${msg}`);
      Controller.showToast('error', msg);
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
  });
  
  Controller.setBusy(false);
  Controller.setStopEnabled(false);
  Controller.setStatus('Ready to chat.');
  await Controller.persistState();
  
  // Generate smart replies in background
  if (!result.aborted && lastAiText) {
    generateSmartRepliesBackground(session.id, userMessage.text, lastAiText, aiMessageIndex);
  }
  
  // Auto-generate title for first exchange
  if (session.messages.length === 2) {
    generateTitleBackground(session.id);
  }
}

async function generateSmartRepliesBackground(sessionId, userText, aiText, aiIndex) {
  try {
    const settings = Controller.getSettings();
    const replies = await Model.generateSmartReplies(userText, aiText, settings);
    Controller.patchMessage(sessionId, aiIndex, { smartReplies: replies });
    
    if (Controller.getCurrentSessionId() === sessionId) {
      Controller.renderSmartReplies(replies);
    }
    await Controller.persistState();
  } catch (e) {
    console.warn('Smart reply generation failed', e);
  }
}

async function generateTitleBackground(sessionId) {
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
    console.warn('Background title generation failed:', e);
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
  }
  else if (contextOverride.includes('[System Page]')) {
     contextOverride = await refreshContextDraft(true);
     if (contextOverride.includes('[System Page]') && intent !== INTENT_TYPES.PAGE) {
       contextOverride = '';
     }
  }

  try {
    await executePrompt(text, contextOverride, attachments);
  } catch (e) {
    console.error('Prompt Execution Failed:', e);
    Controller.setStatus(UI_MESSAGES.ERROR);
    Controller.showToast('error', USER_ERROR_MESSAGES.AI_SESSION_FAILED);
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

/**
 * Handle New Session button click
 * @returns {Promise<void>}
 */
export async function handleNewSessionClick() {
  const session = await Controller.createNewSession();
  Model.cancelGeneration();
  Model.resetModel(session.id);
}

/**
 * Handle session deletion with confirmation
 * @param {HTMLElement} btn - Delete button element
 * @param {string} id - Session ID to delete
 * @returns {Promise<void>}
 */
async function deleteSessionHandler(btn, id) {
  if (id === confirmingDeleteId) {
    Model.cancelGeneration();
    Model.resetModel(id);
    await Controller.removeSession(id);
    confirmingDeleteId = null;
  } else {
    confirmingDeleteId = id;
    Controller.renderSessionsList(confirmingDeleteId);
    setTimeout(() => {
        if (confirmingDeleteId === id) {
           confirmingDeleteId = null;
           Controller.renderSessionsList();
        }
    }, TIMING.DELETE_CONFIRM_TIMEOUT_MS);
  }
}

/**
 * Handle session rename
 * @param {string} id - Session ID to rename
 * @returns {Promise<void>}
 */
async function renameSessionHandler(id) {
  const session = Controller.getSession(id);
  const newTitle = prompt(UI_MESSAGES.RENAME_CHAT, session.title);
  if (newTitle) {
    await Controller.renameSessionById(id, newTitle);
  }
}

/**
 * Handle session switch
 * @param {HTMLElement} row - Session row element
 * @returns {Promise<void>}
 */
async function switchSessionHandler(row) {
  const id = row.dataset.id;
  Model.cancelGeneration();
  await Controller.switchSession(id);
}

/**
 * Handle session search input
 * @param {InputEvent} event - Input event
 */
export function handleSessionSearchInput(event) {
  Controller.setSessionSearchTerm(event.target.value || '');
  Controller.renderSessionsList();
}

export function handleSessionTriggerClick(event) {
  event.stopPropagation();
  Controller.toggleMenu('session');
}

export function handleTemplatesTriggerClick(event) {
  event.stopPropagation();
  Controller.toggleMenu('templates');
}

/**
 * Handle session menu interactions (switch, rename, delete)
 * @param {Event} event - Click event
 * @returns {Promise<void>}
 */
export async function handleSessionMenuClick(event) {
  const btn = event.target.closest('button');
  const row = event.target.closest('.session-row');

  if (btn && btn.classList.contains('action-btn')) {
    event.stopPropagation();
    const id = btn.dataset.id;

    if (btn.classList.contains('delete')) {
      await deleteSessionHandler(btn, id);
    } else if (btn.classList.contains('edit')) {
      await renameSessionHandler(id);
    }
    return;
  }
  if (row) await switchSessionHandler(row);
}

/**
 * Handle Copy Chat button click
 * @returns {Promise<void>}
 */
export async function handleCopyChatClick() {
  const text = getSessionPlaintext(Controller.getCurrentSessionId());
  if (!text) return;
  await navigator.clipboard.writeText(text);
  Controller.setStatus(UI_MESSAGES.COPIED);
  Controller.showToast('success', UI_MESSAGES.COPIED);
  setTimeout(() => Controller.setStatus(UI_MESSAGES.READY), 1500);
}

/**
 * Handle Save Markdown button click
 */
export function handleSaveMarkdown() {
  const md = getSessionMarkdown(Controller.getCurrentSessionId());
  if (!md) return;
  const blob = new Blob([md], { type: 'text/markdown' });
  Controller.downloadBlob(blob, `chat-export-${Date.now()}.md`);
  Controller.showToast('success', 'Chat exported');
}

/**
 * Handle Enter key in input field
 * @param {KeyboardEvent} event - Keyboard event
 */
export function handleInputKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleAskClick();
  }
}

/**
 * Handle global keyboard shortcuts
 * @param {KeyboardEvent} event - Keyboard event
 */
export function handleDocumentKeyDown(event) {
  if (event.key === 'Escape') {
    if (Controller.isModalOpen()) Controller.closeModal();
    return;
  }
  if (event.key === 'Tab') {
    const container = Controller.getTrapContainer();
    Controller.trapFocus(event, container);
  }
}

export function handleDocumentClick(event) {
  if (!event.target.closest('#templates-dropdown')) Controller.closeMenu('templates');
  if (!event.target.closest('#session-dropdown')) Controller.closeMenu('session');
}

/**
 * Handle modal backdrop/close button clicks
 * @param {MouseEvent} event - Click event
 */
export function handleModalClick(event) {
  const btn = event.target.closest('[data-dismiss="modal"]');
  const backdrop = event.target.classList.contains('modal-backdrop');
  if (btn || backdrop) Controller.closeModal();
}

/**
 * Handle message bubble actions (copy, speak)
 * @param {MouseEvent} event - Click event
 * @returns {Promise<void>}
 */
export async function handleLogClick(event) {
  const btn = event.target.closest('button');
  if (!btn) return;

  const idx = btn.dataset.idx;
  const session = Controller.getCurrentSession();
  
  if (btn.classList.contains('bubble-copy')) {
    const msg = session.messages[idx];
    if(msg) {
      await navigator.clipboard.writeText(msg.text);
      Controller.showToast('success', 'Message copied');
    }
  } else if (btn.classList.contains('speak')) {
    const msg = session.messages[idx];
    if(msg) {
      Model.speakText(msg.text, {
        onStart: () => Controller.setStopEnabled(true),
        onEnd: () => Controller.setStopEnabled(false),
        onError: () => Controller.setStopEnabled(false)
      });
    }
  } else if (btn.classList.contains('smart-reply-btn')) {
    const reply = btn.dataset.reply;
    if (reply) {
      event.preventDefault();
      await handleAskClick(reply);
    }
  }
}

/**
 * Handle template selection from dropdown
 * @param {MouseEvent} event - Click event
 */
export function handleTemplateSelect(event) {
  const target = event.target.closest('.dropdown-item');
  if (!target) return;
  const text = target.dataset.text;
  Controller.setInputValue(Controller.getInputValue() + text);
  Controller.closeMenu('templates');
  Controller.focusInput();
}

/**
 * Handle microphone button click - start/stop voice input
 */
export function handleMicClick() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) {
      Controller.showToast('error', USER_ERROR_MESSAGES.SPEECH_NOT_SUPPORTED);
      return;
    }

    if (recognizing) {
      if (recognition) {
        recognition.stop();
        recognition = null;
      }
      return;
    }

    recognition = new Speech();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => { recognizing = true; Controller.setMicState(true); };
    recognition.onend = () => {
      recognizing = false;
      Controller.setMicState(false);
      recognition = null;
    };
    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      recognizing = false;
      Controller.setMicState(false);
      recognition = null;
      Controller.showToast('error', USER_ERROR_MESSAGES.SPEECH_FAILED);
    };
    recognition.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; ++i) t += e.results[i][0].transcript;
        Controller.setInputValue(t);
    };

    try {
      recognition.start();
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
      recognition = null;
      recognizing = false;
      Controller.setMicState(false);
      Controller.showToast('error', USER_ERROR_MESSAGES.SPEECH_FAILED);
    }
}

/**
 * Handle speak last AI response button click
 */
export function handleSpeakLast() {
    const session = Controller.getCurrentSession();
    const last = [...session.messages].reverse().find(m => m.role === 'ai');
    if (last) {
      Model.speakText(last.text, {
        onStart: () => Controller.setStopEnabled(true),
        onEnd: () => Controller.setStopEnabled(false),
        onError: () => Controller.setStopEnabled(false)
      });
    }
}

/**
 * Handle stop button click - cancel generation/speech
 */
export function handleStopClick() {
  Model.cancelGeneration();
  Model.stopSpeech();
  Controller.setStopEnabled(false);
}

/**
 * Handle context toggle button click
 * @returns {Promise<void>}
 */
export async function handleToggleContext() {
  Controller.renderContextUI();
  Controller.openContextModal();
  await refreshContextDraft(false);
}

/**
 * Handle context textarea input - update in-memory state
 * @param {Event} event - Input event
 */
export function handleContextInput(event) {
  const text = event.target.value;
  Controller.setContextDraft(text);
}

/**
 * Handle context textarea blur - save to storage
 * @param {Event} event - Blur event
 * @returns {Promise<void>}
 */
export async function handleContextBlur(event) {
  const text = event.target.value;
  await Controller.persistContextDraft(text);
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
    console.error('Translation failed:', error);

    // Fallback to Gemini Nano Prompt API
    Controller.setStatus('Using fallback translation...');
    const langName = Model.LANGUAGE_NAMES[targetLang] || 'English';

    await executePrompt(
      `Translate the following text to ${langName}:\n\n${text}`,
      '',
      []
    );

    Controller.showToast('warning', 'Used Gemini Nano fallback (Translation API unavailable)');
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
    // Fetch and prepare image
    const blob = await Model.fetchImage(url);

    const attachment = {
      name: "Analyzed Image",
      type: "image/jpeg",
      data: blob
    };

    // Reset model before image task
    Model.resetModel(session.id);

    await executePrompt("Describe this image in detail.", '', [attachment]);

  } catch (e) {
    console.error(e);
    Controller.setStatus(UI_MESSAGES.ERROR);
    Controller.showToast('error', USER_ERROR_MESSAGES.IMAGE_PROCESSING_FAILED);
    Model.resetModel(session.id);
    
    Controller.addMessage(session.id, {
      role: 'ai',
      text: `**Image Error:** ${e.message}.`,
      ts: Date.now()
    });
    Controller.refreshLog();
  }
}

// --- AVAILABILITY (called from sidepanel.js) ---

/**
 * Refresh AI availability status
 * @param {{forceCheck?: boolean}} options
 */
export async function refreshAvailability({ forceCheck = false } = {}) {
  const result = await Model.checkAvailability({
    forceCheck,
    cachedAvailability: Controller.getAvailability(),
    cachedCheckedAt: Controller.getAvailabilityCheckedAt()
  });
  
  Controller.updateAvailabilityDisplay(result.status, result.checkedAt, result.diag);
}

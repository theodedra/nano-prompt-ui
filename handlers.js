import {
  appState,
  loadState,
  saveState,
  createSessionFrom,
  deleteSession,
  setCurrentSession,
  getCurrentSession,
  addAttachment,
  clearAttachments,
  getAttachments,
  updateContextDraft,
  saveContextDraft,
  updateSettings,
  renameSession
} from './storage.js';
import * as UI from './ui.js';
import {
  runPrompt,
  summarizeActiveTab,
  cancelGeneration,
  speakText,
  refreshAvailability,
  resetModel,
  runRewriter,
  runSummarizer,
  runTranslator,
  runImageDescription,
  isSomethingRunning
} from './model.js';
import { fetchContext, classifyIntent } from './context.js';
import { resizeImage, debounce } from './utils.js';
import { toast } from './toast.js';
import {
  TIMING,
  LIMITS,
  UI_MESSAGES,
  USER_ERROR_MESSAGES,
  INTENT_TYPES
} from './constants.js';

let recognition;
let recognizing = false;
let tabListenersAttached = false;
let confirmingDeleteId = null;

/**
 * Listen for context menu commands from background script
 */
chrome.runtime.onMessage.addListener((req) => {
  if (req.action === 'CMD_SUMMARIZE') {
    runPrompt({ text: `Summarize this:\n${req.text}`, contextOverride: '', attachments: [] });
  }
  else if (req.action === 'CMD_REWRITE') {
    runRewriter(req.text, 'more-formal');
  }
  else if (req.action === 'CMD_TRANSLATE') {
    runTranslator(req.text);
  }
  else if (req.action === 'CMD_DESCRIBE_IMAGE') {
    runImageDescription(req.url);
  }
});

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

    if (ctx.isRestricted) {
      UI.setRestrictedState(true);
    } else {
      UI.setRestrictedState(false);
    }

    // TAB SWITCH FIX: Restore stop button state after tab change
    // This ensures stop button stays enabled if narration/generation is active
    UI.restoreStopButtonState(isSomethingRunning());

    updateContextDraft(text);

    // OPTIMIZATION: Only save when explicitly requested (user-initiated or forced)
    // Auto-refreshes from tab switches don't need to persist
    if (shouldSave) {
      await saveContextDraft(text);
    }

    UI.setContextText(text);
    return text;
  } catch (e) {
    console.warn('Context refresh failed', e);
    toast.error(USER_ERROR_MESSAGES.CONTEXT_FETCH_FAILED);
    return '';
  }
}

/**
 * Set up tab listeners for automatic context synchronization
 */
function ensureTabContextSync() {
  if (tabListenersAttached) return;
  if (!chrome?.tabs?.onActivated) return;

  // PERFORMANCE FIX: Debounce both tab activation and updates
  const debouncedUpdate = debounce(() => {
    refreshContextDraft(false, false);
  }, TIMING.TAB_UPDATE_DEBOUNCE_MS);

  chrome.tabs.onActivated.addListener(() => debouncedUpdate());
  chrome.tabs.onUpdated.addListener((id, info, tab) => {
    if (tab?.active && info.status === 'complete') debouncedUpdate();
  });
  tabListenersAttached = true;
}

/**
 * Initialize the extension and load saved state
 * @returns {Promise<void>}
 */
export async function bootstrap() {
  await loadState();

  UI.updateTemplates(appState.templates);
  UI.renderSessions();
  UI.setContextText(appState.contextDraft);
  UI.renderAttachments(getAttachments());
  UI.renderLog();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mic_setup') === 'true') {
    setTimeout(() => handleMicClick(), TIMING.MIC_SETUP_DELAY_MS);
    return;
  }

  ensureTabContextSync();
  await refreshContextDraft(true);

  // NEW: Signal to Background that UI is ready for commands
  chrome.runtime.sendMessage({ action: 'PANEL_READY' });
}

/**
 * Handle Ask button click - send prompt to AI
 * @returns {Promise<void>}
 */
export async function handleAskClick() {
  const value = UI.getInputValue().trim();
  const text = value || 'Hello';
  const attachments = getAttachments().slice();

  UI.setInputValue('');
  clearAttachments();
  UI.renderAttachments(getAttachments());

  let contextOverride = UI.getContextText();
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
    await runPrompt({ text, contextOverride, attachments });
  } catch (e) {
    console.error('Prompt Execution Failed:', e);
    UI.setStatusText(UI_MESSAGES.ERROR);
    toast.error(USER_ERROR_MESSAGES.AI_SESSION_FAILED);
  }
}

/**
 * Handle Summarize Tab button click
 * @returns {Promise<void>}
 */
export async function handleSummarizeClick() {
  UI.setStatusText(UI_MESSAGES.READING_TAB);
  const freshText = await refreshContextDraft(true);
  await summarizeActiveTab(freshText);
}

/**
 * Handle New Session button click
 * @returns {Promise<void>}
 */
export async function handleNewSessionClick() {
  const session = createSessionFrom();
  setCurrentSession(session.id);
  await saveState();

  resetModel();
  UI.renderSessions();
  UI.renderLog();
  UI.closeMenu('session');
}

/**
 * Handle session deletion with confirmation
 * @param {HTMLElement} btn - Delete button element
 * @param {string} id - Session ID to delete
 * @returns {Promise<void>}
 */
async function deleteSessionHandler(btn, id) {
  if (id === confirmingDeleteId) {
    deleteSession(id);
    confirmingDeleteId = null;
    await saveState();
    UI.renderSessions();
    UI.renderLog();
    resetModel();
    toast.success('Chat deleted');
  } else {
    confirmingDeleteId = id;
    UI.renderSessions(confirmingDeleteId);
    setTimeout(() => {
        if (confirmingDeleteId === id) {
           confirmingDeleteId = null;
           UI.renderSessions();
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
  const session = appState.sessions[id];
  const newTitle = prompt(UI_MESSAGES.RENAME_CHAT, session.title);
  if (newTitle) {
      renameSession(id, newTitle);
      await saveState();
      UI.renderSessions();
      toast.success('Chat renamed');
  }
}

/**
 * Handle session switch
 * @param {HTMLElement} row - Session row element
 * @returns {Promise<void>}
 */
async function switchSessionHandler(row) {
  const id = row.dataset.id;
  setCurrentSession(id);
  UI.highlightSession(id);
  await saveState();
  resetModel();
  UI.closeMenu('session');
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
  const text = UI.getPlaintext(appState.currentSessionId);
  if (!text) return;
  await navigator.clipboard.writeText(text);
  UI.setStatusText(UI_MESSAGES.COPIED);
  toast.success(UI_MESSAGES.COPIED);
  setTimeout(() => UI.setStatusText(UI_MESSAGES.READY), 1500);
}

/**
 * Handle Save Markdown button click
 */
export function handleSaveMarkdown() {
  const md = UI.getSessionMarkdown(appState.currentSessionId);
  if (!md) return;
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-export-${Date.now()}.md`;
  a.click();
  toast.success('Chat exported');
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
    if (UI.isModalOpen()) UI.closeModal();
    return;
  }
  if (event.key === 'Tab') {
    const openModal = document.querySelector('.modal:not([hidden])');
    const container = openModal || document.body;
    UI.trapFocus(event, container);
  }
}

/**
 * Handle modal backdrop/close button clicks
 * @param {MouseEvent} event - Click event
 */
export function handleModalClick(event) {
  const btn = event.target.closest('[data-dismiss="modal"]');
  const backdrop = event.target.classList.contains('modal-backdrop');
  if (btn || backdrop) UI.closeModal();
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
  if (btn.classList.contains('bubble-copy')) {
      const msg = getCurrentSession().messages[idx];
      if(msg) {
        await navigator.clipboard.writeText(msg.text);
        toast.success('Message copied');
      }
  } else if (btn.classList.contains('speak')) {
      const msg = getCurrentSession().messages[idx];
      if(msg) speakText(msg.text);
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
  UI.setInputValue(UI.getInputValue() + text);
  UI.closeMenu('templates');
  document.getElementById('in')?.focus();
}

/**
 * Handle attach button click
 */
export function handleAttachClick() {
  document.getElementById('file-input')?.click();
}

/**
 * Handle file input change - process and attach images
 * @param {Event} event - Change event
 */
export function handleFileInputChange(event) {
  const files = Array.from(event.target.files || []);
  files.slice(0, LIMITS.MAX_ATTACHMENTS).forEach(async file => {
      try {
        const data = await resizeImage(file, LIMITS.IMAGE_MAX_WIDTH);
        addAttachment({ name: file.name, type: file.type, data });
        UI.renderAttachments(getAttachments());
      } catch (e) {
        console.error('Image processing failed', e);
        toast.error(USER_ERROR_MESSAGES.IMAGE_PROCESSING_FAILED);
      }
  });
  event.target.value = '';
}

/**
 * Handle attachment chip click - remove attachment
 * @param {MouseEvent} event - Click event
 */
export function handleAttachmentListClick(event) {
  const target = event.target.closest('.attachment-chip');
  if (target) {
      clearAttachments();
      UI.renderAttachments(getAttachments());
  }
}

/**
 * Handle microphone button click - start/stop voice input
 */
export function handleMicClick() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) {
      toast.error(USER_ERROR_MESSAGES.SPEECH_NOT_SUPPORTED);
      return;
    }

    if (recognizing) {
      // CLEANUP FIX: Properly stop and cleanup recognition
      if (recognition) {
        recognition.stop();
        recognition = null;
      }
      return;
    }

    recognition = new Speech();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => { recognizing = true; UI.setMicState(true); };
    recognition.onend = () => {
      recognizing = false;
      UI.setMicState(false);
      // MEMORY LEAK FIX: Clear recognition reference when done
      recognition = null;
    };
    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      recognizing = false;
      UI.setMicState(false);
      // CLEANUP: Clear reference on error
      recognition = null;
      toast.error(USER_ERROR_MESSAGES.SPEECH_FAILED);
    };
    recognition.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; ++i) t += e.results[i][0].transcript;
        UI.setInputValue(t);
    };

    try {
      recognition.start();
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
      recognition = null;
      recognizing = false;
      UI.setMicState(false);
      toast.error(USER_ERROR_MESSAGES.SPEECH_FAILED);
    }
}

/**
 * Handle speak last AI response button click
 */
export function handleSpeakLast() {
    const msgs = getCurrentSession().messages;
    const last = [...msgs].reverse().find(m => m.role === 'ai');
    if (last) speakText(last.text);
}

/**
 * Handle stop button click - cancel generation/speech
 */
export function handleStopClick() {
  cancelGeneration();
}

/**
 * Handle context toggle button click
 * @returns {Promise<void>}
 */
export async function handleToggleContext() {
  UI.openContextModal();
  await refreshContextDraft(false);
}

/**
 * Handle context textarea input - update in-memory state
 * @param {Event} event - Input event
 */
export function handleContextInput(event) {
  const text = event.target.value;
  updateContextDraft(text);
}

/**
 * Handle context textarea blur - save to storage
 * @param {Event} event - Blur event
 * @returns {Promise<void>}
 */
export async function handleContextBlur(event) {
  const text = event.target.value;
  await saveContextDraft(text);
}

/**
 * Handle settings button click - open settings modal
 */
export function handleOpenSettings() {
  UI.openSettingsModal();
  document.getElementById('temperature').value = appState.settings.temperature;
  document.getElementById('topk').value = appState.settings.topK;
  document.getElementById('system-prompt').value = appState.settings.systemPrompt;
}

/**
 * Handle settings close button click
 */
export function handleCloseSettings() {
  UI.closeModal();
}

/**
 * Handle settings save button click
 * @returns {Promise<void>}
 */
export async function handleSaveSettings() {
    const temp = document.getElementById('temperature').value;
    const topk = document.getElementById('topk').value;
    const sys = document.getElementById('system-prompt').value;

    updateSettings({ temperature: Number(temp), topK: Number(topk), systemPrompt: sys });
    await saveState();

    // FIXED: Force model reset so new settings apply immediately
    resetModel();

    UI.closeModal();
    await refreshAvailability();
    toast.success('Settings saved');
}

import {
  appState,
  loadState,
  saveState,
  createSessionFrom,
  deleteSession,
  setCurrentSession,
  getCurrentSessionSync,
  clearPendingAttachments,
  getPendingAttachments,
  updateContextDraft,
  saveContextDraft,
  renameSession,
  searchSessions,
  summarizeSession,
  BLANK_TEMPLATE_ID,
  addContextSnapshot,
  getContextSnapshotById,
  getActiveSnapshot,
  removeContextSnapshot,
  setActiveSnapshot
} from './storage.js';
import * as UI from './ui.js';
import {
  runPrompt,
  summarizeActiveTab,
  cancelGeneration,
  speakText,
  resetModel,
  isSomethingRunning
} from './model.js';
import { fetchContext, classifyIntent } from './context.js';
import { debounce } from './utils.js';
import { toast } from './toast.js';
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
let sessionSearchTerm = '';
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

    UI.setRestrictedState(Boolean(ctx?.isRestricted));

    UI.restoreStopButtonState(isSomethingRunning());

    updateContextDraft(text);

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

  const debouncedUpdate = debounce(() => {
    refreshContextDraft(false, false);
  }, TIMING.TAB_UPDATE_DEBOUNCE_MS);

  chrome.tabs.onActivated.addListener(() => debouncedUpdate());
  chrome.tabs.onUpdated.addListener((id, info, tab) => {
    if (tab?.active && info.status === 'complete') debouncedUpdate();
  });
  tabListenersAttached = true;
}

function renderSessionsList(confirmingId = null) {
  const current = getCurrentSessionSync();
  const matches = searchSessions(sessionSearchTerm);
  UI.renderSessions({
    sessions: appState.sessions,
    sessionMeta: appState.sessionMeta,
    currentSessionId: appState.currentSessionId,
    currentTitle: current?.title,
    matches,
    searchTerm: sessionSearchTerm,
    confirmingId
  });
}

function renderLogForCurrent() {
  UI.renderLog(getCurrentSessionSync());
}

function renderContextUI() {
  UI.renderContextSnapshots(appState.contextSnapshots, appState.activeSnapshotId);
  UI.setContextSourceLabel(getActiveSnapshot());
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
  const session = appState.sessions[sessionId];
  if (!session) return '';
  return session.messages.map(m => `### ${m.role === 'user' ? 'User' : 'Nano'}\n${m.text}`).join('\n\n');
}

function getSessionPlaintext(sessionId) {
  return summarizeSession(sessionId);
}

async function applySnapshot(snapshot, { announce = false } = {}) {
  if (!snapshot) return;
  setActiveSnapshot(snapshot.id);
  UI.setContextText(snapshot.text);
  updateContextDraft(snapshot.text);
  await saveContextDraft(snapshot.text);
  UI.setRestrictedState(false);
  renderContextUI();
  await saveState();
  if (announce) toast.success('Using saved context');
}

async function applySnapshotById(id) {
  if (!id) return;
  const snapshot = getContextSnapshotById(id);
  if (!snapshot) return;
  await applySnapshot(snapshot, { announce: true });
}

async function handleDeleteSnapshot(id) {
  if (!id) return;
  const wasActive = appState.activeSnapshotId === id;
  const removed = removeContextSnapshot(id);
  if (!removed) return;

  if (wasActive) {
    const fallback = appState.contextSnapshots[0];
    if (fallback) {
      await applySnapshot(fallback);
    } else {
      await useLiveContext({ quiet: true });
    }
  } else {
    renderContextUI();
    await saveState();
  }
  toast.success('Snapshot deleted');
}

async function useLiveContext({ quiet = false } = {}) {
  if (isSnapshotBusy) return;
  isSnapshotBusy = true;
  try {
    setActiveSnapshot(null);
    renderContextUI();

    const liveCtx = await fetchContext(true, { respectSnapshot: false });
    const liveText = liveCtx?.text || '';
    UI.setContextText(liveText);
    updateContextDraft(liveText);
    await saveContextDraft(liveText);
    UI.setRestrictedState(Boolean(liveCtx?.isRestricted));

    await saveState();
    if (!quiet) toast.success('Live tab context restored');
  } catch (e) {
    console.warn('Failed to refresh live context', e);
    toast.error('Could not refresh live context.');
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
      toast.error('Context not available on this page.');
      return;
    }

    const snapshot = addContextSnapshot({
      title: clampLabel(ctx.title || getSnapshotHost(ctx.url)),
      url: ctx.url || '',
      text: ctx.text,
      createdAt: Date.now()
    });

    if (snapshot) {
      await applySnapshot(snapshot, { announce: true });
    } else {
      toast.error('Could not save context snapshot.');
    }
  } catch (e) {
    console.warn('Snapshot save failed', e);
    toast.error('Failed to save context snapshot.');
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
  await loadState();

  UI.applyTheme(getSettingOrDefault(appState.settings, 'theme'));

  sessionSearchTerm = UI.getSessionSearchValue();

  UI.updateTemplates(appState.templates, BLANK_TEMPLATE_ID);
  renderSessionsList();
  UI.setContextText(appState.contextDraft);
  UI.renderPendingAttachments(getPendingAttachments());
  renderLogForCurrent();
  renderContextUI();

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
 * Handle Ask button click - send prompt to AI
 * @returns {Promise<void>}
 */
export async function handleAskClick(overrideText = null) {
  if (overrideText?.preventDefault) overrideText.preventDefault();

  const rawInput = typeof overrideText === 'string' ? overrideText : UI.getInputValue();
  const text = (rawInput || '').trim() || 'Hello';
  const attachments = getPendingAttachments().slice();

  UI.setInputValue('');
  clearPendingAttachments();
  UI.renderPendingAttachments(getPendingAttachments());

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

  cancelGeneration();
  resetModel(session.id);
  renderSessionsList();
  renderLogForCurrent();
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
    renderSessionsList();
    renderLogForCurrent();
    cancelGeneration();
    resetModel(id);
    toast.success('Chat deleted');
  } else {
    confirmingDeleteId = id;
    renderSessionsList(confirmingDeleteId);
    setTimeout(() => {
        if (confirmingDeleteId === id) {
           confirmingDeleteId = null;
           renderSessionsList();
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
      renderSessionsList();
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
  await saveState();
  cancelGeneration();
  renderSessionsList();
  renderLogForCurrent();
  UI.closeMenu('session');
}

/**
 * Handle session search input
 * @param {InputEvent} event - Input event
 */
export function handleSessionSearchInput(event) {
  sessionSearchTerm = event.target.value || '';
  UI.setSessionSearchTerm(sessionSearchTerm);
  renderSessionsList();
}

export function handleSessionTriggerClick(event) {
  event.stopPropagation();
  UI.toggleMenu('session');
}

export function handleTemplatesTriggerClick(event) {
  event.stopPropagation();
  UI.toggleMenu('templates');
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
  const text = getSessionPlaintext(appState.currentSessionId);
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
  const md = getSessionMarkdown(appState.currentSessionId);
  if (!md) return;
  const blob = new Blob([md], { type: 'text/markdown' });
  UI.downloadBlob(blob, `chat-export-${Date.now()}.md`);
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
    const container = UI.getTrapContainer();
    UI.trapFocus(event, container);
  }
}

export function handleDocumentClick(event) {
  if (!event.target.closest('#templates-dropdown')) UI.closeMenu('templates');
  if (!event.target.closest('#session-dropdown')) UI.closeMenu('session');
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
      const msg = getCurrentSessionSync().messages[idx];
      if(msg) {
        await navigator.clipboard.writeText(msg.text);
        toast.success('Message copied');
      }
  } else if (btn.classList.contains('speak')) {
      const msg = getCurrentSessionSync().messages[idx];
      if(msg) speakText(msg.text);
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
  UI.setInputValue(UI.getInputValue() + text);
  UI.closeMenu('templates');
  UI.focusInput();
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
      recognition = null;
    };
    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      recognizing = false;
      UI.setMicState(false);
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
    const msgs = getCurrentSessionSync().messages;
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
  renderContextUI();
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

/**
 * Chat Handlers - UI Event Handlers
 *
 * Handles user interactions and dispatches to controller.
 * Does NOT directly access storage or model - only through controller.
 *
 * This file re-exports from modular handler files and contains
 * remaining shared handlers for bootstrap, navigation, and misc UI.
 */

import * as Controller from '../controller/controller.js';
import * as Model from '../core/model.js';
import * as Storage from '../core/storage.js';
import * as UI from '../ui/index.js';
import { fetchContext } from '../core/context.js';
import { debounce } from '../utils/utils.js';
import {
  TIMING,
  UI_MESSAGES,
  getSettingOrDefault
} from '../config/constants.js';
import { registerContextMenuHandlers } from './context-menu-handlers.js';
import { getModelStatusSummary } from '../core/setup-guide.js';

// Re-export all handlers from modular files
export * from './session-handlers.js';
export * from './template-handlers.js';
export * from './snapshot-handlers.js';
export * from './voice-handlers.js';
export * from './prompt-handlers.js';

// Import for local use
import { isTemplateEditingActive, cancelTemplateEdit } from './template-handlers.js';
import { isSessionEditingActive, cancelInlineRename } from './session-handlers.js';
import { handleMicClick } from './voice-handlers.js';
import { refreshContextDraft, handleAskClick } from './prompt-handlers.js';

let tabListenersAttached = false;

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

/**
 * Initialize the extension and load saved state
 * @returns {Promise<void>}
 */
export async function bootstrap() {
  registerContextMenuHandlers();

  // Load state from storage module
  await Storage.loadState();

  Controller.applyTheme(getSettingOrDefault(Storage.getSettings(), 'theme'));

  Controller.setSessionSearchTerm(Controller.getSessionSearchTerm());

  // Initialize templates UI
  UI.updateTemplates(Storage.getTemplates(), Storage.BLANK_TEMPLATE_ID);

  Controller.renderSessionsList();
  Controller.setContextText(Storage.getContextDraft());
  UI.renderPendingAttachments(Storage.getPendingAttachments());
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
 * Prime the model when the input gains focus (warm VRAM cache).
 */
export function handleInputFocus() {
  const primeFn = Model.prime || Model.primeModel;
  if (typeof primeFn === 'function') {
    primeFn().catch(() => {});
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
  if (!event.target.closest('#templates-dropdown')) {
    Controller.closeMenu('templates');
    // Cancel template editing when clicking outside templates dropdown
    if (isTemplateEditingActive()) {
      cancelTemplateEdit();
    }
  }
  if (!event.target.closest('#session-dropdown')) {
    Controller.closeMenu('session');
    // Cancel inline rename when clicking outside session dropdown
    if (isSessionEditingActive()) {
      cancelInlineRename();
    }
  }
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
    if (msg) {
      await navigator.clipboard.writeText(msg.text);
      Controller.showToast('success', 'Message copied');
    }
  } else if (btn.classList.contains('speak')) {
    const msg = session.messages[idx];
    if (msg) {
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

// --- AVAILABILITY (called from sidepanel.js) ---

/**
 * Deferred startup handler for tab switches or late availability checks.
 * @returns {Promise<void>}
 */
export async function handleDeferredStartup() {
  try {
    const availability = await Model.checkAvailability({ forceCheck: true });

    if (availability?.status === 'readily') {
      const status = await getModelStatusSummary('readily');
      Controller.updateModelStatusChip(status);
      Controller.setStatus(UI_MESSAGES.READY);
      return;
    }

    if (availability?.status === 'after-download') {
      await Model.ensureModelDownloaded((loaded, total) => {
        const ratio = total ? loaded / total : 0;
        const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
        Controller.setStatus(`Downloading model... ${percent}%`);
      });
      const status = await getModelStatusSummary('readily');
      Controller.updateModelStatusChip(status);
      Controller.setStatus(UI_MESSAGES.READY);
    }
  } catch (e) {
    console.warn('Deferred startup failed', e);
  }
}

/**
 * Refresh AI availability status
 * @param {{forceCheck?: boolean}} options
 * @returns {Promise<{status: string, checkedAt: number, diag: object}>}
 */
export async function refreshAvailability({ forceCheck = false } = {}) {
  const result = await Model.checkAvailability({
    forceCheck,
    cachedAvailability: Controller.getAvailability(),
    cachedCheckedAt: Controller.getAvailabilityCheckedAt()
  });

  Controller.updateAvailabilityDisplay(result.status, result.checkedAt, result.diag);

  // Update model status chip with diagnostic summary
  try {
    const modelStatus = await getModelStatusSummary(result.status);
    Controller.updateModelStatusChip(modelStatus);
  } catch (e) {
    console.warn('Failed to get model status summary:', e);
  }

  return result;
}

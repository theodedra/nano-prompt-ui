/**
 * Message Controller
 * 
 * Handles message operations: adding, updating, and persisting messages.
 */

import {
  getCurrentSessionSync,
  upsertMessage,
  updateMessage,
  scheduleSaveState,
  flushSaveState
} from '../storage.js';
import * as UI from '../ui/index.js';

/**
 * Add a message to a session
 * @param {string} sessionId
 * @param {{role: string, text: string, ts: number, attachments?: Array}} message
 */
export function addMessage(sessionId, message) {
  upsertMessage(sessionId, message);
}

/**
 * Patch/update a message in a session
 */
export function patchMessage(sessionId, index, patch) {
  updateMessage(sessionId, index, patch);
}

/**
 * Persist current state (debounced by default)
 * @param {{immediate?: boolean}} options - Set immediate: true for critical saves
 */
export async function persistState({ immediate = false } = {}) {
  if (immediate) {
    await flushSaveState();
  } else {
    scheduleSaveState();
  }
}

/**
 * Update the last message bubble in the UI (streaming or final)
 * @param {string} text
 * @param {{streaming?: boolean}} options
 */
export function updateLastBubble(text, options = {}) {
  const session = getCurrentSessionSync();
  UI.updateLastMessageBubble(session, text, options);
}

/**
 * Refresh the chat log
 */
export function refreshLog() {
  const session = getCurrentSessionSync();
  UI.renderLog(session);
}

/**
 * Render the current log
 */
export function renderCurrentLog() {
  UI.renderLog(getCurrentSessionSync());
}

/**
 * Session Handlers - Session management UI event handlers
 *
 * Handles session switching, renaming, deletion, and search.
 */

import * as Controller from '../controller/controller.js';
import * as Model from '../core/model.js';
import { debounce } from '../utils/utils.js';
import { TIMING } from '../config/constants.js';

// ============================================================================
// STATE MACHINES - Encapsulated state with explicit transitions
// ============================================================================

/**
 * Delete confirmation state machine.
 * Manages the two-click delete flow with auto-cancel timeout.
 */
const deleteConfirmation = {
  sessionId: null,
  timeoutId: null,
  
  /**
   * Start confirmation for a session (first click)
   * @param {string} id - Session ID to confirm deletion for
   */
  start(id) {
    this.cancel(); // Clear any existing confirmation
    this.sessionId = id;
    this.timeoutId = setTimeout(() => {
      this.sessionId = null;
      this.timeoutId = null;
      Controller.renderSessionsList();
    }, TIMING.DELETE_CONFIRM_TIMEOUT_MS);
  },
  
  /**
   * Cancel any pending confirmation
   */
  cancel() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.sessionId = null;
  },
  
  /**
   * Check if a specific session is awaiting confirmation
   * @param {string} id - Session ID to check
   * @returns {boolean}
   */
  isConfirming(id) {
    return this.sessionId === id;
  },
  
  /**
   * Get the currently confirming session ID
   * @returns {string|null}
   */
  getCurrentId() {
    return this.sessionId;
  }
};

/**
 * Inline edit state machine.
 * Manages the session rename editing state.
 */
const editState = {
  sessionId: null,
  
  /**
   * Start editing a session
   * @param {string} id - Session ID to edit
   */
  start(id) {
    this.sessionId = id;
  },
  
  /**
   * Cancel editing
   */
  cancel() {
    this.sessionId = null;
  },
  
  /**
   * Check if a specific session is being edited
   * @param {string} id - Session ID to check
   * @returns {boolean}
   */
  isEditing(id) {
    return this.sessionId === id;
  },
  
  /**
   * Check if any session is being edited
   * @returns {boolean}
   */
  isActive() {
    return this.sessionId !== null;
  },
  
  /**
   * Get the currently editing session ID
   * @returns {string|null}
   */
  getCurrentId() {
    return this.sessionId;
  }
};

// Debounced session search to avoid excessive re-renders
const debouncedSessionSearch = debounce((value) => {
  Controller.setSessionSearchTerm(value || '');
  Controller.renderSessionsList();
}, 150);

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
export async function deleteSessionHandler(btn, id) {
  if (deleteConfirmation.isConfirming(id)) {
    // Second click - execute deletion
    deleteConfirmation.cancel();
    Model.cancelGeneration();
    Model.resetModel(id);
    await Controller.removeSession(id);
  } else {
    // First click - start confirmation
    deleteConfirmation.start(id);
    Controller.renderSessionsList(deleteConfirmation.getCurrentId());
  }
}

/**
 * Start inline rename for a session
 * @param {string} id - Session ID to rename
 */
export function startInlineRename(id) {
  editState.start(id);
  Controller.renderSessionsList(null, editState.getCurrentId());
}

/**
 * Cancel inline rename
 */
export function cancelInlineRename() {
  editState.cancel();
  Controller.renderSessionsList();
}

/**
 * Save inline rename
 * @param {string} id - Session ID
 * @param {string} newTitle - New title from input
 * @returns {Promise<void>}
 */
export async function saveInlineRename(id, newTitle) {
  editState.cancel();
  const trimmed = (newTitle || '').trim();
  if (trimmed) {
    await Controller.renameSessionById(id, trimmed);
  } else {
    // Empty title - just re-render without saving
    Controller.renderSessionsList();
  }
}

/**
 * Handle session switch
 * @param {HTMLElement} row - Session row element
 * @returns {Promise<void>}
 */
export async function switchSessionHandler(row) {
  const id = row.dataset.id;
  Model.cancelGeneration();
  await Controller.switchSession(id);
}

/**
 * Handle session search input
 * @param {InputEvent} event - Input event
 */
export function handleSessionSearchInput(event) {
  debouncedSessionSearch(event.target.value);
}

/**
 * Handle session trigger click (open/close session menu)
 * @param {MouseEvent} event - Click event
 */
export function handleSessionTriggerClick(event) {
  event.stopPropagation();
  Controller.toggleMenu('session');
}

/**
 * Handle session menu interactions (switch, rename, delete)
 * @param {Event} event - Click event
 * @returns {Promise<void>}
 */
export async function handleSessionMenuClick(event) {
  const btn = event.target.closest('button');
  const row = event.target.closest('.session-row');
  const input = event.target.closest('.session-rename-input');

  // If clicking on rename input, don't bubble to row switch
  if (input) {
    event.stopPropagation();
    return;
  }

  if (btn && btn.classList.contains('action-btn')) {
    event.stopPropagation();
    const id = btn.dataset.id;

    // Handle inline rename save/cancel
    if (btn.dataset.action === 'save-rename') {
      const inputEl = row?.querySelector('.session-rename-input');
      const newTitle = inputEl?.value || '';
      await saveInlineRename(id, newTitle);
      return;
    }

    if (btn.dataset.action === 'cancel-rename') {
      cancelInlineRename();
      return;
    }

    if (btn.classList.contains('delete')) {
      await deleteSessionHandler(btn, id);
    } else if (btn.classList.contains('edit')) {
      startInlineRename(id);
    }
    return;
  }

  // Don't switch session if we're currently editing
  if (editState.isActive()) {
    return;
  }

  if (row) await switchSessionHandler(row);
}

/**
 * Handle keyboard events on rename input
 * @param {KeyboardEvent} event - Keyboard event
 * @returns {Promise<void>}
 */
export async function handleRenameInputKeyDown(event) {
  const input = event.target.closest('.session-rename-input');
  if (!input) return;

  const id = input.dataset.id;

  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    await saveInlineRename(id, input.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancelInlineRename();
  }
}

/**
 * Check if session editing is in progress
 * @returns {boolean}
 */
export function isSessionEditingActive() {
  return editState.isActive();
}

/**
 * Get currently editing session ID
 * @returns {string|null}
 */
export function getEditingSessionId() {
  return editState.getCurrentId();
}

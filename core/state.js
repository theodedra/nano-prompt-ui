/**
 * Unified State Manager
 * 
 * Centralized state management for the entire application.
 * Provides a single source of truth for all application state with clear
 * separation between persistent and transient state.
 * 
 * State Categories:
 * - Persistent: Saved to storage (IndexedDB/chrome.storage)
 * - Transient UI: UI-only state that doesn't persist
 * - UI Runtime: DOM references, observers, callbacks
 * - Session: Session management state
 */

import { DEFAULT_TEMPLATES, DEFAULT_SETTINGS, UI_MESSAGES } from '../config/constants.js';

// ============================================================================
// SESSION MANAGER
// ============================================================================

/**
 * SessionManager class - Encapsulates all session-related state and operations
 */
class SessionManager {
  constructor() {
    this.sessions = new Map(); // Loaded sessions (full data)
    this.sessionMeta = new Map(); // Session metadata only (id, title, timestamp)
    this.sessionOrder = [];
    this.currentId = null;
    this.lazyLoadEnabled = true; // Enable lazy loading when MAX_SESSIONS is high
    this.dirtySessions = new Set(); // Track sessions that need to be saved
  }

  /**
   * Get all loaded sessions as an object
   * @returns {Object<string, object>}
   */
  getSessions() {
    const result = {};
    this.sessions.forEach((session, id) => {
      result[id] = session;
    });
    return result;
  }

  /**
   * Get session metadata as an object
   * @returns {Object<string, object>}
   */
  getSessionMeta() {
    const result = {};
    this.sessionMeta.forEach((meta, id) => {
      result[id] = meta;
    });
    return result;
  }

  /**
   * Get current session ID
   * @returns {string|null}
   */
  getCurrentId() {
    return this.currentId;
  }

  /**
   * Set current session ID
   * @param {string|null} id
   */
  setCurrentId(id) {
    this.currentId = id;
  }

  /**
   * Get session by ID
   * @param {string} id
   * @returns {object|undefined}
   */
  getSession(id) {
    return this.sessions.get(id);
  }

  /**
   * Set session by ID
   * @param {string} id
   * @param {object} session
   */
  setSession(id, session) {
    this.sessions.set(id, session);
  }

  /**
   * Delete session by ID
   * @param {string} id
   */
  deleteSession(id) {
    this.sessions.delete(id);
    this.sessionMeta.delete(id);
    this.dirtySessions.delete(id);
  }

  /**
   * Get session metadata by ID
   * @param {string} id
   * @returns {object|undefined}
   */
  getMeta(id) {
    return this.sessionMeta.get(id);
  }

  /**
   * Set session metadata by ID
   * @param {string} id
   * @param {object} meta
   */
  setMeta(id, meta) {
    this.sessionMeta.set(id, meta);
  }

  /**
   * Mark session as dirty (needs saving)
   * @param {string} id
   */
  markDirty(id) {
    this.dirtySessions.add(id);
  }

  /**
   * Clear all dirty sessions
   */
  clearDirty() {
    this.dirtySessions.clear();
  }

  /**
   * Get all dirty session IDs
   * @returns {Set<string>}
   */
  getDirtySessions() {
    return this.dirtySessions;
  }

  /**
   * Check if session exists (in sessions or metadata)
   * @param {string} id
   * @returns {boolean}
   */
  hasSession(id) {
    return this.sessions.has(id) || this.sessionMeta.has(id);
  }
}

// ============================================================================
// STATE DEFINITIONS
// ============================================================================

/**
 * Persistent State - Saved to storage (IndexedDB/chrome.storage)
 */
const persistentState = {
  templates: DEFAULT_TEMPLATES.slice(),
  pendingAttachments: [], // Attachments queued for the next message only
  contextDraft: '',
  contextSnapshots: [], // Saved page contexts
  activeSnapshotId: null, // Currently applied snapshot id
  availability: 'unknown',
  availabilityCheckedAt: null,
  settings: { ...DEFAULT_SETTINGS },
  model: null
};

/**
 * Transient UI State - UI-only state that doesn't persist
 */
const transientUIState = {
  sessionSearchTerm: '',
  editingSessionId: null,
  confirmingDeleteId: null,
  editingTemplateId: null,
  isAddingNewTemplate: false
};

/**
 * UI Runtime State - DOM references, observers, callbacks
 */
const uiRuntimeState = {
  lastStatus: UI_MESSAGES.CHECKING,
  isSystemBusy: false,
  currentModelStatus: null,
  els: {}, // DOM element references
  wrapEl: null,
  chatCardEl: null,
  inputCardEl: null,
  scrollObserver: null,
  virtualScroller: null,
  sessionVirtualScroller: null,
  openSetupGuideModalCallback: null,
  buildContextSnapshotUICallback: null,
  createMessageElementCallback: null
};

/**
 * Session State - Managed by SessionManager
 */
const sessionManager = new SessionManager();

// ============================================================================
// STATE API - Persistent State
// ============================================================================

/** @returns {object[]} Template list */
export function getTemplates() {
  return persistentState.templates;
}

/**
 * Replace templates array
 * @param {object[]} templates
 */
export function setTemplates(templates) {
  persistentState.templates = templates;
}

/** @returns {string} Current context draft text */
export function getContextDraft() {
  return persistentState.contextDraft;
}

/**
 * Update context draft in memory only
 * @param {string} text - Context text
 */
export function updateContextDraft(text) {
  persistentState.contextDraft = text;
}

/** @returns {object[]} Saved context snapshots */
export function getContextSnapshots() {
  return persistentState.contextSnapshots;
}

/**
 * Set context snapshots
 * @param {object[]} snapshots
 */
export function setContextSnapshots(snapshots) {
  persistentState.contextSnapshots = Array.isArray(snapshots) ? snapshots : [];
}

/** @returns {string|null} Active snapshot ID */
export function getActiveSnapshotId() {
  return persistentState.activeSnapshotId;
}

/**
 * Mark a snapshot as active (or clear with null)
 * @param {string|null} id - Snapshot id to activate or null to clear
 */
export function setActiveSnapshotId(id) {
  persistentState.activeSnapshotId = id || null;
}

/** @returns {string} AI availability status */
export function getAvailability() {
  return persistentState.availability;
}

/**
 * Update availability status
 * @param {string} status
 */
export function setAvailability(status) {
  persistentState.availability = status || 'unknown';
}

/** @returns {number|null} Timestamp of last availability check */
export function getAvailabilityCheckedAt() {
  return persistentState.availabilityCheckedAt;
}

/**
 * Update availability check timestamp
 * @param {number|null} timestamp
 */
export function setAvailabilityCheckedAt(timestamp) {
  persistentState.availabilityCheckedAt = timestamp || null;
}

/**
 * Check if we have cached availability data
 * @returns {boolean} Whether cached availability data exists
 */
export function hasCachedAvailability() {
  const availability = getAvailability();
  return Boolean(
    availability &&
    availability !== 'unknown' &&
    getAvailabilityCheckedAt()
  );
}

/** @returns {object} Current settings */
export function getSettings() {
  return persistentState.settings;
}

/**
 * Update settings with a patch object
 * @param {object} patch - Settings to update
 */
export function updateSettings(patch) {
  persistentState.settings = { ...persistentState.settings, ...patch };
}

/**
 * Get the model state
 * @returns {object|null}
 */
export function getModel() {
  return persistentState.model;
}

/**
 * Set the model state
 * @param {object|null} model
 */
export function setModel(model) {
  persistentState.model = model;
}

/**
 * Add an attachment to the current attachments list
 * @param {{name: string, type: string, data: string}} entry - Attachment object
 */
export function addPendingAttachment(entry) {
  persistentState.pendingAttachments.push(entry);
}

/**
 * Clear all attachments
 */
export function clearPendingAttachments() {
  persistentState.pendingAttachments = [];
}

/**
 * Get current attachments list
 * @returns {Array<{name: string, type: string, data: string}>} Attachments
 */
export function getPendingAttachments() {
  return persistentState.pendingAttachments;
}

/**
 * Remove a specific pending attachment by index
 * @param {number} index - Attachment index to remove
 */
export function removePendingAttachment(index) {
  if (index < 0 || index >= persistentState.pendingAttachments.length) return;
  persistentState.pendingAttachments.splice(index, 1);
}

// ============================================================================
// STATE API - Transient UI State
// ============================================================================

/** @returns {string} Session search term */
export function getSessionSearchTerm() {
  return transientUIState.sessionSearchTerm;
}

/**
 * Set session search term
 * @param {string} term
 */
export function setSessionSearchTerm(term) {
  transientUIState.sessionSearchTerm = term || '';
}

/** @returns {string|null} Currently editing session ID */
export function getEditingSessionId() {
  return transientUIState.editingSessionId;
}

/**
 * Set editing session ID
 * @param {string|null} id
 */
export function setEditingSessionId(id) {
  transientUIState.editingSessionId = id || null;
}

/** @returns {string|null} Session ID awaiting delete confirmation */
export function getConfirmingDeleteId() {
  return transientUIState.confirmingDeleteId;
}

/**
 * Set confirming delete ID
 * @param {string|null} id
 */
export function setConfirmingDeleteId(id) {
  transientUIState.confirmingDeleteId = id || null;
}

/** @returns {string|null} Currently editing template ID */
export function getEditingTemplateId() {
  return transientUIState.editingTemplateId;
}

/**
 * Set editing template ID
 * @param {string|null} id
 */
export function setEditingTemplateId(id) {
  transientUIState.editingTemplateId = id || null;
}

/** @returns {boolean} Whether adding a new template */
export function getIsAddingNewTemplate() {
  return transientUIState.isAddingNewTemplate;
}

/**
 * Set is adding new template flag
 * @param {boolean} value
 */
export function setIsAddingNewTemplate(value) {
  transientUIState.isAddingNewTemplate = Boolean(value);
}

// ============================================================================
// STATE API - UI Runtime State
// ============================================================================

/** @returns {string} Last status text */
export function getLastStatus() {
  return uiRuntimeState.lastStatus;
}

/**
 * Set last status text
 * @param {string} text
 */
export function setLastStatus(text) {
  uiRuntimeState.lastStatus = text;
}

/** @returns {boolean} Whether system is busy */
export function getIsSystemBusy() {
  return uiRuntimeState.isSystemBusy;
}

/**
 * Set system busy state
 * @param {boolean} isBusy
 */
export function setIsSystemBusy(isBusy) {
  uiRuntimeState.isSystemBusy = Boolean(isBusy);
}

/** @returns {object|null} Current model status */
export function getCurrentModelStatus() {
  return uiRuntimeState.currentModelStatus;
}

/**
 * Set current model status
 * @param {object|null} status
 */
export function setCurrentModelStatus(status) {
  uiRuntimeState.currentModelStatus = status;
}

/** @returns {Object} DOM element references */
export function getEls() {
  return uiRuntimeState.els;
}

/**
 * Set DOM element references
 * @param {Object} els
 */
export function setEls(els) {
  uiRuntimeState.els = els;
}

/** @returns {HTMLElement|null} Wrap element */
export function getWrapEl() {
  return uiRuntimeState.wrapEl;
}

/**
 * Set wrap element
 * @param {HTMLElement|null} el
 */
export function setWrapEl(el) {
  uiRuntimeState.wrapEl = el;
}

/** @returns {HTMLElement|null} Chat card element */
export function getChatCardEl() {
  return uiRuntimeState.chatCardEl;
}

/**
 * Set chat card element
 * @param {HTMLElement|null} el
 */
export function setChatCardEl(el) {
  uiRuntimeState.chatCardEl = el;
}

/** @returns {HTMLElement|null} Input card element */
export function getInputCardEl() {
  return uiRuntimeState.inputCardEl;
}

/**
 * Set input card element
 * @param {HTMLElement|null} el
 */
export function setInputCardEl(el) {
  uiRuntimeState.inputCardEl = el;
}

/** @returns {ResizeObserver|null} Scroll observer */
export function getScrollObserver() {
  return uiRuntimeState.scrollObserver;
}

/**
 * Set scroll observer
 * @param {ResizeObserver|null} observer
 */
export function setScrollObserver(observer) {
  uiRuntimeState.scrollObserver = observer;
}

/** @returns {VirtualScroller|null} Virtual scroller */
export function getVirtualScroller() {
  return uiRuntimeState.virtualScroller;
}

/**
 * Set virtual scroller
 * @param {VirtualScroller|null} scroller
 */
export function setVirtualScroller(scroller) {
  uiRuntimeState.virtualScroller = scroller;
}

/** @returns {VirtualScroller|null} Session virtual scroller */
export function getSessionVirtualScroller() {
  return uiRuntimeState.sessionVirtualScroller;
}

/**
 * Set session virtual scroller
 * @param {VirtualScroller|null} scroller
 */
export function setSessionVirtualScroller(scroller) {
  uiRuntimeState.sessionVirtualScroller = scroller;
}

/** @returns {Function|null} Open setup guide modal callback */
export function getOpenSetupGuideModalCallback() {
  return uiRuntimeState.openSetupGuideModalCallback;
}

/**
 * Set open setup guide modal callback
 * @param {Function|null} fn
 */
export function setOpenSetupGuideModalCallback(fn) {
  uiRuntimeState.openSetupGuideModalCallback = fn;
}

/** @returns {Function|null} Build context snapshot UI callback */
export function getBuildContextSnapshotUICallback() {
  return uiRuntimeState.buildContextSnapshotUICallback;
}

/**
 * Set build context snapshot UI callback
 * @param {Function|null} fn
 */
export function setBuildContextSnapshotUICallback(fn) {
  uiRuntimeState.buildContextSnapshotUICallback = fn;
}

/** @returns {Function|null} Create message element callback */
export function getCreateMessageElementCallback() {
  return uiRuntimeState.createMessageElementCallback;
}

/**
 * Set create message element callback
 * @param {Function|null} fn
 */
export function setCreateMessageElementCallback(fn) {
  uiRuntimeState.createMessageElementCallback = fn;
}

// ============================================================================
// STATE API - Session State (via SessionManager)
// ============================================================================

/** @returns {Object<string, object>} All loaded sessions */
export function getSessions() {
  return sessionManager.getSessions();
}

/** @returns {Object<string, object>} Session metadata map */
export function getSessionMeta() {
  return sessionManager.getSessionMeta();
}

/** @returns {string|null} Current active session ID */
export function getCurrentSessionId() {
  return sessionManager.getCurrentId();
}

/**
 * Set current session ID
 * @param {string|null} id
 */
export function setCurrentSessionId(id) {
  sessionManager.setCurrentId(id);
}

/**
 * Get session by ID
 * @param {string} id
 * @returns {object|undefined}
 */
export function getSession(id) {
  return sessionManager.getSession(id);
}

/**
 * Set session by ID
 * @param {string} id
 * @param {object} session
 */
export function setSession(id, session) {
  sessionManager.setSession(id, session);
}

/**
 * Delete session by ID
 * @param {string} id
 */
export function deleteSession(id) {
  sessionManager.deleteSession(id);
}

/**
 * Get session metadata by ID
 * @param {string} id
 * @returns {object|undefined}
 */
export function getSessionMetaById(id) {
  return sessionManager.getMeta(id);
}

/**
 * Set session metadata by ID
 * @param {string} id
 * @param {object} meta
 */
export function setSessionMeta(id, meta) {
  sessionManager.setMeta(id, meta);
}

/**
 * Mark session as dirty (needs saving)
 * @param {string} id
 */
export function markSessionDirty(id) {
  sessionManager.markDirty(id);
}

/**
 * Clear all dirty sessions
 */
export function clearDirtySessions() {
  sessionManager.clearDirty();
}

/**
 * Get all dirty session IDs
 * @returns {Set<string>}
 */
export function getDirtySessions() {
  return sessionManager.getDirtySessions();
}

/**
 * Check if session exists
 * @param {string} id
 * @returns {boolean}
 */
export function hasSession(id) {
  return sessionManager.hasSession(id);
}

/**
 * Get session order array
 * @returns {string[]}
 */
export function getSessionOrder() {
  return sessionManager.sessionOrder;
}

/**
 * Set session order array
 * @param {string[]} order
 */
export function setSessionOrder(order) {
  sessionManager.sessionOrder = order;
}

/**
 * Get lazy load enabled flag
 * @returns {boolean}
 */
export function getLazyLoadEnabled() {
  return sessionManager.lazyLoadEnabled;
}

/**
 * Set lazy load enabled flag
 * @param {boolean} enabled
 */
export function setLazyLoadEnabled(enabled) {
  sessionManager.lazyLoadEnabled = Boolean(enabled);
}

// ============================================================================
// INTERNAL ACCESS (for storage.js persistence layer)
// ============================================================================

/**
 * Get persistent state object (for storage.js persistence)
 * @returns {object} Persistent state
 */
export function getPersistentState() {
  return persistentState;
}

/**
 * Get session manager instance (for storage.js persistence)
 * @returns {SessionManager} Session manager
 */
export function getSessionManager() {
  return sessionManager;
}

// ============================================================================
// BACKWARDS COMPATIBILITY - uiState object
// ============================================================================

/**
 * Get transient UI state object (for backwards compatibility)
 * @returns {object} Transient UI state
 */
export function getTransientUIState() {
  return transientUIState;
}

// Re-export for backwards compatibility
export const uiState = transientUIState;


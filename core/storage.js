import { nanoid, markdownToHtml } from '../utils/utils.js';
import { toast } from '../utils/toast.js';
import {
  STORAGE_KEYS,
  LIMITS,
  DEFAULT_TEMPLATES,
  BLANK_TEMPLATE_ID,
  DEFAULT_SETTINGS,
  VALIDATION,
  USER_ERROR_MESSAGES,
  TIMING
} from '../config/constants.js';

const { DB_NAME, DB_VERSION, STORES } = STORAGE_KEYS;
const SYNC_KEY = STORAGE_KEYS.SYNC;
const SESSION_KEY = STORAGE_KEYS.SESSION_DRAFT;
const MAX_SESSIONS = LIMITS.MAX_SESSIONS;

// Re-export for backwards compatibility
export { BLANK_TEMPLATE_ID, DEFAULT_TEMPLATES };

/**
 * Application state object (internal - use getter/setter API below)
 */
const appState = {
  sessions: {}, // Loaded sessions (full data)
  sessionMeta: {}, // Session metadata only (id, title, timestamp)
  sessionOrder: [],
  currentSessionId: null,
  templates: DEFAULT_TEMPLATES.slice(),
  pendingAttachments: [], // Attachments queued for the next message only
  contextDraft: '',
  contextSnapshots: [], // Saved page contexts
  activeSnapshotId: null, // Currently applied snapshot id
  availability: 'unknown',
  availabilityCheckedAt: null,
  settings: { ...DEFAULT_SETTINGS },
  model: null,
  lazyLoadEnabled: true // Enable lazy loading when MAX_SESSIONS is high
};

// ============================================================================
// STATE API - Encapsulated getters/setters for appState
// ============================================================================

/** @returns {Object<string, object>} All loaded sessions */
export function getSessions() {
  return appState.sessions;
}

/** @returns {Object<string, object>} Session metadata map */
export function getSessionMeta() {
  return appState.sessionMeta;
}

/** @returns {string|null} Current active session ID */
export function getCurrentSessionId() {
  return appState.currentSessionId;
}

/** @returns {object[]} Template list */
export function getTemplates() {
  return appState.templates;
}

/**
 * Replace templates array
 * @param {object[]} templates
 */
export function setTemplates(templates) {
  appState.templates = templates;
}

/**
 * Add a new custom template
 * @param {string} label - Template display name
 * @param {string} text - Template prompt text
 * @returns {object} The created template
 */
export function addTemplate(label, text) {
  const template = {
    id: nanoid(),
    label: (label || '').trim() || 'New template',
    text: (text || '').trim(),
    custom: true
  };
  appState.templates.push(template);
  return template;
}

/**
 * Update an existing template
 * @param {string} id - Template ID
 * @param {{label?: string, text?: string}} patch - Fields to update
 * @returns {boolean} Whether the template was found and updated
 */
export function updateTemplate(id, patch) {
  const template = appState.templates.find(t => t.id === id);
  if (!template) return false;

  if (typeof patch.label === 'string') {
    template.label = patch.label.trim() || template.label;
  }
  if (typeof patch.text === 'string') {
    template.text = patch.text.trim();
  }
  return true;
}

/**
 * Delete a template by ID
 * @param {string} id - Template ID to delete
 * @returns {boolean} Whether the template was deleted
 */
export function deleteTemplate(id) {
  // Don't allow deleting the blank template
  if (id === BLANK_TEMPLATE_ID) return false;

  const before = appState.templates.length;
  appState.templates = appState.templates.filter(t => t.id !== id);
  return appState.templates.length < before;
}

/**
 * Reset templates to defaults
 */
export function resetTemplates() {
  appState.templates = DEFAULT_TEMPLATES.slice();
}

/** @returns {string} Current context draft text */
export function getContextDraft() {
  return appState.contextDraft;
}

/** @returns {object[]} Saved context snapshots */
export function getContextSnapshots() {
  return appState.contextSnapshots;
}

/** @returns {string|null} Active snapshot ID */
export function getActiveSnapshotId() {
  return appState.activeSnapshotId;
}

/** @returns {string} AI availability status */
export function getAvailability() {
  return appState.availability;
}

/**
 * Update availability status
 * @param {string} status
 */
export function setAvailability(status) {
  appState.availability = status || 'unknown';
}

/** @returns {number|null} Timestamp of last availability check */
export function getAvailabilityCheckedAt() {
  return appState.availabilityCheckedAt;
}

/**
 * Update availability check timestamp
 * @param {number|null} timestamp
 */
export function setAvailabilityCheckedAt(timestamp) {
  appState.availabilityCheckedAt = timestamp || null;
}

/** @returns {object} Current settings */
export function getSettings() {
  return appState.settings;
}

const dirtySessions = new Set();
let metaDirty = false;
const markMetaDirty = () => { metaDirty = true; };
const MAX_CONTEXT_SNAPSHOTS = 15;

/**
 * IndexedDB connection promise
 */
const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
      db.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(STORES.META)) {
      db.createObjectStore(STORES.META, { keyPath: 'id' });
    }
    if (STORES.ATTACHMENTS && !db.objectStoreNames.contains(STORES.ATTACHMENTS)) {
      const store = db.createObjectStore(STORES.ATTACHMENTS, { keyPath: 'id' });
      store.createIndex('sessionId', 'sessionId', { unique: false });
    }
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/**
 * Execute a database operation with proper transaction handling
 * @param {string} storeName - Store name
 * @param {string} mode - Transaction mode ('readonly' or 'readwrite')
 * @param {Function} callback - Callback that receives the object store
 * @returns {Promise<any>} Operation result
 */
async function dbOp(storeName, mode, callback) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);

    let reqResult = null;
    const request = callback(store);

    // Capture request result but wait for transaction to complete
    request.onsuccess = () => { reqResult = request.result; };
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => resolve(reqResult);
    tx.onerror = (event) => {
      if (event.target.error?.name === 'QuotaExceededError') {
        console.error('IndexedDB quota exceeded. Consider clearing old sessions.');
        toast.error(USER_ERROR_MESSAGES.STORAGE_QUOTA_EXCEEDED);
        reject(new Error(USER_ERROR_MESSAGES.STORAGE_QUOTA_EXCEEDED));
      } else {
        reject(tx.error);
      }
    };
  });
}

/**
 * Estimate attachment size for metadata tracking
 * @param {object} att - Attachment object
 * @returns {number} Byte size
 */
function estimateAttachmentSize(att) {
  if (typeof att?.size === 'number') return att.size;
  if (att?.data instanceof Blob) return att.data.size;
  if (typeof att?.data === 'string') return att.data.length;
  return 0;
}

/**
 * Persist attachment payload outside of the session record
 * This keeps large blobs/base64 strings out of message bodies
 * @param {string} sessionId - Session owner
 * @param {number} messageIndex - Message index within the session
 * @param {object} att - Attachment with data
 * @returns {{meta: {id: string, name: string, type: string, size: number}, promise: Promise}} Metadata and write promise
 */
function persistAttachmentRecord(sessionId, messageIndex, att) {
  if (!att || typeof att !== 'object') return null;

  const record = {
    id: att.id || nanoid(),
    sessionId,
    messageIndex,
    name: att.name || 'Attachment',
    type: att.type || 'application/octet-stream',
    size: att.size ?? estimateAttachmentSize(att),
    createdAt: Date.now(),
    data: att.data,
    meta: att.meta ? { ...att.meta } : undefined
  };

  const promise = dbOp(STORES.ATTACHMENTS, 'readwrite', store => store.put(record));
  const meta = { id: record.id, name: record.name, type: record.type, size: record.size };

  return { meta, promise };
}

/**
 * Strip attachment payloads from messages and store only metadata
 * @param {string} sessionId - Session ID
 * @param {number} messageIndex - Message index
 * @param {Array} attachments - Raw attachments
 * @returns {{attachments: Array, changed: boolean, attachmentPromises: Promise[]}} Sanitized attachments, whether mutation occurred, and write promises
 */
function sanitizeMessageAttachments(sessionId, messageIndex, attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { attachments: [], changed: false, attachmentPromises: [] };
  }

  let changed = false;
  const attachmentPromises = [];
  const sanitized = attachments.map((att) => {
    if (!att) return null;

    const hasData = typeof att.data !== 'undefined';
    const metaField = att.meta ? { ...att.meta } : undefined;
    const meta = {
      id: att.id || nanoid(),
      name: att.name || 'Attachment',
      type: att.type || 'application/octet-stream',
      size: att.size ?? estimateAttachmentSize(att),
      ...(metaField ? { meta: metaField } : {})
    };

    if (hasData) {
      changed = true;
      const result = persistAttachmentRecord(sessionId, messageIndex, { ...att, ...meta });
      if (result?.promise) {
        attachmentPromises.push(result.promise);
      }
    } else if (!att.id) {
      changed = true;
    }

    return meta;
  }).filter(Boolean);

  return { attachments: sanitized, changed, attachmentPromises };
}

/**
 * Normalize a session's messages by decoupling attachments from message bodies
 * FIXED: Now async to ensure attachments are written before proceeding
 * @param {object} session - Session object
 * @returns {Promise<object>} Normalized session
 */
async function normalizeSession(session) {
  if (!session || !Array.isArray(session.messages)) return session;

  let mutated = false;
  const allAttachmentPromises = [];
  session.messages = session.messages.map((msg, idx) => {
    if (!msg?.attachments?.length) return msg;
    const { attachments, changed, attachmentPromises } = sanitizeMessageAttachments(session.id, idx, msg.attachments);
    if (changed) mutated = true;
    if (attachmentPromises.length > 0) {
      allAttachmentPromises.push(...attachmentPromises);
    }
    return { ...msg, attachments };
  });

  if (mutated) dirtySessions.add(session.id);

  // FIXED: Await write operations to prevent data loss on app close
  if (allAttachmentPromises.length > 0) {
    try {
      await Promise.all(allAttachmentPromises);
    } catch (e) {
      console.warn('Failed to save some attachments during normalization', e);
      toast.warning('Some attachments may not have saved');
    }
  }

  return session;
}

/**
 * Remove all attachment payloads associated with a session
 * @param {string} sessionId - Session ID to clean up
 */
async function deleteAttachmentsForSession(sessionId) {
  if (!STORES.ATTACHMENTS) return;

  try {
    await dbOp(STORES.ATTACHMENTS, 'readwrite', store => {
      const idx = store.index('sessionId');
      const range = IDBKeyRange.only(sessionId);
      const request = idx.openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      return request;
    });
  } catch (e) {
    console.warn('Failed to delete attachments for session', sessionId, e);
  }
}

/**
 * Create a new empty session
 * @param {string} title - Session title
 * @returns {{id: string, title: string, createdAt: number, updatedAt: number, messages: Array}}
 */
function createEmptySession(title = 'New chat') {
  return {
    id: nanoid(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
}

/**
 * Ensure at least one session exists
 */
function ensureDefaultSession() {
  if (!appState.currentSessionId || !appState.sessions[appState.currentSessionId]) {
    const session = createEmptySession();
    appState.sessions[session.id] = session;
    appState.sessionMeta[session.id] = {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: 0
    };
    appState.sessionOrder = [session.id];
    appState.currentSessionId = session.id;
    dirtySessions.add(session.id);
    markMetaDirty();
  }
}

/**
 * Load a single session from IndexedDB
 * @param {string} sessionId - Session ID to load
 * @returns {Promise<object|null>} Session data or null
 */
async function loadSession(sessionId) {
  try {
    const session = await dbOp(STORES.SESSIONS, 'readonly', store => store.get(sessionId));
    return await normalizeSession(session);
  } catch (e) {
    console.error('Failed to load session:', sessionId, e);
    return null;
  }
}

/**
 * Get the current active session
 * Lazy loads from IndexedDB if not in memory
 * @returns {Promise<{id: string, title: string, messages: Array}>} Current session
 */
export function getCurrentSessionSync() {
  ensureDefaultSession();
  return appState.sessions[appState.currentSessionId];
}

/**
 * Set the current active session and update order
 * Lazy loads session data if not in memory
 * @param {string} sessionId - Session ID to activate
 * @returns {Promise<void>}
 */
export async function setCurrentSession(sessionId) {
  // Check if session exists in metadata or loaded sessions
  if (!appState.sessionMeta[sessionId] && !appState.sessions[sessionId]) {
    console.warn('Session not found:', sessionId);
    return;
  }

  const previousId = appState.currentSessionId;
  appState.currentSessionId = sessionId;
  if (previousId !== sessionId) markMetaDirty();

  // Lazy load session if not already loaded
  if (appState.lazyLoadEnabled && !appState.sessions[sessionId]) {
    const session = await loadSession(sessionId);
    if (session) {
      appState.sessions[sessionId] = session;
    }
  }

  const idx = appState.sessionOrder.indexOf(sessionId);
  if (idx > 0) {
    appState.sessionOrder.splice(idx, 1);
    appState.sessionOrder.unshift(sessionId);
    markMetaDirty();
  }
}

/**
 * Return ordered session ids filtered by a search query against metadata
 * @param {string} query - Search text to match against title/id
 * @returns {string[]} Filtered session ids
 */
export function searchSessions(query = '') {
  const term = query.trim().toLowerCase();
  return appState.sessionOrder.filter((id) => {
    if (!term) return true;
    const meta = appState.sessionMeta[id] || appState.sessions[id];
    if (!meta) return false;
    const haystack = `${meta.title || ''} ${meta.id}`.toLowerCase();
    return haystack.includes(term);
  });
}

/**
 * Create a new session, optionally copying from existing session
 * FIXED: Now async to ensure attachments are persisted safely
 * @param {string|null} baseSessionId - Session ID to copy from (optional)
 * @returns {Promise<{id: string, title: string, messages: Array}>} New session
 */
export async function createSessionFrom(baseSessionId = null) {
  const base = baseSessionId ? appState.sessions[baseSessionId] : null;
  const session = createEmptySession(base ? `${base.title} copy` : 'New chat');
  if (base) {
    session.messages = base.messages.slice();
  }
  
  // Await normalization to ensure attachments are saved
  await normalizeSession(session);
  
  appState.sessions[session.id] = session;
  appState.sessionMeta[session.id] = {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length
  };
  appState.sessionOrder.unshift(session.id);
  appState.currentSessionId = session.id;
  dirtySessions.add(session.id);
  // Persist ordering + active session change separately
  markMetaDirty();

  // Remove oldest sessions if limit exceeded (batched in single transaction)
  if (appState.sessionOrder.length > MAX_SESSIONS) {
    const sessionsToRemove = appState.sessionOrder.slice(MAX_SESSIONS);
    
    // Batch IndexedDB deletes in single transaction
    dbPromise.then(db => {
      const storeNames = [STORES.SESSIONS];
      if (STORES.ATTACHMENTS) storeNames.push(STORES.ATTACHMENTS);
      
      const tx = db.transaction(storeNames, 'readwrite');
      const sessionStore = tx.objectStore(STORES.SESSIONS);
      const attachmentStore = STORES.ATTACHMENTS ? tx.objectStore(STORES.ATTACHMENTS) : null;
      
      sessionsToRemove.forEach(oldId => {
        sessionStore.delete(oldId);
        
        // Delete attachments via index cursor
        if (attachmentStore) {
          const idx = attachmentStore.index('sessionId');
          idx.openCursor(IDBKeyRange.only(oldId)).onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
        }
      });
      
      tx.onerror = () => console.error('Failed to batch delete old sessions', tx.error);
    }).catch(e => console.error('Failed to open DB for batch delete', e));
    
    // Clean memory synchronously
    sessionsToRemove.forEach(oldId => {
      delete appState.sessions[oldId];
      delete appState.sessionMeta[oldId];
      dirtySessions.delete(oldId);
    });
    
    appState.sessionOrder = appState.sessionOrder.slice(0, MAX_SESSIONS);
    markMetaDirty();
  }

  return session;
}

/**
 * Delete a session
 * @param {string} sessionId - Session ID to delete
 */
export function deleteSession(sessionId) {
  if (!appState.sessions[sessionId]) return;

  delete appState.sessions[sessionId];
  delete appState.sessionMeta[sessionId];
  dirtySessions.delete(sessionId);

  appState.sessionOrder = appState.sessionOrder.filter(id => id !== sessionId);
  markMetaDirty();

  if (appState.currentSessionId === sessionId) {
    appState.currentSessionId = appState.sessionOrder[0] || null;
    markMetaDirty();
  }
  ensureDefaultSession();

  dbOp(STORES.SESSIONS, 'readwrite', store => store.delete(sessionId))
    .catch(e => console.error('Failed to delete session from IDB', e));
  deleteAttachmentsForSession(sessionId);
}

/**
 * Add or replace a message in a session
 * @param {string} sessionId - Session ID
 * @param {{role: string, text: string, ts: number}} message - Message object
 * @param {number|null} replaceIndex - Index to replace (null to append)
 */
export function upsertMessage(sessionId, message, replaceIndex = null) {
  const session = appState.sessions[sessionId];
  if (!session) return;

  if (!message || typeof message !== 'object') {
    console.error('Invalid message: must be an object');
    return;
  }
  if (!message.role || !VALIDATION.VALID_MESSAGE_ROLES.includes(message.role)) {
    console.error('Invalid message role:', message.role);
    return;
  }
  if (typeof message.text !== 'string') {
    console.error('Invalid message text: must be a string');
    return;
  }

  const targetIndex = replaceIndex === null ? session.messages.length : replaceIndex;
  const storedMessage = { ...message };
  let attachmentPromises = [];
  if (storedMessage.attachments?.length) {
    const result = sanitizeMessageAttachments(sessionId, targetIndex, storedMessage.attachments);
    storedMessage.attachments = result.attachments;
    attachmentPromises = result.attachmentPromises;
  }

  // Pre-cache markdown HTML to avoid render-time parsing
  if (storedMessage.text) {
    storedMessage.htmlCache = markdownToHtml(storedMessage.text);
  }

  if (replaceIndex === null) {
    session.messages.push(storedMessage);
  } else {
    session.messages[replaceIndex] = storedMessage;
  }
  session.updatedAt = Date.now();
  if (appState.sessionMeta[sessionId]) {
    appState.sessionMeta[sessionId].messageCount = session.messages.length;
    appState.sessionMeta[sessionId].updatedAt = session.updatedAt;
  }
  dirtySessions.add(sessionId);

  // Handle attachment write errors after session is marked dirty
  if (attachmentPromises.length > 0) {
    Promise.all(attachmentPromises).catch(() => {
      toast.warning('Some attachments may not have saved');
    });
  }
}

/**
 * Update an existing message with a patch object
 * @param {string} sessionId - Session ID
 * @param {number} messageIndex - Message index to update
 * @param {object} patch - Fields to update
 */
export function updateMessage(sessionId, messageIndex, patch) {
  const session = appState.sessions[sessionId];
  if (!session || !session.messages[messageIndex]) return;
  const next = { ...session.messages[messageIndex], ...patch };
  let attachmentPromises = [];
  if (Array.isArray(next.attachments)) {
    const result = sanitizeMessageAttachments(sessionId, messageIndex, next.attachments);
    next.attachments = result.attachments;
    attachmentPromises = result.attachmentPromises;
  }

  // Recompute htmlCache if text changed, clear if text is empty/removed
  if ('text' in patch) {
    if (patch.text) {
      next.htmlCache = markdownToHtml(patch.text);
    } else {
      delete next.htmlCache;
    }
  }

  session.messages[messageIndex] = next;
  session.updatedAt = Date.now();
  if (appState.sessionMeta[sessionId]) {
    appState.sessionMeta[sessionId].updatedAt = session.updatedAt;
  }
  dirtySessions.add(sessionId);

  // Handle attachment write errors after session is marked dirty
  if (attachmentPromises.length > 0) {
    Promise.all(attachmentPromises).catch(() => {
      toast.warning('Some attachments may not have saved');
    });
  }
}

/**
 * Rename a session
 * @param {string} sessionId - Session ID
 * @param {string} title - New title
 */
export function renameSession(sessionId, title) {
  if (!appState.sessions[sessionId]) return;
  appState.sessions[sessionId].title = title;
  appState.sessions[sessionId].updatedAt = Date.now();
  if (appState.sessionMeta[sessionId]) {
    appState.sessionMeta[sessionId] = {
      ...appState.sessionMeta[sessionId],
      title,
      updatedAt: appState.sessions[sessionId].updatedAt
    };
  }
  dirtySessions.add(sessionId);
}

/**
 * Save state to IndexedDB and chrome.storage.sync
 * @returns {Promise<void>}
 */
export async function saveState() {
  ensureDefaultSession();

  try {
    const hasSessionChanges = dirtySessions.size > 0;
    const hasMetaChanges = metaDirty;

    if (hasSessionChanges || hasMetaChanges) {
      const db = await dbPromise;
      const tx = db.transaction([STORES.SESSIONS, STORES.META], 'readwrite');

      if (hasMetaChanges) {
        const metaStore = tx.objectStore(STORES.META);
        metaStore.put({ id: 'sessionOrder', val: appState.sessionOrder });
        metaStore.put({ id: 'currentSessionId', val: appState.currentSessionId });
        metaStore.put({ id: 'contextSnapshots', val: appState.contextSnapshots });
        metaStore.put({ id: 'activeSnapshotId', val: appState.activeSnapshotId });
        metaDirty = false;
      }

      if (hasSessionChanges) {
        const sessionStore = tx.objectStore(STORES.SESSIONS);
        dirtySessions.forEach(id => {
          const s = appState.sessions[id];
          if (s) sessionStore.put(s);
        });
        dirtySessions.clear();
      }
    }

  } catch (e) {
    console.warn('IDB Save Failed:', e);
    toast.error(USER_ERROR_MESSAGES.STORAGE_SAVE_FAILED);
  }

  const settingsPayload = {
    templates: appState.templates,
    settings: appState.settings
  };
  chrome.storage.sync.set({ [SYNC_KEY]: settingsPayload });
}

/**
 * Debounced save state - coalesces rapid writes into a single IndexedDB transaction
 * Uses dirtySessions tracking to batch all pending changes
 */
let saveTimeout = null;
let savePromise = null;

export function scheduleSaveState() {
  if (saveTimeout) return;

  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    savePromise = saveState();
    await savePromise;
    savePromise = null;
  }, TIMING.SAVE_STATE_DEBOUNCE_MS);
}

/**
 * Flush any pending debounced save immediately
 * Call this before critical operations or page unload
 * @returns {Promise<void>}
 */
export async function flushSaveState() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (savePromise) {
    await savePromise;
  }
  // Always save to ensure any dirty state is persisted
  if (dirtySessions.size > 0 || metaDirty) {
    await saveState();
  }
}

/**
 * Save context draft to session storage
 * @param {string} text - Context text
 * @returns {Promise<void>}
 */
export async function saveContextDraft(text) {
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: text });
  } catch (e) {
    console.warn('Session draft save failed', e);
  }
}

/**
 * Update context draft in memory only
 * @param {string} text - Context text
 */
export function updateContextDraft(text) {
  appState.contextDraft = text;
}

/**
 * Save a reusable context snapshot
 * @param {{title?: string, url?: string, text: string, createdAt?: number}} payload - Snapshot data
 * @returns {object|null} Snapshot record
 */
export function addContextSnapshot(payload = {}) {
  if (!payload?.text || typeof payload.text !== 'string') return null;

  const snapshot = {
    id: payload.id || nanoid(),
    title: (payload.title || '').trim() || 'Saved page',
    url: payload.url || '',
    text: payload.text,
    createdAt: payload.createdAt || Date.now()
  };

  // Keep newest snapshots first and cap the list
  appState.contextSnapshots = [
    snapshot,
    ...appState.contextSnapshots.filter(s => s.id !== snapshot.id)
  ].slice(0, MAX_CONTEXT_SNAPSHOTS);

  markMetaDirty();
  return snapshot;
}

/**
 * Remove a stored context snapshot
 * @param {string} id - Snapshot id
 * @returns {boolean} Whether a snapshot was removed
 */
export function removeContextSnapshot(id) {
  const before = appState.contextSnapshots.length;
  appState.contextSnapshots = appState.contextSnapshots.filter(s => s.id !== id);
  if (appState.activeSnapshotId === id) {
    appState.activeSnapshotId = null;
  }
  if (before !== appState.contextSnapshots.length) {
    markMetaDirty();
    return true;
  }
  return false;
}

/**
 * Mark a snapshot as active (or clear with null)
 * @param {string|null} id - Snapshot id to activate or null to clear
 */
export function setActiveSnapshot(id) {
  appState.activeSnapshotId = id || null;
  markMetaDirty();
}

/**
 * Get a snapshot by id
 * @param {string} id - Snapshot id
 * @returns {object|null} Snapshot record
 */
export function getContextSnapshotById(id) {
  return appState.contextSnapshots.find(s => s.id === id) || null;
}

/**
 * Get the currently active snapshot record
 * @returns {object|null} Active snapshot
 */
export function getActiveSnapshot() {
  if (!appState.activeSnapshotId) return null;
  return getContextSnapshotById(appState.activeSnapshotId);
}

/**
 * Load state from IndexedDB and chrome.storage
 * Uses lazy loading for session data when enabled
 * @returns {Promise<object>} Loaded app state
 */
export async function loadState() {
  try {
    const [db, syncData, sessionData] = await Promise.all([
        dbPromise,
        chrome.storage.sync.get(SYNC_KEY),
        chrome.storage.session.get(SESSION_KEY)
    ]);

    if (syncData[SYNC_KEY]) {
      appState.settings = { ...appState.settings, ...syncData[SYNC_KEY].settings };

      // Migration: Update old "concise" system prompt to new "detailed" default
      if (appState.settings.systemPrompt === 'You are a helpful, concise assistant.') {
        appState.settings.systemPrompt = DEFAULT_SETTINGS.systemPrompt;
        // Save the migrated settings
        await chrome.storage.sync.set({ [SYNC_KEY]: { settings: appState.settings, templates: appState.templates } });
      }

      if (syncData[SYNC_KEY].templates) appState.templates = syncData[SYNC_KEY].templates;
    }

    if (sessionData[SESSION_KEY]) {
      appState.contextDraft = sessionData[SESSION_KEY];
    }

    const tx = db.transaction([STORES.SESSIONS, STORES.META], 'readonly');

    // Helper to promise-ify requests manually since we are inside a transaction
    const getVal = (store, key) => new Promise(r => {
       const req = store.get(key);
       req.onsuccess = () => r(req.result?.val);
       req.onerror = () => r(null);
    });

    const getAllVal = (store) => new Promise(r => {
        const req = store.getAll();
        req.onsuccess = () => r(req.result);
        req.onerror = () => r([]);
    });

    const metaStore = tx.objectStore(STORES.META);
    const sessionStore = tx.objectStore(STORES.SESSIONS);

    const [order, currentId, snapshots, activeSnapshotId, allSessions] = await Promise.all([
        getVal(metaStore, 'sessionOrder'),
        getVal(metaStore, 'currentSessionId'),
        getVal(metaStore, 'contextSnapshots'),
        getVal(metaStore, 'activeSnapshotId'),
        getAllVal(sessionStore)
    ]);

    if (order) appState.sessionOrder = order;
    if (currentId) appState.currentSessionId = currentId;
    if (Array.isArray(snapshots)) appState.contextSnapshots = snapshots;
    if (activeSnapshotId) {
      const exists = (snapshots || []).some(s => s.id === activeSnapshotId);
      appState.activeSnapshotId = exists ? activeSnapshotId : null;
    }

    if (allSessions && allSessions.length) {
      // FIXED: Process normalizations in parallel and AWAIT them to ensure data migration safety
      const normalizedSessions = await Promise.all(allSessions.map(s => normalizeSession(s)));
      
      // Determine if we should enable lazy loading
      // Enable for 50+ sessions to reduce memory usage
      const shouldLazyLoad = normalizedSessions.length >= 50;
      appState.lazyLoadEnabled = shouldLazyLoad;

      const metaMap = {};
      normalizedSessions.forEach(s => {
        metaMap[s.id] = {
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: s.messages?.length || 0
        };
      });
      appState.sessionMeta = metaMap;

      if (shouldLazyLoad) {
        // LAZY MODE: Only load current session's full data
        const currentSession = normalizedSessions.find(s => s.id === currentId);
        if (currentSession) {
          appState.sessions[currentId] = currentSession;
        }
      } else {
        // EAGER MODE: Load all sessions (original behavior)
        const map = {};
        normalizedSessions.forEach(s => map[s.id] = s);
        appState.sessions = map;
      }
    }

  } catch (e) {
    console.warn('Failed to load state:', e);
  }

  ensureDefaultSession();
  return appState;
}

/**
 * Add an attachment to the current attachments list
 * @param {{name: string, type: string, data: string}} entry - Attachment object
 */
export function addPendingAttachment(entry) {
  appState.pendingAttachments.push(entry);
}

/**
 * Clear all attachments
 */
export function clearPendingAttachments() {
  appState.pendingAttachments = [];
}

/**
 * Get current attachments list
 * @returns {Array<{name: string, type: string, data: string}>} Attachments
 */
export function getPendingAttachments() {
  return appState.pendingAttachments;
}

/**
 * Remove a specific pending attachment by index
 * @param {number} index - Attachment index to remove
 */
export function removePendingAttachment(index) {
  if (index < 0 || index >= appState.pendingAttachments.length) return;
  appState.pendingAttachments.splice(index, 1);
}

/**
 * Update settings with a patch object
 * @param {object} patch - Settings to update
 */
export function updateSettings(patch) {
  appState.settings = { ...appState.settings, ...patch };
}
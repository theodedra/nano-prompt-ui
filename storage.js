import { nanoid } from './utils.js';
import { toast } from './toast.js';
import {
  STORAGE_KEYS,
  LIMITS,
  DEFAULT_TEMPLATES,
  BLANK_TEMPLATE_ID,
  DEFAULT_SETTINGS,
  VALIDATION,
  USER_ERROR_MESSAGES
} from './constants.js';

const { DB_NAME, DB_VERSION, STORES } = STORAGE_KEYS;
const SYNC_KEY = STORAGE_KEYS.SYNC;
const SESSION_KEY = STORAGE_KEYS.SESSION_DRAFT;
const MAX_SESSIONS = LIMITS.MAX_SESSIONS;

// Re-export for backwards compatibility
export { BLANK_TEMPLATE_ID, DEFAULT_TEMPLATES };

/**
 * Application state object
 */
export const appState = {
  sessions: {},
  sessionOrder: [],
  currentSessionId: null,
  templates: DEFAULT_TEMPLATES.slice(),
  attachments: [],
  contextDraft: '',
  availability: 'unknown',
  settings: { ...DEFAULT_SETTINGS },
  model: null
};

const dirtySessions = new Set();

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
      // QUOTA HANDLING: Detect quota exceeded errors
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
    appState.sessionOrder = [session.id];
    appState.currentSessionId = session.id;
    dirtySessions.add(session.id);
  }
}

/**
 * Get the current active session
 * @returns {{id: string, title: string, messages: Array}} Current session
 */
export function getCurrentSession() {
  ensureDefaultSession();
  return appState.sessions[appState.currentSessionId];
}

/**
 * Set the current active session and update order
 * @param {string} sessionId - Session ID to activate
 */
export function setCurrentSession(sessionId) {
  if (!appState.sessions[sessionId]) return;
  appState.currentSessionId = sessionId;

  const idx = appState.sessionOrder.indexOf(sessionId);
  if (idx > 0) {
    appState.sessionOrder.splice(idx, 1);
    appState.sessionOrder.unshift(sessionId);
  }
}

/**
 * Create a new session, optionally copying from existing session
 * @param {string|null} baseSessionId - Session ID to copy from (optional)
 * @returns {{id: string, title: string, messages: Array}} New session
 */
export function createSessionFrom(baseSessionId = null) {
  const base = baseSessionId ? appState.sessions[baseSessionId] : null;
  const session = createEmptySession(base ? `${base.title} copy` : 'New chat');
  if (base) {
    session.messages = base.messages.slice();
  }
  appState.sessions[session.id] = session;
  appState.sessionOrder.unshift(session.id);
  appState.currentSessionId = session.id;
  dirtySessions.add(session.id);

  // AUTO-CLEANUP: Remove oldest sessions if limit exceeded
  if (appState.sessionOrder.length > MAX_SESSIONS) {
    const sessionsToRemove = appState.sessionOrder.slice(MAX_SESSIONS);
    sessionsToRemove.forEach(oldId => {
      delete appState.sessions[oldId];
      dirtySessions.delete(oldId);
      dbOp(STORES.SESSIONS, 'readwrite', store => store.delete(oldId))
        .catch(e => console.error('Failed to delete old session from IDB', e));
    });
    appState.sessionOrder = appState.sessionOrder.slice(0, MAX_SESSIONS);
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
  dirtySessions.delete(sessionId);

  appState.sessionOrder = appState.sessionOrder.filter(id => id !== sessionId);

  if (appState.currentSessionId === sessionId) {
    appState.currentSessionId = appState.sessionOrder[0] || null;
  }
  ensureDefaultSession();

  dbOp(STORES.SESSIONS, 'readwrite', store => store.delete(sessionId))
    .catch(e => console.error('Failed to delete session from IDB', e));
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

  // MESSAGE VALIDATION: Ensure message has required fields
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

  if (replaceIndex === null) {
    session.messages.push(message);
  } else {
    session.messages[replaceIndex] = message;
  }
  session.updatedAt = Date.now();
  dirtySessions.add(sessionId);
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
  session.messages[messageIndex] = { ...session.messages[messageIndex], ...patch };
  session.updatedAt = Date.now();
  dirtySessions.add(sessionId);
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
  dirtySessions.add(sessionId);
}

/**
 * Save state to IndexedDB and chrome.storage.sync
 * @returns {Promise<void>}
 */
export async function saveState() {
  ensureDefaultSession();

  try {
    const db = await dbPromise;
    const tx = db.transaction([STORES.SESSIONS, STORES.META], 'readwrite');

    const metaStore = tx.objectStore(STORES.META);
    metaStore.put({ id: 'sessionOrder', val: appState.sessionOrder });
    metaStore.put({ id: 'currentSessionId', val: appState.currentSessionId });

    const sessionStore = tx.objectStore(STORES.SESSIONS);

    if (dirtySessions.size > 0) {
        dirtySessions.forEach(id => {
            const s = appState.sessions[id];
            if (s) sessionStore.put(s);
        });
        dirtySessions.clear();
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
 * Load state from IndexedDB and chrome.storage
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

    const [order, currentId, allSessions] = await Promise.all([
        getVal(metaStore, 'sessionOrder'),
        getVal(metaStore, 'currentSessionId'),
        getAllVal(sessionStore)
    ]);

    if (allSessions && allSessions.length) {
        const map = {};
        allSessions.forEach(s => map[s.id] = s);
        appState.sessions = map;
    }

    if (order) appState.sessionOrder = order;
    if (currentId) appState.currentSessionId = currentId;

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
export function addAttachment(entry) {
  appState.attachments.push(entry);
}

/**
 * Clear all attachments
 */
export function clearAttachments() {
  appState.attachments = [];
}

/**
 * Get current attachments list
 * @returns {Array<{name: string, type: string, data: string}>} Attachments
 */
export function getAttachments() {
  return appState.attachments;
}

/**
 * Update settings with a patch object
 * @param {object} patch - Settings to update
 */
export function updateSettings(patch) {
  appState.settings = { ...appState.settings, ...patch };
}

/**
 * Get plain text summary of a session's messages
 * @param {string} sessionId - Session ID
 * @returns {string} Plain text summary
 */
export function summarizeSession(sessionId) {
  const session = appState.sessions[sessionId];
  if (!session) return '';
  return session.messages.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.text}`).join('\n\n');
}

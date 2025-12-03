import { nanoid, markdownToHtml } from '../utils/utils.js';
import { toast } from '../ui/toast.js';
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
import { handleError } from '../utils/errors.js';
import {
  // State getters/setters
  getTemplates,
  setTemplates,
  getContextDraft,
  updateContextDraft,
  getContextSnapshots,
  setContextSnapshots,
  getActiveSnapshotId,
  setActiveSnapshotId,
  getAvailability,
  setAvailability,
  getAvailabilityCheckedAt,
  setAvailabilityCheckedAt,
  hasCachedAvailability,
  getSettings,
  updateSettings,
  getModel,
  setModel,
  addPendingAttachment,
  clearPendingAttachments,
  getPendingAttachments,
  removePendingAttachment,
  // Session state
  getSessions,
  getSessionMeta,
  getCurrentSessionId,
  setCurrentSessionId,
  getSession,
  setSession,
  deleteSession as deleteSessionFromState,
  getSessionMetaById,
  setSessionMeta,
  markSessionDirty,
  clearDirtySessions,
  getDirtySessions,
  hasSession,
  getSessionOrder,
  setSessionOrder,
  getLazyLoadEnabled,
  setLazyLoadEnabled,
  // Internal access for persistence
  getPersistentState,
  getSessionManager
} from './state.js';

const { DB_NAME, DB_VERSION, STORES } = STORAGE_KEYS;
const SYNC_KEY = STORAGE_KEYS.SYNC;
const SESSION_KEY = STORAGE_KEYS.SESSION_DRAFT;
const MAX_SESSIONS = LIMITS.MAX_SESSIONS;

// Re-export for backwards compatibility
export { BLANK_TEMPLATE_ID, DEFAULT_TEMPLATES };

// Re-export state API for backwards compatibility
export {
  getSessions,
  getSessionMeta,
  getCurrentSessionId,
  getTemplates,
  getContextDraft,
  getContextSnapshots,
  getActiveSnapshotId,
  getAvailability,
  setAvailability,
  getAvailabilityCheckedAt,
  setAvailabilityCheckedAt,
  hasCachedAvailability,
  getSettings
};

// Internal references to state for persistence layer
const appState = getPersistentState();
const sessionManager = getSessionManager();

// ============================================================================
// VALIDATION - Single Source of Truth
// ============================================================================

/**
 * Validate a message object
 * @param {any} message - Message to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateMessage(message) {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Invalid message: must be an object' };
  }
  if (!message.role || !VALIDATION.VALID_MESSAGE_ROLES.includes(message.role)) {
    return { valid: false, error: `Invalid message role: ${message.role}. Must be one of: ${VALIDATION.VALID_MESSAGE_ROLES.join(', ')}` };
  }
  if (typeof message.text !== 'string') {
    return { valid: false, error: 'Invalid message text: must be a string' };
  }
  return { valid: true };
}

/**
 * Validate a message patch object (for updates)
 * @param {any} patch - Patch object to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateMessagePatch(patch) {
  if (!patch || typeof patch !== 'object') {
    return { valid: false, error: 'Invalid patch: must be an object' };
  }
  // If role is being updated, validate it
  if ('role' in patch && (!patch.role || !VALIDATION.VALID_MESSAGE_ROLES.includes(patch.role))) {
    return { valid: false, error: `Invalid message role: ${patch.role}. Must be one of: ${VALIDATION.VALID_MESSAGE_ROLES.join(', ')}` };
  }
  // If text is being updated, validate it
  if ('text' in patch && typeof patch.text !== 'string') {
    return { valid: false, error: 'Invalid message text: must be a string' };
  }
  return { valid: true };
}

/**
 * Validate a context snapshot payload
 * @param {any} payload - Snapshot payload to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateContextSnapshot(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Invalid snapshot: must be an object' };
  }
  if (!payload.text || typeof payload.text !== 'string') {
    return { valid: false, error: 'Invalid snapshot text: must be a non-empty string' };
  }
  if (payload.title !== undefined && typeof payload.title !== 'string') {
    return { valid: false, error: 'Invalid snapshot title: must be a string' };
  }
  if (payload.url !== undefined && typeof payload.url !== 'string') {
    return { valid: false, error: 'Invalid snapshot URL: must be a string' };
  }
  return { valid: true };
}

/**
 * Validate a template
 * @param {any} template - Template to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateTemplate(template) {
  if (!template || typeof template !== 'object') {
    return { valid: false, error: 'Invalid template: must be an object' };
  }
  if (typeof template.label !== 'string') {
    return { valid: false, error: 'Invalid template label: must be a string' };
  }
  if (typeof template.text !== 'string') {
    return { valid: false, error: 'Invalid template text: must be a string' };
  }
  return { valid: true };
}

/**
 * Validate a session structure
 * @param {any} session - Session to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateSession(session) {
  if (!session || typeof session !== 'object') {
    return { valid: false, error: 'Invalid session: must be an object' };
  }
  if (!session.id || typeof session.id !== 'string') {
    return { valid: false, error: 'Invalid session ID: must be a non-empty string' };
  }
  if (typeof session.title !== 'string') {
    return { valid: false, error: 'Invalid session title: must be a string' };
  }
  if (!Array.isArray(session.messages)) {
    return { valid: false, error: 'Invalid session messages: must be an array' };
  }
  return { valid: true };
}

// ============================================================================
// TEMPLATE OPERATIONS
// ============================================================================

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
  const templates = getTemplates();
  templates.push(template);
  setTemplates(templates);
  return template;
}

/**
 * Update an existing template
 * @param {string} id - Template ID
 * @param {{label?: string, text?: string}} patch - Fields to update
 * @returns {boolean} Whether the template was found and updated
 */
export function updateTemplate(id, patch) {
  const templates = getTemplates();
  const template = templates.find(t => t.id === id);
  if (!template) return false;

  if (typeof patch.label === 'string') {
    template.label = patch.label.trim() || template.label;
  }
  if (typeof patch.text === 'string') {
    template.text = patch.text.trim();
  }
  setTemplates(templates);
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

  const templates = getTemplates();
  const before = templates.length;
  const filtered = templates.filter(t => t.id !== id);
  setTemplates(filtered);
  return filtered.length < before;
}

/**
 * Reset templates to defaults
 */
export function resetTemplates() {
  setTemplates(DEFAULT_TEMPLATES.slice());
}

let metaDirty = false;
const markMetaDirty = () => { metaDirty = true; };
const MAX_CONTEXT_SNAPSHOTS = 15;

// ============================================================================
// RETRY QUEUE AND FALLBACK STORAGE
// ============================================================================

/**
 * Retry queue for failed IndexedDB operations
 */
class RetryQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxRetries = 5;
    this.baseDelay = 1000; // 1 second
    this.maxDelay = 30000; // 30 seconds
    this.fallbackKey = 'nano_prompt_fallback_storage';
  }

  /**
   * Calculate exponential backoff delay
   * @param {number} attempt - Current attempt number (0-indexed)
   * @returns {number} Delay in milliseconds
   */
  getBackoffDelay(attempt) {
    const delay = Math.min(this.baseDelay * Math.pow(2, attempt), this.maxDelay);
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error object
   * @returns {boolean} Whether the error is retryable
   */
  isRetryableError(error) {
    if (!error) return false;
    const name = error.name || error.toString();
    // Retry on transient errors, not on quota exceeded or invalid state
    return !['QuotaExceededError', 'InvalidStateError', 'DataError'].includes(name);
  }

  /**
   * Save to fallback storage (chrome.storage.local)
   * @param {string} operation - Operation type ('put', 'delete', etc.)
   * @param {string} storeName - Store name
   * @param {any} data - Data to store
   * @returns {Promise<void>}
   */
  async saveToFallback(operation, storeName, data) {
    try {
      const fallbackData = await chrome.storage.local.get(this.fallbackKey) || {};
      const currentFallback = fallbackData[this.fallbackKey] || {};
      
      if (storeName === 'saveState' && data.sessions && data.meta) {
        // Handle saveState format
        const sessionsStore = currentFallback[STORES.SESSIONS] || {};
        const metaStore = currentFallback[STORES.META] || {};
        
        // Save sessions
        for (const [id, session] of Object.entries(data.sessions)) {
          sessionsStore[id] = { ...session, _timestamp: Date.now() };
        }
        
        // Save meta
        if (data.meta.sessionOrder) {
          metaStore.sessionOrder = { val: data.meta.sessionOrder, _timestamp: Date.now() };
        }
        if (data.meta.currentSessionId !== undefined) {
          metaStore.currentSessionId = { val: data.meta.currentSessionId, _timestamp: Date.now() };
        }
        if (data.meta.contextSnapshots) {
          metaStore.contextSnapshots = { val: data.meta.contextSnapshots, _timestamp: Date.now() };
        }
        if (data.meta.activeSnapshotId !== undefined) {
          metaStore.activeSnapshotId = { val: data.meta.activeSnapshotId, _timestamp: Date.now() };
        }
        
        currentFallback[STORES.SESSIONS] = sessionsStore;
        currentFallback[STORES.META] = metaStore;
      } else {
        // Handle regular operations
        const store = currentFallback[storeName] || {};
        
        if (operation === 'put') {
          if (data && typeof data === 'object') {
            if (data.id) {
              store[data.id] = { ...data, _timestamp: Date.now() };
            } else if (data.key && data.value) {
              store[data.key] = { val: data.value, _timestamp: Date.now() };
            }
          }
        } else if (operation === 'delete') {
          delete store[data];
        }
        
        currentFallback[storeName] = store;
      }
      
      await chrome.storage.local.set({ [this.fallbackKey]: currentFallback });
      console.log('Saved to fallback storage:', operation, storeName);
    } catch (e) {
      console.error('Fallback storage save failed:', e);
    }
  }

  /**
   * Load from fallback storage
   * @param {string} storeName - Store name
   * @param {string} key - Key to retrieve
   * @returns {Promise<any>} Retrieved data or null
   */
  async loadFromFallback(storeName, key) {
    try {
      const fallbackData = await chrome.storage.local.get(this.fallbackKey);
      const store = fallbackData[this.fallbackKey]?.[storeName];
      if (store && store[key]) {
        return store[key];
      }
    } catch (e) {
      console.error('Fallback storage load failed:', e);
    }
    return null;
  }

  /**
   * Add operation to retry queue
   * @param {Function} operation - Async function to retry
   * @param {string} operationType - Type of operation ('put', 'delete', etc.)
   * @param {string} storeName - Store name
   * @param {any} data - Operation data for fallback
   * @param {number} attempt - Current attempt number
   * @returns {Promise<any>} Operation result
   */
  async enqueue(operation, operationType, storeName, data, attempt = 0) {
    if (attempt >= this.maxRetries) {
      // Max retries exceeded, save to fallback storage
      console.warn('Max retries exceeded, saving to fallback storage:', operationType, storeName);
      await this.saveToFallback(operationType, storeName, data);
      toast.warning('Data saved to fallback storage. Will retry on next load.');
      // Return a resolved promise to indicate fallback was used
      return Promise.resolve();
    }

    try {
      const result = await operation();
      // Success - remove from queue if it was queued
      this.queue = this.queue.filter(item => item.operation !== operation);
      return result;
    } catch (error) {
      if (!this.isRetryableError(error)) {
        // Non-retryable error, save to fallback immediately
        console.warn('Non-retryable error, saving to fallback:', error);
        await this.saveToFallback(operationType, storeName, data);
        // For non-retryable errors, we still reject to signal failure
        throw error;
      }

      // Retryable error - schedule retry
      const delay = this.getBackoffDelay(attempt);
      console.warn(`IndexedDB operation failed, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries}):`, error);
      
      return new Promise((resolve, reject) => {
        const retryItem = {
          operation: () => this.enqueue(operation, operationType, storeName, data, attempt + 1),
          operationType,
          storeName,
          data,
          attempt: attempt + 1,
          scheduledAt: Date.now() + delay,
          resolve,
          reject
        };
        
        this.queue.push(retryItem);

        // Process queue if not already processing
        if (!this.processing) {
          this.processQueue();
        }
      });
    }
  }

  /**
   * Process retry queue
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const now = Date.now();
      const ready = this.queue.filter(item => item.scheduledAt <= now);
      const pending = this.queue.filter(item => item.scheduledAt > now);
      
      // Process ready items
      for (const item of ready) {
        try {
          const result = await item.operation();
          if (item.resolve) item.resolve(result);
        } catch (error) {
          if (item.reject) item.reject(error);
        }
      }
      
      // Update queue with pending items
      this.queue = pending;
      
      // Wait for next scheduled item if any
      if (this.queue.length > 0) {
        const nextDelay = Math.max(0, Math.min(...this.queue.map(item => item.scheduledAt - now)));
        if (nextDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, nextDelay));
        }
      }
    }
    
    this.processing = false;
  }

  /**
   * Restore data from fallback storage to IndexedDB
   * @returns {Promise<void>}
   */
  async restoreFromFallback() {
    try {
      const fallbackData = await chrome.storage.local.get(this.fallbackKey);
      if (!fallbackData[this.fallbackKey]) return;

      const db = await dbPromise;
      const validStoreNames = Object.values(STORES);
      
      for (const [storeName, store] of Object.entries(fallbackData[this.fallbackKey])) {
        // Only restore to valid IndexedDB stores
        if (!validStoreNames.includes(storeName)) continue;
        
        const tx = db.transaction(storeName, 'readwrite');
        const objectStore = tx.objectStore(storeName);
        
        for (const [key, value] of Object.entries(store)) {
          if (key.startsWith('_')) continue; // Skip metadata
          
          try {
            // Remove _timestamp before storing
            const { _timestamp, ...cleanValue } = value;
            if (cleanValue.val !== undefined) {
              // Meta store format
              objectStore.put({ id: key, val: cleanValue.val });
            } else {
              // Regular store format
              objectStore.put(cleanValue);
            }
          } catch (e) {
            console.error('Failed to restore item from fallback:', key, e);
          }
        }
        
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => {
            // Log but don't reject - continue with other stores
            console.warn('Failed to restore store from fallback:', storeName);
            resolve();
          };
        });
      }
      
      // Clear fallback after successful restore
      await chrome.storage.local.remove(this.fallbackKey);
      console.log('Successfully restored data from fallback storage');
    } catch (e) {
      console.error('Failed to restore from fallback storage:', e);
    }
  }
}

const retryQueue = new RetryQueue();

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

  request.onsuccess = async () => {
    const db = request.result;
    // Restore from fallback storage on successful connection
    await retryQueue.restoreFromFallback();
    resolve(db);
  };
  request.onerror = () => reject(request.error);
});

/**
 * Execute a database operation with proper transaction handling and retry logic
 * @param {string} storeName - Store name
 * @param {string} mode - Transaction mode ('readonly' or 'readwrite')
 * @param {Function} callback - Callback that receives the object store
 * @param {object} options - Options for retry behavior
 * @param {boolean} options.retry - Whether to retry on failure (default: true for write operations)
 * @param {string} options.operationType - Operation type for fallback storage ('put', 'delete', etc.)
 * @param {any} options.fallbackData - Data to save to fallback if operation fails
 * @returns {Promise<any>} Operation result
 */
async function dbOp(storeName, mode, callback, options = {}) {
  const { retry = (mode === 'readwrite'), operationType, fallbackData } = options;
  
  const executeOperation = async () => {
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
        const error = tx.error || event.target.error;
        if (error?.name === 'QuotaExceededError') {
          handleError(error, {
            operation: 'IndexedDB operation',
            fallbackMessage: 'STORAGE_QUOTA_EXCEEDED',
            showToast: true,
            logError: true,
            showToastFn: (type, msg) => toast[type](msg)
          });
          reject(new Error(USER_ERROR_MESSAGES.STORAGE_QUOTA_EXCEEDED));
        } else {
          reject(error);
        }
      };
    });
  };

  if (retry && mode === 'readwrite') {
    // Use retry queue for write operations
    return retryQueue.enqueue(
      executeOperation,
      operationType || 'write',
      storeName,
      fallbackData,
      0
    );
  } else {
    // Direct execution for read operations or when retry is disabled
    return executeOperation();
  }
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

  // Use retry queue with proper options for fallback storage
  const promise = dbOp(STORES.ATTACHMENTS, 'readwrite', store => store.put(record), {
    operationType: 'put',
    fallbackData: record
  });
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
      // Strip canvas property before persistence (HTMLCanvasElement cannot be serialized to IndexedDB)
      const { canvas, ...attWithoutCanvas } = att;
      const result = persistAttachmentRecord(sessionId, messageIndex, { ...attWithoutCanvas, ...meta });
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
 * @param {object} session - Session object
 * @returns {object} Normalized session
 */
function normalizeSession(session) {
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

  if (mutated) markSessionDirty(session.id);

  // Handle attachment write errors during normalization
  if (allAttachmentPromises.length > 0) {
    Promise.all(allAttachmentPromises).catch(() => {
      toast.warning('Some attachments may not have saved');
    });
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
  const currentId = getCurrentSessionId();
  if (!currentId || !getSession(currentId)) {
    const session = createEmptySession();
    setSession(session.id, session);
    setSessionMeta(session.id, {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: 0
    });
    setSessionOrder([session.id]);
    setCurrentSessionId(session.id);
    markSessionDirty(session.id);
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
    return normalizeSession(session);
  } catch (e) {
    console.error('Failed to load session:', sessionId, e);
    return null;
  }
}

/**
 * Load metadata for sessions that don't have it yet
 * Loads in batches to avoid blocking the UI
 * @param {string[]} sessionIds - Session IDs to load metadata for (optional, defaults to all in order)
 * @param {number} batchSize - Number of sessions to load per batch (default: 20)
 * @returns {Promise<void>}
 */
export async function loadSessionMetadata(sessionIds = null, batchSize = 20) {
  const idsToLoad = sessionIds || getSessionOrder();
  
  // Filter out sessions that already have metadata
  const missingIds = idsToLoad.filter(id => !getSessionMetaById(id));
  
  if (missingIds.length === 0) return;

  // Load in batches
  for (let i = 0; i < missingIds.length; i += batchSize) {
    const batch = missingIds.slice(i, i + batchSize);
    
    try {
      const db = await dbPromise;
      const tx = db.transaction([STORES.SESSIONS], 'readonly');
      const store = tx.objectStore(STORES.SESSIONS);
      
      // Load all sessions in this batch
      const promises = batch.map(id => 
        new Promise((resolve) => {
          const req = store.get(id);
          req.onsuccess = () => {
            const session = req.result;
            if (session) {
              const normalized = normalizeSession(session);
              setSessionMeta(id, {
                id: normalized.id,
                title: normalized.title,
                createdAt: normalized.createdAt,
                updatedAt: normalized.updatedAt,
                messageCount: normalized.messages?.length || 0
              });
            }
            resolve();
          };
          req.onerror = () => resolve();
        })
      );
      
      await Promise.all(promises);
      
      // Yield to the event loop between batches to keep UI responsive
      if (i + batchSize < missingIds.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (e) {
      console.error('Failed to load session metadata batch:', e);
    }
  }
}

/**
 * Get the current active session
 * Lazy loads from IndexedDB if not in memory
 * @returns {Promise<{id: string, title: string, messages: Array}>} Current session
 */
export function getCurrentSessionSync() {
  ensureDefaultSession();
  return getSession(getCurrentSessionId());
}

/**
 * Set the current active session and update order
 * Lazy loads session data if not in memory
 * @param {string} sessionId - Session ID to activate
 * @returns {Promise<void>}
 */
export async function setCurrentSession(sessionId) {
  // Check if session exists in metadata or loaded sessions
  if (!hasSession(sessionId)) {
    console.warn('Session not found:', sessionId);
    return;
  }

  const previousId = getCurrentSessionId();
  setCurrentSessionId(sessionId);
  if (previousId !== sessionId) markMetaDirty();

  // Lazy load session if not already loaded
  if (getLazyLoadEnabled() && !getSession(sessionId)) {
    const session = await loadSession(sessionId);
    if (session) {
      setSession(sessionId, session);
    }
  }

  const order = getSessionOrder();
  const idx = order.indexOf(sessionId);
  if (idx > 0) {
    order.splice(idx, 1);
    order.unshift(sessionId);
    setSessionOrder(order);
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
  return getSessionOrder().filter((id) => {
    if (!term) return true;
    const meta = getSessionMetaById(id) || getSession(id);
    // If metadata is missing, include it in results (will be loaded on-demand)
    if (!meta) return true;
    const haystack = `${meta.title || ''} ${meta.id}`.toLowerCase();
    return haystack.includes(term);
  });
}

/**
 * Create a new session, optionally copying from existing session
 * @param {string|null} baseSessionId - Session ID to copy from (optional)
 * @returns {{id: string, title: string, messages: Array}} New session
 */
export function createSessionFrom(baseSessionId = null) {
  const base = baseSessionId ? getSession(baseSessionId) : null;
  const session = createEmptySession(base ? `${base.title} copy` : 'New chat');
  if (base) {
    session.messages = base.messages.slice();
  }
  normalizeSession(session);
  setSession(session.id, session);
  setSessionMeta(session.id, {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length
  });
  const order = getSessionOrder();
  order.unshift(session.id);
  setSessionOrder(order);
  setCurrentSessionId(session.id);
  markSessionDirty(session.id);
  // Persist ordering + active session change separately
  markMetaDirty();

  // Remove oldest sessions if limit exceeded (batched in single transaction)
  if (order.length > MAX_SESSIONS) {
    const sessionsToRemove = order.slice(MAX_SESSIONS);
    
    // Batch IndexedDB deletes in single transaction with retry logic
    const batchDeleteOperation = async () => {
      const db = await dbPromise;
      return new Promise((resolve, reject) => {
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
        
        tx.oncomplete = resolve;
        tx.onerror = () => {
          console.error('Failed to batch delete old sessions', tx.error);
          reject(tx.error);
        };
      });
    };
    
    // Use retry queue for batch delete (less critical, but still should retry)
    retryQueue.enqueue(
      batchDeleteOperation,
      'delete',
      'batchDelete',
      sessionsToRemove,
      0
    ).catch(e => {
      console.error('Failed to batch delete old sessions (after retries):', e);
      // Continue with memory cleanup even if DB delete fails
    });
    
    // Clean memory synchronously
    sessionsToRemove.forEach(oldId => {
      deleteSessionFromState(oldId);
    });
    
    setSessionOrder(order.slice(0, MAX_SESSIONS));
    markMetaDirty();
  }

  return session;
}

/**
 * Delete a session
 * @param {string} sessionId - Session ID to delete
 */
export function deleteSession(sessionId) {
  if (!getSession(sessionId)) return;

  deleteSessionFromState(sessionId);

  const order = getSessionOrder().filter(id => id !== sessionId);
  setSessionOrder(order);
  markMetaDirty();

  if (getCurrentSessionId() === sessionId) {
    setCurrentSessionId(order[0] || null);
    markMetaDirty();
  }
  ensureDefaultSession();

  // Use retry queue with fallback storage for delete operation
  dbOp(STORES.SESSIONS, 'readwrite', store => store.delete(sessionId), {
    operationType: 'delete',
    fallbackData: sessionId
  }).catch(e => {
    console.error('Failed to delete session from IDB (will retry):', e);
    // Error is already handled by retry queue, but log for debugging
  });
  
  deleteAttachmentsForSession(sessionId);
}

/**
 * Add or replace a message in a session
 * @param {string} sessionId - Session ID
 * @param {{role: string, text: string, ts: number}} message - Message object
 * @param {number|null} replaceIndex - Index to replace (null to append)
 */
export function upsertMessage(sessionId, message, replaceIndex = null) {
  const session = getSession(sessionId);
  if (!session) return;

  // Centralized validation - single source of truth
  const validation = validateMessage(message);
  if (!validation.valid) {
    console.error(validation.error);
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
  setSession(sessionId, session);
  const meta = getSessionMetaById(sessionId);
  if (meta) {
    meta.messageCount = session.messages.length;
    meta.updatedAt = session.updatedAt;
    setSessionMeta(sessionId, meta);
  }
  markSessionDirty(sessionId);

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
  const session = getSession(sessionId);
  if (!session || !session.messages[messageIndex]) return;

  // Centralized validation - single source of truth
  const validation = validateMessagePatch(patch);
  if (!validation.valid) {
    console.error(validation.error);
    return;
  }

  const next = { ...session.messages[messageIndex], ...patch };
  let attachmentPromises = [];
  if (Array.isArray(next.attachments)) {
    const result = sanitizeMessageAttachments(sessionId, messageIndex, next.attachments);
    next.attachments = result.attachments;
    attachmentPromises = result.attachmentPromises;
  }

  // Recompute htmlCache only if text actually changed, clear if text is empty/removed
  if ('text' in patch) {
    const textChanged = session.messages[messageIndex].text !== patch.text;
    if (patch.text) {
      // Only recompute if text actually changed, otherwise preserve existing cache
      if (textChanged) {
        next.htmlCache = markdownToHtml(patch.text);
      } else if (session.messages[messageIndex].htmlCache) {
        // Text unchanged - preserve existing cache
        next.htmlCache = session.messages[messageIndex].htmlCache;
      }
    } else {
      delete next.htmlCache;
    }
  }

  session.messages[messageIndex] = next;
  session.updatedAt = Date.now();
  setSession(sessionId, session);
  const meta = getSessionMetaById(sessionId);
  if (meta) {
    meta.updatedAt = session.updatedAt;
    setSessionMeta(sessionId, meta);
  }
  markSessionDirty(sessionId);

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
  const session = getSession(sessionId);
  if (!session) return;
  session.title = title;
  session.updatedAt = Date.now();
  setSession(sessionId, session);
  const meta = getSessionMetaById(sessionId);
  if (meta) {
    setSessionMeta(sessionId, {
      ...meta,
      title,
      updatedAt: session.updatedAt
    });
  }
  markSessionDirty(sessionId);
}

/**
 * Save state to IndexedDB and chrome.storage.sync
 * @returns {Promise<void>}
 */
export async function saveState() {
  ensureDefaultSession();

  const hasSessionChanges = getDirtySessions().size > 0;
  const hasMetaChanges = metaDirty;

  if (hasSessionChanges || hasMetaChanges) {
    // Prepare data for fallback storage
    const sessionData = {};
    if (hasSessionChanges) {
      getDirtySessions().forEach(id => {
        const s = getSession(id);
        if (s) sessionData[id] = s;
      });
    }

    const metaData = {};
    if (hasMetaChanges) {
      metaData.sessionOrder = getSessionOrder();
      metaData.currentSessionId = getCurrentSessionId();
      metaData.contextSnapshots = getContextSnapshots();
      metaData.activeSnapshotId = getActiveSnapshotId();
    }

    // Wrap transaction in retry-able operation
    const saveOperation = async () => {
      const db = await dbPromise;
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.SESSIONS, STORES.META], 'readwrite');

        if (hasMetaChanges) {
          const metaStore = tx.objectStore(STORES.META);
          metaStore.put({ id: 'sessionOrder', val: getSessionOrder() });
          metaStore.put({ id: 'currentSessionId', val: getCurrentSessionId() });
          metaStore.put({ id: 'contextSnapshots', val: getContextSnapshots() });
          metaStore.put({ id: 'activeSnapshotId', val: getActiveSnapshotId() });
        }

        if (hasSessionChanges) {
          const sessionStore = tx.objectStore(STORES.SESSIONS);
          getDirtySessions().forEach(id => {
            const s = getSession(id);
            if (s) sessionStore.put(s);
          });
        }

        tx.oncomplete = () => {
          if (hasMetaChanges) metaDirty = false;
          if (hasSessionChanges) clearDirtySessions();
          resolve();
        };
        tx.onerror = (event) => {
          const error = tx.error || event.target.error;
          if (error?.name === 'QuotaExceededError') {
            handleError(error, {
              operation: 'IndexedDB save state',
              fallbackMessage: 'STORAGE_QUOTA_EXCEEDED',
              showToast: true,
              logError: true,
              showToastFn: (type, msg) => toast[type](msg)
            });
            reject(new Error(USER_ERROR_MESSAGES.STORAGE_QUOTA_EXCEEDED));
          } else {
            reject(error);
          }
        };
      });
    };

    try {
      await retryQueue.enqueue(
        saveOperation,
        'put',
        'saveState',
        { sessions: sessionData, meta: metaData },
        0
      );
    } catch (e) {
      console.warn('IDB Save Failed (after retries):', e);
      toast.error(USER_ERROR_MESSAGES.STORAGE_SAVE_FAILED);
      // Data should already be in fallback storage if retries failed
    }
  }

  // Save settings to chrome.storage.sync (separate from IndexedDB)
  const settingsPayload = {
    templates: getTemplates(),
    settings: getSettings()
  };
  try {
    await chrome.storage.sync.set({ [SYNC_KEY]: settingsPayload });
  } catch (e) {
    console.warn('Failed to save settings to chrome.storage.sync:', e);
  }
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
  if (getDirtySessions().size > 0 || metaDirty) {
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

// updateContextDraft is now exported from state.js, re-exported for backwards compatibility

/**
 * Save a reusable context snapshot
 * @param {{title?: string, url?: string, text: string, createdAt?: number}} payload - Snapshot data
 * @returns {object|null} Snapshot record
 */
export function addContextSnapshot(payload = {}) {
  // Centralized validation - single source of truth
  const validation = validateContextSnapshot(payload);
  if (!validation.valid) {
    console.error(validation.error);
    return null;
  }

  const snapshot = {
    id: payload.id || nanoid(),
    title: (payload.title || '').trim() || 'Saved page',
    url: payload.url || '',
    text: payload.text,
    createdAt: payload.createdAt || Date.now()
  };

  // Keep newest snapshots first and cap the list
  const snapshots = getContextSnapshots();
  const filtered = snapshots.filter(s => s.id !== snapshot.id);
  const updated = [snapshot, ...filtered].slice(0, MAX_CONTEXT_SNAPSHOTS);
  setContextSnapshots(updated);

  markMetaDirty();
  return snapshot;
}

/**
 * Remove a stored context snapshot
 * @param {string} id - Snapshot id
 * @returns {boolean} Whether a snapshot was removed
 */
export function removeContextSnapshot(id) {
  const snapshots = getContextSnapshots();
  const before = snapshots.length;
  const filtered = snapshots.filter(s => s.id !== id);
  setContextSnapshots(filtered);
  if (getActiveSnapshotId() === id) {
    setActiveSnapshotId(null);
  }
  if (before !== filtered.length) {
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
  setActiveSnapshotId(id);
  markMetaDirty();
}

/**
 * Get a snapshot by id
 * @param {string} id - Snapshot id
 * @returns {object|null} Snapshot record
 */
export function getContextSnapshotById(id) {
  return getContextSnapshots().find(s => s.id === id) || null;
}

/**
 * Get the currently active snapshot record
 * @returns {object|null} Active snapshot
 */
export function getActiveSnapshot() {
  const activeId = getActiveSnapshotId();
  if (!activeId) return null;
  return getContextSnapshotById(activeId);
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
      updateSettings(syncData[SYNC_KEY].settings || {});

      // Migration: Update old "concise" system prompt to new "detailed" default
      const settings = getSettings();
      if (settings.systemPrompt === 'You are a helpful, concise assistant.') {
        updateSettings({ systemPrompt: DEFAULT_SETTINGS.systemPrompt });
        // Save the migrated settings
        await chrome.storage.sync.set({ [SYNC_KEY]: { settings: getSettings(), templates: getTemplates() } });
      }

      if (syncData[SYNC_KEY].templates) setTemplates(syncData[SYNC_KEY].templates);
    }

    if (sessionData[SESSION_KEY]) {
      updateContextDraft(sessionData[SESSION_KEY]);
    }

    const tx = db.transaction([STORES.META], 'readonly');

    // Helper to promise-ify requests manually since we are inside a transaction
    const getVal = (store, key) => new Promise(r => {
       const req = store.get(key);
       req.onsuccess = () => r(req.result?.val);
       req.onerror = () => r(null);
    });

    const metaStore = tx.objectStore(STORES.META);

    const [order, currentId, snapshots, activeSnapshotId] = await Promise.all([
        getVal(metaStore, 'sessionOrder'),
        getVal(metaStore, 'currentSessionId'),
        getVal(metaStore, 'contextSnapshots'),
        getVal(metaStore, 'activeSnapshotId')
    ]);

    if (order) setSessionOrder(order);
    if (currentId) setCurrentSessionId(currentId);
    if (Array.isArray(snapshots)) setContextSnapshots(snapshots);
    if (activeSnapshotId) {
      const exists = (snapshots || []).some(s => s.id === activeSnapshotId);
      setActiveSnapshotId(exists ? activeSnapshotId : null);
    }

    // Enable lazy loading by default for better startup performance
    // Metadata will be loaded on-demand when needed
    setLazyLoadEnabled(true);

    // Only load the current session's full data initially
    if (currentId && order && order.length > 0) {
      const currentSession = await loadSession(currentId);
      if (currentSession) {
        setSession(currentId, currentSession);
        // Also set metadata for current session
        setSessionMeta(currentId, {
          id: currentSession.id,
          title: currentSession.title,
          createdAt: currentSession.createdAt,
          updatedAt: currentSession.updatedAt,
          messageCount: currentSession.messages?.length || 0
        });
      }
    }

  } catch (e) {
    console.warn('Failed to load state:', e);
  }

  ensureDefaultSession();
  return appState;
}

// Re-export state functions for backwards compatibility
export {
  addPendingAttachment,
  clearPendingAttachments,
  getPendingAttachments,
  removePendingAttachment,
  updateSettings,
  updateContextDraft
};


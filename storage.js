import { nanoid } from './utils.js';

const DB_NAME = 'NanoPromptDB';
const DB_VERSION = 1;
const STORES = {
  SESSIONS: 'sessions',
  META: 'meta'
};

const SYNC_KEY = 'nanoPromptUI.settings.v1';
const SESSION_KEY = 'nanoPromptUI.draft';
export const BLANK_TEMPLATE_ID = 'blank';

export const DEFAULT_TEMPLATES = [
  { id: BLANK_TEMPLATE_ID, label: 'Templates…', text: '' },
  { id: 'translator', label: 'Translate text', text: 'Translate the following text to English and explain any idioms:' },
  { id: 'proof', label: 'Proofread', text: 'You are a meticulous proofreader. Improve grammar and clarity for this text:' },
  { id: 'summary', label: 'Summarize', text: 'Summarize the following content in concise bullet points:' },
  { id: 'qa', label: 'Ask expert', text: 'You are an expert researcher. Answer thoroughly:' }
];

export const appState = {
  sessions: {},
  sessionOrder: [],
  currentSessionId: null,
  templates: DEFAULT_TEMPLATES.slice(),
  attachments: [],
  contextDraft: '',
  availability: 'unknown',
  settings: {
    temperature: 0.2,
    topK: 40,
    systemPrompt: 'You are a helpful, concise assistant.',
    tone: 'balanced'
  },
  model: null
};

const dirtySessions = new Set();

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

// FIXED: Transaction handling to prevent early resolution
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
    tx.onerror = () => reject(tx.error);
  });
}

function createEmptySession(title = 'New chat') {
  return {
    id: nanoid(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
}

function ensureDefaultSession() {
  if (!appState.currentSessionId || !appState.sessions[appState.currentSessionId]) {
    const session = createEmptySession();
    appState.sessions[session.id] = session;
    appState.sessionOrder = [session.id];
    appState.currentSessionId = session.id;
    dirtySessions.add(session.id); 
  }
}

export function getCurrentSession() {
  ensureDefaultSession();
  return appState.sessions[appState.currentSessionId];
}

export function setCurrentSession(sessionId) {
  if (!appState.sessions[sessionId]) return;
  appState.currentSessionId = sessionId;
  
  const idx = appState.sessionOrder.indexOf(sessionId);
  if (idx > 0) {
    appState.sessionOrder.splice(idx, 1);
    appState.sessionOrder.unshift(sessionId);
  }
}

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
  return session;
}

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

export function upsertMessage(sessionId, message, replaceIndex = null) {
  const session = appState.sessions[sessionId];
  if (!session) return;
  
  if (replaceIndex === null) {
    session.messages.push(message);
  } else {
    session.messages[replaceIndex] = message;
  }
  session.updatedAt = Date.now();
  dirtySessions.add(sessionId); 
}

export function updateMessage(sessionId, messageIndex, patch) {
  const session = appState.sessions[sessionId];
  if (!session || !session.messages[messageIndex]) return;
  session.messages[messageIndex] = { ...session.messages[messageIndex], ...patch };
  session.updatedAt = Date.now();
  dirtySessions.add(sessionId); 
}

export function renameSession(sessionId, title) {
  if (!appState.sessions[sessionId]) return;
  appState.sessions[sessionId].title = title;
  appState.sessions[sessionId].updatedAt = Date.now();
  dirtySessions.add(sessionId); 
}

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
  }

  const settingsPayload = {
    templates: appState.templates,
    settings: appState.settings
  };
  chrome.storage.sync.set({ [SYNC_KEY]: settingsPayload });
}

export async function saveContextDraft(text) {
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: text });
  } catch (e) {
    console.warn('Session draft save failed', e);
  }
}

export function updateContextDraft(text) {
  appState.contextDraft = text;
}

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

export function addAttachment(entry) {
  appState.attachments.push(entry);
}

export function clearAttachments() {
  appState.attachments = [];
}

export function getAttachments() {
  return appState.attachments;
}

export function updateSettings(patch) {
  appState.settings = { ...appState.settings, ...patch };
}

export function summarizeSession(sessionId) {
  const session = appState.sessions[sessionId];
  if (!session) return '';
  return session.messages.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.text}`).join('\n\n');
}
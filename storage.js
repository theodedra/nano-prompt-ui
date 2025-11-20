import { nanoid } from './utils.js';

const LOCAL_KEY = 'nanoPromptUI.sessions.v3';
const SYNC_KEY = 'nanoPromptUI.sessionMeta.v1';
// NEW: Key for session-only storage (RAM based)
const DRAFT_KEY = 'nanoPromptUI.draft';

// REFACTOR: Export constant to avoid magic strings in UI
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
  contextDraft: '', // Now backed by storage.session
  downloading: null,
  availability: 'unknown',
  settings: {
    temperature: 0.2,
    topK: 40,
    systemPrompt: 'You are a helpful, concise assistant.',
    tone: 'balanced'
  },
  model: null
};

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
  return session;
}

export function deleteSession(sessionId) {
  if (!appState.sessions[sessionId]) return;
  delete appState.sessions[sessionId];
  appState.sessionOrder = appState.sessionOrder.filter(id => id !== sessionId);
  if (appState.currentSessionId === sessionId) {
    appState.currentSessionId = appState.sessionOrder[0] || null;
  }
  ensureDefaultSession();
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
}

export function updateMessage(sessionId, messageIndex, patch) {
  const session = appState.sessions[sessionId];
  if (!session || !session.messages[messageIndex]) return;
  session.messages[messageIndex] = { ...session.messages[messageIndex], ...patch };
  session.updatedAt = Date.now();
}

export async function saveState() {
  ensureDefaultSession();
  // OPTIMIZATION: contextDraft is removed from local storage payload
  // to prevent disk thrashing. It lives in session storage now.
  const payload = {
    sessions: appState.sessions,
    sessionOrder: appState.sessionOrder,
    currentSessionId: appState.currentSessionId,
    templates: appState.templates,
    settings: appState.settings
    // contextDraft is intentionally excluded
  };
  try {
    await chrome.storage.local.set({ [LOCAL_KEY]: payload });
  } catch (e) {
    console.warn('Failed to persist local state', e);
  }
  try {
    const meta = appState.sessionOrder.map(id => {
      const s = appState.sessions[id];
      return s ? { id, title: s.title, updatedAt: s.updatedAt } : null;
    }).filter(Boolean);
    await chrome.storage.sync.set({ [SYNC_KEY]: meta.slice(0, 20) });
  } catch (e) {
    console.warn('Failed to sync metadata', e);
  }
}

// NEW: Dedicated function for saving high-frequency draft text
export async function saveContextDraft(text) {
  try {
    await chrome.storage.session.set({ [DRAFT_KEY]: text });
  } catch (e) {
    console.warn('Failed to save session draft', e);
  }
}

export async function loadState() {
  try {
    // OPTIMIZATION: Load Disk (Local) and RAM (Session) in parallel
    const [localData, sessionData] = await Promise.all([
      chrome.storage.local.get(LOCAL_KEY),
      chrome.storage.session.get(DRAFT_KEY)
    ]);

    const stored = localData[LOCAL_KEY];
    const draft = sessionData[DRAFT_KEY];

    if (stored) {
      Object.assign(appState, {
        sessions: stored.sessions || {},
        sessionOrder: stored.sessionOrder || [],
        currentSessionId: stored.currentSessionId || null,
        templates: stored.templates?.length ? stored.templates : DEFAULT_TEMPLATES.slice(),
        settings: { ...appState.settings, ...(stored.settings || {}) },
        contextDraft: draft || '' // Hydrate from session storage
      });
    } else if (draft) {
      appState.contextDraft = draft;
    }
  } catch (e) {
    console.warn('Failed to load state', e);
  }
  ensureDefaultSession();
  return {
    sessions: appState.sessions,
    order: appState.sessionOrder,
    current: appState.currentSessionId,
    templates: appState.templates,
    settings: appState.settings,
    contextDraft: appState.contextDraft
  };
}

export function updateContextDraft(text) {
  appState.contextDraft = text;
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

export function renameSession(sessionId, title) {
  if (!appState.sessions[sessionId]) return;
  appState.sessions[sessionId].title = title;
  appState.sessions[sessionId].updatedAt = Date.now();
}

export function summarizeSession(sessionId) {
  const session = appState.sessions[sessionId];
  if (!session) return '';
  return session.messages.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.text}`).join('\n\n');
}
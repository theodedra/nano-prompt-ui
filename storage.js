// storage.js - Robust session persistence, sync metadata, and UI templates

import { nanoid } from './utils.js';

const LOCAL_KEY = 'nanoPromptUI.sessions.v3';
const SYNC_KEY = 'nanoPromptUI.sessionMeta.v1';

/**
 * Default prompt templates surfaced in the UI.
 */
export const DEFAULT_TEMPLATES = [
  { id: 'blank', label: 'Templates…', text: '' },
  { id: 'translator', label: 'Translate text', text: 'Translate the following text to English and explain any idioms:' },
  { id: 'proof', label: 'Proofread', text: 'You are a meticulous proofreader. Improve grammar and clarity for this text:' },
  { id: 'summary', label: 'Summarize', text: 'Summarize the following content in concise bullet points:' },
  { id: 'qa', label: 'Ask expert', text: 'You are an expert researcher. Answer thoroughly:' }
];

/**
 * Global application state that survives module boundaries while the popup is open.
 */
export const appState = {
  sessions: {},               // { [id]: { id, title, tags, createdAt, updatedAt, messages: [] } }
  sessionOrder: [],           // Maintains ordering for tabs/sidebar
  currentSessionId: null,
  language: 'en',
  templates: DEFAULT_TEMPLATES.slice(),
  attachments: [],            // Pending image/audio attachments for the next prompt
  contextDraft: '',           // Editable context override text
  downloading: null,          // { status: 'downloading', progress: 0-1 }
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
    tags: [],
    rating: null,
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
    session.tags = base.tags.slice();
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
  const payload = {
    sessions: appState.sessions,
    sessionOrder: appState.sessionOrder,
    currentSessionId: appState.currentSessionId,
    language: appState.language,
    templates: appState.templates,
    settings: appState.settings,
    contextDraft: appState.contextDraft
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

export async function loadState() {
  try {
    const stored = (await chrome.storage.local.get(LOCAL_KEY))[LOCAL_KEY];
    if (stored) {
      Object.assign(appState, {
        sessions: stored.sessions || {},
        sessionOrder: stored.sessionOrder || [],
        currentSessionId: stored.currentSessionId || null,
        language: stored.language || 'en',
        templates: stored.templates?.length ? stored.templates : DEFAULT_TEMPLATES.slice(),
        settings: { ...appState.settings, ...(stored.settings || {}) },
        contextDraft: stored.contextDraft || ''
      });
    }
  } catch (e) {
    console.warn('Failed to load state', e);
  }
  ensureDefaultSession();
  return {
    sessions: appState.sessions,
    order: appState.sessionOrder,
    current: appState.currentSessionId,
    language: appState.language,
    templates: appState.templates,
    settings: appState.settings,
    contextDraft: appState.contextDraft
  };
}

export function setLanguage(langCode) {
  appState.language = langCode;
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

export function tagSession(sessionId, tags = []) {
  if (!appState.sessions[sessionId]) return;
  appState.sessions[sessionId].tags = tags;
}

export function setSessionRating(sessionId, messageIndex, rating) {
  const session = appState.sessions[sessionId];
  if (!session) return;
  if (session.messages[messageIndex]) {
    session.messages[messageIndex].rating = rating;
  }
}

export function summarizeSession(sessionId) {
  const session = appState.sessions[sessionId];
  if (!session) return '';
  return session.messages.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.text}`).join('\n\n');
}
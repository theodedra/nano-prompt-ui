/**
 * Session Controller
 * 
 * Handles session management operations: creation, switching, deletion, renaming, and search.
 */

import {
  getCurrentSessionSync,
  getSessions,
  getSessionMeta,
  getCurrentSessionId as getStoredCurrentSessionId,
  setCurrentSession,
  createSessionFrom,
  deleteSession,
  renameSession,
  searchSessions,
  loadSessionMetadata,
  scheduleSaveState,
  flushSaveState
} from '../storage.js';
import * as UI from '../ui/index.js';
import { uiState } from '../ui/state.js';
import { toast } from '../toast.js';
import { renderCurrentLog } from './message-controller.js';

/**
 * Get the current session
 */
export function getCurrentSession() {
  return getCurrentSessionSync();
}

/**
 * Switch to a different session
 */
export async function switchSession(sessionId) {
  await setCurrentSession(sessionId);
  await flushSaveState(); // Immediate save for user action
  renderSessionsList();
  renderCurrentLog();
  UI.closeMenu('session');
}

/**
 * Create a new session
 */
export async function createNewSession() {
  const session = createSessionFrom();
  await setCurrentSession(session.id);
  await flushSaveState(); // Immediate save for user action
  renderSessionsList();
  renderCurrentLog();
  UI.closeMenu('session');
  return session;
}

/**
 * Remove a session
 */
export async function removeSession(sessionId) {
  deleteSession(sessionId);
  await flushSaveState(); // Immediate save for destructive action
  renderSessionsList();
  renderCurrentLog();
  toast.success('Chat deleted');
}

/**
 * Rename a session by ID
 */
export async function renameSessionById(sessionId, newTitle) {
  renameSession(sessionId, newTitle);
  await flushSaveState(); // Immediate save for user action
  renderSessionsList();
  toast.success('Chat renamed');
}

/**
 * Filter/search sessions
 */
export function filterSessions(query) {
  return searchSessions(query);
}

/**
 * Set session search term
 */
export function setSessionSearchTerm(term) {
  uiState.sessionSearchTerm = term;
  UI.setSessionSearchTerm(term);
}

/**
 * Get session search term
 */
export function getSessionSearchTerm() {
  return uiState.sessionSearchTerm;
}

/**
 * Render the sessions list
 */
export async function renderSessionsList(confirmingId = null, editingId = null) {
  const current = getCurrentSessionSync();
  const matches = searchSessions(uiState.sessionSearchTerm);
  const sessionMeta = getSessionMeta();
  
  // Load metadata on-demand for visible sessions (first 50 or all if fewer)
  // This happens asynchronously and won't block the initial render
  const visibleIds = matches.slice(0, 50);
  const hasMissingMetadata = visibleIds.some(id => !sessionMeta[id]);
  
  if (hasMissingMetadata) {
    // Load metadata asynchronously and re-render when done
    loadSessionMetadata(visibleIds).then(() => {
      const currentAfter = getCurrentSessionSync();
      UI.renderSessions({
        sessions: getSessions(),
        sessionMeta: getSessionMeta(),
        currentSessionId: getStoredCurrentSessionId(),
        currentTitle: currentAfter?.title,
        matches,
        searchTerm: uiState.sessionSearchTerm,
        confirmingId,
        editingId
      });
    }).catch(err => {
      console.error('Failed to load session metadata:', err);
    });
  }
  
  // Initial render with whatever metadata we have
  UI.renderSessions({
    sessions: getSessions(),
    sessionMeta: sessionMeta,
    currentSessionId: getStoredCurrentSessionId(),
    currentTitle: current?.title,
    matches,
    searchTerm: uiState.sessionSearchTerm,
    confirmingId,
    editingId
  });
}

/**
 * Update session title (for background operations)
 */
export async function updateSessionTitle(sessionId, title) {
  renameSession(sessionId, title);
  scheduleSaveState(); // Debounced save for background operation
  renderSessionsList();
}

/**
 * Get current session ID
 */
export function getCurrentSessionId() {
  return getStoredCurrentSessionId();
}

/**
 * Get a session by ID
 */
export function getSession(sessionId) {
  return getSessions()[sessionId];
}

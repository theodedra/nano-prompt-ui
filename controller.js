/**
 * Controller Layer
 * 
 * Mediates between Model (AI), Storage, and UI layers.
 * - Model knows nothing about UI or storage
 * - UI handlers dispatch here instead of touching storage directly
 * - All state mutations go through this layer
 */

import * as UI from './ui.js';
import {
  appState,
  getCurrentSessionSync,
  upsertMessage,
  updateMessage,
  scheduleSaveState,
  flushSaveState,
  renameSession,
  searchSessions,
  setCurrentSession,
  createSessionFrom,
  deleteSession,
  updateContextDraft,
  saveContextDraft,
  addPendingAttachment,
  clearPendingAttachments,
  getPendingAttachments,
  removePendingAttachment,
  updateSettings,
  addContextSnapshot,
  getContextSnapshotById,
  getActiveSnapshot,
  removeContextSnapshot,
  setActiveSnapshot,
  BLANK_TEMPLATE_ID
} from './storage.js';
import { toast } from './toast.js';
import {
  UI_MESSAGES,
  USER_ERROR_MESSAGES,
  DEFAULT_SETTINGS,
  LIMITS,
  TIMING,
  getSettingOrDefault
} from './constants.js';

// --- SESSION MANAGEMENT ---

/**
 * Get current session (sync)
 */
export function getCurrentSession() {
  return getCurrentSessionSync();
}

/**
 * Switch to a different session
 * @param {string} sessionId 
 */
export async function switchSession(sessionId) {
  await setCurrentSession(sessionId);
  await flushSaveState(); // Immediate save for user action
  renderSessionsList();
  renderCurrentLog();
  UI.closeMenu('session');
}

/**
 * Create a new chat session
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
 * Delete a session by ID
 * @param {string} sessionId 
 */
export async function removeSession(sessionId) {
  deleteSession(sessionId);
  await flushSaveState(); // Immediate save for destructive action
  renderSessionsList();
  renderCurrentLog();
  toast.success('Chat deleted');
}

/**
 * Rename a session
 * @param {string} sessionId 
 * @param {string} newTitle 
 */
export async function renameSessionById(sessionId, newTitle) {
  renameSession(sessionId, newTitle);
  await flushSaveState(); // Immediate save for user action
  renderSessionsList();
  toast.success('Chat renamed');
}

/**
 * Search sessions by query
 * @param {string} query 
 * @returns {string[]} Matching session IDs
 */
export function filterSessions(query) {
  return searchSessions(query);
}

// --- UI RENDERING (passthrough) ---

let sessionSearchTerm = '';

export function setSessionSearchTerm(term) {
  sessionSearchTerm = term;
  UI.setSessionSearchTerm(term);
}

export function getSessionSearchTerm() {
  return sessionSearchTerm;
}

export function renderSessionsList(confirmingId = null) {
  const current = getCurrentSessionSync();
  const matches = searchSessions(sessionSearchTerm);
  UI.renderSessions({
    sessions: appState.sessions,
    sessionMeta: appState.sessionMeta,
    currentSessionId: appState.currentSessionId,
    currentTitle: current?.title,
    matches,
    searchTerm: sessionSearchTerm,
    confirmingId
  });
}

export function renderCurrentLog() {
  UI.renderLog(getCurrentSessionSync());
}

export function renderSmartReplies(replies) {
  UI.renderSmartReplies(replies);
}

// --- MESSAGE MANAGEMENT ---

/**
 * Add a message to a session
 * @param {string} sessionId 
 * @param {{role: string, text: string, ts: number, attachments?: Array}} message 
 */
export function addMessage(sessionId, message) {
  upsertMessage(sessionId, message);
}

/**
 * Update an existing message
 * @param {string} sessionId 
 * @param {number} index 
 * @param {object} patch 
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

// --- STATUS & BUSY STATE ---

export function setStatus(text) {
  UI.setStatusText(text);
}

export function setBusy(busy) {
  UI.setBusy(busy);
}

export function setStopEnabled(enabled) {
  UI.setStopEnabled(enabled);
}

// --- CONTEXT MANAGEMENT ---

export function setContextText(text) {
  UI.setContextText(text);
}

export function getContextText() {
  return UI.getContextText();
}

export function setContextDraft(text) {
  updateContextDraft(text);
}

export async function persistContextDraft(text) {
  await saveContextDraft(text);
}

export function setRestrictedState(restricted) {
  UI.setRestrictedState(restricted);
}

export function renderContextUI() {
  UI.renderContextSnapshots(appState.contextSnapshots, appState.activeSnapshotId);
  UI.setContextSourceLabel(getActiveSnapshot());
}

// --- CONTEXT SNAPSHOTS ---

export function saveSnapshot(payload) {
  return addContextSnapshot(payload);
}

export function getSnapshotById(id) {
  return getContextSnapshotById(id);
}

export function deleteSnapshot(id) {
  return removeContextSnapshot(id);
}

export function activateSnapshot(id) {
  setActiveSnapshot(id);
}

export function getActiveContextSnapshot() {
  return getActiveSnapshot();
}

// --- ATTACHMENTS ---

export function getAttachments() {
  return getPendingAttachments().slice();
}

export function addAttachment(entry) {
  addPendingAttachment(entry);
}

export function removeAttachment(index) {
  removePendingAttachment(index);
}

export function clearAttachments() {
  clearPendingAttachments();
  UI.renderPendingAttachments(getPendingAttachments());
}

export function renderAttachments() {
  UI.renderPendingAttachments(getPendingAttachments());
}

// --- SETTINGS ---

export function getSettings() {
  return appState.settings;
}

export function patchSettings(patch) {
  updateSettings(patch);
}

export function getSetting(key) {
  return getSettingOrDefault(appState.settings, key);
}

// --- DIAGNOSTICS & AVAILABILITY ---

export function updateAvailabilityDisplay(status, checkedAt, diag = {}) {
  const label = describeAvailability(status);
  appState.availability = status || 'unknown';
  appState.availabilityCheckedAt = checkedAt || null;
  
  UI.setStatusText(label);
  UI.setHardwareStatus(`Gemini Nano: ${label}`);
  UI.updateDiagnostics({
    ...diag,
    availability: status,
    availabilityCheckedAt: checkedAt,
    availabilityLabel: label
  });
  
  return label;
}

/**
 * Update model status chip with diagnostic summary
 * @param {Object} status - Model status from getModelStatusSummary()
 */
export function updateModelStatusChip(status) {
  UI.updateModelStatusChip(status);
}

function describeAvailability(status) {
  if (status === 'readily') return UI_MESSAGES.READY;
  if (status === 'after-download') return 'After download';
  if (status === 'no') return UI_MESSAGES.PAGE_MODE;
  if (!status) return 'Unknown';
  return status;
}

export function hasCachedAvailability() {
  return Boolean(
    appState.availability &&
    appState.availability !== 'unknown' &&
    appState.availabilityCheckedAt
  );
}

// --- CHAT LOG UPDATES (for streaming) ---

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
 * Render the full chat log
 */
export function refreshLog() {
  const session = getCurrentSessionSync();
  UI.renderLog(session);
}

// --- TEMPLATES ---

export function getTemplates() {
  return appState.templates;
}

export function updateTemplatesUI() {
  UI.updateTemplates(appState.templates, BLANK_TEMPLATE_ID);
}

// --- THEME ---

export function applyTheme(theme) {
  UI.applyTheme(theme);
}

// --- INPUT ---

export function getInputValue() {
  return UI.getInputValue();
}

export function setInputValue(value) {
  UI.setInputValue(value);
}

export function focusInput() {
  UI.focusInput();
}

// --- MISC UI ---

export function closeMenu(menuId) {
  UI.closeMenu(menuId);
}

export function toggleMenu(menuId) {
  UI.toggleMenu(menuId);
}

export function isModalOpen() {
  return UI.isModalOpen();
}

export function closeModal() {
  UI.closeModal();
}

export function openContextModal() {
  UI.openContextModal();
}

export function downloadBlob(blob, filename) {
  UI.downloadBlob(blob, filename);
}

export function setMicState(active) {
  UI.setMicState(active);
}

export function restoreStopButtonState(isRunning) {
  UI.restoreStopButtonState(isRunning);
}

export function getTrapContainer() {
  return UI.getTrapContainer();
}

export function trapFocus(event, container) {
  UI.trapFocus(event, container);
}

// --- TITLE GENERATION ---

/**
 * Update session title after AI generates it
 * @param {string} sessionId 
 * @param {string} title 
 */
export async function updateSessionTitle(sessionId, title) {
  renameSession(sessionId, title);
  scheduleSaveState(); // Debounced save for background operation
  renderSessionsList();
}

// --- TOAST NOTIFICATIONS ---

export function showToast(type, message) {
  toast[type](message);
}

// --- APP STATE ACCESS (read-only where possible) ---

export function getCurrentSessionId() {
  return appState.currentSessionId;
}

export function getSession(sessionId) {
  return appState.sessions[sessionId];
}

export function getAvailability() {
  return appState.availability;
}

export function getAvailabilityCheckedAt() {
  return appState.availabilityCheckedAt;
}


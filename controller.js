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
  // State getters/setters
  getSessions,
  getSessionMeta,
  getCurrentSessionId as getStoredCurrentSessionId,
  getTemplates as getStoredTemplates,
  getContextSnapshots,
  getActiveSnapshotId,
  getAvailability as getStoredAvailability,
  setAvailability,
  getAvailabilityCheckedAt as getStoredAvailabilityCheckedAt,
  setAvailabilityCheckedAt,
  getSettings as getStoredSettings,
  // Session operations
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
  // Context operations
  updateContextDraft,
  saveContextDraft,
  // Attachment operations
  addPendingAttachment,
  clearPendingAttachments,
  getPendingAttachments,
  removePendingAttachment,
  // Settings
  updateSettings,
  // Snapshots
  addContextSnapshot,
  getContextSnapshotById,
  getActiveSnapshot,
  removeContextSnapshot,
  setActiveSnapshot,
  // Template operations
  addTemplate as addStorageTemplate,
  updateTemplate as updateStorageTemplate,
  deleteTemplate as deleteStorageTemplate,
  resetTemplates as resetStorageTemplates,
  // Constants
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

export function getCurrentSession() {
  return getCurrentSessionSync();
}

export async function switchSession(sessionId) {
  await setCurrentSession(sessionId);
  await flushSaveState(); // Immediate save for user action
  renderSessionsList();
  renderCurrentLog();
  UI.closeMenu('session');
}

export async function createNewSession() {
  const session = createSessionFrom();
  await setCurrentSession(session.id);
  await flushSaveState(); // Immediate save for user action
  renderSessionsList();
  renderCurrentLog();
  UI.closeMenu('session');
  return session;
}

export async function removeSession(sessionId) {
  deleteSession(sessionId);
  await flushSaveState(); // Immediate save for destructive action
  renderSessionsList();
  renderCurrentLog();
  toast.success('Chat deleted');
}

export async function renameSessionById(sessionId, newTitle) {
  renameSession(sessionId, newTitle);
  await flushSaveState(); // Immediate save for user action
  renderSessionsList();
  toast.success('Chat renamed');
}

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

export function renderSessionsList(confirmingId = null, editingId = null) {
  const current = getCurrentSessionSync();
  const matches = searchSessions(sessionSearchTerm);
  UI.renderSessions({
    sessions: getSessions(),
    sessionMeta: getSessionMeta(),
    currentSessionId: getStoredCurrentSessionId(),
    currentTitle: current?.title,
    matches,
    searchTerm: sessionSearchTerm,
    confirmingId,
    editingId
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
  UI.renderContextSnapshots(getContextSnapshots(), getActiveSnapshotId());
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
  return getStoredSettings();
}

export function patchSettings(patch) {
  updateSettings(patch);
}

export function getSetting(key) {
  return getSettingOrDefault(getStoredSettings(), key);
}

// --- DIAGNOSTICS & AVAILABILITY ---

export function updateAvailabilityDisplay(status, checkedAt, diag = {}) {
  const label = describeAvailability(status);
  setAvailability(status);
  setAvailabilityCheckedAt(checkedAt);
  
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
  if (status === 'after-download' || status === 'downloading') return 'Downloading...';
  if (status === 'no') return UI_MESSAGES.PAGE_MODE;
  if (!status) return 'Unknown';
  return status;
}

export function hasCachedAvailability() {
  const availability = getStoredAvailability();
  return Boolean(
    availability &&
    availability !== 'unknown' &&
    getStoredAvailabilityCheckedAt()
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

export function refreshLog() {
  const session = getCurrentSessionSync();
  UI.renderLog(session);
}

// --- TEMPLATES ---

export function getTemplates() {
  return getStoredTemplates();
}

export function updateTemplatesUI(editingId = null) {
  UI.updateTemplates(getStoredTemplates(), BLANK_TEMPLATE_ID, editingId);
}

export function addTemplate(label, text) {
  const template = addStorageTemplate(label, text);
  scheduleSaveState();
  return template;
}

export function patchTemplate(id, patch) {
  const result = updateStorageTemplate(id, patch);
  if (result) {
    scheduleSaveState();
  }
  return result;
}

export function removeTemplate(id) {
  const result = deleteStorageTemplate(id);
  if (result) {
    scheduleSaveState();
  }
  return result;
}

export function resetAllTemplates() {
  resetStorageTemplates();
  scheduleSaveState();
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
  return getStoredCurrentSessionId();
}

export function getSession(sessionId) {
  return getSessions()[sessionId];
}

export function getAvailability() {
  return getStoredAvailability();
}

export function getAvailabilityCheckedAt() {
  return getStoredAvailabilityCheckedAt();
}


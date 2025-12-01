import * as Model from './model.js';
import * as Storage from './storage.js';
import * as UI from './ui.js';

const uiBridge = {
  setStatusText: UI.setStatusText,
  setHardwareStatus: UI.setHardwareStatus,
  updateDiagnostics: UI.updateDiagnostics,
  renderLog: UI.renderLog,
  renderSmartReplies: UI.renderSmartReplies,
  renderSessions: UI.renderSessions,
  updateLastMessageBubble: UI.updateLastMessageBubble,
  setBusy: UI.setBusy,
  setStopEnabled: UI.setStopEnabled,
  getSessionSearchTerm: UI.getSessionSearchTerm
};

let controllerReady = false;

function ensureControllerReady() {
  if (controllerReady) return;
  Model.attachUIBridge(uiBridge);
  controllerReady = true;
}

export function initController() {
  ensureControllerReady();
}

export const appState = Storage.appState;
export const BLANK_TEMPLATE_ID = Storage.BLANK_TEMPLATE_ID;
export const DEFAULT_TEMPLATES = Storage.DEFAULT_TEMPLATES;

// Storage wrappers
export const loadState = () => Storage.loadState();
export const saveState = () => Storage.saveState();
export const createSessionFrom = (baseId = null) => Storage.createSessionFrom(baseId);
export const deleteSession = (sessionId) => Storage.deleteSession(sessionId);
export const setCurrentSession = (sessionId) => Storage.setCurrentSession(sessionId);
export const getCurrentSessionSync = () => Storage.getCurrentSessionSync();
export const clearPendingAttachments = () => Storage.clearPendingAttachments();
export const getPendingAttachments = () => Storage.getPendingAttachments();
export const updateContextDraft = (text) => Storage.updateContextDraft(text);
export const saveContextDraft = (text) => Storage.saveContextDraft(text);
export const renameSession = (sessionId, title) => Storage.renameSession(sessionId, title);
export const searchSessions = (term = '') => Storage.searchSessions(term);
export const summarizeSession = (sessionId) => Storage.summarizeSession(sessionId);
export const addContextSnapshot = (payload) => Storage.addContextSnapshot(payload);
export const getContextSnapshotById = (id) => Storage.getContextSnapshotById(id);
export const getActiveSnapshot = () => Storage.getActiveSnapshot();
export const removeContextSnapshot = (id) => Storage.removeContextSnapshot(id);
export const setActiveSnapshot = (id) => Storage.setActiveSnapshot(id);

// Model wrappers
export const runPrompt = (payload) => { ensureControllerReady(); return Model.runPrompt(payload); };
export const summarizeActiveTab = () => { ensureControllerReady(); return Model.summarizeActiveTab(); };
export const cancelGeneration = () => { ensureControllerReady(); return Model.cancelGeneration(); };
export const speakText = (text) => { ensureControllerReady(); return Model.speakText(text); };
export const resetModel = (sessionId = null) => { ensureControllerReady(); return Model.resetModel(sessionId); };
export const isSomethingRunning = () => { ensureControllerReady(); return Model.isSomethingRunning(); };
export const refreshAvailability = (opts) => { ensureControllerReady(); return Model.refreshAvailability(opts); };

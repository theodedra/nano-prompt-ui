// UI Module - Re-exports all public APIs from the split UI modules
// This provides a single entry point for backwards compatibility

// Core state and initialization
export {
  initUI,
  getEls,
  getWrapEl,
  getChatCardEl,
  getInputCardEl,
  getScrollObserver,
  getVirtualScroller,
  getLastStatus,
  getIsSystemBusy,
  applyTheme,
  setBusy,
  setStatusText,
  setRestrictedState,
  updateModelStatusChip,
  handleModelStatusChipClick,
  setHardwareStatus,
  updateDiagnostics,
  setDiagnosticsBusy,
  updateAvailabilityDisplay,
  setContextText,
  getContextText,
  toggleMenu,
  closeMenu,
  setMicState,
  setInputError,
  getInputValue,
  setInputValue,
  setStopEnabled,
  restoreStopButtonState,
  focusInput,
  setLanguageSelection,
  setThemeSelection,
  syncSettingsForm,
  getSettingsFormValues,
  downloadBlob,
  setExportAvailability,
  setOpenSetupGuideModalCallback,
  setBuildContextSnapshotUICallback,
  setCreateMessageElementCallback
} from './core.js';

// Log rendering
export {
  renderLog,
  updateLastMessageBubble,
  renderSmartReplies,
  createMessageElement,
  buildSmartReplyRow,
  scrollToBottom,
  observeLastMessage
} from './log-renderer.js';

// Session rendering
export {
  renderSessions,
  setSessionSearchTerm,
  getSessionSearchTerm
} from './session-renderer.js';

// Template rendering
export {
  updateTemplates,
  getTemplateEditValues,
  setAddingNewTemplate
} from './template-renderer.js';

// Modal management
export {
  trapFocus,
  getTrapContainer,
  openSettingsModal,
  openContextModal,
  openSetupGuideModal,
  closeModal,
  isModalOpen,
  setSetupGuideContent,
  renderSetupGuide
} from './modal-manager.js';

// Attachment rendering
export {
  formatPdfTruncationNote,
  renderPendingAttachments,
  triggerFilePicker
} from './attachment-renderer.js';

// Snapshot rendering
export {
  buildContextSnapshotUI,
  setContextSourceLabel,
  renderContextSnapshots
} from './snapshot-renderer.js';

// Initialize cross-module callbacks
import { setOpenSetupGuideModalCallback, setBuildContextSnapshotUICallback, setCreateMessageElementCallback } from './core.js';
import { openSetupGuideModal } from './modal-manager.js';
import { buildContextSnapshotUI } from './snapshot-renderer.js';
import { createMessageElement } from './log-renderer.js';

// Wire up callbacks before initUI is called
setOpenSetupGuideModalCallback(openSetupGuideModal);
setBuildContextSnapshotUICallback(buildContextSnapshotUI);
setCreateMessageElementCallback(createMessageElement);



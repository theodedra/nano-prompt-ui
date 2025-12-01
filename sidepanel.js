/**
 * Side Panel Entry Point
 * 
 * Wires up UI event bindings and bootstraps the application.
 */

import * as UI from './ui.js';
import * as ChatHandlers from './chat-handlers.js';
import * as AttachmentHandlers from './attachment-handlers.js';
import * as SettingsHandlers from './settings-handlers.js';

function bind(selector, event, handler) {
  const el = document.querySelector(selector);
  if (el) el.addEventListener(event, handler);
}

document.addEventListener('DOMContentLoaded', async () => {
  UI.initUI();
  await ChatHandlers.bootstrap();
  await ChatHandlers.refreshAvailability({ forceCheck: true });

  // --- EVENT BINDINGS ---
  const bindings = [
    { sel: '#ask', ev: 'click', fn: ChatHandlers.handleAskClick },
    { sel: '#sum', ev: 'click', fn: ChatHandlers.handleSummarizeClick },
    { sel: '#copy', ev: 'click', fn: ChatHandlers.handleCopyChatClick },
    { sel: '#save-md', ev: 'click', fn: ChatHandlers.handleSaveMarkdown },
    { sel: '#log', ev: 'click', fn: ChatHandlers.handleLogClick },
    
    // Dropdown Triggers (Generic)
    { sel: '#templates-trigger', ev: 'click', fn: ChatHandlers.handleTemplatesTriggerClick },
    { sel: '#templates-menu', ev: 'click', fn: ChatHandlers.handleTemplateSelect },
    { sel: '#session-trigger', ev: 'click', fn: ChatHandlers.handleSessionTriggerClick },
    { sel: '#session-menu', ev: 'click', fn: ChatHandlers.handleSessionMenuClick },
    { sel: '#session-search', ev: 'input', fn: ChatHandlers.handleSessionSearchInput },
    { sel: '#new-session', ev: 'click', fn: ChatHandlers.handleNewSessionClick },
    { sel: '#language-trigger', ev: 'click', fn: SettingsHandlers.handleLanguageTriggerClick },
    { sel: '#language-menu', ev: 'click', fn: SettingsHandlers.handleLanguageSelect },
    { sel: '#theme-trigger', ev: 'click', fn: SettingsHandlers.handleThemeTriggerClick },
    { sel: '#theme-menu', ev: 'click', fn: SettingsHandlers.handleThemeSelect },

    // Media & Inputs
    { sel: '#attach', ev: 'click', fn: AttachmentHandlers.handleAttachClick },
    { sel: '#file-input', ev: 'change', fn: AttachmentHandlers.handleFileInputChange },
    { sel: '#attachment-list', ev: 'click', fn: AttachmentHandlers.handleAttachmentListClick },
    { sel: '#mic', ev: 'click', fn: ChatHandlers.handleMicClick },
    { sel: '#speak-last', ev: 'click', fn: ChatHandlers.handleSpeakLast },
    { sel: '#stop', ev: 'click', fn: ChatHandlers.handleStopClick },
    
    // Context
    { sel: '#toggle-context', ev: 'click', fn: ChatHandlers.handleToggleContext },
    { sel: '#context-text', ev: 'input', fn: ChatHandlers.handleContextInput },
    { sel: '#context-text', ev: 'blur', fn: ChatHandlers.handleContextBlur },
    { sel: '#context-modal', ev: 'click', fn: ChatHandlers.handleModalClick },
    { sel: '#save-context-snapshot', ev: 'click', fn: ChatHandlers.handleSaveSnapshotClick },
    { sel: '#use-live-context', ev: 'click', fn: ChatHandlers.handleUseLiveContext },
    { sel: '#context-snapshot-list', ev: 'click', fn: ChatHandlers.handleSnapshotListClick },

    // Settings
    { sel: '#open-settings', ev: 'click', fn: SettingsHandlers.handleOpenSettings },
    { sel: '#close-settings', ev: 'click', fn: SettingsHandlers.handleCloseSettings },
    { sel: '#save-settings', ev: 'click', fn: SettingsHandlers.handleSaveSettings },
    { sel: '#settings-modal', ev: 'click', fn: ChatHandlers.handleModalClick },
    { sel: '#refresh-diagnostics', ev: 'click', fn: SettingsHandlers.handleDiagnosticsRefresh },
    { sel: '#warmup-now', ev: 'click', fn: SettingsHandlers.handleWarmupClick },

    // Setup Guide
    { sel: '#open-setup-guide', ev: 'click', fn: SettingsHandlers.handleOpenSetupGuide },
    { sel: '#setup-guide-modal', ev: 'click', fn: ChatHandlers.handleModalClick }
  ];

  // --- APPLY BINDINGS ---
  bindings.forEach(b => bind(b.sel, b.ev, b.fn));
  
  // --- GLOBAL LISTENERS ---
  document.addEventListener('click', (e) => {
    ChatHandlers.handleDocumentClick(e);
    SettingsHandlers.handleDocumentClick(e);
  });

  document.getElementById('in')?.addEventListener('keydown', ChatHandlers.handleInputKeyDown);
  document.addEventListener('keydown', ChatHandlers.handleDocumentKeyDown, true);
});

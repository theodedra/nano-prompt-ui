import * as UI from './ui.js';
import * as Handlers from './handlers.js';
import { refreshAvailability } from './model.js';

function bind(selector, event, handler) {
  const el = document.querySelector(selector);
  if (el) el.addEventListener(event, handler);
}

document.addEventListener('DOMContentLoaded', async () => {
  UI.initUI();
  await Handlers.bootstrap();
  await refreshAvailability();

  bind('#ask', 'click', Handlers.handleAskClick);
  bind('#sum', 'click', Handlers.handleSummarizeClick);
  bind('#copy', 'click', Handlers.handleCopyChatClick);
  bind('#save-md', 'click', Handlers.handleSaveMarkdown);
  bind('#log', 'click', Handlers.handleLogClick);
  
  // TEMPLATES DROPDOWN
  bind('#templates-trigger', 'click', (e) => {
    e.stopPropagation();
    UI.toggleTemplateMenu();
  });
  bind('#templates-menu', 'click', Handlers.handleTemplateSelect);
  
  // SESSION DROPDOWN & CONTROLS
  bind('#session-trigger', 'click', (e) => {
    e.stopPropagation();
    UI.toggleSessionMenu();
  });
  bind('#session-menu', 'click', Handlers.handleSessionMenuClick);
  bind('#new-session', 'click', Handlers.handleNewSessionClick);

  // Global click listener to close dropdowns
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#templates-dropdown')) {
      UI.closeTemplateMenu();
    }
    // Removed the missing #lang-dropdown check causing the crash
    if (!e.target.closest('#session-dropdown')) {
      UI.closeSessionMenu();
    }
  });

  bind('#attach', 'click', Handlers.handleAttachClick);
  bind('#file-input', 'change', Handlers.handleFileInputChange);
  bind('#attachment-list', 'click', Handlers.handleAttachmentListClick);
  bind('#mic', 'click', Handlers.handleMicClick);
  bind('#speak-last', 'click', Handlers.handleSpeakLast);
  bind('#stop', 'click', Handlers.handleStopClick);
  
  bind('#toggle-context', 'click', Handlers.handleToggleContext);
  bind('#context-text', 'input', Handlers.handleContextInput);
  bind('#context-modal', 'click', Handlers.handleModalClick);

  bind('#open-settings', 'click', Handlers.handleOpenSettings);
  bind('#close-settings', 'click', Handlers.handleCloseSettings);
  bind('#save-settings', 'click', Handlers.handleSaveSettings);
  bind('#settings-modal', 'click', Handlers.handleModalClick);
  
  document.getElementById('in')?.addEventListener('keydown', Handlers.handleInputKeyDown);
  document.addEventListener('keydown', Handlers.handleDocumentKeyDown, true);
});
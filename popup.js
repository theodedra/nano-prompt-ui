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

  const autoResize = () => {
    const input = document.getElementById('in');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(240, input.scrollHeight) + 'px';
  };
  document.getElementById('in')?.addEventListener('input', autoResize);
  autoResize();

  bind('#ask', 'click', Handlers.handleAskClick);
  bind('#sum', 'click', Handlers.handleSummarizeClick);
  bind('#new-session', 'click', Handlers.handleNewSessionClick);
  bind('#clone-session', 'click', Handlers.handleCloneSession);
  bind('#delete-session', 'click', Handlers.handleDeleteSession);
  bind('#rename-session', 'click', Handlers.handleRenameSession);
  bind('#copy', 'click', Handlers.handleCopyChatClick);
  bind('#copy-md', 'click', Handlers.handleCopyMarkdown);
  bind('#save-md', 'click', Handlers.handleSaveMarkdown);
  bind('#lang', 'change', Handlers.handleLanguageChange);
  bind('#log', 'click', Handlers.handleLogClick);
  bind('#session-list', 'click', Handlers.handleSessionListClick);
  bind('#session-search', 'input', Handlers.handleSessionSearch);
  bind('#templates', 'change', Handlers.handleTemplateSelect);
  bind('#attach', 'click', Handlers.handleAttachClick);
  bind('#file-input', 'change', Handlers.handleFileInputChange);
  bind('#attachment-list', 'click', Handlers.handleAttachmentListClick);
  bind('#mic', 'click', Handlers.handleMicClick);
  bind('#speak-last', 'click', Handlers.handleSpeakLast);
  bind('#stop', 'click', Handlers.handleStopClick);
  bind('#toggle-context', 'click', Handlers.handleToggleContext);
  bind('#context-text', 'input', Handlers.handleContextInput);
  bind('#open-settings', 'click', Handlers.handleOpenSettings);
  bind('#close-settings', 'click', Handlers.handleCloseSettings);
  bind('#save-settings', 'click', Handlers.handleSaveSettings);
  bind('#settings-modal', 'click', Handlers.handleModalClick);
  document.getElementById('in')?.addEventListener('keydown', Handlers.handleInputKeyDown);
  document.addEventListener('keydown', Handlers.handleDocumentKeyDown, true);
});
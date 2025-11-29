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

  // --- EVENT BINDINGS ---
  const bindings = [
    { sel: '#ask', ev: 'click', fn: Handlers.handleAskClick },
    { sel: '#sum', ev: 'click', fn: Handlers.handleSummarizeClick },
    { sel: '#copy', ev: 'click', fn: Handlers.handleCopyChatClick },
    { sel: '#save-md', ev: 'click', fn: Handlers.handleSaveMarkdown },
    { sel: '#log', ev: 'click', fn: Handlers.handleLogClick },
    
    // Dropdown Triggers (Generic)
    { sel: '#templates-trigger', ev: 'click', fn: (e) => { e.stopPropagation(); UI.toggleMenu('templates'); } },
    { sel: '#templates-menu', ev: 'click', fn: Handlers.handleTemplateSelect },
    { sel: '#session-trigger', ev: 'click', fn: (e) => { e.stopPropagation(); UI.toggleMenu('session'); } },
    { sel: '#session-menu', ev: 'click', fn: Handlers.handleSessionMenuClick },
    { sel: '#new-session', ev: 'click', fn: Handlers.handleNewSessionClick },
    { sel: '#language-trigger', ev: 'click', fn: (e) => { e.stopPropagation(); UI.toggleMenu('language'); } },
    { sel: '#language-menu', ev: 'click', fn: Handlers.handleLanguageSelect },
    { sel: '#theme-trigger', ev: 'click', fn: (e) => { e.stopPropagation(); UI.toggleMenu('theme'); } },
    { sel: '#theme-menu', ev: 'click', fn: Handlers.handleThemeSelect },

    // Media & Inputs
    { sel: '#attach', ev: 'click', fn: Handlers.handleAttachClick },
    { sel: '#file-input', ev: 'change', fn: Handlers.handleFileInputChange },
    { sel: '#attachment-list', ev: 'click', fn: Handlers.handleAttachmentListClick },
    { sel: '#mic', ev: 'click', fn: Handlers.handleMicClick },
    { sel: '#speak-last', ev: 'click', fn: Handlers.handleSpeakLast },
    { sel: '#stop', ev: 'click', fn: Handlers.handleStopClick },
    
    // Context
    { sel: '#toggle-context', ev: 'click', fn: Handlers.handleToggleContext },
    { sel: '#context-text', ev: 'input', fn: Handlers.handleContextInput },
    { sel: '#context-text', ev: 'blur', fn: Handlers.handleContextBlur },
    { sel: '#context-modal', ev: 'click', fn: Handlers.handleModalClick },

    // Settings
    { sel: '#open-settings', ev: 'click', fn: Handlers.handleOpenSettings },
    { sel: '#close-settings', ev: 'click', fn: Handlers.handleCloseSettings },
    { sel: '#save-settings', ev: 'click', fn: Handlers.handleSaveSettings },
    { sel: '#settings-modal', ev: 'click', fn: Handlers.handleModalClick },

    // Setup Guide
    { sel: '#open-setup-guide', ev: 'click', fn: Handlers.handleOpenSetupGuide },
    { sel: '#setup-guide-modal', ev: 'click', fn: Handlers.handleModalClick }
  ];

  // --- APPLY BINDINGS ---
  bindings.forEach(b => bind(b.sel, b.ev, b.fn));
  
  // --- GLOBAL LISTENERS ---
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#templates-dropdown')) UI.closeMenu('templates');
    if (!e.target.closest('#session-dropdown')) UI.closeMenu('session');
    if (!e.target.closest('#language-dropdown')) UI.closeMenu('language');
    if (!e.target.closest('#theme-dropdown')) UI.closeMenu('theme');
  });

  document.getElementById('in')?.addEventListener('keydown', Handlers.handleInputKeyDown);
  document.addEventListener('keydown', Handlers.handleDocumentKeyDown, true);
});
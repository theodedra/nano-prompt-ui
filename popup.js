// popup.js - Main entry point, orchestrating initialization and event binding

import * as UI from './ui.js';
import * as Storage from './storage.js';
import * as Handlers from './handlers.js';

// Initialize the UI once the DOM content is fully loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Set up UI element references
  UI.initUI();

  // Load any saved session state (history and language selection)
  const { history, selectedLanguage } = await Storage.loadState();
  if (selectedLanguage) {
    UI.setLanguage(selectedLanguage);
  }
  // Render the loaded history (if any)
  UI.renderLog(history);

  // Bind event handlers to UI elements
  document.getElementById('ask').addEventListener('click', Handlers.handleAskClick);
  document.getElementById('sum').addEventListener('click', Handlers.handleSummarizeClick);
  document.getElementById('new').addEventListener('click', Handlers.handleNewSessionClick);
  document.getElementById('copy').addEventListener('click', Handlers.handleCopyChatClick);
  document.getElementById('lang').addEventListener('change', Handlers.handleLanguageChange);
  document.getElementById('in').addEventListener('keydown', Handlers.handleInputKeyDown);
  document.getElementById('log').addEventListener('click', Handlers.handleLogClick);
});

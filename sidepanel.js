/**
 * Side Panel Entry Point
 *
 * Wires up UI event bindings and bootstraps the application.
 */

import * as UI from './ui/index.js';
import * as ChatHandlers from './handlers/chat-handlers.js';
import * as AttachmentHandlers from './handlers/attachment-handlers.js';
import * as SettingsHandlers from './handlers/settings-handlers.js';
import { performSessionWarmup, startDownloadPolling, stopDownloadPolling } from './core/model.js';
import { terminatePdfWorker } from './pdf/pdf.js';

function bind(selector, event, handler) {
  const el = document.querySelector(selector);
  if (el) el.addEventListener(event, handler);
}

document.addEventListener('DOMContentLoaded', async () => {
  UI.initUI();
  const availabilityResult = await ChatHandlers.bootstrap();

  // Handle download states: 'after-download' OR 'downloading'
  const needsDownload = availabilityResult?.status === 'after-download' ||
                        availabilityResult?.status === 'downloading';

  if (needsDownload) {
    UI.setStatusText('Downloading model...');

    // Start polling for status changes
    const stopPolling = startDownloadPolling(async (newStatus) => {
      console.log('Nano Prompt: Download status changed to:', newStatus);
      
      // Stop polling
      stopPolling();
      
      // Update UI when model becomes ready
      if (newStatus === 'readily' || newStatus === 'available') {
        const statusEl = document.getElementById('model-status');
        if (statusEl) {
          statusEl.textContent = 'Ready';
          statusEl.title = 'Gemini Nano ready';
          statusEl.dataset.level = 'ok';
          statusEl.dataset.clickable = 'false';
        }
        
        // Refresh availability to update all UI elements
        setTimeout(() => {
          ChatHandlers.refreshAvailability({ forceCheck: true });
        }, 500);
      }
    });

    // Also try to trigger download if not already in progress
    // If status is 'after-download', we need to create a session to trigger download
    // If status is 'downloading', the download is already in progress, so we just poll
    if (availabilityResult?.status === 'after-download') {
      // Pass cached availability to avoid redundant check
      performSessionWarmup({ cachedAvailability: availabilityResult.status }).then((result) => {
        // If warmup succeeded, status should change and polling will handle UI update
        if (result.success || result.downloaded) {
          // Polling will handle the UI update when status changes
          console.log('Nano Prompt: Download triggered successfully');
        } else if (!result.skipped) {
          // If it failed and wasn't skipped, refresh to check current status
          ChatHandlers.refreshAvailability({ forceCheck: true });
        }
      }).catch((err) => {
        console.warn('Nano Prompt: Warmup attempt failed, continuing to poll:', err);
        // Continue polling even if warmup failed
      });
    }
    // If status is 'downloading', we just poll - don't try to create another session

  } else {
    // Model is ready - skip warmup entirely for speed
    // The first prompt will be fast enough without warmup
    // Background script may have already warmed it up anyway
  }

  // --- EVENT BINDINGS ---
  const bindings = [
    { sel: '#ask', ev: 'click', fn: ChatHandlers.handleAskClick },
    { sel: '#sum', ev: 'click', fn: ChatHandlers.handleSummarizeClick },
    { sel: '#copy', ev: 'click', fn: ChatHandlers.handleCopyChatClick },
    { sel: '#save-md', ev: 'click', fn: ChatHandlers.handleSaveMarkdown },
    { sel: '#log', ev: 'click', fn: ChatHandlers.handleLogClick },

    // Dropdown Triggers (Generic)
    { sel: '#templates-trigger', ev: 'click', fn: ChatHandlers.handleTemplatesTriggerClick },
    { sel: '#templates-menu', ev: 'click', fn: ChatHandlers.handleTemplateMenuClick },
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
    { sel: '#setup-guide-modal', ev: 'click', fn: ChatHandlers.handleModalClick },

    // Model Status Chip (click to open setup guide when issues exist)
    { sel: '#model-status', ev: 'click', fn: () => UI.handleModelStatusChipClick() }
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
  document.getElementById('session-menu')?.addEventListener('keydown', ChatHandlers.handleRenameInputKeyDown);
  document.getElementById('templates-menu')?.addEventListener('keydown', ChatHandlers.handleTemplateEditKeyDown);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'MODEL_READY') {
      console.log('Nano Prompt: Received MODEL_READY from background');
      const statusEl = document.getElementById('model-status');
      if (statusEl) {
        statusEl.textContent = 'Ready';
        statusEl.title = 'Gemini Nano ready';
        statusEl.dataset.level = 'ok';
        statusEl.dataset.clickable = 'false';
      }
      setTimeout(() => {
        ChatHandlers.refreshAvailability({ forceCheck: true });
      }, 1000);
    }
  });

  // Cleanup: terminate PDF worker and stop polling on page unload
  window.addEventListener('beforeunload', () => {
    terminatePdfWorker();
    stopDownloadPolling();
  });
});

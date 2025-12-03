/**
 * INLINED CONSTANTS (Service worker cannot use ES modules)
 * Keep in sync with constants.js:
 * - MODEL_CONFIG → constants.js:67-73
 * - TIMING.PANEL_READY_DELAY_MS → constants.js:12
 * - UI_MESSAGES.WARMUP_SUCCESS → constants.js:160
 * - LOG_PREFIX → unique to background.js
 */
const MODEL_CONFIG = {
  expectedInputs: [
    { type: 'text', languages: ['en'] },
    { type: 'image' } // Multimodal support for image analysis
  ],
  expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
};

const TIMING = {
  PANEL_READY_DELAY_MS: 1000
};

const LOG_PREFIX = {
  INFO: 'Nano Prompt:',
  WARN: 'Nano Prompt [WARN]:',
  ERROR: 'Nano Prompt [ERROR]:'
};

const UI_MESSAGES = {
  WARMUP_SUCCESS: 'Nano Prompt: Warmup successful.'
};

let pendingAction = null;

/**
 * Warm up the AI model for faster first use.
 * For 'after-download' status, triggers download with progress notification.
 * @returns {Promise<void>}
 */
async function warmUpModel() {
  try {
    // Check if LanguageModel API is available (global constructor in Chrome extensions)
    if (typeof LanguageModel === 'undefined') return;

    const availabilityResult = await LanguageModel.availability({
      temperature: 1.0,
      topK: 40,
      expectedOutputs: MODEL_CONFIG.expectedOutputs
    });

    const status = typeof availabilityResult === 'object' ? availabilityResult.availability : availabilityResult;

    if (status === 'after-download' || status === 'downloading') {
      console.log(LOG_PREFIX.INFO, 'Model downloading/needs download. Starting background download.', status);
      let session;
      try {
        session = await LanguageModel.create({
          ...MODEL_CONFIG,
          systemPrompt: 'Warmup',
          temperature: 1.0,
          topK: 40,
          monitor: (monitorHandle) => {
            if (!monitorHandle?.addEventListener) return;
            monitorHandle.addEventListener('downloadprogress', (e) => {
              const loaded = typeof e?.loaded === 'number' ? e.loaded : 0;
              const total = typeof e?.total === 'number' ? e.total : 1;
              const ratio = total ? loaded / total : 0;
              const pct = Math.min(100, Math.max(0, Math.round(ratio * 100)));
              const text = Number.isFinite(pct) ? `${pct}%` : '';
              chrome.action.setBadgeText({ text }).catch(() => {});
            });
          }
        });

        console.log(LOG_PREFIX.INFO, UI_MESSAGES.WARMUP_SUCCESS);

        try {
          chrome.runtime.sendMessage({ action: 'MODEL_READY' }).catch(() => {});
        } catch (e) {
          // Sidepanel may not be open, that's fine
        }
      } catch (e) {
        console.warn(LOG_PREFIX.WARN, 'Background download failed (non-critical):', e);
      } finally {
        try { await chrome.action.setBadgeText({ text: '' }); } catch { /* ignore */ }
        try { await session?.destroy(); } catch { /* ignore */ }
      }
      return;
    }

    if (status === 'readily') {
      console.log(LOG_PREFIX.INFO, 'Triggering background model warmup...');
      try {
        const session = await LanguageModel.create({
            systemPrompt: 'Warmup',
            temperature: 1.0,
            topK: 40,
            expectedOutputs: MODEL_CONFIG.expectedOutputs
        });
        session.destroy();

        console.log(LOG_PREFIX.INFO, UI_MESSAGES.WARMUP_SUCCESS);

        try {
          chrome.runtime.sendMessage({ action: 'MODEL_READY' }).catch(() => {});
        } catch (e) {
          // Sidepanel may not be open, that's fine
        }
      } catch (e) {
        console.warn(LOG_PREFIX.WARN, 'Warmup failed (non-critical):', e);
      }
    } else {
        console.log(LOG_PREFIX.INFO, 'AI not ready yet. Status:', status);
    }
  } catch (err) {
    console.log(LOG_PREFIX.INFO, 'AI API not detected.');
  }
}

/**
 * Setup extension: side panel, context menus, and warm up model
 * @returns {Promise<void>}
 */
const setupExtension = async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await chrome.sidePanel.setOptions({ enabled: true, path: 'sidepanel.html' });

    chrome.contextMenus.removeAll();

    chrome.contextMenus.create({ id: 'open_panel', title: 'Open Nano Prompt', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'summarize_sel', title: 'Summarize "%s"', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'rewrite_sel', title: 'Rewrite "%s" (Formal)', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'translate_sel', title: 'Translate "%s"', contexts: ['selection'] });
    // Image description enabled - multimodal now supported
    chrome.contextMenus.create({ id: 'describe_img', title: 'Describe image', contexts: ['image'] });

    await chrome.storage.session.set({ authorizedTabs: {} });
    warmUpModel();

  } catch (error) {
    console.error(LOG_PREFIX.ERROR, 'Setup Failed:', error);
  }
};

chrome.runtime.onInstalled.addListener(setupExtension);
chrome.runtime.onStartup.addListener(setupExtension);

/**
 * Handle context menu clicks and queue actions for side panel
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });

  if (info.menuItemId === 'summarize_sel') {
    pendingAction = { action: 'CMD_SUMMARIZE', text: info.selectionText };
  } else if (info.menuItemId === 'rewrite_sel') {
    pendingAction = { action: 'CMD_REWRITE', text: info.selectionText };
  } else if (info.menuItemId === 'translate_sel') {
    pendingAction = { action: 'CMD_TRANSLATE', text: info.selectionText };
  } else if (info.menuItemId === 'describe_img') {
    pendingAction = { action: 'CMD_DESCRIBE_IMAGE', url: info.srcUrl };
  }

  // If panel is already open, send immediately (it might not send PANEL_READY if already loaded)
  setTimeout(() => {
      if (pendingAction) {
          chrome.runtime.sendMessage(pendingAction).catch(() => {});
          // We don't clear pendingAction here; we let PANEL_READY clear it to be safe for cold starts
      }
  }, TIMING.PANEL_READY_DELAY_MS);
});

/**
 * Handle messages from other extension components
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ status: 'alive' });
  } else if (message.action === 'PANEL_READY') {
      if (pendingAction) {
          console.log(LOG_PREFIX.INFO, 'Sending queued action', pendingAction);
          chrome.runtime.sendMessage(pendingAction);
          pendingAction = null;
      }
  }
});

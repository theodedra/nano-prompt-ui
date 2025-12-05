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
let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL('offscreen/offscreen.html');
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [url]
    });
    if (contexts && contexts.length > 0) return;
  } catch {
    // getContexts may not be available in some versions; fall through to create.
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    // After awaiting, verify document exists before returning
    // This prevents race conditions where the mutex clears before document is registered
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [url]
      });
      if (contexts && contexts.length > 0) return;
    } catch {
      // getContexts may not be available; continue to create path
    }
  }

  // Assign the promise immediately to prevent race conditions from concurrent calls
  creatingOffscreen = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Keep Gemini Nano warm for low-latency inference.'
      });
      
      // After successful creation, verify document exists before clearing mutex
      // Use a small delay to allow Chrome to register the document
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
          documentUrls: [url]
        });
        if (contexts && contexts.length > 0) {
          // Document confirmed to exist, safe to clear mutex
          return;
        }
      } catch {
        // getContexts may not be available; document may still exist
      }
      // If verification fails, document may still exist (API unavailable)
    } catch (error) {
      // Log error with context for debugging
      console.warn(LOG_PREFIX.WARN, 'Failed to create offscreen document:', error?.message || error);
      // Re-throw so caller knows creation failed
      throw error;
    } finally {
      // Clear mutex only after the entire operation completes (success or failure)
      // and we've had a chance to verify the document exists
      creatingOffscreen = null;
    }
  })();

  await creatingOffscreen;
}

/**
 * Warm up the AI model for faster first use.
 * For 'after-download' status, triggers download with progress notification.
 * @returns {Promise<void>}
 */
async function warmUpModel() {
  try {
    try {
      await ensureOffscreenDocument();
      try {
        await chrome.runtime.sendMessage({ action: 'OFFSCREEN_WARMUP', withProgress: false });
        console.log(LOG_PREFIX.INFO, UI_MESSAGES.WARMUP_SUCCESS);
        return;
      } catch {
        // fall back to legacy warmup below
      }
    } catch (offscreenError) {
      // Offscreen document creation failed, fall back to legacy warmup
      console.warn(LOG_PREFIX.WARN, 'Offscreen document creation failed, falling back to local warmup:', offscreenError?.message || offscreenError);
      // Continue to legacy warmup below
    }

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
            ...MODEL_CONFIG,
            systemPrompt: 'Warmup',
            temperature: 1.0,
            topK: 40
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
    await chrome.sidePanel.setOptions({ enabled: true, path: 'sidepanel/index.html' });

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
 * Inject history patcher script into page context using chrome.scripting.executeScript
 * This bypasses CSP restrictions that block inline script injection
 * @param {number} tabId - The tab ID to inject into
 * @returns {Promise<void>}
 */
async function injectHistoryPatcher(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN', // Inject into page context, not isolated world
      func: () => {
        // Check if already patched
        if (window.__nanoHistoryPatched) return;
        window.__nanoHistoryPatched = true;

        // Dispatch custom event that can be received by the isolated world content script
        // Custom events on window can cross the isolation boundary
        const notifyHistoryChange = () => {
          window.dispatchEvent(new CustomEvent('nano-history-change', {
            detail: { timestamp: Date.now() }
          }));
        };

        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function(...args) {
          const ret = originalPushState.apply(this, args);
          notifyHistoryChange();
          return ret;
        };

        history.replaceState = function(...args) {
          const ret = originalReplaceState.apply(this, args);
          notifyHistoryChange();
          return ret;
        };
      }
    });
  } catch (error) {
    // Silently fail for system pages or pages where injection is not allowed
    // This is expected for chrome:// pages, extension pages, etc.
  }
}

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
  } else if (message.action === 'INJECT_HISTORY_PATCHER') {
    // Inject history patcher when content script requests it
    if (sender?.tab?.id) {
      injectHistoryPatcher(sender.tab.id).catch(() => {
        // Silently fail - injection may not be allowed on some pages
      });
    }
  } else if (message.action === 'OFFSCREEN_WARMUP') {
    // Forward OFFSCREEN_WARMUP messages to the offscreen document
    // Skip forwarding if the message is already from the offscreen document (avoid loop)
    const isFromOffscreen = sender?.url?.includes('offscreen/offscreen.html');
    if (isFromOffscreen) {
      // Message is from offscreen document, don't forward (likely a response or internal message)
      return false;
    }
    
    // Forward to offscreen document and relay the response back to the original sender
    chrome.runtime.sendMessage(message)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({ 
          status: 'error', 
          warmupStatus: 'error', 
          warmupError: error?.message || 'Failed to communicate with offscreen document' 
        });
      });
    return true; // Indicate we will send a response asynchronously
  }
});

// Inject history patcher on tab updates (for SPA navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && /^https?:/.test(tab.url)) {
    injectHistoryPatcher(tabId).catch(() => {
      // Silently fail - injection may not be allowed on some pages
    });
  }
});

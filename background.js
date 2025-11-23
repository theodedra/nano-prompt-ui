// background.js

let pendingAction = null;
let dispatching = false;

// --- RELIABILITY HELPERS ---

// Attempt to send the queued action to the side panel
async function tryDeliverPendingAction() {
  if (!pendingAction || dispatching) return false;

  dispatching = true;
  try {
    await chrome.runtime.sendMessage(pendingAction);
    pendingAction = null;
    return true;
  } catch (e) {
    // Panel might not be ready yet, or closed immediately
    // We keep pendingAction null to avoid infinite loops, but log warning
    console.warn('Nano Prompt: Failed to send action to panel', e);
    return false;
  } finally {
    dispatching = false;
  }
}

// Wait for the panel to either announce itself (PANEL_READY) or respond to a ping
function waitForPanelReady(timeout = 4000) {
  return new Promise((resolve) => {
    let finished = false;

    const finish = (ready) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve(ready);
    };

    const onMessage = (message) => {
      if (message.action === 'PANEL_READY') finish(true);
    };

    chrome.runtime.onMessage.addListener(onMessage);

    // Active Ping: Check if panel is already open and listening
    chrome.runtime.sendMessage({ action: 'PING_PANEL' }, (resp) => {
      if (!chrome.runtime.lastError && resp?.ok) finish(true);
    });

    const timer = setTimeout(() => finish(false), timeout);
  });
}

// --- AI WARM-UP LOGIC ---
async function warmUpModel() {
  try {
    if (!self.ai || !self.ai.languageModel) return;

    const config = {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
    };

    const capabilities = await self.ai.languageModel.capabilities();
    
    if (capabilities.available === 'after-download' || capabilities.available === 'readily') {
      console.log('Nano Prompt: Triggering background model warmup...');
      try {
        const session = await self.ai.languageModel.create({
            systemPrompt: 'Warmup',
            expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
        });
        session.destroy(); 
        console.log('Nano Prompt: Warmup successful.');
      } catch (e) {
        console.warn('Nano Prompt: Warmup failed (non-critical):', e);
      }
    } 
  } catch (err) {
    // Ignore if AI API not available
  }
}

const setupExtension = async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await chrome.sidePanel.setOptions({ enabled: true, path: 'sidepanel.html' });
    
    chrome.contextMenus.removeAll(); 
    
    chrome.contextMenus.create({ id: 'open_panel', title: 'Open Nano Prompt', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'summarize_sel', title: 'Summarize "%s"', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'rewrite_sel', title: 'Rewrite "%s" (Formal)', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'translate_sel', title: 'Translate to English', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'describe_img', title: 'Describe image', contexts: ['image'] });

    await chrome.storage.session.set({ authorizedTabs: {} });
    warmUpModel();

  } catch (error) {
    console.error('Nano Prompt Setup Failed:', error);
  }
};

chrome.runtime.onInstalled.addListener(setupExtension);
chrome.runtime.onStartup.addListener(setupExtension);

// --- HANDLING CLICKS WITH HANDSHAKE ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // 1. Ensure panel is opening
  await chrome.sidePanel.open({ windowId: tab.windowId });

  // 2. Queue the action
  if (info.menuItemId === 'summarize_sel') pendingAction = { action: 'CMD_SUMMARIZE', text: info.selectionText };
  else if (info.menuItemId === 'rewrite_sel') pendingAction = { action: 'CMD_REWRITE', text: info.selectionText };
  else if (info.menuItemId === 'translate_sel') pendingAction = { action: 'CMD_TRANSLATE', text: info.selectionText };
  else if (info.menuItemId === 'describe_img') pendingAction = { action: 'CMD_DESCRIBE_IMAGE', url: info.srcUrl };

  // 3. Wait for panel to confirm it exists
  const ready = await waitForPanelReady();
  
  if (!ready) {
    console.warn('Nano Prompt: Side panel did not confirm readiness; attempting dispatch anyway.');
  }

  // 4. Send
  await tryDeliverPendingAction();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ status: 'alive' });
  }
  else if (message.action === 'PANEL_READY') {
    // The panel just opened and told us it's ready. Send any queued data.
    tryDeliverPendingAction();
  }
});
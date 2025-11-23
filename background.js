// background.js

let pendingAction = null;

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
    } else {
        console.log('Nano Prompt: AI not ready yet. Status:', capabilities.available);
    }
  } catch (err) {
    console.log('Nano Prompt: AI API not detected.');
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

// HANDLE MENU CLICKS with Handshake
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });

  // Queue the action
  if (info.menuItemId === 'summarize_sel') pendingAction = { action: 'CMD_SUMMARIZE', text: info.selectionText };
  else if (info.menuItemId === 'rewrite_sel') pendingAction = { action: 'CMD_REWRITE', text: info.selectionText };
  else if (info.menuItemId === 'translate_sel') pendingAction = { action: 'CMD_TRANSLATE', text: info.selectionText };
  else if (info.menuItemId === 'describe_img') pendingAction = { action: 'CMD_DESCRIBE_IMAGE', url: info.srcUrl };
  
  // If panel is already open, send immediately (it might not send PANEL_READY if already loaded)
  setTimeout(() => {
      if (pendingAction) {
          chrome.runtime.sendMessage(pendingAction).catch(() => {}); 
          // We don't clear pendingAction here; we let PANEL_READY clear it to be safe for cold starts
      }
  }, 500);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ status: 'alive' });
  } 
  else if (message.action === 'PANEL_READY') {
      if (pendingAction) {
          console.log("Nano Prompt: Sending queued action", pendingAction);
          chrome.runtime.sendMessage(pendingAction);
          pendingAction = null;
      }
  }
});
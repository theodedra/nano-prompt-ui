// background.js

// --- AI WARM-UP LOGIC ---
async function warmUpModel() {
  try {
    if (!self.ai || !self.ai.languageModel) return;

    // We must define capabilities to check availability correctly
    const config = {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
    };

    const capabilities = await self.ai.languageModel.capabilities();
    
    // "after-download" means the device is capable but needs to fetch weights.
    // "readily" means it's ready, but we might want to wake it up.
    if (capabilities.available === 'after-download' || capabilities.available === 'readily') {
      console.log('Nano Prompt: Triggering background model warmup...');
      try {
        // FIX: Must pass config even for dummy session
        const session = await self.ai.languageModel.create({
            systemPrompt: 'Warmup',
            expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
        });
        session.destroy(); 
      } catch (e) {
        // If it fails, it's likely already downloading or busy
        console.warn('Warmup failed (non-critical):', e);
      }
    } 
  } catch (err) {
    // Ignore if AI API not available
  }
}

const setupExtension = async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await chrome.sidePanel.setOptions({
      enabled: true,
      path: 'sidepanel.html'
    });
    
    chrome.contextMenus.removeAll(); 
    chrome.contextMenus.create({
      id: 'open_side_panel',
      title: 'Open Nano Prompt',
      contexts: ['all'],
      documentUrlPatterns: ['https://*/*', 'http://*/*', 'file://*/*']
    });

    await chrome.storage.session.set({ authorizedTabs: {} });
    
    // Run warmup
    warmUpModel();

  } catch (error) {
    console.error('Nano Prompt Setup Failed:', error);
  }
};

chrome.runtime.onInstalled.addListener(setupExtension);
chrome.runtime.onStartup.addListener(setupExtension);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open_side_panel') {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ status: 'alive' });
  }
});
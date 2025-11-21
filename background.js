// background.js

// --- NEW: AI WARM-UP LOGIC ---
async function warmUpModel() {
  try {
    // Check if the 'ai' namespace exists in the Service Worker
    // (This might fail in some Chrome versions, which is fine - we catch it)
    if (!self.ai || !self.ai.languageModel) return;

    const capabilities = await self.ai.languageModel.capabilities();
    
    // "after-download" means the device is capable but needs to fetch weights.
    // We create a dummy session to trigger the download immediately.
    if (capabilities.available === 'after-download') {
      console.log('Nano Prompt: Triggering background model download...');
      try {
        const session = await self.ai.languageModel.create();
        // Immediately destroy it; we just needed to kickstart the download logic
        session.destroy(); 
      } catch (e) {
        // Ignore errors here, it's just a background optimization
      }
    } 
  } catch (err) {
    // If AI API isn't available in background, just ignore it.
    // The extension will still work via the 'model.js' fallback.
  }
}

// --- EXISTING SETUP ---
const setupExtension = async () => {
  try {
    // Force Icon Click to Open Panel
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    
    // Enable Globally & Set Path ONCE
    await chrome.sidePanel.setOptions({
      enabled: true,
      path: 'sidepanel.html'
    });
    
    // Context Menu Hygiene
    chrome.contextMenus.removeAll(); 
    chrome.contextMenus.create({
      id: 'open_side_panel',
      title: 'Open Nano Prompt',
      contexts: ['all'],
      documentUrlPatterns: ['https://*/*', 'http://*/*', 'file://*/*']
    });

    // Initialize Session Storage
    await chrome.storage.session.set({ authorizedTabs: {} });
    
    // TRIGGER WARM-UP (Non-blocking)
    warmUpModel();

  } catch (error) {
    console.error('Nano Prompt Setup Failed:', error);
  }
};

// Event Listener Registration
chrome.runtime.onInstalled.addListener(setupExtension);
chrome.runtime.onStartup.addListener(setupExtension);

// Handle Right-Click Menu
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open_side_panel') {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// Keep-Alive
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ status: 'alive' });
  }
});
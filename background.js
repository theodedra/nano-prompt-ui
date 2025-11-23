// background.js

async function warmUpModel() {
  try {
    if (!self.ai || !self.ai.languageModel) return;
    const config = {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
    };
    const capabilities = await self.ai.languageModel.capabilities();
    if (capabilities.available === 'after-download' || capabilities.available === 'readily') {
      try {
        const session = await self.ai.languageModel.create({
            systemPrompt: 'Warmup',
            expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
        });
        session.destroy(); 
      } catch (e) {}
    } 
  } catch (err) {}
}

const setupExtension = async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await chrome.sidePanel.setOptions({ enabled: true, path: 'sidepanel.html' });
    
    // CONTEXT MENUS SETUP
    chrome.contextMenus.removeAll(); 
    
    // 1. Main Launcher
    chrome.contextMenus.create({
      id: 'open_panel',
      title: 'Open Nano Prompt',
      contexts: ['all']
    });

    // 2. Selection Actions
    chrome.contextMenus.create({
      id: 'summarize_sel',
      title: 'Summarize "%s"',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'rewrite_sel',
      title: 'Rewrite "%s" (Formal)',
      contexts: ['selection']
    });

    // --- NEW: TRANSLATE ACTION ---
    chrome.contextMenus.create({
      id: 'translate_sel',
      title: 'Translate to English',
      contexts: ['selection']
    });

    await chrome.storage.session.set({ authorizedTabs: {} });
    warmUpModel();

  } catch (error) {
    console.error('Nano Prompt Setup Failed:', error);
  }
};

chrome.runtime.onInstalled.addListener(setupExtension);
chrome.runtime.onStartup.addListener(setupExtension);

// HANDLE MENU CLICKS
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Ensure panel is open
  await chrome.sidePanel.open({ windowId: tab.windowId });

  // Give the panel a moment to load if it wasn't open
  setTimeout(() => {
    if (info.menuItemId === 'summarize_sel') {
      chrome.runtime.sendMessage({ action: 'CMD_SUMMARIZE', text: info.selectionText });
    } else if (info.menuItemId === 'rewrite_sel') {
      chrome.runtime.sendMessage({ action: 'CMD_REWRITE', text: info.selectionText });
    } else if (info.menuItemId === 'translate_sel') {
      chrome.runtime.sendMessage({ action: 'CMD_TRANSLATE', text: info.selectionText });
    }
  }, 500);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ status: 'alive' });
  }
});
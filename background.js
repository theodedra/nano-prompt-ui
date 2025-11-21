// background.js

// 1. Define Restricted Protocols [cite: 90]
const RESTRICTED_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'data:',
  'view-source:',
  'webstore' // Chrome Web Store
];

// 2. Initialization: Deny by Default 
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ enabled: false });
  chrome.storage.session.set({ authorizedTabs: {} }); // Initialize session cache
});

// 3. Helper: Check if URL is allowed
function isUrlAllowed(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    // Check against blocklist
    for (const protocol of RESTRICTED_PROTOCOLS) {
      if (urlObj.protocol.startsWith(protocol)) return false;
    }
    // Additional check for specific google domains if needed
    return true;
  } catch (e) {
    return false;
  }
}

// 4. Core Logic: Manage Panel Visibility
async function updatePanelState(tabId, url) {
  if (!url) return;

  const allowed = isUrlAllowed(url);

  // Optimization: Use granular control to enable ONLY for this tab [cite: 77]
  if (allowed) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true
    });
  } else {
    // Explicitly disable for restricted pages to ensure security [cite: 76]
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false
    });
  }
}

// 5. Event Listener: Tab Updates
// Optimization: Filter to only run on URL change or 'complete' status [cite: 84]
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updatePanelState(tabId, tab.url);
  }
});

// 6. Event Listener: Tab Activation (The Race Condition Fix)
// We use onActivated to handle switching between tabs [cite: 101]
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url) {
    await updatePanelState(activeInfo.tabId, tab.url);
  }
});

// 7. Message Handling (Optional keep-alive helper)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ status: 'alive' });
  }
});
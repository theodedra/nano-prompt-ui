// background.js

// 1. Define Restricted Protocols
const RESTRICTED_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'data:',
  'view-source:',
  'webstore'
];

// 2. Initialization: Deny by Default & Bind Click Action
chrome.runtime.onInstalled.addListener(async () => {
  // FIX: This line forces the icon click to open the side panel
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  
  // Default security state: Disabled
  await chrome.sidePanel.setOptions({ enabled: false });
  await chrome.storage.session.set({ authorizedTabs: {} });
});

// 3. Helper: Check if URL is allowed
function isUrlAllowed(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    for (const protocol of RESTRICTED_PROTOCOLS) {
      if (urlObj.protocol.startsWith(protocol)) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// 4. Core Logic: Manage Panel Visibility
async function updatePanelState(tabId, url) {
  if (!url) return;

  const allowed = isUrlAllowed(url);

  if (allowed) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true
    });
  } else {
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false
    });
  }
}

// 5. Event Listener: Tab Updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updatePanelState(tabId, tab.url);
  }
});

// 6. Event Listener: Tab Activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url) {
    await updatePanelState(activeInfo.tabId, tab.url);
  }
});

// 7. Message Handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ status: 'alive' });
  }
});
// background.js

chrome.runtime.onInstalled.addListener(async () => {
  await setupSidePanel();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupSidePanel();
});

async function setupSidePanel() {
  // 1. Allow clicking the icon to open the panel globally
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));

  // 2. SECURITY: Apply options to ALL currently open tabs immediately.
  // This fixes the bug where existing tabs didn't get the "disabled" rule.
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && tab.url) {
      updateTabPanelState(tab.id, tab.url);
    }
  }
}

// Shared logic to enable/disable panel based on URL
async function updateTabPanelState(tabId, url) {
  // Only enable the panel on valid web pages (http/https)
  // This disables it on chrome://, file://, about:blank, etc.
  const isSecurePage = url.startsWith('http://') || url.startsWith('https://');

  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: isSecurePage
    });
  } catch (e) {
    // Ignore errors for tabs that closed quickly
  }
}

// Monitor navigation updates
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' || info.url) {
    updateTabPanelState(tabId, tab.url);
  }
});

// Monitor tab switching to enforce state on the active tab
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
      updateTabPanelState(tabId, tab.url);
    }
  } catch (e) {
    console.warn('Failed to update panel state on switch', e);
  }
});
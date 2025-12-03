import { sanitizeText } from './utils/utils.js';
import {
  LIMITS,
  TIMING,
  UI_MESSAGES,
  VALIDATION
} from './constants.js';
import { getActiveSnapshot } from './storage.js';
import { enforceContextLimits } from './prompt-builder.js';

let cachedContext = {
  text: '',
  ts: 0,
  tabId: null,
  isRestricted: false,
  title: '',
  url: '',
  source: 'live',
  snapshotId: null
};

/**
 * Fetch context from the active tab with caching
 * @param {boolean} force - Force refresh ignoring cache
 * @param {{respectSnapshot?: boolean}} options - Fetch options
 * @returns {Promise<{text: string, tabId: number|null, isRestricted: boolean, title?: string, url?: string, source?: string, snapshotId?: string|null}>} Context object
 */
export async function fetchContext(force = false, options = {}) {
  const { respectSnapshot = true } = options;
  const activeSnapshot = respectSnapshot ? getActiveSnapshot() : null;

  if (activeSnapshot?.text) {
    cachedContext = {
      text: activeSnapshot.text,
      ts: Date.now(),
      tabId: null,
      isRestricted: false,
      title: activeSnapshot.title,
      url: activeSnapshot.url,
      source: 'snapshot',
      snapshotId: activeSnapshot.id
    };
    return cachedContext;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab || !activeTab.id) {
    return {
      text: '',
      isRestricted: true,
      tabId: null,
      title: '',
      url: '',
      source: 'restricted',
      snapshotId: null
    };
  }

  const activeTabId = activeTab.id;
  const activeTabUrl = activeTab.url || '';
  const isFresh = Date.now() - cachedContext.ts < TIMING.CONTEXT_CACHE_MS;

  // Cache check: same tab, same URL, and cache is fresh
  if (!force && cachedContext.text && isFresh && 
      cachedContext.tabId === activeTabId && cachedContext.url === activeTabUrl) {
    return cachedContext;
  }

  if (!activeTab.url || !VALIDATION.ALLOWED_PAGE_PROTOCOLS.test(activeTab.url)) {
    return {
      text: UI_MESSAGES.SYSTEM_PAGE_AI_DISABLED,
      tabId: activeTabId,
      isRestricted: true,
      title: activeTab?.title || '',
      url: activeTab?.url || '',
      source: 'restricted',
      snapshotId: null
    };
  }

  try {
    const rawData = await sendMessageWithFallback(activeTabId);

    const pieces = [];
    if (rawData.title) pieces.push(`Title: ${sanitizeText(rawData.title)}`);
    if (rawData.url) pieces.push(`URL: ${rawData.url}`);

    if (rawData.text) {
      const clean = enforceContextLimits(rawData.text);
      if (clean) pieces.push(clean);
    }

    cachedContext = {
      text: pieces.join('\n\n'),
      ts: Date.now(),
      tabId: activeTabId,
      isRestricted: false,
      title: sanitizeText(rawData.title || activeTab.title || ''),
      url: rawData.url || activeTab.url || '',
      source: 'live',
      snapshotId: null
    };

    return cachedContext;

  } catch (e) {
    console.warn('Context extraction failed:', e);
    return {
      text: UI_MESSAGES.RESTRICTED_PAGE,
      tabId: activeTabId,
      isRestricted: true,
      title: activeTab?.title || '',
      url: activeTab?.url || '',
      source: 'restricted',
      snapshotId: null
    };
  }
}

/**
 * Send message to content script with automatic injection fallback
 * @param {number} tabId - Tab ID to send message to
 * @returns {Promise<object>} Context data from content script
 */
async function sendMessageWithFallback(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { action: 'GET_CONTEXT' });
  } catch (e) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    return await chrome.tabs.sendMessage(tabId, { action: 'GET_CONTEXT' });
  }
}

// Re-export buildPrompt for backward compatibility
export { buildPrompt as buildPromptWithContext } from './prompt-builder.js';


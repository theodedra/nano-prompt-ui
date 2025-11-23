import { sanitizeText } from './utils.js';

const ASSISTANT_RULES = `You run inside a Chrome extension side panel.
You have access to the active tab's text content AND the conversation history.
If the user asks about a previous topic or summary, LOOK AT THE CHAT HISTORY.
Do not mention browsing limitations.
Always answer in English.
Keep answers concise but helpful.`;

let cachedContext = { text: '', ts: 0, tabId: null, isRestricted: false };

export function classifyIntent(text) {
  const t = text.toLowerCase();
  if (/summari|page|article|tab|website|context|window/.test(t)) return 'page';
  if (/time|date|today|now/.test(t)) return 'time';
  if (/where|location|lat|long/.test(t)) return 'location';
  return 'none';
}

function smartTruncate(text, limit) {
  if (!text || text.length <= limit) return text;
  const truncated = text.slice(0, limit);
  const lastPeriod = truncated.lastIndexOf('.');
  if (lastPeriod > limit * 0.8) { 
    return truncated.slice(0, lastPeriod + 1) + '\n\n[...Content truncated...]';
  }
  return truncated + '\n\n[...Content truncated...]';
}

export async function fetchContext(force = false) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!activeTab || !activeTab.id) return { text: '', isRestricted: true };
  
  const activeTabId = activeTab.id;
  const isFresh = Date.now() - cachedContext.ts < 15_000; 
  
  if (!force && cachedContext.text && isFresh && cachedContext.tabId === activeTabId) {
    return cachedContext;
  }

  if (!activeTab.url || !/^(https?|file):/i.test(activeTab.url)) {
    return { 
      text: '[System Page: AI disabled for security.]', 
      tabId: activeTabId, 
      isRestricted: true 
    };
  }

  try {
    const rawData = await sendMessageWithFallback(activeTabId);
    
    const pieces = [];
    if (rawData.title) pieces.push(`Title: ${sanitizeText(rawData.title)}`);
    if (rawData.url) pieces.push(`URL: ${rawData.url}`);
    
    if (rawData.text) {
      // Increased limit slightly as clean text is more valuable
      const clean = smartTruncate(sanitizeText(rawData.text), 8000);
      pieces.push(clean);
    }

    cachedContext = {
      text: pieces.join('\n\n'),
      ts: Date.now(),
      tabId: activeTabId,
      isRestricted: false
    };

    return cachedContext;

  } catch (e) {
    console.warn('Context extraction failed:', e);
    return {
      text: '[Error: Could not read page. Refresh the tab.]',
      tabId: activeTabId,
      isRestricted: true
    };
  }
}

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

export function getCachedContext() {
  return cachedContext;
}

export async function buildPromptWithContext(userText, contextOverride = '', attachments = []) {
  const intent = classifyIntent(userText);
  let contextText = contextOverride;

  const parts = [ASSISTANT_RULES];
  
  if (contextText && contextText.trim().length > 0) {
    parts.push('Context:\n' + contextText.trim());
  }
  
  if (attachments.length) {
    const desc = attachments.map((att, i) => `[Attachment ${i + 1}: ${att.name}]`).join('\n');
    parts.push('Attachments (Filenames only):\n' + desc);
  }
  
  if (intent === 'time') {
    parts.push(`Time: ${new Date().toLocaleString()}`);
  }
  
  parts.push('User question:\n' + userText);
  return parts.filter(Boolean).join('\n\n');
}
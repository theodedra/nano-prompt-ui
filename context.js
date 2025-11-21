import { sanitizeText } from './utils.js';

// FIX: Updated rules to prioritize history lookup
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

async function runContentScript(tab) {
  try {
    if (!tab || !tab.url || !/^(https?|file):/i.test(tab.url)) {
      return { 
        title: 'System Page', 
        url: tab?.url || 'system', 
        text: '[System Page: Content reading is disabled for security on this page.]', 
        meta: {},
        isRestricted: true 
      };
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const pick = (selector) => document.querySelector(selector);
        const bodyText = document.body?.innerText || '';
        const article = pick('article')?.innerText || '';
        const main = pick('main')?.innerText || '';
        const selection = getSelection()?.toString() || '';
        
        const headings = Array.from(document.querySelectorAll('h1, h2'))
          .slice(0, 6)
          .map(h => h.innerText.trim())
          .filter(Boolean);
        
        const bestText = selection || article || main || bodyText;

        return {
          title: document.title,
          url: location.href,
          text: bestText,
          headings,
          selection,
          meta: { description: document.querySelector('meta[name="description"]')?.content || '' },
          isRestricted: false
        };
      }
    });
    return result;
  } catch (e) {
    console.warn('Context extraction failed:', e);
    return { 
      title: 'Restricted', 
      url: '', 
      text: '[Restricted: Unable to access page content.]', 
      meta: {},
      isRestricted: true
    };
  }
}

function smartTruncate(text, limit) {
  if (text.length <= limit) return text;
  const truncated = text.slice(0, limit);
  const lastPeriod = truncated.lastIndexOf('.');
  if (lastPeriod > limit * 0.8) { 
    return truncated.slice(0, lastPeriod + 1) + '\n\n[...Content truncated...]';
  }
  return truncated + '\n\n[...Content truncated...]';
}

export async function fetchContext(force = false) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTabId = activeTab?.id ?? null;
  
  const isFresh = Date.now() - cachedContext.ts < 15_000; 
  
  if (!force && cachedContext.text && isFresh && cachedContext.tabId === activeTabId) {
    return cachedContext;
  }
  
  const info = await runContentScript(activeTab);
  const pieces = [];
  
  if (info.title) pieces.push(`Title: ${sanitizeText(info.title)}`);
  if (info.url) pieces.push(`URL: ${info.url}`);
  
  if (info.text) {
    const cleanText = smartTruncate(sanitizeText(info.text), 7000);
    pieces.push(cleanText);
  }
  
  const text = pieces.join('\n\n');
  
  cachedContext = { 
    text, 
    ts: Date.now(), 
    tabId: activeTabId,
    isRestricted: info.isRestricted || false 
  };
  
  return cachedContext;
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
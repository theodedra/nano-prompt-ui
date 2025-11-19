const ASSISTANT_RULES = `You run inside a Chrome extension side panel.
You have access to the active tab's text content.
Do not mention browsing limitations.
Always answer in English.
Keep answers concise but helpful.`;

let cachedContext = { text: '', ts: 0, tabId: null };

export function classifyIntent(text) {
  const t = text.toLowerCase();
  if (/summari|page|article|tab|website|context|window/.test(t)) return 'page';
  if (/time|date|today|now/.test(t)) return 'time';
  if (/where|location|lat|long/.test(t)) return 'location';
  return 'none';
}

async function runContentScript(tab) {
  try {
    // Check if we are on a valid web page
    if (!tab || !/^https?:/i.test(tab.url || '')) {
      const url = tab?.url || 'system page';
      return { 
        title: tab?.title || 'System Page', 
        url, 
        text: `[System Page] The user is viewing a browser system page (${url}). Security prevents reading this content.`, 
        meta: {} 
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
        const headings = Array.from(document.querySelectorAll('h1, h2')).slice(0, 6).map(h => h.innerText.trim()).filter(Boolean);
        
        // Priority: Selection -> Article -> Main -> Body
        const bestText = selection || article || main || bodyText;

        return {
          title: document.title,
          url: location.href,
          text: bestText,
          headings,
          selection,
          meta: { description: document.querySelector('meta[name="description"]')?.content || '' }
        };
      }
    });
    return result;
  } catch (e) {
    console.warn('Context extraction failed', e);
    return { title: '', url: '', text: '', meta: {} };
  }
}

// Truncate text to avoid token limits
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
  // Standard stable tab query
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTabId = activeTab?.id ?? null;
  const isFresh = Date.now() - cachedContext.ts < 15_000; // 15s cache
  
  // Use cache unless forced or tab changed
  if (!force && cachedContext.text && isFresh && cachedContext.tabId === activeTabId) {
    return cachedContext;
  }
  
  const info = await runContentScript(activeTab);
  const pieces = [];
  
  if (info.text && !info.text.startsWith('[System Page]')) {
    if (info.title) pieces.push(`Title: ${info.title}`);
    if (info.url) pieces.push(`URL: ${info.url}`);
  }
  
  if (info.text) {
    const cleanText = smartTruncate(info.text, 7000); 
    pieces.push(cleanText);
  }
  
  const text = pieces.join('\n\n');
  cachedContext = { text, ts: Date.now(), tabId: activeTabId };
  return cachedContext;
}

export function getCachedContext() {
  return cachedContext;
}

export async function buildPromptWithContext(userText, contextOverride = '', attachments = []) {
  const intent = classifyIntent(userText);
  let contextText = contextOverride;

  const parts = [ASSISTANT_RULES];
  
  // Only add context if it exists and isn't empty
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
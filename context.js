const ASSISTANT_RULES = `You run inside a Chrome extension popup.
You already have the active tab context provided.
Do not mention browsing limitations.
Respect the user's language choice.
Keep answers concise but helpful.`;

let cachedContext = { text: '', ts: 0, tabId: null };

export function classifyIntent(text) {
  const t = text.toLowerCase();
  if (/summari|page|article|tab|website|context/.test(t)) return 'page';
  if (/time|date|today|now/.test(t)) return 'time';
  if (/where|location|lat|long/.test(t)) return 'location';
  return 'none';
}

async function runContentScript(tab) {
  try {
    if (!tab || !/^https?:/i.test(tab.url || '')) {
      return { title: tab?.title || '', url: tab?.url || '', text: '', meta: {} };
    }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const pick = (selector) => document.querySelector(selector);
        const bodyText = document.body?.innerText || '';
        const article = pick('article')?.innerText || '';
        const main = pick('main')?.innerText || '';
        const selection = getSelection()?.toString() || '';
        const headings = Array.from(document.querySelectorAll('h1, h2')).slice(0, 6).map(h => h.innerText.trim()).filter(Boolean);
        const meta = {
          description: document.querySelector('meta[name="description"]')?.content || '',
          ogTitle: document.querySelector('meta[property="og:title"]')?.content || ''
        };
        const articleText = article || main || bodyText;
        return {
          title: document.title,
          url: location.href,
          text: selection || articleText,
          headings,
          selection,
          meta
        };
      }
    });
    return result;
  } catch (e) {
    console.warn('Context extraction failed', e);
    return { title: tab?.title || '', url: tab?.url || '', text: '', meta: {} };
  }
}

export async function fetchContext(force = false) {
  let activeTab = null;
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    console.warn('Failed to query tabs', e);
  }
  const activeTabId = activeTab?.id ?? null;
  const isFresh = Date.now() - cachedContext.ts < 30_000;
  if (!force && cachedContext.text && isFresh && cachedContext.tabId === activeTabId) {
    return cachedContext;
  }
  const info = await runContentScript(activeTab);
  const pieces = [];
  if (info.title) pieces.push(`Title: ${info.title}`);
  if (info.url) pieces.push(`URL: ${info.url}`);
  if (info.meta?.description) pieces.push(`Description: ${info.meta.description}`);
  if (info.headings?.length) pieces.push('Headings:\n- ' + info.headings.join('\n- '));
  if (info.text) {
    pieces.push('PAGE:\n' + info.text.slice(0, 6000));
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
  if (!contextText && intent === 'page') {
    const ctx = await fetchContext();
    contextText = ctx.text;
  }
  const parts = [ASSISTANT_RULES];
  if (contextText) {
    parts.push('Context:\n' + contextText.trim());
  }
  if (attachments.length) {
    const desc = attachments.map((att, i) => `Attachment ${i + 1}: ${att.name} (${att.type || 'image'})`).join('\n');
    parts.push('Attachments:\n' + desc);
  }
  if (intent === 'time') {
    parts.push(`Time: ${new Date().toLocaleString()}`);
  }
  if (intent === 'location') {
    try {
      const coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 }));
      parts.push(`Location: ${coords.coords.latitude.toFixed(3)}, ${coords.coords.longitude.toFixed(3)}`);
    } catch {
      parts.push('Location: unavailable');
    }
  }
  parts.push('User question:\n' + userText);
  return parts.filter(Boolean).join('\n\n');
}
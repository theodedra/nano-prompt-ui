/**
 * INLINED CONSTANTS (Content scripts cannot use ES modules)
 * Keep in sync with constants.js:
 * - CONTEXT_MAX_CHARS → LIMITS.MAX_CONTEXT_TOKENS * LIMITS.TOKEN_TO_CHAR_RATIO (constants.js:30-31)
 * - SCRAPING_CONSTANTS → unique to content.js (page scraping selectors/noise filters)
 */
const SCRAPING_CONSTANTS = {
  MAIN_CONTENT_SELECTORS: [
    'main',
    '[role="main"]',
    '#main',
    '#content',
    'article',
    '[role="article"]',
    '.jobs-search-results-list',
    '.job-view-layout',
    '.feed-shared-update-v2'
  ],
  EXCLUDED_TAGS: ['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'BUTTON', 'SVG', 'PATH', 'IMG', 'VIDEO', 'CANVAS'],
  NOISE_PHRASES: [
    'Jump to', 'Skip to', 'main content', 'accessibility',
    'Easy Apply', 'connections work here', 'Actively reviewing',
    'Keyboard shortcuts', 'opens in a new window', 'verification'
  ],
  MIN_CONTENT_LENGTH: 50,
  FALLBACK_MAX_LENGTH: 5000,
  MIN_TEXT_LENGTH: 18,
  QUIESCENCE_DELAY_MS: 200,
  QUIESCENCE_MAX_WAIT_MS: 1500,
  LINK_DENSITY_THRESHOLD: 0.6,
  LINK_DENSITY_MIN_TEXT: 50,
  MAX_PARAGRAPHS: 350
};

// Keep in sync with LIMITS.MAX_CONTEXT_TOKENS * LIMITS.TOKEN_TO_CHAR_RATIO in constants.js (≈12k chars)
const CONTEXT_MAX_CHARS = 12_000;
const COLLECTION_SAFETY_MARGIN = 2_000;
const MAX_VISITED_TEXT_NODES = 8_000;
const SCRAPE_CACHE_TTL_MS = 30_000;

let lastScrapeCache = {
  url: '',
  ts: 0,
  payload: null
};

// Track pathname for SPA navigation detection (History API)
let lastPathname = window.location.pathname;

// Request background script to inject history patcher into page context
// Using chrome.scripting.executeScript bypasses CSP restrictions
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
  chrome.runtime.sendMessage({ action: 'INJECT_HISTORY_PATCHER' }).catch(() => {
    // Silently fail if background script is not ready yet
  });
}

// Invalidate cache on popstate (browser back/forward)
window.addEventListener('popstate', () => {
  lastScrapeCache = { url: '', ts: 0, payload: null };
});

// Listen for history changes from the injected page-context script
// Custom events on window can cross the isolation boundary between MAIN and ISOLATED worlds
window.addEventListener('nano-history-change', () => {
  lastScrapeCache = { url: '', ts: 0, payload: null };
});

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_CONTEXT') {
      handleGetContext().then(sendResponse).catch((err) => {
        console.warn('GET_CONTEXT failed', err);
        sendResponse({
          title: 'Page Error',
          url: window.location.href,
          text: '[Error reading page content]',
          isRestricted: true
        });
      });
      return true; // Keep the messaging channel open for async response
    }
  });
} else {
  console.warn('[NanoPrompt] Content script loaded but chrome.runtime is not available.');
}

/**
 * Modern visibility check using native Chrome API (Fast + Accurate)
 */
function isVisible(el) {
  if (!el) return false;
  
  // Use native checkVisibility if available (Chrome 105+)
  if (el.checkVisibility) {
    return el.checkVisibility({
      checkOpacity: true,      // Handles opacity: 0
      checkVisibilityCSS: true // Handles visibility: hidden
    });
  }

  // Fallback for older environments
  // FIXED: Stricter checks for display, visibility, and opacity using AND logic
  const style = window.getComputedStyle(el);
  return el.offsetWidth > 0 &&
         el.offsetHeight > 0 &&
         style.display !== 'none' &&
         style.visibility !== 'hidden' &&
         style.opacity !== '0';
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'SECTION', 'ARTICLE', 'MAIN', 'UL', 'OL', 'LI']);
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4']);

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function isHighLinkDensity(el) {
  if (!el || !el.querySelectorAll) return false;
  const links = el.querySelectorAll('a');
  if (!links.length) return false;
  const linkTextLength = Array.from(links).reduce((sum, link) => sum + (link.textContent || '').length, 0);
  const totalTextLength = (el.textContent || '').length;
  if (!totalTextLength || totalTextLength < SCRAPING_CONSTANTS.LINK_DENSITY_MIN_TEXT) return false;
  return (linkTextLength / totalTextLength) > SCRAPING_CONSTANTS.LINK_DENSITY_THRESHOLD;
}

function shouldSkipElement(el) {
  const tag = el.tagName;
  if (SCRAPING_CONSTANTS.EXCLUDED_TAGS.includes(tag)) return true;
  if (isHighLinkDensity(el)) return true;
  return false;
}

function collectTextFromNode(node, parts, state) {
  if (!node || state.charCount > state.limit || state.visited >= MAX_VISITED_TEXT_NODES) return;
  state.visited += 1;

  if (node.nodeType === Node.TEXT_NODE) {
    const txt = normalizeText(node.data);
    if (txt.length < SCRAPING_CONSTANTS.MIN_TEXT_LENGTH) return;
    const parent = node.parentElement;
    if (parent && shouldSkipElement(parent)) return;
    if (parent && !isVisible(parent)) return;
    parts.push(txt);
    state.charCount += txt.length;
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node;
  if (shouldSkipElement(el)) return;
  if (!isVisible(el)) return;

  const tag = el.tagName;
  if (HEADING_TAGS.has(tag)) {
    const heading = normalizeText(el.textContent);
    if (heading) {
      parts.push('\n' + heading + '\n');
      state.charCount += heading.length + 2; // Count heading text + 2 newlines
    }
    return; // Avoid double-counting heading children
  }

  // Preserve block boundaries
  if (BLOCK_TAGS.has(tag)) {
    parts.push('\n');
    state.charCount += 1; // Count the newline character
  }

  // Traverse shadow roots
  if (el.shadowRoot) {
    collectTextFromNode(el.shadowRoot, parts, state);
  }

  // Slots: follow assigned nodes if present
  if (tag === 'SLOT' && typeof el.assignedNodes === 'function') {
    const assigned = el.assignedNodes();
    if (assigned && assigned.length) {
      assigned.forEach((n) => collectTextFromNode(n, parts, state));
      return;
    }
  }

  // Iframes (same-origin)
  if (tag === 'IFRAME') {
    try {
      const doc = el.contentDocument;
      if (doc && doc.body) {
        collectTextFromNode(doc.body, parts, state);
      }
    } catch (_) {
      // Cross-origin, ignore
    }
    return;
  }

  // Child nodes
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    collectTextFromNode(children[i], parts, state);
    if (state.charCount > state.limit) break;
  }
}

function dedupeParagraphs(text) {
  const seen = new Set();
  const out = [];
  // Split on paragraph boundaries (2+ newlines), not individual lines
  const paras = text.split(/\n{2,}/);
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i].trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= SCRAPING_CONSTANTS.MAX_PARAGRAPHS) break;
  }
  return out.join('\n\n');
}

function waitForQuiescence() {
  return new Promise((resolve) => {
    const start = Date.now();
    let timer = null;
    let hardTimeout = null;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (hardTimeout) clearTimeout(hardTimeout);
      observer.disconnect();
      resolve();
    };

    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(finish, SCRAPING_CONSTANTS.QUIESCENCE_DELAY_MS);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    timer = setTimeout(finish, SCRAPING_CONSTANTS.QUIESCENCE_DELAY_MS);
    hardTimeout = setTimeout(() => {
      if (timer) clearTimeout(timer);
      finish();
    }, SCRAPING_CONSTANTS.QUIESCENCE_MAX_WAIT_MS + SCRAPING_CONSTANTS.QUIESCENCE_DELAY_MS);
  });
}

async function handleGetContext() {
  return await scrapePage();
}

async function scrapePage() {
  try {
    const selection = window.getSelection()?.toString();
    if (selection && selection.trim().length > 0) {
      const currentUrlSel = window.location.href.split('?')[0];
      return {
        title: document.title,
        url: currentUrlSel,
        text: selection.trim(),
        isSelection: true,
        isRestricted: false
      };
    }

    // Wait for SPA quiescence to avoid scraping half-hydrated DOMs
    await waitForQuiescence();

    const currentUrl = window.location.href.split('?')[0];
    const currentPathname = window.location.pathname;
    const now = Date.now();

    if (lastPathname !== currentPathname) {
      lastScrapeCache = { url: '', ts: 0, payload: null };
      lastPathname = currentPathname;
    } else if (lastScrapeCache.url && lastScrapeCache.url !== currentUrl) {
      lastScrapeCache = { url: '', ts: 0, payload: null };
    }

    if (lastScrapeCache.payload && now - lastScrapeCache.ts < SCRAPE_CACHE_TTL_MS && lastScrapeCache.url === currentUrl) {
      return { ...lastScrapeCache.payload };
    }

    let root = document.body || document.documentElement;
    for (const sel of SCRAPING_CONSTANTS.MAIN_CONTENT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        root = el;
        break;
      }
    }

    const parts = [];
    const charCollectionLimit = CONTEXT_MAX_CHARS + COLLECTION_SAFETY_MARGIN;
    const state = { visited: 0, charCount: 0, limit: charCollectionLimit };
    collectTextFromNode(root, parts, state);

    let cleanText = parts.join('\n');
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n');
    cleanText = dedupeParagraphs(cleanText).slice(0, CONTEXT_MAX_CHARS);

    if (!cleanText || cleanText.length < SCRAPING_CONSTANTS.MIN_CONTENT_LENGTH) {
      cleanText = (document.body?.innerText || '').substring(0, SCRAPING_CONSTANTS.FALLBACK_MAX_LENGTH);
    }

    const payload = {
      title: document.title,
      url: currentUrl,
      text: cleanText,
      meta: { description: document.querySelector('meta[name="description"]')?.content || '' },
      isRestricted: false
    };

    lastScrapeCache = {
      url: currentUrl,
      ts: now,
      payload
    };

    return { ...payload };

  } catch (e) {
    return {
      title: 'Page Error',
      url: '',
      text: '[Error reading page content]',
      isRestricted: true
    };
  }
}

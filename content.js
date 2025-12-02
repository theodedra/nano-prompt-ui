// Note: Content scripts cannot use ES6 imports, so constants are inlined

/**
 * Configuration constants for content scraping (single source of truth;
 * content scripts can't import shared modules so keep selectors/noise here)
 */
const SCRAPING_CONSTANTS = {
  MAIN_CONTENT_SELECTORS: [
    'main',
    '[role="main"]',
    '#main',
    '#content',
    '.jobs-search-results-list',
    '.job-view-layout',
    'article',
    '.feed-shared-update-v2'
  ],
  EXCLUDED_TAGS: ['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'BUTTON', 'SVG', 'PATH'],
  NOISE_PHRASES: [
    'Jump to', 'Skip to', 'main content', 'accessibility',
    'Easy Apply', 'connections work here', 'Actively reviewing',
    'results', 'Expired', 'ago', 'See more', 'show more',
    'Keyboard shortcuts', 'opens in a new window', 'verficiation',
    'Apply now', 'Save', 'Share'
  ],
 MIN_CONTENT_LENGTH: 50,
  FALLBACK_MAX_LENGTH: 5000,
  MIN_TEXT_LENGTH: 2
};

// Keep in sync with LIMITS.MAX_CONTEXT_TOKENS * LIMITS.TOKEN_TO_CHAR_RATIO in constants.js (≈12k chars)
const CONTEXT_MAX_CHARS = 12_000;
const TREEWALKER_SAFETY_MARGIN = 2_000; // Allows slight overshoot before final clamp upstream
const MAX_VISITED_TEXT_NODES = 8_000;    // High cap to avoid worst-case pages without trimming usable context
const SCRAPE_CACHE_TTL_MS = 30_000;      // Cache same-page scrapes briefly to avoid repeated DOM walks

let lastScrapeCache = {
  url: '',
  ts: 0,
  payload: null
};

// Check if chrome.runtime is available before adding listener
// This prevents errors when extension is reloaded or disabled
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_CONTEXT') {
      const context = scrapePage();
      sendResponse(context);
    }
  });
} else {
  console.warn('[NanoPrompt] Content script loaded but chrome.runtime is not available. This is normal after extension reload.');
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' &&
         style.visibility !== 'hidden' &&
         style.opacity !== '0' &&
         el.offsetWidth > 0 &&
         el.offsetHeight > 0;
}

/**
 * Scrape page content intelligently
 * @returns {{title: string, url: string, text: string, meta?: object, isSelection?: boolean, isRestricted: boolean}}
 */
function scrapePage() {
  try {
    // Priority 1: User selection
    const selection = window.getSelection()?.toString();
    if (selection && selection.trim().length > 0) {
      const currentUrl = window.location.href.split('?')[0];
      return {
        title: document.title,
        url: currentUrl,
        text: selection.trim(),
        isSelection: true,
        isRestricted: false
      };
    }

    const currentUrl = window.location.href.split('?')[0];
    const now = Date.now();

    // Invalidate cache on SPA navigations or hard URL changes
    if (lastScrapeCache.url && lastScrapeCache.url !== currentUrl) {
      lastScrapeCache = { url: '', ts: 0, payload: null };
    }

    if (lastScrapeCache.payload && now - lastScrapeCache.ts < SCRAPE_CACHE_TTL_MS && lastScrapeCache.url === currentUrl) {
      return { ...lastScrapeCache.payload };
    }

    // Priority 2: Main content detection
    let root = document.body;
    for (const sel of SCRAPING_CONSTANTS.MAIN_CONTENT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        root = el;
        break;
      }
    }

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.parentElement || !isVisible(node.parentElement)) {
            return NodeFilter.FILTER_REJECT;
          }

          const tag = node.parentElement.tagName;
          if (SCRAPING_CONSTANTS.EXCLUDED_TAGS.includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }

          const text = node.textContent.trim();
          if (text.length < SCRAPING_CONSTANTS.MIN_TEXT_LENGTH) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const contentParts = [];
    let currentNode;
    let collectedLength = 0;
    let visitedTextNodes = 0;
    const charCollectionLimit = CONTEXT_MAX_CHARS + TREEWALKER_SAFETY_MARGIN;

    while (currentNode = walker.nextNode()) {
      visitedTextNodes += 1;
      if (visitedTextNodes > MAX_VISITED_TEXT_NODES) break;

      const txt = currentNode.textContent.trim();
      const isNoise = SCRAPING_CONSTANTS.NOISE_PHRASES.some(phrase => txt.includes(phrase));
      if (!isNoise) {
        contentParts.push(txt);
        collectedLength += txt.length;
        if (collectedLength > charCollectionLimit) {
          break;
        }
      }
    }

    let cleanText = contentParts.join('\n');
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n');

    // Fallback: use body text if nothing extracted
    if (!cleanText || cleanText.length < SCRAPING_CONSTANTS.MIN_CONTENT_LENGTH) {
      cleanText = document.body.innerText.substring(0, SCRAPING_CONSTANTS.FALLBACK_MAX_LENGTH);
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

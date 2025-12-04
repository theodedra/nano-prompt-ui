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
    '.jobs-search-results-list',
    '.job-view-layout',
    'article',
    '.feed-shared-update-v2'
  ],
  // Added IMG, VIDEO, SVG to exclude list to save processing time
  EXCLUDED_TAGS: ['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'BUTTON', 'SVG', 'PATH', 'IMG', 'VIDEO'],
  NOISE_PHRASES: [
    'Jump to', 'Skip to', 'main content', 'accessibility',
    'Easy Apply', 'connections work here', 'Actively reviewing',
    'Keyboard shortcuts', 'opens in a new window', 'verification'
    // REMOVED: 'ago', 'results', 'Save', 'Share' (Too aggressive, causing data loss)
  ],
  MIN_CONTENT_LENGTH: 50,
  FALLBACK_MAX_LENGTH: 5000,
  MIN_TEXT_LENGTH: 20 // Increased slightly to skip empty whitespace nodes
};

// Keep in sync with LIMITS.MAX_CONTEXT_TOKENS * LIMITS.TOKEN_TO_CHAR_RATIO in constants.js (≈12k chars)
const CONTEXT_MAX_CHARS = 12_000;
const TREEWALKER_SAFETY_MARGIN = 2_000;
const MAX_VISITED_TEXT_NODES = 8_000;
const SCRAPE_CACHE_TTL_MS = 30_000;

let lastScrapeCache = {
  url: '',
  ts: 0,
  payload: null
};

// Track pathname for SPA navigation detection (History API)
let lastPathname = window.location.pathname;

// Invalidate cache on popstate (browser back/forward)
window.addEventListener('popstate', () => {
  lastScrapeCache = { url: '', ts: 0, payload: null };
});

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_CONTEXT') {
      const context = scrapePage();
      sendResponse(context);
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

function scrapePage() {
  try {
    // Priority 1: User selection (Unchanged)
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
    const currentPathname = window.location.pathname;
    const now = Date.now();

    // Invalidate cache logic (Unchanged)
    if (lastPathname !== currentPathname) {
      lastScrapeCache = { url: '', ts: 0, payload: null };
      lastPathname = currentPathname;
    } else if (lastScrapeCache.url && lastScrapeCache.url !== currentUrl) {
      lastScrapeCache = { url: '', ts: 0, payload: null };
    }

    if (lastScrapeCache.payload && now - lastScrapeCache.ts < SCRAPE_CACHE_TTL_MS && lastScrapeCache.url === currentUrl) {
      return { ...lastScrapeCache.payload };
    }

    // Priority 2: Main content detection
    let root = document.body;
    for (const sel of SCRAPING_CONSTANTS.MAIN_CONTENT_SELECTORS) {
      const el = document.querySelector(sel);
      // OPTIMIZATION: Only check visibility on the root container, not every child loop
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
          // OPTIMIZATION: Filter by cheap properties (parent, tag, length) first.
          
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tag = parent.tagName;
          if (SCRAPING_CONSTANTS.EXCLUDED_TAGS.includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }

          // FIXED: Check length here so we don't yield (and count) garbage nodes in the loop
          // Using node.data is slightly faster than textContent for text nodes
          if (node.data.length < SCRAPING_CONSTANTS.MIN_TEXT_LENGTH) {
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
    
    // Safety valve: Time budget (e.g., 500ms max) to prevent freezing heavy SPAs
    const startTime = Date.now();

    while (currentNode = walker.nextNode()) {
      if (Date.now() - startTime > 500) break; // Hard stop if scraping takes too long
      
      const txt = currentNode.textContent.trim();
      
      // Double check trim length (since acceptNode checked raw length)
      if (txt.length < SCRAPING_CONSTANTS.MIN_TEXT_LENGTH) continue;

      // Expensive Check: Visibility
      // We only check this if the text passed filtering
      if (!isVisible(currentNode.parentElement)) continue;

      // FIXED: Only increment visited counter AFTER checking visibility.
      // This prevents invisible nodes from eating the 8,000 node budget.
      // We rely on the 500ms timer above to catch infinite loops in massive hidden DOMs.
      visitedTextNodes += 1;
      if (visitedTextNodes > MAX_VISITED_TEXT_NODES) break;

      // Noise Check
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

    // Fallback logic (Unchanged)
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
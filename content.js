// content.js
// Note: Content scripts cannot use ES6 imports, so constants are inlined

/**
 * Configuration constants for content scraping
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_CONTEXT') {
    const context = scrapePage();
    sendResponse(context);
  }
});

/**
 * Check if an element is visible in the DOM
 * @param {HTMLElement} el - Element to check
 * @returns {boolean} True if element is visible
 */
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
      return {
        title: document.title,
        url: window.location.href.split('?')[0],
        text: selection.trim(),
        isSelection: true,
        isRestricted: false
      };
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

    // TreeWalker for efficient text extraction
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

    while (currentNode = walker.nextNode()) {
      const txt = currentNode.textContent.trim();
      const isNoise = SCRAPING_CONSTANTS.NOISE_PHRASES.some(phrase => txt.includes(phrase));
      if (!isNoise) {
        contentParts.push(txt);
      }
    }

    let cleanText = contentParts.join('\n');
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n');

    // Fallback: use body text if nothing extracted
    if (!cleanText || cleanText.length < SCRAPING_CONSTANTS.MIN_CONTENT_LENGTH) {
      cleanText = document.body.innerText.substring(0, SCRAPING_CONSTANTS.FALLBACK_MAX_LENGTH);
    }

    return {
      title: document.title,
      url: window.location.href.split('?')[0],
      text: cleanText,
      meta: { description: document.querySelector('meta[name="description"]')?.content || '' },
      isRestricted: false
    };

  } catch (e) {
    return {
      title: 'Page Error',
      url: '',
      text: '[Error reading page content]',
      isRestricted: true
    };
  }
}

// content.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_CONTEXT') {
    const context = scrapePage();
    sendResponse(context);
  }
});

const NOISE_PHRASES = [
  "Jump to", "Skip to", "main content", "accessibility", 
  "Easy Apply", "connections work here", "Actively reviewing",
  "results", "Expired", "ago", "See more", "show more",
  "Keyboard shortcuts", "opens in a new window", "verficiation",
  "Apply now", "Save", "Share"
];

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         style.opacity !== '0' &&
         el.offsetWidth > 0 && 
         el.offsetHeight > 0;
}

function scrapePage() {
  try {
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

    const selectors = [
      'main', '[role="main"]', '#main', '#content', 
      '.jobs-search-results-list', '.job-view-layout', 'article', 
      '.feed-shared-update-v2'
    ];

    let root = document.body;
    for (const sel of selectors) {
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
          if (!node.parentElement || !isVisible(node.parentElement)) return NodeFilter.FILTER_REJECT;
          const tag = node.parentElement.tagName;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'BUTTON', 'SVG', 'PATH'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          const text = node.textContent.trim();
          if (text.length < 2) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const contentParts = [];
    let currentNode;
    
    while (currentNode = walker.nextNode()) {
      const txt = currentNode.textContent.trim();
      const isNoise = NOISE_PHRASES.some(phrase => txt.includes(phrase));
      if (!isNoise) {
        contentParts.push(txt);
      }
    }

    let cleanText = contentParts.join('\n');
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n');

    if (!cleanText || cleanText.length < 50) {
      cleanText = document.body.innerText.substring(0, 5000); 
    }

    return {
      title: document.title,
      url: window.location.href.split('?')[0],
      text: cleanText,
      meta: { description: document.querySelector('meta[name="description"]')?.content || '' },
      isRestricted: false
    };

  } catch (e) {
    return { title: 'Page Error', url: '', text: '[Error reading page content]', isRestricted: true };
  }
}
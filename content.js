// content.js - Runs persistently on webpages to provide instant context

// Listen for messages from the Side Panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_CONTEXT') {
    const context = scrapePage();
    sendResponse(context);
  }
  // Return true is only needed for async response, but we are sync here.
});

function scrapePage() {
  try {
    const pick = (selector) => document.querySelector(selector);
    
    // 1. Try to find the "meat" of the page
    const article = pick('article')?.innerText;
    const main = pick('main')?.innerText;
    const bodyText = document.body?.innerText || '';
    
    // 2. Check for user highlighted text
    const selection = window.getSelection()?.toString() || '';

    // 3. Grab headings for structure
    const headings = Array.from(document.querySelectorAll('h1, h2'))
      .slice(0, 6)
      .map(h => h.innerText.trim())
      .filter(Boolean);

    // 4. Meta Description for summary context
    const description = document.querySelector('meta[name="description"]')?.content || '';

    // Priority: Selection > Article > Main > Body
    const bestText = selection || article || main || bodyText;

    return {
      title: document.title,
      url: window.location.href.split('?')[0], // Remove query params for privacy
      text: bestText || '',
      headings,
      selection,
      meta: { description },
      isRestricted: false
    };
  } catch (e) {
    // Fallback if something blocks DOM access
    return {
      title: 'Page Error',
      url: '',
      text: '[Error reading page content]',
      isRestricted: true
    };
  }
}
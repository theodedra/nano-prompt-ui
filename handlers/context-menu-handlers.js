/**
 * Context Menu Handlers
 *
 * Handles context menu actions from background script.
 * Routes to prompt-handlers for prompt execution.
 */

import {
  runSummarizer,
  runRewriter,
  runTranslator,
  runImageDescription
} from './prompt-handlers.js';

let contextMenuRegistered = false;

export function registerContextMenuHandlers() {
  if (contextMenuRegistered) return;

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'CMD_SUMMARIZE') {
      runSummarizer(req.text);
    } else if (req.action === 'CMD_REWRITE') {
      runRewriter(req.text, 'more-formal');
    } else if (req.action === 'CMD_TRANSLATE') {
      runTranslator(req.text);
    } else if (req.action === 'CMD_DESCRIBE_IMAGE') {
      runImageDescription(req.url);
    }
    // Allow async response in future if needed
    return false; // or return true if any handler becomes async
  });

  contextMenuRegistered = true;
}


import {
  runPrompt,
  runRewriter,
  runTranslator,
  runImageDescription
} from './model.js';

let contextMenuRegistered = false;

/**
 * Wire up context menu actions from the background script.
 */
export function registerContextMenuHandlers() {
  if (contextMenuRegistered) return;

  chrome.runtime.onMessage.addListener((req) => {
    if (req.action === 'CMD_SUMMARIZE') {
      runPrompt({ text: `Summarize this:\n${req.text}`, contextOverride: '', attachments: [] });
    } else if (req.action === 'CMD_REWRITE') {
      runRewriter(req.text, 'more-formal');
    } else if (req.action === 'CMD_TRANSLATE') {
      runTranslator(req.text);
    } else if (req.action === 'CMD_DESCRIBE_IMAGE') {
      runImageDescription(req.url);
    }
  });

  contextMenuRegistered = true;
}

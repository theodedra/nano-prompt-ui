// handlers.js - Event handler functions for user interactions

import { appState, clearState, saveState } from './storage.js';
import { buildPromptWithContext } from './context.js';
import { runPrompt } from './model.js';
import * as UI from './ui.js';

/**
 * Handle click on the "Ask" button.
 * Grabs the user's input, adds default text if empty, and initiates the prompt.
 */
export async function handleAskClick() {
  const userInput = (UI /* (1) */.getInputValue ? UI.getInputValue() : document.getElementById('in')?.value || "").trim();
  const query = userInput || "Say hello in five words.";
  // Clear the input field and refocus it for convenience
  const inputEl = document.getElementById('in');
  if (inputEl) {
    inputEl.value = "";
    inputEl.focus();
  }
  // Build the final prompt with any relevant context, then run it
  const fullPrompt = await buildPromptWithContext(query);
  runPrompt(fullPrompt, query);
}

/**
 * Handle click on the "Summarize tab" button.
 * Gathers page context and instructs the model to summarize it.
 */
export async function handleSummarizeClick() {
  try {
    const meta = await buildPromptWithContext("summarize page");  // reuse context builder for page
    // Build a special prompt for summarization task with page context
    const quickContext = await buildPromptWithContext("summarize page content");
    // The buildPromptWithContext for "summarize page content" will include page context if available
    // Now assemble the final summarize instruction:
    const prompt = [
      meta.includes("Context:") ? meta.split("Context:")[0].trim() : meta,  // ASSISTANT_RULES part
      "Task: Summarize the page in 5 concise bullet points.",
      "",
      // Append the page content context if available, or a default message if none
      quickContext.includes("PAGE:\n") ? quickContext.split("PAGE:\n")[1] : "No readable text found on this tab."
    ].join("\n");
    const summaryLabel = prompt.includes("PAGE:\n") ? 
          `Summarize ${prompt.length.toLocaleString()} chars` : 
          "Summarize: (no readable text)";
    runPrompt(prompt, summaryLabel);
  } catch (e) {
    // If something went wrong (e.g., not on a webpage)
    const errorText = e?.message || String(e);
    appState.history.push({ role: "ai", text: "Error: " + errorText, ts: Date.now() });
    UI.renderLog(appState.history, appState.history.length - 1);
    await saveState(UI.getOutputLanguage());
  }
}

/**
 * Handle click on the "New" (new session) button.
 * Clears the chat history and resets the UI to an initial state.
 */
export async function handleNewSessionClick() {
  appState.history = [];
  UI.setStatusText("idle");
  UI.renderLog(appState.history);  // clear the log display
  // Drop any existing model session so a new one will be created on next prompt
  appState.model = null;
  // Clear persistent storage for this session
  await clearState();
  // (The input field is left empty and focused by HTML attributes or init)
}

/**
 * Handle click on the "Copy chat" button.
 * Copies the entire chat history (in a user-friendly format) to the clipboard.
 */
export async function handleCopyChatClick() {
  const chatText = appState.history.map(m =>
    `${m.role === 'user' ? 'You' : 'Nano'}: ${m.text}`
  ).join("\n\n");
  try {
    await navigator.clipboard.writeText(chatText || "");
    // Provide user feedback that copy was successful
    const oldLabel = copyBtn.textContent;
    copyBtn.textContent = "Copied!";
    copyBtn.disabled = true;
    setTimeout(() => {
      copyBtn.textContent = oldLabel;
      copyBtn.disabled = (appState.history.length === 0);
    }, 800);
  } catch (e) {
    console.error("Copy to clipboard failed:", e);
  }
}

/**
 * Handle change of the language selection dropdown.
 * Resets the model session so that a new one will be created with the new language.
 */
export async function handleLanguageChange() {
  appState.model = null;  // discard current model session (if any)
  await saveState(UI.getOutputLanguage());
}

/**
 * Handle keydown events in the prompt textarea for shortcuts.
 * - Enter (without Shift/Ctrl) triggers Ask.
 * - Ctrl+Enter (or Cmd+Enter) triggers Summarize.
 */
export function handleInputKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    // Enter sends the prompt (Ask)
    event.preventDefault();
    document.getElementById('ask')?.click();
  } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    // Ctrl+Enter (or Cmd+Enter) triggers Summarize
    event.preventDefault();
    document.getElementById('sum')?.click();
  }
}

/**
 * Event delegation for clicks within the chat log (to handle per-message copy buttons).
 * This listens for any "Copy" button click inside the log and copies that message.
 */
export async function handleLogClick(event) {
  const target = event.target;
  if (!target) return;
  // Find the closest element with class "copy1" (the small per-message copy button)
  const copyBtnEl = target.closest('.copy1');
  if (!copyBtnEl) return;
  event.stopPropagation();
  const idx = Number(copyBtnEl.getAttribute('data-idx'));
  if (Number.isFinite(idx) && appState.history[idx]) {
    const textToCopy = appState.history[idx].text || "";
    try {
      await navigator.clipboard.writeText(textToCopy);
      // Give feedback on the small button itself
      const originalText = copyBtnEl.textContent;
      copyBtnEl.textContent = 'Copied!';
      copyBtnEl.disabled = true;
      setTimeout(() => {
        copyBtnEl.textContent = originalText;
        copyBtnEl.disabled = false;
      }, 700);
    } catch (e) {
      console.error("Copy single message failed:", e);
    }
  }
}

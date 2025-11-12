// model.js - Handling the LanguageModel API interactions and prompt execution

import { normalizeToBullets } from './utils.js';
import { appState, saveState } from './storage.js';
import { buildPromptWithContext } from './context.js';
import * as UI from './ui.js';  // UI functions for updating status and rendering

// Reference to the browser's on-device language model API (if available)
const LM = (typeof LanguageModel !== 'undefined')
  ? LanguageModel
  : (self.ai && self.ai.languageModel)
    ? self.ai.languageModel
    : undefined;

/**
 * Ensure that the on-device language model is ready for use in the popup.
 * If available, create or reuse a model session with the current output language.
 * @throws if the LanguageModel API is not available.
 */
async function ensureModelSession() {
  if (!LM) {
    throw new Error('LanguageModel API not available');
  }
  // Check availability and create a new session if needed for current language
  await LM.availability({ output: UI.getOutputLanguage() });
  if (!appState.model) {
    appState.model = await LM.create({ output: UI.getOutputLanguage() });
  }
  return appState.model;
}

/**
 * Fallback: Run the prompt inside the context of the active tab's page.
 * This uses content script execution to utilize the LanguageModel from the page (if available).
 * @param {string} prompt - The full prompt text to run.
 * @param {boolean} preferSelection - If true, will use any text selection on the page as prompt if available.
 * @returns {Promise<string>} The model's response text (or throws an error if not available).
 */
async function runPromptInPage(prompt, preferSelection = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/i.test(tab.url || "")) {
    throw new Error("Please open a webpage to use the model.");
  }
  const outLang = UI.getOutputLanguage();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: async (p, useSelection, outputLang) => {
      const LMPage = (typeof LanguageModel !== 'undefined')
        ? LanguageModel
        : (self.ai && self.ai.languageModel)
          ? self.ai.languageModel
          : undefined;
      if (!LMPage) {
        return { error: "LanguageModel not available in page" };
      }
      let text = p;
      if (useSelection) {
        const sel = getSelection()?.toString()?.trim();
        if (sel) text = sel;
      }
      const session = await LMPage.create({ output: outputLang });
      const reply = await session.prompt(text);
      return { ok: true, data: (reply || "").trim() };
    },
    args: [prompt, preferSelection, outLang]
  });
  if (result?.error) {
    throw new Error(result.error);
  }
  return result?.data ?? "";
}

/**
 * Primary function to run a prompt through the model and handle the response.
 * Adds the user query and AI reply to the history, updates the UI, and handles errors and timeouts.
 * @param {string} prompt - The full prompt (with any context) to send to the model.
 * @param {string|null} displayText - Optional. If provided, this text will represent the user's query in the chat history (instead of the full prompt).
 */
export async function runPrompt(prompt, displayText = null) {
  // Append the user's message to history and show it immediately
  const userMessage = { role: "user", text: displayText ?? prompt, ts: Date.now() };
  appState.history.push(userMessage);
  UI.renderLog(appState.history, appState.history.length - 1);  // render only the new user message
  // Save state after adding user message (so it's not lost if popup closes early)
  await saveState(UI.getOutputLanguage());

  try {
    // Indicate model is busy and update status chip
    UI.setBusy(true);
    UI.setStatusText('checking…');

    let replyText = "";

    try {
      // Try using the in-popup model API
      const model = await ensureModelSession();
      // Set up a timeout to abort if the model takes too long
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      replyText = await model.prompt(prompt, { signal: controller.signal }) || "";
      clearTimeout(timeoutId);
      UI.setStatusText('available');
    } catch (err) {
      // If the popup model is unavailable or fails (including timeout), fallback to page context
      if (err.name === 'AbortError') {
        // Handle a timeout/cancellation scenario
        UI.setStatusText('error');
        throw new Error("Request timed out. Please try again.");
      }
      // Use the content script approach as a fallback
      replyText = await runPromptInPage(prompt);
      UI.setStatusText('fallback');
    }

    // Normalize and post-process the reply text for readability
    const cleanReply = normalizeToBullets(replyText);
    // Append the AI's response to history (use "(empty)" if no content)
    appState.history.push({
      role: "ai",
      text: cleanReply || "(empty)",
      ts: Date.now()
    });
  } catch (e) {
    // In case of any error during prompt processing, record it as an AI message
    const errorMsg = e?.message || String(e);
    // Provide a user-friendly error message
    const friendlyError = errorMsg.startsWith("LanguageModel")
      ? "Error: AI model is not available on this page."
      : "Error: " + errorMsg;
    appState.history.push({ role: "ai", text: friendlyError, ts: Date.now() });
  } finally {
    // Render the latest AI message (or error) and re-enable UI controls
    UI.setBusy(false);
    UI.renderLog(appState.history, appState.history.length - 1);
    // Save the updated state (including the AI response or error)
    await saveState(UI.getOutputLanguage());
  }
}

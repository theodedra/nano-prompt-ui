// storage.js - State persistence and retrieval using chrome.storage

const STORAGE_KEY = 'nanoPromptUI.chat.v2';

/**
 * In-memory application state for the session.
 * - history: chat messages (array of {role, text, ts})
 */
export const appState = {
  history: []  // chat history: [{ role: "user" | "ai", text: string, ts: number }, ...]
};

/**
 * Save the current session state (history and selected language) to Chrome local storage.
 */
export async function saveState(selectedLanguage) {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        history: appState.history,
        selectedLanguage
      }
    });
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

/**
 * Load the saved session state from Chrome local storage.
 * @returns {Promise<{ history: Array, selectedLanguage: string|null }>} The loaded history and language (if any).
 */
export async function loadState() {
  try {
    const data = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    let loadedHistory = [];
    let loadedLang = null;
    if (data) {
      if (Array.isArray(data.history)) {
        loadedHistory = data.history;
      }
      if (data.selectedLanguage) {
        loadedLang = data.selectedLanguage;
      }
    }
    // Restore in-memory state
    appState.history = loadedHistory;
    return { history: loadedHistory, selectedLanguage: loadedLang };
  } catch (e) {
    console.warn('Failed to load state:', e);
    return { history: [], selectedLanguage: null };
  }
}

/**
 * Clear the saved session state (e.g., on new session).
 */
export async function clearState() {
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear state:', e);
  }
}

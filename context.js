// context.js - Building context for prompts (tab, time, location, etc.)

import { appState } from './storage.js';

const ASSISTANT_RULES = (
  `You are running inside a Chrome extension popup.
You already have the current tab context provided below. You DO NOT need to browse.
Answer using ONLY the provided context and the user question.
Do NOT say you can't access tabs or browse.
If context is clearly empty, say: "No readable text found on this tab."
Be concise and helpful.`
).trim();

/**
 * Determine the user's intent based on the prompt text.
 * Returns "page", "time", "location", or "none" depending on keywords.
 * @param {string} text - The user's prompt.
 */
export function classifyIntent(text) {
  const t = text.toLowerCase();
  // Keywords suggesting the user is asking about page content
  const pageHints = ["page", "tab", "website", "site", "article", "content", "text", "summarize", "summary"];
  if (pageHints.some(h => t.includes(h))) return "page";
  // Keywords suggesting time/date inquiry
  const timeHints = ["time", "date", "today", "now", "current", "when"];
  if (timeHints.some(h => t.includes(h))) return "time";
  // Keywords suggesting location inquiry
  const locHints = ["location", "where", "place", "address", "coordinates"];
  if (locHints.some(h => t.includes(h))) return "location";
  return "none";
}

/**
 * Fetch basic metadata for the active tab (title and URL).
 * @returns {Promise<{ title: string, url: string }>}
 */
export async function getTabMeta() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { title: tab?.title || "", url: tab?.url || "" };
}

/**
 * Get up to maxChars of text from the active page's content.
 * If the page is not an HTTP(S) page or has no text, returns an empty payload.
 * @param {number} maxChars - Maximum characters to retrieve.
 * @returns {Promise<{ empty: boolean, payload: string }>} 
 *          empty=true if no readable text was found.
 */
export async function getQuickPageContext(maxChars = 4000) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/i.test(tab.url || "")) {
      // Not a web page or no active tab
      return { empty: true, payload: "" };
    }
    const [{ result: bodyText }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => (document.body?.innerText || "").slice(0, 12000)
    });
    const text = (bodyText || "").trim();
    if (!text) {
      return { empty: true, payload: "" };
    }
    // Truncate to maxChars and indicate if more content exists
    return {
      empty: false,
      payload: text.slice(0, maxChars) + (text.length > maxChars ? "..." : "")
    };
  } catch {
    // If any error (e.g., script injection fails), treat as no content
    return { empty: true, payload: "" };
  }
}

/**
 * Get a timestamp context string for the current date/time.
 * Example: "Time: 2025-11-12 10:07:11 AM"
 */
export function getTimeContext() {
  return `Time: ${new Date().toLocaleString()}`;
}

/**
 * Attempt to get geolocation context (latitude, longitude).
 * Requests optional geolocation permission if not already granted.
 * @returns {Promise<string>} Location context string or a fallback message if unavailable.
 */
export async function getLocationContext() {
  try {
    // Ensure geolocation permission is granted (optional permission flow)
    const granted = await chrome.permissions.contains({ permissions: ['geolocation'] }) ||
                    await chrome.permissions.request({ permissions: ['geolocation'] });
    if (!granted) throw new Error("Geolocation permission denied");
    const coords = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve(pos.coords),
        err => reject(err),
        { timeout: 5000 }
      );
    });
    return `Location: ${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`;
  } catch {
    return "Location: (unavailable)";  // If permission denied or error, provide a placeholder
  }
}

/**
 * Build a prompt string that includes relevant contextual information depending on user intent.
 * For "page" intent, includes page title, URL, and content preview.
 * For "time" intent, includes current time.
 * For "location" intent, includes current geolocation if available.
 * If no specific intent is detected, returns the original user prompt.
 * @param {string} userText - The user's original prompt/question.
 * @returns {Promise<string>} The full prompt to be sent to the model.
 */
export async function buildPromptWithContext(userText) {
  const intent = classifyIntent(userText);
  const contextParts = [];

  if (intent === "page") {
    const meta = await getTabMeta();
    const quick = await getQuickPageContext(4000);
    const pageContext = quick.empty 
      ? "No readable text found on this tab." 
      : `PAGE:\n${quick.payload}`;
    contextParts.push(
      ASSISTANT_RULES,
      meta.title ? `Title: ${meta.title}` : "",
      meta.url ? `URL: ${meta.url}` : "",
      pageContext
    );
  }
  if (intent === "time") {
    contextParts.push(getTimeContext());
  }
  if (intent === "location") {
    contextParts.push(await getLocationContext());
  }

  // If no context to add, return the user prompt as-is
  if (contextParts.length === 0) {
    return userText;
  }

  // Otherwise, assemble the final prompt with context and user query
  return [
    ASSISTANT_RULES,
    "Context:",
    ...contextParts.filter(Boolean),
    "",             // blank line separator
    "User:",
    userText
  ].join("\n");
}

import { sanitizeText } from './utils.js';
import {
  ASSISTANT_RULES,
  LIMITS,
  TIMING,
  UI_MESSAGES,
  INTENT_PATTERNS,
  INTENT_TYPES,
  VALIDATION
} from './constants.js';
import { getActiveSnapshot } from './storage.js';

let cachedContext = {
  text: '',
  ts: 0,
  tabId: null,
  isRestricted: false,
  title: '',
  url: '',
  source: 'live',
  snapshotId: null
};

// ============================================================================
// PROMPT HEADER CACHE - Avoid rebuilding static prompt parts
// ============================================================================

const promptHeaderCache = {
  rules: null,
  rulesTokens: 0
};

/**
 * Get cached prompt header (static rules) with token count
 * @returns {{text: string, tokens: number}}
 */
function getCachedPromptHeader() {
  if (!promptHeaderCache.rules) {
    promptHeaderCache.rules = ASSISTANT_RULES;
    promptHeaderCache.rulesTokens = estimateTokens(ASSISTANT_RULES);
  }
  return { text: promptHeaderCache.rules, tokens: promptHeaderCache.rulesTokens };
}

/**
 * Classify user intent based on query text
 * @param {string} text - User query text
 * @returns {string} Intent type ('page', 'time', 'location', or 'none')
 */
export function classifyIntent(text) {
  const t = text.toLowerCase();
  if (INTENT_PATTERNS.page.test(t)) return INTENT_TYPES.PAGE;
  if (INTENT_PATTERNS.time.test(t)) return INTENT_TYPES.TIME;
  if (INTENT_PATTERNS.location.test(t)) return INTENT_TYPES.LOCATION;
  return INTENT_TYPES.NONE;
}

/**
 * Rough estimation of tokens with non-ASCII awareness
 * ASCII: ~4 chars per token, non-ASCII (CJK, etc.): ~1 char per token
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
  if (!text) return 0;
  
  // Count non-ASCII characters (CJK, etc.) as 1 token each
  const nonAsciiCount = (text.match(/[^\x00-\x7F]/g) || []).length;
  const asciiCount = text.length - nonAsciiCount;
  
  // ASCII: ~4 chars per token, non-ASCII: ~1 char per token
  return Math.ceil(asciiCount / LIMITS.TOKEN_TO_CHAR_RATIO + nonAsciiCount);
}

/**
 * Apply global context limits in one place (sanitize + truncate)
 * @param {string} text - Raw context text
 * @returns {string} Safe, capped text
 */
export function enforceContextLimits(text = '') {
  if (!text) return '';
  const clean = sanitizeText(text);

  // Avoid double-tagging previously truncated text
  if (clean.includes(UI_MESSAGES.TRUNCATED.trim())) return clean;

  return smartTruncate(clean, LIMITS.MAX_CONTEXT_TOKENS);
}

/**
 * Smart truncation based on Token count instead of raw characters
 * @param {string} text - Text to truncate
 * @param {number} maxTokens - Maximum token count
 * @returns {string} Truncated text with clean boundaries
 */
function smartTruncate(text, maxTokens) {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) return text;

  const charLimit = maxTokens * LIMITS.TOKEN_TO_CHAR_RATIO;

  const truncated = text.slice(0, charLimit);
  const lastPeriod = truncated.lastIndexOf('.');

  // If we found a period near the end, cut cleanly there
  if (lastPeriod > charLimit * LIMITS.TRUNCATE_CLEAN_CUT_THRESHOLD) {
    return truncated.slice(0, lastPeriod + 1) + UI_MESSAGES.TRUNCATED;
  }

  return truncated + UI_MESSAGES.TRUNCATED;
}

/**
 * Fetch context from the active tab with caching
 * @param {boolean} force - Force refresh ignoring cache
 * @param {{respectSnapshot?: boolean}} options - Fetch options
 * @returns {Promise<{text: string, tabId: number|null, isRestricted: boolean, title?: string, url?: string, source?: string, snapshotId?: string|null}>} Context object
 */
export async function fetchContext(force = false, options = {}) {
  const { respectSnapshot = true } = options;
  const activeSnapshot = respectSnapshot ? getActiveSnapshot() : null;

  if (activeSnapshot?.text) {
    cachedContext = {
      text: activeSnapshot.text,
      ts: Date.now(),
      tabId: null,
      isRestricted: false,
      title: activeSnapshot.title,
      url: activeSnapshot.url,
      source: 'snapshot',
      snapshotId: activeSnapshot.id
    };
    return cachedContext;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab || !activeTab.id) {
    return {
      text: '',
      isRestricted: true,
      tabId: null,
      title: '',
      url: '',
      source: 'restricted',
      snapshotId: null
    };
  }

  const activeTabId = activeTab.id;
  const isFresh = Date.now() - cachedContext.ts < TIMING.CONTEXT_CACHE_MS;

  if (!force && cachedContext.text && isFresh && cachedContext.tabId === activeTabId) {
    return cachedContext;
  }

  if (!activeTab.url || !VALIDATION.ALLOWED_PAGE_PROTOCOLS.test(activeTab.url)) {
    return {
      text: UI_MESSAGES.SYSTEM_PAGE_AI_DISABLED,
      tabId: activeTabId,
      isRestricted: true,
      title: activeTab?.title || '',
      url: activeTab?.url || '',
      source: 'restricted',
      snapshotId: null
    };
  }

  try {
    const rawData = await sendMessageWithFallback(activeTabId);

    const pieces = [];
    if (rawData.title) pieces.push(`Title: ${sanitizeText(rawData.title)}`);
    if (rawData.url) pieces.push(`URL: ${rawData.url}`);

    if (rawData.text) {
      const clean = enforceContextLimits(rawData.text);
      if (clean) pieces.push(clean);
    }

    cachedContext = {
      text: pieces.join('\n\n'),
      ts: Date.now(),
      tabId: activeTabId,
      isRestricted: false,
      title: sanitizeText(rawData.title || activeTab.title || ''),
      url: rawData.url || activeTab.url || '',
      source: 'live',
      snapshotId: null
    };

    return cachedContext;

  } catch (e) {
    console.warn('Context extraction failed:', e);
    return {
      text: UI_MESSAGES.RESTRICTED_PAGE,
      tabId: activeTabId,
      isRestricted: true,
      title: activeTab?.title || '',
      url: activeTab?.url || '',
      source: 'restricted',
      snapshotId: null
    };
  }
}

/**
 * Send message to content script with automatic injection fallback
 * @param {number} tabId - Tab ID to send message to
 * @returns {Promise<object>} Context data from content script
 */
async function sendMessageWithFallback(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { action: 'GET_CONTEXT' });
  } catch (e) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    return await chrome.tabs.sendMessage(tabId, { action: 'GET_CONTEXT' });
  }
}

/**
 * Build the final prompt with context, attachments, and system rules
 * Uses cached headers and efficient string building to reduce churn.
 * @param {string} userText - User's query
 * @param {string} contextOverride - Optional context to use instead of auto-fetched
 * @param {Array<{name: string}>} attachments - Attached files
 * @returns {Promise<{prompt: string, tokenEstimate: number}>} Complete prompt and token count
 */
export async function buildPromptWithContext(userText, contextOverride = '', attachments = []) {
  // Prompt intentionally stays minimal (no XML wrappers) for Nano model accuracy;
  // security rationale lives in SECURITY.md#prompt-injection-rationale-for-contextjs.
  const intent = classifyIntent(userText);

  const header = getCachedPromptHeader();
  let totalTokens = header.tokens;

  // Pre-allocate parts array with known capacity to avoid resizing
  const parts = new Array(5);
  let partIndex = 0;

  parts[partIndex++] = header.text;

  // Context section (budget-aware)
  if (contextOverride && contextOverride.length > 0) {
    const safeContext = enforceContextLimits(contextOverride);
    if (safeContext) {
      const contextPart = `Context:\n${safeContext}`;
      const contextTokens = estimateTokens(contextPart);
      if (totalTokens + contextTokens <= LIMITS.TOTAL_TOKEN_BUDGET - LIMITS.USER_QUERY_BUDGET) {
        parts[partIndex++] = contextPart;
        totalTokens += contextTokens;
      }
    }
  }

  // Attachments section (budget-aware)
  if (attachments.length) {
    const attParts = [];
    let attTokens = 0;

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      let attText;

      if (att.type === 'application/pdf') {
        const pdfContent = enforceContextLimits(att.data);
        attText = `[Attachment ${i + 1}: ${att.name}]\nPDF Content:\n${pdfContent}`;
      } else {
        attText = `[Attachment ${i + 1}: ${att.name} - Image]`;
      }

      const textTokens = estimateTokens(attText);
      if (attTokens + textTokens <= LIMITS.ATTACHMENT_BUDGET) {
        attParts.push(attText);
        attTokens += textTokens;
      }
    }

    if (attParts.length) {
      const attachmentSection = `Attachments:\n${attParts.join('\n\n')}`;
      parts[partIndex++] = attachmentSection;
      totalTokens += attTokens;
    }
  }

  // Time injection (minimal overhead)
  if (intent === INTENT_TYPES.TIME) {
    const timePart = `Time: ${new Date().toLocaleString()}`;
    parts[partIndex++] = timePart;
    totalTokens += estimateTokens(timePart);
  }

  // User question (always included)
  const userPart = `User question:\n${userText}`;
  parts[partIndex++] = userPart;
  totalTokens += estimateTokens(userPart);

  // Efficient join - only include filled slots
  const prompt = parts.slice(0, partIndex).join('\n\n');

  return { prompt, tokenEstimate: totalTokens };
}


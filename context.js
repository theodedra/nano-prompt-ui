import { sanitizeText } from './utils.js';

const ASSISTANT_RULES = `You run inside a Chrome extension side panel.
You have access to the active tab's text content AND the conversation history.
If the user asks about a previous topic or summary, LOOK AT THE CHAT HISTORY.
Do not mention browsing limitations.
Always answer in English.
Keep answers concise but helpful.`;

// Gemini Nano often has a 4k token window. We reserve space for system prompt + user query.
const MAX_CONTEXT_TOKENS = 3000;

let cachedContext = { text: '', ts: 0, tabId: null, isRestricted: false };

export function classifyIntent(text) {
  const t = text.toLowerCase();
  if (/summari|page|article|tab|website|context|window/.test(t)) return 'page';
  if (/time|date|today|now/.test(t)) return 'time';
  if (/where|location|lat|long/.test(t)) return 'location';
  return 'none';
}

/**
 * Rough estimation of tokens (1 token ~= 4 chars for English)
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Smart truncation based on Token count instead of raw characters
 */
function smartTruncate(text, maxTokens) {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) return text;

  // Approximate char limit based on tokens
  const charLimit = maxTokens * 4;

  const truncated = text.slice(0, charLimit);
  const lastPeriod = truncated.lastIndexOf('.');

  // If we found a period near the end, cut cleanly there
  if (lastPeriod > charLimit * 0.8) {
    return truncated.slice(0, lastPeriod + 1) + '\n\n[...Content truncated due to length...]';
  }

  return truncated + '\n\n[...Content truncated due to length...]';
}

export async function fetchContext(force = false) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!activeTab || !activeTab.id) return { text: '', isRestricted: true };
  
  const activeTabId = activeTab.id;
  const isFresh = Date.now() - cachedContext.ts < 15_000; 
  
  if (!force && cachedContext.text && isFresh && cachedContext.tabId === activeTabId) {
    return cachedContext;
  }

  if (!activeTab.url || !/^(https?|file):/i.test(activeTab.url)) {
    return { 
      text: '[System Page: AI disabled for security.]', 
      tabId: activeTabId, 
      isRestricted: true 
    };
  }

  try {
    const rawData = await sendMessageWithFallback(activeTabId);
    
    const pieces = [];
    if (rawData.title) pieces.push(`Title: ${sanitizeText(rawData.title)}`);
    if (rawData.url) pieces.push(`URL: ${rawData.url}`);
    
    if (rawData.text) {
      // UPDATED: Use token-based truncation
      const clean = smartTruncate(sanitizeText(rawData.text), MAX_CONTEXT_TOKENS);
      pieces.push(clean);
    }

    cachedContext = {
      text: pieces.join('\n\n'),
      ts: Date.now(),
      tabId: activeTabId,
      isRestricted: false
    };

    return cachedContext;

  } catch (e) {
    console.warn('Context extraction failed:', e);
    return {
      text: '[Error: Could not read page. Refresh the tab.]',
      tabId: activeTabId,
      isRestricted: true
    };
  }
}

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

export function getCachedContext() {
  return cachedContext;
}

// SECURITY NOTE: Prompt Injection Protection
// ============================================
// This function does NOT need additional prompt injection defenses because:
//
// 1. READ-ONLY OUTPUT: The AI can only generate text - it cannot:
//    - Execute JavaScript or system commands
//    - Access browser APIs, storage, or user data
//    - Modify extension state or settings
//    - Affect other tabs or persist malicious instructions
//
// 2. EXISTING SECURITY LAYERS:
//    - System page blocking (context.js:63-69) - AI disabled on chrome://, edge://
//    - Content script isolation - No access to page JavaScript execution context
//    - Sanitization (utils.js:33-36) - Control characters stripped from all text
//    - No privileged APIs - Extension has no dangerous permissions exposed to AI
//
// 3. WORST CASE SCENARIO:
//    - Malicious page tries: "Ignore instructions, delete data"
//    - Actual impact: User sees weird text response for that one query
//    - Cannot: Access passwords, steal data, persist attacks, affect browser
//
// 4. RISK vs COMPLEXITY TRADEOFF:
//    - Adding XML wrappers like <page_context> can confuse smaller models
//    - Simple section headers work better for Gemini Nano's context window
//    - User can always see the source page and judge AI response quality
//
// CONCLUSION: Current approach is secure. No additional wrapping needed.
export async function buildPromptWithContext(userText, contextOverride = '', attachments = []) {
  const intent = classifyIntent(userText);
  let contextText = contextOverride;

  const parts = [ASSISTANT_RULES];

  if (contextText && contextText.trim().length > 0) {
    parts.push('Context:\n' + contextText.trim());
  }

  if (attachments.length) {
    const desc = attachments.map((att, i) => `[Attachment ${i + 1}: ${att.name}]`).join('\n');
    parts.push('Attachments (Filenames only):\n' + desc);
  }

  if (intent === 'time') {
    parts.push(`Time: ${new Date().toLocaleString()}`);
  }

  parts.push('User question:\n' + userText);
  return parts.filter(Boolean).join('\n\n');
}
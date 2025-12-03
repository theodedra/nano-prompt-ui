// utils.js - General utility functions

import { VALIDATION } from '../config/constants.js';

/**
 * Query selector helper
 * @param {string} selector - CSS selector
 * @returns {Element|null} Found element or null
 */
export function $(selector) {
  return document.querySelector(selector);
}

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Throttle function execution
 * @param {Function} func - Function to throttle
 * @param {number} wait - Minimum time between calls (ms)
 * @returns {Function & {flush: Function, cancel: Function}} Throttled function with controls
 */
export function throttle(func, wait) {
  let timeout = null;
  let lastCall = 0;
  let lastArgs = null;
  let lastThis = null;

  const invoke = () => {
    lastCall = Date.now();
    timeout = null;
    func.apply(lastThis, lastArgs);
    lastArgs = lastThis = null;
  };

  function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - lastCall);
    lastArgs = args;
    lastThis = this;

    if (remaining <= 0 || !timeout) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      invoke();
    } else if (!timeout) {
      timeout = setTimeout(invoke, remaining);
    }
  }

  throttled.flush = () => {
    if (lastArgs) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      invoke();
    }
  };

  throttled.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    lastArgs = lastThis = null;
  };

  return throttled;
}

/**
 * Format timestamp to time string
 * @param {number} ts - Timestamp
 * @returns {string} Formatted time (HH:MM)
 */
export function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Format timestamp to date string
 * @param {number} ts - Timestamp
 * @returns {string} Formatted date and time
 */
export function formatDate(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return '';
  }
}

/**
 * Sanitize text by removing control characters
 * @param {string} str - Text to sanitize
 * @returns {string} Sanitized text
 */
export function sanitizeText(str) {
  if (!str) return '';
  return str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Generate a random ID using crypto API
 * @param {number} size - Length of ID (default: 10)
 * @returns {string} Random ID
 */
export function nanoid(size = 10) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let id = '';
  crypto.getRandomValues(new Uint8Array(size)).forEach(byte => {
    id += alphabet[byte % alphabet.length];
  });
  return id;
}

/**
 * PRODUCTION READY MARKDOWN SANITIZER
 * Convert markdown to HTML with strict sanitization
 * @param {string} md - Markdown text
 * @returns {string} Sanitized HTML
 */
export function markdownToHtml(md) {
  if (!md) return '';

  // 1. Basic Transformations
  let html = String(md)
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${escapeHtml(code)}</code></pre>`)
    .replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`)
    .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 2. Lists
  html = html.replace(/^(\s*[-*]\s+.*(?:\n\s*[-*]\s+.*)*)/gm, list => {
    const items = list.trim().split(/\n/).map(line => line.replace(/^\s*[-*]\s+/, '')).filter(Boolean);
    return `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
  });

  // 3. Paragraphs
  html = html.split(/\n{2,}/).map(block => {
    if (/^<(ul|ol|pre|h\d)/.test(block.trim())) return block;
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return sanitizeHtmlString(html);
}

/**
 * Escape HTML special characters
 * @param {string} unsafe - Unsafe HTML string
 * @returns {string} Escaped HTML
 */
export function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Extract hostname from URL
 * @param {string} url - URL string
 * @returns {string} Hostname or empty string
 */
export function getSnapshotHost(url = '') {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

/**
 * Clamp text to a maximum length with ellipsis
 * @param {string} text - Text to clamp
 * @param {number} max - Maximum length
 * @returns {string} Clamped text
 */
export function clampLabel(text = '', max = 80) {
  if (!text) return 'Saved page';
  return text.length > max ? text.slice(0, max - 1) + '...' : text;
}

/**
 * Sanitize HTML string using whitelist approach
 * @param {string} dirtyHtml - Unsanitized HTML
 * @returns {string} Sanitized HTML
 */
function sanitizeHtmlString(dirtyHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(dirtyHtml, 'text/html');
  const allowedTags = VALIDATION.ALLOWED_HTML_TAGS;
  const blockedEmbedTags = new Set(['IFRAME', 'OBJECT', 'EMBED', 'STYLE']);

  const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const nodesToRemove = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const tagName = node.tagName;

    if (blockedEmbedTags.has(tagName) || !allowedTags.has(tagName)) {
      nodesToRemove.push(node);
      continue;
    }

    // Strip attributes (Allow only href/target/rel on A)
    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      const attrName = attr.name.toLowerCase();
      if (attrName.startsWith('on') || attrName === 'style') {
        node.removeAttribute(attr.name);
        continue;
      }

      if (tagName === 'A' && VALIDATION.ALLOWED_LINK_ATTRIBUTES.includes(attrName)) {
        if (attrName === 'href') {
          const val = attr.value.trim().toLowerCase();
          if (val.startsWith('javascript:') || val.startsWith('data:')) {
            node.removeAttribute('href');
          }
        }
        continue;
      }
      node.removeAttribute(attr.name);
    }
  }
  nodesToRemove.forEach(n => n.remove());
  return doc.body.innerHTML;
}

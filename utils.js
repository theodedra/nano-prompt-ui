// utils.js - General utility functions

export function $(selector) {
  return document.querySelector(selector);
}

export function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function formatDate(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return '';
  }
}

/**
 * Sanitizes text to prevent control character injection.
 */
export function sanitizeText(str) {
  if (!str) return '';
  // Remove control characters
  return str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Secure Markdown-to-HTML converter.
 * REPLACES insecure regex approach with DOM-based sanitization.
 * Addresses Audit Point 6.1: Input Sanitization [cite: 191]
 */
export function markdownToHtml(md) {
  if (!md) return '';

  // 1. Basic Formatting (Bold/Italic/Code) - Safe transformations
  let html = String(md)
    // Code blocks
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${escapeHtml(code)}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`)
    // Headers
    .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
    // Bold/Italic
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Links
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

  // 4. SANITIZATION STEP
  // Uses browser's native DOMParser to strip dangerous tags/attributes.
  return sanitizeHtmlString(html);
}

/**
 * Escapes HTML special characters to prevent code execution in code blocks.
 */
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Parses HTML string into a Document, strips unsafe elements, returns clean HTML string.
 * This mimics DOMPurify logic using native APIs.
 */
function sanitizeHtmlString(dirtyHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(dirtyHtml, 'text/html');
  
  // Allowed tags
  const allowedTags = new Set(['P', 'BR', 'STRONG', 'EM', 'CODE', 'PRE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'A', 'SPAN', 'DIV']);
  
  const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const nodesToRemove = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    
    // Remove disallowed tags (SCRIPT, IFRAME, OBJECT, etc.)
    if (!allowedTags.has(node.tagName)) {
      nodesToRemove.push(node);
      continue;
    }

    // Strip all attributes except 'href', 'target', 'rel' on <a> tags
    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      if (node.tagName === 'A' && ['href', 'target', 'rel'].includes(attr.name)) {
        // Check for javascript: links
        if (attr.name === 'href' && attr.value.trim().toLowerCase().startsWith('javascript:')) {
            node.removeAttribute('href');
        }
        continue;
      }
      node.removeAttribute(attr.name);
    }
  }

  nodesToRemove.forEach(n => n.remove());
  return doc.body.innerHTML;
}

export function nanoid(size = 10) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let id = '';
  crypto.getRandomValues(new Uint8Array(size)).forEach(byte => {
    id += alphabet[byte % alphabet.length];
  });
  return id;
}

export function resizeImage(file, maxWidth = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
// ... (keep existing code)

// --- NEW HELPER for AI Images ---
export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}
// utils.js - General utility functions (e.g., DOM selection, formatting)

/**
 * Select a DOM element by CSS selector.
 * @param {string} selector 
 * @returns {Element|null}
 */
export function $(selector) {
  return document.querySelector(selector);
}

/**
 * Format a timestamp (ms) into a human-readable time (HH:MM).
 * @param {number} ts - Timestamp in milliseconds.
 * @returns {string} Time string or empty string if invalid.
 */
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
 * Normalize a response text by converting Markdown-style lists into bullet points.
 * Removes bold and inline code formatting and ensures consistent bullet styling.
 * @param {string} md - The raw text (possibly with Markdown).
 * @returns {string} Cleaned text with bullet points.
 */
export function normalizeToBullets(md) {
  if (!md) return "";
  let s = String(md).replace(/\r/g, "");
  const BULLET_CHAR = String.fromCharCode(0x2022);
  const BULLET = `${BULLET_CHAR} `;
  const DUPLICATE_BULLETS = new RegExp(`^\\s*${BULLET_CHAR}\\s*${BULLET_CHAR}\\s*`, 'gm');

  // Remove markdown bold and inline code formatting for clarity
  s = s.replace(/\*\*(.*?)\*\*/g, "$1")
       .replace(/`{1,3}([^`]*)`{1,3}/g, "$1");

  // If single-line with multiple "*" indicators (e.g., "Intro: * a * b * c"), convert to bullets
  if (!/\n/.test(s) && (s.match(/\s\*\s+/g) || []).length >= 2) {
    const parts = s.split(/\s\*\s+/);
    const head = parts.shift().replace(/\s*:\s*$/, "").trim();
    const items = parts.map(t => BULLET + t.replace(/^[*-]\s*/, "").trim());
    s = (head ? head + "\n" : "") + items.join("\n");
  }

  // Transform list markers (-, *, 1.) at line start into bullet symbols
  s = s.replace(/^[ \t]*[-*]\s+/gm, BULLET)
       .replace(/^[ \t]*\d+\.\s+/gm, BULLET);

  // Clean up duplicate bullets, excessive spaces or blank lines
  s = s.replace(DUPLICATE_BULLETS, BULLET)
       .replace(/[ \t]+/g, " ")
       .replace(/\n{3,}/g, "\n\n")
       .trim();

  return s;
}

/**
 * Basic markdown to HTML converter that keeps styling minimal and safe.
 * Only supports headings, emphasis, code, links, lists, and paragraphs.
 */
export function markdownToHtml(md) {
  if (!md) return '';
  let html = String(md)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
             .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
             .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
             .replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/^(\s*[-*]\s+.*(?:\n\s*[-*]\s+.*)*)/gm, list => {
    const items = list.trim().split(/\n/).map(line => line.replace(/^\s*[-*]\s+/, ''));
    return `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
  });
  html = html.replace(/^(\s*\d+\.\s+.*(?:\n\s*\d+\.\s+.*)*)/gm, list => {
    const items = list.trim().split(/\n/).map(line => line.replace(/^\s*\d+\.\s+/, ''));
    return `<ol>${items.map(item => `<li>${item}</li>`).join('')}</ol>`;
  });
  html = html.split(/\n{2,}/).map(block => {
    if (/^<(ul|ol|pre|h\d)/.test(block.trim())) return block;
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('');
  return html;
}

export function nanoid(size = 10) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let id = '';
  crypto.getRandomValues(new Uint8Array(size)).forEach(byte => {
    id += alphabet[byte % alphabet.length];
  });
  return id;
}

/**
 * Resizes an image file to a maximum width/height and returns a compressed Data URL.
 * @param {File} file 
 * @param {number} maxWidth 
 * @returns {Promise<string>}
 */
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
        
        // Export as JPEG with 0.7 quality to save space
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
// utils.js - General utility functions

export function $(selector) {
  return document.querySelector(selector);
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
 * Basic markdown to HTML converter that keeps styling minimal and safe.
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
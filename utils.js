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

/**
 * Normalize a response text by converting Markdown-style lists into bullet points.
 * Removes bold and inline code formatting and ensures consistent bullet styling.
 * @param {string} md - The raw text (possibly with Markdown).
 * @returns {string} Cleaned text with bullet points.
 */
export function normalizeToBullets(md) {
  if (!md) return "";
  let s = String(md).replace(/\r/g, "");

  // Remove markdown bold and inline code formatting for clarity
  s = s.replace(/\*\*(.*?)\*\*/g, "$1")
       .replace(/`{1,3}([^`]*)`{1,3}/g, "$1");

  // If single-line with multiple "*" indicators (e.g., "Intro: * a * b * c"), convert to bullets
  if (!/\n/.test(s) && (s.match(/\s\*\s+/g) || []).length >= 2) {
    const parts = s.split(/\s\*\s+/);
    const head = parts.shift().replace(/\s*:\s*$/, "").trim();
    const items = parts.map(t => "• " + t.replace(/^[*-]\s*/, "").trim());
    s = (head ? head + "\n" : "") + items.join("\n");
  }

  // Transform list markers (-, *, 1.) at line start into bullet symbols
  s = s.replace(/^[ \t]*[-*]\s+/gm, "• ")
       .replace(/^[ \t]*\d+\.\s+/gm, "• ");

  // Clean up duplicate bullets, excessive spaces or blank lines
  s = s.replace(/^\s*•\s*•\s*/gm, "• ")
       .replace(/[ \t]+/g, " ")
       .replace(/\n{3,}/g, "\n\n")
       .trim();

  return s;
}

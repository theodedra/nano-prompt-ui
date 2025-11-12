// ui.js - User Interface updates and rendering

import { $, formatTime } from './utils.js';

/* DOM Elements */
let availChip, inputField, progBar, logContainer;
let askBtn, sumBtn, newBtn, copyBtn;

/**
 * Initialize UI element references. Must be called after DOM is loaded.
 */
export function initUI() {
  availChip   = $('#avail');
  inputField  = $('#in');
  progBar     = $('#prog');
  logContainer = $('#log');
  askBtn      = $('#ask');
  sumBtn      = $('#sum');
  newBtn      = $('#new');
  copyBtn     = $('#copy');
}

/**
 * Enable or disable UI controls based on busy state.
 * Disables prompt buttons (Ask, Summarize) and New Session while the model is running.
 * Shows or hides the progress bar.
 * @param {boolean} isBusy - True to indicate the model is busy (in-progress).
 */
export function setBusy(isBusy) {
  if (progBar) {
    // Use a data attribute to toggle visibility via CSS
    progBar.setAttribute('data-show', isBusy ? '1' : '0');
  }
  if (askBtn) askBtn.disabled = isBusy;
  if (sumBtn) sumBtn.disabled = isBusy;
  if (newBtn) newBtn.disabled = isBusy;
}

/**
 * Update the status chip text (e.g., "idle", "checking…", "available", "fallback", "error").
 * @param {string} text - The status text to display.
 */
export function setStatusText(text) {
  if (availChip) {
    availChip.textContent = text;
  }
}

/**
 * Get the currently selected output language code from the dropdown.
 * @returns {string} Language code (e.g., 'en', 'es', 'ja').
 */
export function getOutputLanguage() {
  const select = document.getElementById('lang');
  return select ? select.value : 'en';
}

/**
 * Set the language selection dropdown to a given value.
 * @param {string} langCode - The language code to select.
 */
export function setLanguage(langCode) {
  const select = document.getElementById('lang');
  if (select && langCode) {
    select.value = langCode;
  }
}

/**
 * Render the chat log messages to the UI.
 * This will append new messages if fromIndex is provided, or render the entire history if a full refresh.
 * Each message includes a timestamp and a copy button.
 * @param {Array} messages - Array of message objects to render.
 * @param {number} [fromIndex=0] - Index from which to start rendering (for incremental updates).
 */
export function renderLog(messages, fromIndex = 0) {
  if (!logContainer || !copyBtn) return;
  if (messages.length === 0) {
    // If history is empty, show placeholder text
    logContainer.innerHTML = `<div class="msg ai">(nothing yet)</div>`;
    copyBtn.disabled = true;
    return;
  }
  // If rendering from the beginning, clear existing log
  if (fromIndex === 0) {
    logContainer.innerHTML = "";
  }
  // Append each message from fromIndex onward
  for (let i = fromIndex; i < messages.length; i++) {
    const m = messages[i];
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${m.role}`;
    // Prepend a label ("You:" or "Nano:") for clarity
    const label = document.createElement('span');
    label.className = 'sender-label';
    label.textContent = (m.role === 'user' ? 'You: ' : 'Nano: ');
    msgDiv.appendChild(label);
    // Message text content
    const textNode = document.createTextNode(m.text);
    msgDiv.appendChild(textNode);
    // Timestamp
    const timeEl = document.createElement('time');
    timeEl.textContent = formatTime(m.ts);
    msgDiv.appendChild(timeEl);
    // Per-message copy button
    const copyOneBtn = document.createElement('button');
    copyOneBtn.className = 'copy1';
    copyOneBtn.textContent = 'Copy';
    copyOneBtn.title = 'Copy this message';
    copyOneBtn.setAttribute('data-idx', String(i));
    copyOneBtn.setAttribute('aria-label', 'Copy message');  // accessibility label
    msgDiv.appendChild(copyOneBtn);

    logContainer.appendChild(msgDiv);
  }
  // Auto-scroll to the bottom of the log to show the latest message
  logContainer.scrollTop = logContainer.scrollHeight;
  // Enable the "Copy chat" button now that we have messages
  copyBtn.disabled = false;
}

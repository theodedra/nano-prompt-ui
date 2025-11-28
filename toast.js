// toast.js - Toast notification system for user feedback

import { TIMING } from './constants.js';

/**
 * Toast notification types
 * @typedef {'info' | 'success' | 'warning' | 'error'} ToastType
 */

/**
 * Show a toast notification to the user
 * @param {string} message - The message to display
 * @param {ToastType} type - The type of toast (info, success, warning, error)
 * @param {number} duration - How long to show the toast in ms (default: 2500ms)
 */
export function showToast(message, type = 'info', duration = TIMING.TOAST_DURATION_MS) {
  // Remove any existing toasts first
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

  // Add icon based on type
  const icon = getIconForType(type);

  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
    </div>
  `;

  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  // Auto-dismiss after duration
  setTimeout(() => {
    hideToast(toast);
  }, duration);
}

/**
 * Hide and remove a toast notification
 * @param {HTMLElement} toast - The toast element to hide
 */
function hideToast(toast) {
  if (!toast) return;

  toast.classList.remove('toast-show');
  toast.classList.add('toast-hide');

  // Remove from DOM after animation completes
  setTimeout(() => {
    toast.remove();
  }, TIMING.TOAST_ANIMATION_MS);
}

/**
 * Get icon SVG for toast type
 * @param {ToastType} type
 * @returns {string} SVG icon
 */
function getIconForType(type) {
  const icons = {
    info: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,

    success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,

    warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,

    error: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
  };

  return icons[type] || icons.info;
}

/**
 * Escape HTML to prevent XSS in toast messages
 * @param {string} unsafe
 * @returns {string}
 */
function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Convenience methods for different toast types
 */
export const toast = {
  info: (message, duration) => showToast(message, 'info', duration),
  success: (message, duration) => showToast(message, 'success', duration),
  warning: (message, duration) => showToast(message, 'warning', duration),
  error: (message, duration) => showToast(message, 'error', duration),
};

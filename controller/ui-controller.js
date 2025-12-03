/**
 * UI Controller
 * 
 * Handles UI rendering and interactions: menus, modals, theme, and misc UI operations.
 */

import * as UI from '../ui/index.js';

/**
 * Render smart replies
 */
export function renderSmartReplies(replies) {
  UI.renderSmartReplies(replies);
}

/**
 * Apply theme
 */
export function applyTheme(theme) {
  UI.applyTheme(theme);
}

/**
 * Close a menu
 */
export function closeMenu(menuId) {
  UI.closeMenu(menuId);
}

/**
 * Toggle a menu
 */
export function toggleMenu(menuId) {
  UI.toggleMenu(menuId);
}

/**
 * Check if a modal is open
 */
export function isModalOpen() {
  return UI.isModalOpen();
}

/**
 * Close the modal
 */
export function closeModal() {
  UI.closeModal();
}

/**
 * Open the context modal
 */
export function openContextModal() {
  UI.openContextModal();
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob, filename) {
  UI.downloadBlob(blob, filename);
}

/**
 * Set microphone state
 */
export function setMicState(active) {
  UI.setMicState(active);
}

/**
 * Restore stop button state
 */
export function restoreStopButtonState(isRunning) {
  UI.restoreStopButtonState(isRunning);
}

/**
 * Get trap container for focus management
 */
export function getTrapContainer() {
  return UI.getTrapContainer();
}

/**
 * Trap focus within a container
 */
export function trapFocus(event, container) {
  UI.trapFocus(event, container);
}

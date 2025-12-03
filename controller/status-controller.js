/**
 * Status Controller
 * 
 * Handles status display, busy state, stop button, and availability diagnostics.
 */

import {
  getAvailability as getStoredAvailability,
  setAvailability,
  getAvailabilityCheckedAt as getStoredAvailabilityCheckedAt,
  setAvailabilityCheckedAt
} from '../storage.js';
import * as UI from '../ui/index.js';
import {
  UI_MESSAGES
} from '../constants.js';

/**
 * Set status text
 */
export function setStatus(text) {
  UI.setStatusText(text);
}

/**
 * Set busy state
 */
export function setBusy(busy) {
  UI.setBusy(busy);
}

/**
 * Set stop button enabled state
 */
export function setStopEnabled(enabled) {
  UI.setStopEnabled(enabled);
}

/**
 * Update availability display with diagnostics
 */
export function updateAvailabilityDisplay(status, checkedAt, diag = {}) {
  const label = describeAvailability(status);
  setAvailability(status);
  setAvailabilityCheckedAt(checkedAt);

  UI.setStatusText(label);
  UI.setHardwareStatus(`Gemini Nano: ${label}`);
  UI.updateDiagnostics({
    ...diag,
    availability: status,
    availabilityCheckedAt: checkedAt,
    availabilityLabel: label
  });

  return label;
}

/**
 * Update model status chip with diagnostic summary
 * @param {Object} status - Model status from getModelStatusSummary()
 */
export function updateModelStatusChip(status) {
  UI.updateModelStatusChip(status);
}

/**
 * Describe availability status for display
 */
function describeAvailability(status) {
  if (status === 'readily' || status === 'available') return UI_MESSAGES.READY;
  if (status === 'after-download' || status === 'downloading') return 'Downloading...';
  if (status === 'no') return UI_MESSAGES.PAGE_MODE;
  if (!status) return 'Unknown';
  return status;
}

/**
 * Check if we have cached availability data
 */
export function hasCachedAvailability() {
  const availability = getStoredAvailability();
  return Boolean(
    availability &&
    availability !== 'unknown' &&
    getStoredAvailabilityCheckedAt()
  );
}

/**
 * Get availability status
 */
export function getAvailability() {
  return getStoredAvailability();
}

/**
 * Get availability checked at timestamp
 */
export function getAvailabilityCheckedAt() {
  return getStoredAvailabilityCheckedAt();
}

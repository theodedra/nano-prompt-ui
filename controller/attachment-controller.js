/**
 * Attachment Controller
 * 
 * Handles attachment management operations.
 */

import {
  addPendingAttachment,
  clearPendingAttachments,
  getPendingAttachments,
  removePendingAttachment
} from '../core/storage.js';
import * as UI from '../ui/index.js';

/**
 * Get all pending attachments
 */
export function getAttachments() {
  return getPendingAttachments().slice();
}

/**
 * Add an attachment
 */
export function addAttachment(entry) {
  addPendingAttachment(entry);
}

/**
 * Remove an attachment by index
 */
export function removeAttachment(index) {
  removePendingAttachment(index);
}

/**
 * Clear all attachments
 */
export function clearAttachments() {
  clearPendingAttachments();
  UI.renderPendingAttachments(getPendingAttachments());
}

/**
 * Render attachments in UI
 */
export function renderAttachments() {
  UI.renderPendingAttachments(getPendingAttachments());
}

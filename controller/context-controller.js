/**
 * Context Controller
 * 
 * Handles context management and context snapshots.
 */

import {
  getContextSnapshots,
  getActiveSnapshotId,
  getActiveSnapshot,
  updateContextDraft,
  saveContextDraft,
  addContextSnapshot,
  getContextSnapshotById,
  removeContextSnapshot,
  setActiveSnapshot
} from '../storage.js';
import * as UI from '../ui/index.js';

/**
 * Set context text in UI
 */
export function setContextText(text) {
  UI.setContextText(text);
}

/**
 * Get context text from UI
 */
export function getContextText() {
  return UI.getContextText();
}

/**
 * Set context draft (in-memory)
 */
export function setContextDraft(text) {
  updateContextDraft(text);
}

/**
 * Persist context draft to storage
 */
export async function persistContextDraft(text) {
  await saveContextDraft(text);
}

/**
 * Set restricted state in UI
 */
export function setRestrictedState(restricted) {
  UI.setRestrictedState(restricted);
}

/**
 * Render context UI (snapshots and source label)
 */
export function renderContextUI() {
  UI.renderContextSnapshots(getContextSnapshots(), getActiveSnapshotId());
  UI.setContextSourceLabel(getActiveSnapshot());
}

/**
 * Save a context snapshot
 */
export function saveSnapshot(payload) {
  return addContextSnapshot(payload);
}

/**
 * Get a snapshot by ID
 */
export function getSnapshotById(id) {
  return getContextSnapshotById(id);
}

/**
 * Delete a snapshot
 */
export function deleteSnapshot(id) {
  return removeContextSnapshot(id);
}

/**
 * Activate a snapshot
 */
export function activateSnapshot(id) {
  setActiveSnapshot(id);
}

/**
 * Get the active context snapshot
 */
export function getActiveContextSnapshot() {
  return getActiveSnapshot();
}

/**
 * Template Controller
 * 
 * Handles template operations: CRUD and UI updates.
 */

import {
  getTemplates as getStoredTemplates,
  addTemplate as addStorageTemplate,
  updateTemplate as updateStorageTemplate,
  deleteTemplate as deleteStorageTemplate,
  resetTemplates as resetStorageTemplates,
  BLANK_TEMPLATE_ID,
  scheduleSaveState
} from '../core/storage.js';
import * as UI from '../ui/index.js';

/**
 * Get all templates
 */
export function getTemplates() {
  return getStoredTemplates();
}

/**
 * Update templates UI
 */
export function updateTemplatesUI(editingId = null) {
  UI.updateTemplates(getStoredTemplates(), BLANK_TEMPLATE_ID, editingId);
}

/**
 * Add a new template
 */
export function addTemplate(label, text) {
  const template = addStorageTemplate(label, text);
  scheduleSaveState();
  return template;
}

/**
 * Patch/update a template
 */
export function patchTemplate(id, patch) {
  const result = updateStorageTemplate(id, patch);
  if (result) {
    scheduleSaveState();
  }
  return result;
}

/**
 * Remove a template
 */
export function removeTemplate(id) {
  const result = deleteStorageTemplate(id);
  if (result) {
    scheduleSaveState();
  }
  return result;
}

/**
 * Reset all templates to defaults
 */
export function resetAllTemplates() {
  resetStorageTemplates();
  scheduleSaveState();
}

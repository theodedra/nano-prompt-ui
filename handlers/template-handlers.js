/**
 * Template Handlers - Template management UI event handlers
 *
 * Handles template selection, editing, creation, and deletion.
 * Uses direct storage/model access for simple read operations (see IMPLEMENTATION.md).
 */

import * as Controller from '../controller/index.js';
import * as UI from '../ui/index.js';
import * as Storage from '../core/storage.js';
import {
  getEditingTemplateId,
  setEditingTemplateId,
  getIsAddingNewTemplate,
  setIsAddingNewTemplate
} from '../core/state.js';
import { toast } from '../ui/toast.js';

/**
 * Handle templates trigger click (open/close templates menu)
 * @param {MouseEvent} event - Click event
 */
export function handleTemplatesTriggerClick(event) {
  event.stopPropagation();
  UI.toggleMenu('templates');
}

/**
 * Start inline edit for a template
 * @param {string} id - Template ID
 */
export function startTemplateEdit(id) {
  setEditingTemplateId(id);
  setIsAddingNewTemplate(false);
  Controller.updateTemplatesUI(id);
}

/**
 * Cancel template editing
 */
export function cancelTemplateEdit() {
  setEditingTemplateId(null);
  setIsAddingNewTemplate(false);
  UI.setAddingNewTemplate(false);
  Controller.updateTemplatesUI();
}

/**
 * Save template edit
 * @param {string} id - Template ID
 */
export function saveTemplateEdit(id) {
  const values = UI.getTemplateEditValues(id);

  if (!values || !values.label) {
    toast.error('Template name is required');
    return;
  }

  const success = Controller.patchTemplate(id, values);
  if (success) {
    setEditingTemplateId(null);
    Controller.updateTemplatesUI();
    toast.success('Template saved');
  } else {
    toast.error('Failed to save template');
  }
}

/**
 * Delete a template
 * @param {string} id - Template ID
 */
export function deleteTemplate(id) {
  const success = Controller.removeTemplate(id);
  if (success) {
    Controller.updateTemplatesUI();
    toast.success('Template deleted');
  }
}

/**
 * Start adding a new template
 */
export function startAddTemplate() {
  setEditingTemplateId(null);
  setIsAddingNewTemplate(true);
  UI.setAddingNewTemplate(true);
  Controller.updateTemplatesUI();
}

/**
 * Save new template
 */
export function saveNewTemplate() {
  const values = UI.getTemplateEditValues(null);

  if (!values || !values.label) {
    toast.error('Template name is required');
    return;
  }

  Controller.addTemplate(values.label, values.text);
  setIsAddingNewTemplate(false);
  UI.setAddingNewTemplate(false);
  Controller.updateTemplatesUI();
  toast.success('Template created');
}

/**
 * Cancel adding new template
 */
export function cancelNewTemplate() {
  setIsAddingNewTemplate(false);
  UI.setAddingNewTemplate(false);
  Controller.updateTemplatesUI();
}

/**
 * Handle template menu click events
 * @param {MouseEvent} event - Click event
 */
export function handleTemplateMenuClick(event) {
  const btn = event.target.closest('button');
  const input = event.target.closest('input, textarea');

  // If clicking on an input, don't close menu
  if (input) {
    event.stopPropagation();
    return;
  }

  if (btn) {
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'edit-template') {
      event.stopPropagation();
      startTemplateEdit(id);
      return;
    }

    if (action === 'delete-template') {
      event.stopPropagation();
      deleteTemplate(id);
      return;
    }

    if (action === 'save-template') {
      event.stopPropagation();
      saveTemplateEdit(id);
      return;
    }

    if (action === 'cancel-template') {
      event.stopPropagation();
      cancelTemplateEdit();
      return;
    }

    if (action === 'add-template') {
      event.stopPropagation();
      startAddTemplate();
      return;
    }

    if (action === 'save-new-template') {
      event.stopPropagation();
      saveNewTemplate();
      return;
    }

    if (action === 'cancel-new-template') {
      event.stopPropagation();
      cancelNewTemplate();
      return;
    }

    // Handle template selection (use the template)
    if (btn.classList.contains('template-select')) {
      const text = btn.dataset.text;
      if (text) {
        // Direct access - simple read operation
        Controller.setInputValue(UI.getInputValue() + text);
        UI.closeMenu('templates');
        Controller.focusInput();
      }
      return;
    }
  }
}

/**
 * Handle keyboard events on template edit inputs
 * @param {KeyboardEvent} event - Keyboard event
 */
export function handleTemplateEditKeyDown(event) {
  const input = event.target.closest('.template-edit-label, .template-edit-text');
  if (!input) return;

  const id = input.dataset.id;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (id) {
      cancelTemplateEdit();
    } else {
      cancelNewTemplate();
    }
  }

  // Only save on Enter if it's the label input (not textarea)
  if (event.key === 'Enter' && input.classList.contains('template-edit-label')) {
    event.preventDefault();
    event.stopPropagation();
    if (id) {
      saveTemplateEdit(id);
    } else {
      saveNewTemplate();
    }
  }
}

/**
 * Check if template editing is in progress
 * @returns {boolean}
 */
export function isTemplateEditingActive() {
  return getEditingTemplateId() !== null || getIsAddingNewTemplate();
}


/**
 * UI State - manages UI-only state
 * 
 * This module centralizes UI state that is not persisted to storage.
 * It manages transient UI state like search terms, editing states, etc.
 */

export const uiState = {
  sessionSearchTerm: '',
  editingSessionId: null,
  confirmingDeleteId: null,
  editingTemplateId: null,
  isAddingNewTemplate: false
};

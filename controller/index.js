/**
 * Controller Layer
 *
 * Mediates between Model (AI), Storage, and UI layers.
 * - Model knows nothing about UI or storage
 * - UI handlers dispatch here instead of touching storage directly
 * - All state mutations go through this layer
 *
 * This file re-exports from focused controller modules for backward compatibility.
 * The controller has been split into focused modules for better maintainability:
 * - session-controller.js - Session management
 * - message-controller.js - Message operations
 * - context-controller.js - Context and snapshots
 * - attachment-controller.js - Attachment management
 * - template-controller.js - Template operations
 * - settings-controller.js - Settings
 * - ui-controller.js - UI rendering and interactions
 * - status-controller.js - Status, busy state, diagnostics
 * - input-controller.js - Input handling
 * - toast-controller.js - Toast notifications
 */

// Re-export all functions from focused controller modules
export * from './session-controller.js';
export * from './message-controller.js';
export * from './context-controller.js';
export * from './attachment-controller.js';
export * from './template-controller.js';
export * from './settings-controller.js';
export * from './ui-controller.js';
export * from './status-controller.js';
export * from './input-controller.js';
export * from './toast-controller.js';

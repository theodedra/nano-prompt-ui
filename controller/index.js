/**
 * Controller Layer
 *
 * Mediates between Model (AI), Storage, and UI layers for operations requiring coordination.
 * - Model knows nothing about UI or storage
 * - Handlers use controllers for mutations/coordination, direct access for simple reads
 * - All state mutations requiring coordination go through this layer
 *
 * **When to use controllers vs direct access:**
 * - Use controllers for: mutations, coordination between layers, UI updates, side effects
 * - Use direct storage/model access for: simple read operations (see IMPLEMENTATION.md)
 *
 * This file re-exports from focused controller modules for backward compatibility.
 * The controller has been split into focused modules for better maintainability:
 * - session-controller.js - Session management
 * - message-controller.js - Message operations
 * - context-controller.js - Context and snapshots
 * - attachment-controller.js - Attachment management
 * - template-controller.js - Template operations
 * - settings-controller.js - Settings
 * - input-controller.js - Input handling
 *
 * @see IMPLEMENTATION.md section "Architecture Decisions" for detailed guidelines on when to bypass controllers
 */

// Re-export all functions from focused controller modules
export * from './session-controller.js';
export * from './message-controller.js';
export * from './context-controller.js';
export * from './attachment-controller.js';
export * from './template-controller.js';
export * from './settings-controller.js';
export * from './input-controller.js';

/**
 * Input Controller
 * 
 * Handles input field operations: getting, setting, and focusing.
 */

import * as UI from '../ui/index.js';

/**
 * Get input value
 */
export function getInputValue() {
  return UI.getInputValue();
}

/**
 * Set input value
 */
export function setInputValue(value) {
  UI.setInputValue(value);
}

/**
 * Focus the input field
 */
export function focusInput() {
  UI.focusInput();
}

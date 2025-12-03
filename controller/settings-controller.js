/**
 * Settings Controller
 * 
 * Handles settings operations: getting, patching, and accessing individual settings.
 */

import {
  getSettings as getStoredSettings,
  updateSettings
} from '../core/storage.js';
import {
  getSettingOrDefault
} from '../config/constants.js';

/**
 * Get all settings
 */
export function getSettings() {
  return getStoredSettings();
}

/**
 * Patch/update settings
 */
export function patchSettings(patch) {
  updateSettings(patch);
}

/**
 * Get a specific setting by key
 */
export function getSetting(key) {
  return getSettingOrDefault(getStoredSettings(), key);
}

/**
 * Toast Controller
 * 
 * Handles toast notifications.
 */

import { toast } from '../toast.js';

/**
 * Show a toast notification
 */
export function showToast(type, message) {
  toast[type](message);
}

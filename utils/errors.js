// utils/errors.js - Standardized error handling utility

import { USER_ERROR_MESSAGES } from '../constants.js';

// Cache toast function to avoid circular dependencies
let toastFn = null;

/**
 * Set the toast function for error handling
 * This should be called during initialization to provide a direct way to show toasts
 * @param {Function} fn - Function that accepts (type, message) parameters
 */
export function setToastFunction(fn) {
  toastFn = fn;
}

/**
 * Get the toast function, trying Controller if available
 * @returns {Function|null} Toast function or null
 */
async function getToastFunction() {
  if (toastFn) return toastFn;
  
  // Try dynamic import if available
  try {
    const Controller = await import('../controller/index.js');
    if (Controller.showToast) {
      return (type, message) => Controller.showToast(type, message);
    }
  } catch {
    // Controller not available
  }
  
  return null;
}

/**
 * Standardized error handling
 * @param {Error|unknown} error - The error object or value
 * @param {Object} context - Context information for error handling
 * @param {string} context.operation - Description of the operation that failed
 * @param {string} [context.userMessage] - Custom user-friendly message (overrides auto-detection)
 * @param {string} [context.fallbackMessage] - Fallback message key from USER_ERROR_MESSAGES
 * @param {boolean} [context.showToast=true] - Whether to show a toast notification
 * @param {boolean} [context.logError=true] - Whether to log the error to console
 * @param {Function} [context.onError] - Optional callback to handle the error
 * @param {boolean} [context.rethrow=false] - Whether to rethrow the error after handling
 * @param {boolean} [context.silent=false] - If true, don't show toast or log (only return error info)
 * @returns {Object} Error information object with { message, userMessage, shouldRethrow, originalError }
 */
export function handleError(error, context = {}) {
  const {
    operation = 'Operation',
    userMessage,
    fallbackMessage = 'GENERIC_ERROR',
    showToast = true,
    logError = true,
    onError,
    rethrow = false,
    silent = false
  } = context;

  // Extract error message
  let errorMessage = '';
  let errorName = '';
  
  if (error instanceof Error) {
    errorMessage = error.message || '';
    errorName = error.name || '';
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else if (error && typeof error === 'object') {
    errorMessage = error.message || String(error);
  } else {
    errorMessage = String(error || 'Unknown error');
  }

  // Check for special error types
  const isAbortError = errorName === 'AbortError' || errorMessage.includes('abort');
  
  // Determine user-friendly message
  let finalUserMessage = userMessage;
  
  if (!finalUserMessage) {
    // Try to match error message to known error types
    if (errorMessage.includes('quota') || errorMessage.includes('storage')) {
      finalUserMessage = USER_ERROR_MESSAGES.STORAGE_QUOTA_EXCEEDED;
    } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      finalUserMessage = USER_ERROR_MESSAGES.NETWORK_ERROR;
    } else if (errorMessage.includes('image')) {
      finalUserMessage = USER_ERROR_MESSAGES.IMAGE_PROCESSING_FAILED;
    } else if (errorMessage.includes('PDF') || errorMessage.includes('pdf')) {
      finalUserMessage = USER_ERROR_MESSAGES.PDF_PROCESSING_FAILED;
    } else if (errorMessage.includes('AI') || errorMessage.includes('session')) {
      finalUserMessage = USER_ERROR_MESSAGES.AI_SESSION_FAILED;
    } else if (errorMessage.includes('context') || errorMessage.includes('page')) {
      finalUserMessage = USER_ERROR_MESSAGES.CONTEXT_FETCH_FAILED;
    } else if (errorMessage && errorMessage !== 'Unknown error') {
      // Use the error message if it's user-friendly
      finalUserMessage = errorMessage;
    } else {
      // Fallback to generic error message
      finalUserMessage = USER_ERROR_MESSAGES[fallbackMessage] || USER_ERROR_MESSAGES.GENERIC_ERROR;
    }
  }

  // Log error if enabled
  if (logError && !isAbortError) {
    console.error(`${operation} failed:`, error);
    if (context.additionalInfo) {
      console.error('Additional context:', context.additionalInfo);
    }
  } else if (logError && isAbortError) {
    console.warn(`${operation} was aborted`);
  }

  // Show toast notification if enabled and not an abort error
  if (!silent && showToast && !isAbortError) {
    // Try to show toast via provided function first
    if (context.showToastFn && typeof context.showToastFn === 'function') {
      try {
        context.showToastFn('error', finalUserMessage);
      } catch (toastError) {
        console.warn('Toast function failed:', toastError);
      }
    } else if (toastFn) {
      // Use cached toast function
      try {
        toastFn('error', finalUserMessage);
      } catch (toastError) {
        console.warn('Toast function failed:', toastError);
      }
    } else {
      // Try to use Controller via dynamic import (async, won't block)
      try {
        import('../controller/index.js').then((Controller) => {
          if (Controller.showToast) {
            Controller.showToast('error', finalUserMessage);
          }
        }).catch(() => {
          // Controller not available, skip toast
        });
      } catch (importError) {
        // Dynamic import not available, skip toast
      }
    }
  }

  // Call custom error handler if provided
  if (onError && typeof onError === 'function') {
    try {
      onError(error, {
        message: errorMessage,
        userMessage: finalUserMessage,
        operation,
        isAbortError
      });
    } catch (handlerError) {
      console.error('Error handler itself failed:', handlerError);
    }
  }

  // Return error information
  const errorInfo = {
    message: errorMessage,
    userMessage: finalUserMessage,
    name: errorName,
    isAbortError,
    shouldRethrow: rethrow && !isAbortError,
    originalError: error
  };

  // Rethrow if requested (but not for abort errors)
  if (rethrow && !isAbortError) {
    throw error instanceof Error ? error : new Error(errorMessage);
  }

  return errorInfo;
}

/**
 * Handle errors with a promise catch handler
 * @param {Error|unknown} error - The error object
 * @param {Object} context - Context information (same as handleError)
 * @returns {Promise<Object>} Promise that resolves with error info
 */
export async function handleErrorAsync(error, context = {}) {
  return Promise.resolve(handleError(error, context));
}

/**
 * Wrap an async function with automatic error handling
 * @param {Function} fn - Async function to wrap
 * @param {Object} context - Error handling context
 * @returns {Function} Wrapped function with error handling
 */
export function withErrorHandling(fn, context = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      const errorInfo = handleError(error, {
        ...context,
        operation: context.operation || fn.name || 'Async operation'
      });
      
      // Return null if rethrow is false, otherwise throw
      if (errorInfo.shouldRethrow) {
        throw errorInfo.originalError instanceof Error 
          ? errorInfo.originalError 
          : new Error(errorInfo.message);
      }
      
      return null;
    }
  };
}

/**
 * Handle error and return null (for functions that return nullable values)
 * @param {Error|unknown} error - The error object
 * @param {Object} context - Error handling context
 * @returns {null}
 */
export function handleErrorReturnNull(error, context = {}) {
  handleError(error, { ...context, rethrow: false });
  return null;
}

/**
 * Handle error and return empty string (for functions that return strings)
 * @param {Error|unknown} error - The error object
 * @param {Object} context - Error handling context
 * @returns {string}
 */
export function handleErrorReturnEmpty(error, context = {}) {
  handleError(error, { ...context, rethrow: false });
  return '';
}

/**
 * Handle error and return undefined (for functions that return optional values)
 * @param {Error|unknown} error - The error object
 * @param {Object} context - Error handling context
 * @returns {undefined}
 */
export function handleErrorReturnUndefined(error, context = {}) {
  handleError(error, { ...context, rethrow: false });
  return undefined;
}

/**
 * Handle error and rethrow (for critical errors that should propagate)
 * @param {Error|unknown} error - The error object
 * @param {Object} context - Error handling context
 * @throws {Error} Always throws after handling
 */
export function handleErrorRethrow(error, context = {}) {
  handleError(error, { ...context, rethrow: true });
}


// pdf.js - PDF text extraction using Web Worker for non-blocking processing
// This module handles PDF file processing for attachment support

import { LIMITS } from '../config/constants.js';

/** @type {Worker|null} */
let pdfWorker = null;

/**
 * Get or create the PDF extraction worker
 * @returns {Worker}
 */
function getWorker() {
  if (!pdfWorker) {
    const workerUrl = chrome.runtime.getURL('pdf/pdf-worker.js');
    pdfWorker = new Worker(workerUrl);
  }
  return pdfWorker;
}

/**
 * Extract text content from a PDF file using Web Worker.
 * Keeps the main thread responsive during extraction.
 *
 * @param {File} file - PDF file object
 * @param {Object} options - Optional configuration
 * @param {function(number, number): void} [options.onProgress] - Progress callback (currentPage, totalPages)
 * @param {AbortSignal} [options.signal] - AbortSignal for cancellation
 * @returns {Promise<{ text: string, meta: { truncated: boolean, pagesProcessed: number, totalPagesEstimate: number, charsUsed: number } }>}
 */
export async function extractPdfText(file, options = {}) {
  const { onProgress, signal } = options;

  // Check for early abort
  if (signal?.aborted) {
    throw new DOMException('PDF extraction aborted', 'AbortError');
  }

  const arrayBuffer = await file.arrayBuffer();

  // Check for abort after reading file
  if (signal?.aborted) {
    throw new DOMException('PDF extraction aborted', 'AbortError');
  }

  return new Promise((resolve, reject) => {
    const worker = getWorker();

    // Handle abort signal
    const abortHandler = () => {
      worker.onmessage = null;
      worker.onerror = null;
      reject(new DOMException('PDF extraction aborted', 'AbortError'));
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    // Set up message handler
    worker.onmessage = (e) => {
      const { type, page, total, text, meta, error } = e.data;

      switch (type) {
        case 'progress':
          onProgress?.(page, total);
          break;

        case 'complete':
          // Clean up
          if (signal) {
            signal.removeEventListener('abort', abortHandler);
          }
          worker.onmessage = null;
          worker.onerror = null;
          resolve({ text, meta });
          break;

        case 'error':
          // Clean up
          if (signal) {
            signal.removeEventListener('abort', abortHandler);
          }
          worker.onmessage = null;
          worker.onerror = null;
          reject(new Error(error));
          break;
      }
    };

    // Handle worker errors
    worker.onerror = (e) => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      worker.onmessage = null;
      worker.onerror = null;
      console.error('PDF worker error:', e);
      reject(new Error('PDF worker failed'));
    };

    // Send extraction request to worker
    worker.postMessage({
      arrayBuffer,
      limits: {
        PDF_MAX_PAGES: LIMITS.PDF_MAX_PAGES,
        PDF_MAX_CHARS: LIMITS.PDF_MAX_CHARS
      }
    });
  });
}

/**
 * Terminate the PDF worker to free resources
 * Call this when the extension is being unloaded
 */
export function terminatePdfWorker() {
  if (pdfWorker) {
    pdfWorker.terminate();
    pdfWorker = null;
  }
}

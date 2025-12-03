// pdf-worker.js - Web Worker for PDF text extraction
// Runs PDF.js extraction off the main thread to keep UI responsive

const PDF_CHAR_SAFETY_MARGIN = 2_000;

// Default limits (will be overridden by message data)
const DEFAULT_LIMITS = {
  PDF_MAX_PAGES: 50,
  PDF_MAX_CHARS: 50_000
};

/**
 * Initialize PDF.js library
 */
function initPdfJs() {
  if (typeof pdfjsLib !== 'undefined') {
    return;
  }
  
  // Import pdf.js library
  importScripts('lib/pdf.min.js');
  
  // Configure worker source
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
}

/**
 * Extract text from PDF buffer
 * @param {ArrayBuffer} arrayBuffer - PDF file data
 * @param {Object} limits - Extraction limits
 * @returns {Promise<{text: string, meta: Object}>}
 */
async function extractText(arrayBuffer, limits) {
  const maxPages = limits.PDF_MAX_PAGES || DEFAULT_LIMITS.PDF_MAX_PAGES;
  const maxChars = limits.PDF_MAX_CHARS || DEFAULT_LIMITS.PDF_MAX_CHARS;

  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true
  });

  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const effectiveMaxPages = Math.min(totalPages, maxPages);

  // Report initial progress
  self.postMessage({ type: 'progress', page: 0, total: effectiveMaxPages });

  const textParts = [];
  let collectedLength = 0;
  let pagesProcessed = 0;
  let hitEarlyExit = false;

  for (let pageNum = 1; pageNum <= effectiveMaxPages; pageNum++) {
    // Check if we've exceeded the character budget
    if (collectedLength > maxChars + PDF_CHAR_SAFETY_MARGIN) {
      hitEarlyExit = true;
      break;
    }

    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map(item => item.str)
      .join(' ')
      .trim();

    if (pageText) {
      const chunk = `--- Page ${pageNum} ---\n${pageText}`;
      const separatorLength = textParts.length > 0 ? 2 : 0; // account for join '\n\n'
      const remainingBudget = (maxChars + PDF_CHAR_SAFETY_MARGIN) - collectedLength - separatorLength;

      if (remainingBudget <= 0) {
        hitEarlyExit = true;
        break;
      }

      const chunkToAdd = chunk.length > remainingBudget ? chunk.slice(0, Math.max(remainingBudget, 0)) : chunk;
      if (!chunkToAdd) {
        hitEarlyExit = true;
        break;
      }

      collectedLength += separatorLength + chunkToAdd.length;
      textParts.push(chunkToAdd);
      pagesProcessed++;

      if (chunkToAdd.length < chunk.length || collectedLength > maxChars + PDF_CHAR_SAFETY_MARGIN) {
        hitEarlyExit = true;
        break;
      }
    }

    // Report progress for each page
    self.postMessage({ type: 'progress', page: pageNum, total: effectiveMaxPages });
  }

  const fullText = textParts.join('\n\n');
  const wasClamped = fullText.length > maxChars;
  const clampedText = wasClamped ? fullText.slice(0, maxChars) : fullText;
  const truncated = hitEarlyExit || wasClamped || totalPages > effectiveMaxPages;

  // Final progress update
  self.postMessage({ type: 'progress', page: pagesProcessed, total: effectiveMaxPages });

  if (wasClamped) {
    return {
      text: clampedText + '\n\n[...PDF content truncated due to length...]',
      meta: {
        truncated: true,
        pagesProcessed,
        totalPagesEstimate: totalPages,
        charsUsed: Math.min(clampedText.length, maxChars)
      }
    };
  }

  return {
    text: fullText || '[PDF appears to be empty or contains only images]',
    meta: {
      truncated,
      pagesProcessed,
      totalPagesEstimate: totalPages,
      charsUsed: Math.min((fullText || '').length, maxChars)
    }
  };
}

/**
 * Handle incoming messages from main thread
 */
self.onmessage = async (e) => {
  const { arrayBuffer, limits } = e.data;

  try {
    // Initialize PDF.js on first use
    initPdfJs();

    // Extract text
    const result = await extractText(arrayBuffer, limits);

    // Send completion message
    self.postMessage({
      type: 'complete',
      text: result.text,
      meta: result.meta
    });
  } catch (error) {
    // Send error message
    self.postMessage({
      type: 'error',
      error: error.message || 'PDF extraction failed'
    });
  }
};


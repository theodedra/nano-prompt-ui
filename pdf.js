// pdf.js - PDF text extraction using Mozilla's pdf.js library (local)
// This module handles PDF file processing for attachment support

import { LIMITS } from './constants.js';

/**
 * Extract text content from a PDF file
 * Uses Mozilla's pdf.js library loaded from local lib folder
 * @param {File} file - PDF file object
 * @returns {Promise<string>} Extracted text content
 */
export async function extractPdfText(file) {
  try {
    // Load pdf.js from local lib folder if not already loaded
    if (!window.pdfjsLib) {
      await loadPdfJs();
    }

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Load PDF document
    const loadingTask = window.pdfjsLib.getDocument({
      data: arrayBuffer,
      // Use local worker
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true
    });

    const pdf = await loadingTask.promise;

    // Extract text from all pages
    const textParts = [];
    const numPages = Math.min(pdf.numPages, LIMITS.PDF_MAX_PAGES || 50);

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Combine text items into a single string
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ')
        .trim();

      if (pageText) {
        textParts.push(`--- Page ${pageNum} ---\n${pageText}`);
      }
    }

    const fullText = textParts.join('\n\n');

    // Truncate if too long
    if (fullText.length > LIMITS.PDF_MAX_CHARS) {
      return fullText.slice(0, LIMITS.PDF_MAX_CHARS) + '\n\n[...PDF content truncated due to length...]';
    }

    return fullText || '[PDF appears to be empty or contains only images]';

  } catch (error) {
    console.error('PDF extraction failed:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    throw error; // Re-throw original error for better debugging
  }
}

/**
 * Load Mozilla's pdf.js library from local lib folder
 * @returns {Promise<void>}
 */
async function loadPdfJs() {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.pdfjsLib) {
      resolve();
      return;
    }

    // Create script tag for pdf.js from local lib folder
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/pdf.min.js');
    script.async = false; // Load synchronously for reliability

    script.onload = () => {
      // Configure worker from local lib folder
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
        resolve();
      } else {
        reject(new Error('pdf.js failed to load from local files'));
      }
    };

    script.onerror = (error) => {
      console.error('Failed to load pdf.js from local lib folder:', error);
      reject(new Error('Failed to load pdf.js library from local files'));
    };

    document.head.appendChild(script);
  });
}

/**
 * Check if a file is a PDF
 * @param {File} file - File to check
 * @returns {boolean} True if PDF
 */
export function isPdfFile(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Create a preview/summary of PDF metadata
 * @param {File} file - PDF file
 * @returns {Promise<string>} PDF summary
 */
export async function getPdfSummary(file) {
  try {
    if (!window.pdfjsLib) {
      await loadPdfJs();
    }

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const metadata = await pdf.getMetadata().catch(() => null);

    let summary = `PDF: ${file.name}\n`;
    summary += `Pages: ${pdf.numPages}\n`;

    if (metadata?.info) {
      if (metadata.info.Title) summary += `Title: ${metadata.info.Title}\n`;
      if (metadata.info.Author) summary += `Author: ${metadata.info.Author}\n`;
    }

    return summary;
  } catch (error) {
    return `PDF: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  }
}

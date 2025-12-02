/**
 * Attachment Handlers
 * 
 * Handles file attachment UI interactions via controller layer.
 */

import * as Controller from './controller.js';
import { extractPdfText } from './pdf.js';
import { toast } from './toast.js';
import { LIMITS, USER_ERROR_MESSAGES, validateAttachment } from './constants.js';
import * as UI from './ui.js';

/**
 * Trigger the hidden file input for attachments.
 */
export function handleAttachClick() {
  UI.triggerFilePicker();
}

/**
 * Handle file input change - process and attach images or PDFs.
 * @param {Event} event - Change event
 */
export function handleFileInputChange(event) {
  const files = Array.from(event.target.files || []);
  files.slice(0, LIMITS.MAX_ATTACHMENTS).forEach(async (file) => {
    let progressToast = null;

    const validation = validateAttachment(file);
    if (!validation.valid) {
      toast.warning(validation.error);
      return;
    }

    try {
      if (validation.fileType === 'pdf') {
        progressToast = toast.progress(`Processing: ${file.name}`, 0, 1);

        const { text: pdfText, meta: pdfMeta } = await extractPdfText(file, {
          onProgress: (currentPage, totalPages) => {
            if (currentPage === 0) {
              progressToast.update(`Extracting: ${file.name} (${totalPages} pages)`, 0, totalPages);
            } else {
              progressToast.update(`Page ${currentPage} of ${totalPages}`, currentPage, totalPages);
            }
          }
        });

        progressToast.dismiss();
        progressToast = null;

        Controller.addAttachment({
          name: file.name,
          type: 'application/pdf',
          data: pdfText,
          meta: pdfMeta
        });
        Controller.renderAttachments();
        toast.success(`PDF processed (${pdfMeta.pagesProcessed} pages)`);
      } else if (validation.fileType === 'image') {
        toast.info(`Processing image: ${file.name}...`);
        const canvas = await fileToCanvas(file, LIMITS.IMAGE_MAX_WIDTH);
        const blob = await canvasToBlob(canvas, file.type);
        Controller.addAttachment({
          name: file.name,
          type: file.type,
          data: blob
        });
        Controller.renderAttachments();
        toast.success('Image processed successfully');
      }
    } catch (e) {
      if (progressToast) {
        progressToast.dismiss();
      }

      console.error('File processing failed', e);
      if (validation.fileType === 'pdf') {
        const errorMsg = e.message || USER_ERROR_MESSAGES.PDF_PROCESSING_FAILED;
        toast.error(`PDF Error: ${errorMsg}`);
      } else {
        toast.error(USER_ERROR_MESSAGES.IMAGE_PROCESSING_FAILED);
      }
    }
  });
  event.target.value = '';
}

/**
 * Convert image file to canvas (required for Prompt API)
 * @param {File} file - Image file
 * @param {number} maxWidth - Maximum width for resizing
 * @returns {Promise<HTMLCanvasElement>}
 */
async function fileToCanvas(file, maxWidth) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas);
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Convert canvas to blob for storage (IndexedDB cannot store canvas objects)
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {string} mimeType - Image MIME type (e.g., 'image/jpeg')
 * @returns {Promise<Blob>}
 */
async function canvasToBlob(canvas, mimeType = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to convert canvas to blob'));
      }
    }, mimeType, 0.95);
  });
}

/**
 * Handle attachment chip click - remove attachment
 * @param {MouseEvent} event - Click event
 */
export function handleAttachmentListClick(event) {
  const target = event.target.closest('.attachment-chip');
  if (target) {
    const idx = Number(target.dataset.idx);
    Controller.removeAttachment(Number.isFinite(idx) ? idx : -1);
    Controller.renderAttachments();
  }
}

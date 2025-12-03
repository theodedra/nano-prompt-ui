import { getEls } from './core.js';

export function formatPdfTruncationNote(att = {}) {
  if (att.type !== 'application/pdf') return '';
  const meta = att.meta || {};
  if (!meta.truncated) return '';

  const pagesProcessed = Number.isFinite(meta.pagesProcessed) ? meta.pagesProcessed : 0;
  const totalPages = Number.isFinite(meta.totalPagesEstimate) ? meta.totalPagesEstimate : pagesProcessed || 0;
  const charsUsed = Number.isFinite(meta.charsUsed) ? meta.charsUsed : 0;
  const pagesLabel = totalPages && totalPages !== pagesProcessed
    ? `${pagesProcessed}/${totalPages} pages`
    : `${pagesProcessed} pages`;
  const charsLabel = `${charsUsed} characters`;
  return `PDF text truncated at ${pagesLabel} / ${charsLabel} (limit reached).`;
}

export function renderPendingAttachments(attachments) {
  const els = getEls();
  if (!els.attachmentList) return;
  els.attachmentList.innerHTML = '';

  if (!attachments?.length) return;

  const heading = document.createElement('li');
  heading.className = 'attachment-label';
  heading.textContent = 'Next message attachments';
  els.attachmentList.appendChild(heading);

  const fragment = document.createDocumentFragment();

  attachments.forEach((att, idx) => {
    const item = document.createElement('li');
    const chip = document.createElement('button');
    chip.className = 'attachment-chip pending';
    chip.textContent = att.name;
    chip.dataset.idx = idx;
    chip.title = 'Remove from next message';
    chip.setAttribute('aria-label', `Remove ${att.name} from next message`);
    item.appendChild(chip);

    const note = formatPdfTruncationNote(att);
    if (note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'attachment-note';
      noteEl.textContent = note;
      item.appendChild(noteEl);
    }

    fragment.appendChild(item);
  });

  els.attachmentList.appendChild(fragment);
}

export function triggerFilePicker() {
  document.getElementById('file-input')?.click();
}



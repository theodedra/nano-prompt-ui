import { $, formatTime, formatDate, markdownToHtml, escapeHtml } from './utils.js';
import { UI_MESSAGES, ICONS } from './constants.js';
import { VirtualScroller } from './virtual-scroll.js';

let els = {};
let lastStatus = UI_MESSAGES.CHECKING;
let isSystemBusy = false;
let renderedSessionId = null;
let sessionSearchTerm = '';

// Container elements for centralized state
let wrapEl = null;
let chatCardEl = null;
let inputCardEl = null;

// UPDATED: Observer for smooth scrolling
let scrollObserver = null;

// Virtual scrolling instance
let virtualScroller = null;

const ICON_MIC = ICONS.MIC;
const ICON_STOP = ICONS.STOP;

function formatPdfTruncationNote(att = {}) {
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

export function initUI() {
  els = {
    avail: $('#model-status'),
    log: $('#log'),
    copy: $('#copy'),
    saveMd: $('#save-md'),
    sessionSearch: $('#session-search'),
    sessionMeta: $('#session-meta'),
    contextPanel: $('#context-panel'),
    contextText: $('#context-text'),
    hardware: $('#hardware'),
    attachmentList: $('#attachment-list'),
    stop: $('#stop'),
    mic: $('#mic'),
    input: $('#in'),
    askBtn: $('#ask'),
    sumBtn: $('#sum'),
    attachBtn: $('#attach'),
    templatesMenu: $('#templates-menu'),
    templatesTrigger: $('#templates-trigger'),
    sessionMenu: $('#session-menu'),
    sessionTrigger: $('#session-trigger'),
    settingsModal: $('#settings-modal'),
    contextModal: $('#context-modal'),
    diagAvailability: $('#diag-availability'),
    diagChecked: $('#diag-last-checked'),
    diagWarmup: $('#diag-warmup'),
    diagWarmupNote: $('#diag-warmup-note'),
    diagRefreshBtn: $('#refresh-diagnostics'),
    diagWarmupBtn: $('#warmup-now')
  };

  // Cache container elements for centralized state management
  wrapEl = $('.wrap');
  chatCardEl = $('.card.chat');
  inputCardEl = $('.input-card');

  // UPDATED: Initialize ResizeObserver for smooth auto-scrolling
  // We observe the last message element. When it grows (streaming), we scroll.
  if (window.ResizeObserver && els.log) {
    scrollObserver = new ResizeObserver(() => {
       scrollToBottom();
    });
  }

  // Initialize virtual scroller (will only enable when needed)
  if (els.log) {
    virtualScroller = new VirtualScroller(els.log, createMessageElement);
  }

  if (els.sessionSearch) {
    sessionSearchTerm = els.sessionSearch.value || '';
  }

  buildContextSnapshotUI();
}

function buildContextSnapshotUI() {
  if (!els.contextModal) return;
  const modalCard = els.contextModal.querySelector('.modal-card');
  const contextArea = document.getElementById('context-text');
  if (!modalCard || !contextArea) return;

  const container = document.createElement('div');
  container.className = 'context-snapshots';

  const source = document.createElement('div');
  source.id = 'context-source-label';
  source.className = 'context-source-label';
  container.appendChild(source);

  const hint = document.createElement('p');
  hint.className = 'context-snapshot-hint';
  hint.textContent = 'Save page context to reuse it later without re-scraping.';
  container.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'row context-snapshot-actions';

  const saveBtn = document.createElement('button');
  saveBtn.id = 'save-context-snapshot';
  saveBtn.type = 'button';
  saveBtn.className = 'filled';
  saveBtn.textContent = 'Save snapshot';
  actions.appendChild(saveBtn);

  const liveBtn = document.createElement('button');
  liveBtn.id = 'use-live-context';
  liveBtn.type = 'button';
  liveBtn.className = 'tonal';
  liveBtn.textContent = 'Use live tab';
  actions.appendChild(liveBtn);

  container.appendChild(actions);

  const list = document.createElement('ul');
  list.id = 'context-snapshot-list';
  list.className = 'attachment-list context-snapshot-list';
  container.appendChild(list);

  modalCard.insertBefore(container, contextArea);

  els.contextSource = source;
  els.snapshotList = list;
  els.saveSnapshotBtn = saveBtn;
  els.useLiveContextBtn = liveBtn;
  setContextSourceLabel(null);
}

export function setContextSourceLabel(snapshot = null) {
  if (!els.contextSource) return;
  if (snapshot) {
    const label = snapshot.title || snapshot.url || 'Saved context';
    els.contextSource.textContent = `Using saved context: ${label}`;
  } else {
    els.contextSource.textContent = 'Using live tab context';
  }
}

function getSnapshotHost(url = '') {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

function clampLabel(text = '', max = 80) {
  if (!text) return 'Saved page';
  return text.length > max ? text.slice(0, max - 1) + '...' : text;
}

export function renderContextSnapshots(
  snapshots = [],
  activeId = null
) {
  if (!els.snapshotList) return;

  els.snapshotList.innerHTML = '';
  if (!snapshots || snapshots.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'context-snapshot-empty';
    empty.textContent = 'No saved contexts yet.';
    els.snapshotList.appendChild(empty);
    setContextSourceLabel();
    return;
  }

  const fragment = document.createDocumentFragment();
  snapshots.forEach((snap) => {
    const row = document.createElement('li');
    row.className = 'snapshot-row';
    row.dataset.id = snap.id;
    if (snap.id === activeId) row.classList.add('is-active');

    const info = document.createElement('div');
    info.className = 'snapshot-info';

    const title = document.createElement('div');
    title.className = 'snapshot-title';
    title.textContent = clampLabel(snap.title || getSnapshotHost(snap.url));
    info.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'snapshot-meta';
    const host = getSnapshotHost(snap.url);
    const metaBits = [host, snap.createdAt ? formatDate(snap.createdAt) : ''].filter(Boolean);
    meta.textContent = metaBits.join(' • ');
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'snapshot-actions';

    const useBtn = document.createElement('button');
    useBtn.className = 'tonal use-snapshot';
    useBtn.dataset.id = snap.id;
    useBtn.textContent = snap.id === activeId ? 'In use' : 'Use';
    useBtn.disabled = snap.id === activeId;
    actions.appendChild(useBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'icon delete-snapshot';
    delBtn.dataset.id = snap.id;
    delBtn.textContent = '✕';
    delBtn.title = 'Delete snapshot';
    delBtn.setAttribute('aria-label', 'Delete snapshot');
    actions.appendChild(delBtn);

    row.appendChild(info);
    row.appendChild(actions);
    fragment.appendChild(row);
  });

  els.snapshotList.appendChild(fragment);
  const activeSnapshot = snapshots.find(s => s.id === activeId);
  setContextSourceLabel(activeSnapshot || null);
}

export function setRestrictedState(isRestricted) {
  const interactive = [
    els.input, els.askBtn, els.sumBtn, els.mic, els.attachBtn, els.templatesTrigger
  ];

  if (isRestricted) {
    interactive.forEach(el => { if(el) el.disabled = true; });
    // TAB SWITCH FIX: Don't disable stop button if something is running
    // Stop button should remain functional even on restricted pages if narration/generation is active
    if (els.input) els.input.placeholder = UI_MESSAGES.INPUT_PLACEHOLDER_DISABLED;
    setStatusText(UI_MESSAGES.SYSTEM_PAGE);
  } else {
    interactive.forEach(el => { if(el) el.disabled = false; });
    if(els.stop) els.stop.disabled = !isSystemBusy;
    if (els.input) els.input.placeholder = UI_MESSAGES.INPUT_PLACEHOLDER;
    setStatusText(lastStatus === UI_MESSAGES.SYSTEM_PAGE ? UI_MESSAGES.READY : lastStatus);
  }
}

export function trapFocus(e, container) {
  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusableContent = container.querySelectorAll(focusableSelector);
  
  if (focusableContent.length === 0) return false;
  const first = focusableContent[0];
  const last = focusableContent[focusableContent.length - 1];

  if (e.shiftKey) { 
    if (document.activeElement === first) { last.focus(); e.preventDefault(); return true; }
  } else { 
    if (document.activeElement === last) { first.focus(); e.preventDefault(); return true; }
  }
  return false;
}

export function getTrapContainer() {
  const openModal = document.querySelector('.modal:not([hidden])');
  return openModal || document.body;
}

export function setBusy(isBusy) {
  isSystemBusy = isBusy;
  
  // Centralized state: toggle on containers
  if (wrapEl) wrapEl.classList.toggle('is-busy', isBusy);
  if (chatCardEl) chatCardEl.classList.toggle('is-streaming', isBusy);
  if (inputCardEl) inputCardEl.classList.toggle('is-busy', isBusy);

  // Button states still need explicit toggling for accessibility
  if (els.askBtn) els.askBtn.disabled = isBusy;
  if (els.sumBtn) els.sumBtn.disabled = isBusy;
  if (els.stop) els.stop.disabled = !isBusy;

  // Status text updates
  if (els.avail) {
    els.avail.textContent = isBusy ? UI_MESSAGES.THINKING : lastStatus;
  }
}

export function setStatusText(text) {
  lastStatus = text;
  if (!isSystemBusy && els.avail) {
    els.avail.textContent = text;
  }
}

// Track current model status for click behavior
let currentModelStatus = null;

/**
 * Update the model status chip with diagnostic info
 * @param {Object} status - Model status from getModelStatusSummary()
 * @param {string} status.level - 'ok' | 'limited' | 'broken'
 * @param {string} status.label - Short text for the chip
 * @param {string} status.tooltip - Tooltip text
 * @param {boolean} status.showGuideLink - Whether to link to setup guide
 */
export function updateModelStatusChip(status) {
  if (!els.avail || !status) return;
  
  currentModelStatus = status;
  
  // Update chip text (respects busy state)
  lastStatus = status.label;
  if (!isSystemBusy) {
    els.avail.textContent = status.label;
  }
  
  // Update tooltip
  els.avail.title = status.tooltip;
  
  // Update data attributes for styling hooks (no colors, just structure)
  els.avail.dataset.level = status.level;
  els.avail.dataset.clickable = status.showGuideLink ? 'true' : 'false';
  
  // Update cursor style based on clickability
  els.avail.style.cursor = status.showGuideLink ? 'pointer' : 'default';
}

/**
 * Handle click on model status chip
 * Opens setup guide if there are issues
 */
export function handleModelStatusChipClick() {
  if (currentModelStatus?.showGuideLink) {
    openSetupGuideModal();
  }
}

/**
 * Get current model status (for external checks)
 * @returns {Object|null}
 */
export function getModelStatus() {
  return currentModelStatus;
}

export function setHardwareStatus(text) {
  if (els.hardware) els.hardware.textContent = text;
}

function formatWarmupStatus(status) {
  if (status === 'success') return 'success';
  if (status === 'awaiting-download') return 'waiting for download';
  if (status === 'error') return 'failed';
  if (status === 'unavailable') return 'unavailable';
  if (status === 'running') return 'running...';
  return '';
}

export function updateDiagnostics(diag = {}) {
  if (!els.diagAvailability) return;

  const availabilityText = diag.availabilityLabel || diag.availability || 'Unknown';
  els.diagAvailability.textContent = availabilityText;

  if (els.diagChecked) {
    const checked = diag.availabilityCheckedAt
      ? formatDate(diag.availabilityCheckedAt)
      : 'Never checked';
    els.diagChecked.textContent = checked;
  }

  if (els.diagWarmup) {
    const warmupTime = diag.lastWarmupAt
      ? formatDate(diag.lastWarmupAt)
      : 'Not run yet';
    const statusLabel = formatWarmupStatus(diag.lastWarmupStatus);
    els.diagWarmup.textContent = statusLabel
      ? `${warmupTime} (${statusLabel})`
      : warmupTime;
  }

  if (els.diagWarmupNote) {
    let note = '';
    if (diag.lastWarmupStatus === 'error' && diag.lastWarmupError) {
      note = diag.lastWarmupError;
    } else if (diag.lastWarmupStatus === 'awaiting-download') {
      note = 'Warmup skipped until model download completes.';
    } else if (diag.lastWarmupStatus === 'unavailable' && diag.lastWarmupError) {
      note = diag.lastWarmupError;
    }
    els.diagWarmupNote.textContent = note;
  }
}

export function setDiagnosticsBusy(target = 'all', isBusy = false) {
  const targets = target === 'all'
    ? [els.diagRefreshBtn, els.diagWarmupBtn]
    : target === 'availability'
      ? [els.diagRefreshBtn]
      : [els.diagWarmupBtn];

  targets.forEach(btn => { if (btn) btn.disabled = isBusy; });
}

export function setContextText(text) {
  if (els.contextText) els.contextText.value = text || '';
}

export function getContextText() {
  return els.contextText?.value?.trim() || '';
}

// UPDATED: Simplified scroll logic, called by Observer
function scrollToBottom() {
  if (!els.log) return;
  els.log.scrollTop = els.log.scrollHeight;
}

// UPDATED: Helper to attach observer to the latest message
function observeLastMessage() {
  if (!scrollObserver || !els.log) return;

  // Disconnect previous observations
  scrollObserver.disconnect();

  const lastMsg = els.log.lastElementChild;
  if (lastMsg) {
    scrollObserver.observe(lastMsg);
  }

  // Also scroll once immediately
  scrollToBottom();
}

// Track which session is currently being renamed
let editingSessionId = null;
let editingInputRef = null;

export function renderSessions({
  sessions = {},
  sessionMeta = {},
  currentSessionId = null,
  matches = [],
  searchTerm = '',
  currentTitle = '',
  confirmingId = null,
  editingId = null
} = {}) {
  if (!els.sessionMenu) return;

  sessionSearchTerm = searchTerm || '';

  // Keep the search box stable across renders
  if (els.sessionSearch && els.sessionSearch.value !== sessionSearchTerm) {
    els.sessionSearch.value = sessionSearchTerm;
  }

  // Remove any previously rendered session rows (preserve search input)
  els.sessionMenu.querySelectorAll('.session-row, .session-empty').forEach(row => row.remove());

  if (els.sessionTrigger) {
    els.sessionTrigger.textContent = currentTitle || 'Untitled Session';
  }

  const fragment = document.createDocumentFragment();

  if (matches.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'session-empty';
    empty.textContent = 'No sessions found';
    fragment.appendChild(empty);
  }

  matches.forEach(id => {
    // Use metadata if available (lazy loading), otherwise full session
    const session = sessions[id] || sessionMeta[id];
    if (!session) return;
    
    const isEditing = id === editingId;
    
    const row = document.createElement('li');
    row.className = 'session-row';
    if (id === currentSessionId) row.classList.add('is-active');
    if (isEditing) row.classList.add('is-editing');
    row.dataset.id = id;

    const info = document.createElement('div');
    info.className = 'session-info';
    
    if (isEditing) {
      // Inline rename input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'session-rename-input';
      input.value = session.title || '';
      input.dataset.id = id;
      input.setAttribute('aria-label', 'Rename session');
      input.setAttribute('autocomplete', 'off');
      info.appendChild(input);
      
      // Store reference for focus
      editingInputRef = input;
      
      // Also add hidden title for structure
      const titleDiv = document.createElement('div');
      titleDiv.className = 'session-title';
      titleDiv.textContent = session.title || 'Untitled';
      info.appendChild(titleDiv);
    } else {
      const titleDiv = document.createElement('div');
      titleDiv.className = 'session-title';
      titleDiv.textContent = session.title || 'Untitled';
      info.appendChild(titleDiv);
    }
    
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = isEditing ? 'session-rename-actions' : 'session-actions';
    
    if (isEditing) {
      // Save button
      const saveBtn = document.createElement('button');
      saveBtn.className = 'action-btn save';
      saveBtn.textContent = '✓';
      saveBtn.title = 'Save';
      saveBtn.dataset.id = id;
      saveBtn.dataset.action = 'save-rename';
      actions.appendChild(saveBtn);
      
      // Cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'action-btn cancel';
      cancelBtn.textContent = '✕';
      cancelBtn.title = 'Cancel';
      cancelBtn.dataset.id = id;
      cancelBtn.dataset.action = 'cancel-rename';
      actions.appendChild(cancelBtn);
    } else {
      const editBtn = document.createElement('button');
      editBtn.className = 'action-btn edit';
      editBtn.textContent = '✎';
      editBtn.title = 'Rename';
      editBtn.dataset.id = id;
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn delete';
      delBtn.dataset.id = id;

      if (id === confirmingId) {
        delBtn.classList.add('is-confirming');
        delBtn.textContent = '✓';
        delBtn.title = 'Confirm Delete';
      } else {
        delBtn.textContent = '✕';
        delBtn.title = 'Delete';
      }
      actions.appendChild(delBtn);
    }

    row.appendChild(actions);
    fragment.appendChild(row);
  });

  els.sessionMenu.appendChild(fragment);
  
  // Focus the input after DOM is updated
  if (editingInputRef && editingId) {
    requestAnimationFrame(() => {
      if (editingInputRef) {
        editingInputRef.focus();
        editingInputRef.select();
      }
    });
  }
}

/**
 * Get the current value from the rename input
 * @returns {string|null} The input value or null if not editing
 */
export function getRenameInputValue() {
  if (!editingInputRef) return null;
  return editingInputRef.value.trim();
}

/**
 * Get the editing session ID
 * @returns {string|null}
 */
export function getEditingSessionId() {
  return editingSessionId;
}

/**
 * Set the editing session ID
 * @param {string|null} id
 */
export function setEditingSessionId(id) {
  editingSessionId = id;
  if (!id) {
    editingInputRef = null;
  }
}

export function setSessionSearchTerm(value) {
  sessionSearchTerm = value || '';
  if (els.sessionSearch && els.sessionSearch.value !== sessionSearchTerm) {
    els.sessionSearch.value = sessionSearchTerm;
  }
}

export function getSessionSearchTerm() {
  return sessionSearchTerm;
}

export function toggleMenu(menuName) {
  let menu, trigger;
  if (menuName === 'session') {
    menu = els.sessionMenu;
    trigger = els.sessionTrigger;
    closeMenu('templates');
    closeMenu('language');
    closeMenu('theme');
  } else if (menuName === 'templates') {
    menu = els.templatesMenu;
    trigger = els.templatesTrigger;
    closeMenu('session');
    closeMenu('language');
    closeMenu('theme');
  } else if (menuName === 'language') {
    menu = document.getElementById('language-menu');
    trigger = document.getElementById('language-trigger');
    closeMenu('session');
    closeMenu('templates');
    closeMenu('theme');
  } else if (menuName === 'theme') {
    menu = document.getElementById('theme-menu');
    trigger = document.getElementById('theme-trigger');
    closeMenu('session');
    closeMenu('templates');
    closeMenu('language');
  }

  if (menu) {
    const isHidden = menu.hidden;
    menu.hidden = !isHidden;
    trigger?.setAttribute('aria-expanded', !isHidden);
  }
}

export function closeMenu(menuName) {
  let menu, trigger;
  if (menuName === 'session') {
    menu = els.sessionMenu;
    trigger = els.sessionTrigger;
  } else if (menuName === 'templates') {
    menu = els.templatesMenu;
    trigger = els.templatesTrigger;
  } else if (menuName === 'language') {
    menu = document.getElementById('language-menu');
    trigger = document.getElementById('language-trigger');
  } else if (menuName === 'theme') {
    menu = document.getElementById('theme-menu');
    trigger = document.getElementById('theme-trigger');
  }

  if (menu) {
    menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  }
}

function createMessageActions(msg, idx) {
  const actions = document.createElement('div');
  actions.className = 'copy1';
  
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.dataset.idx = idx;
  copyBtn.className = 'bubble-copy';
  actions.appendChild(copyBtn);

  if (msg.role === 'ai') {
    const speak = document.createElement('button');
    speak.textContent = '🔊';
    speak.dataset.idx = idx;
    speak.className = 'speak';
    actions.appendChild(speak);
  }
  return actions;
}

function buildSmartReplyRow(replies = []) {
  if (!replies || replies.length === 0) return null;

  const container = document.createElement('div');
  container.className = 'smart-replies';

  const label = document.createElement('div');
  label.className = 'smart-replies-label';
  label.textContent = 'Smart suggestions';
  container.appendChild(label);

  const list = document.createElement('div');
  list.className = 'smart-reply-list';
  replies.forEach((reply) => {
    if (!reply) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'smart-reply-btn tonal';
    btn.dataset.reply = reply;
    btn.textContent = reply;
    list.appendChild(btn);
  });

  container.appendChild(list);
  return container;
}

function createMessageElement(m, idx) {
    const div = document.createElement('div');
    div.className = `msg ${m.role}`;

    const header = document.createElement('div');
    header.className = 'msg-header';

    const label = document.createElement('span');
    label.className = 'sender-label';
    label.textContent = m.role === 'user' ? 'You' : 'Nano';
    header.appendChild(label);

    const time = document.createElement('time');
    time.textContent = formatTime(m.ts);
    header.appendChild(time);
    div.appendChild(header);

    const body = document.createElement('div');
    body.className = 'body';

    // LOADING ANIMATION: Show three dots for empty AI messages
    if (m.role === 'ai' && (!m.text || m.text.trim() === '')) {
      body.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    } else {
      body.innerHTML = markdownToHtml(m.text || '');
    }
    div.appendChild(body);

    if (m.attachments?.length) {
      const attachmentSection = document.createElement('div');
      attachmentSection.className = 'message-attachments';

      const label = document.createElement('div');
      label.className = 'attachment-label';
      label.textContent = 'Attached to this message';
      attachmentSection.appendChild(label);

      const att = document.createElement('ul');
      att.className = 'attachment-list persisted-attachments';
      m.attachments.forEach(file => {
        const chip = document.createElement('li');
        chip.className = 'attachment-chip';
        chip.textContent = file.name;
        const note = formatPdfTruncationNote(file);
        if (note) {
          const noteEl = document.createElement('div');
          noteEl.className = 'attachment-note';
          noteEl.textContent = note;
          chip.appendChild(noteEl);
        }
        att.appendChild(chip);
      });

      attachmentSection.appendChild(att);
      div.appendChild(attachmentSection);
    }

    const smartRepliesRow = buildSmartReplyRow(m.smartReplies);
    if (smartRepliesRow) {
      div.appendChild(smartRepliesRow);
    }

    const actions = createMessageActions(m, idx);
    div.appendChild(actions);

    // SMART POSITIONING: Detect cursor position and reposition buttons
    div.addEventListener('mousemove', (e) => {
      const rect = div.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const halfHeight = rect.height / 2;

      // If cursor is in bottom half, show buttons at bottom
      if (mouseY > halfHeight) {
        actions.classList.add('bottom');
      } else {
        actions.classList.remove('bottom');
      }
    });

    return div;
}

/**
 * Render the full chat log for a session.
 * NOT used during streaming - use updateLastMessageBubble() for that.
 * 
 * Called on:
 * - Session switch (full re-render)
 * - Initial load
 * - Message deletion/reset
 * - When virtual scroller needs full refresh
 * 
 * For virtual scrolling mode: delegates to VirtualScroller.render()
 * which uses cached nodes (no re-parsing markdown on each call).
 */
export function renderLog(session) {
  if (!session || !els.log) return;

  // Detect session switch and clear
  if (renderedSessionId !== session.id) {
      els.log.innerHTML = '';
      renderedSessionId = session.id;
      // Disable virtual scrolling on session switch (will re-enable if needed)
      if (virtualScroller) {
        if (virtualScroller.enabled) {
          virtualScroller.disable();
        } else {
          virtualScroller.reset();
        }
      }
  }

  const messages = session.messages || [];

  // Centralized state: toggle is-empty on chat card container
  if (chatCardEl) chatCardEl.classList.toggle('is-empty', messages.length === 0);

  // --- FIX START: Handle Empty State ---
  if (messages.length === 0) {
    els.log.innerHTML = '<div class="msg ai placeholder"><div class="body"><p>Ready to chat.</p></div></div>';
    setExportAvailability(false);
    return;
  }

  // --- FIX START: Remove Placeholder if chatting starts ---
  const placeholder = els.log.querySelector('.placeholder');
  if (placeholder) {
    placeholder.remove();
  }
  // --- FIX END ---

  // VIRTUAL SCROLLING: Enable if message count is high
  if (virtualScroller && VirtualScroller.shouldEnable(messages.length)) {
    virtualScroller.setMessages(messages);
    if (!virtualScroller.enabled) {
      virtualScroller.enable();
      // Calibrate item height on first enable
      setTimeout(() => virtualScroller.calibrateItemHeight(), 100);
    }
    virtualScroller.render(messages);
    setExportAvailability(true);
    return;
  }

  // NORMAL RENDERING: For small message counts
  // Incremental Append
  const existingCount = els.log.querySelectorAll('.msg:not(.placeholder)').length;

  if (existingCount < messages.length) {
      const fragment = document.createDocumentFragment();
      for (let i = existingCount; i < messages.length; i++) {
          fragment.appendChild(createMessageElement(messages[i], i));
      }
      els.log.appendChild(fragment);
  } else if (existingCount > messages.length) {
      // Fallback if deleted/reset
      els.log.innerHTML = '';
      const fragment = document.createDocumentFragment();
      messages.forEach((m, i) => fragment.appendChild(createMessageElement(m, i)));
      els.log.appendChild(fragment);
  }

  setExportAvailability(true);

  // UPDATED: Start observing the new last element
  observeLastMessage();
}

export function renderSmartReplies(replies = []) {
  if (!els.log) return;

  // Remove any existing suggested rows to avoid stale content
  els.log.querySelectorAll('.smart-replies').forEach((el) => el.remove());

  if (!replies || replies.length === 0) return;

  const aiMessages = els.log.querySelectorAll('.msg.ai');
  const lastAi = aiMessages[aiMessages.length - 1];
  if (!lastAi) return;

  const row = buildSmartReplyRow(replies);
  if (!row) return;

  lastAi.appendChild(row);
  observeLastMessage();
}

/**
 * Update the last AI message bubble with new content.
 * Used for streaming updates - does NOT re-render the full log.
 * 
 * Architecture:
 * - When streaming=true: uses fast textContent path (no markdown parsing)
 * - When streaming=false: parses markdown once at completion
 * - Always finds the last node via VirtualScroller when enabled (no DOM scan)
 * 
 * @param {Object} session - Current session
 * @param {string} markdownText - Text content to display
 * @param {{streaming?: boolean}} options - If streaming, skip markdown parsing
 */
export function updateLastMessageBubble(session, markdownText, { streaming = false } = {}) {
  if (!els.log || !session || !session.messages?.length) return;

  const lastIdx = session.messages.length - 1;
  const lastMessage = session.messages[lastIdx];
  let lastMsg = null;

  // VirtualScroller path: O(1) lookup via cached node map
  if (virtualScroller && virtualScroller.enabled) {
    lastMsg = virtualScroller.getMessageNode(lastMessage, lastIdx);
  } else {
    // Fallback: DOM query (only for small sessions where virtual scroll is disabled)
    const messages = els.log.querySelectorAll('.msg:not(.placeholder)');
    lastMsg = messages[messages.length - 1];
  }

  if (!lastMsg || !lastMsg.classList.contains('ai')) {
    if (!streaming) renderLog(session);
    return;
  }

  const body = lastMsg.querySelector('.body');

  // LOADING ANIMATION: Show three dots if text is empty, otherwise show content
  const hasContent = markdownText && markdownText.trim() !== '';
  if (!hasContent) {
    const dotsHtml = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    if (body.innerHTML !== dotsHtml) {
      body.innerHTML = dotsHtml;
      body.dataset.renderMode = 'loading';
    }
    return;
  }

  if (streaming) {
    // Fast path: skip content comparison since throttle limits update frequency
    body.textContent = markdownText;
    body.dataset.renderMode = 'plain';
    return;
  }

  const newHtml = markdownToHtml(markdownText);
  if (body.dataset.renderMode !== 'markdown' || body.innerHTML !== newHtml) {
    body.innerHTML = newHtml;
    body.dataset.renderMode = 'markdown';
    // ResizeObserver will detect growth and scroll automatically
  }
}

function setExportAvailability(enabled) {
  [els.copy, els.saveMd].forEach(btn => { if (btn) btn.disabled = !enabled; });
}

export function triggerFilePicker() {
  document.getElementById('file-input')?.click();
}

export function downloadBlob(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function renderPendingAttachments(attachments) {
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

// Track which template is currently being edited
let editingTemplateId = null;
let editingTemplateInputRef = null;
let isAddingNewTemplate = false;

export function updateTemplates(templates, blankTemplateId = null, editingId = null) {
  if (!els.templatesMenu) return;
  els.templatesMenu.innerHTML = '';
  
  const fragment = document.createDocumentFragment();
  
  templates.forEach(t => {
    if (blankTemplateId && t.id === blankTemplateId) return;
    
    const isEditing = t.id === editingId;
    
    const item = document.createElement('li');
    item.className = 'template-row';
    if (isEditing) item.classList.add('is-editing');
    item.dataset.id = t.id;
    
    if (isEditing) {
      // Inline edit mode
      const editContainer = document.createElement('div');
      editContainer.className = 'template-edit-form';
      
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'template-edit-label';
      labelInput.value = t.label || '';
      labelInput.placeholder = 'Template name';
      labelInput.dataset.id = t.id;
      labelInput.dataset.field = 'label';
      labelInput.setAttribute('aria-label', 'Template name');
      labelInput.setAttribute('autocomplete', 'off');
      editContainer.appendChild(labelInput);
      
      const textInput = document.createElement('textarea');
      textInput.className = 'template-edit-text';
      textInput.value = t.text || '';
      textInput.placeholder = 'Template prompt text';
      textInput.dataset.id = t.id;
      textInput.dataset.field = 'text';
      textInput.setAttribute('aria-label', 'Template prompt');
      textInput.rows = 3;
      editContainer.appendChild(textInput);
      
      const actions = document.createElement('div');
      actions.className = 'template-edit-actions';
      
      const saveBtn = document.createElement('button');
      saveBtn.className = 'action-btn save';
      saveBtn.textContent = '✓ Save';
      saveBtn.dataset.id = t.id;
      saveBtn.dataset.action = 'save-template';
      actions.appendChild(saveBtn);
      
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'action-btn cancel';
      cancelBtn.textContent = '✕ Cancel';
      cancelBtn.dataset.id = t.id;
      cancelBtn.dataset.action = 'cancel-template';
      actions.appendChild(cancelBtn);
      
      editContainer.appendChild(actions);
      item.appendChild(editContainer);
      
      // Store reference for focus
      editingTemplateInputRef = labelInput;
    } else {
      // Normal display mode
      const content = document.createElement('div');
      content.className = 'template-content';
      
      const btn = document.createElement('button');
      btn.className = 'dropdown-item template-select';
      btn.textContent = t.label;
      btn.dataset.text = t.text;
      btn.dataset.id = t.id;
      content.appendChild(btn);
      
      item.appendChild(content);
      
      const actions = document.createElement('div');
      actions.className = 'template-actions';
      
      const editBtn = document.createElement('button');
      editBtn.className = 'action-btn edit';
      editBtn.textContent = '✎';
      editBtn.title = 'Edit template';
      editBtn.dataset.id = t.id;
      editBtn.dataset.action = 'edit-template';
      actions.appendChild(editBtn);
      
      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn delete';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete template';
      delBtn.dataset.id = t.id;
      delBtn.dataset.action = 'delete-template';
      actions.appendChild(delBtn);
      
      item.appendChild(actions);
    }
    
    fragment.appendChild(item);
  });
  
  // Add "New Template" row if not currently editing
  if (!editingId && !isAddingNewTemplate) {
    const addRow = document.createElement('li');
    addRow.className = 'template-add-row';
    
    const addBtn = document.createElement('button');
    addBtn.className = 'dropdown-item template-add';
    addBtn.dataset.action = 'add-template';
    addBtn.textContent = '+ Add new template';
    addRow.appendChild(addBtn);
    
    fragment.appendChild(addRow);
  }
  
  // Add "New Template" form if adding
  if (isAddingNewTemplate) {
    const addFormRow = document.createElement('li');
    addFormRow.className = 'template-row is-editing new-template';
    
    const editContainer = document.createElement('div');
    editContainer.className = 'template-edit-form';
    
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'template-edit-label';
    labelInput.id = 'new-template-label';
    labelInput.value = '';
    labelInput.placeholder = 'Template name';
    labelInput.setAttribute('aria-label', 'New template name');
    labelInput.setAttribute('autocomplete', 'off');
    editContainer.appendChild(labelInput);
    
    const textInput = document.createElement('textarea');
    textInput.className = 'template-edit-text';
    textInput.id = 'new-template-text';
    textInput.value = '';
    textInput.placeholder = 'Template prompt text';
    textInput.setAttribute('aria-label', 'New template prompt');
    textInput.rows = 3;
    editContainer.appendChild(textInput);
    
    const actions = document.createElement('div');
    actions.className = 'template-edit-actions';
    
    const saveBtn = document.createElement('button');
    saveBtn.className = 'action-btn save';
    saveBtn.textContent = '✓ Save';
    saveBtn.dataset.action = 'save-new-template';
    actions.appendChild(saveBtn);
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn cancel';
    cancelBtn.textContent = '✕ Cancel';
    cancelBtn.dataset.action = 'cancel-new-template';
    actions.appendChild(cancelBtn);
    
    editContainer.appendChild(actions);
    addFormRow.appendChild(editContainer);
    fragment.appendChild(addFormRow);
    
    // Store reference for focus
    editingTemplateInputRef = labelInput;
  }
  
  els.templatesMenu.appendChild(fragment);
  
  // Focus the input after DOM is updated
  if (editingTemplateInputRef && (editingId || isAddingNewTemplate)) {
    requestAnimationFrame(() => {
      if (editingTemplateInputRef) {
        editingTemplateInputRef.focus();
        if (editingId) {
          editingTemplateInputRef.select();
        }
      }
    });
  }
}

/**
 * Get template edit form values
 * @param {string} id - Template ID (or null for new template)
 * @returns {{label: string, text: string}|null}
 */
export function getTemplateEditValues(id) {
  if (id) {
    const row = els.templatesMenu?.querySelector(`.template-row[data-id="${id}"]`);
    if (!row) return null;
    const labelInput = row.querySelector('.template-edit-label');
    const textInput = row.querySelector('.template-edit-text');
    return {
      label: labelInput?.value?.trim() || '',
      text: textInput?.value?.trim() || ''
    };
  } else {
    // New template form
    const labelInput = document.getElementById('new-template-label');
    const textInput = document.getElementById('new-template-text');
    return {
      label: labelInput?.value?.trim() || '',
      text: textInput?.value?.trim() || ''
    };
  }
}

/**
 * Set whether we're adding a new template
 * @param {boolean} adding
 */
export function setAddingNewTemplate(adding) {
  isAddingNewTemplate = adding;
  if (!adding) {
    editingTemplateInputRef = null;
  }
}

/**
 * Get whether we're adding a new template
 * @returns {boolean}
 */
export function isAddingTemplate() {
  return isAddingNewTemplate;
}

/**
 * Get the editing template ID
 * @returns {string|null}
 */
export function getEditingTemplateId() {
  return editingTemplateId;
}

/**
 * Set the editing template ID
 * @param {string|null} id
 */
export function setEditingTemplateId(id) {
  editingTemplateId = id;
  if (!id) {
    editingTemplateInputRef = null;
  }
}

export function setMicState(active) {
  // Centralized state: toggle on input-card container
  if (inputCardEl) inputCardEl.classList.toggle('is-recording', active);
  
  if (els.mic) {
    els.mic.setAttribute('aria-pressed', active ? 'true' : 'false');
    els.mic.innerHTML = active ? ICON_STOP : ICON_MIC;
  }
}

/**
 * Set error state on the input card container
 * @param {boolean} hasError - Whether there's an input error
 */
export function setInputError(hasError) {
  if (inputCardEl) inputCardEl.classList.toggle('has-error', hasError);
}

export function openSettingsModal() {
  if (els.settingsModal) {
    els.settingsModal.removeAttribute('hidden');
    document.body?.classList.add('modal-open');
    const firstInput = document.getElementById('temperature');
    if (firstInput) firstInput.focus();
  }
}

export function openContextModal() {
  if (!els.contextModal) return;
  els.contextModal.removeAttribute('hidden');
  document.body?.classList.add('modal-open');
  const area = els.contextText || document.getElementById('context-text');
  if (area) area.focus();
}

export function openSetupGuideModal() {
  const modal = document.getElementById('setup-guide-modal');
  if (modal) {
    modal.removeAttribute('hidden');
    document.body?.classList.add('modal-open');
  }
}

export function closeModal() {
  const setupModal = document.getElementById('setup-guide-modal');
  [els.settingsModal, els.contextModal, setupModal].forEach(modal => {
    if (modal) modal.setAttribute('hidden', 'true');
  });
  document.body?.classList.remove('modal-open');
  if (els.input) els.input.focus();
}

export function isModalOpen() {
  const modals = document.querySelectorAll('.modal:not([hidden])');
  return modals.length > 0;
}

export function getInputValue() {
  return els.input?.value || '';
}

export function setInputValue(value) {
  if (els.input) els.input.value = value;
}

export function setStopEnabled(canStop) {
  if (els.stop) els.stop.disabled = !canStop;
}

// SIMPLIFIED: Accept state as parameter instead of dynamic import
// This eliminates circular dependency complexity
export function restoreStopButtonState(isActive) {
  if (els.stop) els.stop.disabled = !isActive;
}

export function focusInput() {
  if (els.input) els.input.focus();
}

export function getSessionSearchValue() {
  return els.sessionSearch?.value || '';
}

export function setLanguageSelection(lang, label) {
  const trigger = document.getElementById('language-trigger');
  if (trigger) {
    trigger.textContent = label || lang;
    trigger.dataset.selectedLang = lang;
  }
}

export function setThemeSelection(theme, label) {
  const trigger = document.getElementById('theme-trigger');
  if (trigger) {
    trigger.textContent = label || theme;
    trigger.dataset.selectedTheme = theme;
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;

  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export function syncSettingsForm({
  temperature,
  topK,
  systemPrompt,
  language,
  languageLabel,
  theme,
  themeLabel
} = {}) {
  const tempSlider = document.getElementById('temperature');
  const tempValue = document.getElementById('temperature-value');
  if (tempSlider) {
    tempSlider.value = temperature ?? '';
    if (tempValue) tempValue.textContent = tempSlider.value;
    tempSlider.oninput = () => {
      if (tempValue) tempValue.textContent = tempSlider.value;
    };
  }

  const topKInput = document.getElementById('topk');
  const systemPromptInput = document.getElementById('system-prompt');
  if (topKInput) topKInput.value = topK ?? '';
  if (systemPromptInput) systemPromptInput.value = systemPrompt ?? '';

  setLanguageSelection(language, languageLabel);
  setThemeSelection(theme, themeLabel);
}

export function getSettingsFormValues(defaults = {}) {
  const temp = document.getElementById('temperature')?.value ?? defaults.temperature;
  const topk = document.getElementById('topk')?.value ?? defaults.topK;
  const sys = document.getElementById('system-prompt')?.value ?? defaults.systemPrompt;

  const langTrigger = document.getElementById('language-trigger');
  const themeTrigger = document.getElementById('theme-trigger');

  return {
    temperature: Number(temp),
    topK: Number(topk),
    systemPrompt: sys,
    language: langTrigger?.dataset.selectedLang || defaults.language,
    theme: themeTrigger?.dataset.selectedTheme || defaults.theme
  };
}

export function setSetupGuideContent(html) {
  const content = document.getElementById('setup-content');
  if (content) content.innerHTML = html;
}

function getAPIName(api) {
  if (api.flag.includes('prompt-api')) return 'Prompt API (Gemini Nano)';
  if (api.flag.includes('translation-api')) return 'Translation API';
  if (api.flag.includes('language-detection')) return 'Language Detection API';
  if (api.flag.includes('summarization')) return 'Summarization API';
  if (api.flag.includes('rewriter')) return 'Rewriter API';
  return 'Unknown API';
}

export function renderSetupGuide(status) {
  let html = '';

  if (!status.browserInfo.isChrome) {
    html += `<div class="setup-section error">
      <h3>❌ Unsupported Browser</h3>
      <p>Chrome Built-in AI APIs are only available in Google Chrome.</p>
      <p><strong>Your browser:</strong> ${escapeHtml(navigator.userAgent)}</p>
    </div>`;
    setSetupGuideContent(html);
    return;
  }

  if (!status.browserInfo.recommendedVersion) {
    html += `<div class="setup-section warning">
      <h3>⚠️ Chrome Version</h3>
      <p><strong>Current:</strong> Chrome ${status.browserInfo.chromeVersion}</p>
      <p><strong>Recommended:</strong> Chrome 138+</p>
      <p>Some features may not work properly. Please update Chrome.</p>
    </div>`;
  }

  if (status.isFullySetup) {
    html += `<div class="setup-section success">
      <h3>✅ All Required APIs Ready</h3>
      <p>Your setup is complete! All required APIs are available.</p>
    </div>`;
  } else {
    html += `<div class="setup-section error">
      <h3>❌ Setup Incomplete</h3>
      <p>Some required APIs are missing. Follow the instructions below to enable them.</p>
    </div>`;
  }

  html += '<div class="setup-section"><h3>Required APIs</h3>';

  status.requiredAPIs.forEach(api => {
    const statusIcon = api.available ? '✅' : '❌';
    const statusClass = api.available ? 'success' : 'error';

    html += `<div class="api-item ${statusClass}">
      <div class="api-header">
        <span class="api-icon">${statusIcon}</span>
        <div style="flex: 1;">
          <div class="api-name">${getAPIName(api)}</div>
          <div class="api-status">${escapeHtml(api.message)}</div>
        </div>
      </div>`;

    if (!api.available) {
      html += `<div class="api-instructions">
        <p><strong>To enable:</strong></p>
        <ol>
          <li>Copy this flag: <code class="flag-url">${escapeHtml(api.flag)}</code></li>
          <li>Paste it into your Chrome address bar</li>
          <li>Set to: <strong>${escapeHtml(api.flagValue)}</strong></li>
          <li>Click "Relaunch" button</li>
        </ol>
      </div>`;
    } else if (api.multilingual !== undefined) {
      html += `<div class="api-info">
        <p><strong>Multilingual (es, ja):</strong> ${api.multilingual ? '✅ Enabled' : '❌ Disabled'}</p>
        ${!api.multilingual ? '<p><small>For Spanish/Japanese support, set flag to "Enabled multilingual"</small></p>' : ''}
      </div>`;
    }

    html += '</div>';
  });

  html += '</div>';
  html += '<div class="setup-section"><h3>Optional Features (Nice-to-Have)</h3>';
  html += '<p class="section-desc">These features provide better performance but are not required:</p>';

  status.optionalAPIs.forEach(api => {
    const statusIcon = api.available ? '✅' : '⚪';
    const statusClass = api.available ? 'success' : 'optional';

    html += `<div class="api-item ${statusClass}">
      <div class="api-header">
        <span class="api-icon">${statusIcon}</span>
        <div style="flex: 1;">
          <div class="api-name">${getAPIName(api)}</div>
          <div class="api-status">${escapeHtml(api.message)}</div>
        </div>
      </div>`;

    if (!api.available && api.fallback) {
      html += `<div class="api-info">
        <p><strong>Fallback:</strong> ${escapeHtml(api.fallback)}</p>
      </div>`;
    }

    if (!api.available) {
      html += `<div class="api-instructions collapsed">
        <p><strong>To enable (optional):</strong></p>
        <ol>
          <li>Flag: <code class="flag-url">${escapeHtml(api.flag)}</code></li>
          <li>Set to: <strong>${escapeHtml(api.flagValue)}</strong></li>
        </ol>
      </div>`;
    }

    html += '</div>';
  });

  html += '</div>';

  html += `<div class="setup-footer">
    <p><strong>After changing flags:</strong> Chrome will show a "Relaunch" button. Click it to restart Chrome and apply changes.</p>
    <p><strong>Having issues?</strong> Make sure you have:</p>
    <ul>
      <li>At least 22 GB free disk space</li>
      <li>GPU with 4+ GB VRAM or CPU with 16GB RAM</li>
      <li>Unmetered internet connection for model downloads</li>
    </ul>
  </div>`;

  setSetupGuideContent(html);
}

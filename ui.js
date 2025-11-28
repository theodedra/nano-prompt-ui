import { $, formatTime, formatDate, markdownToHtml } from './utils.js';
import {
  appState,
  getCurrentSession,
  setCurrentSession,
  summarizeSession,
  BLANK_TEMPLATE_ID
} from './storage.js';

let els = {};
let lastStatus = 'Checking...';
let isSystemBusy = false;
let renderedSessionId = null;

// UPDATED: Observer for smooth scrolling
let scrollObserver = null;

const ICON_MIC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
const ICON_STOP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect></svg>`;

export function initUI() {
  els = {
    avail: $('#model-status'),
    log: $('#log'),
    copy: $('#copy'),
    saveMd: $('#save-md'),
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
    contextModal: $('#context-modal')
  };

  // UPDATED: Initialize ResizeObserver for smooth auto-scrolling
  // We observe the last message element. When it grows (streaming), we scroll.
  if (window.ResizeObserver && els.log) {
    scrollObserver = new ResizeObserver(() => {
       scrollToBottom();
    });
  }
}

export function setRestrictedState(isRestricted) {
  const interactive = [
    els.input, els.askBtn, els.sumBtn, els.mic, els.attachBtn, els.templatesTrigger
  ];

  if (isRestricted) {
    interactive.forEach(el => { if(el) el.disabled = true; });
    // TAB SWITCH FIX: Don't disable stop button if something is running
    // Stop button should remain functional even on restricted pages if narration/generation is active
    if (els.input) els.input.placeholder = "AI disabled on system pages";
    setStatusText("System Page");
  } else {
    interactive.forEach(el => { if(el) el.disabled = false; });
    if(els.stop) els.stop.disabled = !isSystemBusy;
    if (els.input) els.input.placeholder = "Ask anything... (Shift+Enter for newline)";
    setStatusText(lastStatus === "System Page" ? "Ready" : lastStatus);
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

export function setBusy(isBusy) {
  isSystemBusy = isBusy;
  if (els.askBtn) els.askBtn.disabled = isBusy;
  if (els.sumBtn) els.sumBtn.disabled = isBusy;
  if (els.stop) els.stop.disabled = !isBusy;

  if (els.avail) {
    if (isBusy) {
      els.avail.textContent = 'Thinking...';
      els.avail.classList.add('pulse'); 
    } else {
      els.avail.textContent = lastStatus;
      els.avail.classList.remove('pulse');
    }
  }
}

export function setStatusText(text) {
  lastStatus = text;
  if (!isSystemBusy && els.avail) {
    els.avail.textContent = text;
  }
}

export function setHardwareStatus(text) {
  if (els.hardware) els.hardware.textContent = text;
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

export function renderSessions(confirmingId = null) {
  if (!els.sessionMenu) return;
  els.sessionMenu.innerHTML = '';
  
  const current = getCurrentSession();
  if (els.sessionTrigger && current) {
    els.sessionTrigger.textContent = current.title || 'Untitled Session';
  }

  const fragment = document.createDocumentFragment();

  appState.sessionOrder.forEach(id => {
    const session = appState.sessions[id];
    if (!session) return;
    
    const row = document.createElement('li');
    row.className = 'session-row';
    if (id === appState.currentSessionId) row.classList.add('active');
    row.dataset.id = id;

    const info = document.createElement('div');
    info.className = 'session-info';
    info.innerHTML = `<div class="session-title">${session.title || 'Untitled'}</div>`;
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'session-actions';
    
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
      delBtn.classList.add('confirming');
      delBtn.textContent = '✓';
      delBtn.title = 'Confirm Delete';
    } else {
      delBtn.textContent = '✕';
      delBtn.title = 'Delete';
    }
    actions.appendChild(delBtn);

    row.appendChild(actions);
    fragment.appendChild(row);
  });

  els.sessionMenu.appendChild(fragment);
}

export function toggleMenu(menuName) {
  let menu, trigger;
  if (menuName === 'session') {
    menu = els.sessionMenu;
    trigger = els.sessionTrigger;
    closeMenu('templates'); 
  } else if (menuName === 'templates') {
    menu = els.templatesMenu;
    trigger = els.templatesTrigger;
    closeMenu('session'); 
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
      const att = document.createElement('ul');
      att.className = 'attachment-list';
      m.attachments.forEach(file => {
        const chip = document.createElement('li');
        chip.className = 'attachment-chip';
        chip.textContent = file.name;
        att.appendChild(chip);
      });
      div.appendChild(att);
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

export function renderLog() {
  const session = getCurrentSession();
  if (!session || !els.log) return;

  // Detect session switch and clear
  if (renderedSessionId !== session.id) {
      els.log.innerHTML = '';
      renderedSessionId = session.id;
  }
  
  const messages = session.messages;
  
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

export function updateLastMessageBubble(markdownText) {
  if (!els.log) return;
  const lastMsg = els.log.lastElementChild;

  if (lastMsg && lastMsg.classList.contains('ai')) {
      const body = lastMsg.querySelector('.body');

      // LOADING ANIMATION: Show three dots if text is empty, otherwise show content
      let newHtml;
      if (!markdownText || markdownText.trim() === '') {
        newHtml = '<div class="loading-dots"><span></span><span></span><span></span></div>';
      } else {
        newHtml = markdownToHtml(markdownText);
      }

      if (body.innerHTML !== newHtml) {
          body.innerHTML = newHtml;
          // Note: We don't need to call scrollToBottom here anymore.
          // The ResizeObserver setup in initUI/observeLastMessage will detect
          // that 'lastMsg' has grown in height and call scrollToBottom automatically.
      }
  } else {
    renderLog();
  }
}

function setExportAvailability(enabled) {
  [els.copy, els.saveMd].forEach(btn => { if (btn) btn.disabled = !enabled; });
}

export function renderAttachments(attachments) {
  if (!els.attachmentList) return;
  els.attachmentList.innerHTML = '';
  
  const fragment = document.createDocumentFragment();
  
  attachments.forEach((att, idx) => {
    const item = document.createElement('li');
    const chip = document.createElement('button');
    chip.className = 'attachment-chip';
    chip.textContent = att.name;
    chip.dataset.idx = idx;
    item.appendChild(chip);
    fragment.appendChild(item);
  });
  
  els.attachmentList.appendChild(fragment);
}

export function updateTemplates(templates) {
  if (!els.templatesMenu) return;
  els.templatesMenu.innerHTML = '';
  
  const fragment = document.createDocumentFragment();
  
  templates.forEach(t => {
    if (t.id === BLANK_TEMPLATE_ID) return; 
    const item = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'dropdown-item';
    btn.textContent = t.label;
    btn.dataset.text = t.text;
    item.appendChild(btn);
    fragment.appendChild(item);
  });
  
  els.templatesMenu.appendChild(fragment);
}

export function setMicState(active) {
  if (els.mic) {
    els.mic.setAttribute('aria-pressed', active ? 'true' : 'false');
    els.mic.innerHTML = active ? ICON_STOP : ICON_MIC;
    if (active) els.mic.classList.add('recording');
    else els.mic.classList.remove('recording');
  }
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
  if (els.contextModal) {
    els.contextModal.removeAttribute('hidden');
    document.body?.classList.add('modal-open');
    const area = document.getElementById('context-text');
    if (area) area.focus();
  }
}

export function closeModal() {
  [els.settingsModal, els.contextModal].forEach(modal => {
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

export function getSessionMarkdown(sessionId) {
  const session = appState.sessions[sessionId];
  if (!session) return '';
  return session.messages.map(m => `### ${m.role === 'user' ? 'User' : 'Nano'}\n${m.text}`).join('\n\n');
}

export function getPlaintext(sessionId) {
  return summarizeSession(sessionId);
}

export function highlightSession(sessionId) {
  setCurrentSession(sessionId);
  renderSessions(); 
  renderLog();
}
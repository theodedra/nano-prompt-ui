import { $, formatTime, formatDate, markdownToHtml } from './utils.js';
import {
  appState,
  getCurrentSession,
  setCurrentSession,
  summarizeSession,
  BLANK_TEMPLATE_ID
} from './storage.js';

let els = {};
// CLEANUP: Removed unused 'sessionFilter' variable

let lastStatus = 'Checking...'; 
let isSystemBusy = false;

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
    templatesMenu: $('#templates-menu'),
    templatesTrigger: $('#templates-trigger'),
    sessionMenu: $('#session-menu'),
    sessionTrigger: $('#session-trigger'),
    settingsModal: $('#settings-modal'),
    contextModal: $('#context-modal')
  };
}

export function setBusy(isBusy) {
  isSystemBusy = isBusy;
  $('#ask').disabled = isBusy;
  $('#sum').disabled = isBusy;
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

function scrollToBottom() {
  if (els.log) els.log.scrollTop = els.log.scrollHeight;
}

// CLEANUP: Removed unused 'filter' argument
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

export function renderLog() {
  const session = getCurrentSession();
  if (!session || !els.log) return;
  const messages = session.messages;
  
  els.log.innerHTML = '';
  
  if (!messages.length) {
    els.log.innerHTML = '<div class="msg ai"><div class="body"><p>Ready to chat.</p></div></div>';
    setExportAvailability(false);
    return;
  }
  
  const fragment = document.createDocumentFragment();

  messages.forEach((m, idx) => {
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
    body.innerHTML = markdownToHtml(m.text || '');
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

    div.appendChild(createMessageActions(m, idx));
    fragment.appendChild(div);
  });
  
  els.log.appendChild(fragment);
  scrollToBottom();
  setExportAvailability(true);
}

export function updateLastMessageBubble(markdownText) {
  if (!els.log) return;
  const lastMsgBody = els.log.querySelector('.msg:last-child .body');
  if (lastMsgBody) {
    lastMsgBody.innerHTML = markdownToHtml(markdownText);
    scrollToBottom();
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
    document.getElementById('temperature')?.focus();
  }
}

export function openContextModal() {
  if (els.contextModal) {
    els.contextModal.removeAttribute('hidden');
    document.body?.classList.add('modal-open');
    document.getElementById('context-text')?.focus();
  }
}

export function closeModal() {
  [els.settingsModal, els.contextModal].forEach(modal => {
    if (modal) modal.setAttribute('hidden', 'true');
  });
  document.body?.classList.remove('modal-open');
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
  // CLEANUP: Removed argument
  renderSessions(); 
  renderLog();
}
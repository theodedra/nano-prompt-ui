import { $, formatTime, formatDate, markdownToHtml } from './utils.js';
import {
  appState,
  getCurrentSession,
  setCurrentSession,
  summarizeSession
} from './storage.js';

let els = {};
let sessionFilter = '';

// Track the resting status (e.g. "Ready") so we can restore it after "Thinking..."
let lastStatus = 'Checking...'; 
let isSystemBusy = false;

// SVG CONSTANTS
const ICON_MIC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
const ICON_STOP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect></svg>`;

export function initUI() {
  els = {
    avail: $('#model-status'),
    log: $('#log'),
    // Header Actions
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
  if (els.stop) {
    els.stop.disabled = !isBusy;
  }

  // VISUAL FEEDBACK: Change status chip when working
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
  if (els.hardware) {
    els.hardware.textContent = text;
  }
}

export function setContextText(text) {
  if (els.contextText) {
    els.contextText.value = text || '';
  }
}

export function getContextText() {
  return els.contextText?.value?.trim() || '';
}

function scrollToBottom() {
  if (els.log) {
    els.log.scrollTop = els.log.scrollHeight;
  }
}

export function renderSessions(filter = '') {
  if (!els.sessionMenu) return;
  els.sessionMenu.innerHTML = '';
  
  const current = getCurrentSession();
  if (els.sessionTrigger && current) {
    els.sessionTrigger.textContent = current.title || 'Untitled Session';
  }

  appState.sessionOrder.forEach(id => {
    const session = appState.sessions[id];
    if (!session) return;
    
    const row = document.createElement('div');
    row.className = 'session-row';
    if (id === appState.currentSessionId) row.classList.add('active');
    row.dataset.id = id;

    const info = document.createElement('div');
    info.className = 'session-info';
    // CHANGED: Removed date div, just showing title
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
    delBtn.textContent = '✕';
    delBtn.title = 'Delete';
    delBtn.dataset.id = id;
    actions.appendChild(delBtn);

    row.appendChild(actions);
    els.sessionMenu.appendChild(row);
  });
}

export function toggleSessionMenu() {
  if (els.sessionMenu) {
    const isHidden = els.sessionMenu.hidden;
    els.sessionMenu.hidden = !isHidden;
    els.sessionTrigger?.setAttribute('aria-expanded', !isHidden);
    if (!isHidden === true) {
      closeTemplateMenu();
    }
  }
}

export function closeSessionMenu() {
  if (els.sessionMenu) {
    els.sessionMenu.hidden = true;
    els.sessionTrigger?.setAttribute('aria-expanded', 'false');
  }
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
      const att = document.createElement('div');
      att.className = 'attachment-list';
      m.attachments.forEach(file => {
        const chip = document.createElement('span');
        chip.className = 'attachment-chip';
        chip.textContent = file.name;
        att.appendChild(chip);
      });
      div.appendChild(att);
    }

    const actions = document.createElement('div');
    actions.className = 'copy1';
    
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.dataset.idx = idx;
    copyBtn.className = 'bubble-copy';
    actions.appendChild(copyBtn);

    if (m.role === 'ai') {
      const speak = document.createElement('button');
      speak.textContent = '🔊';
      speak.dataset.idx = idx;
      speak.className = 'speak';
      actions.appendChild(speak);
    }
    
    div.appendChild(actions);
    
    els.log.appendChild(div); 
  });
  
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
  attachments.forEach((att, idx) => {
    const chip = document.createElement('button');
    chip.className = 'attachment-chip';
    chip.textContent = att.name;
    chip.dataset.idx = idx;
    els.attachmentList.appendChild(chip);
  });
}

export function updateTemplates(templates) {
  if (!els.templatesMenu) return;
  els.templatesMenu.innerHTML = '';
  templates.forEach(t => {
    if (t.id === 'blank') return; 
    const btn = document.createElement('button');
    btn.className = 'dropdown-item';
    btn.textContent = t.label;
    btn.dataset.text = t.text;
    els.templatesMenu.appendChild(btn);
  });
}

export function toggleTemplateMenu() {
  if (els.templatesMenu) {
    const isHidden = els.templatesMenu.hidden;
    els.templatesMenu.hidden = !isHidden;
    els.templatesTrigger?.setAttribute('aria-expanded', !isHidden);
    if (!isHidden === true) {
      closeSessionMenu();
    } 
  }
}

export function closeTemplateMenu() {
  if (els.templatesMenu) {
    els.templatesMenu.hidden = true;
    els.templatesTrigger?.setAttribute('aria-expanded', 'false');
  }
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
  if (els.input) {
    els.input.value = value;
  }
}

export function setStopEnabled(canStop) {
  if (els.stop) {
    els.stop.disabled = !canStop;
  }
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
  renderSessions(sessionFilter);
  renderLog();
}
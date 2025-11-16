import { $, formatTime, formatDate, markdownToHtml } from './utils.js';
import {
  appState,
  getCurrentSession,
  setCurrentSession,
  summarizeSession
} from './storage.js';

let els = {};
let sessionFilter = '';

export function initUI() {
  els = {
    avail: $('#model-status'),
    language: $('#lang'),
    log: $('#log'),
    copy: $('#copy'),
    copyMd: $('#copy-md'),
    saveMd: $('#save-md'),
    sessionList: $('#session-list'),
    sessionMeta: $('#session-meta'),
    contextPanel: $('#context-panel'),
    contextText: $('#context-text'),
    hardware: $('#hardware'),
    attachmentList: $('#attachment-list'),
    stop: $('#stop'),
    mic: $('#mic'),
    input: $('#in'),
    templates: $('#templates'),
    modal: $('#settings-modal')
  };
}

export function getOutputLanguage() {
  return els.language?.value || 'en';
}

export function setLanguage(lang) {
  if (els.language) {
    els.language.value = lang;
  }
}

export function setBusy(isBusy) {
  $('#ask').disabled = isBusy;
  $('#sum').disabled = isBusy;
  if (els.stop) {
    els.stop.disabled = !isBusy;
  }
}

export function setStatusText(text) {
  if (els.avail) {
    els.avail.textContent = text;
  }
}

export function setHardwareStatus(text) {
  if (els.hardware) {
    els.hardware.textContent = text;
  }
}

export function toggleContextPanel(show) {
  if (!els.contextPanel) return;
  els.contextPanel.hidden = !show;
  $('#toggle-context')?.setAttribute('aria-expanded', show ? 'true' : 'false');
}

export function setContextText(text) {
  if (els.contextText) {
    els.contextText.value = text || '';
  }
}

export function getContextText() {
  return els.contextText?.value?.trim() || '';
}

export function renderSessions(filter = '') {
  sessionFilter = filter.toLowerCase();
  if (!els.sessionList) return;
  els.sessionList.innerHTML = '';
  appState.sessionOrder.forEach(id => {
    const session = appState.sessions[id];
    if (!session) return;
    const haystack = `${session.title} ${(session.tags || []).join(' ')}`.toLowerCase();
    if (sessionFilter && !haystack.includes(sessionFilter)) return;
    const item = document.createElement('button');
    item.className = 'session-item';
    item.setAttribute('role', 'tab');
    item.setAttribute('data-id', id);
    item.setAttribute('aria-selected', id === appState.currentSessionId ? 'true' : 'false');
    item.innerHTML = `<strong>${session.title || 'Untitled'}</strong><small>${formatDate(session.updatedAt)}</small>`;
    els.sessionList.appendChild(item);
  });
}

export function renderLog() {
  const session = getCurrentSession();
  if (!session || !els.log) return;
  const messages = session.messages;
  if (!messages.length) {
    els.log.innerHTML = '<div class="msg ai">(nothing yet)</div>';
    setExportAvailability(false);
    if (els.sessionMeta) {
      els.sessionMeta.textContent = 'No messages yet';
    }
    return;
  }
  els.log.innerHTML = '';
  messages.forEach((m, idx) => {
    const div = document.createElement('div');
    div.className = `msg ${m.role}`;
    const label = document.createElement('div');
    label.className = 'sender-label';
    label.textContent = m.role === 'user' ? 'You' : 'Nano';
    div.appendChild(label);
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
    const time = document.createElement('time');
    time.textContent = formatTime(m.ts);
    div.appendChild(time);
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
      const feedback = document.createElement('div');
      feedback.className = 'feedback';
      const up = document.createElement('button');
      up.textContent = '👍';
      up.dataset.idx = idx;
      up.dataset.rating = 'up';
      if (m.rating === 'up') up.classList.add('active');
      const down = document.createElement('button');
      down.textContent = '👎';
      down.dataset.idx = idx;
      down.dataset.rating = 'down';
      if (m.rating === 'down') down.classList.add('active');
      feedback.appendChild(up);
      feedback.appendChild(down);
      div.appendChild(feedback);
    }
    div.appendChild(actions);
    els.log.appendChild(div);
  });
  els.log.scrollTop = els.log.scrollHeight;
  setExportAvailability(true);
  if (els.sessionMeta) {
    els.sessionMeta.textContent = `${messages.length} messages · updated ${formatDate(session.updatedAt)}`;
  }
}

function setExportAvailability(enabled) {
  [els.copy, els.copyMd, els.saveMd].forEach(btn => { if (btn) btn.disabled = !enabled; });
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
  if (!els.templates) return;
  els.templates.innerHTML = '';
  templates.forEach(t => {
    const option = document.createElement('option');
    option.value = t.id;
    option.textContent = t.label;
    option.dataset.text = t.text;
    els.templates.appendChild(option);
  });
  els.templates.value = 'blank';
}

export function setMicState(active) {
  if (els.mic) {
    els.mic.setAttribute('aria-pressed', active ? 'true' : 'false');
    els.mic.textContent = active ? '⏹' : '🎙';
  }
}

export function openModal() {
  if (!els.modal) return;
  els.modal.removeAttribute('hidden');
  document.body?.classList.add('modal-open');
  document.getElementById('temperature')?.focus();
}

export function closeModal() {
  if (!els.modal) return;
  els.modal.setAttribute('hidden', 'true');
  document.body?.classList.remove('modal-open');
}

export function isModalOpen() {
  return !!els.modal && !els.modal.hasAttribute('hidden');
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
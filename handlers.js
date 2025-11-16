import {
  appState,
  loadState,
  saveState,
  setLanguage,
  createSessionFrom,
  deleteSession,
  setCurrentSession,
  getCurrentSession,
  addAttachment,
  clearAttachments,
  getAttachments,
  updateContextDraft,
  updateSettings,
  setSessionRating,
  renameSession
} from './storage.js';
import * as UI from './ui.js';
import {
  runPrompt,
  summarizeActiveTab,
  cancelGeneration,
  speakText,
  refreshAvailability
} from './model.js';
import { fetchContext } from './context.js';

let recognition;
let recognizing = false;
let tabListenersAttached = false;
let tabActivatedListener;
let tabUpdatedListener;

async function refreshContextDraft(force = false) {
  try {
    const ctx = await fetchContext(force);
    const text = ctx?.text || '';
    const previous = appState.contextDraft;
    updateContextDraft(text);
    UI.setContextText(text);
    if (text !== previous) {
      await saveState();
    }
  } catch (e) {
    console.warn('Failed to refresh context', e);
  }
}

function ensureTabContextSync() {
  if (tabListenersAttached) return;
  if (!chrome?.tabs?.onActivated || !chrome?.tabs?.onUpdated) return;
  tabActivatedListener = () => {
    refreshContextDraft(true);
  };
  tabUpdatedListener = (tabId, changeInfo, tab) => {
    if (tab?.active && changeInfo.status === 'complete') {
      refreshContextDraft(true);
    }
  };
  chrome.tabs.onActivated.addListener(tabActivatedListener);
  chrome.tabs.onUpdated.addListener(tabUpdatedListener);
  window.addEventListener('unload', () => {
    if (tabActivatedListener) {
      chrome.tabs.onActivated.removeListener(tabActivatedListener);
    }
    if (tabUpdatedListener) {
      chrome.tabs.onUpdated.removeListener(tabUpdatedListener);
    }
    tabListenersAttached = false;
  }, { once: true });
  tabListenersAttached = true;
}

export async function bootstrap() {
  await loadState();
  UI.setLanguage(appState.language);
  UI.updateTemplates(appState.templates);
  UI.renderSessions();
  UI.setContextText(appState.contextDraft);
  UI.renderAttachments(getAttachments());
  UI.renderLog();
  ensureTabContextSync();
  await refreshContextDraft(true);
}

export async function handleAskClick() {
  const value = UI.getInputValue().trim();
  const text = value || 'Say hello in five words.';
  const attachments = getAttachments().slice();
  UI.setInputValue('');
  clearAttachments();
  UI.renderAttachments(getAttachments());
  await runPrompt({
    text,
    contextOverride: UI.getContextText(),
    attachments
  });
}

export async function handleSummarizeClick() {
  await summarizeActiveTab(UI.getContextText());
}

export async function handleNewSessionClick() {
  const session = createSessionFrom();
  setCurrentSession(session.id);
  await saveState();
  UI.renderSessions();
  UI.renderLog();
}

export async function handleCloneSession() {
  const session = createSessionFrom(appState.currentSessionId);
  setCurrentSession(session.id);
  await saveState();
  UI.renderSessions();
  UI.renderLog();
}

export async function handleDeleteSession() {
  if (Object.keys(appState.sessions).length <= 1) return;
  deleteSession(appState.currentSessionId);
  await saveState();
  UI.renderSessions();
  UI.renderLog();
}

export async function handleRenameSession() {
  const current = getCurrentSession();
  const title = prompt('Rename session', current.title || '');
  if (!title) return;
  renameSession(current.id, title.trim());
  await saveState();
  UI.renderSessions();
}

export async function handleCopyChatClick() {
  const text = UI.getPlaintext(appState.currentSessionId);
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

export async function handleCopyMarkdown() {
  const md = UI.getSessionMarkdown(appState.currentSessionId);
  if (!md) return;
  await navigator.clipboard.writeText(md);
}

export function handleSaveMarkdown() {
  const md = UI.getSessionMarkdown(appState.currentSessionId);
  if (!md) return;
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${getCurrentSession().title || 'chat'}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function handleLanguageChange(event) {
  setLanguage(event.target.value);
  await saveState();
  await refreshAvailability();
}

export function handleInputKeyDown(event) {
  if (event.key === 'Enter' && event.ctrlKey) {
    event.preventDefault();
    handleSummarizeClick();
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleAskClick();
    return;
  }
  if (event.key === 'Escape') {
    if (UI.isModalOpen()) {
      event.preventDefault();
      UI.closeModal();
    } else {
      window.close();
    }
  }
}

export function handleDocumentKeyDown(event) {
  if (event.key !== 'Escape') return;
  if (!UI.isModalOpen()) return;
  event.preventDefault();
  UI.closeModal();
}

export function handleModalClick(event) {
  if (event.target?.dataset?.dismiss === 'modal') {
    UI.closeModal();
  }
}

export async function handleLogClick(event) {
  const idx = event.target.dataset.idx;
  if (!Number.isFinite(Number(idx))) return;
  if (event.target.classList.contains('bubble-copy')) {
    const msg = getCurrentSession().messages[Number(idx)];
    if (msg) {
      await navigator.clipboard.writeText(msg.text || '');
    }
  } else if (event.target.classList.contains('speak')) {
    const msg = getCurrentSession().messages[Number(idx)];
    if (msg?.text) {
      speakText(msg.text);
    }
  } else if (event.target.dataset.rating) {
    setSessionRating(appState.currentSessionId, Number(idx), event.target.dataset.rating);
    UI.renderLog();
    saveState();
  }
}

export async function handleSessionListClick(event) {
  const id = event.target.closest('.session-item')?.dataset.id;
  if (!id) return;
  setCurrentSession(id);
  UI.highlightSession(id);
  await saveState();
}

export function handleSessionSearch(event) {
  UI.renderSessions(event.target.value);
}

export function handleTemplateSelect(event) {
  const selected = event.target.options[event.target.selectedIndex];
  const text = selected?.dataset?.text;
  if (typeof text === 'string') {
    const existing = UI.getInputValue();
    const joiner = existing.trim() ? '\n' : '';
    UI.setInputValue(existing + joiner + text + '\n');
    event.target.value = 'blank';
  }
}

export function handleAttachClick() {
  document.getElementById('file-input')?.click();
}

export function handleFileInputChange(event) {
  const files = Array.from(event.target.files || []);
  files.slice(0, 3).forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      addAttachment({ name: file.name, type: file.type, data: reader.result });
      UI.renderAttachments(getAttachments());
    };
    reader.readAsDataURL(file);
  });
  event.target.value = '';
}

export function handleAttachmentListClick(event) {
  if (!event.target.dataset.idx) return;
  const idx = Number(event.target.dataset.idx);
  getAttachments().splice(idx, 1);
  UI.renderAttachments(getAttachments());
}

export function handleMicClick() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
  if (recognizing) {
    recognition.stop();
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.onstart = () => {
    recognizing = true;
    UI.setMicState(true);
  };
  recognition.onend = () => {
    recognizing = false;
    UI.setMicState(false);
  };
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join(' ');
    UI.setInputValue(transcript);
  };
  try {
    recognition.start();
  } catch (e) {
    console.warn('Speech recognition failed', e);
    recognizing = false;
    UI.setMicState(false);
  }
}

export function handleSpeakLast() {
  const msgs = getCurrentSession().messages;
  const last = [...msgs].reverse().find(m => m.role === 'ai');
  if (last?.text) {
    speakText(last.text);
  }
}

export function handleStopClick() {
  cancelGeneration();
}

export async function handleToggleContext() {
  const hidden = document.getElementById('context-panel').hidden;
  UI.toggleContextPanel(hidden);
  if (hidden) {
    await refreshContextDraft(true);
  }
}

export function handleContextInput(event) {
  updateContextDraft(event.target.value);
  saveState();
}

export function handleOpenSettings() {
  UI.openModal();
  document.getElementById('temperature').value = appState.settings.temperature;
  document.getElementById('topk').value = appState.settings.topK;
  document.getElementById('system-prompt').value = appState.settings.systemPrompt;
}

export function handleCloseSettings() {
  UI.closeModal();
}

export async function handleSaveSettings() {
  updateSettings({
    temperature: Number(document.getElementById('temperature').value),
    topK: Number(document.getElementById('topk').value),
    systemPrompt: document.getElementById('system-prompt').value
  });
  await saveState();
  UI.closeModal();
  await refreshAvailability();
}
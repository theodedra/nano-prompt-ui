import {
  appState,
  loadState,
  saveState,
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
import { fetchContext, classifyIntent } from './context.js';
import { resizeImage } from './utils.js';

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
  UI.updateTemplates(appState.templates);
  UI.renderSessions();
  UI.setContextText(appState.contextDraft);
  UI.renderAttachments(getAttachments());
  UI.renderLog();
  
  // PERMISSION SETUP LOGIC
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mic_setup') === 'true') {
    setTimeout(() => handleMicClick(), 500);
    return; 
  }
  
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
  
  let contextOverride = UI.getContextText();
  const intent = classifyIntent(text);
  
  if (text.length < 30 && intent === 'none') {
    contextOverride = '';
  }

  await runPrompt({
    text,
    contextOverride,
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
  UI.closeSessionMenu();
}

export async function handleCloneSession() {
  const session = createSessionFrom(appState.currentSessionId);
  setCurrentSession(session.id);
  await saveState();
  UI.renderSessions();
  UI.renderLog();
}

export async function handleDeleteSession() {
  // Deprecated generic handler, logic moved to handleSessionMenuClick
}

export async function handleRenameSession(sessionId) {
  const targetId = sessionId || appState.currentSessionId;
  const session = appState.sessions[targetId];
  if (!session) return;
  
  const title = prompt('Rename session', session.title || '');
  if (!title) return;
  renameSession(targetId, title.trim());
  await saveState();
  UI.renderSessions();
}

// UPDATED: Central handler for the session list dropdown with inline confirm
export async function handleSessionMenuClick(event) {
  const btn = event.target.closest('button');
  const row = event.target.closest('.session-row');
  
  // Handle Action Buttons (Edit/Delete)
  if (btn && btn.classList.contains('action-btn')) {
    event.stopPropagation(); // Don't select the session
    const id = btn.dataset.id;
    
    if (btn.classList.contains('delete')) {
      // Check if we are in "Confirm" state
      if (btn.classList.contains('confirming')) {
        // CONFIRMED: Perform deletion
        deleteSession(id);
        await saveState();
        UI.renderSessions();
        UI.renderLog();
      } else {
        // FIRST CLICK: Enter "Confirm" state
        
        // 1. Reset any other buttons that might be waiting for confirmation
        document.querySelectorAll('.action-btn.delete.confirming').forEach(b => {
          b.classList.remove('confirming');
          b.textContent = '✕';
          b.title = 'Delete';
        });

        // 2. Set this button to confirm mode
        btn.classList.add('confirming');
        btn.textContent = '✓'; 
        btn.title = 'Confirm Delete';

        // 3. Auto-reset after 3 seconds if not clicked
        setTimeout(() => {
          if (btn && document.body.contains(btn) && btn.classList.contains('confirming')) {
            btn.classList.remove('confirming');
            btn.textContent = '✕';
            btn.title = 'Delete';
          }
        }, 3000);
      }
    } else if (btn.classList.contains('edit')) {
      handleRenameSession(id);
    }
    return;
  }

  // Handle Switching Sessions
  if (row) {
    const id = row.dataset.id;
    if (id) {
      setCurrentSession(id);
      UI.highlightSession(id);
      await saveState();
      UI.closeSessionMenu();
    }
  }
}

export async function handleCopyChatClick() {
  const text = UI.getPlaintext(appState.currentSessionId);
  if (!text) return;
  await navigator.clipboard.writeText(text);
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
  if (event.target?.dataset?.dismiss === 'modal' || event.target?.classList.contains('modal-backdrop')) {
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

export function handleSessionSearch(event) {
  UI.renderSessions(event.target.value);
}

export function handleTemplateSelect(event) {
  const target = event.target.closest('.dropdown-item');
  if (!target) return;
  
  const text = target.dataset.text;
  if (typeof text === 'string') {
    const existing = UI.getInputValue();
    const joiner = existing.trim() ? '\n' : '';
    UI.setInputValue(existing + joiner + text + '\n');
  }
  UI.closeTemplateMenu();
}

export function handleAttachClick() {
  document.getElementById('file-input')?.click();
}

export function handleFileInputChange(event) {
  const files = Array.from(event.target.files || []);
  files.slice(0, 3).forEach(async file => {
    try {
      const resizedData = await resizeImage(file, 1024); 
      addAttachment({ name: file.name, type: 'image/jpeg', data: resizedData });
      UI.renderAttachments(getAttachments());
    } catch (e) {
      console.warn('Failed to resize image', e);
      const reader = new FileReader();
      reader.onload = () => {
        addAttachment({ name: file.name, type: file.type, data: reader.result });
        UI.renderAttachments(getAttachments());
      };
      reader.readAsDataURL(file);
    }
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
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    alert('Speech recognition is not supported in this browser.');
    return;
  }

  if (recognizing) {
    recognition.stop();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true; 

  const startText = UI.getInputValue();

  recognition.onstart = () => {
    recognizing = true;
    UI.setMicState(true);
  };

  recognition.onend = () => {
    recognizing = false;
    UI.setMicState(false);
  };

  recognition.onerror = (event) => {
    console.warn('Speech recognition failed', event.error);
    
    if (event.error === 'not-allowed' || event.error === 'permission-denied') {
      const doSetup = confirm(
        'Microphone permission is blocked in the popup.\n\n' +
        'Open a setup tab to grant permission once?'
      );
      if (doSetup) {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?mic_setup=true') });
      }
    }
    
    recognizing = false;
    UI.setMicState(false);
  };

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = 0; i < event.results.length; ++i) {
      transcript += event.results[i][0].transcript;
    }
    const spacer = (startText && !startText.match(/\s$/)) ? ' ' : '';
    UI.setInputValue(startText + spacer + transcript);
  };

  try {
    recognition.start();
  } catch (e) {
    console.error(e);
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
  UI.openContextModal();
  await refreshContextDraft(true);
}

export function handleContextInput(event) {
  updateContextDraft(event.target.value);
  saveState();
}

export function handleOpenSettings() {
  UI.openSettingsModal();
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
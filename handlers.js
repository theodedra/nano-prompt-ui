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

async function refreshContextDraft(force = false) {
  try {
    const ctx = await fetchContext(force);
    const text = ctx?.text || '';
    updateContextDraft(text);
    UI.setContextText(text);
    return text;
  } catch (e) {
    return '';
  }
}

function ensureTabContextSync() {
  if (tabListenersAttached) return;
  if (!chrome?.tabs?.onActivated) return;
  
  const update = () => refreshContextDraft(true);
  chrome.tabs.onActivated.addListener(update);
  chrome.tabs.onUpdated.addListener((id, info, tab) => {
    if (tab?.active && info.status === 'complete') update();
  });
  tabListenersAttached = true;
}

export async function bootstrap() {
  await loadState();
  UI.updateTemplates(appState.templates);
  UI.renderSessions();
  UI.setContextText(appState.contextDraft);
  UI.renderAttachments(getAttachments());
  UI.renderLog();
  
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
  const text = value || 'Hello';
  const attachments = getAttachments().slice();
  UI.setInputValue('');
  clearAttachments();
  UI.renderAttachments(getAttachments());
  
  let contextOverride = UI.getContextText();
  const intent = classifyIntent(text);

  // --- SMART CONTEXT LOGIC ---

  // 1. CASUAL CHAT: If user says "yo", "hi", "time?", WIPE context.
  // This ensures we never send page data or system errors for simple chats.
  if (text.length < 60 && intent === 'none') {
    contextOverride = '';
  }
  // 2. INTENTIONAL CHAT: If context looks stale (System Page), force a refresh 
  // to check if the user has moved to a real tab (like LinkedIn).
  else if (contextOverride.includes('[System Page]')) {
     contextOverride = await refreshContextDraft(true);
     
     // If it is STILL a system page after refresh, and user didn't ask for summary, wipe it.
     if (contextOverride.includes('[System Page]') && intent !== 'page') {
       contextOverride = '';
     }
  }

  await runPrompt({
    text,
    contextOverride,
    attachments
  });
}

export async function handleSummarizeClick() {
  UI.setStatusText('Reading tab...');
  // Force fresh read to ensure we summarize the CURRENT tab, not the old one.
  const freshText = await refreshContextDraft(true); 
  await summarizeActiveTab(freshText);
}

export async function handleNewSessionClick() {
  const session = createSessionFrom();
  setCurrentSession(session.id);
  await saveState();
  UI.renderSessions();
  UI.renderLog();
  UI.closeSessionMenu();
}

export async function handleSessionMenuClick(event) {
  const btn = event.target.closest('button');
  const row = event.target.closest('.session-row');
  
  if (btn && btn.classList.contains('action-btn')) {
    event.stopPropagation();
    const id = btn.dataset.id;
    
    if (btn.classList.contains('delete')) {
      if (btn.classList.contains('confirming')) {
        deleteSession(id);
        await saveState();
        UI.renderSessions();
        UI.renderLog();
      } else {
        document.querySelectorAll('.action-btn.delete.confirming').forEach(b => {
          b.classList.remove('confirming');
          b.textContent = '✕';
          b.title = 'Delete';
        });
        btn.classList.add('confirming');
        btn.textContent = '✓'; 
        setTimeout(() => {
            if(btn.classList.contains('confirming')) {
               btn.classList.remove('confirming');
               btn.textContent = '✕';
            }
        }, 3000);
      }
    } else if (btn.classList.contains('edit')) {
        const session = appState.sessions[id];
        const newTitle = prompt('Rename chat', session.title);
        if(newTitle) {
            renameSession(id, newTitle);
            await saveState();
            UI.renderSessions();
        }
    }
    return;
  }

  if (row) {
    const id = row.dataset.id;
    setCurrentSession(id);
    UI.highlightSession(id);
    await saveState();
    UI.closeSessionMenu();
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
  a.download = 'chat-export.md';
  a.click();
}

export function handleInputKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleAskClick();
  }
}

export function handleDocumentKeyDown(event) {
  if (event.key === 'Escape') {
    if (UI.isModalOpen()) UI.closeModal();
  }
}

export function handleModalClick(event) {
  const btn = event.target.closest('[data-dismiss="modal"]');
  const backdrop = event.target.classList.contains('modal-backdrop');
  if (btn || backdrop) {
    UI.closeModal();
  }
}

export async function handleLogClick(event) {
  const btn = event.target.closest('button');
  if (!btn) return;

  const idx = btn.dataset.idx;
  if (btn.classList.contains('bubble-copy')) {
      const msg = getCurrentSession().messages[idx];
      if(msg) navigator.clipboard.writeText(msg.text);
  } else if (btn.classList.contains('speak')) {
      const msg = getCurrentSession().messages[idx];
      if(msg) speakText(msg.text);
  }
}

export function handleTemplateSelect(event) {
  const target = event.target.closest('.dropdown-item');
  if (!target) return;
  const text = target.dataset.text;
  UI.setInputValue(UI.getInputValue() + text);
  UI.closeTemplateMenu();
}

export function handleAttachClick() {
  document.getElementById('file-input')?.click();
}

export function handleFileInputChange(event) {
  const files = Array.from(event.target.files || []);
  files.slice(0, 3).forEach(async file => {
      const data = await resizeImage(file, 1024);
      addAttachment({ name: file.name, type: file.type, data });
      UI.renderAttachments(getAttachments());
  });
  event.target.value = '';
}

export function handleAttachmentListClick(event) {
  const target = event.target.closest('.attachment-chip');
  if (target) {
      clearAttachments(); 
      UI.renderAttachments(getAttachments());
  }
}

export function handleMicClick() {
    if (!('webkitSpeechRecognition' in window)) return alert('No Speech API');
    if (recognizing) { recognition.stop(); return; }
    
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onstart = () => { recognizing = true; UI.setMicState(true); };
    recognition.onend = () => { recognizing = false; UI.setMicState(false); };
    recognition.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; ++i) t += e.results[i][0].transcript;
        UI.setInputValue(t);
    };
    recognition.start();
}

export function handleSpeakLast() {
    const msgs = getCurrentSession().messages;
    const last = [...msgs].reverse().find(m => m.role === 'ai');
    if (last) speakText(last.text);
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
    const temp = document.getElementById('temperature').value;
    const topk = document.getElementById('topk').value;
    const sys = document.getElementById('system-prompt').value;
    
    updateSettings({ temperature: Number(temp), topK: Number(topk), systemPrompt: sys });
    await saveState();
    UI.closeModal();
    await refreshAvailability();
}
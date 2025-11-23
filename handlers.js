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
  saveContextDraft,
  updateSettings,
  renameSession
} from './storage.js';
import * as UI from './ui.js';
import {
  runPrompt,
  summarizeActiveTab,
  cancelGeneration,
  speakText,
  refreshAvailability,
  resetModel,
  runRewriter,   
  runSummarizer,
  runTranslator,
  runImageDescription 
} from './model.js';
import { fetchContext, classifyIntent } from './context.js';
import { resizeImage, debounce } from './utils.js';

let recognition;
let recognizing = false;
let tabListenersAttached = false;
let confirmingDeleteId = null;

// --- COMMAND LISTENER ---
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  // 1. Respond to liveness check from Background
  if (req.action === 'PING_PANEL') {
    sendResponse({ ok: true });
    return;
  }
  
  // 2. Handle Actions
  if (req.action === 'CMD_SUMMARIZE') {
    runPrompt({ text: `Summarize this:\n${req.text}`, contextOverride: '', attachments: [] });
  } 
  else if (req.action === 'CMD_REWRITE') {
    runRewriter(req.text, 'more-formal');
  }
  else if (req.action === 'CMD_TRANSLATE') {
    runTranslator(req.text);
  }
  else if (req.action === 'CMD_DESCRIBE_IMAGE') {
    runImageDescription(req.url);
  }
});

// --- CONTEXT MANAGEMENT ---

async function refreshContextDraft(force = false) {
  try {
    const ctx = await fetchContext(force);
    const text = ctx?.text || '';
    
    if (ctx.isRestricted) {
      UI.setRestrictedState(true);
    } else {
      UI.setRestrictedState(false);
    }

    updateContextDraft(text);
    await saveContextDraft(text); 
    UI.setContextText(text);
    return text;
  } catch (e) {
    console.warn('Context refresh failed', e);
    return '';
  }
}

function ensureTabContextSync() {
  if (tabListenersAttached) return;
  if (!chrome?.tabs?.onActivated) return;
  
  const update = () => { refreshContextDraft(false); };
  
  chrome.tabs.onActivated.addListener(update);
  chrome.tabs.onUpdated.addListener((id, info, tab) => {
    if (tab?.active && info.status === 'complete') update();
  });
  tabListenersAttached = true;
}

// --- INITIALIZATION ---

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

  // Tell Background we are open and ready for commands
  chrome.runtime.sendMessage({ action: 'PANEL_READY' });
}

// --- ACTION HANDLERS ---

export async function handleAskClick() {
  const value = UI.getInputValue().trim();
  const text = value || 'Hello'; 
  const attachments = getAttachments().slice();
  
  UI.setInputValue('');
  clearAttachments();
  UI.renderAttachments(getAttachments());
  
  let contextOverride = UI.getContextText();
  const intent = classifyIntent(text);

  if (text.length < 60 && intent === 'none') {
    contextOverride = '';
  }
  else if (contextOverride.includes('[System Page]')) {
     contextOverride = await refreshContextDraft(true);
     if (contextOverride.includes('[System Page]') && intent !== 'page') {
       contextOverride = '';
     }
  }

  try {
    await runPrompt({ text, contextOverride, attachments });
  } catch (e) {
    console.error('Prompt Execution Failed:', e);
    UI.setStatusText('Error');
  }
}

export async function handleSummarizeClick() {
  UI.setStatusText('Reading tab...');
  const freshText = await refreshContextDraft(true); 
  await summarizeActiveTab(freshText);
}

export async function handleNewSessionClick() {
  const session = createSessionFrom();
  setCurrentSession(session.id);
  await saveState();
  
  resetModel(); 
  UI.renderSessions();
  UI.renderLog();
  UI.closeMenu('session');
}

async function deleteSessionHandler(btn, id) {
  if (id === confirmingDeleteId) {
    deleteSession(id);
    confirmingDeleteId = null;
    await saveState(); 
    UI.renderSessions();
    UI.renderLog();
    resetModel(); 
  } else {
    confirmingDeleteId = id;
    UI.renderSessions(confirmingDeleteId); 
    setTimeout(() => {
        if (confirmingDeleteId === id) {
           confirmingDeleteId = null;
           UI.renderSessions(); 
        }
    }, 3000);
  }
}

async function renameSessionHandler(id) {
  const session = appState.sessions[id];
  const newTitle = prompt('Rename chat', session.title);
  if (newTitle) {
      renameSession(id, newTitle);
      await saveState();
      UI.renderSessions();
  }
}

async function switchSessionHandler(row) {
  const id = row.dataset.id;
  setCurrentSession(id);
  UI.highlightSession(id);
  await saveState();
  resetModel(); 
  UI.closeMenu('session');
}

export async function handleSessionMenuClick(event) {
  const btn = event.target.closest('button');
  const row = event.target.closest('.session-row');
  
  if (btn && btn.classList.contains('action-btn')) {
    event.stopPropagation();
    const id = btn.dataset.id;
    
    if (btn.classList.contains('delete')) {
      await deleteSessionHandler(btn, id);
    } else if (btn.classList.contains('edit')) {
      await renameSessionHandler(id);
    }
    return;
  }
  if (row) await switchSessionHandler(row);
}

export async function handleCopyChatClick() {
  const text = UI.getPlaintext(appState.currentSessionId);
  if (!text) return;
  await navigator.clipboard.writeText(text);
  UI.setStatusText('Copied!');
  setTimeout(() => UI.setStatusText('Ready'), 1500);
}

export function handleSaveMarkdown() {
  const md = UI.getSessionMarkdown(appState.currentSessionId);
  if (!md) return;
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-export-${Date.now()}.md`;
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
    return;
  }
  if (event.key === 'Tab') {
    const openModal = document.querySelector('.modal:not([hidden])');
    const container = openModal || document.body;
    UI.trapFocus(event, container);
  }
}

export function handleModalClick(event) {
  const btn = event.target.closest('[data-dismiss="modal"]');
  const backdrop = event.target.classList.contains('modal-backdrop');
  if (btn || backdrop) UI.closeModal();
}

export async function handleLogClick(event) {
  const btn = event.target.closest('button');
  if (!btn) return;

  const idx = btn.dataset.idx;
  if (btn.classList.contains('bubble-copy')) {
      const msg = getCurrentSession().messages[idx];
      if(msg) await navigator.clipboard.writeText(msg.text);
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
  UI.closeMenu('templates');
  document.getElementById('in')?.focus();
}

export function handleAttachClick() {
  document.getElementById('file-input')?.click();
}

export function handleFileInputChange(event) {
  const files = Array.from(event.target.files || []);
  files.slice(0, 3).forEach(async file => {
      try {
        const data = await resizeImage(file, 1024);
        addAttachment({ name: file.name, type: file.type, data });
        UI.renderAttachments(getAttachments());
      } catch (e) {
        console.error('Image processing failed', e);
      }
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
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) return alert('Speech recognition not supported in this browser.');
    
    if (recognizing) { recognition.stop(); return; }
    
    recognition = new Speech();
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
  await refreshContextDraft(false); 
}

export const handleContextInput = debounce((event) => {
  const text = event.target.value;
  updateContextDraft(text);
  saveContextDraft(text);
}, 500);

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
    resetModel();
    UI.closeModal();
    await refreshAvailability();
}
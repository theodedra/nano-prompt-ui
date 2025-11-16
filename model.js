import * as UI from './ui.js';
import {
  appState,
  getCurrentSession,
  upsertMessage,
  updateMessage,
  saveState
} from './storage.js';
import { buildPromptWithContext } from './context.js';

const LM = (typeof LanguageModel !== 'undefined')
  ? LanguageModel
  : (self.ai && self.ai.languageModel)
    ? self.ai.languageModel
    : undefined;

function buildOutputDescriptor(lang = 'en') {
  const language = (lang || 'en').trim() || 'en';
  return { format: 'text', language };
}

let activeController = null;
let downloadListenerRegistered = false;

function getHistorySnippet(session) {
  const slice = session.messages.slice(-8);
  return slice.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.text}`).join('\n');
}

async function ensureModelSession() {
  if (!LM) return null;
  const status = await LM.availability({ output: buildOutputDescriptor(appState.language) });
  appState.availability = status?.availability || 'unknown';
  if (status?.availability === 'downloading' && !downloadListenerRegistered && status?.onprogress) {
    downloadListenerRegistered = true;
    status.onprogress.addEventListener('progress', evt => {
      const pct = Math.round((evt.loaded / evt.total) * 100);
      UI.setStatusText(`downloading ${pct}%`);
      UI.setHardwareStatus(`Gemini Nano downloading… ${pct}%`);
    });
  }
  if (status?.availability !== 'available') {
    return null;
  }
  if (!appState.model) {
    appState.model = await LM.create({
      output: buildOutputDescriptor(appState.language),
      topK: appState.settings.topK,
      temperature: appState.settings.temperature,
      systemPrompt: appState.settings.systemPrompt
    });
  }
  UI.setHardwareStatus('Gemini Nano: ready');
  return appState.model;
}

async function runPromptInPage(prompt) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (p, lang) => {
      const model = self.ai?.languageModel || self.LanguageModel;
      if (!model) return { error: 'LanguageModel not available' };
      const sanitize = code => {
        const language = (code || 'en').trim() || 'en';
        return { format: 'text', language };
      };
      const session = await model.create({ output: sanitize(lang) });
      const reply = await session.prompt(p);
      return { ok: true, data: reply };
    },
    args: [prompt, appState.language]
  });
  if (result?.error) throw new Error(result.error);
  return result?.data || '';
}

export async function refreshAvailability() {
  if (!LM) {
    UI.setHardwareStatus('Gemini Nano: unavailable');
    UI.setStatusText('not supported');
    return;
  }
  try {
    const status = await LM.availability({ output: buildOutputDescriptor(appState.language) });
    appState.availability = status?.availability;
    if (status?.availability === 'available') {
      UI.setStatusText('ready');
      UI.setHardwareStatus('Gemini Nano: ready');
    } else if (status?.availability === 'downloading') {
      UI.setStatusText('downloading…');
      UI.setHardwareStatus('Gemini Nano: downloading');
    } else {
      UI.setStatusText(status?.availability || 'unknown');
      UI.setHardwareStatus('Gemini Nano: ' + (status?.availability || 'unknown'));
    }
  } catch (e) {
    UI.setStatusText('error');
    UI.setHardwareStatus('Gemini Nano: error');
    console.warn(e);
  }
}

function cancelCurrentStream() {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
  UI.setStopEnabled(false);
}

export function cancelGeneration() {
  cancelCurrentStream();
}

export async function runPrompt({ text, contextOverride, attachments }) {
  const session = getCurrentSession();
  const userMessage = { role: 'user', text, ts: Date.now(), attachments };
  upsertMessage(session.id, userMessage);
  UI.renderLog();
  await saveState();
  UI.setBusy(true);
  UI.setStopEnabled(true);
  const prompt = await buildPromptWithContext(text, contextOverride, attachments);
  const conversation = getHistorySnippet(session);
  const finalPrompt = `${prompt}\n\nConversation so far:\n${conversation}`;

  let aiMessageIndex;
  let buffer = '';
  let aborted = false;
  try {
    let replyText = '';
    try {
      const model = await ensureModelSession();
      if (!model) throw new Error('on-device model unavailable');
      const controller = new AbortController();
      activeController = controller;
      if (model.promptStreaming) {
        const stream = await model.promptStreaming(finalPrompt, { signal: controller.signal });
        const reader = stream.getReader();
        aiMessageIndex = session.messages.length;
        upsertMessage(session.id, { role: 'ai', text: '', ts: Date.now() });
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buffer += value;
            updateMessage(session.id, aiMessageIndex, { text: buffer });
            UI.renderLog();
          }
        }
        replyText = buffer;
      } else {
        replyText = await model.prompt(finalPrompt, { signal: controller.signal });
      }
      cancelCurrentStream();
    } catch (err) {
      cancelCurrentStream();
      if (err?.name === 'AbortError') {
        aborted = true;
        if (typeof aiMessageIndex === 'number') {
          updateMessage(session.id, aiMessageIndex, { text: '(stopped)' });
        }
      } else {
        const fallback = await runPromptInPage(finalPrompt);
        replyText = fallback;
      }
    }
    if (!aborted) {
      const normalized = (replyText || '').trim() || '(empty)';
      if (typeof aiMessageIndex === 'number') {
        updateMessage(session.id, aiMessageIndex, { text: normalized, ts: Date.now() });
      } else {
        upsertMessage(session.id, { role: 'ai', text: normalized, ts: Date.now() });
      }
    }
  } catch (e) {
    upsertMessage(session.id, { role: 'ai', text: 'Error: ' + (e?.message || e), ts: Date.now() });
  } finally {
    UI.renderLog();
    UI.setBusy(false);
    UI.setStopEnabled(false);
    await saveState();
  }
  if (aborted) return;
}

export async function summarizeActiveTab(contextOverride) {
  const instruction = 'Summarize the current tab in five concise bullet points.';
  await runPrompt({ text: instruction, contextOverride, attachments: [] });
}

export function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = appState.language === 'es' ? 'es-ES' : appState.language === 'ja' ? 'ja-JP' : 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export async function fetchPageContext() {
  // Deprecated helper kept for backward compatibility
  return { text: '', ts: Date.now() };
}
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

function getCapabilities() {
  return {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }]
  };
}

function getSessionConfig() {
  return {
    ...getCapabilities(),
    topK: appState.settings.topK,
    temperature: appState.settings.temperature,
    initialPrompts: [
      { role: 'system', content: appState.settings.systemPrompt || 'You are a helpful assistant.' }
    ]
  };
}

let activeController = null;
let downloadListenerRegistered = false;

function getHistorySnippet(session) {
  const slice = session.messages.slice(-8);
  return slice.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.text}`).join('\n');
}

// --- SESSION MANAGEMENT ---

async function ensureModelSession() {
  if (!LM) return null;

  try {
    const status = await LM.availability(getCapabilities());
    appState.availability = status?.availability || 'unknown';

    if (status?.availability === 'downloading' || status?.availability === 'after-download') {
      if (!downloadListenerRegistered && status?.onprogress) {
        downloadListenerRegistered = true;
        status.onprogress.addEventListener('progress', evt => {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          UI.setStatusText(`Downloading ${pct}%`);
          UI.setHardwareStatus(`Gemini Nano downloading… ${pct}%`);
        });
      }
    }

    if (status?.availability === 'no') return null;
  } catch (e) {
    console.warn('Availability check failed:', e);
  }

  if (!appState.model) {
    try {
      appState.model = await LM.create(getSessionConfig());
    } catch (err) {
      console.error('Failed to create model session:', err);
      return null;
    }
  }
  
  UI.setHardwareStatus('Gemini Nano: Ready');
  return appState.model;
}

export async function refreshAvailability() {
  if (!LM) {
    UI.setHardwareStatus('Gemini Nano: Unavailable');
    UI.setStatusText('Not Supported');
    return;
  }
  try {
    const status = await LM.availability(getCapabilities());
    appState.availability = status?.availability;
    
    const map = {
      'available': 'Ready',
      'readily': 'Ready',
      'downloading': 'Downloading...',
      'after-download': 'Download Needed',
      'no': 'Not Supported'
    };
    
    const text = map[status?.availability] || 'Standby';
    UI.setStatusText(text);
    UI.setHardwareStatus(`Gemini Nano: ${text}`);
  } catch (e) {
    UI.setStatusText('Error');
    UI.setHardwareStatus('Gemini Nano: Error');
    console.warn('Refresh availability failed:', e);
  }
}

// --- PROMPT EXECUTION HELPERS ---

async function executeStreamingPrompt(model, prompt, signal, onUpdate) {
  if (model.promptStreaming) {
    const stream = await model.promptStreaming(prompt, { signal });
    const reader = stream.getReader();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        buffer += value;
        onUpdate(buffer);
      }
    }
    return buffer;
  } else {
    const result = await model.prompt(prompt, { signal });
    onUpdate(result);
    return result;
  }
}

async function runPromptInPage(prompt) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');
  
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (p, sysPrompt) => {
      const model = self.ai?.languageModel || self.LanguageModel;
      if (!model) return { error: 'LanguageModel not available in page' };
      
      try {
        const session = await model.create({
          initialPrompts: [
            { role: 'system', content: sysPrompt || 'You are a helpful assistant.' }
          ],
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }]
        });
        
        const reply = await session.prompt(p);
        return { ok: true, data: reply };
      } catch (e) {
        return { error: e.toString() };
      }
    },
    args: [prompt, appState.settings.systemPrompt]
  });

  if (result?.error) throw new Error(result.error);
  return result?.data || '';
}

// --- MAIN PROMPT LOGIC ---

export async function runPrompt({ text, contextOverride, attachments }) {
  const session = getCurrentSession();
  const userMessage = { role: 'user', text, ts: Date.now(), attachments };
  upsertMessage(session.id, userMessage);
  UI.renderLog();
  await saveState();
  
  UI.setBusy(true);
  UI.setStopEnabled(true);

  const conversation = getHistorySnippet(session);
  let activePrompt = await buildPromptWithContext(text, contextOverride, attachments);
  let finalPrompt = `${activePrompt}\n\nConversation so far:\n${conversation}`;

  const aiMessageIndex = session.messages.length;
  upsertMessage(session.id, { role: 'ai', text: '', ts: Date.now() });
  UI.renderLog();

  const controller = new AbortController();
  activeController = controller;
  let aborted = false;
  let replyText = '';

  try {
    const model = await ensureModelSession();
    if (!model) throw new Error('On-device model unavailable');

    // 1. Attempt Streaming
    try {
      replyText = await executeStreamingPrompt(model, finalPrompt, controller.signal, (chunk) => {
        updateMessage(session.id, aiMessageIndex, { text: chunk });
        UI.updateLastMessageBubble(chunk);
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      console.warn('Streaming failed, trying fallback logic...', err);
    }

    // 2. Retry Clean (if context caused issues)
    if ((!replyText || !replyText.trim()) && contextOverride) {
      console.log('Empty response with context. Retrying clean.');
      activePrompt = await buildPromptWithContext(text, '', attachments);
      finalPrompt = `${activePrompt}\n\nConversation so far:\n${conversation}`;
      
      replyText = await executeStreamingPrompt(model, finalPrompt, controller.signal, (chunk) => {
        updateMessage(session.id, aiMessageIndex, { text: chunk });
        UI.updateLastMessageBubble(chunk);
      });
    }

    if (!replyText || !replyText.trim()) {
      throw new Error('Model returned empty response');
    }

  } catch (err) {
    cancelCurrentStream();
    if (err?.name === 'AbortError') {
      aborted = true;
      updateMessage(session.id, aiMessageIndex, { text: '(stopped)' });
    } else {
      // 3. Fallback to Page Injection
      console.log('Triggering page fallback due to:', err.message);
      try {
        const fallback = await runPromptInPage(finalPrompt);
        replyText = fallback;
      } catch (e2) {
        updateMessage(session.id, aiMessageIndex, { text: `Error: Service unavailable. (${e2.message || e2})` });
      }
    }
  }

  if (!aborted && replyText) {
    const normalized = (replyText || '').trim();
    updateMessage(session.id, aiMessageIndex, { text: normalized, ts: Date.now() });
    UI.updateLastMessageBubble(normalized); 
  }

  UI.setBusy(false);
  UI.setStopEnabled(false);
  await saveState();
}

export function cancelGeneration() {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
  UI.setStopEnabled(false);
}

export async function summarizeActiveTab(contextOverride) {
  const instruction = 'Summarize the current tab in seven detailed bullet points. Ensure each point is comprehensive.';
  await runPrompt({ text: instruction, contextOverride, attachments: [] });
}

export function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US'; 
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
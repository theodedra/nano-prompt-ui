import * as UI from './ui.js';
import {
  appState,
  getCurrentSession,
  upsertMessage,
  updateMessage,
  saveState
} from './storage.js';
import { buildPromptWithContext } from './context.js';
import { dataUrlToBlob } from './utils.js'; // Import the helper

// --- LOCAL AI WRAPPER CLASS ---
class LocalAI {
  constructor() {
    this.session = null;
    this.controller = null;
  }

  get engine() {
    if (self.ai && self.ai.languageModel) return self.ai.languageModel;
    if (self.LanguageModel) return self.LanguageModel;
    return null;
  }

  async getAvailability() {
    if (!this.engine) return 'no';
    try {
      const config = getCapabilities();
      const status = await this.engine.availability(config);
      return typeof status === 'object' ? status.availability : status;
    } catch (e) {
      return 'no';
    }
  }

  async createSession(config) {
    if (!this.engine) throw new Error('AI not supported');
    this.session = await this.engine.create(config);
    return this.session;
  }

  async promptStreaming(input, signal, onUpdate) {
    if (!this.session) throw new Error('No active session');
    
    // Standardize input (Text or Array)
    const stream = await this.session.promptStreaming(input, { signal });
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
  }

  destroy() {
    if (this.session) {
      try { this.session.destroy(); } catch(e) {}
      this.session = null;
    }
  }
}

const localAI = new LocalAI();

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
    systemPrompt: appState.settings.systemPrompt || 'You are a helpful assistant.'
  };
}

function getHistorySnippet(session) {
  const slice = session.messages.slice(-50);
  return slice.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.text}`).join('\n');
}

// --- EXPORTED FUNCTIONS ---

export function resetModel() {
  localAI.destroy();
}

export async function refreshAvailability() {
  // Check Side Panel
  let status = await localAI.getAvailability();
  
  // If Side Panel fails, optimistically assume Page Mode works (since we fixed the injector)
  if (status === 'no') status = 'Page-Mode';

  const map = {
    'available': 'Ready',
    'readily': 'Ready',
    'downloading': 'Downloading...',
    'after-download': 'Download Needed',
    'no': 'Not Supported',
    'Page-Mode': 'Ready (Hybrid)'
  };
  const text = map[status] || 'Standby';
  UI.setStatusText(text);
  UI.setHardwareStatus(`Gemini Nano: ${text}`);
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

  const aiMessageIndex = session.messages.length;
  upsertMessage(session.id, { role: 'ai', text: '', ts: Date.now() });
  UI.renderLog();

  const controller = new AbortController();
  localAI.controller = controller;
  let aborted = false;
  let replyText = '';

  try {
    // 1. Prepare Context
    const fullContext = await buildPromptWithContext(text, contextOverride, attachments);
    const history = getHistorySnippet(session); 
    const finalPromptText = `${fullContext}\n\nConversation History:\n${history}\n\nCurrent User Query:\n${text}`;

    // 2. Prepare Images (Blob conversion)
    let promptInput = finalPromptText;
    if (attachments && attachments.length > 0) {
        const imageBlobs = await Promise.all(attachments.map(att => dataUrlToBlob(att.data)));
        promptInput = [finalText, ...imageBlobs];
    }

    // 3. Try Side Panel Execution
    try {
        if (!localAI.session) {
            await localAI.createSession(getSessionConfig());
        }
        
        replyText = await localAI.promptStreaming(promptInput, controller.signal, (chunk) => {
            updateMessage(session.id, aiMessageIndex, { text: chunk });
            UI.updateLastMessageBubble(chunk);
        });

    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        
        // 4. Fallback to In-Page Injection (The Fix)
        console.log("Side Panel failed, trying In-Page Fallback...");
        // Fallback currently supports text only to ensure reliability, or basic image passing if supported
        const fallback = await runPromptInPage(finalPromptText, attachments); 
        replyText = fallback;
        updateMessage(session.id, aiMessageIndex, { text: replyText });
        UI.updateLastMessageBubble(replyText);
    }

    if (!replyText || !replyText.trim()) {
      throw new Error('Model returned empty response');
    }

  } catch (err) {
    cancelGeneration();
    if (err?.name === 'AbortError') {
      aborted = true;
      updateMessage(session.id, aiMessageIndex, { text: '(stopped)' });
    } else {
      updateMessage(session.id, aiMessageIndex, { text: `Error: ${err.message || 'Service unavailable'}` });
    }
  }

  UI.setBusy(false);
  UI.setStopEnabled(false);
  await saveState();
}

async function runPromptInPage(prompt, attachments = []) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.startsWith('http')) throw new Error('Restricted protocol');
  
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN', // <--- CRITICAL FIX: This makes it work on your machine
    func: async (p, sys, atts) => {
      try {
        const model = window.ai?.languageModel || self.ai?.languageModel || self.LanguageModel;
        if (!model) return { error: 'AI not found in page' };

        // Rehydrate images if present
        let input = p;
        if (atts && atts.length) {
            const blobs = await Promise.all(atts.map(async (att) => {
                const res = await fetch(att.data); 
                return await res.blob();
            }));
            input = [p, ...blobs];
        }

        const sess = await model.create({ 
            systemPrompt: sys
        });
        const r = await sess.prompt(input);
        sess.destroy();
        return { ok: true, data: r };
      } catch (e) { return { error: e.toString() }; }
    },
    args: [prompt, appState.settings.systemPrompt, attachments]
  });
  
  if (result?.error) throw new Error(result.error);
  return result?.data || '';
}

export function cancelGeneration() {
  if (localAI.controller) {
    localAI.controller.abort();
    localAI.controller = null;
  }
  UI.setStopEnabled(false);
}

export async function summarizeActiveTab(contextOverride) {
  resetModel(); 
  const instruction = 'Summarize the current tab in seven detailed bullet points.';
  await runPrompt({ text: instruction, contextOverride, attachments: [] });
}

export function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US'; 
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
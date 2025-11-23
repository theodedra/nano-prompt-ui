import * as UI from './ui.js';
import {
  appState,
  getCurrentSession,
  upsertMessage,
  updateMessage,
  saveState
} from './storage.js';
import { buildPromptWithContext } from './context.js';
import { dataUrlToBlob } from './utils.js';

// --- CONFIGURATION CONSTANTS ---
// We define this once to ensure consistency across Side Panel and In-Page modes
const MODEL_CONFIG = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
};

// --- LOCAL AI WRAPPER ---
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
      const status = await this.engine.availability(MODEL_CONFIG);
      return typeof status === 'object' ? status.availability : status;
    } catch (e) {
      return 'no';
    }
  }

  async createSession(params = {}) {
    if (!this.engine) throw new Error('AI not supported');
    // Merge default config with any custom system prompts
    const config = { ...MODEL_CONFIG, ...params };
    this.session = await this.engine.create(config);
    return this.session;
  }

  async promptStreaming(input, signal, onUpdate) {
    if (!this.session) throw new Error('No active session');
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

function getSessionConfig() {
  return {
    topK: appState.settings.topK,
    temperature: appState.settings.temperature,
    systemPrompt: appState.settings.systemPrompt || 'You are a helpful assistant.'
  };
}

function getHistorySnippet(session) {
  const slice = session.messages.slice(-50);
  return slice.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.text}`).join('\n');
}

// --- EXPORTS ---

export function resetModel() {
  localAI.destroy();
}

export async function refreshAvailability() {
  let status = await localAI.getAvailability();
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
  
  try {
    const fullContext = await buildPromptWithContext(text, contextOverride, attachments);
    const history = getHistorySnippet(session); 
    const finalText = `${fullContext}\n\nConversation History:\n${history}\n\nCurrent User Query:\n${text}`;

    // 1. Prepare Input (Multimodal support)
    let promptInput = finalText;
    if (attachments && attachments.length > 0) {
        const imageBlobs = await Promise.all(attachments.map(att => dataUrlToBlob(att.data)));
        promptInput = [finalText, ...imageBlobs];
    }

    try {
        // 2. Try Side Panel Execution
        if (!localAI.session) {
            await localAI.createSession(getSessionConfig());
        }
        
        await localAI.promptStreaming(promptInput, controller.signal, (chunk) => {
            updateMessage(session.id, aiMessageIndex, { text: chunk });
            UI.updateLastMessageBubble(chunk);
        });

    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        
        // 3. Fallback to Page Execution
        console.log("Side Panel failed, trying In-Page Fallback...");
        
        // Warn about lost images in fallback mode
        if (Array.isArray(promptInput)) {
            console.warn("Fallback mode does not support images yet. Sending text only.");
        }

        const fallback = await runPromptInPage(finalText); 
        updateMessage(session.id, aiMessageIndex, { text: fallback });
        UI.updateLastMessageBubble(fallback);
    }

  } catch (err) {
    cancelGeneration();
    if (err?.name === 'AbortError') {
      updateMessage(session.id, aiMessageIndex, { text: '(stopped)' });
    } else {
      updateMessage(session.id, aiMessageIndex, { text: `Error: ${err.message || 'Service unavailable'}` });
    }
  }

  UI.setBusy(false);
  UI.setStopEnabled(false);
  await saveState();
}

async function runPromptInPage(prompt) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.startsWith('http')) throw new Error('Restricted protocol');
  
  // We hardcode the config here because we can't easily pass the 'MODEL_CONFIG' object 
  // into the isolated context of the page without serialization issues.
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN', 
    func: async (p, sys) => {
      try {
        const model = window.ai?.languageModel || self.ai?.languageModel;
        if (!model) return { error: 'AI not found in page' };
        
        const sess = await model.create({ 
          systemPrompt: sys,
          expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }] 
        });
        
        const r = await sess.prompt(p);
        sess.destroy();
        return { ok: true, data: r };
      } catch (e) { return { error: e.toString() }; }
    },
    args: [prompt, appState.settings.systemPrompt]
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
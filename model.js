import * as UI from './ui.js';
import {
  appState,
  getCurrentSession,
  upsertMessage,
  updateMessage,
  saveState
} from './storage.js';
import { buildPromptWithContext } from './context.js';
import { dataUrlToBlob, resizeImage } from './utils.js';

// --- CONFIGURATION CONSTANTS ---
const MODEL_CONFIG = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
};

// --- LOCAL AI WRAPPER ---
class LocalAI {
  constructor() {
    this.session = null;
  }

  get engine() {
    return self.ai?.languageModel || self.LanguageModel;
  }

  async getAvailability() {
    if (!this.engine) return 'no';
    try {
      const status = await this.engine.availability(MODEL_CONFIG);
      return typeof status === 'object' ? status.availability : status;
    } catch (e) { return 'no'; }
  }

  async createSession(params = {}) {
    if (!this.engine) throw new Error('AI not supported');
    const config = { ...MODEL_CONFIG, ...params };
    this.session = await this.engine.create(config);
    return this.session;
  }

  async promptStreaming(input, signal, onUpdate) {
    if (!this.session) throw new Error('No active session');
    
    const stream = await this.session.promptStreaming(input, { signal });
    const reader = stream.getReader();
    
    let fullText = ''; 
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        // Smart Accumulator logic
        if (fullText.length > 0 && value.startsWith(fullText)) {
            fullText = value;
        } else {
            fullText += value;
        }
        onUpdate(fullText);
      }
    }
    return fullText;
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

export function resetModel() { localAI.destroy(); }

export async function refreshAvailability() {
  let status = await localAI.getAvailability();
  if (status === 'no') status = 'Page-Mode'; 
  const text = status === 'readily' ? 'Ready' : status;
  UI.setStatusText(text);
  UI.setHardwareStatus(`Gemini Nano: ${text}`);
}

export async function runSummarizer(text) {
  await runPrompt({ 
    text: `Summarize the following content into key bullet points:\n\n${text}`, 
    contextOverride: '', 
    attachments: [] 
  });
}

export async function runRewriter(text, tone = 'professional') {
  await runPrompt({ 
    text: `Rewrite the following text to be more ${tone}:\n\n${text}`, 
    contextOverride: '', 
    attachments: [] 
  });
}

export async function runTranslator(text) {
  await runPrompt({ 
    text: `Translate the following text to English:\n\n${text}`, 
    contextOverride: '', 
    attachments: [] 
  });
}

// --- IMAGE DESCRIPTION ---
export async function runImageDescription(url) {
  UI.setStatusText("Analyzing Image...");
  
  try {
    // 1. Smart Fetch
    const blob = await fetchImageWithRetry(url);
    
    // 2. Resize (Safety)
    UI.setStatusText("Optimizing...");
    const optimizedBase64 = await resizeImage(blob, 512); // 512px limit for safety
    
    const attachment = {
      name: "Analyzed Image",
      type: "image/jpeg",
      data: optimizedBase64
    };

    // 3. Reset model to clear memory before image task
    resetModel();
    
    await runPrompt({ 
      text: "Describe this image in detail.", 
      contextOverride: '', 
      attachments: [attachment] 
    });

  } catch (e) {
    console.error(e);
    UI.setStatusText("Error");
    resetModel(); 
    const session = getCurrentSession();
    upsertMessage(session.id, { 
      role: 'ai', 
      text: `**Image Error:** ${e.message}.`, 
      ts: Date.now() 
    });
    UI.renderLog();
  }
}

// Helper for Image Fetching
async function fetchImageWithRetry(url) {
  // 1. Extension Fetch
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000); 
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (res.ok) return await res.blob();
  } catch (e) {}

  // 2. Page Proxy Fetch
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.url.startsWith('chrome://')) throw new Error("Restricted Tab");

    const [{ result: base64 }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (imgUrl) => {
        try {
          const r = await fetch(imgUrl);
          const b = await r.blob();
          return await new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(b);
          });
        } catch { return null; }
      },
      args: [url]
    });

    if (base64) return await (await fetch(base64)).blob();
  } catch (e) {}

  throw new Error("Could not download image data");
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

    let promptInput = finalText;
    if (attachments?.length > 0) {
        const imageBlobs = await Promise.all(attachments.map(att => dataUrlToBlob(att.data)));
        promptInput = [finalText, ...imageBlobs];
    }

    try {
        if (!localAI.session) await localAI.createSession(getSessionConfig());
        
        await localAI.promptStreaming(promptInput, controller.signal, (chunk) => {
            updateMessage(session.id, aiMessageIndex, { text: chunk });
            UI.updateLastMessageBubble(chunk);
        });

    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        console.log("Side Panel failed, attempting fallback...");

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://'))) {
             throw new Error("AI not available on system pages.");
        }

        const fallback = await runPromptInPage(finalText, attachments); 
        updateMessage(session.id, aiMessageIndex, { text: fallback });
        UI.updateLastMessageBubble(fallback);
    }

  } catch (err) {
    cancelGeneration();
    resetModel(); 
    
    let msg = err.message || 'Service unavailable';
    if (err?.name === 'AbortError') msg = '(stopped)';
    
    updateMessage(session.id, aiMessageIndex, { text: `Error: ${msg}` });
    UI.updateLastMessageBubble(`Error: ${msg}`);
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
    world: 'MAIN', 
    func: async (p, sys, atts) => {
      try {
        const model = window.ai?.languageModel || self.ai?.languageModel;
        if (!model) return { error: 'AI not found in page' };
        
        const sess = await model.create({ 
          systemPrompt: sys,
          expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }] 
        });
        
        let input = p;
        if (atts && atts.length > 0) {
            const blobs = await Promise.all(atts.map(async (att) => {
                const res = await fetch(att.data);
                return await res.blob();
            }));
            input = [p, ...blobs];
        }

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
  await runPrompt({ text: 'Summarize the current tab in seven detailed bullet points.', contextOverride, attachments: [] });
}

export function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US'; 
  window.speechSynthesis.speak(utterance);
}
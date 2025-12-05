/**
 * Offscreen keeper for Gemini Nano warm-up.
 * Holds a persistent base session to avoid service worker teardown.
 * Shared diagnostics storage key must match core/model.js.
 */

const DIAGNOSTICS_KEY = 'nanoPrompt.diagnostics';
const MODEL_CONFIG = {
  expectedInputs: [
    { type: 'text', languages: ['en'] },
    { type: 'image' }
  ],
  expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
};

const KEEPALIVE_INTERVAL_MS = 60_000;
const IDLE_CHECK_SECONDS = 600; // 10 minutes

let baseSession = null;
let warmupStatus = 'unloaded'; // unloaded | loading | ready | error | unavailable
let warmupError = '';
let warmupAt = null;
let keepAliveTimer = null;

async function saveDiagnostics(partial = {}) {
  const current = await loadDiagnostics();
  const next = { ...current, ...partial };
  try {
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: next });
  } catch { /* ignore */ }
  return next;
}

async function loadDiagnostics() {
  try {
    const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY);
    return stored[DIAGNOSTICS_KEY] || {};
  } catch {
    return {};
  }
}

async function ensureModelDownloaded(onProgress) {
  const engine = self.ai?.languageModel || self.LanguageModel;
  if (!engine) throw new Error('Prompt API not available');

  const availability = await engine.availability(MODEL_CONFIG);
  const status = typeof availability === 'object' ? availability.availability : availability;
  if (status !== 'after-download' && status !== 'downloading') return status;

  let session;
  try {
    session = await engine.create({
      ...MODEL_CONFIG,
      systemPrompt: 'Warmup',
      monitor: (monitorHandle) => {
        if (monitorHandle?.addEventListener && typeof onProgress === 'function') {
          monitorHandle.addEventListener('downloadprogress', (e) => {
            const loaded = typeof e?.loaded === 'number' ? e.loaded : 0;
            const total = typeof e?.total === 'number' ? e.total : 1;
            onProgress(loaded, total);
          });
        }
      }
    });
  } finally {
    try { await session?.destroy(); } catch { /* ignore */ }
  }
  return 'readily';
}

async function dummyInference(session) {
  try {
    await session.prompt('ping');
  } catch { /* ignore */ }
}

async function warmUpBaseSession({ force = false, withProgress = false } = {}) {
  if (warmupStatus === 'ready' && !force) {
    return { status: 'ready', warmupStatus, warmupAt, warmupError };
  }

  const engine = self.ai?.languageModel || self.LanguageModel;
  if (!engine) {
    warmupStatus = 'unavailable';
    warmupError = 'Prompt API not available in this Chrome build.';
    await saveDiagnostics({
      lastWarmupStatus: 'unavailable',
      lastWarmupError: warmupError
    });
    return { status: 'unavailable', warmupStatus, warmupAt, warmupError };
  }

  warmupStatus = 'loading';
  warmupError = '';
  await saveDiagnostics({ lastWarmupStatus: 'running' });

  try {
    const status = await ensureModelDownloaded(withProgress ? (loaded, total) => {
      const pct = total ? Math.round((loaded / total) * 100) : 0;
      chrome.runtime.sendMessage({ action: 'OFFSCREEN_WARMUP_PROGRESS', percent: pct }).catch(() => {});
    } : null);

    if (status === 'no' || status === 'unavailable') {
      throw new Error('Prompt API not available');
    }

    baseSession = await engine.create({
      ...MODEL_CONFIG,
      systemPrompt: 'You are a helpful assistant. Keep responses concise.'
    });
    await dummyInference(baseSession);

    warmupStatus = 'ready';
    warmupAt = Date.now();
    await saveDiagnostics({
      lastWarmupStatus: 'success',
      lastWarmupAt: warmupAt,
      lastWarmupError: ''
    });

    chrome.runtime.sendMessage({ action: 'MODEL_READY' }).catch(() => {});
    return { status, warmupStatus, warmupAt };
  } catch (e) {
    warmupStatus = 'error';
    warmupError = e?.message || 'Warmup failed';
    await saveDiagnostics({
      lastWarmupStatus: 'error',
      lastWarmupError: warmupError
    });
    return { status: 'error', warmupStatus, warmupAt, warmupError };
  }
}

async function handlePrompt(text) {
  const engine = self.ai?.languageModel || self.LanguageModel;
  if (!engine) throw new Error('Prompt API not available');

  if (!baseSession) {
    await warmUpBaseSession({ force: true });
  }

  let session = baseSession;
  try {
    if (baseSession?.clone) {
      session = await baseSession.clone();
    }
  } catch {
    session = baseSession;
  }

  const result = await session.prompt(text);

  if (session !== baseSession) {
    try { await session.destroy(); } catch { /* ignore */ }
  }

  return result;
}

async function destroyBaseSession(reason = '') {
  if (baseSession) {
    try { await baseSession.destroy(); } catch { /* ignore */ }
  }
  baseSession = null;
  warmupStatus = 'unloaded';
  warmupAt = null;
  if (reason === 'idle') {
    await saveDiagnostics({
      lastWarmupStatus: 'idle-unloaded',
      lastWarmupError: ''
    });
  }
}

function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    if (warmupStatus !== 'ready' || !baseSession) {
      warmUpBaseSession({ force: true, withProgress: false }).catch(() => {});
    }
  }, KEEPALIVE_INTERVAL_MS);
}

function setupIdleHandlers() {
  if (!chrome.idle?.onStateChanged) return;
  try { chrome.idle.setDetectionInterval(IDLE_CHECK_SECONDS); } catch { /* ignore */ }
  chrome.idle.onStateChanged.addListener((state) => {
    if (state === 'idle' || state === 'locked') {
      destroyBaseSession('idle').catch(() => {});
    } else if (state === 'active') {
      warmUpBaseSession({ force: true, withProgress: false }).catch(() => {});
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'OFFSCREEN_WARMUP') {
    warmUpBaseSession({ force: message.force, withProgress: message.withProgress })
      .then(sendResponse)
      .catch((e) => sendResponse({ status: 'error', warmupStatus: 'error', warmupError: e?.message }));
    return true;
  }

  if (message?.action === 'OFFSCREEN_PROMPT') {
    handlePrompt(message.text || '')
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || 'Prompt failed' }));
    return true;
  }

  if (message?.action === 'OFFSCREEN_STATUS') {
    sendResponse({ warmupStatus, warmupAt, warmupError });
  }
});

// Kick off warm-up as soon as offscreen loads.
warmUpBaseSession({ withProgress: true }).catch(() => {});
startKeepAlive();
setupIdleHandlers();

import {
  appState,
  loadState,
  saveState,
  createSessionFrom,
  deleteSession,
  setCurrentSession,
  getCurrentSession,
  getCurrentSessionSync,
  addAttachment,
  clearAttachments,
  getAttachments,
  updateContextDraft,
  saveContextDraft,
  updateSettings,
  renameSession
} from './storage.js';
import { checkAllAPIs, getSetupStatus } from './setup-guide.js';
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
  runImageDescription,
  isSomethingRunning
} from './model.js';
import { fetchContext, classifyIntent } from './context.js';
import { resizeImage, debounce } from './utils.js';
import { extractPdfText, isPdfFile } from './pdf.js';
import { toast } from './toast.js';
import {
  TIMING,
  LIMITS,
  UI_MESSAGES,
  USER_ERROR_MESSAGES,
  INTENT_TYPES,
  LANGUAGE_LABELS,
  THEME_LABELS,
  getSettingOrDefault
} from './constants.js';

let recognition;
let recognizing = false;
let tabListenersAttached = false;
let confirmingDeleteId = null;

/**
 * Listen for context menu commands from background script
 */
chrome.runtime.onMessage.addListener((req) => {
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

/**
 * Refresh context draft from active tab
 * @param {boolean} force - Force refresh ignoring cache
 * @param {boolean} shouldSave - Whether to persist to storage
 * @returns {Promise<string>} Context text
 */
async function refreshContextDraft(force = false, shouldSave = true) {
  try {
    const ctx = await fetchContext(force);
    const text = ctx?.text || '';

    if (ctx.isRestricted) {
      UI.setRestrictedState(true);
    } else {
      UI.setRestrictedState(false);
    }

    // TAB SWITCH FIX: Restore stop button state after tab change
    // This ensures stop button stays enabled if narration/generation is active
    UI.restoreStopButtonState(isSomethingRunning());

    updateContextDraft(text);

    // OPTIMIZATION: Only save when explicitly requested (user-initiated or forced)
    // Auto-refreshes from tab switches don't need to persist
    if (shouldSave) {
      await saveContextDraft(text);
    }

    UI.setContextText(text);
    return text;
  } catch (e) {
    console.warn('Context refresh failed', e);
    toast.error(USER_ERROR_MESSAGES.CONTEXT_FETCH_FAILED);
    return '';
  }
}

/**
 * Set up tab listeners for automatic context synchronization
 */
function ensureTabContextSync() {
  if (tabListenersAttached) return;
  if (!chrome?.tabs?.onActivated) return;

  // PERFORMANCE FIX: Debounce both tab activation and updates
  const debouncedUpdate = debounce(() => {
    refreshContextDraft(false, false);
  }, TIMING.TAB_UPDATE_DEBOUNCE_MS);

  chrome.tabs.onActivated.addListener(() => debouncedUpdate());
  chrome.tabs.onUpdated.addListener((id, info, tab) => {
    if (tab?.active && info.status === 'complete') debouncedUpdate();
  });
  tabListenersAttached = true;
}

/**
 * Initialize the extension and load saved state
 * @returns {Promise<void>}
 */
export async function bootstrap() {
  await loadState();

  // Apply theme immediately on load
  applyTheme(getSettingOrDefault(appState.settings, 'theme'));

  UI.updateTemplates(appState.templates);
  UI.renderSessions();
  UI.setContextText(appState.contextDraft);
  UI.renderAttachments(getAttachments());
  UI.renderLog();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mic_setup') === 'true') {
    setTimeout(() => handleMicClick(), TIMING.MIC_SETUP_DELAY_MS);
    return;
  }

  ensureTabContextSync();
  await refreshContextDraft(true);

  // NEW: Signal to Background that UI is ready for commands
  chrome.runtime.sendMessage({ action: 'PANEL_READY' });
}

/**
 * Handle Ask button click - send prompt to AI
 * @returns {Promise<void>}
 */
export async function handleAskClick() {
  const value = UI.getInputValue().trim();
  const text = value || 'Hello';
  const attachments = getAttachments().slice();

  UI.setInputValue('');
  clearAttachments();
  UI.renderAttachments(getAttachments());

  let contextOverride = UI.getContextText();
  const intent = classifyIntent(text);

  if (text.length < LIMITS.SHORT_QUERY_THRESHOLD && intent === INTENT_TYPES.NONE) {
    contextOverride = '';
  }
  else if (contextOverride.includes('[System Page]')) {
     contextOverride = await refreshContextDraft(true);
     if (contextOverride.includes('[System Page]') && intent !== INTENT_TYPES.PAGE) {
       contextOverride = '';
     }
  }

  try {
    await runPrompt({ text, contextOverride, attachments });
  } catch (e) {
    console.error('Prompt Execution Failed:', e);
    UI.setStatusText(UI_MESSAGES.ERROR);
    toast.error(USER_ERROR_MESSAGES.AI_SESSION_FAILED);
  }
}

/**
 * Handle Summarize Tab button click
 * @returns {Promise<void>}
 */
export async function handleSummarizeClick() {
  UI.setStatusText(UI_MESSAGES.READING_TAB);
  const freshText = await refreshContextDraft(true);
  await summarizeActiveTab(freshText);
}

/**
 * Handle New Session button click
 * @returns {Promise<void>}
 */
export async function handleNewSessionClick() {
  const session = createSessionFrom();
  setCurrentSession(session.id);
  await saveState();

  resetModel();
  UI.renderSessions();
  UI.renderLog();
  UI.closeMenu('session');
}

/**
 * Handle session deletion with confirmation
 * @param {HTMLElement} btn - Delete button element
 * @param {string} id - Session ID to delete
 * @returns {Promise<void>}
 */
async function deleteSessionHandler(btn, id) {
  if (id === confirmingDeleteId) {
    deleteSession(id);
    confirmingDeleteId = null;
    await saveState();
    UI.renderSessions();
    UI.renderLog();
    resetModel();
    toast.success('Chat deleted');
  } else {
    confirmingDeleteId = id;
    UI.renderSessions(confirmingDeleteId);
    setTimeout(() => {
        if (confirmingDeleteId === id) {
           confirmingDeleteId = null;
           UI.renderSessions();
        }
    }, TIMING.DELETE_CONFIRM_TIMEOUT_MS);
  }
}

/**
 * Handle session rename
 * @param {string} id - Session ID to rename
 * @returns {Promise<void>}
 */
async function renameSessionHandler(id) {
  const session = appState.sessions[id];
  const newTitle = prompt(UI_MESSAGES.RENAME_CHAT, session.title);
  if (newTitle) {
      renameSession(id, newTitle);
      await saveState();
      UI.renderSessions();
      toast.success('Chat renamed');
  }
}

/**
 * Handle session switch
 * @param {HTMLElement} row - Session row element
 * @returns {Promise<void>}
 */
async function switchSessionHandler(row) {
  const id = row.dataset.id;
  setCurrentSession(id);
  UI.highlightSession(id);
  await saveState();
  resetModel();
  UI.closeMenu('session');
}

/**
 * Handle session menu interactions (switch, rename, delete)
 * @param {Event} event - Click event
 * @returns {Promise<void>}
 */
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

/**
 * Handle Copy Chat button click
 * @returns {Promise<void>}
 */
export async function handleCopyChatClick() {
  const text = UI.getPlaintext(appState.currentSessionId);
  if (!text) return;
  await navigator.clipboard.writeText(text);
  UI.setStatusText(UI_MESSAGES.COPIED);
  toast.success(UI_MESSAGES.COPIED);
  setTimeout(() => UI.setStatusText(UI_MESSAGES.READY), 1500);
}

/**
 * Handle Save Markdown button click
 */
export function handleSaveMarkdown() {
  const md = UI.getSessionMarkdown(appState.currentSessionId);
  if (!md) return;
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-export-${Date.now()}.md`;
  a.click();
  toast.success('Chat exported');
}

/**
 * Handle Enter key in input field
 * @param {KeyboardEvent} event - Keyboard event
 */
export function handleInputKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleAskClick();
  }
}

/**
 * Handle global keyboard shortcuts
 * @param {KeyboardEvent} event - Keyboard event
 */
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

/**
 * Handle modal backdrop/close button clicks
 * @param {MouseEvent} event - Click event
 */
export function handleModalClick(event) {
  const btn = event.target.closest('[data-dismiss="modal"]');
  const backdrop = event.target.classList.contains('modal-backdrop');
  if (btn || backdrop) UI.closeModal();
}

/**
 * Handle message bubble actions (copy, speak)
 * @param {MouseEvent} event - Click event
 * @returns {Promise<void>}
 */
export async function handleLogClick(event) {
  const btn = event.target.closest('button');
  if (!btn) return;

  const idx = btn.dataset.idx;
  if (btn.classList.contains('bubble-copy')) {
      const msg = getCurrentSessionSync().messages[idx];
      if(msg) {
        await navigator.clipboard.writeText(msg.text);
        toast.success('Message copied');
      }
  } else if (btn.classList.contains('speak')) {
      const msg = getCurrentSessionSync().messages[idx];
      if(msg) speakText(msg.text);
  }
}

/**
 * Handle template selection from dropdown
 * @param {MouseEvent} event - Click event
 */
export function handleTemplateSelect(event) {
  const target = event.target.closest('.dropdown-item');
  if (!target) return;
  const text = target.dataset.text;
  UI.setInputValue(UI.getInputValue() + text);
  UI.closeMenu('templates');
  document.getElementById('in')?.focus();
}

/**
 * Handle attach button click
 */
export function handleAttachClick() {
  document.getElementById('file-input')?.click();
}

/**
 * Handle file input change - process and attach images or PDFs
 * @param {Event} event - Change event
 */
export function handleFileInputChange(event) {
  const files = Array.from(event.target.files || []);
  files.slice(0, LIMITS.MAX_ATTACHMENTS).forEach(async file => {
      try {
        // Handle PDF files
        if (isPdfFile(file)) {
          toast.info(`Processing PDF: ${file.name}...`);
          const pdfText = await extractPdfText(file);
          addAttachment({
            name: file.name,
            type: 'application/pdf',
            data: pdfText
          });
          UI.renderAttachments(getAttachments());
          toast.success('PDF processed successfully');
        }
        // Handle image files - convert to blob for storage (will convert to canvas when sending to API)
        else if (file.type.startsWith('image/')) {
          toast.info(`Processing image: ${file.name}...`);
          const canvas = await fileToCanvas(file, LIMITS.IMAGE_MAX_WIDTH);
          // Convert canvas to blob for IndexedDB storage (canvas cannot be serialized)
          const blob = await canvasToBlob(canvas, file.type);
          addAttachment({
            name: file.name,
            type: file.type,
            data: blob  // Store as blob, convert to canvas when needed
          });
          UI.renderAttachments(getAttachments());
          toast.success('Image processed successfully');
        }
        else {
          toast.warning('Unsupported file type. Only images and PDFs are supported.');
        }
      } catch (e) {
        console.error('File processing failed', e);
        if (isPdfFile(file)) {
          const errorMsg = e.message || USER_ERROR_MESSAGES.PDF_PROCESSING_FAILED;
          toast.error(`PDF Error: ${errorMsg}`);
        } else {
          toast.error(USER_ERROR_MESSAGES.IMAGE_PROCESSING_FAILED);
        }
      }
  });
  event.target.value = '';
}

/**
 * Convert image file to canvas (required for Prompt API)
 * @param {File} file - Image file
 * @param {number} maxWidth - Maximum width for resizing
 * @returns {Promise<HTMLCanvasElement>}
 */
async function fileToCanvas(file, maxWidth) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        // Calculate scaled dimensions
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas);
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Convert canvas to blob for storage (IndexedDB cannot store canvas objects)
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {string} mimeType - Image MIME type (e.g., 'image/jpeg')
 * @returns {Promise<Blob>}
 */
async function canvasToBlob(canvas, mimeType = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to convert canvas to blob'));
      }
    }, mimeType, 0.95);  // 95% quality for JPEG
  });
}

/**
 * Handle attachment chip click - remove attachment
 * @param {MouseEvent} event - Click event
 */
export function handleAttachmentListClick(event) {
  const target = event.target.closest('.attachment-chip');
  if (target) {
      clearAttachments();
      UI.renderAttachments(getAttachments());
  }
}

/**
 * Handle microphone button click - start/stop voice input
 */
export function handleMicClick() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) {
      toast.error(USER_ERROR_MESSAGES.SPEECH_NOT_SUPPORTED);
      return;
    }

    if (recognizing) {
      // CLEANUP FIX: Properly stop and cleanup recognition
      if (recognition) {
        recognition.stop();
        recognition = null;
      }
      return;
    }

    recognition = new Speech();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => { recognizing = true; UI.setMicState(true); };
    recognition.onend = () => {
      recognizing = false;
      UI.setMicState(false);
      // MEMORY LEAK FIX: Clear recognition reference when done
      recognition = null;
    };
    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      recognizing = false;
      UI.setMicState(false);
      // CLEANUP: Clear reference on error
      recognition = null;
      toast.error(USER_ERROR_MESSAGES.SPEECH_FAILED);
    };
    recognition.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; ++i) t += e.results[i][0].transcript;
        UI.setInputValue(t);
    };

    try {
      recognition.start();
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
      recognition = null;
      recognizing = false;
      UI.setMicState(false);
      toast.error(USER_ERROR_MESSAGES.SPEECH_FAILED);
    }
}

/**
 * Handle speak last AI response button click
 */
export function handleSpeakLast() {
    const msgs = getCurrentSessionSync().messages;
    const last = [...msgs].reverse().find(m => m.role === 'ai');
    if (last) speakText(last.text);
}

/**
 * Handle stop button click - cancel generation/speech
 */
export function handleStopClick() {
  cancelGeneration();
}

/**
 * Handle context toggle button click
 * @returns {Promise<void>}
 */
export async function handleToggleContext() {
  UI.openContextModal();
  await refreshContextDraft(false);
}

/**
 * Handle context textarea input - update in-memory state
 * @param {Event} event - Input event
 */
export function handleContextInput(event) {
  const text = event.target.value;
  updateContextDraft(text);
}

/**
 * Handle context textarea blur - save to storage
 * @param {Event} event - Blur event
 * @returns {Promise<void>}
 */
export async function handleContextBlur(event) {
  const text = event.target.value;
  await saveContextDraft(text);
}

/**
 * Handle settings button click - open settings modal
 */
export function handleOpenSettings() {
  UI.openSettingsModal();
  const tempSlider = document.getElementById('temperature');
  const tempValue = document.getElementById('temperature-value');

  tempSlider.value = appState.settings.temperature;
  tempValue.textContent = appState.settings.temperature;

  // Update value display when slider changes
  tempSlider.oninput = () => {
    tempValue.textContent = tempSlider.value;
  };

  document.getElementById('topk').value = appState.settings.topK;
  document.getElementById('system-prompt').value = appState.settings.systemPrompt;

  // Update language dropdown to show current selection
  const currentLang = getSettingOrDefault(appState.settings, 'language');
  const langTrigger = document.getElementById('language-trigger');
  if (langTrigger) {
    langTrigger.textContent = LANGUAGE_LABELS[currentLang] || LANGUAGE_LABELS['en'];
    langTrigger.dataset.selectedLang = currentLang;
  }

  // Update theme dropdown to show current selection
  const currentTheme = getSettingOrDefault(appState.settings, 'theme');
  const themeTrigger = document.getElementById('theme-trigger');
  if (themeTrigger) {
    themeTrigger.textContent = THEME_LABELS[currentTheme] || THEME_LABELS['auto'];
    themeTrigger.dataset.selectedTheme = currentTheme;
  }
}

/**
 * Handle language dropdown selection
 * @param {MouseEvent} event - Click event
 */
export function handleLanguageSelect(event) {
  const target = event.target.closest('.dropdown-item');
  if (!target) return;

  const lang = target.dataset.lang;
  const langText = target.textContent;

  // Update trigger button text
  const trigger = document.getElementById('language-trigger');
  if (trigger) {
    trigger.textContent = langText;
  }

  // Store selected language in a temporary attribute for save handler
  trigger.dataset.selectedLang = lang;

  // Close dropdown
  UI.closeMenu('language');
}

/**
 * Handle theme dropdown selection
 */
export function handleThemeSelect(event) {
  const target = event.target.closest('.dropdown-item');
  if (!target) return;

  const theme = target.dataset.theme;
  const themeText = target.textContent;

  // Update trigger button text
  const trigger = document.getElementById('theme-trigger');
  if (trigger) {
    trigger.textContent = themeText;
  }

  // Store selected theme in a temporary attribute for save handler
  trigger.dataset.selectedTheme = theme;

  // Close dropdown
  UI.closeMenu('theme');
}

/**
 * Handle settings close button click
 */
export function handleCloseSettings() {
  UI.closeModal();
}

/**
 * Handle settings save button click
 * @returns {Promise<void>}
 */
export async function handleSaveSettings() {
    const temp = document.getElementById('temperature').value;
    const topk = document.getElementById('topk').value;
    const sys = document.getElementById('system-prompt').value;

    // Get selected language from dropdown trigger
    const langTrigger = document.getElementById('language-trigger');
    const lang = langTrigger?.dataset.selectedLang || getSettingOrDefault(appState.settings, 'language');

    // Get selected theme from dropdown trigger
    const themeTrigger = document.getElementById('theme-trigger');
    const theme = themeTrigger?.dataset.selectedTheme || getSettingOrDefault(appState.settings, 'theme');

    updateSettings({ temperature: Number(temp), topK: Number(topk), systemPrompt: sys, language: lang, theme });
    await saveState();

    // Apply theme immediately
    applyTheme(theme);

    // Force model reset so new settings apply immediately
    resetModel();

    UI.closeModal();
    await refreshAvailability();
    toast.success('Settings saved');
}

/**
 * Handle setup guide button click
 * @returns {Promise<void>}
 */
export async function handleOpenSetupGuide() {
  UI.openSetupGuideModal();

  const content = document.getElementById('setup-content');
  content.innerHTML = '<p class="setup-intro">Checking API availability...</p>';

  try {
    const status = await getSetupStatus();
    renderSetupGuide(status);
  } catch (e) {
    content.innerHTML = `<p class="error">Error checking API status: ${e.message}</p>`;
  }
}

/**
 * Render setup guide content
 * @param {Object} status - Setup status from getSetupStatus()
 */
function renderSetupGuide(status) {
  const content = document.getElementById('setup-content');

  let html = '';

  // Browser check
  if (!status.browserInfo.isChrome) {
    html += `<div class="setup-section error">
      <h3>❌ Unsupported Browser</h3>
      <p>Chrome Built-in AI APIs are only available in Google Chrome.</p>
      <p><strong>Your browser:</strong> ${navigator.userAgent}</p>
    </div>`;
    content.innerHTML = html;
    return;
  }

  if (!status.browserInfo.recommendedVersion) {
    html += `<div class="setup-section warning">
      <h3>⚠️ Chrome Version</h3>
      <p><strong>Current:</strong> Chrome ${status.browserInfo.chromeVersion}</p>
      <p><strong>Recommended:</strong> Chrome 138+</p>
      <p>Some features may not work properly. Please update Chrome.</p>
    </div>`;
  }

  // Overall status
  if (status.isFullySetup) {
    html += `<div class="setup-section success">
      <h3>✅ All Required APIs Ready</h3>
      <p>Your setup is complete! All required APIs are available.</p>
    </div>`;
  } else {
    html += `<div class="setup-section error">
      <h3>❌ Setup Incomplete</h3>
      <p>Some required APIs are missing. Follow the instructions below to enable them.</p>
    </div>`;
  }

  // Required APIs
  html += '<div class="setup-section"><h3>Required APIs</h3>';

  status.requiredAPIs.forEach(api => {
    const statusIcon = api.available ? '✅' : '❌';
    const statusClass = api.available ? 'success' : 'error';

    html += `<div class="api-item ${statusClass}">
      <div class="api-header">
        <span class="api-icon">${statusIcon}</span>
        <div style="flex: 1;">
          <div class="api-name">${getAPIName(api)}</div>
          <div class="api-status">${api.message}</div>
        </div>
      </div>`;

    if (!api.available) {
      html += `<div class="api-instructions">
        <p><strong>To enable:</strong></p>
        <ol>
          <li>Copy this flag: <code class="flag-url">${api.flag}</code></li>
          <li>Paste it into your Chrome address bar</li>
          <li>Set to: <strong>${api.flagValue}</strong></li>
          <li>Click "Relaunch" button</li>
        </ol>
      </div>`;
    } else if (api.multilingual !== undefined) {
      html += `<div class="api-info">
        <p><strong>Multilingual (es, ja):</strong> ${api.multilingual ? '✅ Enabled' : '❌ Disabled'}</p>
        ${!api.multilingual ? '<p><small>For Spanish/Japanese support, set flag to "Enabled multilingual"</small></p>' : ''}
      </div>`;
    }

    html += '</div>';
  });

  html += '</div>';

  // Optional APIs
  html += '<div class="setup-section"><h3>Optional Features (Nice-to-Have)</h3>';
  html += '<p class="section-desc">These features provide better performance but are not required:</p>';

  status.optionalAPIs.forEach(api => {
    const statusIcon = api.available ? '✅' : '⚪';
    const statusClass = api.available ? 'success' : 'optional';

    html += `<div class="api-item ${statusClass}">
      <div class="api-header">
        <span class="api-icon">${statusIcon}</span>
        <div style="flex: 1;">
          <div class="api-name">${getAPIName(api)}</div>
          <div class="api-status">${api.message}</div>
        </div>
      </div>`;

    if (!api.available && api.fallback) {
      html += `<div class="api-info">
        <p><strong>Fallback:</strong> ${api.fallback}</p>
      </div>`;
    }

    if (!api.available) {
      html += `<div class="api-instructions collapsed">
        <p><strong>To enable (optional):</strong></p>
        <ol>
          <li>Flag: <code class="flag-url">${api.flag}</code></li>
          <li>Set to: <strong>${api.flagValue}</strong></li>
        </ol>
      </div>`;
    }

    html += '</div>';
  });

  html += '</div>';

  // Instructions footer
  html += `<div class="setup-footer">
    <p><strong>After changing flags:</strong> Chrome will show a "Relaunch" button. Click it to restart Chrome and apply changes.</p>
    <p><strong>Having issues?</strong> Make sure you have:</p>
    <ul>
      <li>At least 22 GB free disk space</li>
      <li>GPU with 4+ GB VRAM or CPU with 16GB RAM</li>
      <li>Unmetered internet connection for model downloads</li>
    </ul>
  </div>`;

  content.innerHTML = html;
}

/**
 * Get friendly name for API
 * @param {Object} api - API status object
 * @returns {string} Friendly name
 */
function getAPIName(api) {
  if (api.flag.includes('prompt-api')) return 'Prompt API (Gemini Nano)';
  if (api.flag.includes('translation-api')) return 'Translation API';
  if (api.flag.includes('language-detection')) return 'Language Detection API';
  if (api.flag.includes('summarization')) return 'Summarization API';
  if (api.flag.includes('rewriter')) return 'Rewriter API';
  return 'Unknown API';
}

/**
 * Apply theme to the document
 * @param {string} theme - Theme preference: 'auto', 'dark', or 'light'
 */
export function applyTheme(theme) {
  const root = document.documentElement;

  if (theme === 'auto') {
    // Use browser/system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    // Use explicit theme
    root.setAttribute('data-theme', theme);
  }
}

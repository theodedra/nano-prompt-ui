import { $, formatDate } from '../utils/utils.js';
import { UI_MESSAGES, ICONS } from '../config/constants.js';
import { VirtualScroller } from './virtual-scroll.js';
import {
  getLastStatus,
  setLastStatus,
  getIsSystemBusy,
  setIsSystemBusy,
  getCurrentModelStatus,
  setCurrentModelStatus,
  getEls,
  setEls,
  getWrapEl,
  setWrapEl,
  getChatCardEl,
  setChatCardEl,
  getInputCardEl,
  setInputCardEl,
  getScrollObserver,
  setScrollObserver,
  getVirtualScroller,
  setVirtualScroller,
  getSessionVirtualScroller,
  setSessionVirtualScroller,
  getOpenSetupGuideModalCallback,
  setOpenSetupGuideModalCallback,
  getBuildContextSnapshotUICallback,
  setBuildContextSnapshotUICallback,
  getCreateMessageElementCallback,
  setCreateMessageElementCallback
} from '../core/state.js';

const ICON_MIC = ICONS.MIC;
const ICON_STOP = ICONS.STOP;

export function initUI() {
  const els = {
    avail: $('#model-status'),
    log: $('#log'),
    copy: $('#copy'),
    saveMd: $('#save-md'),
    sessionSearch: $('#session-search'),
    sessionMeta: $('#session-meta'),
    contextPanel: $('#context-panel'),
    contextText: $('#context-text'),
    hardware: $('#hardware'),
    attachmentList: $('#attachment-list'),
    stop: $('#stop'),
    mic: $('#mic'),
    input: $('#in'),
    askBtn: $('#ask'),
    sumBtn: $('#sum'),
    attachBtn: $('#attach'),
    templatesMenu: $('#templates-menu'),
    templatesTrigger: $('#templates-trigger'),
    sessionMenu: $('#session-menu'),
    sessionTrigger: $('#session-trigger'),
    settingsModal: $('#settings-modal'),
    contextModal: $('#context-modal'),
    diagAvailability: $('#diag-availability'),
    diagChecked: $('#diag-last-checked'),
    diagWarmup: $('#diag-warmup'),
    diagWarmupNote: $('#diag-warmup-note'),
    diagRefreshBtn: $('#refresh-diagnostics'),
    diagWarmupBtn: $('#warmup-now'),
    // Language and theme dropdowns
    languageMenu: $('#language-menu'),
    languageTrigger: $('#language-trigger'),
    themeMenu: $('#theme-menu'),
    themeTrigger: $('#theme-trigger'),
    // Settings form elements
    temperature: $('#temperature'),
    temperatureValue: $('#temperature-value'),
    topKInput: $('#topk'),
    systemPromptInput: $('#system-prompt'),
    // File input for attachments
    fileInput: $('#file-input'),
    // Setup guide modal
    setupGuideModal: $('#setup-guide-modal'),
    setupContent: $('#setup-content')
  };
  setEls(els);

  // Cache container elements for centralized state management
  setWrapEl($('.wrap'));
  setChatCardEl($('.card.chat'));
  setInputCardEl($('.input-card'));

  // ResizeObserver for auto-scrolling during streaming
  const logEl = els.log;
  if (window.ResizeObserver && logEl) {
    const observer = new ResizeObserver(() => {
      if (logEl) {
        logEl.scrollTop = logEl.scrollHeight;
      }
    });
    setScrollObserver(observer);
  }

  const createCallback = getCreateMessageElementCallback();
  if (logEl && createCallback) {
    setVirtualScroller(new VirtualScroller(logEl, createCallback));
  }

  if (els.sessionSearch) {
    // Initialize session search term (handled by session-renderer)
  }

  const buildCallback = getBuildContextSnapshotUICallback();
  if (buildCallback) {
    buildCallback();
  }
}

// State getters - re-exported from state.js for backwards compatibility
export {
  getEls,
  getWrapEl,
  getChatCardEl,
  getInputCardEl,
  getScrollObserver,
  getVirtualScroller,
  getSessionVirtualScroller,
  setSessionVirtualScroller,
  getLastStatus,
  getIsSystemBusy
};

// Callback setters - re-exported from state.js
export {
  setOpenSetupGuideModalCallback,
  setBuildContextSnapshotUICallback,
  setCreateMessageElementCallback
};

// Theme
export function applyTheme(theme) {
  const root = document.documentElement;

  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

// Busy state
export function setBusy(isBusy) {
  setIsSystemBusy(isBusy);

  const wrapEl = getWrapEl();
  const chatCardEl = getChatCardEl();
  const inputCardEl = getInputCardEl();
  const els = getEls();

  // Centralized state: toggle on containers
  if (wrapEl) wrapEl.classList.toggle('is-busy', isBusy);
  if (chatCardEl) chatCardEl.classList.toggle('is-streaming', isBusy);
  if (inputCardEl) inputCardEl.classList.toggle('is-busy', isBusy);

  // Button states still need explicit toggling for accessibility
  if (els.askBtn) els.askBtn.disabled = isBusy;
  if (els.sumBtn) els.sumBtn.disabled = isBusy;
  if (els.stop) els.stop.disabled = !isBusy;

  const lastStatus = getLastStatus();
  if (els.avail) {
    els.avail.textContent = isBusy ? UI_MESSAGES.THINKING : lastStatus;
  }
}

export function setStatusText(text) {
  setLastStatus(text);
  const els = getEls();
  if (!getIsSystemBusy() && els.avail) {
    els.avail.textContent = text;
  }
}

export function setRestrictedState(isRestricted) {
  const els = getEls();
  const interactive = [
    els.input, els.askBtn, els.sumBtn, els.mic, els.attachBtn, els.templatesTrigger
  ];

  if (isRestricted) {
    interactive.forEach(el => { if (el) el.disabled = true; });
    if (els.input) els.input.placeholder = UI_MESSAGES.INPUT_PLACEHOLDER_DISABLED;
    setStatusText(UI_MESSAGES.SYSTEM_PAGE);
  } else {
    interactive.forEach(el => { if (el) el.disabled = false; });
    if (els.stop) els.stop.disabled = !getIsSystemBusy();
    if (els.input) els.input.placeholder = UI_MESSAGES.INPUT_PLACEHOLDER;
    const lastStatus = getLastStatus();
    setStatusText(lastStatus === UI_MESSAGES.SYSTEM_PAGE ? UI_MESSAGES.READY : lastStatus);
  }
}

// Model status chip
export function updateModelStatusChip(status) {
  const els = getEls();
  if (!els.avail || !status) return;

  setCurrentModelStatus(status);

  setLastStatus(status.label);
  if (!getIsSystemBusy()) {
    els.avail.textContent = status.label;
  }

  els.avail.title = status.tooltip;
  els.avail.dataset.level = status.level;
  els.avail.dataset.clickable = status.showGuideLink ? 'true' : 'false';
}

export function handleModelStatusChipClick() {
  const currentModelStatus = getCurrentModelStatus();
  const callback = getOpenSetupGuideModalCallback();
  if (currentModelStatus?.showGuideLink && callback) {
    callback();
  }
}

// Hardware/diagnostics
export function setHardwareStatus(text) {
  const els = getEls();
  if (els.hardware) els.hardware.textContent = text;
}

function formatWarmupStatus(status) {
  if (status === 'success') return 'success';
  if (status === 'awaiting-download') return 'waiting for download';
  if (status === 'error') return 'failed';
  if (status === 'unavailable') return 'unavailable';
  if (status === 'running') return 'running...';
  return '';
}

export function updateDiagnostics(diag = {}) {
  const els = getEls();
  if (!els.diagAvailability) return;

  const availabilityText = diag.availabilityLabel || diag.availability || 'Unknown';
  els.diagAvailability.textContent = availabilityText;

  if (els.diagChecked) {
    const checked = diag.availabilityCheckedAt
      ? formatDate(diag.availabilityCheckedAt)
      : 'Never checked';
    els.diagChecked.textContent = checked;
  }

  if (els.diagWarmup) {
    const warmupTime = diag.lastWarmupAt
      ? formatDate(diag.lastWarmupAt)
      : 'Not run yet';
    const statusLabel = formatWarmupStatus(diag.lastWarmupStatus);
    els.diagWarmup.textContent = statusLabel
      ? `${warmupTime} (${statusLabel})`
      : warmupTime;
  }

  if (els.diagWarmupNote) {
    let note = '';
    if (diag.lastWarmupStatus === 'error' && diag.lastWarmupError) {
      note = diag.lastWarmupError;
    } else if (diag.lastWarmupStatus === 'awaiting-download') {
      note = 'Warmup skipped until model download completes.';
    } else if (diag.lastWarmupStatus === 'unavailable' && diag.lastWarmupError) {
      note = diag.lastWarmupError;
    }
    els.diagWarmupNote.textContent = note;
  }
}

export function setDiagnosticsBusy(target = 'all', isBusy = false) {
  const els = getEls();
  const targets = target === 'all'
    ? [els.diagRefreshBtn, els.diagWarmupBtn]
    : target === 'availability'
      ? [els.diagRefreshBtn]
      : [els.diagWarmupBtn];

  targets.forEach(btn => { if (btn) btn.disabled = isBusy; });
}

/**
 * Describe availability status for display
 * @param {string} status - Availability status
 * @returns {string} Human-readable label
 */
function describeAvailability(status) {
  if (status === 'readily' || status === 'available') return UI_MESSAGES.READY;
  if (status === 'after-download' || status === 'downloading') return 'Downloading...';
  if (status === 'no') return UI_MESSAGES.PAGE_MODE;
  if (!status) return 'Unknown';
  return status;
}

/**
 * Update availability display with diagnostics (UI only)
 * Storage updates should be done separately via Storage.setAvailability() and Storage.setAvailabilityCheckedAt()
 * @param {string} status - Availability status
 * @param {number|null} checkedAt - Timestamp when availability was checked
 * @param {object} diag - Additional diagnostics data
 * @returns {string} The display label for the status
 */
export function updateAvailabilityDisplay(status, checkedAt, diag = {}) {
  const label = describeAvailability(status);
  
  setStatusText(label);
  setHardwareStatus(`Gemini Nano: ${label}`);
  
  // Use requestIdleCallback for non-critical diagnostics updates
  const updateDiag = () => {
    updateDiagnostics({
      ...diag,
      availability: status,
      availabilityCheckedAt: checkedAt,
      availabilityLabel: label
    });
  };
  
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(updateDiag, { timeout: 2000 });
  } else {
    setTimeout(updateDiag, 0);
  }

  return label;
}

// Context text
export function setContextText(text) {
  const els = getEls();
  if (els.contextText) els.contextText.value = text || '';
}

export function getContextText() {
  const els = getEls();
  return els.contextText?.value?.trim() || '';
}

// Menus
export function toggleMenu(menuName) {
  const els = getEls();
  let menu, trigger;
  if (menuName === 'session') {
    menu = els.sessionMenu;
    trigger = els.sessionTrigger;
    closeMenu('templates');
    closeMenu('language');
    closeMenu('theme');
  } else if (menuName === 'templates') {
    menu = els.templatesMenu;
    trigger = els.templatesTrigger;
    closeMenu('session');
    closeMenu('language');
    closeMenu('theme');
  } else if (menuName === 'language') {
    menu = els.languageMenu;
    trigger = els.languageTrigger;
    closeMenu('session');
    closeMenu('templates');
    closeMenu('theme');
  } else if (menuName === 'theme') {
    menu = els.themeMenu;
    trigger = els.themeTrigger;
    closeMenu('session');
    closeMenu('templates');
    closeMenu('language');
  }

  if (menu) {
    const isHidden = menu.hidden;
    menu.hidden = !isHidden;
    trigger?.setAttribute('aria-expanded', !isHidden);
  }
}

export function closeMenu(menuName) {
  const els = getEls();
  let menu, trigger;
  if (menuName === 'session') {
    menu = els.sessionMenu;
    trigger = els.sessionTrigger;
  } else if (menuName === 'templates') {
    menu = els.templatesMenu;
    trigger = els.templatesTrigger;
  } else if (menuName === 'language') {
    menu = els.languageMenu;
    trigger = els.languageTrigger;
  } else if (menuName === 'theme') {
    menu = els.themeMenu;
    trigger = els.themeTrigger;
  }

  if (menu) {
    menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  }
}

// Mic state
export function setMicState(active) {
  const inputCardEl = getInputCardEl();
  const els = getEls();
  if (inputCardEl) inputCardEl.classList.toggle('is-recording', active);

  if (els.mic) {
    els.mic.setAttribute('aria-pressed', active ? 'true' : 'false');
    els.mic.innerHTML = active ? ICON_STOP : ICON_MIC;
  }
}

// Input error
export function setInputError(hasError) {
  const inputCardEl = getInputCardEl();
  if (inputCardEl) inputCardEl.classList.toggle('has-error', hasError);
}

// Input value
export function getInputValue() {
  const els = getEls();
  return els.input?.value || '';
}

export function setInputValue(value) {
  const els = getEls();
  if (els.input) els.input.value = value;
}

// Stop button
export function setStopEnabled(canStop) {
  const els = getEls();
  if (els.stop) els.stop.disabled = !canStop;
}

export function restoreStopButtonState(isActive) {
  const els = getEls();
  if (els.stop) els.stop.disabled = !isActive;
}

// Focus
export function focusInput() {
  const els = getEls();
  if (els.input) els.input.focus();
}

// Language/Theme selection
export function setLanguageSelection(lang, label) {
  const els = getEls();
  if (els.languageTrigger) {
    els.languageTrigger.textContent = label || lang;
    els.languageTrigger.dataset.selectedLang = lang;
  }
}

export function setThemeSelection(theme, label) {
  const els = getEls();
  if (els.themeTrigger) {
    els.themeTrigger.textContent = label || theme;
    els.themeTrigger.dataset.selectedTheme = theme;
  }
}

// Settings form
export function syncSettingsForm({
  temperature,
  topK,
  systemPrompt,
  language,
  languageLabel,
  theme,
  themeLabel
} = {}) {
  const els = getEls();
  if (els.temperature) {
    els.temperature.value = temperature ?? '';
    if (els.temperatureValue) els.temperatureValue.textContent = els.temperature.value;
    els.temperature.oninput = () => {
      if (els.temperatureValue) els.temperatureValue.textContent = els.temperature.value;
    };
  }

  if (els.topKInput) els.topKInput.value = topK ?? '';
  if (els.systemPromptInput) els.systemPromptInput.value = systemPrompt ?? '';

  setLanguageSelection(language, languageLabel);
  setThemeSelection(theme, themeLabel);
}

export function getSettingsFormValues(defaults = {}) {
  const els = getEls();
  const temp = els.temperature?.value ?? defaults.temperature;
  const topk = els.topKInput?.value ?? defaults.topK;
  const sys = els.systemPromptInput?.value ?? defaults.systemPrompt;

  return {
    temperature: Number(temp),
    topK: Number(topk),
    systemPrompt: sys,
    language: els.languageTrigger?.dataset.selectedLang || defaults.language,
    theme: els.themeTrigger?.dataset.selectedTheme || defaults.theme
  };
}

// Utility
export function downloadBlob(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Export availability (for copy/save buttons)
export function setExportAvailability(enabled) {
  const els = getEls();
  [els.copy, els.saveMd].forEach(btn => { if (btn) btn.disabled = !enabled; });
}


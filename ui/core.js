import { $, formatDate } from '../utils/utils.js';
import { UI_MESSAGES, ICONS } from '../constants.js';
import { VirtualScroller } from '../virtual-scroll.js';

// Shared state
let els = {};
let lastStatus = UI_MESSAGES.CHECKING;
let isSystemBusy = false;
let currentModelStatus = null;

// Container elements for centralized state
let wrapEl = null;
let chatCardEl = null;
let inputCardEl = null;

// Scroll/virtual scroll observers
let scrollObserver = null;
let virtualScroller = null;
let sessionVirtualScroller = null;

const ICON_MIC = ICONS.MIC;
const ICON_STOP = ICONS.STOP;

// Callbacks for cross-module communication
let openSetupGuideModalCallback = null;
let buildContextSnapshotUICallback = null;
let createMessageElementCallback = null;

export function setOpenSetupGuideModalCallback(fn) {
  openSetupGuideModalCallback = fn;
}

export function setBuildContextSnapshotUICallback(fn) {
  buildContextSnapshotUICallback = fn;
}

export function setCreateMessageElementCallback(fn) {
  createMessageElementCallback = fn;
}

export function initUI() {
  els = {
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
    diagWarmupBtn: $('#warmup-now')
  };

  // Cache container elements for centralized state management
  wrapEl = $('.wrap');
  chatCardEl = $('.card.chat');
  inputCardEl = $('.input-card');

  // ResizeObserver for auto-scrolling during streaming
  if (window.ResizeObserver && els.log) {
    scrollObserver = new ResizeObserver(() => {
      if (els.log) {
        els.log.scrollTop = els.log.scrollHeight;
      }
    });
  }

  if (els.log && createMessageElementCallback) {
    virtualScroller = new VirtualScroller(els.log, createMessageElementCallback);
  }

  if (els.sessionSearch) {
    // Initialize session search term (handled by session-renderer)
  }

  if (buildContextSnapshotUICallback) {
    buildContextSnapshotUICallback();
  }
}

// State getters
export function getEls() {
  return els;
}

export function getWrapEl() {
  return wrapEl;
}

export function getChatCardEl() {
  return chatCardEl;
}

export function getInputCardEl() {
  return inputCardEl;
}

export function getScrollObserver() {
  return scrollObserver;
}

export function getVirtualScroller() {
  return virtualScroller;
}

export function getSessionVirtualScroller() {
  return sessionVirtualScroller;
}

export function setSessionVirtualScroller(scroller) {
  sessionVirtualScroller = scroller;
}

export function getLastStatus() {
  return lastStatus;
}

export function getIsSystemBusy() {
  return isSystemBusy;
}

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
  isSystemBusy = isBusy;

  // Centralized state: toggle on containers
  if (wrapEl) wrapEl.classList.toggle('is-busy', isBusy);
  if (chatCardEl) chatCardEl.classList.toggle('is-streaming', isBusy);
  if (inputCardEl) inputCardEl.classList.toggle('is-busy', isBusy);

  // Button states still need explicit toggling for accessibility
  if (els.askBtn) els.askBtn.disabled = isBusy;
  if (els.sumBtn) els.sumBtn.disabled = isBusy;
  if (els.stop) els.stop.disabled = !isBusy;

  if (els.avail) {
    els.avail.textContent = isBusy ? UI_MESSAGES.THINKING : lastStatus;
  }
}

export function setStatusText(text) {
  lastStatus = text;
  if (!isSystemBusy && els.avail) {
    els.avail.textContent = text;
  }
}

export function setRestrictedState(isRestricted) {
  const interactive = [
    els.input, els.askBtn, els.sumBtn, els.mic, els.attachBtn, els.templatesTrigger
  ];

  if (isRestricted) {
    interactive.forEach(el => { if (el) el.disabled = true; });
    if (els.input) els.input.placeholder = UI_MESSAGES.INPUT_PLACEHOLDER_DISABLED;
    setStatusText(UI_MESSAGES.SYSTEM_PAGE);
  } else {
    interactive.forEach(el => { if (el) el.disabled = false; });
    if (els.stop) els.stop.disabled = !isSystemBusy;
    if (els.input) els.input.placeholder = UI_MESSAGES.INPUT_PLACEHOLDER;
    setStatusText(lastStatus === UI_MESSAGES.SYSTEM_PAGE ? UI_MESSAGES.READY : lastStatus);
  }
}

// Model status chip
export function updateModelStatusChip(status) {
  if (!els.avail || !status) return;

  currentModelStatus = status;

  lastStatus = status.label;
  if (!isSystemBusy) {
    els.avail.textContent = status.label;
  }

  els.avail.title = status.tooltip;
  els.avail.dataset.level = status.level;
  els.avail.dataset.clickable = status.showGuideLink ? 'true' : 'false';
}

export function handleModelStatusChipClick() {
  if (currentModelStatus?.showGuideLink && openSetupGuideModalCallback) {
    openSetupGuideModalCallback();
  }
}

// Hardware/diagnostics
export function setHardwareStatus(text) {
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
  const targets = target === 'all'
    ? [els.diagRefreshBtn, els.diagWarmupBtn]
    : target === 'availability'
      ? [els.diagRefreshBtn]
      : [els.diagWarmupBtn];

  targets.forEach(btn => { if (btn) btn.disabled = isBusy; });
}

// Context text
export function setContextText(text) {
  if (els.contextText) els.contextText.value = text || '';
}

export function getContextText() {
  return els.contextText?.value?.trim() || '';
}

// Menus
export function toggleMenu(menuName) {
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
    menu = document.getElementById('language-menu');
    trigger = document.getElementById('language-trigger');
    closeMenu('session');
    closeMenu('templates');
    closeMenu('theme');
  } else if (menuName === 'theme') {
    menu = document.getElementById('theme-menu');
    trigger = document.getElementById('theme-trigger');
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
  let menu, trigger;
  if (menuName === 'session') {
    menu = els.sessionMenu;
    trigger = els.sessionTrigger;
  } else if (menuName === 'templates') {
    menu = els.templatesMenu;
    trigger = els.templatesTrigger;
  } else if (menuName === 'language') {
    menu = document.getElementById('language-menu');
    trigger = document.getElementById('language-trigger');
  } else if (menuName === 'theme') {
    menu = document.getElementById('theme-menu');
    trigger = document.getElementById('theme-trigger');
  }

  if (menu) {
    menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  }
}

// Mic state
export function setMicState(active) {
  if (inputCardEl) inputCardEl.classList.toggle('is-recording', active);

  if (els.mic) {
    els.mic.setAttribute('aria-pressed', active ? 'true' : 'false');
    els.mic.innerHTML = active ? ICON_STOP : ICON_MIC;
  }
}

// Input error
export function setInputError(hasError) {
  if (inputCardEl) inputCardEl.classList.toggle('has-error', hasError);
}

// Input value
export function getInputValue() {
  return els.input?.value || '';
}

export function setInputValue(value) {
  if (els.input) els.input.value = value;
}

// Stop button
export function setStopEnabled(canStop) {
  if (els.stop) els.stop.disabled = !canStop;
}

export function restoreStopButtonState(isActive) {
  if (els.stop) els.stop.disabled = !isActive;
}

// Focus
export function focusInput() {
  if (els.input) els.input.focus();
}

// Language/Theme selection
export function setLanguageSelection(lang, label) {
  const trigger = document.getElementById('language-trigger');
  if (trigger) {
    trigger.textContent = label || lang;
    trigger.dataset.selectedLang = lang;
  }
}

export function setThemeSelection(theme, label) {
  const trigger = document.getElementById('theme-trigger');
  if (trigger) {
    trigger.textContent = label || theme;
    trigger.dataset.selectedTheme = theme;
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
  const tempSlider = document.getElementById('temperature');
  const tempValue = document.getElementById('temperature-value');
  if (tempSlider) {
    tempSlider.value = temperature ?? '';
    if (tempValue) tempValue.textContent = tempSlider.value;
    tempSlider.oninput = () => {
      if (tempValue) tempValue.textContent = tempSlider.value;
    };
  }

  const topKInput = document.getElementById('topk');
  const systemPromptInput = document.getElementById('system-prompt');
  if (topKInput) topKInput.value = topK ?? '';
  if (systemPromptInput) systemPromptInput.value = systemPrompt ?? '';

  setLanguageSelection(language, languageLabel);
  setThemeSelection(theme, themeLabel);
}

export function getSettingsFormValues(defaults = {}) {
  const temp = document.getElementById('temperature')?.value ?? defaults.temperature;
  const topk = document.getElementById('topk')?.value ?? defaults.topK;
  const sys = document.getElementById('system-prompt')?.value ?? defaults.systemPrompt;

  const langTrigger = document.getElementById('language-trigger');
  const themeTrigger = document.getElementById('theme-trigger');

  return {
    temperature: Number(temp),
    topK: Number(topk),
    systemPrompt: sys,
    language: langTrigger?.dataset.selectedLang || defaults.language,
    theme: themeTrigger?.dataset.selectedTheme || defaults.theme
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
  [els.copy, els.saveMd].forEach(btn => { if (btn) btn.disabled = !enabled; });
}


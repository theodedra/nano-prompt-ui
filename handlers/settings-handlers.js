/**
 * Settings Handlers
 *
 * Handles settings UI interactions via controller layer.
 */

import * as Controller from '../controller/controller.js';
import * as Model from '../core/model.js';
import {
  getSettingOrDefault,
  LANGUAGE_LABELS,
  THEME_LABELS,
  PROMPT_API_OPTIMIZED_LANGUAGES
} from '../config/constants.js';
import { getSetupStatus } from '../core/setup-guide.js';
import { toast } from '../utils/toast.js';
import * as UI from '../ui/index.js';
import { escapeHtml } from '../utils/utils.js';

const SETTINGS_TABS = ['general', 'diagnostics'];

function updateLanguageGuidance(lang) {
  const isOptimized = PROMPT_API_OPTIMIZED_LANGUAGES.includes(lang);
  const langLabel = LANGUAGE_LABELS[lang] || lang || 'Selected language';

  if (isOptimized) {
    UI.setLanguageNote('Optimized for English, Spanish, and Japanese. Gemini Nano will still attempt other languages.');
    return;
  }

  UI.setLanguageNote(
    `${langLabel} selected. Translation uses Chrome's Translation API when available. General chat works best in English, Spanish, or Japanese but will still attempt this language.`
  );
}

export function handleOpenSettings() {
  UI.openSettingsModal();
  const settings = Controller.getSettings();
  const currentLang = getSettingOrDefault(settings, 'language');
  const currentTheme = getSettingOrDefault(settings, 'theme');

  UI.syncSettingsForm({
    temperature: settings.temperature,
    topK: settings.topK,
    systemPrompt: settings.systemPrompt,
    language: currentLang,
    languageLabel: LANGUAGE_LABELS[currentLang] || LANGUAGE_LABELS.en,
    theme: currentTheme,
    themeLabel: THEME_LABELS[currentTheme] || THEME_LABELS.auto
  });
  updateLanguageGuidance(currentLang);

  renderDiagnosticsPanel();
  setActiveSettingsTab('general');
}

async function renderDiagnosticsPanel() {
  try {
    const diag = await Model.getDiagnostics({
      availability: Controller.getAvailability(),
      availabilityCheckedAt: Controller.getAvailabilityCheckedAt()
    });
    UI.updateDiagnostics(diag);
  } catch (e) {
    UI.updateDiagnostics({ availabilityLabel: 'Unknown' });
  }
}

export function handleLanguageSelect(event) {
  const target = event.target.closest('.dropdown-item');
  if (!target) return;

  const lang = target.dataset.lang;
  const langText = target.textContent;

  UI.setLanguageSelection(lang, langText);
  updateLanguageGuidance(lang);
  UI.closeMenu('language');
}

export function handleLanguageTriggerClick(event) {
  event.stopPropagation();
  UI.toggleMenu('language');
}

export function handleThemeSelect(event) {
  const target = event.target.closest('.dropdown-item');
  if (!target) return;

  const theme = target.dataset.theme;
  const themeText = target.textContent;

  UI.setThemeSelection(theme, themeText);
  UI.closeMenu('theme');
}

export function handleThemeTriggerClick(event) {
  event.stopPropagation();
  UI.toggleMenu('theme');
}

export async function handleDiagnosticsRefresh() {
  UI.setDiagnosticsBusy('availability', true);
  try {
    UI.updateDiagnostics({ availabilityLabel: 'checking…' });

    const result = await Model.checkAvailability({
      forceCheck: true,
      cachedAvailability: Controller.getAvailability(),
      cachedCheckedAt: Controller.getAvailabilityCheckedAt()
    });

    Controller.updateAvailabilityDisplay(result.status, result.checkedAt, result.diag);

    const diag = await Model.getDiagnostics({
      availability: result.status,
      availabilityCheckedAt: result.checkedAt
    });
    UI.updateDiagnostics(diag);
  } finally {
    UI.setDiagnosticsBusy('availability', false);
  }
}

export async function handleWarmupClick() {
  UI.setDiagnosticsBusy('warmup', true);
  try {
    UI.updateDiagnostics({ lastWarmupStatus: 'running' });
    const result = await Model.warmUpModel();

    Controller.updateAvailabilityDisplay(result.status, result.checkedAt, result.diag);
    UI.updateDiagnostics(result.diag);

    if (result.warmupStatus === 'success') {
      toast.success('Warmup completed');
    } else if (result.warmupStatus === 'awaiting-download') {
      toast.info('Warmup skipped until model download finishes');
    } else if (result.warmupStatus === 'unavailable') {
      toast.info('Prompt API is not available in this Chrome build');
    } else {
      Controller.showToast('error', 'Warmup failed');
    }
  } catch (e) {
    Controller.showToast('error', 'Warmup failed');
  } finally {
    UI.setDiagnosticsBusy('warmup', false);
  }
}

export function handleCloseSettings() {
  UI.closeModal();
}

export function handleDocumentClick(event) {
  if (!event.target.closest('#language-dropdown')) UI.closeMenu('language');
  if (!event.target.closest('#theme-dropdown')) UI.closeMenu('theme');
}

export async function handleSaveSettings() {
  const settings = Controller.getSettings();
  const defaults = {
    temperature: settings.temperature,
    topK: settings.topK,
    systemPrompt: settings.systemPrompt,
    language: getSettingOrDefault(settings, 'language'),
    theme: getSettingOrDefault(settings, 'theme')
  };
  const { temperature, topK, systemPrompt, language, theme } = UI.getSettingsFormValues(defaults);

  Controller.patchSettings({
    temperature,
    topK,
    systemPrompt,
    language,
    theme
  });
  await Controller.persistState();

  Controller.applyTheme(theme);
  Model.resetModel();

  UI.closeModal();

  // Refresh availability
  const result = await Model.checkAvailability({
    forceCheck: false,
    cachedAvailability: Controller.getAvailability(),
    cachedCheckedAt: Controller.getAvailabilityCheckedAt()
  });
  Controller.updateAvailabilityDisplay(result.status, result.checkedAt, result.diag);

  toast.success('Settings saved');
}

function setActiveSettingsTab(tab) {
  SETTINGS_TABS.forEach((name) => {
    const isActive = name === tab;
    const tabButton = document.getElementById(`settings-tab-${name}`);
    const panel = document.getElementById(`settings-panel-${name}`);
    if (tabButton) {
      tabButton.classList.toggle('is-active', isActive);
      tabButton.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tabButton.tabIndex = isActive ? 0 : -1;
    }
    if (panel) {
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    }
  });
}

export function handleSettingsTabClick(event) {
  const target = event.target.closest('[data-tab]');
  if (!target) return;
  event.preventDefault();
  const tab = target.dataset.tab;
  if (!tab || !SETTINGS_TABS.includes(tab)) return;
  setActiveSettingsTab(tab);
}

export async function handleOpenSetupGuide() {
  UI.openSetupGuideModal();
  UI.setSetupGuideContent('<p class="setup-intro">Checking API availability...</p>');

  try {
    const status = await getSetupStatus();
    UI.renderSetupGuide(status);
  } catch (e) {
    UI.setSetupGuideContent(`<p class="error">Error checking API status: ${escapeHtml(e.message)}</p>`);
  }
}

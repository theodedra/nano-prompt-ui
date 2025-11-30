import {
  appState,
  saveState,
  updateSettings
} from './storage.js';
import { getSettingOrDefault, LANGUAGE_LABELS, THEME_LABELS } from './constants.js';
import { refreshAvailability, resetModel, warmUpModel, getDiagnostics } from './model.js';
import { getSetupStatus } from './setup-guide.js';
import { toast } from './toast.js';
import * as UI from './ui.js';

/**
 * Handle settings button click - open settings modal
 */
export function handleOpenSettings() {
  UI.openSettingsModal();
  const currentLang = getSettingOrDefault(appState.settings, 'language');
  const currentTheme = getSettingOrDefault(appState.settings, 'theme');

  UI.syncSettingsForm({
    temperature: appState.settings.temperature,
    topK: appState.settings.topK,
    systemPrompt: appState.settings.systemPrompt,
    language: currentLang,
    languageLabel: LANGUAGE_LABELS[currentLang] || LANGUAGE_LABELS.en,
    theme: currentTheme,
    themeLabel: THEME_LABELS[currentTheme] || THEME_LABELS.auto
  });

  renderDiagnosticsPanel();
}

async function renderDiagnosticsPanel() {
  try {
    const diag = await getDiagnostics();
    UI.updateDiagnostics(diag);
  } catch (e) {
    UI.updateDiagnostics({ availabilityLabel: 'Unknown' });
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

  UI.setLanguageSelection(lang, langText);
  UI.closeMenu('language');
}

export function handleLanguageTriggerClick(event) {
  event.stopPropagation();
  UI.toggleMenu('language');
}

/**
 * Handle theme dropdown selection
 */
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
    await refreshAvailability({ forceCheck: true });
    const diag = await getDiagnostics();
    UI.updateDiagnostics(diag);
  } finally {
    UI.setDiagnosticsBusy('availability', false);
  }
}

export async function handleWarmupClick() {
  UI.setDiagnosticsBusy('warmup', true);
  try {
    UI.updateDiagnostics({ lastWarmupStatus: 'running' });
    const diag = await warmUpModel();
    UI.updateDiagnostics(diag);
    if (diag.lastWarmupStatus === 'success') {
      toast.success('Warmup completed');
    } else if (diag.lastWarmupStatus === 'awaiting-download') {
      toast.info('Warmup skipped until model download finishes');
    } else if (diag.lastWarmupStatus === 'unavailable') {
      toast.info('Prompt API is not available in this Chrome build');
    } else {
      toast.error('Warmup failed');
    }
  } catch (e) {
    toast.error('Warmup failed');
  } finally {
    UI.setDiagnosticsBusy('warmup', false);
  }
}

/**
 * Handle settings close button click
 */
export function handleCloseSettings() {
  UI.closeModal();
}

export function handleDocumentClick(event) {
  if (!event.target.closest('#language-dropdown')) UI.closeMenu('language');
  if (!event.target.closest('#theme-dropdown')) UI.closeMenu('theme');
}

/**
 * Handle settings save button click
 * @returns {Promise<void>}
 */
export async function handleSaveSettings() {
  const defaults = {
    temperature: appState.settings.temperature,
    topK: appState.settings.topK,
    systemPrompt: appState.settings.systemPrompt,
    language: getSettingOrDefault(appState.settings, 'language'),
    theme: getSettingOrDefault(appState.settings, 'theme')
  };
  const { temperature, topK, systemPrompt, language, theme } = UI.getSettingsFormValues(defaults);

  updateSettings({
    temperature,
    topK,
    systemPrompt,
    language,
    theme
  });
  await saveState();

  UI.applyTheme(theme);
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
  UI.setSetupGuideContent('<p class="setup-intro">Checking API availability...</p>');

  try {
    const status = await getSetupStatus();
    UI.renderSetupGuide(status);
  } catch (e) {
    UI.setSetupGuideContent(`<p class="error">Error checking API status: ${e.message}</p>`);
  }
}

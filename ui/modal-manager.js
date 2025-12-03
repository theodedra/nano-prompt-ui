import { getEls, focusInput } from './core.js';
import { escapeHtml } from '../utils/utils.js';

export function trapFocus(e, container) {
  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusableContent = container.querySelectorAll(focusableSelector);

  if (focusableContent.length === 0) return false;
  const first = focusableContent[0];
  const last = focusableContent[focusableContent.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first) { last.focus(); e.preventDefault(); return true; }
  } else {
    if (document.activeElement === last) { first.focus(); e.preventDefault(); return true; }
  }
  return false;
}

export function getTrapContainer() {
  const openModal = document.querySelector('.modal:not([hidden])');
  return openModal || document.body;
}

export function openSettingsModal() {
  const els = getEls();
  if (els.settingsModal) {
    els.settingsModal.removeAttribute('hidden');
    document.body?.classList.add('modal-open');
    const firstInput = document.getElementById('temperature');
    if (firstInput) firstInput.focus();
  }
}

export function openContextModal() {
  const els = getEls();
  if (!els.contextModal) return;
  els.contextModal.removeAttribute('hidden');
  document.body?.classList.add('modal-open');
  const area = els.contextText || document.getElementById('context-text');
  if (area) area.focus();
}

export function openSetupGuideModal() {
  const modal = document.getElementById('setup-guide-modal');
  if (modal) {
    modal.removeAttribute('hidden');
    document.body?.classList.add('modal-open');
  }
}

export function closeModal() {
  const els = getEls();
  const setupModal = document.getElementById('setup-guide-modal');
  [els.settingsModal, els.contextModal, setupModal].forEach(modal => {
    if (modal) modal.setAttribute('hidden', 'true');
  });
  document.body?.classList.remove('modal-open');
  focusInput();
}

export function isModalOpen() {
  const modals = document.querySelectorAll('.modal:not([hidden])');
  return modals.length > 0;
}

export function setSetupGuideContent(html) {
  const content = document.getElementById('setup-content');
  if (content) content.innerHTML = html;
}

function getAPIName(api) {
  if (api.flag.includes('prompt-api')) return 'Prompt API (Gemini Nano)';
  if (api.flag.includes('translation-api')) return 'Translation API';
  if (api.flag.includes('language-detection')) return 'Language Detection API';
  if (api.flag.includes('summarization')) return 'Summarization API';
  if (api.flag.includes('rewriter')) return 'Rewriter API';
  return 'Unknown API';
}

export function renderSetupGuide(status) {
  let html = '';

  if (!status.browserInfo.isChrome) {
    html += `<div class="setup-section error">
      <h3>❌ Unsupported Browser</h3>
      <p>Chrome Built-in AI APIs are only available in Google Chrome.</p>
      <p><strong>Your browser:</strong> ${escapeHtml(navigator.userAgent)}</p>
    </div>`;
    setSetupGuideContent(html);
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

  html += '<div class="setup-section"><h3>Required APIs</h3>';

  status.requiredAPIs.forEach(api => {
    const statusIcon = api.available ? '✅' : '❌';
    const statusClass = api.available ? 'success' : 'error';

    html += `<div class="api-item ${statusClass}">
      <div class="api-header">
        <span class="api-icon">${statusIcon}</span>
        <div style="flex: 1;">
          <div class="api-name">${getAPIName(api)}</div>
          <div class="api-status">${escapeHtml(api.message)}</div>
        </div>
      </div>`;

    if (!api.available) {
      html += `<div class="api-instructions">
        <p><strong>To enable:</strong></p>
        <ol>
          <li>Copy this flag: <code class="flag-url">${escapeHtml(api.flag)}</code></li>
          <li>Paste it into your Chrome address bar</li>
          <li>Set to: <strong>${escapeHtml(api.flagValue)}</strong></li>
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
          <div class="api-status">${escapeHtml(api.message)}</div>
        </div>
      </div>`;

    if (!api.available && api.fallback) {
      html += `<div class="api-info">
        <p><strong>Fallback:</strong> ${escapeHtml(api.fallback)}</p>
      </div>`;
    }

    if (!api.available) {
      html += `<div class="api-instructions collapsed">
        <p><strong>To enable (optional):</strong></p>
        <ol>
          <li>Flag: <code class="flag-url">${escapeHtml(api.flag)}</code></li>
          <li>Set to: <strong>${escapeHtml(api.flagValue)}</strong></li>
        </ol>
      </div>`;
    }

    html += '</div>';
  });

  html += '</div>';

  html += `<div class="setup-footer">
    <p><strong>After changing flags:</strong> Chrome will show a "Relaunch" button. Click it to restart Chrome and apply changes.</p>
    <p><strong>Having issues?</strong> Make sure you have:</p>
    <ul>
      <li>At least 22 GB free disk space</li>
      <li>GPU with 4+ GB VRAM or CPU with 16GB RAM</li>
      <li>Unmetered internet connection for model downloads</li>
    </ul>
  </div>`;

  setSetupGuideContent(html);
}



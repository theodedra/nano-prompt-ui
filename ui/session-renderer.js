import { getEls } from './core.js';

let sessionSearchTerm = '';
let editingInputRef = null;

export function renderSessions({
  sessions = {},
  sessionMeta = {},
  currentSessionId = null,
  matches = [],
  searchTerm = '',
  currentTitle = '',
  confirmingId = null,
  editingId = null
} = {}) {
  const els = getEls();
  if (!els.sessionMenu) return;

  sessionSearchTerm = searchTerm || '';

  // Keep the search box stable across renders
  if (els.sessionSearch && els.sessionSearch.value !== sessionSearchTerm) {
    els.sessionSearch.value = sessionSearchTerm;
  }

  // Remove any previously rendered session rows (preserve search input)
  els.sessionMenu.querySelectorAll('.session-row, .session-empty').forEach(row => row.remove());

  if (els.sessionTrigger) {
    els.sessionTrigger.textContent = currentTitle || 'Untitled Session';
  }

  const fragment = document.createDocumentFragment();

  if (matches.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'session-empty';
    empty.textContent = 'No sessions found';
    fragment.appendChild(empty);
  }

  matches.forEach(id => {
    // Use metadata if available (lazy loading), otherwise full session
    const session = sessions[id] || sessionMeta[id];
    if (!session) return;

    const isEditing = id === editingId;

    const row = document.createElement('li');
    row.className = 'session-row';
    if (id === currentSessionId) row.classList.add('is-active');
    if (isEditing) row.classList.add('is-editing');
    row.dataset.id = id;

    const info = document.createElement('div');
    info.className = 'session-info';

    if (isEditing) {
      // Inline rename input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'session-rename-input';
      input.value = session.title || '';
      input.dataset.id = id;
      input.setAttribute('aria-label', 'Rename session');
      input.setAttribute('autocomplete', 'off');
      info.appendChild(input);

      editingInputRef = input;

      const titleDiv = document.createElement('div');
      titleDiv.className = 'session-title';
      titleDiv.textContent = session.title || 'Untitled';
      info.appendChild(titleDiv);
    } else {
      const titleDiv = document.createElement('div');
      titleDiv.className = 'session-title';
      titleDiv.textContent = session.title || 'Untitled';
      info.appendChild(titleDiv);
    }

    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = isEditing ? 'session-rename-actions' : 'session-actions';

    if (isEditing) {
      const saveBtn = document.createElement('button');
      saveBtn.className = 'action-btn save';
      saveBtn.textContent = '✓';
      saveBtn.title = 'Save';
      saveBtn.dataset.id = id;
      saveBtn.dataset.action = 'save-rename';
      actions.appendChild(saveBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'action-btn cancel';
      cancelBtn.textContent = '✕';
      cancelBtn.title = 'Cancel';
      cancelBtn.dataset.id = id;
      cancelBtn.dataset.action = 'cancel-rename';
      actions.appendChild(cancelBtn);
    } else {
      const editBtn = document.createElement('button');
      editBtn.className = 'action-btn edit';
      editBtn.textContent = '✎';
      editBtn.title = 'Rename';
      editBtn.dataset.id = id;
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn delete';
      delBtn.dataset.id = id;

      if (id === confirmingId) {
        delBtn.classList.add('is-confirming');
        delBtn.textContent = '✓';
        delBtn.title = 'Confirm Delete';
      } else {
        delBtn.textContent = '✕';
        delBtn.title = 'Delete';
      }
      actions.appendChild(delBtn);
    }

    row.appendChild(actions);
    fragment.appendChild(row);
  });

  els.sessionMenu.appendChild(fragment);

  // Focus the input after DOM is updated
  if (editingInputRef && editingId) {
    requestAnimationFrame(() => {
      if (editingInputRef) {
        editingInputRef.focus();
        editingInputRef.select();
      }
    });
  }
}

export function setSessionSearchTerm(value) {
  const els = getEls();
  sessionSearchTerm = value || '';
  if (els.sessionSearch && els.sessionSearch.value !== sessionSearchTerm) {
    els.sessionSearch.value = sessionSearchTerm;
  }
}

export function getSessionSearchTerm() {
  return sessionSearchTerm;
}


import { getEls, getSessionVirtualScroller, setSessionVirtualScroller } from './core.js';
import { uiState } from './state.js';
import { VirtualScroller } from '../virtual-scroll.js';

let editingInputRef = null;

/**
 * Create a session row element
 * @param {Object} sessionData - Session data object with id, session, currentSessionId, confirmingId, editingId
 * @param {number} index - Index in the list
 * @returns {HTMLElement} The session row element
 */
function createSessionRowElement({ id, session, currentSessionId, confirmingId, editingId }, index) {
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
  return row;
}

/**
 * Get session ID for virtual scroller
 */
function getSessionId(sessionData, index) {
  return sessionData?.id || `session-${index}`;
}

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

  uiState.sessionSearchTerm = searchTerm || '';

  // Keep the search box stable across renders
  if (els.sessionSearch && els.sessionSearch.value !== uiState.sessionSearchTerm) {
    els.sessionSearch.value = uiState.sessionSearchTerm;
  }

  if (els.sessionTrigger) {
    els.sessionTrigger.textContent = currentTitle || 'Untitled Session';
  }

  // Store search input to preserve it during virtual scrolling
  const searchInput = els.sessionSearch?.parentElement;

  // Prepare session data array for rendering
  const sessionDataArray = matches
    .map(id => {
      const session = sessions[id] || sessionMeta[id];
      if (!session) return null;
      return { id, session, currentSessionId, confirmingId, editingId };
    })
    .filter(Boolean);

  // Threshold for enabling virtual scrolling (50+ sessions)
  const SESSION_VIRTUAL_SCROLL_THRESHOLD = 50;
  const shouldUseVirtualScroll = sessionDataArray.length >= SESSION_VIRTUAL_SCROLL_THRESHOLD;

  // Initialize virtual scroller if needed
  let sessionScroller = getSessionVirtualScroller();
  if (!sessionScroller && els.sessionMenu) {
    // Create render callback that uses the current render context
    const renderSessionItem = (sessionData, index) => {
      return createSessionRowElement(sessionData, index);
    };

    // Override getMessageId to use session IDs and calibrateItemHeight for session rows
    class SessionVirtualScroller extends VirtualScroller {
      constructor(container, renderItemCallback) {
        super(container, renderItemCallback);
        this.searchInput = null;
      }

      getMessageId(sessionData, index) {
        return getSessionId(sessionData, index);
      }

      calibrateItemHeight() {
        const items = this.container.querySelectorAll('.session-row');
        if (items.length === 0) return;

        let totalHeight = 0;
        items.forEach(item => {
          totalHeight += item.offsetHeight;
        });

        this.itemHeight = Math.ceil(totalHeight / items.length);
      }

      render(messagesArg = this.messages) {
        // Store search input before rendering
        if (!this.searchInput) {
          this.searchInput = this.container.querySelector('.session-search');
        }

        // Call parent render
        super.render(messagesArg);

        // Restore search input at the top
        if (this.searchInput && this.container.firstChild !== this.searchInput) {
          this.container.insertBefore(this.searchInput, this.container.firstChild);
        }
      }

      reset() {
        super.reset();
        this.searchInput = null;
      }
    }

    sessionScroller = new SessionVirtualScroller(els.sessionMenu, renderSessionItem);
    // Set a smaller item height for session rows (they're typically smaller than messages)
    sessionScroller.itemHeight = 50;
    setSessionVirtualScroller(sessionScroller);
  }

  // Handle empty state
  if (sessionDataArray.length === 0) {
    // Remove any previously rendered session rows (preserve search input)
    els.sessionMenu.querySelectorAll('.session-row, .session-empty').forEach(row => row.remove());
    
    if (sessionScroller && sessionScroller.enabled) {
      sessionScroller.disable();
    }

    const empty = document.createElement('li');
    empty.className = 'session-empty';
    empty.textContent = 'No sessions found';
    
    // Preserve search input
    if (searchInput && !els.sessionMenu.contains(searchInput)) {
      els.sessionMenu.appendChild(searchInput);
    }
    els.sessionMenu.appendChild(empty);
    return;
  }

  // Use virtual scrolling for large session lists
  if (sessionScroller && shouldUseVirtualScroll) {
    // Enable virtual scrolling if not already enabled
    if (!sessionScroller.enabled) {
      sessionScroller.enable();
      setTimeout(() => sessionScroller.calibrateItemHeight(), 100);
    }
    
    sessionScroller.setMessages(sessionDataArray);
    
    // Ensure search input is in the container before rendering
    if (searchInput && !els.sessionMenu.contains(searchInput)) {
      els.sessionMenu.insertBefore(searchInput, els.sessionMenu.firstChild);
    }
    
    sessionScroller.render(sessionDataArray);
  } else {
    // Normal rendering for small session lists
    if (sessionScroller && sessionScroller.enabled) {
      sessionScroller.disable();
    }

    // Remove any previously rendered session rows (preserve search input)
    els.sessionMenu.querySelectorAll('.session-row, .session-empty').forEach(row => row.remove());

    const fragment = document.createDocumentFragment();

    sessionDataArray.forEach((sessionData, index) => {
      const row = createSessionRowElement(sessionData, index);
      fragment.appendChild(row);
    });

    // Preserve search input
    if (searchInput && !els.sessionMenu.contains(searchInput)) {
      els.sessionMenu.insertBefore(searchInput, els.sessionMenu.firstChild);
    }
    els.sessionMenu.appendChild(fragment);
  }

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
  uiState.sessionSearchTerm = value || '';
  if (els.sessionSearch && els.sessionSearch.value !== uiState.sessionSearchTerm) {
    els.sessionSearch.value = uiState.sessionSearchTerm;
  }
}

export function getSessionSearchTerm() {
  return uiState.sessionSearchTerm;
}



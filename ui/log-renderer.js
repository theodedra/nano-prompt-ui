import { formatTime, markdownToHtml } from '../utils/utils.js';
import { VirtualScroller } from '../utils/virtual-scroll.js';
import { formatPdfTruncationNote } from './attachment-renderer.js';
import {
  getEls,
  getChatCardEl,
  getWrapEl,
  getScrollObserver,
  getVirtualScroller,
  setExportAvailability
} from './core.js';

let renderedSessionId = null;

function scrollToBottom() {
  const els = getEls();
  if (!els.log) return;
  els.log.scrollTop = els.log.scrollHeight;
}

function observeLastMessage() {
  const scrollObserver = getScrollObserver();
  const els = getEls();
  if (!scrollObserver || !els.log) return;

  scrollObserver.disconnect();

  const lastMsg = els.log.lastElementChild;
  if (lastMsg) {
    scrollObserver.observe(lastMsg);
  }

  scrollToBottom();
}

function createMessageActions(msg, idx) {
  const actions = document.createElement('div');
  actions.className = 'copy1';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.dataset.idx = idx;
  copyBtn.className = 'bubble-copy';
  actions.appendChild(copyBtn);

  if (msg.role === 'ai') {
    const speak = document.createElement('button');
    speak.textContent = '🔊';
    speak.dataset.idx = idx;
    speak.className = 'speak';
    actions.appendChild(speak);
  }
  return actions;
}

export function buildSmartReplyRow(replies = []) {
  if (!replies || replies.length === 0) return null;

  const container = document.createElement('div');
  container.className = 'smart-replies';

  const label = document.createElement('div');
  label.className = 'smart-replies-label';
  label.textContent = 'Smart suggestions';
  container.appendChild(label);

  const list = document.createElement('div');
  list.className = 'smart-reply-list';
  replies.forEach((reply) => {
    if (!reply) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'smart-reply-btn tonal';
    btn.dataset.reply = reply;
    btn.textContent = reply;
    list.appendChild(btn);
  });

  container.appendChild(list);
  return container;
}

export function createMessageElement(m, idx) {
  const div = document.createElement('div');
  div.className = `msg ${m.role}`;

  const header = document.createElement('div');
  header.className = 'msg-header';

  const label = document.createElement('span');
  label.className = 'sender-label';
  label.textContent = m.role === 'user' ? 'You' : 'Nano';
  header.appendChild(label);

  const time = document.createElement('time');
  time.textContent = formatTime(m.ts);
  header.appendChild(time);
  div.appendChild(header);

  const body = document.createElement('div');
  body.className = 'body';

  // Show loading dots for empty AI messages
  if (m.role === 'ai' && (!m.text || m.text.trim() === '')) {
    body.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  } else {
    // Use pre-cached HTML if available, otherwise parse markdown
    body.innerHTML = m.htmlCache || markdownToHtml(m.text || '');
  }
  div.appendChild(body);

  if (m.attachments?.length) {
    const attachmentSection = document.createElement('div');
    attachmentSection.className = 'message-attachments';

    const attachLabel = document.createElement('div');
    attachLabel.className = 'attachment-label';
    attachLabel.textContent = 'Attached to this message';
    attachmentSection.appendChild(attachLabel);

    const att = document.createElement('ul');
    att.className = 'attachment-list persisted-attachments';
    m.attachments.forEach(file => {
      const chip = document.createElement('li');
      chip.className = 'attachment-chip';
      chip.textContent = file.name;
      const note = formatPdfTruncationNote(file);
      if (note) {
        const noteEl = document.createElement('div');
        noteEl.className = 'attachment-note';
        noteEl.textContent = note;
        chip.appendChild(noteEl);
      }
      att.appendChild(chip);
    });

    attachmentSection.appendChild(att);
    div.appendChild(attachmentSection);
  }

  const smartRepliesRow = buildSmartReplyRow(m.smartReplies);
  if (smartRepliesRow) {
    div.appendChild(smartRepliesRow);
  }

  const actions = createMessageActions(m, idx);
  div.appendChild(actions);

  // ---------------------------------------------------------
  // ⚡️ PERFORMANCE & UX FIX: Throttled Hover Logic
  // ---------------------------------------------------------
  
  let lastMeasure = 0;

  // We measure freshly, but only once every 100ms.
  // This solves the stale cache issue (scrolling/resizing works now)
  // while keeping CPU usage very low compared to raw mousemove.
  div.addEventListener('mousemove', (e) => {
    const now = Date.now();
    if (now - lastMeasure < 100) return; // Skip update if too soon
    
    lastMeasure = now;
    const rect = div.getBoundingClientRect();
    
    // Check if mouse is in bottom half
    // e.clientY is viewport relative, rect.top is viewport relative
    const relativeY = e.clientY - rect.top;
    const halfHeight = rect.height / 2;

    if (relativeY > halfHeight) {
      if (!actions.classList.contains('bottom')) {
        actions.classList.add('bottom');
      }
    } else {
      if (actions.classList.contains('bottom')) {
        actions.classList.remove('bottom');
      }
    }
  });

  return div;
}

/**
 * Render the full chat log for a session.
 * NOT used during streaming - use updateLastMessageBubble() for that.
 */
export function renderLog(session) {
  const els = getEls();
  const chatCardEl = getChatCardEl();
  const wrapEl = getWrapEl();
  const virtualScroller = getVirtualScroller();

  if (!session || !els.log) return;

  if (renderedSessionId !== session.id) {
    els.log.innerHTML = '';
    renderedSessionId = session.id;
    if (virtualScroller) {
      if (virtualScroller.enabled) {
        virtualScroller.disable();
      } else {
        virtualScroller.reset();
      }
    }
  }

  const messages = session.messages || [];

  // Centralized state: toggle is-empty on chat card container
  if (chatCardEl) chatCardEl.classList.toggle('is-empty', messages.length === 0);

  // Toggle ready bubble visibility above textbox
  if (wrapEl) wrapEl.classList.toggle('show-ready-bubble', messages.length === 0);

  // Handle Empty State - clear log and show ready bubble
  if (messages.length === 0) {
    els.log.innerHTML = '';
    setExportAvailability(false);
    return;
  }

  // Enable virtual scrolling for large message counts
  if (virtualScroller && VirtualScroller.shouldEnable(messages.length)) {
    virtualScroller.setMessages(messages);
    if (!virtualScroller.enabled) {
      virtualScroller.enable();
      setTimeout(() => virtualScroller.calibrateItemHeight(), 100);
    }
    virtualScroller.render(messages);
    setExportAvailability(true);
    return;
  }

  // Normal rendering for small message counts
  const existingCount = els.log.querySelectorAll('.msg:not(.placeholder)').length;

  if (existingCount < messages.length) {
    const fragment = document.createDocumentFragment();
    for (let i = existingCount; i < messages.length; i++) {
      fragment.appendChild(createMessageElement(messages[i], i));
    }
    els.log.appendChild(fragment);
  } else if (existingCount > messages.length) {
    els.log.innerHTML = '';
    const fragment = document.createDocumentFragment();
    messages.forEach((m, i) => fragment.appendChild(createMessageElement(m, i)));
    els.log.appendChild(fragment);
  }

  setExportAvailability(true);
  observeLastMessage();
}

export function renderSmartReplies(replies = []) {
  const els = getEls();
  if (!els.log) return;

  // Remove any existing suggested rows to avoid stale content
  els.log.querySelectorAll('.smart-replies').forEach((el) => el.remove());

  if (!replies || replies.length === 0) return;

  const aiMessages = els.log.querySelectorAll('.msg.ai');
  const lastAi = aiMessages[aiMessages.length - 1];
  if (!lastAi) return;

  const row = buildSmartReplyRow(replies);
  if (!row) return;

  lastAi.appendChild(row);
  observeLastMessage();
}

/**
 * Update the last AI message bubble with new content.
 * Used for streaming updates - does NOT re-render the full log.
 */
export function updateLastMessageBubble(session, markdownText, { streaming = false } = {}) {
  const els = getEls();
  const virtualScroller = getVirtualScroller();

  if (!els.log || !session || !session.messages?.length) return;

  const lastIdx = session.messages.length - 1;
  const lastMessage = session.messages[lastIdx];
  let lastMsg = null;

  // VirtualScroller path: O(1) lookup via cached node map
  if (virtualScroller && virtualScroller.enabled) {
    lastMsg = virtualScroller.getMessageNode(lastMessage, lastIdx);
  } else {
    // Fallback: DOM query (only for small sessions where virtual scroll is disabled)
    const messages = els.log.querySelectorAll('.msg:not(.placeholder)');
    lastMsg = messages[messages.length - 1];
  }

  if (!lastMsg || !lastMsg.classList.contains('ai')) {
    if (!streaming) renderLog(session);
    return;
  }

  const body = lastMsg.querySelector('.body');

  const hasContent = markdownText && markdownText.trim() !== '';
  if (!hasContent) {
    const dotsHtml = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    if (body.innerHTML !== dotsHtml) {
      body.innerHTML = dotsHtml;
      body.dataset.renderMode = 'loading';
    }
    return;
  }

  if (streaming) {
    // Fast path: skip content comparison since throttle limits update frequency
    body.textContent = markdownText;
    body.dataset.renderMode = 'plain';
    return;
  }

  const newHtml = markdownToHtml(markdownText);
  if (body.dataset.renderMode !== 'markdown' || body.innerHTML !== newHtml) {
    body.innerHTML = newHtml;
    body.dataset.renderMode = 'markdown';
  }
}

// Export for use in other modules
export { scrollToBottom, observeLastMessage };
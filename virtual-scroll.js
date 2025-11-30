// virtual-scroll.js - Virtual scrolling implementation for chat log
// Only renders visible messages + buffer for performance with large chat histories

/**
 * Virtual scroll manager for chat log
 */
export class VirtualScroller {
  constructor(container, renderItemCallback) {
    this.container = container;
    this.renderItem = renderItemCallback;
    this.messages = [];
    this.itemHeight = 100; // Estimated average message height
    this.buffer = 5; // Number of items to render above/below viewport
    this.enabled = false;
    this.lastScrollTop = 0;
    this.scrollTimeout = null;
    this.messageNodes = new Map(); // messageId -> DOM node cache
    this.topSpacer = null;
    this.bottomSpacer = null;
    this.lastMessageCount = 0;
    this.currentRange = { start: 0, end: 0 };

    // Scroll handler with debouncing
    this.handleScroll = this.handleScroll.bind(this);
  }

  /**
   * Enable virtual scrolling
   * Only enable when message count exceeds threshold
   */
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.container.addEventListener('scroll', this.handleScroll);
  }

  /**
   * Disable virtual scrolling
   * Fall back to normal rendering for small lists
   */
  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.container.removeEventListener('scroll', this.handleScroll);
    this.reset();
  }

  /**
   * Handle scroll events with debouncing
   */
  handleScroll() {
    clearTimeout(this.scrollTimeout);
    this.scrollTimeout = setTimeout(() => {
      this.render();
    }, 100); // Debounce scroll events
  }

  /**
   * Provide the messages to render.
   * @param {Array} messages
   */
  setMessages(messages = []) {
    this.messages = Array.isArray(messages) ? messages : [];
  }

  /**
   * Calculate which items should be visible
   * @returns {{start: number, end: number}}
   */
  getVisibleRange(totalItems) {
    const scrollTop = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;

    const firstVisible = Math.floor(scrollTop / this.itemHeight);
    const lastVisible = Math.ceil((scrollTop + viewportHeight) / this.itemHeight);

    // Add buffer above and below
    const start = Math.max(0, firstVisible - this.buffer);
    const end = Math.min(totalItems, lastVisible + this.buffer);

    return { start, end };
  }

  /**
   * Render only visible items
   */
  render(messagesArg = this.messages) {
    const messages = Array.isArray(messagesArg) ? messagesArg : [];
    this.messages = messages;
    const totalHeight = messages.length * this.itemHeight;

    // Set container height to maintain scroll position
    this.container.style.height = `${totalHeight}px`;
    this.container.style.position = 'relative';

    const { start, end } = this.getVisibleRange(messages.length);

    // Cache spacer elements to avoid recreating them
    if (!this.topSpacer) {
      this.topSpacer = document.createElement('div');
      this.topSpacer.className = 'virtual-spacer-top';
    }
    if (!this.bottomSpacer) {
      this.bottomSpacer = document.createElement('div');
      this.bottomSpacer.className = 'virtual-spacer-bottom';
    }

    // Create document fragment for batch DOM update
    const nodes = [];

    // Create spacer for items above viewport
    if (start > 0) {
      this.topSpacer.style.height = `${start * this.itemHeight}px`;
      nodes.push(this.topSpacer);
    }

    // Render visible items
    for (let i = start; i < end; i++) {
      const message = messages[i];
      const key = this.getMessageId(message, i);
      let element = this.messageNodes.get(key);
      if (!element) {
        element = this.renderItem(message, i);
        element.style.position = 'relative';
        element.dataset.messageId = key;
        this.messageNodes.set(key, element);
      }
      nodes.push(element);
    }

    // Create spacer for items below viewport
    if (end < messages.length) {
      this.bottomSpacer.style.height = `${(messages.length - end) * this.itemHeight}px`;
      nodes.push(this.bottomSpacer);
    }

    // Replace container contents without recreating cached nodes
    this.container.replaceChildren(...nodes);
    this.currentRange = { start, end };
    this.pruneStaleNodes(messages);
  }

  /**
   * Update estimated item height based on actual measurements
   * Call this after first render to get accurate heights
   */
  calibrateItemHeight() {
    const items = this.container.querySelectorAll('.msg');
    if (items.length === 0) return;

    let totalHeight = 0;
    items.forEach(item => {
      totalHeight += item.offsetHeight;
    });

    this.itemHeight = Math.ceil(totalHeight / items.length);
  }

  /**
   * Scroll to bottom (for new messages)
   */
  scrollToBottom() {
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Clear cached nodes (e.g., on session switch)
   */
  reset() {
    this.messageNodes.clear();
    this.currentRange = { start: 0, end: 0 };
    this.lastMessageCount = 0;
    this.topSpacer = null;
    this.bottomSpacer = null;
  }

  /**
   * Get a stable identifier for a message
   * Falls back to index when no id exists
   */
  getMessageId(message, index) {
    if (!message) return `msg-${index}`;
    const key = message.messageId || message.id || message.ts || `msg-${index}`;
    if (!message.messageId) {
      message.messageId = key;
    }
    return key;
  }

  /**
   * Retrieve or create a DOM node for a message without forcing a rerender
   * Useful for streaming updates on the last message
   */
  getMessageNode(message, index) {
    const key = this.getMessageId(message, index);
    let node = this.messageNodes.get(key);
    if (node) return node;
    node = this.renderItem(message, index);
    node.style.position = 'relative';
    node.dataset.messageId = key;
    this.messageNodes.set(key, node);
    return node;
  }

  /**
   * Remove cached nodes for messages that no longer exist
   */
  pruneStaleNodes(messages) {
    if (this.messageNodes.size === 0) return;
    if (messages.length >= this.lastMessageCount && this.messageNodes.size <= messages.length + 5) {
      this.lastMessageCount = messages.length;
      return;
    }

    const validKeys = new Set();
    messages.forEach((msg, idx) => validKeys.add(this.getMessageId(msg, idx)));
    for (const key of this.messageNodes.keys()) {
      if (!validKeys.has(key)) {
        this.messageNodes.delete(key);
      }
    }
    this.lastMessageCount = messages.length;
  }

  /**
   * Check if virtual scrolling should be enabled
   * @param {number} itemCount - Number of items in list
   * @returns {boolean}
   */
  static shouldEnable(itemCount) {
    // Enable virtual scrolling for lists with 200+ messages
    // Below this threshold, normal rendering is fine
    return itemCount >= 200;
  }
}

/**
 * Create a virtual scroller instance for the chat log
 * @param {HTMLElement} container - Log container element
 * @param {Function} renderCallback - Function to render a single message
 * @returns {VirtualScroller}
 */
export function createVirtualScroller(container, renderCallback) {
  return new VirtualScroller(container, renderCallback);
}

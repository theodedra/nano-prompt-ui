// virtual-scroll.js - Virtual scrolling implementation for chat log
// Only renders visible messages + buffer for performance with large chat histories

import { getCurrentSessionSync } from './storage.js';

/**
 * Virtual scroll manager for chat log
 */
export class VirtualScroller {
  constructor(container, renderItemCallback) {
    this.container = container;
    this.renderItem = renderItemCallback;
    this.itemHeight = 100; // Estimated average message height
    this.buffer = 5; // Number of items to render above/below viewport
    this.enabled = false;
    this.lastScrollTop = 0;
    this.scrollTimeout = null;

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
  render() {
    const session = getCurrentSessionSync();
    if (!session) return;

    const messages = session.messages;
    const totalHeight = messages.length * this.itemHeight;

    // Set container height to maintain scroll position
    this.container.style.height = `${totalHeight}px`;
    this.container.style.position = 'relative';

    const { start, end } = this.getVisibleRange(messages.length);

    // Create document fragment for batch DOM update
    const fragment = document.createDocumentFragment();

    // Create spacer for items above viewport
    if (start > 0) {
      const topSpacer = document.createElement('div');
      topSpacer.style.height = `${start * this.itemHeight}px`;
      topSpacer.className = 'virtual-spacer-top';
      fragment.appendChild(topSpacer);
    }

    // Render visible items
    for (let i = start; i < end; i++) {
      const element = this.renderItem(messages[i], i);
      element.style.position = 'relative';
      fragment.appendChild(element);
    }

    // Create spacer for items below viewport
    if (end < messages.length) {
      const bottomSpacer = document.createElement('div');
      bottomSpacer.style.height = `${(messages.length - end) * this.itemHeight}px`;
      bottomSpacer.className = 'virtual-spacer-bottom';
      fragment.appendChild(bottomSpacer);
    }

    // Replace container contents
    this.container.innerHTML = '';
    this.container.appendChild(fragment);
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

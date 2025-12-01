// constants.js - Centralized configuration and constants

// ============================================================================
// TIMING CONSTANTS
// ============================================================================

export const TIMING = {
  // Context caching and refresh
  CONTEXT_CACHE_MS: 15_000,           // How long to cache context before refresh
  TAB_UPDATE_DEBOUNCE_MS: 300,        // Debounce for tab switch/update events

  // Network timeouts
  IMAGE_FETCH_TIMEOUT_MS: 5_000,      // Timeout for image download
  PANEL_READY_DELAY_MS: 1_000,        // Delay before sending queued actions to panel

  // UI feedback
  TOAST_DURATION_MS: 2_500,           // How long to show toast messages
  TOAST_ANIMATION_MS: 300,            // Toast animation duration
  DELETE_CONFIRM_TIMEOUT_MS: 3_000,   // Time to confirm session deletion
  MIC_SETUP_DELAY_MS: 500,            // Delay before auto-triggering mic on setup

  // Model warmup
  WARMUP_DELAY_MS: 0,                 // Delay before model warmup (0 = immediate)

  // Storage persistence
  SAVE_STATE_DEBOUNCE_MS: 500,        // Debounce for IndexedDB writes to avoid thrash
};

// ============================================================================
// SIZE LIMITS
// ============================================================================

export const LIMITS = {
  // Token and context limits
  MAX_CONTEXT_TOKENS: 3_000,          // Reserve space for system prompt + user query
  TOKEN_TO_CHAR_RATIO: 4,             // Approximate: 1 token ≈ 4 characters

  // Token budgets for prompt building (Gemini Nano ~32k context)
  TOTAL_TOKEN_BUDGET: 28_000,         // Leave headroom below 32k limit
  SYSTEM_PROMPT_BUDGET: 500,          // Budget for system prompt/rules
  CONTEXT_BUDGET: 6_000,              // Budget for page context
  HISTORY_BUDGET: 18_000,             // Budget for conversation history (sliding window)
  USER_QUERY_BUDGET: 2_000,           // Budget for current user query
  ATTACHMENT_BUDGET: 1_500,           // Budget for attachment text content

  // Image processing
  IMAGE_MAX_WIDTH: 1_024,             // Max width for uploaded images
  IMAGE_MAX_WIDTH_DESCRIPTION: 512,   // Max width for image description
  IMAGE_QUALITY: 0.7,                 // JPEG compression quality (0-1)
  MAX_ATTACHMENTS: 3,                 // Max number of attachments per message

  // PDF processing
  PDF_MAX_PAGES: 50,                  // Maximum pages to extract from PDF
  PDF_MAX_CHARS: 50_000,              // Maximum characters to extract from PDF (~12,500 tokens)

  // Storage
  MAX_SESSIONS: 100,                  // Maximum number of sessions to keep
  MIN_TEXT_LENGTH: 2,                 // Minimum text length for content scraping

  // Context truncation
  TRUNCATE_CLEAN_CUT_THRESHOLD: 0.8,  // If period is within last 20%, cut there

  // UI
  SHORT_QUERY_THRESHOLD: 60,          // Queries under this length might not need context

  // Title generation
  TITLE_MAX_LENGTH: 50,               // Maximum length for auto-generated titles
  TITLE_GENERATION_MAX_CHARS: 500,    // Max chars from conversation to use for title generation
};

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

export const MODEL_CONFIG = {
  expectedInputs: [
    { type: 'text', languages: ['en'] },
    { type: 'image' }  // Multimodal support for image analysis
  ],
  expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
};

export const DEFAULT_SETTINGS = {
  temperature: 1.0,  // Default creativity level (0.0-2.0, 1.0 is balanced)
  topK: 64,          // Default diversity setting (1-128, 64 is balanced)
  systemPrompt: 'You are a helpful assistant. Provide thorough, detailed responses.',
  tone: 'balanced',
  language: 'en',    // Default language: English (en, es, ja supported)
  theme: 'auto'      // Theme preference: 'auto' (system), 'dark', or 'light'
};

/**
 * Get a setting value with fallback to default
 * @param {Object} settings - Settings object
 * @param {string} key - Setting key
 * @returns {*} Setting value or default
 */
export function getSettingOrDefault(settings, key) {
  return settings?.[key] ?? DEFAULT_SETTINGS[key];
}

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

export const ASSISTANT_RULES = `You run inside a Chrome extension side panel.
You have access to the active tab's text content AND the conversation history.
If the user asks about a previous topic or summary, LOOK AT THE CHAT HISTORY.
Do not mention browsing limitations.
Keep answers concise but helpful.`;

// Title generation prompt for auto-naming chat sessions
export const TITLE_GENERATION_PROMPT = `Based on the following conversation, generate a concise, descriptive title (3-6 words max).
The title should capture the main topic or question.
Return ONLY the title, nothing else. No quotes, no punctuation at the end.

Conversation:
{conversation}

Title:`;

// ============================================================================
// STORAGE KEYS
// ============================================================================

export const STORAGE_KEYS = {
  SYNC: 'nanoPromptUI.settings.v1',      // Chrome sync storage for settings
  SESSION_DRAFT: 'nanoPromptUI.draft',   // Session storage for context draft
  DB_NAME: 'NanoPromptDB',               // IndexedDB database name
  DB_VERSION: 2,                         // IndexedDB version
  STORES: {
    SESSIONS: 'sessions',
    META: 'meta',
    ATTACHMENTS: 'attachments'
  }
};

// ============================================================================
// UI CONSTANTS
// ============================================================================

export const UI_MESSAGES = {
  // Status messages
  CHECKING: 'checking…',
  READY: 'Ready',
  THINKING: 'Thinking...',
  SYSTEM_PAGE: 'System Page',
  PAGE_MODE: 'Page-Mode',

  // Context states
  READING_TAB: 'Reading tab...',
  ANALYZING_IMAGE: 'Analyzing Image...',
  OPTIMIZING: 'Optimizing...',

  // Placeholders
  INPUT_PLACEHOLDER: 'Ask anything… (Shift+Enter for newline)',
  INPUT_PLACEHOLDER_DISABLED: 'AI disabled on system pages',
  CONTEXT_PLACEHOLDER: 'Context will appear here...',

  // Errors
  ERROR: 'Error',
  ERROR_PAGE_CONTENT: '[Error: Could not read page. Refresh the tab.]',
  ERROR_IMAGE_GENERIC: 'Could not process image',
  ERROR_QUOTA_EXCEEDED: 'Storage quota exceeded. Please delete old sessions.',

  // Success messages
  COPIED: 'Copied!',
  WARMUP_SUCCESS: 'Nano Prompt: Warmup successful.',

  // Confirmations
  CONFIRM_DELETE: 'Confirm Delete',
  RENAME_CHAT: 'Rename chat',

  // States
  STOPPED: '*(stopped)*',
  TRUNCATED: '\n\n[...Content truncated due to length...]',
  SYSTEM_PAGE_AI_DISABLED: '[System Page: AI disabled for security.]',
  RESTRICTED_PAGE: '[Error: Could not read page. Refresh the tab.]',
};

// ============================================================================
// UI LABELS
// ============================================================================

export const LANGUAGE_LABELS = {
  'en': 'English',
  'es': 'Español (Spanish)',
  'fr': 'Français (French)',
  'de': 'Deutsch (German)',
  'it': 'Italiano (Italian)',
  'pt': 'Português (Portuguese)',
  'ru': 'Русский (Russian)',
  'zh': '中文 (Chinese)',
  'ja': '日本語 (Japanese)',
  'ko': '한국어 (Korean)',
  'ar': 'العربية (Arabic)',
  'hi': 'हिन्दी (Hindi)'
};

export const LANGUAGE_NAMES = {
  'en': 'English',
  'es': 'Spanish',
  'ja': 'Japanese'
};

export const THEME_LABELS = {
  'auto': 'Auto (System)',
  'dark': 'Dark',
  'light': 'Light'
};

// ============================================================================
// TEMPLATES
// ============================================================================

export const BLANK_TEMPLATE_ID = 'blank';

export const DEFAULT_TEMPLATES = [
  { id: BLANK_TEMPLATE_ID, label: 'Templates…', text: '' },
  { id: 'translator', label: 'Translate text', text: 'Translate the following text to English and explain any idioms:' },
  { id: 'proof', label: 'Proofread', text: 'You are a meticulous proofreader. Improve grammar and clarity for this text:' },
  { id: 'summary', label: 'Summarize', text: 'Summarize the following content in concise bullet points:' },
  { id: 'qa', label: 'Ask expert', text: 'You are an expert researcher. Answer thoroughly:' }
];

// ============================================================================
// VALIDATION & SECURITY
// ============================================================================

export const VALIDATION = {
  // URL protocols
  ALLOWED_PAGE_PROTOCOLS: /^(https?|file):/i,
  ALLOWED_IMAGE_PROTOCOLS: ['http:', 'https:'],
  BLOCKED_URL_SCHEMES: ['javascript:', 'data:', 'file:', 'chrome:', 'edge:', 'about:'],

  // Message roles
  VALID_MESSAGE_ROLES: ['user', 'ai'],

  // HTML sanitization
  ALLOWED_HTML_TAGS: new Set([
    'P', 'BR', 'STRONG', 'EM', 'CODE', 'PRE',
    'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'A', 'SPAN', 'DIV'
  ]),
  ALLOWED_LINK_ATTRIBUTES: ['href', 'target', 'rel'],

  // Content type validation
  IMAGE_CONTENT_TYPE_PREFIX: 'image/',
};

// ============================================================================
// INTENT CLASSIFICATION
// ============================================================================

export const INTENT_PATTERNS = {
  page: /summari|page|article|tab|website|context|window/,
  time: /time|date|today|now/,
  location: /where|location|lat|long/,
};

export const INTENT_TYPES = {
  PAGE: 'page',
  TIME: 'time',
  LOCATION: 'location',
  NONE: 'none'
};

// ============================================================================
// SPEECH SYNTHESIS
// ============================================================================

export const SPEECH = {
  LANGUAGE: 'en-US',

  // Error types that are expected user actions (don't log as errors)
  EXPECTED_ERROR_TYPES: ['canceled', 'interrupted'],

  // Actual error types to log
  ACTUAL_ERROR_TYPES: [
    'audio-busy',
    'audio-hardware',
    'network',
    'synthesis-unavailable',
    'synthesis-failed',
    'language-unavailable',
    'voice-unavailable',
    'text-too-long',
    'invalid-argument'
  ],
};

// ============================================================================
// ICONS (SVG)
// ============================================================================

export const ICONS = {
  MIC: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`,

  STOP: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect></svg>`,
};

// ============================================================================
// ATTACHMENT VALIDATION
// ============================================================================

export const ATTACHMENT = {
  // Allowed MIME types
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ],

  // Maximum file sizes (in bytes)
  MAX_FILE_SIZE_MB: 10,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,  // 10 MB
  MAX_IMAGE_SIZE_BYTES: 5 * 1024 * 1024,  // 5 MB for images
  MAX_PDF_SIZE_BYTES: 10 * 1024 * 1024,   // 10 MB for PDFs
};

/**
 * Validate an attachment file before processing.
 * Checks size, MIME type, and extension. Does NOT check page/char limits
 * (those are enforced during extraction, as they require reading the file).
 *
 * @param {File} file - File to validate
 * @returns {{ valid: boolean, error?: string, fileType?: 'pdf' | 'image' }}
 */
export function validateAttachment(file) {
  if (!file || !(file instanceof File)) {
    return { valid: false, error: 'Invalid file object.' };
  }

  // Determine file type from MIME or extension
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(file.name);

  // Check if file type is supported
  if (!isPdf && !isImage) {
    return { valid: false, error: 'Unsupported file type. Only images and PDFs are supported.' };
  }

  // Validate MIME type is in the allowed list (if provided by browser)
  if (file.type && !ATTACHMENT.ALLOWED_MIME_TYPES.includes(file.type) && !file.type.startsWith('image/')) {
    return { valid: false, error: `Unsupported MIME type: ${file.type}` };
  }

  // Check file size limits
  const maxSize = isPdf ? ATTACHMENT.MAX_PDF_SIZE_BYTES : ATTACHMENT.MAX_IMAGE_SIZE_BYTES;
  const maxSizeLabel = isPdf ? '10 MB' : '5 MB';
  if (file.size > maxSize) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return { valid: false, error: `File too large (${sizeMB} MB). Maximum ${maxSizeLabel} allowed.` };
  }

  return { valid: true, fileType: isPdf ? 'pdf' : 'image' };
}

// ============================================================================
// ERROR MESSAGES FOR USERS
// ============================================================================

export const USER_ERROR_MESSAGES = {
  IMAGE_FETCH_FAILED: 'Could not download image. Please try again or check your connection.',
  IMAGE_INVALID_URL: 'Invalid image URL. Only HTTP/HTTPS images are supported.',
  IMAGE_PROCESSING_FAILED: 'Failed to process image. The image might be too large or corrupted.',
  IMAGE_NOT_SUPPORTED: 'Gemini Nano does not support image analysis in this context. Try using the "Describe image from URL" context menu instead.',

  PDF_PROCESSING_FAILED: 'Failed to process PDF. The file might be corrupted or password-protected.',
  PDF_TOO_LARGE: 'PDF is too large. Maximum 50 pages supported.',

  AI_UNAVAILABLE: 'AI is not available. Please check that Gemini Nano is enabled in chrome://flags',
  AI_SYSTEM_PAGE: 'AI is disabled on system pages for security.',
  AI_SESSION_FAILED: 'Failed to create AI session. Try refreshing the page.',

  STORAGE_QUOTA_EXCEEDED: 'Storage is full! Please delete some old chat sessions.',
  STORAGE_SAVE_FAILED: 'Failed to save. Your changes might not be persisted.',

  CONTEXT_FETCH_FAILED: 'Could not read page content. Try refreshing the tab.',

  SPEECH_NOT_SUPPORTED: 'Speech recognition is not supported in this browser.',
  SPEECH_FAILED: 'Speech recognition failed. Please try again.',

  NETWORK_ERROR: 'Network error. Please check your connection.',
  GENERIC_ERROR: 'Something went wrong. Please try again.',
};

// ============================================================================
// CONSOLE LOG PREFIXES (for easy filtering)
// ============================================================================

export const LOG_PREFIX = {
  INFO: 'Nano Prompt:',
  WARN: 'Nano Prompt [WARN]:',
  ERROR: 'Nano Prompt [ERROR]:',
  DEBUG: 'Nano Prompt [DEBUG]:',
};

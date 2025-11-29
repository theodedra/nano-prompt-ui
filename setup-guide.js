// setup-guide.js - API availability detection and setup guide

/**
 * Helper to get the AI language model API reference
 * In Chrome extensions, the API is exposed as a global LanguageModel class
 */
function getLanguageModelAPI() {
  // In Chrome extensions, the API is a global LanguageModel constructor
  if (typeof LanguageModel !== 'undefined') {
    return LanguageModel;
  }

  // Fallback: try the namespace approach (older/alternative implementations)
  if (typeof self !== 'undefined' && self.ai && self.ai.languageModel) {
    return self.ai.languageModel;
  }
  if (typeof window !== 'undefined' && window.ai && window.ai.languageModel) {
    return window.ai.languageModel;
  }
  if (typeof globalThis !== 'undefined' && globalThis.ai && globalThis.ai.languageModel) {
    return globalThis.ai.languageModel;
  }

  return null;
}

/**
 * Try to actually create a session to verify API works
 * @param {Function} createFn - Async function that creates a session
 * @returns {Promise<boolean>} True if session created successfully
 */
async function tryCreateSession(createFn) {
  try {
    const session = await createFn();
    if (session) {
      session.destroy();
      return true;
    }
  } catch (e) {
    // Session creation failed
  }
  return false;
}

/**
 * Get status message based on availability result
 * @param {string} status - API availability status
 * @param {boolean} actuallyWorks - Whether test session creation succeeded
 * @returns {string} User-friendly status message
 */
function getStatusMessage(status, actuallyWorks) {
  if (status === 'readily' || status === 'available') {
    return 'Ready';
  } else if (status === 'after-download' || status === 'downloadable') {
    return 'Ready (model will download on first use)';
  } else if (actuallyWorks) {
    return 'Ready (Working with current flag setting)';
  } else {
    return 'Not available';
  }
}

/**
 * Check availability of all Chrome AI APIs
 * @returns {Promise<Object>} Availability status for all APIs
 */
export async function checkAllAPIs() {
  const results = {
    // Required API - Only Prompt API is absolutely required!
    promptAPI: await checkPromptAPI(),

    // Optional but recommended for better features
    translationAPI: await checkTranslationAPI(),
    languageDetectionAPI: await checkLanguageDetectionAPI(),
    summarizationAPI: await checkSummarizationAPI(),
    rewriterAPI: await checkRewriterAPI(),

    // Additional info
    browserInfo: getBrowserInfo()
  };

  return results;
}

/**
 * Check Prompt API (Gemini Nano) availability
 */
async function checkPromptAPI() {
  try {
    // Add small delay to ensure APIs are initialized
    await new Promise(resolve => setTimeout(resolve, 100));

    const aiAPI = getLanguageModelAPI();

    if (!aiAPI) {
      return {
        available: false,
        status: 'not-supported',
        message: 'Prompt API not detected - Flag may not be enabled or Chrome needs restart',
        flag: 'chrome://flags/#prompt-api-for-gemini-nano',
        flagValue: 'Enabled, Enabled multilingual, or Enabled Bypass',
        required: true
      };
    }

    const availabilityResult = await LanguageModel.availability({
      temperature: 1.0,
      topK: 40,
      expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
    });

    const status = typeof availabilityResult === 'object' ? availabilityResult.availability : availabilityResult;

    // If status check returns 'no' or something unexpected, try to actually create a session
    // This handles cases where flag is "Enabled multilingual" or "Enabled Bypass" etc.
    let isAvailable = status === 'readily' || status === 'after-download';
    let actuallyWorks = false;

    if (!isAvailable) {
      actuallyWorks = await tryCreateSession(() => LanguageModel.create({
        systemPrompt: 'test',
        temperature: 1.0,
        topK: 40,
        expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['en'] }]
      }));
    }

    // Determine availability
    isAvailable = isAvailable || actuallyWorks;

    // Set message (with special handling for Prompt API 'no' status)
    let message;
    if (status === 'no') {
      message = 'Not available - Check Chrome version (need 128+) or try restarting Chrome';
    } else {
      message = getStatusMessage(status, actuallyWorks);
    }

    return {
      available: isAvailable,
      status: actuallyWorks ? 'working' : status,
      message,
      flag: 'chrome://flags/#prompt-api-for-gemini-nano',
      flagValue: 'Enabled, Enabled multilingual, or Enabled Bypass',
      required: true,
      multilingual: isAvailable ? await checkMultilingualSupport() : false
    };
  } catch (e) {
    console.error('[Setup Guide] Error checking Prompt API:', e);
    return {
      available: false,
      status: 'error',
      message: `Error: ${e.message}`,
      flag: 'chrome://flags/#prompt-api-for-gemini-nano',
      flagValue: 'Enabled, Enabled multilingual, or Enabled Bypass',
      required: true
    };
  }
}

/**
 * Check if multilingual mode is enabled (es, ja support)
 */
async function checkMultilingualSupport() {
  try {
    if (typeof LanguageModel === 'undefined') return false;

    // Try to create a session with Spanish to test multilingual support
    const testConfig = {
      systemPrompt: 'test',
      expectedOutputs: [{ type: 'text', format: 'plain-text', languages: ['es'] }]
    };

    const session = await LanguageModel.create(testConfig);
    session.destroy();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check Translation API availability (OPTIONAL - has Gemini Nano fallback)
 */
async function checkTranslationAPI() {
  try {
    // Check if Translator API is available as a global
    if (typeof Translator === 'undefined') {
      return {
        available: false,
        status: 'not-supported',
        message: 'Translation API not detected (using Gemini Nano fallback)',
        flag: 'chrome://flags/#translation-api',
        flagValue: 'Enabled, Enabled Bypass, or any enabled option',
        required: false,
        fallback: 'Gemini Nano can translate but with fewer languages (en/es/ja only)'
      };
    }

    const availability = await Translator.availability({
      sourceLanguage: 'en',
      targetLanguage: 'es'
    });

    // Try to actually create a session if status check fails
    let isAvailable = availability !== 'no';
    let actuallyWorks = false;

    if (!isAvailable) {
      actuallyWorks = await tryCreateSession(() => Translator.create({
        sourceLanguage: 'en',
        targetLanguage: 'es'
      }));
    }

    isAvailable = isAvailable || actuallyWorks;

    // Special message for translation API (includes language count)
    let message;
    if (availability === 'readily' || availability === 'available') {
      message = 'Ready - Expert translation for 12+ languages';
    } else if (availability === 'after-download' || availability === 'downloadable') {
      message = 'Ready (model will download on first use)';
    } else if (actuallyWorks) {
      message = 'Ready (Working with current flag setting)';
    } else {
      message = 'Not available (using fallback)';
    }

    return {
      available: isAvailable,
      status: actuallyWorks ? 'working' : availability,
      message,
      flag: 'chrome://flags/#translation-api',
      flagValue: 'Enabled, Enabled Bypass, or any enabled option',
      required: false,
      fallback: 'Gemini Nano can translate but with fewer languages (en/es/ja only)'
    };
  } catch (e) {
    return {
      available: false,
      status: 'error',
      message: `Not available (using fallback)`,
      flag: 'chrome://flags/#translation-api',
      flagValue: 'Enabled, Enabled Bypass, or any enabled option',
      required: false,
      fallback: 'Gemini Nano can translate but with fewer languages (en/es/ja only)'
    };
  }
}

/**
 * Check Language Detection API availability (OPTIONAL - translation works without it)
 */
async function checkLanguageDetectionAPI() {
  try {
    if (typeof LanguageDetector === 'undefined') {
      return {
        available: false,
        status: 'not-supported',
        message: 'Not detected',
        flag: 'chrome://flags/#language-detection-api',
        flagValue: 'Enabled, Enabled Bypass, or any enabled option',
        required: false,
        fallback: 'Translation assumes English as source language'
      };
    }

    const availability = await LanguageDetector.availability();

    // Try to actually create a session if status check fails
    let isAvailable = availability !== 'no';
    let actuallyWorks = false;

    if (!isAvailable) {
      actuallyWorks = await tryCreateSession(() => LanguageDetector.create());
    }

    isAvailable = isAvailable || actuallyWorks;

    // Special message for language detection (mentions feature)
    let message;
    if (availability === 'readily' || availability === 'available') {
      message = 'Ready - Auto-detects source language';
    } else if (availability === 'after-download' || availability === 'downloadable') {
      message = 'Ready (model will download on first use)';
    } else if (actuallyWorks) {
      message = 'Ready (Working with current flag setting)';
    } else {
      message = 'Not available';
    }

    return {
      available: isAvailable,
      status: actuallyWorks ? 'working' : availability,
      message,
      flag: 'chrome://flags/#language-detection-api',
      flagValue: 'Enabled, Enabled Bypass, or any enabled option',
      required: false,
      fallback: 'Translation assumes English as source language'
    };
  } catch (e) {
    return {
      available: false,
      status: 'error',
      message: `Not available`,
      flag: 'chrome://flags/#language-detection-api',
      flagValue: 'Enabled, Enabled Bypass, or any enabled option',
      required: false,
      fallback: 'Translation assumes English as source language'
    };
  }
}

/**
 * Check Summarization API availability (nice-to-have)
 */
async function checkSummarizationAPI() {
  try {
    if (typeof Summarizer === 'undefined') {
      return {
        available: false,
        status: 'not-supported',
        message: 'Summarization API not detected',
        flag: 'chrome://flags/#summarization-api-for-gemini-nano',
        flagValue: 'Enabled, Enabled multilingual, or Enabled Bypass',
        required: false
      };
    }

    const availabilityResult = await Summarizer.availability({
      outputLanguage: 'en'
    });
    const status = typeof availabilityResult === 'object' ? availabilityResult.availability : availabilityResult;

    // Try to actually create a session if status check fails
    let isAvailable = status === 'readily' || status === 'after-download' || status === 'available' || status === 'downloadable';
    let actuallyWorks = false;

    if (!isAvailable) {
      actuallyWorks = await tryCreateSession(() => Summarizer.create({
        sharedContext: 'test',
        type: 'tl;dr',
        format: 'plain-text',
        length: 'short',
        outputLanguage: 'en'
      }));
    }

    isAvailable = isAvailable || actuallyWorks;

    const message = getStatusMessage(status, actuallyWorks);

    return {
      available: isAvailable,
      status: actuallyWorks ? 'working' : status,
      message,
      flag: 'chrome://flags/#summarization-api-for-gemini-nano',
      flagValue: 'Enabled, Enabled multilingual, or Enabled Bypass',
      required: false
    };
  } catch (e) {
    return {
      available: false,
      status: 'not-available',
      message: 'Not available',
      flag: 'chrome://flags/#summarization-api-for-gemini-nano',
      flagValue: 'Enabled, Enabled multilingual, or Enabled Bypass',
      required: false
    };
  }
}

/**
 * Check Rewriter API availability (nice-to-have)
 */
async function checkRewriterAPI() {
  try {
    if (typeof Rewriter === 'undefined') {
      return {
        available: false,
        status: 'not-supported',
        message: 'Rewriter API not detected',
        flag: 'chrome://flags/#rewriter-api-for-gemini-nano',
        flagValue: 'Enabled, Enabled multilingual, or Enabled Bypass',
        required: false
      };
    }

    const availabilityResult = await Rewriter.availability({
      outputLanguage: 'en'
    });
    const status = typeof availabilityResult === 'object' ? availabilityResult.availability : availabilityResult;

    // Try to actually create a session if status check fails
    let isAvailable = status === 'readily' || status === 'after-download' || status === 'available' || status === 'downloadable';
    let actuallyWorks = false;

    if (!isAvailable) {
      actuallyWorks = await tryCreateSession(() => Rewriter.create({
        sharedContext: 'test',
        tone: 'as-is',
        format: 'plain-text',
        length: 'as-is',
        outputLanguage: 'en'
      }));
    }

    isAvailable = isAvailable || actuallyWorks;

    const message = getStatusMessage(status, actuallyWorks);

    return {
      available: isAvailable,
      status: actuallyWorks ? 'working' : status,
      message,
      flag: 'chrome://flags/#rewriter-api-for-gemini-nano',
      flagValue: 'Enabled, Enabled multilingual, or Enabled Bypass',
      required: false
    };
  } catch (e) {
    return {
      available: false,
      status: 'not-available',
      message: 'Not available',
      flag: 'chrome://flags/#rewriter-api-for-gemini-nano',
      flagValue: 'Enabled, Enabled multilingual, or Enabled Bypass',
      required: false
    };
  }
}

/**
 * Get browser information
 */
function getBrowserInfo() {
  const ua = navigator.userAgent;
  const match = ua.match(/Chrome\/(\d+)/);
  const chromeVersion = match ? parseInt(match[1]) : 0;

  return {
    chromeVersion,
    isChrome: chromeVersion > 0,
    meetsMinimumVersion: chromeVersion >= 128, // Minimum version for AI APIs
    recommendedVersion: chromeVersion >= 138  // Recommended version for all features
  };
}

/**
 * Get setup status summary
 * @returns {Promise<Object>} Setup status
 */
export async function getSetupStatus() {
  const apis = await checkAllAPIs();

  // Only Prompt API is absolutely required!
  const requiredAPIs = [
    apis.promptAPI
  ];

  // Everything else is optional with fallbacks
  const optionalAPIs = [
    apis.translationAPI,
    apis.languageDetectionAPI,
    apis.summarizationAPI,
    apis.rewriterAPI
  ];

  const allRequiredAvailable = requiredAPIs.every(api => api.available);
  const missingRequired = requiredAPIs.filter(api => !api.available);
  const availableOptional = optionalAPIs.filter(api => api.available);

  return {
    isFullySetup: allRequiredAvailable,
    missingRequired,
    requiredAPIs,
    optionalAPIs,
    availableOptional,
    browserInfo: apis.browserInfo,
    needsRestart: false // Could be set based on localStorage check
  };
}

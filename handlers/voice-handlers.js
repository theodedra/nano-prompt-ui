/**
 * Voice Handlers - Voice input and speech UI event handlers
 *
 * Handles microphone input, speech recognition, and text-to-speech.
 * Uses direct storage/model access for simple read operations (see IMPLEMENTATION.md).
 */

import * as Controller from '../controller/index.js';
import * as Model from '../core/model.js';
import * as Storage from '../core/storage.js';
import * as UI from '../ui/index.js';
import { USER_ERROR_MESSAGES } from '../config/constants.js';
import { handleError } from '../utils/errors.js';
import { toast } from '../ui/toast.js';

// Speech recognition state
let recognition = null;
let recognizing = false;

/**
 * Handle microphone button click - start/stop voice input
 */
export function handleMicClick() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    toast.error(USER_ERROR_MESSAGES.SPEECH_NOT_SUPPORTED);
    return;
  }

  if (recognizing) {
    if (recognition) {
      recognition.stop();
      recognition = null;
    }
    return;
  }

  recognition = new Speech();
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    recognizing = true;
    UI.setMicState(true);
  };

  recognition.onend = () => {
    recognizing = false;
    UI.setMicState(false);
    recognition = null;
  };

  recognition.onerror = (event) => {
    handleError(event.error || new Error('Speech recognition failed'), {
      operation: 'Speech recognition',
      fallbackMessage: 'SPEECH_FAILED',
      showToast: true,
      logError: true
    });
    recognizing = false;
    UI.setMicState(false);
    recognition = null;
  };

  recognition.onresult = (e) => {
    let t = '';
    for (let i = 0; i < e.results.length; ++i) {
      t += e.results[i][0].transcript;
    }
    Controller.setInputValue(t);
  };

  try {
    recognition.start();
  } catch (e) {
    handleError(e, {
      operation: 'Start speech recognition',
      fallbackMessage: 'SPEECH_FAILED',
      showToast: true,
      logError: true
    });
    recognition = null;
    recognizing = false;
    UI.setMicState(false);
  }
}

/**
 * Handle speak last AI response button click
 */
export function handleSpeakLast() {
  // Direct access - simple read operation
  const session = Storage.getCurrentSessionSync();
  const last = [...session.messages].reverse().find(m => m.role === 'ai');
  if (last) {
    Model.speakText(last.text, {
      onStart: () => UI.setStopEnabled(true),
      onEnd: () => UI.setStopEnabled(false),
      onError: () => UI.setStopEnabled(false)
    });
  }
}

/**
 * Check if speech recognition is currently active
 * @returns {boolean}
 */
export function isRecognizing() {
  return recognizing;
}

/**
 * Stop speech recognition if active
 */
export function stopRecognition() {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  recognizing = false;
}



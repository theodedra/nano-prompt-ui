/**
 * Voice Handlers - Voice input and speech UI event handlers
 *
 * Handles microphone input, speech recognition, and text-to-speech.
 */

import * as Controller from '../controller.js';
import * as Model from '../model.js';
import { USER_ERROR_MESSAGES } from '../constants.js';

// Speech recognition state
let recognition = null;
let recognizing = false;

/**
 * Handle microphone button click - start/stop voice input
 */
export function handleMicClick() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    Controller.showToast('error', USER_ERROR_MESSAGES.SPEECH_NOT_SUPPORTED);
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
    Controller.setMicState(true);
  };

  recognition.onend = () => {
    recognizing = false;
    Controller.setMicState(false);
    recognition = null;
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    recognizing = false;
    Controller.setMicState(false);
    recognition = null;
    Controller.showToast('error', USER_ERROR_MESSAGES.SPEECH_FAILED);
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
    console.error('Failed to start speech recognition:', e);
    recognition = null;
    recognizing = false;
    Controller.setMicState(false);
    Controller.showToast('error', USER_ERROR_MESSAGES.SPEECH_FAILED);
  }
}

/**
 * Handle speak last AI response button click
 */
export function handleSpeakLast() {
  const session = Controller.getCurrentSession();
  const last = [...session.messages].reverse().find(m => m.role === 'ai');
  if (last) {
    Model.speakText(last.text, {
      onStart: () => Controller.setStopEnabled(true),
      onEnd: () => Controller.setStopEnabled(false),
      onError: () => Controller.setStopEnabled(false)
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


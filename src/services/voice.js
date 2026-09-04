// Voice Recognition & Speech Synthesis Utility for Sehat Sathi

export class VoiceController {
  constructor(options = {}) {
    this.onResult = options.onResult || (() => {});
    this.onError = options.onError || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.continuousMode = options.continuousMode ?? true;
    this.recognition = null;
    this.isListening = false;
    this.language = options.language || 'hi-IN';
    this.shouldKeepListening = false;

    this.initRecognition();
  }

  initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false; // We handle restart cycle for high accuracy on mobile/desktop
      this.recognition.interimResults = true;
      this.recognition.lang = this.language;

      this.recognition.onstart = () => {
        this.isListening = true;
        this.onStateChange({ isListening: true, continuousMode: this.shouldKeepListening });
      };

      this.recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        this.onResult({
          final: finalTranscript,
          interim: interimTranscript,
          text: finalTranscript || interimTranscript
        });
      };

      this.recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error === 'no-speech' && this.shouldKeepListening && !this.isPaused) {
          // Auto restart if in continuous interactive mode
          setTimeout(() => {
            if (this.shouldKeepListening && !this.isPaused && !this.isListening) {
              this.start(this.shouldKeepListening);
            }
          }, 400);
          return;
        }
        this.isListening = false;
        this.onStateChange({ isListening: false, continuousMode: this.shouldKeepListening });
        this.onError(event.error);
      };

      this.recognition.onend = () => {
        this.isListening = false;
        this.onStateChange({ isListening: false, continuousMode: this.shouldKeepListening });
        // If user has continuous voice session active, restart after brief pause
        if (this.shouldKeepListening && !this.isPaused) {
          setTimeout(() => {
            if (this.shouldKeepListening && !this.isPaused && !this.isListening) {
              this.start(this.shouldKeepListening);
            }
          }, 300);
        }
      };
    }
  }

  setLanguage(langName) {
    const langMap = {
      'English': 'en-IN',
      'Hindi': 'hi-IN',
      'हिन्दी': 'hi-IN',
      'Bengali': 'bn-IN',
      'বাংলা': 'bn-IN',
      'Telugu': 'te-IN',
      'తెలుగు': 'te-IN',
      'Marathi': 'mr-IN',
      'मराठी': 'mr-IN',
      'Tamil': 'ta-IN',
      'தமிழ்': 'ta-IN',
      'Gujarati': 'gu-IN',
      'ગુજરાતી': 'gu-IN',
      'Kannada': 'kn-IN',
      'ಕನ್ನಡ': 'kn-IN',
      'Punjabi': 'pa-IN',
      'ਪੰਜਾਬੀ': 'pa-IN',
      'Odia': 'or-IN',
      'ଓଡ଼ିଆ': 'or-IN'
    };
    this.language = langMap[langName] || 'hi-IN';
    if (this.recognition) {
      this.recognition.lang = this.language;
    }
  }

  start(continuous = true) {
    this.shouldKeepListening = continuous;
    this.isPaused = false;
    if (this.recognition && !this.isListening) {
      try {
        this.recognition.start();
      } catch (err) {
        console.warn('Recognition start error:', err);
      }
    }
  }

  pause() {
    this.isPaused = true;
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (err) {
        console.warn('Recognition pause error:', err);
      }
    }
  }

  stop() {
    this.shouldKeepListening = false;
    this.isPaused = false;
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (err) {
        console.warn('Recognition stop error:', err);
      }
    }
    this.isListening = false;
    this.onStateChange({ isListening: false, continuousMode: false });
  }
}

// Browser Text-to-Speech Synthesis
export function speakText(text, language = 'Hindi', onEnd = () => {}) {
  if (!('speechSynthesis' in window)) {
    console.warn('Speech synthesis not supported on this browser');
    return;
  }

  window.speechSynthesis.cancel(); // Stop any active speech

  const cleanText = text.replace(/[*#_`]/g, '').trim();
  const utterance = new SpeechSynthesisUtterance(cleanText);

  const langCodeMap = {
    'English': 'en-IN',
    'Hindi': 'hi-IN',
    'हिन्दी': 'hi-IN',
    'Bengali': 'bn-IN',
    'Telugu': 'te-IN',
    'Marathi': 'mr-IN',
    'Tamil': 'ta-IN',
    'Gujarati': 'gu-IN',
    'Kannada': 'kn-IN',
    'Punjabi': 'pa-IN'
  };

  utterance.lang = langCodeMap[language] || 'hi-IN';
  utterance.rate = 0.95; // Slightly slower for clarity in rural health context
  utterance.pitch = 1.0;

  utterance.onend = onEnd;
  utterance.onerror = (e) => {
    console.warn('Speech synthesis playback error:', e);
    onEnd();
  };

  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

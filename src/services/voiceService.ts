// Voice Speech-to-Text (STT) and Text-to-Speech (TTS) Service

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

class VoiceService {
  private recognition: any = null;
  private isListening = false;
  private isSupported = false;
  private onResultCallback?: (transcript: string, isFinal: boolean) => void;
  private onStateChangeCallback?: (state: VoiceState) => void;
  private currentLanguage: string = 'ru-RU';

  constructor() {
    if (typeof window !== 'undefined') {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        this.isSupported = true;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.currentLanguage;

        this.recognition.onstart = () => {
          this.isListening = true;
          this.onStateChangeCallback?.('listening');
        };

        this.recognition.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            } else {
              interimTranscript += transcript;
            }
          }

          if (finalTranscript) {
            this.onResultCallback?.(finalTranscript.trim(), true);
          } else if (interimTranscript) {
            this.onResultCallback?.(interimTranscript.trim(), false);
          }
        };

        this.recognition.onerror = (event: any) => {
          console.warn('[VoiceService] Recognition error:', event.error);
          this.onStateChangeCallback?.('error');
        };

        this.recognition.onend = () => {
          this.isListening = false;
          this.onStateChangeCallback?.('idle');
        };
      }
    }
  }

  get supported(): boolean {
    return this.isSupported;
  }

  get listening(): boolean {
    return this.isListening;
  }

  setLanguage(lang: 'ru' | 'en') {
    this.currentLanguage = lang === 'ru' ? 'ru-RU' : 'en-US';
    if (this.recognition) {
      this.recognition.lang = this.currentLanguage;
    }
  }

  onResult(callback: (transcript: string, isFinal: boolean) => void) {
    this.onResultCallback = callback;
  }

  onStateChange(callback: (state: VoiceState) => void) {
    this.onStateChangeCallback = callback;
  }

  startListening(): boolean {
    if (!this.isSupported || !this.recognition) return false;
    if (this.isListening) return true;

    try {
      this.recognition.start();
      return true;
    } catch (err) {
      console.error('[VoiceService] Start listening error:', err);
      return false;
    }
  }

  stopListening() {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (err) {
        console.error('[VoiceService] Stop error:', err);
      }
    }
  }

  toggleListening(): boolean {
    if (this.isListening) {
      this.stopListening();
      return false;
    } else {
      return this.startListening();
    }
  }

  // Text-To-Speech (TTS) Synthesis
  speak(text: string, lang?: 'ru' | 'en'): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel(); // Stop any active speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'en' ? 'en-US' : this.currentLanguage;
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
    });
  }
}

export const voiceService = new VoiceService();

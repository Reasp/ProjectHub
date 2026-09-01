// Voice Speech-to-Text (STT) and Text-to-Speech (TTS) Service with Whisper & Web Speech API support

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'listening' | 'speaking' | 'error';
export type VoiceEngine = 'whisper' | 'webspeech';
export type WhisperProvider = 'groq' | 'openai' | 'local';

export interface VoiceConfig {
  engine: VoiceEngine;
  whisperProvider: WhisperProvider;
  whisperApiKey: string;
  whisperModel: string;
  whisperEndpoint: string;
  language: 'ru' | 'en';
  ttsEnabled: boolean;
}

const DEFAULT_CONFIG: VoiceConfig = {
  engine: 'whisper',
  whisperProvider: 'groq',
  whisperApiKey: '',
  whisperModel: 'whisper-large-v3',
  whisperEndpoint: 'http://127.0.0.1:8000/v1/audio/transcriptions',
  language: 'ru',
  ttsEnabled: true
};

const STORAGE_KEY = 'projecthub_voice_config';

class VoiceService {
  private config: VoiceConfig = DEFAULT_CONFIG;
  private state: VoiceState = 'idle';
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private mediaStream: MediaStream | null = null;

  // Web Speech API fallback
  private recognition: any = null;
  private isWebSpeechSupported = false;

  private onResultCallback?: (transcript: string, isFinal: boolean) => void;
  private onStateChangeCallback?: (state: VoiceState) => void;

  constructor() {
    this.loadConfig();
    this.initWebSpeech();
  }

  private loadConfig() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('[VoiceService] Failed to load config from storage:', e);
    }
  }

  saveConfig(newConfig: Partial<VoiceConfig>) {
    this.config = { ...this.config, ...newConfig };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
      } catch (e) {
        console.error('[VoiceService] Failed to save config:', e);
      }
    }
    this.updateLanguage();
  }

  getConfig(): VoiceConfig {
    return { ...this.config };
  }

  private updateLanguage() {
    if (this.recognition) {
      this.recognition.lang = this.config.language === 'ru' ? 'ru-RU' : 'en-US';
    }
  }

  private setState(state: VoiceState) {
    this.state = state;
    this.onStateChangeCallback?.(state);
  }

  get currentState(): VoiceState {
    return this.state;
  }

  get isRecording(): boolean {
    return this.state === 'recording' || this.state === 'listening';
  }

  get isBusy(): boolean {
    return this.state === 'transcribing' || this.state === 'speaking';
  }

  onResult(callback: (transcript: string, isFinal: boolean) => void) {
    this.onResultCallback = callback;
  }

  onStateChange(callback: (state: VoiceState) => void) {
    this.onStateChangeCallback = callback;
  }

  setLanguage(lang: 'ru' | 'en') {
    this.saveConfig({ language: lang });
  }

  // ─────────────────────────────────────────────────────────────────
  // 1. Web Speech API Initialization
  // ─────────────────────────────────────────────────────────────────
  private initWebSpeech() {
    if (typeof window !== 'undefined') {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        this.isWebSpeechSupported = true;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.config.language === 'ru' ? 'ru-RU' : 'en-US';

        this.recognition.onstart = () => {
          this.setState('listening');
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
          console.warn('[VoiceService] WebSpeech error:', event.error);
          this.setState('error');
        };

        this.recognition.onend = () => {
          if (this.state === 'listening') {
            this.setState('idle');
          }
        };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. Audio Capture (MediaRecorder for Whisper)
  // ─────────────────────────────────────────────────────────────────
  async startWhisperRecording(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      console.error('[VoiceService] getUserMedia is not supported in this environment');
      this.setState('error');
      return false;
    }

    try {
      this.audioChunks = [];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      this.mediaStream = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg';

      const recorder = new MediaRecorder(stream, { mimeType });
      this.mediaRecorder = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      recorder.onstart = () => {
        this.setState('recording');
      };

      recorder.onerror = (e) => {
        console.error('[VoiceService] MediaRecorder error:', e);
        this.cleanupAudio();
        this.setState('error');
      };

      recorder.start(250); // Collect data chunks every 250ms
      return true;
    } catch (err) {
      console.error('[VoiceService] Failed to start audio recording:', err);
      this.setState('error');
      return false;
    }
  }

  async stopWhisperRecording(): Promise<string | null> {
    if (!this.mediaRecorder || this.state !== 'recording') {
      return null;
    }

    return new Promise((resolve) => {
      const recorder = this.mediaRecorder!;

      recorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: recorder.mimeType });
        this.cleanupAudio();

        if (audioBlob.size < 1000) {
          // Audio too short / empty
          this.setState('idle');
          resolve(null);
          return;
        }

        this.setState('transcribing');

        try {
          const transcript = await this.transcribeWithWhisper(audioBlob);
          this.setState('idle');
          if (transcript && transcript.trim()) {
            const cleanText = transcript.trim();
            this.onResultCallback?.(cleanText, true);
            resolve(cleanText);
          } else {
            resolve(null);
          }
        } catch (err: any) {
          console.error('[VoiceService] Whisper transcription error:', err);
          this.setState('error');
          resolve(null);
        }
      };

      try {
        recorder.stop();
      } catch (err) {
        console.error('[VoiceService] Error stopping recorder:', err);
        this.cleanupAudio();
        this.setState('idle');
        resolve(null);
      }
    });
  }

  private cleanupAudio() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.mediaRecorder = null;
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. Whisper STT Transcription (Groq / OpenAI / Local)
  // ─────────────────────────────────────────────────────────────────
  async transcribeWithWhisper(audioBlob: Blob): Promise<string> {
    const { whisperProvider, whisperApiKey, whisperEndpoint, whisperModel, language } = this.config;

    // Try to resolve API key from AI Studio config in localStorage if not set in voice settings
    let apiKey = whisperApiKey?.trim();
    if (!apiKey && typeof window !== 'undefined') {
      try {
        const aiStudioStorage = localStorage.getItem('projecthub-ai-studio-storage');
        if (aiStudioStorage) {
          const parsed = JSON.parse(aiStudioStorage);
          if (parsed?.state?.config?.apiKey) {
            apiKey = parsed.state.config.apiKey;
          }
        }
      } catch {}
    }

    let endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
    let model = whisperModel || 'whisper-large-v3';

    if (whisperProvider === 'openai') {
      endpoint = 'https://api.openai.com/v1/audio/transcriptions';
      model = whisperModel || 'whisper-1';
    } else if (whisperProvider === 'local') {
      endpoint = whisperEndpoint || 'http://127.0.0.1:8000/v1/audio/transcriptions';
      model = whisperModel || 'whisper-large-v3';
    } else {
      // Groq (default for ultra-fast response)
      endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
      model = whisperModel || 'whisper-large-v3';
    }

    const formData = new FormData();
    const fileExt = audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
    formData.append('file', audioBlob, `audio.${fileExt}`);
    formData.append('model', model);
    if (language) {
      formData.append('language', language === 'ru' ? 'ru' : 'en');
    }
    formData.append('temperature', '0.0');

    const headers: Record<string, string> = {};
    if (apiKey && whisperProvider !== 'local') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Whisper API Error [${res.status}]: ${errorText || res.statusText}`);
    }

    const data = await res.json();
    return data.text || '';
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. Unified Start / Stop / Toggle Controls
  // ─────────────────────────────────────────────────────────────────
  async startListening(): Promise<boolean> {
    if (this.isRecording) return true;

    if (this.config.engine === 'whisper') {
      return this.startWhisperRecording();
    } else {
      if (!this.isWebSpeechSupported || !this.recognition) {
        console.warn('[VoiceService] WebSpeech is not supported, switching to Whisper');
        return this.startWhisperRecording();
      }
      try {
        this.recognition.start();
        return true;
      } catch (err) {
        console.error('[VoiceService] WebSpeech start error:', err);
        return false;
      }
    }
  }

  async stopListening(): Promise<string | null> {
    if (this.config.engine === 'whisper' || this.mediaRecorder) {
      return this.stopWhisperRecording();
    } else {
      if (this.recognition && this.state === 'listening') {
        try {
          this.recognition.stop();
        } catch (err) {
          console.error('[VoiceService] WebSpeech stop error:', err);
        }
      }
      this.setState('idle');
      return null;
    }
  }

  async toggleListening(): Promise<boolean> {
    if (this.isRecording) {
      await this.stopListening();
      return false;
    } else {
      return await this.startListening();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. Text-To-Speech (TTS) Synthesis
  // ─────────────────────────────────────────────────────────────────
  speak(text: string, lang?: 'ru' | 'en'): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis || !this.config.ttsEnabled) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel(); // Stop any active speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = (lang || this.config.language) === 'en' ? 'en-US' : 'ru-RU';
      utterance.rate = 1.08;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        if (this.state === 'idle') this.setState('speaking');
      };

      utterance.onend = () => {
        if (this.state === 'speaking') this.setState('idle');
        resolve();
      };

      utterance.onerror = () => {
        if (this.state === 'speaking') this.setState('idle');
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }
}

export const voiceService = new VoiceService();

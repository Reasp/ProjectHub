// Continuous Hands-Free (Talon Voice style) Voice STT & TTS Service
// Multi-threaded pipeline: Audio Capture (Thread 1) -> VAD & Chunking (Thread 2) -> Worker Whisper (Thread 3)

export type VoiceState =
  | 'idle'
  | 'listening_handsfree'
  | 'speech_detected'
  | 'transcribing'
  | 'recording_manual'
  | 'speaking'
  | 'error';

export type VoiceEngine = 'whisper' | 'webspeech';
export type WhisperProvider = 'local' | 'groq' | 'openai';

import { getDefaultCommandPhrases } from './voiceCommandPhrases';

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  groupId: string;
}

export interface VoiceConfig {
  engine: VoiceEngine;
  whisperProvider: WhisperProvider;
  whisperApiKey: string;
  whisperModel: string;
  whisperEndpoint: string;
  language: 'ru' | 'en';
  ttsEnabled: boolean;
  handsFree: boolean; // Continuous listening without touching buttons
  vadSilenceThresholdMs: number; // Silence duration before cutting chunk (default: 480ms)
  customCommandPhrases?: Record<string, string[]>;
  audioInputDeviceId?: string; // ID of selected microphone (empty string = system default)
  audioOutputDeviceId?: string; // ID of selected output (empty string = system default)
  autoSwitchOnDeviceChange?: boolean; // Hotplug: auto switch when headset connects/disconnects
}

const DEFAULT_CONFIG: VoiceConfig = {
  engine: 'whisper',
  whisperProvider: 'local',
  whisperApiKey: '',
  whisperModel: 'Xenova/whisper-base',
  whisperEndpoint: 'http://127.0.0.1:8000/v1/audio/transcriptions',
  language: 'ru',
  ttsEnabled: true,
  handsFree: true, // Hands-Free by default
  vadSilenceThresholdMs: 480,
  customCommandPhrases: getDefaultCommandPhrases(),
  audioInputDeviceId: '',
  audioOutputDeviceId: '',
  autoSwitchOnDeviceChange: true
};

const STORAGE_KEY = 'projecthub_voice_config';

class VoiceService {
  private config: VoiceConfig = DEFAULT_CONFIG;
  private state: VoiceState = 'idle';

  // Audio Context & VAD State
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;

  // VAD & Pre-roll Ring Buffer (250ms at 16kHz = 4000 samples)
  private readonly PRE_ROLL_SIZE = 4000;
  private preRollBuffer: Float32Array = new Float32Array(this.PRE_ROLL_SIZE);
  private preRollIndex = 0;
  private preRollFilled = false;

  private isSpeaking = false;
  private isPaused = false;
  private speechStartTime = 0;
  private lastSoundTime = 0;
  private currentPhraseChunks: Float32Array[] = [];
  private noiseFloor = 0.005;

  // Web Speech API fallback
  private recognition: any = null;
  private isWebSpeechSupported = false;

  // Callbacks
  private onResultCallbacks: Set<(transcript: string, isFinal: boolean) => void> = new Set();
  private onStateChangeCallbacks: Set<(state: VoiceState) => void> = new Set();
  private onAudioLevelCallbacks: Set<(level: number, isSpeaking: boolean) => void> = new Set();
  private onPauseChangeCallbacks: Set<(isPaused: boolean) => void> = new Set();
  private onErrorCallbacks: Set<(errorMessage: string) => void> = new Set();
  public lastError: string | null = null;

  // Audio Devices & Hotplug callbacks
  private onDevicesChangeCallbacks: Set<(devices: { inputs: AudioDeviceInfo[]; outputs: AudioDeviceInfo[] }) => void> = new Set();
  private onDeviceNoticeCallbacks: Set<(notice: { type: 'switch' | 'disconnect' | 'connect'; message: string }) => void> = new Set();
  private isWatcherInitialized = false;

  constructor() {
    this.loadConfig();
    this.initWebSpeech();
    this.initDeviceChangeWatcher();
  }

  private async loadConfig() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
      }
      if (window.api?.getEncryptedSecret) {
        const encKey = await window.api.getEncryptedSecret('whisperApiKey');
        if (encKey) {
          this.config.whisperApiKey = encKey;
        }
      }
    } catch (e) {
      console.warn('[VoiceService] Failed to load config:', e);
    }
  }

  saveConfig(newConfig: Partial<VoiceConfig>) {
    this.config = { ...this.config, ...newConfig };
    if (typeof window !== 'undefined') {
      try {
        if (newConfig.whisperApiKey !== undefined && window.api?.saveEncryptedSecret) {
          window.api.saveEncryptedSecret('whisperApiKey', newConfig.whisperApiKey || '');
        }
        // Don't keep raw API key in localStorage
        const safeConfig = { ...this.config, whisperApiKey: '' };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(safeConfig));
      } catch (e) {
        console.error('[VoiceService] Failed to save config:', e);
      }
    }
    this.updateLanguage();
  }

  getConfig(): VoiceConfig {
    return { ...this.config };
  }

  private onPhrasesChangeCallbacks: Set<(phrases: Record<string, string[]>) => void> = new Set();

  getCommandPhrases(): Record<string, string[]> {
    if (this.config.customCommandPhrases && Object.keys(this.config.customCommandPhrases).length > 0) {
      return { ...this.config.customCommandPhrases };
    }
    return getDefaultCommandPhrases();
  }

  saveCommandPhrases(phrases: Record<string, string[]>) {
    this.saveConfig({ customCommandPhrases: phrases });
    this.onPhrasesChangeCallbacks.forEach((cb) => {
      try {
        cb(phrases);
      } catch (e) {
        console.error('[VoiceService] onPhrasesChange error:', e);
      }
    });
  }

  resetCommandPhrases(): Record<string, string[]> {
    const defaults = getDefaultCommandPhrases();
    this.saveCommandPhrases(defaults);
    return defaults;
  }

  onCommandPhrasesChange(callback: (phrases: Record<string, string[]>) => void): () => void {
    this.onPhrasesChangeCallbacks.add(callback);
    return () => this.onPhrasesChangeCallbacks.delete(callback);
  }

  private updateLanguage() {
    if (this.recognition) {
      this.recognition.lang = this.config.language === 'ru' ? 'ru-RU' : 'en-US';
    }
  }

  private setState(state: VoiceState) {
    this.state = state;
    this.onStateChangeCallbacks.forEach((cb) => {
      try {
        cb(state);
      } catch (e) {
        console.error('[VoiceService] onStateChange error:', e);
      }
    });
  }

  get currentState(): VoiceState {
    return this.state;
  }

  get isListening(): boolean {
    return (
      this.state === 'listening_handsfree' ||
      this.state === 'speech_detected' ||
      this.state === 'transcribing' ||
      this.state === 'recording_manual'
    );
  }

  onResult(callback: (transcript: string, isFinal: boolean) => void) {
    this.onResultCallbacks.add(callback);
    return () => {
      this.onResultCallbacks.delete(callback);
    };
  }

  onStateChange(callback: (state: VoiceState) => void) {
    this.onStateChangeCallbacks.add(callback);
    try {
      callback(this.state);
    } catch (e) {}
    return () => {
      this.onStateChangeCallbacks.delete(callback);
    };
  }

  onAudioLevel(callback: (level: number, isSpeaking: boolean) => void) {
    this.onAudioLevelCallbacks.add(callback);
    return () => {
      this.onAudioLevelCallbacks.delete(callback);
    };
  }

  onPauseChange(callback: (isPaused: boolean) => void) {
    this.onPauseChangeCallbacks.add(callback);
    try {
      callback(this.isPaused);
    } catch (e) {}
    return () => {
      this.onPauseChangeCallbacks.delete(callback);
    };
  }

  pause() {
    if (!this.isPaused) {
      this.isPaused = true;
      this.resetVAD();
      this.notifyPauseChange();
    }
  }

  resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.resetVAD();
      this.notifyPauseChange();
    }
  }

  togglePause(): boolean {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
    return this.isPaused;
  }

  private notifyPauseChange() {
    this.onPauseChangeCallbacks.forEach((cb) => {
      try {
        cb(this.isPaused);
      } catch (e) {}
    });
  }

  get isPausedActive(): boolean {
    return this.isPaused;
  }

  onError(callback: (errorMessage: string) => void) {
    this.onErrorCallbacks.add(callback);
    return () => {
      this.onErrorCallbacks.delete(callback);
    };
  }

  private notifyError(message: string) {
    this.lastError = message;
    this.onErrorCallbacks.forEach((cb) => {
      try {
        cb(message);
      } catch (e) {
        console.error('[VoiceService] onError callback error:', e);
      }
    });
  }

  getLastError(): string | null {
    return this.lastError;
  }

  setLanguage(lang: 'ru' | 'en') {
    this.saveConfig({ language: lang });
  }

  // ─────────────────────────────────────────────────────────────────
  // Audio Devices & Hotplug (Input & Output Management)
  // ─────────────────────────────────────────────────────────────────
  getActiveTrackLabel(): string | null {
    if (this.mediaStream) {
      const track = this.mediaStream.getAudioTracks()[0];
      return track ? track.label : null;
    }
    return null;
  }

  async getAvailableAudioDevices(): Promise<{ inputs: AudioDeviceInfo[]; outputs: AudioDeviceInfo[] }> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return { inputs: [], outputs: [] };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs: AudioDeviceInfo[] = [];
      const outputs: AudioDeviceInfo[] = [];

      let inCount = 1;
      let outCount = 1;

      for (const dev of devices) {
        if (dev.kind === 'audioinput') {
          inputs.push({
            deviceId: dev.deviceId,
            label: dev.label || (this.config.language === 'ru' ? `Микрофон ${inCount++}` : `Microphone ${inCount++}`),
            kind: 'audioinput',
            groupId: dev.groupId
          });
        } else if (dev.kind === 'audiooutput') {
          outputs.push({
            deviceId: dev.deviceId,
            label: dev.label || (this.config.language === 'ru' ? `Динамики / Наушники ${outCount++}` : `Speakers / Headset ${outCount++}`),
            kind: 'audiooutput',
            groupId: dev.groupId
          });
        }
      }
      return { inputs, outputs };
    } catch (e) {
      console.warn('[VoiceService] Failed to enumerate devices:', e);
      return { inputs: [], outputs: [] };
    }
  }

  async selectAudioInputDevice(deviceId: string): Promise<boolean> {
    this.saveConfig({ audioInputDeviceId: deviceId });
    if (this.isListening) {
      return await this.restartAudioCapture();
    }
    return true;
  }

  async selectAudioOutputDevice(deviceId: string): Promise<boolean> {
    this.saveConfig({ audioOutputDeviceId: deviceId });
    if (this.audioContext && (this.audioContext as any).setSinkId) {
      try {
        await (this.audioContext as any).setSinkId(deviceId || '');
      } catch (e) {
        console.warn('[VoiceService] Failed to set sinkId on current context:', e);
      }
    }
    return true;
  }

  async playTestTone(outputDeviceId?: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const targetSink = outputDeviceId !== undefined ? outputDeviceId : this.config.audioOutputDeviceId;
      if (targetSink && (ctx as any).setSinkId) {
        try {
          await (ctx as any).setSinkId(targetSink);
        } catch (sinkErr) {
          console.warn('[VoiceService] playTestTone sinkId error:', sinkErr);
        }
      }
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Pleasant two-tone chime (F5 -> C6)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(698.46, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.36);

      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 500);

      return true;
    } catch (e) {
      console.error('[VoiceService] playTestTone failed:', e);
      return false;
    }
  }

  async restartAudioCapture(isFallback: boolean = false): Promise<boolean> {
    if (!this.isListening) return false;
    this.cleanupAudio();
    return await this.startHandsFreeListening(isFallback);
  }

  private initDeviceChangeWatcher() {
    if (this.isWatcherInitialized || typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    this.isWatcherInitialized = true;

    navigator.mediaDevices.addEventListener('devicechange', async () => {
      console.log('[VoiceService] Audio device change detected (hotplug)');
      await this.handleDeviceChange();
    });
  }

  private async handleDeviceChange() {
    const devices = await this.getAvailableAudioDevices();
    this.onDevicesChangeCallbacks.forEach((cb) => {
      try { cb(devices); } catch (e) {}
    });

    if (!this.isListening || !this.config.autoSwitchOnDeviceChange) return;

    // Check if preferred input device was just connected
    if (this.config.audioInputDeviceId) {
      const preferredDevice = devices.inputs.find((d) => d.deviceId === this.config.audioInputDeviceId);
      const currentTrack = this.mediaStream?.getAudioTracks()[0];
      const currentLabel = currentTrack?.label;

      if (preferredDevice && currentTrack && currentLabel && currentLabel !== preferredDevice.label) {
        console.log(`[VoiceService] Preferred device "${preferredDevice.label}" plugged in, switching...`);
        const msg = this.config.language === 'ru'
          ? `Гарнитура подключена: «${preferredDevice.label}». Захват переключен.`
          : `Headset connected: "${preferredDevice.label}". Switched capture.`;
        this.notifyDeviceNotice({ type: 'connect', message: msg });
        await this.restartAudioCapture();
        return;
      }
    }

    // Check if current device is still present
    const activeTrack = this.mediaStream?.getAudioTracks()[0];
    if (activeTrack) {
      const isStillAvailable = devices.inputs.some((d) => !d.label || d.label === activeTrack.label);
      if (!isStillAvailable || activeTrack.readyState === 'ended') {
        console.log('[VoiceService] Active input device removed, falling back...');
        const msg = this.config.language === 'ru'
          ? 'Аудиоустройство отключено. Выполнен переход на резервный микрофон.'
          : 'Audio device disconnected. Switched to fallback microphone.';
        this.notifyDeviceNotice({ type: 'disconnect', message: msg });
        await this.restartAudioCapture(true);
      }
    }
  }

  private notifyDeviceNotice(notice: { type: 'switch' | 'disconnect' | 'connect'; message: string }) {
    this.onDeviceNoticeCallbacks.forEach((cb) => {
      try { cb(notice); } catch (e) {}
    });
  }

  onDeviceNotice(callback: (notice: { type: 'switch' | 'disconnect' | 'connect'; message: string }) => void) {
    this.onDeviceNoticeCallbacks.add(callback);
    return () => {
      this.onDeviceNoticeCallbacks.delete(callback);
    };
  }

  onDevicesChange(callback: (devices: { inputs: AudioDeviceInfo[]; outputs: AudioDeviceInfo[] }) => void) {
    this.onDevicesChangeCallbacks.add(callback);
    return () => {
      this.onDevicesChangeCallbacks.delete(callback);
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 1. Web Speech API Fallback
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
          this.setState('listening_handsfree');
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
            const cleanFinal = finalTranscript.trim();
            this.onResultCallbacks.forEach((cb) => {
              try { cb(cleanFinal, true); } catch (e) {}
            });
          } else if (interimTranscript) {
            const cleanInterim = interimTranscript.trim();
            this.onResultCallbacks.forEach((cb) => {
              try { cb(cleanInterim, false); } catch (e) {}
            });
          }
        };

        this.recognition.onerror = (event: any) => {
          console.warn('[VoiceService] WebSpeech error:', event.error);
          this.setState('error');
        };

        this.recognition.onend = () => {
          if (this.isListening) {
            this.setState('idle');
          }
        };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. Continuous Hands-Free Audio Stream (Talon Voice style)
  // ─────────────────────────────────────────────────────────────────
  async startHandsFreeListening(isFallback: boolean = false): Promise<boolean> {
    if (this.isListening) return true;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const msg = this.config.language === 'ru'
        ? 'Аудио-устройства не поддерживаются в данной среде'
        : 'Audio recording devices not supported in this environment';
      this.notifyError(msg);
      this.setState('error');
      return false;
    }

    try {
      this.lastError = null;
      this.resetVAD();

      let stream: MediaStream;
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      };

      if (this.config.audioInputDeviceId && !isFallback) {
        audioConstraints.deviceId = { exact: this.config.audioInputDeviceId };
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints
        });
      } catch (constraintErr) {
        console.warn('[VoiceService] Selected audio constraints failed, falling back to basic audio', constraintErr);
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1
            }
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      }
      this.mediaStream = stream;

      // Track hot-unplug listener
      const activeTrack = stream.getAudioTracks()[0];
      if (activeTrack) {
        activeTrack.onended = () => {
          console.warn('[VoiceService] Audio track ended (device unplugged/disconnected)');
          const msg = this.config.language === 'ru'
            ? 'Аудиоустройство отключено. Переключаюсь на резервный микрофон...'
            : 'Audio device disconnected. Switching to fallback microphone...';
          this.notifyDeviceNotice({ type: 'disconnect', message: msg });
          if (this.isListening) {
            this.restartAudioCapture(true);
          }
        };
      }

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      if (this.config.audioOutputDeviceId && (ctx as any).setSinkId) {
        try {
          await (ctx as any).setSinkId(this.config.audioOutputDeviceId);
        } catch (sinkErr) {
          console.warn('[VoiceService] Failed to set sinkId on AudioContext:', sinkErr);
        }
      }
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      this.audioContext = ctx;

      const source = ctx.createMediaStreamSource(stream);
      // Process 4096 frames at a time
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      this.audioProcessor = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const resampled16k = this.resampleTo16k(inputData, ctx.sampleRate);
        this.processAudioChunkVAD(resampled16k);
      };

      // Mute local output to prevent feedback echo loop while keeping processing active
      const muteGain = ctx.createGain();
      muteGain.gain.value = 0;

      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(ctx.destination);

      this.setState('listening_handsfree');
      console.log('[VoiceService] Continuous Hands-Free listening active (Talon Voice style)');
      return true;
    } catch (err: any) {
      console.error('[VoiceService] Failed to start hands-free listening:', err);
      let errorMsg = err?.message || 'Ошибка запуска микрофона';
      const errName = err?.name || '';

      if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError' || errorMsg.includes('device not found')) {
        errorMsg = this.config.language === 'ru'
          ? 'Микрофон не обнаружен в системе. Если вы подключены удаленно (RDP / AnyDesk / RustDesk), включите проброс микрофона в параметрах подключения.'
          : 'Microphone not found. If connected via Remote Desktop (RDP / AnyDesk / RustDesk), enable microphone redirection in connection settings.';
      } else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errorMsg.includes('denied')) {
        errorMsg = this.config.language === 'ru'
          ? 'Доступ к микрофону заблокирован или запрещен разрешениями системы.'
          : 'Microphone access is blocked or denied by system permissions.';
      } else if (errName === 'NotReadableError') {
        errorMsg = this.config.language === 'ru'
          ? 'Микрофон занят другим приложением или аудиодрайвер записи недоступен.'
          : 'Microphone is already in use by another application or audio driver is unavailable.';
      } else if (errName === 'OverconstrainedError') {
        errorMsg = this.config.language === 'ru'
          ? 'Параметры аудиозаписи не поддерживаются текущим микрофоном.'
          : 'Audio capture parameters are not supported by the current microphone.';
      }

      this.notifyError(errorMsg);
      this.cleanupAudio();
      this.setState('error');
      return false;
    }
  }

  private resetVAD() {
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.lastSoundTime = 0;
    this.currentPhraseChunks = [];
    this.preRollIndex = 0;
    this.preRollFilled = false;
    this.preRollBuffer.fill(0);
  }

  /**
   * Continuous VAD processor with sliding window RMS & adaptive noise floor
   */
  private processAudioChunkVAD(chunk: Float32Array) {
    if (chunk.length === 0) return;

    if (this.isPaused) {
      this.onAudioLevelCallbacks.forEach((cb) => {
        try { cb(0, false); } catch (e) {}
      });
      return;
    }

    // 1. Calculate RMS energy
    let sumSquares = 0;
    for (let i = 0; i < chunk.length; i++) {
      sumSquares += chunk[i] * chunk[i];
    }
    const rms = Math.sqrt(sumSquares / chunk.length);

    // 2. Adaptive threshold
    if (!this.isSpeaking) {
      this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
    }
    const speechThreshold = Math.max(0.012, this.noiseFloor * 2.8);
    const hasSound = rms > speechThreshold;
    const now = Date.now();

    // Visual audio feedback level [0..1]
    const normalizedLevel = Math.min(1, rms * 15);
    this.onAudioLevelCallbacks.forEach((cb) => {
      try { cb(normalizedLevel, this.isSpeaking); } catch (e) {}
    });

    // 3. Pre-roll ring buffer (maintains last 250ms of audio before speech)
    if (!this.isSpeaking) {
      for (let i = 0; i < chunk.length; i++) {
        this.preRollBuffer[this.preRollIndex] = chunk[i];
        this.preRollIndex = (this.preRollIndex + 1) % this.PRE_ROLL_SIZE;
        if (this.preRollIndex === 0) this.preRollFilled = true;
      }
    }

    // 4. Speech Start Detection
    if (hasSound && !this.isSpeaking) {
      this.isSpeaking = true;
      this.speechStartTime = now;
      this.lastSoundTime = now;
      this.setState('speech_detected');

      // Prepend pre-roll buffer so we don't cut off leading consonants
      const preRoll = this.getPreRollSamples();
      this.currentPhraseChunks = [preRoll, new Float32Array(chunk)];
      return;
    }

    // 5. During Speech
    if (this.isSpeaking) {
      this.currentPhraseChunks.push(new Float32Array(chunk));

      if (hasSound) {
        this.lastSoundTime = now;
      }

      const silenceDuration = now - this.lastSoundTime;
      const totalPhraseDuration = now - this.speechStartTime;

      // 6. Speech End Detection (silence threshold reached or max phrase 12s)
      if (silenceDuration > this.config.vadSilenceThresholdMs || totalPhraseDuration > 12000) {
        this.finalizeAndDispatchPhrase();
      }
    }
  }

  private getPreRollSamples(): Float32Array {
    const out = new Float32Array(this.PRE_ROLL_SIZE);
    if (!this.preRollFilled) {
      out.set(this.preRollBuffer.subarray(0, this.preRollIndex), 0);
      return out.subarray(0, this.preRollIndex);
    }
    const part1 = this.preRollBuffer.subarray(this.preRollIndex);
    const part2 = this.preRollBuffer.subarray(0, this.preRollIndex);
    out.set(part1, 0);
    out.set(part2, part1.length);
    return out;
  }

  /**
   * Finalizes phrase, sends it to the background Whisper thread,
   * while keeping the audio capture thread running uninterrupted!
   */
  private finalizeAndDispatchPhrase() {
    this.isSpeaking = false;
    this.setState('transcribing');

    // Merge chunks
    let totalSamples = 0;
    for (const ch of this.currentPhraseChunks) {
      totalSamples += ch.length;
    }

    const fullPhrase = new Float32Array(totalSamples);
    let offset = 0;
    for (const ch of this.currentPhraseChunks) {
      fullPhrase.set(ch, offset);
      offset += ch.length;
    }

    this.currentPhraseChunks = [];

    // Ignore tiny blips (< 0.28s)
    if (totalSamples < 4500) {
      this.setState('listening_handsfree');
      return;
    }

    console.log(`[VoiceService] Hands-Free phrase captured (${(totalSamples / 16000).toFixed(2)}s). Dispatching to Whisper worker...`);

    this.dispatchToWhisper(fullPhrase)
      .then((text) => {
        if (text && text.trim()) {
          const clean = text.trim();
          console.log(`[VoiceService] ✓ Hands-Free transcript: "${clean}"`);
          this.onResultCallbacks.forEach((cb) => {
            try { cb(clean, true); } catch (e) {}
          });
        }
      })
      .catch((err) => {
        console.error('[VoiceService] Transcription error in hands-free stream:', err);
      })
      .finally(() => {
        // Return to listening state without ever stopping the microphone stream!
        if (this.isListening) {
          this.setState('listening_handsfree');
        }
      });
  }

  private async dispatchToWhisper(pcmSamples: Float32Array): Promise<string> {
    const { whisperProvider, language } = this.config;

    // 1. Local Whisper in isolated Worker thread (Primary)
    if (whisperProvider === 'local' && window.api?.transcribeLocalWhisper) {
      try {
        const res = await window.api.transcribeLocalWhisper(pcmSamples, language);
        if (res?.text) return res.text;
      } catch (err) {
        console.warn('[VoiceService] Local Whisper worker failed, checking cloud fallback:', err);
      }
    }

    // 2. Cloud Whisper Fallback (WAV buffer)
    return await this.transcribePcmWithCloud(pcmSamples);
  }

  private async transcribePcmWithCloud(pcmSamples: Float32Array): Promise<string> {
    const { whisperProvider, whisperApiKey, whisperEndpoint, whisperModel, language } = this.config;

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
    }

    const wavBlob = this.encodeWav(pcmSamples, 16000);
    const formData = new FormData();
    formData.append('file', wavBlob, 'speech.wav');
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

  private encodeWav(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  private resampleTo16k(audioData: Float32Array, origSampleRate: number): Float32Array {
    if (origSampleRate === 16000) return audioData;
    const ratio = origSampleRate / 16000;
    const newLength = Math.round(audioData.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < audioData.length; i++) {
        accum += audioData[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  stopListening() {
    this.isPaused = false;
    this.notifyPauseChange();
    this.cleanupAudio();
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
    }
    this.setState('idle');
  }

  private cleanupAudio() {
    if (this.audioProcessor) {
      this.audioProcessor.disconnect();
      this.audioProcessor = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
  }

  async toggleHandsFree(): Promise<boolean> {
    if (this.isListening) {
      this.stopListening();
      return false;
    } else {
      return await this.startHandsFreeListening();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. Text-To-Speech (TTS) Synthesis
  // ─────────────────────────────────────────────────────────────────
  speak(text: string, lang?: 'ru' | 'en'): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis || !this.config.ttsEnabled) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = (lang || this.config.language) === 'en' ? 'en-US' : 'ru-RU';
      utterance.rate = 1.1;
      utterance.pitch = 1.0;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
    });
  }
}

export const voiceService = new VoiceService();

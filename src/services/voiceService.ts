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
/** Движок озвучки: системный speechSynthesis или локальный Piper в воркере main (TASK-69). */
export type TtsEngine = 'system' | 'piper';
export type WhisperProvider = 'local' | 'groq' | 'openai';

import { getDefaultCommandPhrases } from './voiceCommandPhrases';
import { DEFAULT_WAKE_WORD_PHRASES } from './wakeWord';
import {
  DEFAULT_BARGE_IN,
  bargeInThresholdFor,
  createBargeInState,
  feedBargeIn,
  resetBargeIn,
  phraseSpeechLevel,
  updateSpeechLevel
} from './bargeInDetector';
import { ttsPlayer } from './ttsPlayer';
import type { LocalWhisperStatusInfo } from '../types/electron';

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
  /** Какой движок озвучивает текст (TASK-69). */
  ttsEngine: TtsEngine;
  /** Идентификатор голоса Piper; пустая строка — выбрать по языку. */
  ttsVoiceId: string;
  /** Скорость речи Piper: 1.0 — как записано в модели. */
  ttsSpeed: number;
  /** Громкость воспроизведения Piper: 0..1. */
  ttsVolume: number;
  handsFree: boolean; // Continuous listening without touching buttons
  vadSilenceThresholdMs: number; // Silence duration before cutting chunk (default: 480ms)
  customCommandPhrases?: Record<string, string[]>;
  audioInputDeviceId?: string; // ID of selected microphone (empty string = system default)
  audioOutputDeviceId?: string; // ID of selected output (empty string = system default)
  autoSwitchOnDeviceChange?: boolean; // Hotplug: auto switch when headset connects/disconnects
  /**
   * Ключевое слово активации (TASK-83): пока включено, в hands-free выполняются только фразы,
   * начинающиеся с обращения. Выключено по умолчанию — иначе сломался бы привычный сценарий,
   * где команда произносится сразу.
   */
  wakeWordEnabled?: boolean;
  wakeWordPhrases?: string[];
  /** Нераспознанную регулярками фразу разбирает настроенная модель (TASK-83 п. 2). */
  llmFallbackEnabled?: boolean;
  /** Речь пользователя прерывает озвучку приложения (barge-in, TASK-83 п. 3). */
  bargeInEnabled?: boolean;
  /**
   * Режим диалога (TASK-83 п. 3): краткая сводка финального ответа агента читается вслух.
   * Выключено по умолчанию — до сих пор озвучка включалась только явной командой («прочитай
   * задачи»), и делать её самопроизвольной без спроса нельзя.
   */
  speakAgentAnswers?: boolean;
  /** Озвучивать вопросы агента, вынесенные на подтверждение человеку. */
  speakHitlQuestions?: boolean;
  /** Расставлять знаки препинания в диктуемом тексте настроенной моделью (TASK-83 п. 5). */
  dictationPunctuation?: boolean;
  /** Пользователь уже подтвердил, что диктовка печатает в чужие окна — второй раз не спрашиваем. */
  dictationConfirmed?: boolean;
}

const DEFAULT_CONFIG: VoiceConfig = {
  engine: 'whisper',
  whisperProvider: 'local',
  whisperApiKey: '',
  whisperModel: 'Xenova/whisper-base',
  whisperEndpoint: 'http://127.0.0.1:8000/v1/audio/transcriptions',
  language: 'ru',
  ttsEnabled: true,
  // По умолчанию остаётся системный движок: модели Piper ещё не скачаны (decision-25)
  ttsEngine: 'system',
  ttsVoiceId: '',
  ttsSpeed: 1.0,
  ttsVolume: 1.0,
  handsFree: true, // Hands-Free by default
  vadSilenceThresholdMs: 480,
  customCommandPhrases: getDefaultCommandPhrases(),
  audioInputDeviceId: '',
  audioOutputDeviceId: '',
  autoSwitchOnDeviceChange: true,
  wakeWordEnabled: false,
  wakeWordPhrases: [...DEFAULT_WAKE_WORD_PHRASES],
  llmFallbackEnabled: true,
  bargeInEnabled: true,
  speakAgentAnswers: false,
  speakHitlQuestions: false,
  dictationPunctuation: false,
  dictationConfirmed: false
};

const STORAGE_KEY = 'projecthub_voice_config';

class VoiceService {
  private config: VoiceConfig = DEFAULT_CONFIG;
  private state: VoiceState = 'idle';

  // Audio Context & VAD State
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private muteGain: GainNode | null = null;
  private captureBackend: 'worklet' | 'script-processor' | 'webspeech' | null = null;

  // Переиспользуемый буфер ресемплера (16 кГц): не аллоцируем на каждый чанк
  private resampleScratch: Float32Array = new Float32Array(0);
  private static readonly WORKLET_URL = './voice-capture-worklet.js';

  // VAD & Pre-roll Ring Buffer (250ms at 16kHz = 4000 samples)
  private readonly PRE_ROLL_SIZE = 4000;
  private preRollBuffer: Float32Array = new Float32Array(this.PRE_ROLL_SIZE);
  private preRollIndex = 0;
  private preRollFilled = false;

  private isSpeaking = false;
  private isPaused = false;
  /** Пока приложение говорит само, VAD не слушает — иначе оно реагирует на собственную речь. */
  private ttsMuted = false;

  // ── Push-to-talk (TASK-83): границы фразы задаёт клавиша, а не детектор тишины ──
  private pushToTalkActive = false;
  /** Микрофон был открыт ради удержания — после отпускания его надо закрыть обратно. */
  private pushToTalkOwnedCapture = false;
  private pushToTalkSamples = 0;
  /**
   * Поколение нажатия push-to-talk. Холодный старт микрофона занимает секунды, и отпускание
   * клавиши легко приходит раньше, чем захват поднялся: счётчик позволяет отменить уже ненужный
   * запуск, вместо того чтобы включить запись после отпускания и залипнуть в ней.
   */
  private pushToTalkSeq = 0;
  /** Состояние детектора перебивания: судит только громкость во время собственной речи. */
  private bargeInState = createBargeInState();
  /** Типичная громкость речи пользователя по его фразам — от неё считается порог barge-in. */
  private userSpeechLevel: number | null = null;
  /** RMS звучащих чанков текущей фразы — по ним оценивается громкость пользователя. */
  private currentPhraseRms: number[] = [];
  /** Страховка от «залипшей» клавиши: дольше этого одна фраза не пишется. */
  private static readonly PUSH_TO_TALK_MAX_SAMPLES = 16000 * 60;
  private onPushToTalkCallbacks: Set<(active: boolean) => void> = new Set();

  /** Режим системной диктовки (TASK-83 п. 5): распознанное печатается в активное окно. */
  private dictationActive = false;
  private onDictationCallbacks: Set<(active: boolean) => void> = new Set();
  private speechStartTime = 0;
  private lastSoundTime = 0;
  private currentPhraseChunks: Float32Array[] = [];
  private noiseFloor = 0.005;

  // Web Speech API (engine: 'webspeech')
  private recognition: any = null;
  private isWebSpeechSupported = false;
  private webSpeechActive = false;
  private webSpeechRestartTimer: ReturnType<typeof setTimeout> | null = null;

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
    // Не трогаем localStorage и recognition.lang, если язык не изменился
    if (this.config.language === lang) return;
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
    // Web Speech API сам управляет устройством захвата — перезапуск нашего графа не нужен
    if (this.captureBackend === 'webspeech') return true;
    this.cleanupAudio();
    return await this.startHandsFreeListening(isFallback);
  }

  /** Какой backend захвата активен сейчас (для диагностики в настройках). */
  get activeCaptureBackend(): 'worklet' | 'script-processor' | 'webspeech' | null {
    return this.captureBackend;
  }

  get isWebSpeechAvailable(): boolean {
    return this.isWebSpeechSupported;
  }

  // ─────────────────────────────────────────────────────────────────
  // Local Whisper warmup (ленивая загрузка модели в main-процессе)
  // ─────────────────────────────────────────────────────────────────
  async warmupLocalWhisper(): Promise<LocalWhisperStatusInfo | null> {
    if (typeof window === 'undefined' || !window.api?.warmupLocalWhisper) return null;
    try {
      return await window.api.warmupLocalWhisper();
    } catch (e) {
      console.warn('[VoiceService] warmupLocalWhisper failed:', e);
      return null;
    }
  }

  async getLocalWhisperStatus(): Promise<LocalWhisperStatusInfo | null> {
    if (typeof window === 'undefined' || !window.api?.getLocalWhisperStatus) return null;
    try {
      return await window.api.getLocalWhisperStatus();
    } catch (e) {
      console.warn('[VoiceService] getLocalWhisperStatus failed:', e);
      return null;
    }
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
          // Пока говорит само приложение (или распознавание на паузе), результат — это его
          // собственная озвучка: гейт ttsMuted стоял только в Whisper-конвейере (TASK-87, дефект 5)
          if (this.isPaused || this.ttsMuted) return;

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
          const code = event?.error || 'unknown';
          console.warn('[VoiceService] WebSpeech error:', code);
          // 'no-speech' и 'aborted' — штатные события непрерывного режима, не ошибки
          if (code === 'no-speech' || code === 'aborted') return;
          const msg = this.config.language === 'ru'
            ? `Ошибка Web Speech API: ${code}`
            : `Web Speech API error: ${code}`;
          this.notifyError(msg);
          if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
            // Фатально: останавливаем, иначе onend уйдёт в бесконечный рестарт
            this.webSpeechActive = false;
            this.captureBackend = null;
            this.setState('error');
          }
        };

        this.recognition.onend = () => {
          // Continuous-режим Chrome всё равно завершает сессию — перезапускаем, пока слушаем
          if (this.webSpeechActive && this.isListening) {
            if (this.webSpeechRestartTimer) clearTimeout(this.webSpeechRestartTimer);
            this.webSpeechRestartTimer = setTimeout(() => {
              this.webSpeechRestartTimer = null;
              if (!this.webSpeechActive) return;
              try {
                this.recognition.start();
              } catch (e) {
                console.warn('[VoiceService] WebSpeech restart failed:', e);
              }
            }, 250);
            return;
          }
          if (this.isListening) {
            this.setState('idle');
          }
        };
      }
    }
  }

  /** engine: 'webspeech' — реальный запуск SpeechRecognition вместо Whisper-конвейера. */
  private startWebSpeechListening(): boolean {
    if (!this.isWebSpeechSupported || !this.recognition) {
      const msg = this.config.language === 'ru'
        ? 'Web Speech API недоступен в этой среде. Выберите движок Whisper в настройках голоса.'
        : 'Web Speech API is not available in this environment. Select the Whisper engine in voice settings.';
      this.notifyError(msg);
      this.setState('error');
      return false;
    }
    try {
      this.lastError = null;
      this.updateLanguage();
      this.webSpeechActive = true;
      this.captureBackend = 'webspeech';
      this.recognition.start();
      this.setState('listening_handsfree');
      console.log('[VoiceService] Web Speech API continuous recognition started');
      return true;
    } catch (err: any) {
      console.error('[VoiceService] Failed to start Web Speech API:', err);
      this.webSpeechActive = false;
      this.captureBackend = null;
      this.notifyError(err?.message || 'Web Speech API start failed');
      this.setState('error');
      return false;
    }
  }

  private stopWebSpeech() {
    this.webSpeechActive = false;
    if (this.webSpeechRestartTimer) {
      clearTimeout(this.webSpeechRestartTimer);
      this.webSpeechRestartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
    }
    if (this.captureBackend === 'webspeech') this.captureBackend = null;
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. Continuous Hands-Free Audio Stream (Talon Voice style)
  // ─────────────────────────────────────────────────────────────────
  async startHandsFreeListening(isFallback: boolean = false): Promise<boolean> {
    if (this.isListening) return true;

    // Движок Web Speech API: браузерное распознавание, Whisper-конвейер не запускается
    if (this.config.engine === 'webspeech') {
      return this.startWebSpeechListening();
    }

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

      // Первое включение hands-free с локальным Whisper — прогреваем модель в main-процессе
      // параллельно с запросом микрофона (на старте приложения она не грузится)
      if (this.config.whisperProvider === 'local') {
        void this.warmupLocalWhisper();
      }

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

      // Mute local output to prevent feedback echo loop while keeping processing active
      const muteGain = ctx.createGain();
      muteGain.gain.value = 0;
      this.muteGain = muteGain;

      const onChunk = (samples: Float32Array) => {
        const resampled16k = this.resampleTo16k(samples, ctx.sampleRate);
        this.processAudioChunkVAD(resampled16k);
      };

      const workletNode = await this.createCaptureWorklet(ctx, onChunk);
      if (workletNode) {
        // AudioWorklet: захват в отдельном аудиопотоке, чанки 4096 кадров приходят по transferList
        this.workletNode = workletNode;
        this.captureBackend = 'worklet';
        source.connect(workletNode);
        workletNode.connect(muteGain);
      } else {
        // Фолбэк для окружений без AudioWorklet: устаревший ScriptProcessorNode на главном потоке
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        this.audioProcessor = processor;
        this.captureBackend = 'script-processor';
        processor.onaudioprocess = (e) => {
          onChunk(e.inputBuffer.getChannelData(0));
        };
        source.connect(processor);
        processor.connect(muteGain);
      }
      muteGain.connect(ctx.destination);

      this.setState('listening_handsfree');
      console.log(`[VoiceService] Continuous Hands-Free listening active (Talon Voice style, backend: ${this.captureBackend})`);
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

  /**
   * Пытается поднять AudioWorklet-процессор захвата. Возвращает null, если
   * AudioWorklet недоступен или модуль не загрузился (тогда используется ScriptProcessorNode).
   */
  private async createCaptureWorklet(
    ctx: AudioContext,
    onChunk: (samples: Float32Array) => void
  ): Promise<AudioWorkletNode | null> {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      console.warn('[VoiceService] AudioWorklet is not available, falling back to ScriptProcessorNode');
      return null;
    }
    try {
      // Модуль лежит в public/ и грузится как 'self' (CSP script-src не пропускает blob:)
      const moduleUrl = new URL(VoiceService.WORKLET_URL, document.baseURI).href;
      await ctx.audioWorklet.addModule(moduleUrl);
      const node = new AudioWorkletNode(ctx, 'voice-capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1
      });
      node.port.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (data && data.type === 'chunk' && data.samples instanceof Float32Array) {
          onChunk(data.samples);
        }
      };
      return node;
    } catch (err) {
      console.warn('[VoiceService] AudioWorklet module failed to load, falling back to ScriptProcessorNode:', err);
      return null;
    }
  }

  private resetVAD() {
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.lastSoundTime = 0;
    this.pushToTalkSamples = 0;
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

    // Push-to-talk: пока клавиша удерживается, пишем всё подряд. Границы фразы задаёт пользователь,
    // поэтому ни порог тишины, ни пауза, ни глушение на время собственной речи здесь не действуют —
    // удержание клавиши это и есть команда «слушай меня сейчас».
    if (this.pushToTalkActive) {
      this.currentPhraseChunks.push(new Float32Array(chunk));
      this.pushToTalkSamples += chunk.length;

      let sumSquares = 0;
      for (let i = 0; i < chunk.length; i++) {
        sumSquares += chunk[i] * chunk[i];
      }
      const level = Math.min(1, Math.sqrt(sumSquares / chunk.length) * 15);
      this.onAudioLevelCallbacks.forEach((cb) => {
        try { cb(level, true); } catch (e) {}
      });

      if (this.pushToTalkSamples >= VoiceService.PUSH_TO_TALK_MAX_SAMPLES) {
        console.warn('[VoiceService] Push-to-talk phrase hit the 60s cap, dispatching early');
        void this.endPushToTalk();
      }
      return;
    }

    // Пауза пользователя или собственная речь приложения: звук не анализируем
    if (this.isPaused || this.ttsMuted) {
      // Исключение — barge-in (TASK-83 п. 3). Гейт остаётся прежним: фразы во время озвучки не
      // накапливаются и в распознавание не уходят. Но громкую и достаточно долгую речь человека мы
      // всё же замечаем и замолкаем — иначе перебить приложение голосом было бы нечем.
      if (this.ttsMuted && this.config.bargeInEnabled !== false) {
        let sumSquares = 0;
        for (let i = 0; i < chunk.length; i++) {
          sumSquares += chunk[i] * chunk[i];
        }
        const rms = Math.sqrt(sumSquares / chunk.length);
        const threshold = bargeInThresholdFor(this.userSpeechLevel);
        if (feedBargeIn(this.bargeInState, rms, Date.now(), { ...DEFAULT_BARGE_IN, threshold })) {
          console.log(`[VoiceService] Barge-in: речь пользователя во время озвучки (порог ${threshold.toFixed(3)}), останавливаем TTS`);
          void this.stopSpeaking();
        }
      }

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
      this.currentPhraseRms = [rms];
      return;
    }

    // 5. During Speech
    if (this.isSpeaking) {
      this.currentPhraseChunks.push(new Float32Array(chunk));

      if (hasSound) {
        this.lastSoundTime = now;
        this.currentPhraseRms.push(rms);
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
  private finalizeAndDispatchPhrase(): Promise<void> {
    this.isSpeaking = false;
    this.setState('transcribing');

    const phraseLevel = phraseSpeechLevel(this.currentPhraseRms);
    if (phraseLevel !== null) this.userSpeechLevel = updateSpeechLevel(this.userSpeechLevel, phraseLevel);
    this.currentPhraseRms = [];

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
    this.pushToTalkSamples = 0;

    // Ignore tiny blips (< 0.28s)
    if (totalSamples < 4500) {
      this.setState('listening_handsfree');
      return Promise.resolve();
    }

    console.log(`[VoiceService] Hands-Free phrase captured (${(totalSamples / 16000).toFixed(2)}s). Dispatching to Whisper worker...`);

    return this.dispatchToWhisper(fullPhrase)
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

    // Только whisperApiKey: ключ AI Studio (Anthropic/DeepSeek) к Groq/OpenAI не подходит
    const apiKey = whisperApiKey?.trim();
    if (!apiKey && whisperProvider !== 'local') {
      throw new Error(
        this.config.language === 'ru'
          ? `Не задан API-ключ для ${whisperProvider === 'groq' ? 'Groq' : 'OpenAI'} Whisper. Укажите его в настройках голоса.`
          : `API key for ${whisperProvider === 'groq' ? 'Groq' : 'OpenAI'} Whisper is not set. Enter it in voice settings.`
      );
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

  /**
   * Децимация в 16 кГц усреднением. Пишет в переиспользуемый scratch-буфер и
   * возвращает view на него — результат валиден только до следующего вызова
   * (processAudioChunkVAD копирует данные, когда накапливает фразу).
   */
  private resampleTo16k(audioData: Float32Array, origSampleRate: number): Float32Array {
    if (origSampleRate === 16000) return audioData;
    const ratio = origSampleRate / 16000;
    const newLength = Math.round(audioData.length / ratio);
    if (this.resampleScratch.length < newLength) {
      this.resampleScratch = new Float32Array(newLength);
    }
    const result = this.resampleScratch.subarray(0, newLength);
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
    this.stopWebSpeech();
    this.setState('idle');
  }

  private cleanupAudio() {
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'stop' });
        this.workletNode.port.onmessage = null;
        this.workletNode.disconnect();
      } catch {}
      this.workletNode = null;
    }
    if (this.audioProcessor) {
      this.audioProcessor.onaudioprocess = null;
      this.audioProcessor.disconnect();
      this.audioProcessor = null;
    }
    if (this.muteGain) {
      try { this.muteGain.disconnect(); } catch {}
      this.muteGain = null;
    }
    if (this.captureBackend !== 'webspeech') this.captureBackend = null;
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
  // 2.1 Push-to-talk по глобальной горячей клавише (TASK-83, п. 1)
  // ─────────────────────────────────────────────────────────────────
  get isPushToTalkActive(): boolean {
    return this.pushToTalkActive;
  }

  onPushToTalkChange(callback: (active: boolean) => void): () => void {
    this.onPushToTalkCallbacks.add(callback);
    try {
      callback(this.pushToTalkActive);
    } catch (e) {}
    return () => {
      this.onPushToTalkCallbacks.delete(callback);
    };
  }

  private notifyPushToTalk() {
    this.onPushToTalkCallbacks.forEach((cb) => {
      try { cb(this.pushToTalkActive); } catch (e) {}
    });
  }

  /**
   * Клавиша нажата: начинаем запись. Если hands-free выключен, микрофон открывается на время
   * удержания и закрывается после отпускания. Собственная озвучка при этом прерывается — удержание
   * клавиши означает «слушай меня», то есть работает как barge-in.
   */
  async beginPushToTalk(): Promise<boolean> {
    if (this.pushToTalkActive) return true;

    // Режим включается сразу, до подъёма микрофона: иначе отпускание, пришедшее во время
    // холодного старта, не нашло бы активной записи, вышло бы вхолостую — и флаг остался бы
    // поднятым навсегда.
    const seq = ++this.pushToTalkSeq;
    this.pushToTalkActive = true;
    this.notifyPushToTalk();

    const wasListening = this.isListening;
    if (!wasListening) {
      const started = await this.startHandsFreeListening();
      if (!started) {
        if (seq === this.pushToTalkSeq) {
          this.pushToTalkActive = false;
          this.notifyPushToTalk();
        }
        return false;
      }
    }

    if (seq !== this.pushToTalkSeq) {
      // Клавишу отпустили, пока поднимался микрофон. Запись не начинаем, а захват, открытый
      // ради этого нажатия, закрываем — иначе микрофон остался бы включённым без причины.
      if (!wasListening) {
        this.cleanupAudio();
        this.setState('idle');
      }
      return false;
    }

    this.pushToTalkOwnedCapture = !wasListening;

    // Web Speech API сам решает, где границы фразы: удержанием им управлять нечем, поэтому
    // для него push-to-talk сводится к включению распознавания на время удержания.
    if (this.config.engine === 'webspeech') {
      this.notifyPushToTalk();
      return true;
    }

    void this.stopSpeaking();
    this.isPaused = false;
    this.resetVAD();
    this.setState('speech_detected');
    this.notifyPushToTalk();
    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  // 2.2 Режим системной диктовки (TASK-83, п. 5)
  // ─────────────────────────────────────────────────────────────────
  get isDictationActive(): boolean {
    return this.dictationActive;
  }

  onDictationChange(callback: (active: boolean) => void): () => void {
    this.onDictationCallbacks.add(callback);
    try {
      callback(this.dictationActive);
    } catch (e) {}
    return () => {
      this.onDictationCallbacks.delete(callback);
    };
  }

  setDictationActive(active: boolean) {
    if (this.dictationActive === active) return;
    this.dictationActive = active;
    this.onDictationCallbacks.forEach((cb) => {
      try { cb(active); } catch (e) {}
    });
  }

  /** Клавиша отпущена: накопленная фраза немедленно уходит в распознавание. */
  async endPushToTalk(): Promise<void> {
    if (!this.pushToTalkActive) return;
    // Отменяем запуск, который может быть ещё в процессе: он увидит смену поколения и свернётся.
    this.pushToTalkSeq++;
    this.pushToTalkActive = false;
    this.notifyPushToTalk();

    const ownedCapture = this.pushToTalkOwnedCapture;
    this.pushToTalkOwnedCapture = false;

    if (this.config.engine === 'webspeech') {
      if (ownedCapture) this.stopListening();
      return;
    }

    const pending = this.currentPhraseChunks.length > 0 ? this.finalizeAndDispatchPhrase() : Promise.resolve();

    if (!ownedCapture) {
      await pending;
      return;
    }

    // Микрофон открывали ради удержания — закрываем, но только после того, как фраза ушла в Whisper.
    await pending.catch(() => {});
    this.cleanupAudio();
    this.setState('idle');
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. Text-To-Speech (TTS) Synthesis
  // ─────────────────────────────────────────────────────────────────
  /** Подписки на потоковые события синтеза из main ставятся один раз при первом обращении. */
  private ttsListenersBound = false;
  private ttsJobCounter = 0;
  private activeTtsJob: {
    id: string;
    finish: (playedAudio: boolean) => void;
    playedChunks: number;
    generationDone: boolean;
  } | null = null;
  private lastTtsError: string | null = null;

  /** Последняя причина, по которой локальный движок не сработал (показывается в настройках). */
  getLastTtsError(): string | null {
    return this.lastTtsError;
  }

  private setTtsMuted(muted: boolean) {
    this.ttsMuted = muted;
    // Каждая реплика судится заново: и старт озвучки, и её конец сбрасывают детектор перебивания.
    resetBargeIn(this.bargeInState);
    // Сбрасываем накопленную фразу, чтобы хвост собственной речи не ушёл в распознавание
    if (muted) this.resetVAD();
  }

  /** Голос по умолчанию для языка, если пользователь не выбрал свой (см. ttsVoiceRegistry). */
  private resolveTtsVoiceId(lang: 'ru' | 'en'): string {
    if (this.config.ttsVoiceId) return this.config.ttsVoiceId;
    return lang === 'en' ? 'en_US-amy-medium' : 'ru_RU-irina-medium';
  }

  private bindTtsListeners() {
    if (this.ttsListenersBound || typeof window === 'undefined' || !window.api?.onTtsChunk) return;
    this.ttsListenersBound = true;

    window.api.onTtsChunk((chunk) => {
      const job = this.activeTtsJob;
      if (!job || job.id !== chunk.jobId) return;
      void ttsPlayer
        .enqueue(chunk.jobId, chunk.samples, chunk.sampleRate, {
          sinkId: this.config.audioOutputDeviceId || '',
          volume: this.config.ttsVolume
        })
        .then((accepted) => {
          if (accepted) job.playedChunks += 1;
        });
    });

    window.api.onTtsDone((info) => {
      const job = this.activeTtsJob;
      if (!job || job.id !== info.jobId) return;
      job.generationDone = true;
      // Генерация завершена, но очередь может ещё звучать — ждём её опустошения
      if (!ttsPlayer.isPlaying) job.finish(job.playedChunks > 0);
    });

    window.api.onTtsError((info) => {
      const job = this.activeTtsJob;
      if (!job || job.id !== info.jobId) return;
      this.lastTtsError = info.error;
      job.finish(job.playedChunks > 0);
    });

    ttsPlayer.onEnded(() => {
      const job = this.activeTtsJob;
      if (job && job.generationDone) job.finish(job.playedChunks > 0);
    });
  }

  /**
   * Озвучивает текст выбранным движком. Если локальный Piper недоступен или не успел выдать
   * ни одного чанка, происходит деградация в системный `speechSynthesis` — без краха (AC#7).
   */
  async speak(text: string, lang?: 'ru' | 'en'): Promise<void> {
    if (typeof window === 'undefined' || !this.config.ttsEnabled) return;
    const language = lang || this.config.language;

    if (this.config.ttsEngine === 'piper') {
      const handled = await this.speakWithPiper(text, language);
      if (handled) return;
    }

    return this.speakWithSystem(text, language);
  }

  /**
   * Локальный синтез: main отдаёт PCM по предложениям, звук играет через AudioContext с
   * выбранным устройством вывода.
   * @returns true, если озвучка состоялась; false — нужен системный движок
   */
  private async speakWithPiper(text: string, lang: 'ru' | 'en'): Promise<boolean> {
    const api = window.api;
    if (!api?.speakTts || !api.getTtsStatus) return false;

    try {
      const status = await api.getTtsStatus();
      if (!status?.available) {
        this.lastTtsError = status?.error || 'Local TTS engine is unavailable';
        return false;
      }
    } catch (err) {
      this.lastTtsError = err instanceof Error ? err.message : String(err);
      return false;
    }

    this.bindTtsListeners();
    // Повторный speak() без stopSpeaking(): предыдущее задание завершается явно, иначе его промис
    // не резолвится никогда (события придут с чужим jobId и будут отброшены), а генерация в main
    // продолжит считать уже ненужный текст (TASK-87, дефект 4)
    await this.finishActiveTtsJob();

    const jobId = `tts-${++this.ttsJobCounter}-${Date.now()}`;
    await ttsPlayer.begin(jobId);
    this.setTtsMuted(true);

    const played = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (playedAudio: boolean) => {
        if (settled) return;
        settled = true;
        if (this.activeTtsJob?.id === jobId) this.activeTtsJob = null;
        this.setTtsMuted(false);
        resolve(playedAudio);
      };
      this.activeTtsJob = { id: jobId, finish, playedChunks: 0, generationDone: false };

      api
        .speakTts({ jobId, text, voiceId: this.resolveTtsVoiceId(lang), speed: this.config.ttsSpeed })
        .then((res) => {
          if (!res?.ok) {
            this.lastTtsError = res?.error || 'Local TTS synthesis failed';
            finish(false);
          }
        })
        .catch((err) => {
          this.lastTtsError = err instanceof Error ? err.message : String(err);
          finish(false);
        });
    });

    if (played) this.lastTtsError = null;
    return played;
  }

  private speakWithSystem(text: string, lang: 'ru' | 'en'): Promise<void> {
    return new Promise<void>((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'en' ? 'en-US' : 'ru-RU';
      utterance.rate = 1.1;
      utterance.pitch = 1.0;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      this.setTtsMuted(true);
      window.speechSynthesis.speak(utterance);
    }).then(() => {
      this.setTtsMuted(false);
    });
  }

  /**
   * Завершает текущее задание синтеза: отменяет генерацию в main и резолвит его промис.
   * Общий путь для stopSpeaking() и для новой озвучки поверх текущей.
   */
  private async finishActiveTtsJob(): Promise<void> {
    const job = this.activeTtsJob;
    if (!job) return;
    try {
      await window.api?.cancelTts?.(job.id);
    } catch {
      // воркер мог уже завершиться — остановки воспроизведения достаточно
    }
    job.finish(job.playedChunks > 0);
  }

  /** Останавливает озвучку обоими движками: и генерацию по jobId, и воспроизведение. */
  async stopSpeaking(): Promise<void> {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    await this.finishActiveTtsJob();

    await ttsPlayer.stop();
    this.setTtsMuted(false);
  }
}

export const voiceService = new VoiceService();

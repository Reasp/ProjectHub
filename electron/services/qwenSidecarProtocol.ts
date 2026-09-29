/**
 * Протокол обмена с сайдкаром Qwen3-TTS: строки JSON по stdin/stdout (TASK-104, decision-64).
 *
 * Чистый модуль: без процессов и Electron — покрыт unit-тестами.
 */
import { StringDecoder } from 'node:string_decoder';

export type QwenSidecarMessage =
  | { type: 'ready'; python?: string; torch?: string; cuda?: boolean; gpu?: string | null }
  | {
      type: 'loaded';
      id: string;
      kind: string;
      loadMs: number;
      warmupMs: number;
      sampleRate: number;
      vramMb?: number;
      speakers?: string[];
    }
  | { type: 'chunk'; id: string; index: number; sampleRate: number; pcm: string }
  | { type: 'done'; id: string; audioSec: number; genMs: number; firstChunkMs: number | null; chunks: number }
  | { type: 'cancelled'; id: string }
  | { type: 'unloaded'; id: string }
  | { type: 'error'; id: string | null; code: string; error: string };

const MESSAGE_TYPES = new Set(['ready', 'loaded', 'chunk', 'done', 'cancelled', 'unloaded', 'error']);

/** Строка протокола → сообщение; всё, что не похоже на сообщение сайдкара, отбрасывается. */
export function parseSidecarMessage(line: string): QwenSidecarMessage | null {
  const text = line.trim();
  if (!text.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const msg = parsed as Record<string, unknown>;
  if (typeof msg.type !== 'string' || !MESSAGE_TYPES.has(msg.type)) return null;
  if (msg.type === 'ready') return msg as QwenSidecarMessage;
  if (msg.type === 'error') {
    return {
      type: 'error',
      id: typeof msg.id === 'string' ? msg.id : null,
      code: typeof msg.code === 'string' ? msg.code : 'qwen_synthesis_failed',
      error: typeof msg.error === 'string' ? msg.error : ''
    };
  }
  if (typeof msg.id !== 'string') return null;
  if (msg.type === 'chunk' && (typeof msg.pcm !== 'string' || typeof msg.sampleRate !== 'number')) return null;
  return msg as QwenSidecarMessage;
}

/**
 * Собирает строки из потока stdout. Граница чанка может пройти посреди строки и даже посреди
 * многобайтного символа, поэтому декодирование идёт через `StringDecoder`.
 */
export function createLineSplitter(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  const decoder = new StringDecoder('utf8');
  let tail = '';
  return (chunk) => {
    tail += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let newline = tail.indexOf('\n');
    while (newline >= 0) {
      const line = tail.slice(0, newline).replace(/\r$/, '');
      tail = tail.slice(newline + 1);
      if (line) onLine(line);
      newline = tail.indexOf('\n');
    }
  };
}

/** PCM int16 little-endian в base64 → отсчёты в диапазоне -1..1 для `AudioContext`. */
export function decodePcm16(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64');
  const count = Math.floor(bytes.length / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) samples[i] = bytes.readInt16LE(i * 2) / 32768;
  return samples;
}

/** Отсчёты -1..1 → файл WAV (моно, 16 бит): в таком виде хранится эталонная запись голоса. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // моно
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    wav.writeInt16LE(Math.round(clipped * 32767), 44 + i * 2);
  }
  return wav;
}

export function encodeSidecarRequest(request: Record<string, unknown>): string {
  return `${JSON.stringify(request)}\n`;
}

import { describe, expect, it } from 'vitest';

import {
  createLineSplitter,
  decodePcm16,
  encodeSidecarRequest,
  encodeWav16,
  parseSidecarMessage
} from '../../electron/services/qwenSidecarProtocol';

describe('протокол сайдкара Qwen3-TTS (TASK-104)', () => {
  it('разбирает сообщения сайдкара', () => {
    expect(parseSidecarMessage('{"type":"ready","python":"3.11.15","cuda":true,"gpu":"RTX 2080"}')).toMatchObject({
      type: 'ready',
      cuda: true
    });
    expect(parseSidecarMessage('{"type":"done","id":"j1","audioSec":3.2,"genMs":3292,"firstChunkMs":936,"chunks":5}')).toMatchObject({
      type: 'done',
      id: 'j1',
      chunks: 5
    });
    expect(parseSidecarMessage('  {"type":"cancelled","id":"j2"}  ')).toEqual({ type: 'cancelled', id: 'j2' });
  });

  it('ошибка без id относится к запуску; неизвестный код не теряется до замены в сервисе', () => {
    expect(parseSidecarMessage('{"type":"error","id":null,"code":"qwen_runtime_broken","error":"no torch"}')).toEqual({
      type: 'error',
      id: null,
      code: 'qwen_runtime_broken',
      error: 'no torch'
    });
    expect(parseSidecarMessage('{"type":"error","id":"j1"}')).toEqual({
      type: 'error',
      id: 'j1',
      code: 'qwen_synthesis_failed',
      error: ''
    });
  });

  it('отбрасывает всё, что не является сообщением протокола', () => {
    expect(parseSidecarMessage('Loading weights: 100%')).toBeNull();
    expect(parseSidecarMessage('')).toBeNull();
    expect(parseSidecarMessage('{broken json')).toBeNull();
    expect(parseSidecarMessage('[1,2,3]')).toBeNull();
    expect(parseSidecarMessage('{"type":"unknown","id":"x"}')).toBeNull();
    expect(parseSidecarMessage('{"type":"done"}')).toBeNull();
    expect(parseSidecarMessage('{"type":"chunk","id":"j1","index":0,"sampleRate":24000}')).toBeNull();
    expect(parseSidecarMessage('{"type":"chunk","id":"j1","index":0,"pcm":"AAA="}')).toBeNull();
  });

  it('декодирует PCM int16 в отсчёты -1..1', () => {
    const pcm = Buffer.alloc(8);
    pcm.writeInt16LE(0, 0);
    pcm.writeInt16LE(16384, 2);
    pcm.writeInt16LE(-32768, 4);
    pcm.writeInt16LE(32767, 6);
    const samples = decodePcm16(pcm.toString('base64'));
    expect(samples).toBeInstanceOf(Float32Array);
    expect(Array.from(samples)).toEqual([0, 0.5, -1, 32767 / 32768]);
  });

  it('нечётный хвост и пустая строка не ломают декодирование', () => {
    expect(decodePcm16(Buffer.from([1, 0, 9]).toString('base64'))).toHaveLength(1);
    expect(decodePcm16('')).toHaveLength(0);
  });

  it('эталонная запись голоса — WAV моно 16 бит', () => {
    const wav = encodeWav16(new Float32Array([0, 0.5, -1, 1, 2, -3]), 24000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(28)).toBe(48000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(12);
    expect(wav).toHaveLength(44 + 12);
    // отсчёты за пределами -1..1 обрезаются, а не переполняют int16
    const samples = [0, 1, 2, 3, 4, 5].map((i) => wav.readInt16LE(44 + i * 2));
    expect(samples).toEqual([0, 16384, -32767, 32767, 32767, -32767]);
  });

  it('запись и чтение PCM обратимы с точностью до квантования', () => {
    const source = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.8);
    const wav = encodeWav16(source, 24000);
    const back = decodePcm16(wav.subarray(44).toString('base64'));
    expect(back).toHaveLength(100);
    for (let i = 0; i < 100; i += 1) expect(Math.abs(back[i] - source[i])).toBeLessThan(1 / 16000);
  });

  it('запрос — одна строка JSON с переводом строки, кириллица сохраняется', () => {
    const line = encodeSidecarRequest({ type: 'synthesize', id: 'j1', text: 'Привет,\nмир' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({ type: 'synthesize', id: 'j1', text: 'Привет,\nмир' });
  });
});

describe('сборка строк из потока stdout', () => {
  it('строка, разрезанная границей чанка, собирается целиком', () => {
    const lines: string[] = [];
    const feed = createLineSplitter((line) => lines.push(line));
    feed(Buffer.from('{"type":"rea'));
    expect(lines).toEqual([]);
    feed(Buffer.from('dy"}\n{"type":"cancelled","id":"j1"}\r\n{"ty'));
    expect(lines).toEqual(['{"type":"ready"}', '{"type":"cancelled","id":"j1"}']);
    feed('pe":"x"}\n');
    expect(lines).toHaveLength(3);
  });

  it('многобайтный символ на границе чанка не портится', () => {
    const lines: string[] = [];
    const feed = createLineSplitter((line) => lines.push(line));
    const bytes = Buffer.from('{"error":"Ошибка"}\n', 'utf8');
    // граница проходит посреди двухбайтной буквы «ш»
    const cut = bytes.indexOf(Buffer.from('ш', 'utf8')) + 1;
    feed(bytes.subarray(0, cut));
    feed(bytes.subarray(cut));
    expect(lines).toEqual(['{"error":"Ошибка"}']);
  });

  it('пустые строки пропускаются', () => {
    const lines: string[] = [];
    createLineSplitter((line) => lines.push(line))('\n\na\n\nb\n');
    expect(lines).toEqual(['a', 'b']);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileLogger, formatLogLine, parseLogLevel, rotatedFileName } from '../../electron/services/logger';

describe('logger: чистые помощники', () => {
  it('parseLogLevel понимает регистр, warning и мусор', () => {
    expect(parseLogLevel('WARN', 'info')).toBe('warn');
    expect(parseLogLevel(' warning ', 'info')).toBe('warn');
    expect(parseLogLevel('debug', 'info')).toBe('debug');
    expect(parseLogLevel(undefined, 'info')).toBe('info');
    expect(parseLogLevel('verbose', 'error')).toBe('error');
  });

  it('formatLogLine: ISO-время, тег уровня, util.format для аргументов и стек для Error', () => {
    const at = new Date('2026-09-07T00:00:00.000Z');
    expect(formatLogLine('info', ['hello', 42], at)).toBe('2026-09-07T00:00:00.000Z [INFO] hello 42');
    expect(formatLogLine('warn', ['%s=%d', 'x', 5], at)).toBe('2026-09-07T00:00:00.000Z [WARN] x=5');
    const line = formatLogLine('error', ['boom:', new Error('bad')], at);
    expect(line.startsWith('2026-09-07T00:00:00.000Z [ERROR] boom: Error: bad')).toBe(true);
    expect(formatLogLine('debug', [{ a: 1 }], at)).toContain('{ a: 1 }');
  });

  it('rotatedFileName вставляет номер перед расширением', () => {
    expect(rotatedFileName('main.log', 2)).toBe('main.2.log');
    expect(rotatedFileName('noext', 1)).toBe('noext.1');
  });
});

describe('FileLogger: файл, буфер и ротация', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-logger-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('строки, записанные до init, попадают в файл после init', () => {
    const log = new FileLogger();
    log.write('info', ['early line']);
    expect(log.path).toBeNull();
    log.init({ dir, fileName: 'app.log' });
    const content = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
    expect(content).toContain('[INFO] early line');
  });

  it('минимальный уровень отсекает записи ниже порога', () => {
    const log = new FileLogger();
    log.init({ dir, minLevel: 'warn' });
    log.write('debug', ['hidden']);
    log.write('info', ['hidden too']);
    log.write('warn', ['visible']);
    const content = fs.readFileSync(path.join(dir, 'main.log'), 'utf8');
    expect(content).not.toContain('hidden');
    expect(content).toContain('[WARN] visible');
    expect(log.isEnabled('info')).toBe(false);
    log.setLevel('debug');
    expect(log.isEnabled('debug')).toBe(true);
  });

  it('ротация по размеру: main.log → main.1.log → main.2.log, лишние удаляются', () => {
    const log = new FileLogger();
    log.init({ dir, maxBytes: 120, maxFiles: 2 });
    for (let i = 0; i < 12; i++) log.write('info', [`line-${i} ${'x'.repeat(30)}`]);

    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    expect(files).not.toContain('main.3.log');

    const newest = fs.readFileSync(path.join(dir, 'main.log'), 'utf8');
    const older = fs.readFileSync(path.join(dir, 'main.1.log'), 'utf8');
    expect(newest).toContain('line-11');
    expect(older).not.toContain('line-11');
    for (const f of files) expect(fs.statSync(path.join(dir, f)).size).toBeLessThanOrEqual(120 + 60);
  });

  it('повторный init подхватывает размер существующего файла', () => {
    const log = new FileLogger();
    log.init({ dir, maxBytes: 100 });
    log.write('info', ['a'.repeat(80)]);
    const again = new FileLogger();
    again.init({ dir, maxBytes: 100 });
    again.write('info', ['b'.repeat(80)]);
    // Второй логгер увидел ~110 байт и должен был отротировать перед записью.
    expect(fs.existsSync(path.join(dir, 'main.1.log'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'main.log'), 'utf8')).toContain('b'.repeat(80));
  });

  it('captureConsole: оригинальный вывод сохраняется, копия уходит в файл; restoreConsole откатывает', () => {
    const log = new FileLogger();
    log.init({ dir });
    const originalLog = vi.fn();
    const originalError = vi.fn();
    const fake = { log: originalLog, info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: originalError } as unknown as Console;

    log.captureConsole(fake);
    log.captureConsole(fake); // идемпотентно
    fake.log('from console', 1);
    fake.error('oops');

    expect(originalLog).toHaveBeenCalledWith('from console', 1);
    expect(originalError).toHaveBeenCalledWith('oops');
    const content = fs.readFileSync(path.join(dir, 'main.log'), 'utf8');
    expect(content).toContain('[INFO] from console 1');
    expect(content).toContain('[ERROR] oops');

    log.restoreConsole(fake);
    expect(fake.log).toBe(originalLog);
    expect(fake.error).toBe(originalError);
  });

  it('logger.info/warn/error пишут в файл и печатают через оригинальный console', () => {
    const log = new FileLogger();
    log.init({ dir, minLevel: 'info' });
    const originalLog = vi.fn();
    const originalWarn = vi.fn();
    const originalDebug = vi.fn();
    const fake = { log: originalLog, info: vi.fn(), debug: originalDebug, warn: originalWarn, error: vi.fn() } as unknown as Console;
    log.captureConsole(fake);

    log.info('renderer said', 'hi');
    log.warn('careful');
    log.debug('silent');

    expect(originalLog).toHaveBeenCalledWith('renderer said', 'hi');
    expect(originalWarn).toHaveBeenCalledWith('careful');
    expect(originalDebug).not.toHaveBeenCalled();
    const content = fs.readFileSync(path.join(dir, 'main.log'), 'utf8');
    expect(content).toContain('[INFO] renderer said hi');
    expect(content).toContain('[WARN] careful');
    expect(content).not.toContain('silent');
  });
});

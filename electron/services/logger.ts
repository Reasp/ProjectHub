/**
 * Простой файловый логгер main-процесса (TASK-49, аудит 7.3).
 *
 * - Уровни `debug` < `info` < `warn` < `error`; минимальный уровень — `PROJECTHUB_LOG_LEVEL`
 *   (по умолчанию `debug` в dev, `info` в упакованном приложении).
 * - Пишет в `<userData>/logs/main.log`, ротация по размеру: `main.log` → `main.1.log` → … → `main.N.log`.
 * - До `init()` строки копятся в памяти (ограниченный буфер) и сбрасываются в файл при инициализации,
 *   чтобы не терять ранний вывод при старте приложения.
 * - `captureConsole()` оборачивает `console.*`, так что существующие `console.log/warn/error` по всему
 *   main-процессу попадают и в stdout (как раньше), и в файл.
 *
 * Запись синхронная (`appendFileSync`): объём логов небольшой, зато строки не теряются при падении
 * процесса (`uncaughtException`) и не нужен отдельный flush при выходе.
 */
import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_TAG: Record<LogLevel, string> = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR' };

export const DEFAULT_LOG_FILE = 'main.log';
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_FILES = 3;
const PREINIT_BUFFER_LIMIT = 500;

export interface LoggerInitOptions {
  /** Каталог логов (создаётся при необходимости). */
  dir: string;
  fileName?: string;
  /** Порог ротации основного файла в байтах. */
  maxBytes?: number;
  /** Сколько архивных файлов хранить (`main.1.log` … `main.N.log`). */
  maxFiles?: number;
  minLevel?: LogLevel;
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in LEVEL_ORDER;
}

/** Уровень из строки окружения; при мусоре — `fallback`. */
export function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  const v = value?.trim().toLowerCase();
  if (v === 'warning') return 'warn';
  return isLogLevel(v) ? v : fallback;
}

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  return format('%o', arg);
}

/** Одна строка лога: `2026-09-07T00:00:00.000Z [WARN] текст`; многострочные аргументы сохраняются как есть. */
export function formatLogLine(level: LogLevel, args: unknown[], date: Date = new Date()): string {
  const text =
    args.length > 1 && typeof args[0] === 'string'
      ? format(args[0], ...args.slice(1).map((a) => (a instanceof Error ? stringifyArg(a) : a)))
      : args.map(stringifyArg).join(' ');
  return `${date.toISOString()} [${LEVEL_TAG[level]}] ${text}`;
}

/** Имя архивного файла с номером `n`: `main.log` → `main.3.log`. */
export function rotatedFileName(fileName: string, n: number): string {
  const ext = path.extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  return `${base}.${n}${ext}`;
}

type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';
type ConsoleFn = (...args: unknown[]) => void;
const CONSOLE_LEVELS: Record<ConsoleMethod, LogLevel> = {
  log: 'info',
  info: 'info',
  debug: 'debug',
  warn: 'warn',
  error: 'error'
};

export class FileLogger {
  private filePath: string | null = null;
  private maxBytes = DEFAULT_MAX_BYTES;
  private maxFiles = DEFAULT_MAX_FILES;
  private minLevel: LogLevel = 'debug';
  private size = 0;
  private buffer: string[] = [];
  private droppedBeforeInit = 0;
  private disabled = false;
  private originalConsole: Partial<Record<ConsoleMethod, ConsoleFn>> | null = null;

  get path(): string | null {
    return this.filePath;
  }

  get level(): LogLevel {
    return this.minLevel;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  isEnabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  /** Открывает файл, сбрасывает накопленный до инициализации буфер. Повторный вызов переоткрывает файл. */
  init(options: LoggerInitOptions): void {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    if (options.minLevel) this.minLevel = options.minLevel;
    try {
      fs.mkdirSync(options.dir, { recursive: true });
      this.filePath = path.join(options.dir, options.fileName ?? DEFAULT_LOG_FILE);
      this.size = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0;
      this.disabled = false;
    } catch (err) {
      this.disabled = true;
      this.filePath = null;
      this.originalConsole?.error?.('[Logger] Не удалось открыть файл лога:', err);
      return;
    }
    const pending = this.buffer.splice(0);
    if (this.droppedBeforeInit > 0) {
      pending.unshift(
        formatLogLine('warn', [`[Logger] ${this.droppedBeforeInit} ранних строк лога отброшено (переполнение буфера)`])
      );
      this.droppedBeforeInit = 0;
    }
    for (const line of pending) this.append(line);
  }

  /** Пишет строку в файл (без вывода в консоль). */
  write(level: LogLevel, args: unknown[]): void {
    if (this.disabled || !this.isEnabled(level)) return;
    const line = formatLogLine(level, args);
    if (!this.filePath) {
      if (this.buffer.length >= PREINIT_BUFFER_LIMIT) {
        this.buffer.shift();
        this.droppedBeforeInit++;
      }
      this.buffer.push(line);
      return;
    }
    this.append(line);
  }

  private append(line: string): void {
    if (!this.filePath) return;
    const chunk = `${line}\n`;
    const bytes = Buffer.byteLength(chunk);
    try {
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
      fs.appendFileSync(this.filePath, chunk, 'utf8');
      this.size += bytes;
    } catch (err) {
      // Диск недоступен/занят — отключаем файл, чтобы не падать в цикле console.error → write → error.
      this.disabled = true;
      this.originalConsole?.error?.('[Logger] Запись лога отключена:', err);
    }
  }

  /** `main.log` → `main.1.log`, старые сдвигаются, лишние удаляются. */
  rotate(): void {
    if (!this.filePath) return;
    const dir = path.dirname(this.filePath);
    const name = path.basename(this.filePath);
    if (this.maxFiles <= 0) {
      fs.rmSync(this.filePath, { force: true });
      this.size = 0;
      return;
    }
    fs.rmSync(path.join(dir, rotatedFileName(name, this.maxFiles)), { force: true });
    for (let n = this.maxFiles; n >= 1; n--) {
      const from = n === 1 ? this.filePath : path.join(dir, rotatedFileName(name, n - 1));
      if (!fs.existsSync(from)) continue;
      fs.renameSync(from, path.join(dir, rotatedFileName(name, n)));
    }
    this.size = 0;
  }

  private emit(level: LogLevel, args: unknown[]): void {
    this.write(level, args);
    if (!this.isEnabled(level)) return;
    const method: ConsoleMethod = level === 'info' ? 'log' : level;
    const original = this.originalConsole?.[method];
    if (original) original.call(console, ...args);
    else console[method](...args);
  }

  debug(...args: unknown[]): void {
    this.emit('debug', args);
  }

  info(...args: unknown[]): void {
    this.emit('info', args);
  }

  warn(...args: unknown[]): void {
    this.emit('warn', args);
  }

  error(...args: unknown[]): void {
    this.emit('error', args);
  }

  /**
   * Оборачивает `console.log/info/debug/warn/error`: вывод в stdout/stderr остаётся, копия уходит в файл.
   * Идемпотентно.
   */
  captureConsole(target: Console = console): void {
    if (this.originalConsole) return;
    this.originalConsole = {};
    for (const method of Object.keys(CONSOLE_LEVELS) as ConsoleMethod[]) {
      const original = target[method] as ConsoleFn;
      this.originalConsole[method] = original;
      const level = CONSOLE_LEVELS[method];
      target[method] = (...args: unknown[]) => {
        original.call(target, ...args);
        this.write(level, args);
      };
    }
  }

  /** Возвращает оригинальные методы `console` (для тестов). */
  restoreConsole(target: Console = console): void {
    if (!this.originalConsole) return;
    for (const method of Object.keys(CONSOLE_LEVELS) as ConsoleMethod[]) {
      const original = this.originalConsole[method];
      if (original) target[method] = original as Console[typeof method];
    }
    this.originalConsole = null;
  }
}

export const logger = new FileLogger();

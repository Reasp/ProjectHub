/**
 * Кольцевые буферы вывода агента Swarm (TASK-56).
 *
 * `agent.logs[]` и `agent.liveOutput` раньше росли без ограничений: длинный прогон агента
 * раздувал память main-процесса и рендерера (сессия целиком уходит в каждом событии IPC).
 * Теперь в памяти хранится только «хвост» ограниченного размера, а полный транскрипт
 * пишется в файл (`SwarmSessionStore.appendTranscript`) и читается из UI по запросу.
 */

export interface AgentLogLimits {
  /** Максимум строк в `logs`. */
  maxLines: number;
  /** Максимум байт суммарно в `logs`. */
  maxBytes: number;
  /** Максимум символов в `liveOutput` (хвост потокового вывода для UI). */
  maxLiveOutputChars: number;
}

export const AGENT_LOG_LIMITS: AgentLogLimits = {
  maxLines: 400,
  maxBytes: 256 * 1024,
  maxLiveOutputChars: 200_000
};

export interface AgentLogTarget {
  logs: string[];
  /** Сколько строк уже вытеснено из буфера (для подписи в UI). */
  logsDropped?: number;
}

export interface AgentOutputTarget {
  liveOutput: string;
  /** Начало вывода вытеснено из памяти — полный текст только в файле транскрипта. */
  liveOutputTruncated?: boolean;
}

/** Байты буфера `logs` считаем инкрементально, без пересчёта всего массива на каждую строку. */
const logBytesByArray = new WeakMap<string[], number>();

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

function recomputeBytes(logs: string[]): number {
  let total = 0;
  for (const line of logs) total += byteLength(line);
  logBytesByArray.set(logs, total);
  return total;
}

/** Добавляет строку в `logs`, вытесняя самые старые строки при превышении лимитов. */
export function pushAgentLog(target: AgentLogTarget, line: string, limits: AgentLogLimits = AGENT_LOG_LIMITS): void {
  let text = typeof line === 'string' ? line : String(line);
  // Одна строка больше всего буфера — оставляем её хвост, иначе буфер никогда не сойдётся.
  if (byteLength(text) > limits.maxBytes) {
    const keep = Math.max(1, Math.floor(limits.maxBytes / 2));
    text = `…[усечено] ${text.slice(-keep)}`;
  }
  const logs = target.logs;
  let bytes = logBytesByArray.get(logs);
  if (bytes === undefined) bytes = recomputeBytes(logs);
  logs.push(text);
  bytes += byteLength(text);
  let dropped = 0;
  while (logs.length > 1 && (logs.length > limits.maxLines || bytes > limits.maxBytes)) {
    const removed = logs.shift()!;
    bytes -= byteLength(removed);
    dropped++;
  }
  logBytesByArray.set(logs, Math.max(0, bytes));
  if (dropped > 0) target.logsDropped = (target.logsDropped ?? 0) + dropped;
}

/** Добавляет чанк к `liveOutput`, оставляя только хвост не длиннее лимита. */
export function appendLiveOutput(target: AgentOutputTarget, text: string, limits: AgentLogLimits = AGENT_LOG_LIMITS): void {
  if (!text) return;
  const combined = target.liveOutput + text;
  if (combined.length <= limits.maxLiveOutputChars) {
    target.liveOutput = combined;
    return;
  }
  target.liveOutput = combined.slice(combined.length - limits.maxLiveOutputChars);
  target.liveOutputTruncated = true;
}

/** Сбрасывает `liveOutput` (например, перед повторным запуском агента). */
export function resetLiveOutput(target: AgentOutputTarget): void {
  target.liveOutput = '';
  target.liveOutputTruncated = false;
}

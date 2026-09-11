import net from 'node:net';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

/**
 * Порты для действий из `.projecthub.json` (TASK-62, decision-15).
 *
 * При `portStrategy: 'auto'` два worktree одного проекта могут держать свои dev-серверы
 * одновременно: ProjectHub подбирает свободный порт, кладёт его в `PORT` и подставляет
 * в команду и `autoOpenUrl` вместо плейсхолдера `${port}`.
 *
 * Парсеры вывода `netstat`/`lsof` вынесены в чистые функции и покрыты unit-тестами.
 */

/** Порт, с которого начинается поиск свободного, если действие не задало свой. */
export const DEFAULT_PORT_SEARCH_START = 5173;
/** Сколько портов подряд просматривать при поиске свободного. */
export const PORT_SEARCH_RANGE = 200;

const PORT_PLACEHOLDER_RE = /\$\{port\}|\{\{port\}\}/gi;

/** Есть ли в строке плейсхолдер порта (`${port}` / `{{port}}`). */
export function hasPortPlaceholder(text: string | undefined): boolean {
  if (!text) return false;
  PORT_PLACEHOLDER_RE.lastIndex = 0;
  return PORT_PLACEHOLDER_RE.test(text);
}

/** Подставляет номер порта вместо всех плейсхолдеров `${port}` / `{{port}}`. */
export function substitutePort(text: string, port: number): string {
  return text.replace(PORT_PLACEHOLDER_RE, String(port));
}

/** Валидный номер TCP-порта (1..65535). */
export function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Свободен ли TCP-порт на `host`: пробуем занять его сами.
 * `EADDRINUSE`/`EACCES` — занят, остальные ошибки тоже считаем «нельзя занять».
 */
export function isPortFree(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    const done = (free: boolean) => {
      server.removeAllListeners();
      server.close(() => resolve(free));
    };
    server.once('error', () => {
      server.removeAllListeners();
      resolve(false);
    });
    server.once('listening', () => done(true));
    try {
      server.listen({ port, host, exclusive: true });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Первый свободный порт, начиная с `start` (включительно), в пределах `range` номеров.
 * Бросает ошибку, если весь диапазон занят.
 */
export async function findFreePort(
  start = DEFAULT_PORT_SEARCH_START,
  range = PORT_SEARCH_RANGE,
  probe: (port: number) => Promise<boolean> = isPortFree
): Promise<number> {
  const from = isValidPort(start) ? start : DEFAULT_PORT_SEARCH_START;
  for (let port = from; port < from + range && port <= 65535; port++) {
    if (await probe(port)) return port;
  }
  throw new Error(`Не найден свободный порт в диапазоне ${from}–${from + range - 1}`);
}

/**
 * Разбор `netstat -ano` (Windows): pid'ы процессов, слушающих указанный порт.
 *
 * Состояние сокета не сравнивается со словом LISTENING: на локализованной Windows там
 * «ПРОСЛУШИВАНИЕ». Слушающий сокет опознаётся по внешнему адресу с портом `0`
 * (`0.0.0.0:0`, `[::]:0`) — так клиентские соединения к тому же порту не попадают под
 * освобождение.
 */
export function parseNetstatPortOwners(output: string, port: number): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [proto, local, foreign] = parts;
    if (!/^tcp/i.test(proto)) continue;
    if (localPort(local) !== port) continue;
    if (localPort(foreign) !== 0) continue;
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Номер порта из `127.0.0.1:5173`, `[::]:5173`, `*:5173`. */
function localPort(address: string): number | null {
  const idx = address.lastIndexOf(':');
  if (idx < 0) return null;
  const value = Number(address.slice(idx + 1));
  return Number.isInteger(value) ? value : null;
}

/**
 * Разбор `lsof -nP -iTCP:<port> -sTCP:LISTEN` (macOS/Linux): pid'ы из второй колонки.
 * Строка заголовка (`COMMAND PID ...`) пропускается.
 */
export function parseLsofPortOwners(output: string): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number(parts[1]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/**
 * Pid'ы процессов, слушающих порт. Windows — `netstat -ano`, остальные — `lsof`.
 * Ошибка внешней утилиты (в том числе «ничего не найдено») трактуется как пустой список.
 */
export async function findPortOwners(port: number, platform: NodeJS.Platform = process.platform): Promise<number[]> {
  if (!isValidPort(port)) return [];
  try {
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true });
      return parseNetstatPortOwners(stdout, port);
    }
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
    return parseLsofPortOwners(stdout);
  } catch {
    return [];
  }
}

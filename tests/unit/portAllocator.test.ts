import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PORT_SEARCH_START,
  findFreePort,
  hasPortPlaceholder,
  isPortFree,
  isValidPort,
  parseLsofPortOwners,
  parseNetstatPortOwners,
  substitutePort
} from '../../electron/services/portAllocator';

describe('подстановка порта в команду и URL (TASK-62)', () => {
  it('находит плейсхолдер в обеих формах', () => {
    expect(hasPortPlaceholder('npm run dev -- --port ${port}')).toBe(true);
    expect(hasPortPlaceholder('http://localhost:{{port}}')).toBe(true);
    expect(hasPortPlaceholder('npm run dev')).toBe(false);
    expect(hasPortPlaceholder(undefined)).toBe(false);
  });

  it('подставляет порт во все вхождения', () => {
    expect(substitutePort('vite --port ${port} --host', 5199)).toBe('vite --port 5199 --host');
    expect(substitutePort('http://localhost:${port}/app?p=${port}', 3001)).toBe(
      'http://localhost:3001/app?p=3001'
    );
    expect(substitutePort('serve -p {{PORT}}', 4000)).toBe('serve -p 4000');
  });

  it('оставляет строку без плейсхолдеров нетронутой', () => {
    expect(substitutePort('npm run dev', 5173)).toBe('npm run dev');
  });

  it('валидирует номер порта', () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(5173.5)).toBe(false);
    expect(isValidPort('5173')).toBe(false);
  });
});

describe('findFreePort (TASK-62)', () => {
  it('возвращает первый свободный порт диапазона', async () => {
    const busy = new Set([5173, 5174, 5175]);
    const port = await findFreePort(5173, 10, async (p) => !busy.has(p));
    expect(port).toBe(5176);
  });

  it('стартует с порта по умолчанию при некорректном значении', async () => {
    const probed: number[] = [];
    const port = await findFreePort(0, 5, async (p) => {
      probed.push(p);
      return true;
    });
    expect(port).toBe(DEFAULT_PORT_SEARCH_START);
    expect(probed[0]).toBe(DEFAULT_PORT_SEARCH_START);
  });

  it('бросает ошибку, если весь диапазон занят', async () => {
    await expect(findFreePort(6000, 3, async () => false)).rejects.toThrow(/6000/);
  });

  it('реально занятый порт не считается свободным', async () => {
    const port = await findFreePort(45_000, 50);
    const { createServer } = await import('node:net');
    const server = createServer();
    await new Promise<void>((resolve) => server.listen({ port, host: '0.0.0.0' }, () => resolve()));
    try {
      expect(await isPortFree(port)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('разбор владельцев порта (TASK-62)', () => {
  const netstat = [
    'Активные подключения',
    '',
    '  Имя    Локальный адрес        Внешний адрес          Состояние       PID',
    '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       4242',
    '  TCP    127.0.0.1:5173         127.0.0.1:53344        ESTABLISHED     9999',
    '  TCP    [::]:5173              [::]:0                 ПРОСЛУШИВАНИЕ   4242',
    '  TCP    0.0.0.0:5174           0.0.0.0:0              LISTENING       777',
    '  UDP    0.0.0.0:5173          *:*                                     555'
  ].join('\r\n');

  it('берёт только слушающие сокеты нужного порта и не дублирует pid', () => {
    expect(parseNetstatPortOwners(netstat, 5173)).toEqual([4242]);
  });

  it('различает порты', () => {
    expect(parseNetstatPortOwners(netstat, 5174)).toEqual([777]);
    expect(parseNetstatPortOwners(netstat, 6000)).toEqual([]);
  });

  it('разбирает вывод lsof, пропуская заголовок', () => {
    const lsof = [
      'COMMAND   PID  USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
      'node    12345  user   23u  IPv4 0x1234      0t0  TCP *:5173 (LISTEN)',
      'node    12345  user   24u  IPv6 0x1234      0t0  TCP *:5173 (LISTEN)',
      'node    54321  user   25u  IPv4 0x4321      0t0  TCP *:5173 (LISTEN)'
    ].join('\n');
    expect(parseLsofPortOwners(lsof)).toEqual([12345, 54321]);
    expect(parseLsofPortOwners('')).toEqual([]);
  });
});

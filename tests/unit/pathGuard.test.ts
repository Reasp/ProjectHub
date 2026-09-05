import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertInsideProject,
  findOwningProject,
  isInsideProject,
  isRegisteredProjectRoot,
  PathOutsideProjectError
} from '../../electron/services/pathGuard';

const isWin = process.platform === 'win32';
const ROOT = isWin ? 'C:\\Projects\\App' : '/home/user/Projects/App';
const SIBLING_WITH_PREFIX = isWin ? 'C:\\Projects\\App2\\secret.txt' : '/home/user/Projects/App2/secret.txt';
const inside = (...parts: string[]) => path.join(ROOT, ...parts);

describe('isInsideProject', () => {
  it('принимает сам корень и вложенные пути', () => {
    expect(isInsideProject(ROOT, ROOT)).toBe(true);
    expect(isInsideProject(ROOT, ROOT + path.sep)).toBe(true);
    expect(isInsideProject(ROOT, inside('src', 'index.ts'))).toBe(true);
    expect(isInsideProject(ROOT, 'src/index.ts')).toBe(true);
    expect(isInsideProject(ROOT, './backlog/tasks/task-1.md')).toBe(true);
  });

  it('отклоняет соседнюю папку с общим префиксом (App vs App2)', () => {
    expect(isInsideProject(ROOT, SIBLING_WITH_PREFIX)).toBe(false);
    expect(isInsideProject(ROOT, ROOT + '2')).toBe(false);
  });

  it('отклоняет выход через .. в относительных и абсолютных путях', () => {
    expect(isInsideProject(ROOT, '..')).toBe(false);
    expect(isInsideProject(ROOT, '../App2/x.txt')).toBe(false);
    expect(isInsideProject(ROOT, 'src/../../etc/passwd')).toBe(false);
    expect(isInsideProject(ROOT, inside('..', 'other'))).toBe(false);
    expect(isInsideProject(ROOT, path.dirname(ROOT))).toBe(false);
  });

  it('разрешает .. внутри проекта, если итог остаётся в корне', () => {
    expect(isInsideProject(ROOT, 'src/../docs/readme.md')).toBe(true);
  });

  it('отклоняет пустые значения, не-строки и NUL-байт', () => {
    expect(isInsideProject(ROOT, 'a\0b')).toBe(false);
    expect(isInsideProject('', 'x')).toBe(false);
    expect(isInsideProject(ROOT, undefined as unknown as string)).toBe(false);
    expect(isInsideProject(undefined as unknown as string, 'x')).toBe(false);
  });

  if (isWin) {
    it('на Windows отклоняет другой диск и сравнивает без учёта регистра', () => {
      expect(isInsideProject(ROOT, 'D:\\Projects\\App\\x.txt')).toBe(false);
      expect(isInsideProject(ROOT, 'c:\\projects\\app\\SRC\\x.txt')).toBe(true);
      expect(isInsideProject(ROOT, 'C:/Projects/App/src/x.txt')).toBe(true);
    });
  } else {
    it('на POSIX отклоняет абсолютный путь вне корня', () => {
      expect(isInsideProject(ROOT, '/etc/passwd')).toBe(false);
    });
  }
});

describe('assertInsideProject', () => {
  it('возвращает абсолютный путь для валидного относительного', () => {
    expect(assertInsideProject(ROOT, 'src/a.ts')).toBe(inside('src', 'a.ts'));
  });

  it('бросает PathOutsideProjectError для соседа с общим префиксом и для ../', () => {
    expect(() => assertInsideProject(ROOT, SIBLING_WITH_PREFIX)).toThrow(PathOutsideProjectError);
    expect(() => assertInsideProject(ROOT, '../x')).toThrow(PathOutsideProjectError);
  });
});

describe('findOwningProject', () => {
  const OTHER = isWin ? 'C:\\Projects\\Other' : '/home/user/Projects/Other';
  const NESTED = path.join(ROOT, 'infra');

  it('возвращает владельца пути и null, если владельца нет', () => {
    expect(findOwningProject([ROOT, OTHER], inside('backlog', 't.md'))).toBe(ROOT);
    expect(findOwningProject([ROOT, OTHER], SIBLING_WITH_PREFIX)).toBeNull();
    expect(findOwningProject([], inside('x'))).toBeNull();
  });

  it('при вложенных проектах выбирает самый глубокий корень', () => {
    expect(findOwningProject([ROOT, NESTED, OTHER], path.join(NESTED, 'docs', 'a.md'))).toBe(NESTED);
    expect(findOwningProject([NESTED, ROOT], inside('src', 'a.ts'))).toBe(ROOT);
  });

  it('игнорирует пустые и некорректные записи реестра', () => {
    expect(findOwningProject(['', undefined as unknown as string, ROOT], inside('a'))).toBe(ROOT);
  });
});

describe('isRegisteredProjectRoot', () => {
  it('сравнивает с нормализацией и не принимает подпапки или соседей', () => {
    expect(isRegisteredProjectRoot([ROOT], ROOT)).toBe(true);
    expect(isRegisteredProjectRoot([ROOT], ROOT + path.sep)).toBe(true);
    expect(isRegisteredProjectRoot([ROOT], inside('src'))).toBe(false);
    expect(isRegisteredProjectRoot([ROOT], ROOT + '2')).toBe(false);
    expect(isRegisteredProjectRoot([ROOT], '')).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

// roleService → appPaths: нужен частичный мок electron.app с userData во временном каталоге,
// чтобы тест не трогал реальный каталог ролей пользователя (по образцу projectScanner.test.ts).
const USER_DATA = path.join(os.tmpdir(), `projecthub-roles-test-${process.pid}`);
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => (name === 'userData' ? USER_DATA : os.homedir()),
    getAppPath: () => path.join(USER_DATA, 'app.asar')
  }
}));

const { parseRoleFile, loadRoles, saveRole } = await import('../../electron/services/roleService');
const { isRoleParseError } = await import('../../electron/services/roleTypes');

const PROJECT_DIR = path.join(os.tmpdir(), `projecthub-roles-project-${process.pid}`);

beforeAll(async () => {
  await fs.mkdir(USER_DATA, { recursive: true });
  await fs.mkdir(PROJECT_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(USER_DATA, { recursive: true, force: true });
  await fs.rm(PROJECT_DIR, { recursive: true, force: true });
});

describe('parseRoleFile', () => {
  it('парсит валидную роль', () => {
    const raw = `---\nslug: my-role\nname: Моя роль\nengine: claude-cli\ntools: [read, write]\nmaxTurns: 5\n---\n\nСистемный промпт.\n`;
    const result = parseRoleFile(raw, '/tmp/my-role.md', 'global');
    expect(isRoleParseError(result)).toBe(false);
    if (!isRoleParseError(result)) {
      expect(result.slug).toBe('my-role');
      expect(result.name).toBe('Моя роль');
      expect(result.engine).toBe('claude-cli');
      expect(result.tools).toEqual(['read', 'write']);
      expect(result.maxTurns).toBe(5);
      expect(result.systemPrompt).toBe('Системный промпт.');
      expect(result.source).toBe('global');
    }
  });

  it('требует slug', () => {
    const raw = `---\nname: Без slug\n---\n\nprompt\n`;
    const result = parseRoleFile(raw, '/tmp/no-slug.md', 'global');
    expect(isRoleParseError(result)).toBe(true);
  });

  it('требует name', () => {
    const raw = `---\nslug: no-name\n---\n\nprompt\n`;
    const result = parseRoleFile(raw, '/tmp/no-name.md', 'global');
    expect(isRoleParseError(result)).toBe(true);
  });

  it('отклоняет некорректный engine', () => {
    const raw = `---\nslug: bad-engine\nname: Bad\nengine: not-a-real-engine\n---\n\nprompt\n`;
    const result = parseRoleFile(raw, '/tmp/bad-engine.md', 'global');
    expect(isRoleParseError(result)).toBe(true);
  });

  it('отклоняет неизвестные категории tools', () => {
    const raw = `---\nslug: bad-tools\nname: Bad\ntools: [read, flying]\n---\n\nprompt\n`;
    const result = parseRoleFile(raw, '/tmp/bad-tools.md', 'global');
    expect(isRoleParseError(result)).toBe(true);
  });

  it('незакавыченная дата в frontmatter не ломает парсинг (правило 16 — сериализуется в строку)', () => {
    const raw = `---\nslug: with-date\nname: С датой\ndod: [2026-09-03]\n---\n\nprompt\n`;
    const result = parseRoleFile(raw, '/tmp/with-date.md', 'global');
    expect(isRoleParseError(result)).toBe(false);
  });
});

describe('loadRoles — слияние по slug (project > global > builtin)', () => {
  it('возвращает стартовые роли без переопределений', async () => {
    const { roles } = await loadRoles();
    const slugs = roles.map((r) => r.slug);
    expect(slugs).toEqual(expect.arrayContaining(['architect', 'implementer', 'reviewer', 'tester', 'doc-writer']));
    expect(roles.find((r) => r.slug === 'architect')?.source).toBe('builtin');
  });

  it('глобальная роль переопределяет builtin по slug', async () => {
    const rolesDir = path.join(USER_DATA, 'roles');
    await fs.mkdir(rolesDir, { recursive: true });
    await fs.writeFile(
      path.join(rolesDir, 'architect.md'),
      `---\nslug: architect\nname: Кастомный архитектор\n---\n\nКастомный промпт.\n`,
      'utf-8'
    );

    const { roles } = await loadRoles();
    const architect = roles.find((r) => r.slug === 'architect');
    expect(architect?.name).toBe('Кастомный архитектор');
    expect(architect?.source).toBe('global');
  });

  it('проектная роль переопределяет глобальную по slug', async () => {
    const projectRolesDir = path.join(PROJECT_DIR, '.projecthub', 'roles');
    await fs.mkdir(projectRolesDir, { recursive: true });
    await fs.writeFile(
      path.join(projectRolesDir, 'architect.md'),
      `---\nslug: architect\nname: Проектный архитектор\n---\n\nПроектный промпт.\n`,
      'utf-8'
    );

    const { roles } = await loadRoles(PROJECT_DIR);
    const architect = roles.find((r) => r.slug === 'architect');
    expect(architect?.name).toBe('Проектный архитектор');
    expect(architect?.source).toBe('project');

    // Без projectPath проектная роль не должна учитываться.
    const { roles: globalOnly } = await loadRoles();
    expect(globalOnly.find((r) => r.slug === 'architect')?.name).toBe('Кастомный архитектор');
  });

  it('saveRole пишет файл, читаемый обратно loadRoles', async () => {
    const filePath = await saveRole('global', {
      slug: 'custom-role',
      name: 'Своя роль',
      engine: 'api',
      systemPrompt: 'Промпт своей роли',
      source: 'global'
    });
    expect(filePath).toContain('custom-role.md');

    const { roles } = await loadRoles();
    const custom = roles.find((r) => r.slug === 'custom-role');
    expect(custom?.name).toBe('Своя роль');
    expect(custom?.systemPrompt).toBe('Промпт своей роли');
  });
});

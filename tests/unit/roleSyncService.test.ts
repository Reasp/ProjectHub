import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { applyRoleSync, planRoleSync, type RoleSyncDeps, type RoleSyncOptions } from '../../electron/services/roleSyncService';
import type { RoleDefinition } from '../../electron/services/roleTypes';

function role(slug: string, prompt = `Промпт ${slug}.`): RoleDefinition {
  return { slug, name: slug, systemPrompt: prompt, source: 'project', tools: ['read'] };
}

async function project(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ph-rolesync-'));
}

function deps(roles: RoleDefinition[]): RoleSyncDeps & { roles: RoleDefinition[] } {
  const d = { roles, loadRoles: async () => ({ roles: d.roles }), getTiers: async () => undefined };
  return d;
}

const CLAUDE_ONLY: RoleSyncOptions = { targets: ['claude'], hooks: false, hookTimeoutSec: 600 };
const BOTH_WITH_HOOKS: RoleSyncOptions = { targets: ['claude', 'codex'], hooks: true, hookTimeoutSec: 900 };

const read = (root: string, rel: string) => fs.readFile(path.join(root, ...rel.split('/')), 'utf-8');

describe('roleSyncService', () => {
  it('первая синхронизация создаёт файлы, повторная ничего не меняет', async () => {
    const root = await project();
    const d = deps([role('architect'), role('doc_writer')]);
    const plan = await planRoleSync(root, CLAUDE_ONLY, d);
    expect(plan.files.map((f) => [f.relPath, f.action])).toEqual([
      ['.claude/agents/architect.md', 'create'],
      ['.claude/agents/doc-writer.md', 'create']
    ]);
    expect(plan.summary).toMatchObject({ create: 2, synced: false, drift: 0 });

    const res = await applyRoleSync(root, CLAUDE_ONLY, {}, d);
    expect(res.written).toHaveLength(2);
    expect(res.plan.summary).toMatchObject({ unchanged: 2, synced: true, drift: 0 });
    expect(await read(root, '.claude/agents/architect.md')).toContain('Промпт architect.');
  });

  it('роль изменилась — update; правка руками — conflict и перезапись только по выбору', async () => {
    const root = await project();
    const d = deps([role('architect'), role('tester')]);
    await applyRoleSync(root, CLAUDE_ONLY, {}, d);
    d.roles = [role('architect', 'Новый промпт.'), role('tester')];
    const file = path.join(root, '.claude', 'agents', 'tester.md');
    await fs.writeFile(file, (await fs.readFile(file, 'utf-8')).replace('Промпт tester.', 'Правка руками.'));

    const plan = await planRoleSync(root, CLAUDE_ONLY, d);
    expect(Object.fromEntries(plan.files.map((f) => [f.relPath, f.action]))).toEqual({
      '.claude/agents/architect.md': 'update',
      '.claude/agents/tester.md': 'conflict'
    });
    expect(plan.summary).toMatchObject({ drift: 2, synced: true });

    const res = await applyRoleSync(root, CLAUDE_ONLY, {}, d);
    expect(res.written).toEqual(['.claude/agents/architect.md']);
    expect(res.skipped).toEqual([{ relPath: '.claude/agents/tester.md', reason: 'изменён вручную' }]);
    expect(await read(root, '.claude/agents/tester.md')).toContain('Правка руками.');

    const forced = await applyRoleSync(root, CLAUDE_ONLY, { overwrite: ['.claude/agents/tester.md'] }, d);
    expect(forced.written).toEqual(['.claude/agents/tester.md']);
    expect(forced.plan.summary.drift).toBe(0);
  });

  it('чужой файл с тем же именем не трогается; orphan удаляется только по выбору', async () => {
    const root = await project();
    await fs.mkdir(path.join(root, '.claude', 'agents'), { recursive: true });
    await fs.writeFile(path.join(root, '.claude', 'agents', 'architect.md'), '---\nname: architect\n---\nмой\n');
    const d = deps([role('architect'), role('tester')]);
    const res = await applyRoleSync(root, CLAUDE_ONLY, {}, d);
    expect(res.skipped).toEqual([{ relPath: '.claude/agents/architect.md', reason: 'файл создан не ProjectHub' }]);
    expect(await read(root, '.claude/agents/architect.md')).toBe('---\nname: architect\n---\nмой\n');

    d.roles = [role('architect')];
    const plan = await planRoleSync(root, CLAUDE_ONLY, d);
    expect(plan.files.find((f) => f.relPath === '.claude/agents/tester.md')).toMatchObject({ action: 'orphan', desired: null, roleSlug: 'tester' });
    await applyRoleSync(root, CLAUDE_ONLY, {}, d);
    await expect(read(root, '.claude/agents/tester.md')).resolves.toContain('tester');
    const deleted = await applyRoleSync(root, CLAUDE_ONLY, { deleteOrphans: ['.claude/agents/tester.md'] }, d);
    expect(deleted.deleted).toEqual(['.claude/agents/tester.md']);
    await expect(read(root, '.claude/agents/tester.md')).rejects.toThrow();
  });

  it('хуки: скрипт и записи в настройках обоих движков, чужие настройки сохраняются, снятие хуков', async () => {
    const root = await project();
    await fs.mkdir(path.join(root, '.claude'), { recursive: true });
    await fs.writeFile(path.join(root, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
    const d = deps([role('architect')]);
    const res = await applyRoleSync(root, BOTH_WITH_HOOKS, {}, d);
    expect(res.written.sort()).toEqual([
      '.claude/agents/architect.md',
      '.claude/settings.json',
      '.codex/agents/architect.toml',
      '.codex/hooks.json',
      '.projecthub/hooks/projecthub-hook.mjs'
    ]);
    const settings = JSON.parse(await read(root, '.claude/settings.json'));
    expect(settings.permissions).toEqual({ allow: ['Bash(ls)'] });
    expect(settings.hooks.PreToolUse[0].hooks[0]).toMatchObject({ timeout: 900 });
    expect(await read(root, '.projecthub/hooks/projecthub-hook.mjs')).toMatch(/^\/\/ projecthub:generated hash=/);
    expect(res.plan.files.find((f) => f.relPath === '.codex/hooks.json')?.notes.join(' ')).toContain('/hooks');

    const off = await applyRoleSync(root, { ...BOTH_WITH_HOOKS, hooks: false }, { deleteOrphans: ['.projecthub/hooks/projecthub-hook.mjs'] }, d);
    expect(off.deleted).toEqual(['.projecthub/hooks/projecthub-hook.mjs']);
    expect(JSON.parse(await read(root, '.claude/settings.json'))).toEqual({ permissions: { allow: ['Bash(ls)'] } });
    expect(JSON.parse(await read(root, '.codex/hooks.json'))).toEqual({});
    expect(off.plan.files.some((f) => f.kind === 'hookSettings')).toBe(false);
  });

  it('невалидный settings.json — конфликт с причиной, файл не меняется', async () => {
    const root = await project();
    await fs.mkdir(path.join(root, '.claude'), { recursive: true });
    await fs.writeFile(path.join(root, '.claude', 'settings.json'), '{ broken');
    const res = await applyRoleSync(root, { targets: ['claude'], hooks: true, hookTimeoutSec: 600 }, { overwrite: ['.claude/settings.json'] }, deps([]));
    expect(res.skipped).toEqual([{ relPath: '.claude/settings.json', reason: expect.stringContaining('невалидный JSON') }]);
    expect(await read(root, '.claude/settings.json')).toBe('{ broken');
  });
});

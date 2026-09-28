import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { copySkill, listProjectSkills, listSkillSources, listSourceSkills, type SkillServiceDeps } from '../../electron/services/skillService';
import { removeTempDir } from '../helpers/removeTempDir';

const temps: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `ph-skills-${prefix}-`));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  while (temps.length) await removeTempDir(temps.pop()!);
});

async function writeFile(base: string, rel: string, content: string): Promise<void> {
  const file = path.join(base, ...rel.split('/'));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

const skillMd = (name: string, body = 'Тело.') => `---\nname: ${name}\ndescription: "Use when ${name}"\n---\n\n# ${name}\n\n${body}\n`;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

function deps(opts: { template?: string; home?: string; projects?: string[] }): SkillServiceDeps {
  const projects = opts.projects ?? [];
  return {
    templatePath: async () => opts.template ?? '',
    homeDir: () => opts.home ?? path.join(os.tmpdir(), 'ph-skills-no-home'),
    projects: async () => projects,
    assertProject: async (p) => {
      const hit = projects.find((x) => path.resolve(x).toLowerCase() === path.resolve(p).toLowerCase());
      if (!hit) throw new Error(`не зарегистрирован: ${p}`);
      return path.resolve(hit);
    }
  };
}

describe('skillService', () => {
  it('список: статусы копий, вложенные скиллы, каталог без SKILL.md, служебное игнорируется', async () => {
    const root = await tempDir('list');
    await writeFile(root, '.claude/skills/same/SKILL.md', skillMd('same'));
    await writeFile(root, '.agents/skills/same/SKILL.md', skillMd('same').replace(/\n/g, '\r\n'));
    await writeFile(root, '.claude/skills/same/node_modules/x.js', 'ignored');
    await writeFile(root, '.claude/skills/diff/SKILL.md', skillMd('diff', 'v1'));
    await writeFile(root, '.claude/skills/diff/refs/a.md', 'a');
    await writeFile(root, '.agents/skills/diff/SKILL.md', skillMd('diff', 'v2'));
    await writeFile(root, '.claude/skills/group/inner/SKILL.md', skillMd('inner'));
    await writeFile(root, '.claude/skills/broken/readme.txt', 'нет SKILL.md');
    await writeFile(root, '.claude/skills/.projecthub-tmp-x-1/SKILL.md', skillMd('x'));
    await fs.mkdir(path.join(root, '.claude', 'skills', 'empty'), { recursive: true });

    const listing = await listProjectSkills(root);
    expect(listing.entries.map((e) => [e.id, e.status])).toEqual([
      ['broken', 'claudeOnly'],
      ['diff', 'diverged'],
      ['group/inner', 'claudeOnly'],
      ['same', 'synced']
    ]);
    const byId = Object.fromEntries(listing.entries.map((e) => [e.id, e]));
    expect(byId.broken.copies.claude!.problems).toContain('noSkillMd');
    expect(byId['group/inner'].copies.claude!.problems).toEqual(['nested']);
    expect(byId.same.copies.claude!.files.map((f) => f.relPath)).toEqual(['SKILL.md']);
    expect(byId.diff.fileDiff).toEqual([
      { relPath: 'SKILL.md', state: 'changed' },
      { relPath: 'refs/a.md', state: 'onlyClaude' }
    ]);
    expect(byId.diff.copies.agents!.skillMd).toContain('v2');
    expect(listing.summary).toMatchObject({ total: 4, synced: 1, diverged: 1, claudeOnly: 2, agentsOnly: 0 });
  });

  it('проект без каталогов скиллов — пустой список', async () => {
    const root = await tempDir('empty');
    expect((await listProjectSkills(root)).entries).toEqual([]);
  });

  it('копирование между корнями проекта: создание, без изменений, перезапись только по выбору', async () => {
    const root = await tempDir('copy');
    const d = deps({ projects: [root] });
    await writeFile(root, '.claude/skills/demo/SKILL.md', skillMd('demo', 'v1'));
    await writeFile(root, '.claude/skills/demo/scripts/run.mjs', 'console.log(1)');
    const req = { source: { kind: 'project' as const, path: root }, fromRoot: 'claude' as const, id: 'demo', toRoots: ['agents' as const], overwrite: false };

    const first = await copySkill(root, req, d);
    expect(first.results).toEqual([{ root: 'agents', outcome: 'created' }]);
    expect(first.listing.entries[0].status).toBe('synced');
    expect(await fs.readFile(path.join(root, '.agents/skills/demo/scripts/run.mjs'), 'utf-8')).toBe('console.log(1)');

    expect((await copySkill(root, req, d)).results).toEqual([{ root: 'agents', outcome: 'unchanged' }]);

    // Копия в .agents правится отдельно, в ней появляется лишний файл.
    await writeFile(root, '.agents/skills/demo/SKILL.md', skillMd('demo', 'правка в agents'));
    await writeFile(root, '.agents/skills/demo/extra.md', 'лишний');
    const refused = await copySkill(root, req, d);
    expect(refused.results[0]).toMatchObject({ root: 'agents', outcome: 'skipped' });
    expect(await fs.readFile(path.join(root, '.agents/skills/demo/SKILL.md'), 'utf-8')).toContain('правка в agents');

    const forced = await copySkill(root, { ...req, overwrite: true }, d);
    expect(forced.results).toEqual([{ root: 'agents', outcome: 'overwritten' }]);
    expect(await fs.readFile(path.join(root, '.agents/skills/demo/SKILL.md'), 'utf-8')).toContain('v1');
    // Каталог заменён целиком: лишнего файла нет, временных каталогов не осталось.
    expect(await exists(path.join(root, '.agents/skills/demo/extra.md'))).toBe(false);
    expect((await fs.readdir(path.join(root, '.agents/skills'))).filter((n) => n.startsWith('.projecthub-'))).toEqual([]);
    expect(forced.listing.entries[0].status).toBe('synced');
  });

  it('копия в себя пропускается, неизвестный id и выход из каталога отклоняются', async () => {
    const root = await tempDir('self');
    const d = deps({ projects: [root] });
    await writeFile(root, '.claude/skills/demo/SKILL.md', skillMd('demo'));
    const self = await copySkill(root, { source: { kind: 'project', path: root }, fromRoot: 'claude', id: 'demo', toRoots: ['claude'], overwrite: true }, d);
    expect(self.results).toEqual([{ root: 'claude', outcome: 'skipped', reason: 'это та же копия' }]);
    await expect(copySkill(root, { source: { kind: 'project', path: root }, fromRoot: 'claude', id: '../etc', toRoots: ['agents'], overwrite: true }, d)).rejects.toThrow(/недопустимое/);
    await expect(copySkill(root, { source: { kind: 'project', path: root }, fromRoot: 'claude', id: 'missing', toRoots: ['agents'], overwrite: true }, d)).rejects.toThrow(/не найден/);
  });

  it('источник-проект должен быть зарегистрирован', async () => {
    const root = await tempDir('reg');
    const stranger = await tempDir('stranger');
    await writeFile(stranger, '.claude/skills/demo/SKILL.md', skillMd('demo'));
    const d = deps({ projects: [root] });
    await expect(copySkill(root, { source: { kind: 'project', path: stranger }, fromRoot: 'claude', id: 'demo', toRoots: ['claude'], overwrite: false }, d)).rejects.toThrow(/не зарегистрирован/);
    await expect(listSourceSkills({ kind: 'project', path: stranger }, root, d)).rejects.toThrow(/не зарегистрирован/);
  });

  it('импорт из шаблона: действия по корням, расходящиеся копии источника — обе строки', async () => {
    const root = await tempDir('target');
    const template = await tempDir('template');
    const d = deps({ template, projects: [root] });
    await writeFile(template, '.claude/skills/init/SKILL.md', skillMd('init', 'новая'));
    await writeFile(template, '.agents/skills/init/SKILL.md', skillMd('init', 'новая для agents'));
    await writeFile(template, '.claude/skills/fresh/SKILL.md', skillMd('fresh'));
    await writeFile(template, '.agents/skills/fresh/SKILL.md', skillMd('fresh'));
    await writeFile(root, '.claude/skills/init/SKILL.md', skillMd('init', 'новая'));
    await writeFile(root, '.agents/skills/init/SKILL.md', skillMd('init', 'новая для agents'));

    const listing = await listSourceSkills({ kind: 'template' }, root, d);
    expect(listing.source).toMatchObject({ kind: 'template', path: template, available: true });
    expect(listing.items.map((i) => [i.id, i.from, i.sourceDiverged, i.actions.claude, i.actions.agents])).toEqual([
      ['fresh', 'claude', false, 'create', 'create'],
      ['init', 'claude', true, 'unchanged', 'overwrite'],
      ['init', 'agents', true, 'overwrite', 'unchanged']
    ]);

    const res = await copySkill(root, { source: { kind: 'template' }, fromRoot: 'claude', id: 'fresh', toRoots: ['claude', 'agents'], overwrite: false }, d);
    expect(res.results).toEqual([
      { root: 'claude', outcome: 'created' },
      { root: 'agents', outcome: 'created' }
    ]);
    const res2 = await copySkill(root, { source: { kind: 'template' }, fromRoot: 'agents', id: 'init', toRoots: ['agents'], overwrite: true }, d);
    expect(res2.results).toEqual([{ root: 'agents', outcome: 'unchanged' }]);
  });

  it('личные скиллы: только .claude/skills домашнего каталога', async () => {
    const root = await tempDir('personal-target');
    const home = await tempDir('home');
    await writeFile(home, '.claude/skills/mine/SKILL.md', skillMd('mine'));
    const d = deps({ home, projects: [root] });
    const listing = await listSourceSkills({ kind: 'personal' }, root, d);
    expect(listing.items.map((i) => [i.id, i.from])).toEqual([['mine', 'claude']]);
    const res = await copySkill(root, { source: { kind: 'personal' }, fromRoot: 'agents', id: 'mine', toRoots: ['claude'], overwrite: false }, d).catch((e: Error) => e);
    expect(res).toBeInstanceOf(Error);
    const ok = await copySkill(root, { source: { kind: 'personal' }, fromRoot: 'claude', id: 'mine', toRoots: ['agents'], overwrite: false }, d);
    expect(ok.results).toEqual([{ root: 'agents', outcome: 'created' }]);
  });

  it('источники: шаблон, личные, другие проекты без текущего', async () => {
    const a = await tempDir('a');
    const b = await tempDir('b');
    const template = await tempDir('tpl');
    const sources = await listSkillSources(a, deps({ template, projects: [a, b] }));
    expect(sources.map((s) => [s.kind, s.path])).toEqual([
      ['template', template],
      ['personal', path.join(os.tmpdir(), 'ph-skills-no-home')],
      ['project', b]
    ]);
    expect(sources[1].available).toBe(false);
    expect((await listSkillSources(a, deps({ projects: [a] }))).map((s) => s.kind)).toEqual(['personal']);
  });

  it('ссылки: не читаются, скилл со ссылкой не копируется, запись через ссылку запрещена', async () => {
    const root = await tempDir('links');
    const outside = await tempDir('outside');
    const d = deps({ projects: [root] });
    await writeFile(outside, 'secret.txt', 'секрет');
    await writeFile(root, '.claude/skills/linked/SKILL.md', skillMd('linked'));
    await writeFile(root, '.claude/skills/plain/SKILL.md', skillMd('plain'));
    let linked = true;
    try {
      await fs.symlink(outside, path.join(root, '.claude/skills/linked/out'), 'junction');
      await fs.mkdir(path.join(root, '.agents'), { recursive: true });
      await fs.symlink(outside, path.join(root, '.agents/skills'), 'junction');
    } catch {
      linked = false; // Нет прав на ссылки — проверка не применима.
    }
    if (!linked) return;
    const listing = await listProjectSkills(root);
    const entry = listing.entries.find((e) => e.id === 'linked')!;
    expect(entry.copies.claude!.problems).toContain('symlinks');
    expect(entry.copies.claude!.files.map((f) => f.relPath)).toEqual(['SKILL.md']);
    await expect(copySkill(root, { source: { kind: 'project', path: root }, fromRoot: 'claude', id: 'linked', toRoots: ['agents'], overwrite: true }, d)).rejects.toThrow(/ссылки/);
    await expect(copySkill(root, { source: { kind: 'project', path: root }, fromRoot: 'claude', id: 'plain', toRoots: ['agents'], overwrite: true }, d)).rejects.toThrow(/символическая ссылка/);
    expect(await fs.readdir(outside)).toEqual(['secret.txt']);
  });
});

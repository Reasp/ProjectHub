import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildMemoryInstructions,
  callMemoryTool,
  resolveMemoryProjectRoot,
  type MemoryToolContext,
  type MemoryToolDeps
} from '../../electron/services/memoryTools';
import { memoryDirOf, readMemory } from '../../electron/services/memoryStore';
import type { HitlRequest } from '../../electron/services/hitlTypes';

/** Инструменты памяти для агентов: корень проекта, аудит, отказы (TASK-76.2, decision-51 п. 3–4). */

let root: string;
let other: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-memtool-'));
  other = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-memtool-other-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(other, { recursive: true, force: true });
});

type Audit = { info: Omit<HitlRequest, 'id' | 'createdAt'>; decision: string; rule: string; detail?: string };

function deps(): MemoryToolDeps & { audits: Audit[] } {
  const audits: Audit[] = [];
  return {
    audits,
    listProjectRoots: async () => [root],
    recordAutoDecision: (info, decision, rule, detail) => {
      audits.push({ info, decision, rule, detail });
      return `auto-${audits.length}`;
    }
  };
}

const worktreeCtx = (): MemoryToolContext => ({
  sessionPath: path.join(root, '.worktrees', 'done-task-7'),
  sessionId: 'swarm-agent-1',
  origin: 'swarm',
  engine: 'claude-cli',
  agentName: 'Кодер',
  role: 'developer',
  taskId: 'TASK-7'
});

const WRITE = {
  title: 'Ollama виснет под нагрузкой',
  description: 'Перезапустить ollama, если агенты получают пустые ответы',
  body: 'curl /api/generate висит.\n\nПочему: незакрытые соединения.',
  type: 'project'
};

describe('resolveMemoryProjectRoot', () => {
  it('worktree агента приводится к корню проекта, чужой путь — null', async () => {
    const d = deps();
    expect(await resolveMemoryProjectRoot(path.join(root, '.worktrees', 'x'), d)).toBe(root);
    expect(await resolveMemoryProjectRoot(root, d)).toBe(root);
    expect(await resolveMemoryProjectRoot(other, d)).toBeNull();
    expect(await resolveMemoryProjectRoot('', d)).toBeNull();
  });
});

describe('callMemoryTool', () => {
  it('запись из worktree попадает в основное дерево, с автором, источником и аудитом', async () => {
    const d = deps();
    const res = await callMemoryTool('memory_write', WRITE, worktreeCtx(), d);
    expect(res.isError).toBe(false);
    expect(res.text).toContain('Сохранено: mem-1');
    const { facts } = await readMemory(root);
    expect(facts[0]).toMatchObject({ id: 'mem-1', source: 'task-7', author: 'claude-cli/developer' });
    await expect(fs.access(path.join(root, '.worktrees'))).rejects.toThrow();
    expect(d.audits).toEqual([
      expect.objectContaining({
        decision: 'allow',
        rule: 'memory',
        info: expect.objectContaining({ projectPath: root, type: 'file_write', tool: 'memory_write', filePath: expect.stringMatching(/^backlog\/memory\/mem-1 - /) })
      })
    ]);
  });

  it('секрет отклоняется: ошибка для модели без значения и аудит deny', async () => {
    const d = deps();
    const res = await callMemoryTool('memory_write', { ...WRITE, body: 'OPENAI_API_KEY=abc123def456ghi789' }, worktreeCtx(), d);
    expect(res.isError).toBe(true);
    expect(res.text).toContain('assigned_secret');
    expect(res.text).not.toContain('abc123def456ghi789');
    expect(d.audits).toEqual([expect.objectContaining({ decision: 'deny', rule: 'memory', detail: 'secret_detected' })]);
    await expect(fs.readdir(memoryDirOf(root))).rejects.toThrow();
  });

  it('дубликат подсказывает replace с id похожего факта', async () => {
    const d = deps();
    await callMemoryTool('memory_write', WRITE, worktreeCtx(), d);
    const dup = await callMemoryTool('memory_write', WRITE, worktreeCtx(), d);
    expect(dup.isError).toBe(true);
    expect(dup.text).toContain('replace: "mem-1"');
    const upd = await callMemoryTool('memory_write', { ...WRITE, body: 'Лечится перезапуском.', replace: 'mem-1' }, worktreeCtx(), d);
    expect(upd).toMatchObject({ isError: false });
    expect(upd.text).toContain('Обновлено: mem-1');
  });

  it('путь вне зарегистрированных проектов — отказ с аудитом, поиск без аудита', async () => {
    const d = deps();
    const ctx = { ...worktreeCtx(), sessionPath: other };
    expect((await callMemoryTool('memory_write', WRITE, ctx, d)).isError).toBe(true);
    expect((await callMemoryTool('memory_search', { query: 'ollama' }, ctx, d)).isError).toBe(true);
    expect(d.audits).toHaveLength(1);
    expect(d.audits[0]).toMatchObject({ decision: 'deny', detail: 'invalid_project' });
  });

  it('поиск возвращает факты текстом, пустой запрос — ошибка', async () => {
    const d = deps();
    await callMemoryTool('memory_write', WRITE, worktreeCtx(), d);
    const found = await callMemoryTool('memory_search', { query: 'пустые ответы ollama' }, worktreeCtx(), d);
    expect(found.isError).toBe(false);
    expect(found.text).toContain('### mem-1: Ollama виснет под нагрузкой');
    expect((await callMemoryTool('memory_search', { query: 'playwright' }, worktreeCtx(), d)).text).toContain('ничего не найдено');
    expect((await callMemoryTool('memory_search', {}, worktreeCtx(), d)).isError).toBe(true);
    expect(d.audits.filter((a) => a.info.tool === 'memory_search')).toEqual([]);
  });

  it('удаление по id с аудитом; неизвестный инструмент — ошибка', async () => {
    const d = deps();
    await callMemoryTool('memory_write', WRITE, worktreeCtx(), d);
    const del = await callMemoryTool('memory_delete', { id: 'mem-1' }, worktreeCtx(), d);
    expect(del).toMatchObject({ isError: false });
    expect((await readMemory(root)).facts).toEqual([]);
    expect(d.audits.at(-1)).toMatchObject({ decision: 'allow', info: expect.objectContaining({ tool: 'memory_delete' }) });
    expect((await callMemoryTool('memory_delete', { id: 'mem-1' }, worktreeCtx(), d)).isError).toBe(true);
    expect((await callMemoryTool('memory_forget', {}, worktreeCtx(), d)).isError).toBe(true);
  });

  it('сессия без задачи пишет source session; неизвестный тип отклоняется', async () => {
    const d = deps();
    const ctx: MemoryToolContext = { sessionPath: root, sessionId: 'studio-1', origin: 'studio', engine: 'api' };
    await callMemoryTool('memory_write', WRITE, ctx, d);
    expect((await readMemory(root)).facts[0]).toMatchObject({ source: 'session', author: 'api' });
    const bad = await callMemoryTool('memory_write', { ...WRITE, title: 'Совсем другой факт', description: 'другое', type: 'decision' }, ctx, d);
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('type: invalid_type');
  });
});

describe('buildMemoryInstructions', () => {
  it('подставляет префикс движка', () => {
    expect(buildMemoryInstructions('mcp__projecthub-hitl__memory_')).toContain('mcp__projecthub-hitl__memory_write');
    expect(buildMemoryInstructions()).toContain('memory_search');
  });
});

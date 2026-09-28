import { describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import {
  ANTIGRAVITY_TOOLS_BY_CATEGORY,
  antigravityModelAlias,
  antigravityToolsForRole,
  buildAntigravityAgentFile,
  buildClaudeAgentFile,
  buildCodexAgentFile,
  resolveAntigravityModel,
  buildRoleExport,
  claudeAgentName,
  codexSandboxMode,
  contentHash,
  hasOurHooks,
  hookCommand,
  isSkippedExport,
  mergeHookSettings,
  planFileWrite,
  planMergedFile,
  readMarker,
  resolveClaudeModel,
  resolveCodexModel,
  roleForAgentType,
  stripMarker,
  withMarker,
  type ExportedRoleFile
} from '../../electron/services/roleExport';
import { BUILTIN_ROLES } from '../../electron/services/builtinRoles';
import { emptyModelTierSettings, type ModelTierSettings } from '../../electron/services/modelTiers';
import type { RoleDefinition } from '../../electron/services/roleTypes';

function role(over: Partial<RoleDefinition> = {}): RoleDefinition {
  return { slug: 'reviewer', name: 'Ревьюер', systemPrompt: 'Проверяй изменения. Не правь файлы.', source: 'project', ...over };
}

function tiers(): ModelTierSettings {
  const s = emptyModelTierSettings();
  s.tiers.frontier = [{ engine: 'api', model: 'ornith:35b', profile: 'LAN' }, { engine: 'claude-cli', model: 'opus' }];
  s.tiers.balanced = [{ engine: 'codex-cli', model: 'gpt-6-luna' }];
  return s;
}

function exported(value: ReturnType<typeof buildClaudeAgentFile>): ExportedRoleFile {
  if (isSkippedExport(value)) throw new Error(`skipped: ${value.reason}`);
  return value;
}

describe('маркер и хэш', () => {
  it('маркер во frontmatter не мешает YAML и снимается обратно', () => {
    const body = '---\nname: "x"\n---\n\nтекст\n';
    const marked = withMarker(body, '#', 'x');
    expect(marked.split('\n')[1]).toMatch(/^# projecthub:generated role=x hash=[0-9a-f]{16}/);
    expect(matter(marked).data).toEqual({ name: 'x' });
    expect(stripMarker(marked)).toBe(body);
    expect(readMarker(marked)).toEqual({ hash: contentHash(body), role: 'x' });
  });

  it('CRLF не меняет хэш', () => {
    const marked = withMarker('a = "1"\nb = "2"\n', '#');
    expect(readMarker(marked.replace(/\n/g, '\r\n'))?.hash).toBe(readMarker(marked)?.hash);
    expect(planFileWrite(marked.replace(/\n/g, '\r\n'), marked)).toEqual({ action: 'unchanged' });
  });

  it('файл без маркера — чужой', () => {
    expect(readMarker('name = "x"\n')).toBeNull();
    expect(planFileWrite('name = "x"\n', withMarker('name = "y"', '#'))).toEqual({ action: 'foreign' });
    expect(planFileWrite('name = "x"\n', null)).toEqual({ action: 'foreign' });
  });
});

describe('planFileWrite', () => {
  const v1 = withMarker('a = "1"', '#', 'r');
  const v2 = withMarker('a = "2"', '#', 'r');
  const edited = v1.replace('a = "1"', 'a = "руками"');

  it('create / unchanged / update', () => {
    expect(planFileWrite(null, v1)).toEqual({ action: 'create' });
    expect(planFileWrite(v1, v1)).toEqual({ action: 'unchanged' });
    expect(planFileWrite(v1, v2)).toEqual({ action: 'update' });
  });

  it('правка руками — конфликт, а правка, совпавшая с новым содержимым, — обновление маркера', () => {
    expect(planFileWrite(edited, v2)).toEqual({ action: 'conflict', modified: true });
    expect(planFileWrite(v1.replace('a = "1"', 'a = "2"'), v2)).toEqual({ action: 'update' });
  });

  it('роли больше нет — orphan, с признаком ручной правки', () => {
    expect(planFileWrite(v1, null)).toEqual({ action: 'orphan' });
    expect(planFileWrite(edited, null)).toEqual({ action: 'orphan', modified: true });
    expect(planFileWrite(null, null)).toEqual({ action: 'unchanged' });
  });

  it('слитые настройки движка сравниваются без маркера', () => {
    expect(planMergedFile(null, '{}\n')).toEqual({ action: 'create' });
    expect(planMergedFile('{}\r\n', '{}\n')).toEqual({ action: 'unchanged' });
    expect(planMergedFile('{"a":1}', '{}\n')).toEqual({ action: 'update' });
  });
});

describe('модель субагента', () => {
  it('Claude: явная модель Claude, затем тир claude-cli, затем inherit', () => {
    expect(resolveClaudeModel(role({ model: 'sonnet', modelTier: 'frontier' }), tiers())).toEqual({ model: 'sonnet', source: 'explicit' });
    expect(resolveClaudeModel(role({ model: 'claude-opus-5-5' }))).toEqual({ model: 'claude-opus-5-5', source: 'explicit' });
    expect(resolveClaudeModel(role({ modelTier: 'frontier' }), tiers())).toEqual({ model: 'opus', source: 'tier' });
    const inherit = resolveClaudeModel(role({ modelTier: 'cheap' }), tiers());
    expect(inherit).toMatchObject({ model: 'inherit', source: 'inherit' });
    expect(inherit.note).toContain('cheap');
    expect(resolveClaudeModel(role())).toEqual({ model: 'inherit', source: 'inherit' });
  });

  it('Claude: чужая модель роли не попадает в файл', () => {
    const r = resolveClaudeModel(role({ model: 'qwen2.5:7b' }), tiers());
    expect(r.model).toBe('inherit');
    expect(r.note).toContain('не модель Claude');
    expect(resolveClaudeModel(role({ model: 'qwen2.5:7b', modelTier: 'frontier' }), tiers())).toMatchObject({ model: 'opus', source: 'tier' });
  });

  it('Codex: модель роли codex-cli, тир codex-cli, иначе без поля', () => {
    expect(resolveCodexModel(role({ engine: 'codex-cli', model: 'gpt-x' }))).toEqual({ model: 'gpt-x', source: 'explicit' });
    expect(resolveCodexModel(role({ modelTier: 'balanced' }), tiers())).toEqual({ model: 'gpt-6-luna', source: 'tier' });
    expect(resolveCodexModel(role({ model: 'opus' })).model).toBeUndefined();
  });
});

describe('файлы агентов', () => {
  it('Claude: frontmatter разбирается, инструменты по категориям, тело — промпт', () => {
    const file = exported(buildClaudeAgentFile(role({ slug: 'doc_writer', tools: ['read', 'search', 'subagent'], maxTurns: 12, modelTier: 'frontier' }), { tiers: tiers() }));
    expect(file.relPath).toBe('.claude/agents/doc-writer.md');
    const parsed = matter(file.content);
    expect(parsed.data).toMatchObject({ name: 'doc-writer', model: 'opus', maxTurns: 12 });
    expect(parsed.data.tools).toBe('Read, Glob, Grep, NotebookRead, WebFetch, WebSearch, Agent');
    expect(parsed.data.description).toContain('Ревьюер');
    expect(parsed.content.trim()).toBe('Проверяй изменения. Не правь файлы.');
    expect(readMarker(file.content)?.role).toBe('doc_writer');
    expect(planFileWrite(file.content, file.content).action).toBe('unchanged');
  });

  it('Claude: без tools роли поле не пишется; кавычки и переводы строк экранируются', () => {
    const file = exported(buildClaudeAgentFile(role({ name: 'Имя "с кавычками"\nи строкой' })));
    const parsed = matter(file.content);
    expect(parsed.data.tools).toBeUndefined();
    expect(parsed.data.description).toContain('Имя "с кавычками"\nи строкой');
  });

  it('роль другого движка пропускается с причиной', () => {
    const skipped = buildClaudeAgentFile(role({ engine: 'api' }));
    expect(isSkippedExport(skipped) && skipped.reason).toContain('api');
    expect(isSkippedExport(buildCodexAgentFile(role({ engine: 'claude-cli' })))).toBe(true);
    expect(isSkippedExport(buildClaudeAgentFile(role({ engine: 'claude-cli' })))).toBe(false);
  });

  it('Codex: TOML с sandbox по правам, промпт многострочным литералом', () => {
    const file = buildCodexAgentFile(role({ tools: ['read'], permissions: { allowFileWrite: false, allowCommands: false } }));
    if (isSkippedExport(file)) throw new Error('skipped');
    expect(file.relPath).toBe('.codex/agents/reviewer.toml');
    expect(file.content).toContain('sandbox_mode = "read-only"');
    expect(file.content).toContain("developer_instructions = '''\nПроверяй изменения. Не правь файлы.\n'''");
    expect(file.content.startsWith('# projecthub:generated role=reviewer')).toBe(true);
    expect(file.notes.join(' ')).toContain('sandbox');
  });

  it('Codex: sandbox никогда не шире workspace-write', () => {
    expect(codexSandboxMode(role())).toBe('workspace-write');
    expect(codexSandboxMode(role({ tools: ['read', 'command'] }))).toBe('workspace-write');
    expect(codexSandboxMode(role({ tools: ['read', 'search'] }))).toBe('read-only');
    expect(codexSandboxMode(role({ permissions: { allowFileWrite: false } }))).toBe('workspace-write');
  });

  it("Codex: промпт с ''' уходит обычной строкой", () => {
    const file = buildCodexAgentFile(role({ systemPrompt: "текст ''' внутри" }));
    if (isSkippedExport(file)) throw new Error('skipped');
    expect(file.content).toContain('developer_instructions = "текст \'\'\' внутри"');
  });

  it('встроенные роли экспортируются в оба движка без пропусков', () => {
    const { files, skipped } = buildRoleExport(BUILTIN_ROLES, ['claude', 'codex']);
    expect(skipped).toEqual([]);
    expect(files).toHaveLength(BUILTIN_ROLES.length * 2);
    expect(new Set(files.map((f) => f.relPath)).size).toBe(files.length);
  });

  it('роль по agent_type', () => {
    const roles = [role({ slug: 'doc_writer' }), role({ slug: 'tester' })];
    expect(roleForAgentType(roles, 'doc-writer')?.slug).toBe('doc_writer');
    expect(roleForAgentType(roles, 'Tester')?.slug).toBe('tester');
    expect(roleForAgentType(roles, 'general-purpose')).toBeUndefined();
    expect(roleForAgentType(roles, undefined)).toBeUndefined();
    expect(claudeAgentName('A_b')).toBe('a-b');
  });
});

describe('mergeHookSettings', () => {
  const foreign = {
    permissions: { allow: ['Bash(npm run *)'] },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node lint.cjs', timeout: 10 }] }]
    }
  };

  it('добавляет наши записи и сохраняет чужие', () => {
    const res = mergeHookSettings(JSON.stringify(foreign), 'claude', { timeoutSec: 900, install: true });
    if (!res.ok) throw new Error(res.error);
    const parsed = JSON.parse(res.content);
    expect(parsed.permissions).toEqual(foreign.permissions);
    expect(parsed.hooks.PreToolUse).toHaveLength(2);
    expect(parsed.hooks.PreToolUse[0]).toEqual(foreign.hooks.PreToolUse[0]);
    expect(parsed.hooks.PreToolUse[1]).toEqual({ matcher: '*', hooks: [{ type: 'command', command: hookCommand('claude', 900), timeout: 900 }] });
    expect(parsed.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: hookCommand('claude', 900), timeout: 900 }] }]);
    expect(Object.keys(parsed.hooks).sort()).toEqual(['PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'Stop']);
    expect(hasOurHooks(res.content)).toBe(true);
  });

  it('идемпотентно и снимается целиком', () => {
    const once = mergeHookSettings(null, 'codex', { timeoutSec: 600, install: true });
    if (!once.ok) throw new Error(once.error);
    const twice = mergeHookSettings(once.content, 'codex', { timeoutSec: 600, install: true });
    expect(twice).toEqual(once);
    expect(JSON.parse(once.content).hooks.PreToolUse[0].matcher).toBe('.*');
    expect(hookCommand('codex', 600)).toBe('node .projecthub/hooks/projecthub-hook.mjs codex --budget 600');
    const removed = mergeHookSettings(once.content, 'codex', { timeoutSec: 600, install: false });
    expect(removed).toEqual({ ok: true, content: '{}\n' });
  });

  it('смена тайм-аута заменяет наш обработчик, а не дублирует', () => {
    const a = mergeHookSettings(null, 'claude', { timeoutSec: 600, install: true });
    if (!a.ok) throw new Error(a.error);
    const b = mergeHookSettings(a.content, 'claude', { timeoutSec: 99999, install: true });
    if (!b.ok) throw new Error(b.error);
    const pre = JSON.parse(b.content).hooks.PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0].hooks[0].timeout).toBe(3600);
  });

  it('невалидный JSON и hooks не-объект — ошибка, файл не меняется', () => {
    expect(mergeHookSettings('{oops', 'claude', { timeoutSec: 600, install: true }).ok).toBe(false);
    expect(mergeHookSettings('{"hooks": []}', 'claude', { timeoutSec: 600, install: true }).ok).toBe(false);
    expect(mergeHookSettings('[1]', 'claude', { timeoutSec: 600, install: true }).ok).toBe(false);
    expect(hasOurHooks('{oops')).toBe(false);
  });
});

/** Google Antigravity (TASK-106, decision-62): имена инструментов и форматы — из живой проверки agy 1.2.12. */
describe('Antigravity', () => {
  /** Имена, которые реестр agy 1.2.12 принял в `tools` субагента. Неизвестное имя не даёт субагенту запуститься. */
  const VERIFIED = new Set([
    'view_file', 'list_dir', 'grep_search', 'find_by_name', 'write_to_file', 'replace_file_content',
    'multi_replace_file_content', 'run_command', 'search_web', 'read_url_content', 'invoke_subagent', 'manage_subagents', 'ask_question'
  ]);

  it('в маппинге только проверенные имена инструментов', () => {
    for (const tools of Object.values(ANTIGRAVITY_TOOLS_BY_CATEGORY)) for (const t of tools) expect(VERIFIED.has(t)).toBe(true);
  });

  it('роль без категорий получает все инструменты; права роли убирают категории', () => {
    expect(antigravityToolsForRole(role()).tools).toEqual(Object.values(ANTIGRAVITY_TOOLS_BY_CATEGORY).flat());
    const readOnly = antigravityToolsForRole(role({ tools: ['read', 'write', 'command'], permissions: { allowFileWrite: false, allowCommands: false } }));
    expect(readOnly).toEqual({ tools: ['view_file', 'list_dir', 'grep_search', 'find_by_name'], removed: ['write', 'command'] });
    expect(antigravityToolsForRole(role({ tools: ['read'], permissions: { allowFileRead: false } })).tools).toEqual([]);
  });

  it('модель: только inherit | flash | pro', () => {
    expect(antigravityModelAlias('pro')).toBe('pro');
    expect(antigravityModelAlias('gemini-3.1-pro-high')).toBe('pro');
    expect(antigravityModelAlias('gemini-2.5-pro')).toBe('pro');
    expect(antigravityModelAlias('gemini-3.8-flash-low')).toBe('flash');
    expect(antigravityModelAlias('opus')).toBeUndefined();
    expect(antigravityModelAlias('gemini-embedding-001')).toBeUndefined();
    expect(resolveAntigravityModel(role({ model: 'gemini-3.6-flash-medium' }))).toEqual({ model: 'flash', source: 'explicit' });
    const t = tiers();
    t.tiers.frontier = [{ engine: 'gemini-cli', model: 'gemini-3.1-pro-high' }];
    expect(resolveAntigravityModel(role({ model: 'opus', modelTier: 'frontier' }), t)).toMatchObject({ model: 'pro', source: 'tier' });
    const inherit = resolveAntigravityModel(role({ modelTier: 'balanced' }), tiers());
    expect(inherit.model).toBe('inherit');
    expect(inherit.note).toContain('inherit');
  });

  it('файл агента: frontmatter разбирается, маркер снимается, tools списком', () => {
    const file = exported(buildAntigravityAgentFile(role({ slug: 'code_reviewer', tools: ['read', 'search'], model: 'pro' })));
    expect(file.relPath).toBe('.agents/agents/code-reviewer.md');
    expect(readMarker(file.content)).toEqual({ hash: contentHash(stripMarker(file.content)), role: 'code_reviewer' });
    const parsed = matter(file.content);
    expect(parsed.data).toEqual({
      name: 'code-reviewer',
      description: expect.stringContaining('Ревьюер'),
      tools: ['view_file', 'list_dir', 'grep_search', 'find_by_name', 'search_web', 'read_url_content'],
      model: 'pro'
    });
    expect(parsed.content.trim()).toBe('Проверяй изменения. Не правь файлы.');
  });

  it('роль с любым engine в Antigravity не экспортируется; заметки о том, что не выражается', () => {
    const skipped = buildAntigravityAgentFile(role({ engine: 'gemini-cli' }));
    expect(isSkippedExport(skipped) && skipped.reason).toContain('gemini-cli');
    const file = exported(buildAntigravityAgentFile(role({ maxTurns: 5, permissions: { allowCommands: false } })));
    expect(file.notes.some((n) => n.includes('лимит ходов'))).toBe(true);
    expect(file.notes.some((n) => n.includes('command'))).toBe(true);
  });

  it('встроенные роли экспортируются во все три движка без пропусков', () => {
    const { files, skipped } = buildRoleExport(BUILTIN_ROLES, ['claude', 'codex', 'antigravity']);
    expect(skipped).toEqual([]);
    expect(files).toHaveLength(BUILTIN_ROLES.length * 3);
    expect(new Set(files.map((f) => f.relPath)).size).toBe(files.length);
  });

  it('команда хука: путь от .agents/, событие аргументом', () => {
    expect(hookCommand('antigravity', 1800, 'Stop')).toBe('node ../.projecthub/hooks/projecthub-hook.mjs antigravity Stop --budget 1800');
  });

  it('hooks.json: своя группа projecthub, чужие группы не трогаются, Stop — плоский обработчик', () => {
    const current = JSON.stringify({ probe: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node probe.mjs' }] }] } });
    const merged = mergeHookSettings(current, 'antigravity', { timeoutSec: 900, install: true });
    expect(merged.ok).toBe(true);
    const root = JSON.parse(merged.ok ? merged.content : '{}');
    expect(root.probe).toEqual(JSON.parse(current).probe);
    expect(root.projecthub.PreToolUse).toEqual([
      { matcher: '*', hooks: [{ type: 'command', command: 'node ../.projecthub/hooks/projecthub-hook.mjs antigravity PreToolUse --budget 900', timeout: 900 }] }
    ]);
    expect(root.projecthub.Stop).toEqual([{ type: 'command', command: 'node ../.projecthub/hooks/projecthub-hook.mjs antigravity Stop --budget 900', timeout: 900 }]);
    expect(Object.keys(root.projecthub)).toEqual(['PreToolUse', 'PostToolUse', 'Stop']);
    expect(hasOurHooks(merged.ok ? merged.content : null)).toBe(true);
    expect(hasOurHooks(current)).toBe(false);

    const again = mergeHookSettings(merged.ok ? merged.content : null, 'antigravity', { timeoutSec: 900, install: true });
    expect(again.ok && again.content).toBe(merged.ok && merged.content);
    const removed = mergeHookSettings(merged.ok ? merged.content : null, 'antigravity', { timeoutSec: 900, install: false });
    expect(removed.ok && JSON.parse(removed.content)).toEqual(JSON.parse(current));
    expect(mergeHookSettings('{ bad', 'antigravity', { timeoutSec: 900, install: true }).ok).toBe(false);
    expect(mergeHookSettings('[]', 'antigravity', { timeoutSec: 900, install: true }).ok).toBe(false);
  });
});

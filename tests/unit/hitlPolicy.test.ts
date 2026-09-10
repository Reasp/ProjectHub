import { describe, expect, it } from 'vitest';
import {
  applyRolePermissions,
  evaluateToolRequest,
  isCommandDenied,
  isPathExcluded,
  isToolAllowed
} from '../../electron/services/hitlPolicy';
import type { AIProviderConfig } from '../../electron/services/aiAgentService';

const PROJECT = 'F:/ProjectHub';

const base = (autoApprove: boolean, rules: Partial<AIProviderConfig['autoApproveRules']> = {}): AIProviderConfig => ({
  provider: 'anthropic',
  model: 'default',
  autoApprove,
  autoApproveRules: {
    enabled: true,
    allowCommands: true,
    allowFileWrite: true,
    allowFileRead: true,
    allowSubagents: true,
    writeExcludePatterns: ['.env*'],
    readExcludePatterns: ['**/*.pem'],
    commandDenyList: ['rm -rf'],
    commandTimeoutSec: 300,
    ...rules
  }
});

describe('applyRolePermissions: роль только сужает глобальные настройки (decision-9, AC #4)', () => {
  it('без роли конфигурация не меняется', () => {
    const cfg = base(true);
    expect(applyRolePermissions(cfg)).toBe(cfg);
  });

  it('роль запрещает категории и добавляет исключения, но не расширяет права', () => {
    const cfg = applyRolePermissions(base(true), {
      allowFileWrite: false,
      allowCommands: true,
      writeExcludePatterns: ['backlog/**'],
      commandDenyList: ['git push'],
      commandTimeoutSec: 60,
      approvalTimeoutMin: 15
    });
    expect(cfg.autoApprove).toBe(true);
    expect(cfg.autoApproveRules?.allowFileWrite).toBe(false);
    expect(cfg.autoApproveRules?.allowCommands).toBe(true);
    expect(cfg.autoApproveRules?.writeExcludePatterns).toEqual(['.env*', 'backlog/**']);
    expect(cfg.autoApproveRules?.commandDenyList).toEqual(['rm -rf', 'git push']);
    expect(cfg.autoApproveRules?.commandTimeoutSec).toBe(60);
    expect(cfg.autoApproveRules?.approvalTimeoutMin).toBe(15);
  });

  it('роль не может включить auto-approve или категорию, выключенные глобально', () => {
    const cfg = applyRolePermissions(base(false, { allowCommands: false, commandTimeoutSec: 30 }), {
      autoApprove: true,
      allowCommands: true,
      commandTimeoutSec: 600
    });
    expect(cfg.autoApprove).toBe(false);
    expect(cfg.autoApproveRules?.allowCommands).toBe(false);
    expect(cfg.autoApproveRules?.commandTimeoutSec).toBe(30);
  });

  it('роль с autoApprove=false выключает авто-одобрение при включённом глобальном', () => {
    expect(applyRolePermissions(base(true), { autoApprove: false }).autoApprove).toBe(false);
  });

  it('allow-список инструментов роли пересекается с глобальным', () => {
    const cfg = applyRolePermissions(base(true, { allowedTools: ['Read', 'Bash', 'mcp__projecthub*'] }), {
      allowedTools: ['Read', 'Write', 'mcp__projecthub-hitl__permission_prompt']
    });
    expect(cfg.autoApproveRules?.allowedTools).toEqual(['Read', 'mcp__projecthub-hitl__permission_prompt']);
    expect(isToolAllowed('Bash', cfg.autoApproveRules?.allowedTools)).toBe(false);
  });
});

describe('evaluateToolRequest: вердикты политики', () => {
  it('запись вне корня проекта — deny всегда, даже при auto-approve', () => {
    for (const cfg of [base(true), base(false), applyRolePermissions(base(true), { autoApprove: true })]) {
      const v = evaluateToolRequest(cfg, PROJECT, 'Write', { file_path: '../outside.txt' });
      expect(v.verdict).toBe('deny');
      expect(v.rule).toBe('outside-project');
      expect(evaluateToolRequest(cfg, PROJECT, 'Edit', { file_path: 'C:/Windows/system.ini' }).verdict).toBe('deny');
      expect(evaluateToolRequest(cfg, PROJECT, 'write_file', { filePath: '../../x' }).verdict).toBe('deny');
    }
  });

  it('auto-approve: обычная запись/команда allow, исключения и deny-list — ask', () => {
    const cfg = base(true);
    expect(evaluateToolRequest(cfg, PROJECT, 'Write', { file_path: 'src/a.ts' })).toEqual({ verdict: 'allow', rule: 'auto-write' });
    expect(evaluateToolRequest(cfg, PROJECT, 'Write', { file_path: '.env.local' }).rule).toBe('write-excluded');
    expect(evaluateToolRequest(cfg, PROJECT, 'Bash', { command: 'npm test' })).toEqual({ verdict: 'allow', rule: 'auto-command' });
    expect(evaluateToolRequest(cfg, PROJECT, 'Bash', { command: 'rm -rf node_modules' })).toEqual({ verdict: 'ask', rule: 'command-denied' });
    expect(evaluateToolRequest(cfg, PROJECT, 'Read', { file_path: 'certs/key.pem' }).rule).toBe('read-excluded');
    expect(evaluateToolRequest(cfg, PROJECT, 'Read', { file_path: 'src/a.ts' }).verdict).toBe('allow');
    expect(evaluateToolRequest(cfg, PROJECT, 'Read', { file_path: 'C:/other/file.txt' }).rule).toBe('read-outside');
    expect(evaluateToolRequest(cfg, PROJECT, 'WebFetch', { url: 'https://x' })).toEqual({ verdict: 'allow', rule: 'auto-other' });
    expect(evaluateToolRequest(cfg, PROJECT, 'AskUserQuestion', {}).verdict).toBe('ask');
  });

  it('ручной режим: всё требует карточки, кроме чтения внутри проекта', () => {
    const cfg = base(false);
    expect(evaluateToolRequest(cfg, PROJECT, 'Write', { file_path: 'src/a.ts' })).toEqual({ verdict: 'ask', rule: 'manual' });
    expect(evaluateToolRequest(cfg, PROJECT, 'Bash', { command: 'ls' })).toEqual({ verdict: 'ask', rule: 'manual' });
    expect(evaluateToolRequest(cfg, PROJECT, 'Read', { file_path: 'src/a.ts' }).verdict).toBe('allow');
    expect(evaluateToolRequest(cfg, PROJECT, 'WebFetch', {}).verdict).toBe('ask');
  });

  it('права роли сужают вердикт: allowFileWrite=false → ask, инструмент вне allow-списка → deny', () => {
    const cfg = applyRolePermissions(base(true), { allowFileWrite: false, allowedTools: ['Read', 'Bash', 'Write', 'Edit'] });
    expect(evaluateToolRequest(cfg, PROJECT, 'Write', { file_path: 'src/a.ts' })).toEqual({ verdict: 'ask', rule: 'write-manual' });
    expect(evaluateToolRequest(cfg, PROJECT, 'WebFetch', { url: 'https://x' }).rule).toBe('tool-not-allowed');
    expect(evaluateToolRequest(cfg, PROJECT, 'WebFetch', { url: 'https://x' }).verdict).toBe('deny');
    expect(evaluateToolRequest(cfg, PROJECT, 'Bash', { command: 'npm test' }).verdict).toBe('allow');
  });

  it('подагенты: allow при allowSubagents, ask при запрете', () => {
    expect(evaluateToolRequest(base(true), PROJECT, 'Task', {}).verdict).toBe('allow');
    expect(evaluateToolRequest(base(true, { allowSubagents: false }), PROJECT, 'Agent', {}).rule).toBe('subagent-manual');
  });
});

describe('вспомогательные матчеры', () => {
  it('isPathExcluded поддерживает **/, *.ext, prefix*, точное имя', () => {
    expect(isPathExcluded('src/.env.local', ['.env*'])).toBe(true);
    expect(isPathExcluded('certs/server.key', ['**/*.key'])).toBe(true);
    expect(isPathExcluded('src/a.ts', ['**/*.key', '.env*'])).toBe(false);
    expect(isPathExcluded('infra.config.json', ['infra.config.json'])).toBe(true);
  });

  it('isCommandDenied — подстрока без учёта регистра', () => {
    expect(isCommandDenied('GIT PUSH origin', ['git push'])).toBe(true);
    expect(isCommandDenied('git status', ['git push'])).toBe(false);
  });

  it('isToolAllowed — пустой список разрешает всё, суффикс * — префикс', () => {
    expect(isToolAllowed('Bash')).toBe(true);
    expect(isToolAllowed('Bash', [])).toBe(true);
    expect(isToolAllowed('mcp__projecthub__x', ['mcp__projecthub*'])).toBe(true);
    expect(isToolAllowed('Bash', ['Read'])).toBe(false);
  });
});

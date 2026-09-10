import path from 'node:path';
import { isInsideProject } from './pathGuard.js';
import type { AIProviderConfig, AutoApproveRules } from './aiAgentService.js';
import type { RolePermissions } from './hitlTypes.js';

/**
 * Политики HITL (TASK-57, decision-10 п. 3): чистые функции без Electron и процессов.
 *
 * - `applyRolePermissions` сужает глобальные настройки пользователя правами роли (decision-9):
 *   роль может только запретить, добавить исключения или уменьшить таймаут, но не расширить права.
 * - `evaluateToolRequest` даёт вердикт `allow | deny | ask` с именем правила для аудита.
 *   Итоговую карточку и ответ движку строит `claudeBridgeService.handleCliPermissionRequest`.
 */

/** Инструменты Claude Code, изменяющие файлы. */
export const CLI_WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
export const CLI_READ_TOOLS = ['Read', 'NotebookRead'];
export const CLI_COMMAND_TOOLS = ['Bash', 'PowerShell'];
export const CLI_SUBAGENT_TOOLS = ['Agent', 'Task'];

export type PolicyVerdict = {
  verdict: 'allow' | 'deny' | 'ask';
  /** Имя правила для аудита (`auto-command`, `outside-project`, `manual` …). */
  rule: string;
  reason?: string;
};

export function isPathExcluded(filePath: string, patterns: string[] = []): boolean {
  if (!filePath || !patterns || patterns.length === 0) return false;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const baseName = path.basename(normalized);

  const matches = (pattern: string): boolean => {
    if (!pattern) return false;

    if (pattern.startsWith('**/')) {
      // `**/<sub>`: на любой глубине — сводим к проверке <sub> (в т.ч. `**/*.key`, `**/.env*`)
      const sub = pattern.slice(3);
      return matches(sub) || normalized.endsWith('/' + sub);
    }
    if (pattern.startsWith('./')) {
      return matches(pattern.slice(2));
    }
    if (pattern.startsWith('*') && pattern.endsWith('*')) {
      const sub = pattern.slice(1, -1);
      return normalized.includes(sub);
    }
    if (pattern.startsWith('*')) {
      const ext = pattern.slice(1);
      return normalized.endsWith(ext);
    }
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return normalized.startsWith(prefix) || baseName.startsWith(prefix);
    }
    return normalized === pattern || baseName === pattern || normalized.endsWith('/' + pattern);
  };

  return patterns.some((rawPattern) => matches(rawPattern.trim().replace(/\\/g, '/').toLowerCase()));
}

export function isCommandDenied(command: string, denyList: string[] = []): boolean {
  if (!command || !denyList || denyList.length === 0) return false;
  const normCmd = command.trim().toLowerCase();
  return denyList.some((denied) => {
    const d = denied.trim().toLowerCase();
    return d && normCmd.includes(d);
  });
}

/**
 * Совпадение имени инструмента с allow-списком роли. Поддерживается точное имя и суффикс `*`
 * (`mcp__projecthub*`). Регистр учитывается — имена инструментов движков чувствительны к нему.
 */
export function isToolAllowed(tool: string, allowedTools?: string[]): boolean {
  if (!allowedTools || allowedTools.length === 0) return true;
  return allowedTools.some((pattern) => {
    const p = pattern.trim();
    if (!p) return false;
    if (p === '*') return true;
    if (p.endsWith('*')) return tool.startsWith(p.slice(0, -1));
    return tool === p;
  });
}

function unionList(a?: string[], b?: string[]): string[] {
  const out = new Set<string>();
  for (const v of a ?? []) if (v && v.trim()) out.add(v.trim());
  for (const v of b ?? []) if (v && v.trim()) out.add(v.trim());
  return Array.from(out);
}

function minDefined(a?: number, b?: number): number | undefined {
  const values = [a, b].filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return values.length ? Math.min(...values) : undefined;
}

/**
 * Права роли только сужают глобальные настройки: `false` запрещает категорию, списки исключений
 * и deny-list объединяются, таймауты берутся минимальные, allow-список инструментов пересекается.
 * Запись вне корня проекта не разрешается никакой комбинацией — это проверяет `evaluateToolRequest`.
 */
export function applyRolePermissions(config: AIProviderConfig, role?: RolePermissions): AIProviderConfig {
  if (!role) return config;
  const base: AutoApproveRules = config.autoApproveRules ?? {
    enabled: true,
    allowCommands: true,
    allowFileWrite: true,
    allowFileRead: true,
    allowSubagents: true,
    writeExcludePatterns: [],
    readExcludePatterns: [],
    commandDenyList: []
  };
  const narrow = (global: boolean, roleValue?: boolean) => global && roleValue !== false;

  let allowedTools: string[] | undefined = base.allowedTools?.length ? base.allowedTools : undefined;
  if (role.allowedTools?.length) {
    allowedTools = allowedTools
      ? role.allowedTools.filter((t) => isToolAllowed(t, allowedTools))
      : [...role.allowedTools];
  }

  return {
    ...config,
    autoApprove: narrow(Boolean(config.autoApprove), role.autoApprove),
    autoApproveRules: {
      ...base,
      allowCommands: narrow(base.allowCommands !== false, role.allowCommands),
      allowFileWrite: narrow(base.allowFileWrite !== false, role.allowFileWrite),
      allowFileRead: narrow(base.allowFileRead !== false, role.allowFileRead),
      allowSubagents: narrow(base.allowSubagents !== false, role.allowSubagents),
      writeExcludePatterns: unionList(base.writeExcludePatterns, role.writeExcludePatterns),
      readExcludePatterns: unionList(base.readExcludePatterns, role.readExcludePatterns),
      commandDenyList: unionList(base.commandDenyList, role.commandDenyList),
      commandTimeoutSec: minDefined(base.commandTimeoutSec, role.commandTimeoutSec),
      approvalTimeoutMin: minDefined(base.approvalTimeoutMin, role.approvalTimeoutMin),
      ...(allowedTools ? { allowedTools } : {})
    }
  };
}

/** Путь к файлу из входа инструмента Claude Code / API-движка. */
export function filePathFromInput(input: Record<string, unknown>): string {
  return String(input.file_path || input.notebook_path || input.filePath || input.path || '');
}

export function commandFromInput(input: Record<string, unknown>): string {
  return String(input.command || input.cmd || '');
}

/**
 * Вердикт политики для запроса инструмента. `ask` означает «показать карточку человеку»,
 * `deny` — отклонить без карточки (вне корня проекта, инструмент вне allow-списка роли).
 */
export function evaluateToolRequest(
  config: AIProviderConfig,
  projectPath: string,
  tool: string,
  input: Record<string, unknown>
): PolicyVerdict {
  const rules = config.autoApproveRules;
  const auto = Boolean(config.autoApprove);

  if (!isToolAllowed(tool, rules?.allowedTools)) {
    return { verdict: 'deny', rule: 'tool-not-allowed', reason: `Инструмент ${tool} не входит в allow-список роли.` };
  }

  if (tool === 'AskUserQuestion' || tool === 'ask_question') {
    return { verdict: 'ask', rule: 'question' };
  }

  if (CLI_WRITE_TOOLS.includes(tool) || tool === 'write_file' || tool === 'write_to_file') {
    const filePath = filePathFromInput(input);
    if (filePath && !isInsideProject(projectPath, filePath)) {
      return {
        verdict: 'deny',
        rule: 'outside-project',
        reason: `Запись отклонена: путь "${filePath}" находится вне корня проекта "${projectPath}". `
          + 'Разрешены только пути внутри проекта — укажи путь относительно его корня без выхода через "..".'
      };
    }
    if (isPathExcluded(filePath, rules?.writeExcludePatterns)) return { verdict: 'ask', rule: 'write-excluded' };
    if (rules?.allowFileWrite === false) return { verdict: 'ask', rule: 'write-manual' };
    if (!auto) return { verdict: 'ask', rule: 'manual' };
    return { verdict: 'allow', rule: 'auto-write' };
  }

  if (CLI_READ_TOOLS.includes(tool) || tool === 'read_file' || tool === 'read') {
    const filePath = filePathFromInput(input);
    if (isPathExcluded(filePath, rules?.readExcludePatterns)) return { verdict: 'ask', rule: 'read-excluded' };
    if (filePath && !isInsideProject(projectPath, filePath)) return { verdict: 'ask', rule: 'read-outside' };
    if (rules?.allowFileRead === false) return { verdict: 'ask', rule: 'read-manual' };
    return { verdict: 'allow', rule: 'auto-read' };
  }

  if (CLI_COMMAND_TOOLS.includes(tool) || tool === 'run_command' || tool === 'bash') {
    const cmd = commandFromInput(input);
    if (isCommandDenied(cmd, rules?.commandDenyList)) return { verdict: 'ask', rule: 'command-denied' };
    if (rules?.allowCommands === false) return { verdict: 'ask', rule: 'command-manual' };
    if (!auto) return { verdict: 'ask', rule: 'manual' };
    return { verdict: 'allow', rule: 'auto-command' };
  }

  if (CLI_SUBAGENT_TOOLS.includes(tool) || tool === 'spawn_subagent' || tool === 'dispatch_agent') {
    if (rules?.allowSubagents === false) return { verdict: 'ask', rule: 'subagent-manual' };
    if (!auto) return { verdict: 'ask', rule: 'manual' };
    return { verdict: 'allow', rule: 'auto-subagent' };
  }

  return auto ? { verdict: 'allow', rule: 'auto-other' } : { verdict: 'ask', rule: 'manual' };
}

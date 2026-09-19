/**
 * Единый адаптер применения роли к движку агента (decision-9 п.2, decision-4 п.4, TASK-60).
 *
 * Строит аргументы вызова CLI/параметры API-движка из `RoleDefinition` одинаково для всех
 * движков и явно сообщает, какие ограничения роли данный движок не может выразить нативно
 * (`unsupportedFeatures`) — вместо того чтобы молча их игнорировать.
 *
 * Флаги `claude` подтверждены локально (`claude --help`, 2026-09-10): `--append-system-prompt`,
 * `--model`, `--allowedTools`/`--disallowedTools` (comma/space-separated), `--max-budget-usd`
 * (только с `--print`); нативного лимита ходов у CLI нет — `maxTurns` для claude-cli
 * реализован на уровне ProjectHub (счётчик `assistant`-событий в `agentFleetService`), а не
 * флагом. Флаги `codex exec`/`gemini` взяты из актуальной публичной документации
 * (developers.openai.com/codex, geminicli.com) — `codex`/`gemini` не установлены на машине
 * разработки, синтаксис не проверен эмпирически (см. `implementationNotes` TASK-60);
 * рекомендуется ручной smoke-test на машине с этими CLI.
 */
import type { RoleDefinition, RoleEngine, ToolCategory } from './roleTypes.js';
import { claudeCliEffortArgs, type ReasoningEffort } from './reasoningEffort.js';

export type RoleFeature = 'systemPrompt' | 'model' | 'tools' | 'maxTurns';

/** Что движок способен выразить нативно (systemPrompt у codex/gemini — через промпт-преамбулу, не флаг). */
export const ENGINE_CAPABILITIES: Record<RoleEngine, Record<RoleFeature, boolean>> = {
  'claude-cli': { systemPrompt: true, model: true, tools: true, maxTurns: true },
  'codex-cli': { systemPrompt: true, model: true, tools: false, maxTurns: false },
  'gemini-cli': { systemPrompt: true, model: true, tools: false, maxTurns: false },
  // maxTurns API-движка — лимит шагов tool-loop в agentFleetService (TASK-101, decision-46 п. 4).
  api: { systemPrompt: true, model: true, tools: true, maxTurns: true }
};

const CLAUDE_TOOLS_BY_CATEGORY: Record<ToolCategory, string[]> = {
  read: ['Read', 'Glob', 'Grep', 'NotebookRead'],
  write: ['Write', 'Edit', 'NotebookEdit'],
  command: ['Bash'],
  search: ['WebFetch', 'WebSearch'],
  subagent: ['Task'],
  question: ['AskUserQuestion']
};

/** Инструменты API-движка (`aiAgentService.getAnthropicTools`) по категориям. */
const API_TOOLS_BY_CATEGORY: Record<ToolCategory, string[]> = {
  read: ['read_file', 'list_dir'],
  write: ['write_file'],
  command: ['run_command'],
  search: ['search_rag'],
  subagent: [],
  question: ['ask_question']
};

function namesForCategories(map: Record<ToolCategory, string[]>, categories: ToolCategory[]): string[] {
  const set = new Set<string>();
  for (const c of categories) for (const t of map[c] || []) set.add(t);
  return Array.from(set);
}

export function claudeToolNamesForCategories(categories: ToolCategory[]): string[] {
  return namesForCategories(CLAUDE_TOOLS_BY_CATEGORY, categories);
}

export function apiToolNamesForCategories(categories: ToolCategory[]): string[] {
  return namesForCategories(API_TOOLS_BY_CATEGORY, categories);
}

export interface EngineInvocationInput {
  engine: RoleEngine;
  role?: RoleDefinition;
  /** Доп. инструкции слота поверх системного промпта роли (`systemPromptAddon`). */
  extraSystemPrompt?: string;
  model?: string;
  /** Усилие рассуждений слота (decision-41 п. 5): `--effort` у claude-cli, у остальных CLI не передаётся. */
  reasoningEffort?: ReasoningEffort;
  budgetUsd?: number;
  /** Эффективные (уже суженные глобальными настройками) права — влияют на sandbox/approval. */
  autoApprove?: boolean;
  allowFileWrite?: boolean;
}

export interface EngineInvocation {
  /** Аргументы CLI (без учёта позиционного промпта — он всегда идёт через stdin). */
  args: string[];
  /** Текст, который нужно предпослать промпту пользователя (для движков без нативного system-prompt флага). */
  promptPrefix?: string;
  /** Какие поля роли были заданы, но данный движок не может выразить их нативно. */
  unsupportedFeatures: RoleFeature[];
  /** Почему усилие рассуждений не передано движку — для лога агента. */
  effortNote?: string;
}

function combinedSystemPrompt(role: RoleDefinition | undefined, extra: string | undefined): string {
  return [role?.systemPrompt?.trim(), extra?.trim()].filter(Boolean).join('\n\n');
}

/**
 * Выносит `--append-system-prompt <текст>` из аргументов CLI. Claude CLI запускается через оболочку
 * (`shell: true`), а cmd.exe обрезает командную строку на первом переводе строки: многострочный
 * системный промпт роли терял всё после первой строки вместе со следующими флагами. Вызывающий код
 * пишет текст во временный файл и передаёт `--append-system-prompt-file` (TASK-82).
 */
export function extractAppendSystemPrompt(args: string[]): { args: string[]; systemPrompt?: string } {
  const index = args.indexOf('--append-system-prompt');
  if (index < 0 || index + 1 >= args.length) return { args: [...args] };
  return { args: [...args.slice(0, index), ...args.slice(index + 2)], systemPrompt: args[index + 1] };
}

/** Codex/Gemini CLI: флаг усилия не проверялся — не передаём и пишем, почему (decision-41 п. 5). */
function cliEffortIgnored(engine: RoleEngine, effort: ReasoningEffort | undefined): { effortNote?: string } {
  return effort ? { effortNote: `усилие рассуждений «${effort}» движку ${engine} не передаётся` } : {};
}

export function buildEngineInvocation(input: EngineInvocationInput): EngineInvocation {
  const { engine, role, extraSystemPrompt, model, budgetUsd, autoApprove } = input;
  const capabilities = ENGINE_CAPABILITIES[engine];
  const systemPrompt = combinedSystemPrompt(role, extraSystemPrompt);
  const unsupportedFeatures: RoleFeature[] = [];
  const hasTools = Boolean(role?.tools && role.tools.length > 0);
  const hasMaxTurns = typeof role?.maxTurns === 'number' && role.maxTurns > 0;
  if (hasTools && !capabilities.tools) unsupportedFeatures.push('tools');
  if (hasMaxTurns && !capabilities.maxTurns) unsupportedFeatures.push('maxTurns');

  const args: string[] = [];

  if (engine === 'claude-cli') {
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
    if (model && model !== 'default') args.push('--model', model);
    const effort = claudeCliEffortArgs(input.reasoningEffort);
    args.push(...effort.args);
    if (hasTools) args.push('--allowedTools', claudeToolNamesForCategories(role!.tools!).join(','));
    if (typeof budgetUsd === 'number' && budgetUsd > 0) args.push('--max-budget-usd', String(budgetUsd));
    // maxTurns у claude-cli нет нативного флага — считается и обеспечивается в agentFleetService
    // по потоку stream-json (счётчик `assistant`-событий), поэтому capabilities.maxTurns = true.
    return { args, unsupportedFeatures, ...(effort.note ? { effortNote: effort.note } : {}) };
  }

  if (engine === 'codex-cli') {
    const sandbox = input.allowFileWrite === false ? 'read-only' : 'workspace-write';
    const approval = autoApprove ? 'never' : 'on-failure';
    args.push('exec', '--json', '--sandbox', sandbox, '--ask-for-approval', approval);
    if (model && model !== 'default') args.push('-m', model);
    return { args, promptPrefix: systemPrompt || undefined, unsupportedFeatures, ...cliEffortIgnored(engine, input.reasoningEffort) };
  }

  if (engine === 'gemini-cli') {
    const approvalMode = autoApprove ? 'yolo' : 'default';
    args.push('--approval-mode', approvalMode, '--output-format', 'json');
    if (model && model !== 'default') args.push('-m', model);
    return { args, promptPrefix: systemPrompt || undefined, unsupportedFeatures, ...cliEffortIgnored(engine, input.reasoningEffort) };
  }

  // api — системный промпт и allow-список инструментов применяются напрямую в aiAgentService,
  // аргументы CLI не нужны.
  return { args: [], promptPrefix: systemPrompt || undefined, unsupportedFeatures };
}

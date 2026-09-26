/**
 * Единая точка сборки контекста агента (TASK-64, decision-18, decision-4 п.4).
 *
 * Собирает контекст один раз (задача + AC, релевантные чанки RAG, связанный код GitNexus,
 * git-статус) и отдаёт готовую строку для `extraSystemPrompt`/`--append-system-prompt` —
 * дальше он течёт по уже существующему единому каналу `roleEngineAdapter.buildEngineInvocation`
 * для всех движков (Claude CLI, Codex, Gemini, API), а не по отдельной ветке на каждый.
 *
 * `assembleContext` — чистая функция обрезки по бюджету символов, без fs/сети; остальное —
 * best-effort источники: любая часть, которая не смогла собраться (нет индекса RAG, GitNexus
 * не проиндексирован, задача не найдена), просто отсутствует в результате, не бросая ошибку.
 */
import { parseTaskBody } from './backlogTaskFormat.js';
import { findTaskFile } from './taskFileLookup.js';
import { searchProjectDocs } from './ragSearch.js';
import { fetchGitNexusContext } from './gitNexusClient.js';
import { gitService } from './gitService.js';
import { readMemory, type MemoryEntry } from './memoryStore.js';
import { searchMemoryFacts } from './memorySearch.js';
import { buildMemoryInstructions } from './memoryTools.js';

export type ContextPartKey = 'task' | 'memory' | 'rag' | 'gitnexus' | 'git';

export interface ContextPart {
  key: ContextPartKey;
  label: string;
  text: string;
}

export interface AgentContextOptions {
  projectPath: string;
  taskId?: string;
  enabledParts?: Partial<Record<ContextPartKey, boolean>>;
  maxChars?: number;
  ragLimit?: number;
  /** Каталог для git-статуса, если агент работает в изолированном worktree, а не в `projectPath`. */
  gitCwd?: string;
  /**
   * Префикс инструментов памяти, если агент умеет писать в память (`memory_` у API-агента,
   * `mcp__projecthub-hitl__memory_` у Claude CLI): тогда в часть памяти добавляется инструкция.
   * Без него — память только для чтения (Codex, Gemini CLI, предпросмотр).
   */
  memoryToolPrefix?: string;
}

export interface AgentContextResult {
  /** Готовый блок для extraSystemPrompt; пустая строка, если собирать было нечего. */
  combined: string;
  /** Части, вошедшие в результат (после обрезки), в порядке приоритета. */
  parts: ContextPart[];
  includedKeys: ContextPartKey[];
  /** Части, которые пришлось обрезать или отбросить целиком из-за лимита `maxChars`. */
  truncatedKeys: ContextPartKey[];
}

export const DEFAULT_CONTEXT_MAX_CHARS = 6000;
/** Своя доля памяти в бюджете контекста (decision-51 п. 6): память не вытесняет RAG. */
export const MEMORY_CONTEXT_MAX_CHARS = 1500;
/** Сколько фактов подмешивается целиком (остальные — строкой индекса). */
export const MEMORY_CONTEXT_RELEVANT = 3;
const MEMORY_CONTEXT_BODY_MAX = 600;
const DEFAULT_RAG_LIMIT = 5;
const PART_LABELS: Record<ContextPartKey, string> = {
  task: 'Текущая задача',
  memory: 'Память проекта',
  rag: 'Релевантная документация',
  gitnexus: 'Связанный код (GitNexus)',
  git: 'Git-статус'
};
/** Порядок приоритета при обрезке — младшие обрезаются первыми. */
const PART_PRIORITY: ContextPartKey[] = ['task', 'memory', 'rag', 'gitnexus', 'git'];
/** Потолок отдельных частей независимо от общего бюджета. */
const PART_MAX_CHARS: Partial<Record<ContextPartKey, number>> = { memory: MEMORY_CONTEXT_MAX_CHARS };

interface RawPart {
  key: ContextPartKey;
  text: string;
}

/**
 * Инструкция accessibility-first для агентов с инструментами `computer_*` (TASK-82, decision-27 п. 5).
 * Одна для всех движков и моделей: сначала дерево доступности и действия по элементам — так
 * справляются модели без vision и тратится меньше токенов; скриншот — для проверки результата.
 * `toolPrefix` — как инструменты видны движку (`computer_` у API-агента, `mcp__projecthub-hitl__computer_` у Claude CLI).
 */
export function buildComputerUseInstructions(toolPrefix = 'computer_'): string {
  const t = (name: string) => `${toolPrefix}${name}`;
  return [
    '## Управление компьютером',
    `Тебе доступны инструменты ${toolPrefix}* — управление рабочим столом пользователя через ProjectHub. Порядок работы:`,
    `1. Сначала структура, а не пиксели: ${t('list_windows')} или ${t('get_frontmost_app')}, затем ${t('get_ui_tree')} / ${t('find_element')} с window_id из списка окон.`,
    `2. Действуй по элементам: ${t('click_element')}, ${t('set_value')}, ${t('press_button')}, ${t('select_menu_item')}. Приложение — ${t('open_application')} (на Windows имя процесса, например notepad.exe). Ввод текста и сочетания клавиш — ${t('type')} / ${t('key')} с target_app или target_window_id.`,
    `3. ${t('screenshot')} — чтобы проверить результат или если дерево доступности пустое. Координаты с изображения передавай с coordinate_space: "screenshot", ProjectHub пересчитает их; bounds из дерева доступности уже экранные.`,
    `4. Координатные клики (${t('left_click')} и подобные) — крайний случай.`,
    '5. Действия вне разрешённых приложений, в файловых диалогах и опасные инструменты требуют подтверждения человека. Отказ, блокировку или kill-switch не обходи другими инструментами — остановись и сообщи пользователю.'
  ].join('\n');
}

/**
 * Текст части «Память проекта» (decision-51 п. 6): строки индекса — все факты по одной строке, от новых
 * к старым; тела до `MEMORY_CONTEXT_RELEVANT` фактов, найденных по `query` (заголовок и описание задачи).
 * Инструкция записи — только если у агента есть инструмент. Пустая память без инструмента — пустая строка.
 */
export function buildMemoryContextText(
  facts: readonly MemoryEntry[],
  query: string,
  options: { toolPrefix?: string; relevant?: number; bodyMax?: number } = {}
): string {
  const { toolPrefix, relevant = MEMORY_CONTEXT_RELEVANT, bodyMax = MEMORY_CONTEXT_BODY_MAX } = options;
  const lines: string[] = [];
  const hits = query.trim() ? searchMemoryFacts(query, facts, relevant).map((h) => h.fact) : [];
  if (hits.length > 0) {
    lines.push('Относится к задаче:');
    for (const f of hits) {
      const body = f.body.length > bodyMax ? `${f.body.slice(0, bodyMax).trimEnd()}…` : f.body;
      lines.push(`### ${f.id}: ${f.title}`, body, '');
    }
  }
  const rest = [...facts].reverse().filter((f) => !hits.includes(f));
  if (rest.length > 0) {
    lines.push(hits.length > 0 ? 'Остальные факты (полный текст — memory_search или backlog/memory):' : 'Факты (полный текст — memory_search или backlog/memory):');
    for (const f of rest) lines.push(`- ${f.id}: ${f.title} — ${f.description}`);
  }
  if (toolPrefix) {
    if (facts.length === 0) lines.push('Память проекта пока пуста.');
    lines.push('', buildMemoryInstructions(toolPrefix));
  }
  return lines.join('\n').trim();
}

/** Чистая обрезка по бюджету символов — приоритет `task` > `memory` > `rag` > `gitnexus` > `git`. */
export function assembleContext(rawParts: RawPart[], maxChars: number): AgentContextResult {
  const byKey = new Map(rawParts.filter((p) => p.text.trim().length > 0).map((p) => [p.key, p.text.trim()]));
  const parts: ContextPart[] = [];
  const truncatedKeys: ContextPartKey[] = [];
  let used = 0;

  for (const key of PART_PRIORITY) {
    const text = byKey.get(key);
    if (text === undefined) continue;

    const label = PART_LABELS[key];
    const header = `## ${label}\n`;
    const separator = parts.length > 0 ? '\n\n' : '';
    const overhead = separator.length + header.length;
    const budget = maxChars - used - overhead;

    if (budget <= 0) {
      truncatedKeys.push(key);
      continue;
    }

    const partCap = PART_MAX_CHARS[key];
    const cappedBudget = partCap !== undefined ? Math.min(budget, partCap) : budget;
    const fits = text.length <= cappedBudget;
    const finalText = fits ? text : `${text.slice(0, cappedBudget).trimEnd()}\n…(обрезано)`;
    if (!fits) truncatedKeys.push(key);

    parts.push({ key, label, text: finalText });
    used += overhead + finalText.length;
  }

  const combined = parts.map((p) => `## ${p.label}\n${p.text}`).join('\n\n');
  return { combined, parts, includedKeys: parts.map((p) => p.key), truncatedKeys };
}

function extractFileReferences(data: Record<string, unknown>): string[] {
  const refs = data.references;
  if (!Array.isArray(refs)) return [];
  return refs
    .map((r) => String(r))
    .filter((r) => !/^https?:\/\//i.test(r) && /\.[a-zA-Z0-9]+$/.test(r))
    .slice(0, 8);
}

/** Часть памяти: best-effort, как и остальные источники. */
async function collectMemory(projectPath: string, query: string, toolPrefix: string | undefined): Promise<RawPart | null> {
  try {
    const { facts } = await readMemory(projectPath);
    const text = buildMemoryContextText(facts, query, { toolPrefix });
    return text ? { key: 'memory', text } : null;
  } catch (err) {
    console.warn('[contextBuilder] memory read failed:', err);
    return null;
  }
}

/**
 * Собирает контекст агента для задачи `taskId` в проекте `projectPath`. Без задачи (или если файл задачи
 * не найден) остаётся только память проекта — она нужна и свободной сессии (decision-51 п. 6).
 */
export async function buildAgentContext(options: AgentContextOptions): Promise<AgentContextResult> {
  const { projectPath, taskId, enabledParts, maxChars = DEFAULT_CONTEXT_MAX_CHARS, ragLimit = DEFAULT_RAG_LIMIT, gitCwd = projectPath, memoryToolPrefix } = options;
  const isEnabled = (key: ContextPartKey) => enabledParts?.[key] !== false;
  const rawParts: RawPart[] = [];

  const task = taskId
    ? await findTaskFile(projectPath, taskId).catch((err) => {
        console.warn('[contextBuilder] failed to read task file:', err);
        return null;
      })
    : null;

  if (!task || !taskId) {
    if (isEnabled('memory')) {
      const memory = await collectMemory(projectPath, '', memoryToolPrefix);
      if (memory) rawParts.push(memory);
    }
    return assembleContext(rawParts, maxChars);
  }

  const { description, criteria } = parseTaskBody(task.content);
  const title = typeof task.data.title === 'string' ? task.data.title : taskId;

  if (isEnabled('memory')) {
    const memory = await collectMemory(projectPath, `${title} ${description}`, memoryToolPrefix);
    if (memory) rawParts.push(memory);
  }

  if (isEnabled('task')) {
    const acLines = criteria.map((c) => `- [${c.completed ? 'x' : ' '}] ${c.text}`).join('\n');
    rawParts.push({
      key: 'task',
      text: [`**${taskId}: ${title}**`, description, acLines ? `Acceptance Criteria:\n${acLines}` : '']
        .filter(Boolean)
        .join('\n\n')
    });
  }

  if (isEnabled('rag')) {
    const query = `${title} ${description}`.trim();
    if (query) {
      try {
        const results = await searchProjectDocs({ projectPath, query, mode: 'all', limit: ragLimit });
        if (results.length > 0) {
          const text = results
            .map((r) => `- [${r.category}] ${r.fileRelative}${r.heading ? ` — ${r.heading}` : ''}: ${r.snippet}`)
            .join('\n');
          rawParts.push({ key: 'rag', text });
        }
      } catch (err) {
        console.warn('[contextBuilder] RAG search failed:', err);
      }
    }
  }

  if (isEnabled('gitnexus')) {
    const files = extractFileReferences(task.data);
    if (files.length > 0) {
      try {
        const text = await fetchGitNexusContext({ projectPath, files });
        if (text) rawParts.push({ key: 'gitnexus', text });
      } catch (err) {
        console.warn('[contextBuilder] GitNexus lookup failed:', err);
      }
    }
  }

  if (isEnabled('git')) {
    try {
      const status = await gitService.getStatus(gitCwd);
      if (status) {
        const changed = [
          ...(status.modified ?? []),
          ...(status.not_added ?? []),
          ...(status.created ?? []),
          ...(status.deleted ?? [])
        ];
        const lines = [`Ветка: ${status.current ?? 'unknown'}`, `Изменённых файлов: ${changed.length}`];
        if (changed.length > 0) lines.push(changed.slice(0, 20).join('\n'));
        rawParts.push({ key: 'git', text: lines.join('\n') });
      }
    } catch (err) {
      console.warn('[contextBuilder] git status failed:', err);
    }
  }

  return assembleContext(rawParts, maxChars);
}

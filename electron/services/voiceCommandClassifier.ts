/**
 * LLM-классификатор свободных голосовых команд (TASK-83, п. 2).
 *
 * Быстрый разбор регулярками (`src/services/voiceCommandParser.ts`) покрывает знакомые фразы и
 * ничего не стоит. Всё, что он не узнал, попадает сюда: фраза уходит одним коротким запросом к
 * той модели, которую настроил пользователь, и возвращается структурированным интентом.
 *
 * Контракт с моделью намеренно минимальный, потому что ProjectHub не вправе требовать конкретного
 * вендора ([[decision-26]] п. 0), а JSON-режим (`response_format`) в проекте не поддержан ни одним
 * провайдером и у Anthropic его нет вовсе. Поэтому:
 *
 *  - основной формат — один JSON-объект, вынимаемый из произвольного текста толерантным сканером
 *    (модели любят ```-ограду и пояснения вокруг);
 *  - запасной формат — «голый» идентификатор интента одной строкой: это то немногое, что надёжно
 *    выполняет даже слабая локальная модель на 7B;
 *  - tool-use и structured output не требуются ни в каком виде.
 *
 * Подробности выбора — в [[decision-31]].
 *
 * Чистый модуль без Electron и IO — покрыт unit-тестами.
 */
import { extractJsonObject } from './reviewerPrompt.js';

/**
 * Тип интента совпадает с `ParsedVoiceCommand['type']` рендерера, плюс `computer` для команд
 * управления компьютером (TASK-82), которых у разбора регулярками нет.
 */
export type VoiceIntentType = 'navigation' | 'action' | 'ai_control' | 'computer' | 'dictation' | 'unknown';

export type VoicePayloadKind = 'string' | 'index';

export interface VoicePayloadField {
  name: string;
  kind: VoicePayloadKind;
  /** Без этого поля интент бессмысленен: «отправь агенту» без текста выполнять нечего. */
  required?: boolean;
  /** Пояснение для промпта. */
  hint: string;
}

export interface VoiceIntentSpec {
  id: string;
  type: VoiceIntentType;
  /** Описание для промпта — по нему модель и выбирает интент. */
  description: string;
  payload?: VoicePayloadField[];
}

const TEXT = (name: string, hint: string): VoicePayloadField => ({ name, kind: 'string', required: true, hint });
const INDEX = (name: string, hint: string): VoicePayloadField => ({ name, kind: 'index', hint });

/**
 * Каталог интентов, которые классификатор вправе вернуть. Совпадает с тем, что умеет исполнять
 * рендерер (`VoiceControlWidget.executeCommand`): интент, которого здесь нет, исполнить некому.
 */
export const VOICE_INTENT_CATALOG: VoiceIntentSpec[] = [
  // ── Вкладки и панели ──
  { id: 'navigate_ai', type: 'navigation', description: 'открыть Claude AI Studio (чат с агентом)' },
  { id: 'navigate_kanban', type: 'navigation', description: 'открыть доску задач и бэклог' },
  { id: 'navigate_milestones', type: 'navigation', description: 'открыть дорожную карту и майлстоуны' },
  { id: 'navigate_git', type: 'navigation', description: 'открыть Git: ветки, коммиты, диффы' },
  { id: 'navigate_files', type: 'navigation', description: 'открыть файловый проводник проекта' },
  { id: 'navigate_prs', type: 'navigation', description: 'открыть Pull Requests' },
  { id: 'navigate_docs', type: 'navigation', description: 'открыть документацию и ADR-решения' },
  { id: 'navigate_analytics', type: 'navigation', description: 'открыть аналитику проекта' },
  { id: 'toggle_terminal', type: 'navigation', description: 'показать или скрыть панель терминала' },
  { id: 'toggle_sidebar', type: 'navigation', description: 'переключить меню проектов' },
  { id: 'hide_sidebar', type: 'navigation', description: 'скрыть меню проектов' },
  { id: 'show_sidebar', type: 'navigation', description: 'показать меню проектов' },

  // ── Проекты ──
  {
    id: 'navigate_project',
    type: 'navigation',
    description: 'переключиться на проект по названию',
    payload: [TEXT('projectName', 'название проекта, как его произнёс пользователь')]
  },
  { id: 'switch_project_next', type: 'navigation', description: 'следующий проект' },
  { id: 'switch_project_prev', type: 'navigation', description: 'предыдущий проект' },
  { id: 'switch_project_last', type: 'navigation', description: 'вернуться к предыдущему активному проекту' },
  {
    id: 'switch_project_index',
    type: 'navigation',
    description: 'проект по номеру вкладки',
    payload: [INDEX('tabIndex', 'номер проекта начиная с 1; -1 — последний')]
  },
  { id: 'close_current_project', type: 'navigation', description: 'закрыть текущий проект или вкладку' },

  // ── Сессии AI Studio ──
  { id: 'new_ai_session', type: 'ai_control', description: 'создать новый чат с агентом' },
  { id: 'close_ai_session', type: 'ai_control', description: 'закрыть текущий чат' },
  { id: 'switch_session_next', type: 'ai_control', description: 'следующий чат' },
  { id: 'switch_session_prev', type: 'ai_control', description: 'предыдущий чат' },
  { id: 'switch_session_last', type: 'ai_control', description: 'вернуться к предыдущему чату' },
  {
    id: 'switch_session_index',
    type: 'ai_control',
    description: 'чат по номеру',
    payload: [INDEX('sessionIndex', 'номер чата начиная с 1; -1 — последний')]
  },
  {
    id: 'navigate_ai_session',
    type: 'ai_control',
    description: 'открыть чат по названию',
    payload: [TEXT('sessionTitle', 'название чата')]
  },
  {
    id: 'send_prompt',
    type: 'ai_control',
    description:
      'передать агенту произвольный запрос или задачу по коду — всё, что является поручением, а не управлением интерфейсом',
    payload: [TEXT('text', 'текст запроса агенту, очищенный от обращения и служебных слов')]
  },
  { id: 'agent_approve', type: 'ai_control', description: 'одобрить действие, которое агент вынес на подтверждение' },
  { id: 'agent_reject', type: 'ai_control', description: 'отклонить действие агента' },
  {
    id: 'agent_select_option',
    type: 'ai_control',
    description: 'выбрать вариант ответа в вопросе агента',
    payload: [INDEX('optionIndex', 'номер варианта начиная с 1; -1 — последний')]
  },
  { id: 'quick_next_task', type: 'ai_control', description: 'быстрый промпт «следующая задача»' },
  { id: 'quick_commit', type: 'ai_control', description: 'быстрый промпт «сделай коммит»' },
  { id: 'quick_deploy', type: 'ai_control', description: 'быстрый промпт «деплой»' },
  { id: 'show_claude_usage', type: 'ai_control', description: 'показать лимиты и расход токенов' },

  // ── Действия ──
  { id: 'open_code', type: 'action', description: 'открыть проект в редакторе кода' },
  { id: 'open_explorer', type: 'action', description: 'открыть папку проекта в проводнике' },
  { id: 'open_help', type: 'action', description: 'показать справку по горячим клавишам' },
  { id: 'open_search', type: 'action', description: 'открыть глобальный поиск' },
  { id: 'refresh_project', type: 'action', description: 'обновить состояние проекта и Git' },
  { id: 'run_dev', type: 'action', description: 'запустить локальный сервер разработки' },
  { id: 'stop_dev', type: 'action', description: 'остановить сервер разработки' },
  { id: 'run_deploy', type: 'action', description: 'запустить деплой' },
  { id: 'run_tests', type: 'action', description: 'прогнать тесты' },
  { id: 'read_tasks', type: 'action', description: 'прочитать вслух список активных задач' },
  { id: 'read_doc', type: 'action', description: 'прочитать вслух документ' },
  { id: 'stop_reading', type: 'action', description: 'прекратить озвучку, замолчать' },
  { id: 'toggle_pause', type: 'action', description: 'поставить голосовой ввод на паузу или снять с паузы' },

  // ── Управление компьютером и диктовка (TASK-83) ──
  {
    id: 'computer_task',
    type: 'computer',
    description:
      'действие в другом приложении на компьютере: кликнуть, напечатать в чужое окно, открыть программу, прокрутить, переключить окно',
    payload: [TEXT('task', 'что именно нужно сделать на компьютере, одной фразой')]
  },
  { id: 'dictation_start', type: 'dictation', description: 'включить режим диктовки в активное окно' },
  { id: 'dictation_stop', type: 'dictation', description: 'выключить режим диктовки' },

  { id: 'unknown', type: 'unknown', description: 'фраза не похожа ни на одну из команд выше' }
];

const BY_ID = new Map(VOICE_INTENT_CATALOG.map((spec) => [spec.id, spec]));

export function getVoiceIntentSpec(id: string): VoiceIntentSpec | undefined {
  return BY_ID.get(id);
}

/**
 * Синонимы, которые модели выдают вместо каноничных идентификаторов. Список намеренно короткий:
 * всё остальное честно уходит в `unknown`, чтобы классификатор не выдумывал команду.
 */
const INTENT_ALIASES: Record<string, string> = {
  none: 'unknown',
  no_match: 'unknown',
  unclear: 'unknown',
  other: 'unknown',
  open_tasks: 'navigate_kanban',
  open_backlog: 'navigate_kanban',
  open_git: 'navigate_git',
  open_docs: 'navigate_docs',
  open_terminal: 'toggle_terminal',
  ask_agent: 'send_prompt',
  prompt: 'send_prompt',
  approve: 'agent_approve',
  reject: 'agent_reject',
  computer: 'computer_task',
  computer_use: 'computer_task'
};

function normalizeIntentId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^intent\s*[:=]\s*/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  if (!cleaned) return '';
  if (BY_ID.has(cleaned)) return cleaned;
  return INTENT_ALIASES[cleaned] ?? '';
}

export interface VoiceClassifierPromptInput {
  /** Распознанная фраза пользователя. */
  transcript: string;
  /** Язык интерфейса — подсказка модели, на каком языке ждать фразу. */
  language?: 'ru' | 'en';
  /** Открытые проекты: помогают распознать «переключись на ...». */
  projectNames?: string[];
  /** У агента есть незакрытый запрос на подтверждение — вероятны agent_approve/agent_reject. */
  hasPendingApproval?: boolean;
  /** Управление компьютером выключено — интент computer_task предлагать нельзя. */
  computerUseEnabled?: boolean;
}

export const VOICE_CLASSIFIER_RESPONSE_SCHEMA = `{"intent": "идентификатор_из_списка", "payload": {}, "confidence": 0.0}`;

/** Промпт классификатора. Русский — как и у остальных служебных промптов проекта. */
export function buildVoiceClassifierPrompt(input: VoiceClassifierPromptInput): string {
  const sections: string[] = [];

  sections.push(
    'Ты — классификатор голосовых команд десктопного приложения ProjectHub. Пользователь сказал фразу; ' +
      'определи, какой командой она является. Отвечай строго одним JSON-объектом, без пояснений до и после, ' +
      'без markdown-ограды.'
  );

  const catalog = VOICE_INTENT_CATALOG.filter(
    (spec) => spec.id !== 'computer_task' || input.computerUseEnabled !== false
  );

  const lines = catalog.map((spec) => {
    const payload = spec.payload?.length
      ? ` | payload: ${spec.payload.map((field) => `"${field.name}" — ${field.hint}`).join('; ')}`
      : '';
    return `${spec.id} — ${spec.description}${payload}`;
  });
  sections.push(`## Интенты\n${lines.join('\n')}`);

  const context: string[] = [];
  if (input.projectNames?.length) {
    context.push(`Открытые проекты: ${input.projectNames.slice(0, 20).join(', ')}.`);
  }
  if (input.hasPendingApproval) {
    context.push('Агент прямо сейчас ждёт подтверждения действия — согласие или отказ относятся к нему.');
  }
  if (input.computerUseEnabled === false) {
    context.push('Управление компьютером выключено: команды про чужие окна и клики классифицируй как unknown.');
  }
  if (context.length > 0) {
    sections.push(`## Контекст\n${context.join('\n')}`);
  }

  sections.push(`## Фраза пользователя${input.language === 'en' ? ' (язык интерфейса: английский)' : ''}\n${input.transcript}`);

  sections.push(
    '## Формат ответа\n' +
      VOICE_CLASSIFIER_RESPONSE_SCHEMA +
      '\n\n`intent` — ровно один идентификатор из списка. `payload` — только поля, описанные у выбранного ' +
      'интента; если их нет, верни пустой объект. `confidence` — число от 0 до 1: насколько ты уверен. ' +
      'Если фраза не похожа ни на одну команду или это просто реплика — верни intent "unknown" и не выдумывай ' +
      'команду. Не выполняй саму команду, только классифицируй.'
  );

  return sections.join('\n\n');
}

export interface VoiceClassification {
  intent: string;
  type: VoiceIntentType;
  payload?: Record<string, unknown>;
  /** 0..1. */
  confidence: number;
  /** Как удалось разобрать ответ модели. */
  source: 'json' | 'bare' | 'none';
  /** Почему структуру достать не удалось. */
  error?: string;
}

/** Ниже этого порога команду не выполняем, а переспрашиваем голосом (AC #2). */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Уверенность по умолчанию, когда модель поле не прислала. */
const DEFAULT_CONFIDENCE = 0.5;

const UNKNOWN: VoiceClassification = { intent: 'unknown', type: 'unknown', confidence: 0, source: 'none' };

function toConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CONFIDENCE;
  // Модели отвечают и по стобалльной, и по десятибалльной шкале — приводим к 0..1.
  const scaled = value > 1 ? value / (value > 10 ? 100 : 10) : value;
  return Math.min(1, Math.max(0, scaled));
}

function toIndex(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return undefined;
  if (num === -1) return -1;
  // Модель нумерует с единицы, рендерер ждёт индекс с нуля.
  if (num >= 1) return num - 1;
  return undefined;
}

function toText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Собирает payload строго по спецификации интента: лишние поля модели отбрасываются, недостающие
 * обязательные превращают результат в `unknown` — исполнять «отправь агенту» без текста нечего.
 */
function buildPayload(spec: VoiceIntentSpec, raw: unknown): { payload?: Record<string, unknown>; incomplete: boolean } {
  if (!spec.payload || spec.payload.length === 0) return { incomplete: false };
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const payload: Record<string, unknown> = {};
  let incomplete = false;

  for (const field of spec.payload) {
    const value = field.kind === 'index' ? toIndex(source[field.name]) : toText(source[field.name]);
    if (value === undefined) {
      if (field.required) incomplete = true;
      continue;
    }
    payload[field.name] = value;
  }

  return { payload: Object.keys(payload).length > 0 ? payload : undefined, incomplete };
}

function classify(intentId: string, rawPayload: unknown, confidence: number, source: 'json' | 'bare'): VoiceClassification {
  const spec = BY_ID.get(intentId);
  if (!spec || spec.id === 'unknown') return { ...UNKNOWN, source };

  const { payload, incomplete } = buildPayload(spec, rawPayload);
  if (incomplete) {
    return { ...UNKNOWN, source, error: `Интент ${spec.id} пришёл без обязательного payload` };
  }

  return {
    intent: spec.id,
    type: spec.type,
    ...(payload ? { payload } : {}),
    confidence,
    source
  };
}

/**
 * Разбор ответа модели.
 *
 * Сначала ищется JSON-объект, затем — «голый» идентификатор интента: слабые локальные модели
 * часто игнорируют требование JSON, но со списком идентификаторов справляются.
 */
export function parseVoiceClassifierResponse(raw: string): VoiceClassification {
  const text = (raw ?? '').trim();
  if (!text) return { ...UNKNOWN, error: 'Пустой ответ модели' };

  const json = extractJsonObject(text);
  if (json) {
    try {
      const parsed: unknown = JSON.parse(json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const intentId = normalizeIntentId(obj.intent ?? obj.command ?? obj.action);
        if (intentId) {
          return classify(intentId, obj.payload ?? obj.arguments ?? obj.args, toConfidence(obj.confidence), 'json');
        }
        return { ...UNKNOWN, source: 'json', error: 'Модель вернула неизвестный интент' };
      }
    } catch (err) {
      // Падать нельзя: ниже ещё есть шанс разобрать ответ как «голый» идентификатор.
      const reason = err instanceof Error ? err.message : String(err);
      const bare = normalizeIntentId(text);
      if (bare) return classify(bare, undefined, DEFAULT_CONFIDENCE, 'bare');
      return { ...UNKNOWN, error: `JSON не разобрался: ${reason}` };
    }
  }

  const bare = normalizeIntentId(text);
  if (bare) return classify(bare, undefined, DEFAULT_CONFIDENCE, 'bare');

  return { ...UNKNOWN, error: 'В ответе нет ни JSON-объекта, ни идентификатора интента' };
}

/** Команду можно выполнять без переспроса. */
export function isConfident(result: VoiceClassification, threshold: number = LOW_CONFIDENCE_THRESHOLD): boolean {
  return result.intent !== 'unknown' && result.confidence >= threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// Кэш частых фраз
// ─────────────────────────────────────────────────────────────────────────────

/** Ключ кэша: фраза без регистра, пунктуации и лишних пробелов. */
export function normalizeCacheKey(phrase: string, language: string = 'ru'): string {
  const normalized = (phrase ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${language}:${normalized}`;
}

export interface VoiceClassifierCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
}

/**
 * LRU-кэш разобранных фраз: одни и те же команды повторяются постоянно, и платить за них запросом
 * к модели незачем. Неуверенные и нераспознанные ответы не кэшируются — иначе разовая ошибка
 * модели закрепилась бы навсегда.
 */
export class VoiceClassifierCache {
  private readonly entries = new Map<string, { result: VoiceClassification; at: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(options: VoiceClassifierCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 64);
    this.ttlMs = Math.max(0, options.ttlMs ?? 24 * 60 * 60 * 1000);
  }

  public get size(): number {
    return this.entries.size;
  }

  public get(phrase: string, language: string, now: number): VoiceClassification | null {
    const key = normalizeCacheKey(phrase, language);
    const hit = this.entries.get(key);
    if (!hit) return null;

    if (this.ttlMs > 0 && now - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }

    // Обновляем позицию в порядке вытеснения.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.result;
  }

  public set(phrase: string, language: string, result: VoiceClassification, now: number): boolean {
    if (!isConfident(result)) return false;
    const key = normalizeCacheKey(phrase, language);
    if (key.endsWith(':')) return false;

    this.entries.delete(key);
    this.entries.set(key, { result, at: now });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return true;
  }

  public clear(): void {
    this.entries.clear();
  }
}

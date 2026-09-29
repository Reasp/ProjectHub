/**
 * Реестр голосов второго движка озвучки — Qwen3-TTS (TASK-104, decision-64).
 *
 * Голос знает свой движок: идентификаторы Qwen начинаются с `qwen:` — двоеточие запрещено в
 * идентификаторах Piper (`isValidVoiceId`), поэтому пересечься с импортированным голосом или
 * стать именем каталога такой id не может.
 *
 * Два вида голосов:
 *   - `qwen:custom:<speaker>` — пресет модели CustomVoice, подача задаётся инструкцией;
 *   - `qwen:design:<slug>` — голос, созданный по описанию. Файла модели у него нет: это рецепт
 *     (описание + seed) и эталонная запись, которую по рецепту один раз создала модель VoiceDesign.
 *     Реплики озвучивает модель Base голосом эталона.
 *
 * Почему не один рецепт, как предполагал decision-50 п. 4: VoiceDesign на каждый вызов создаёт
 * новый голос под описание. Побитово звук повторяется только для того же текста, а на разных
 * фразах основной тон гулял на 27–160 Гц, вплоть до смены пола (замеры decision-64). Клон эталона
 * держит тон в пределах 5–43 Гц.
 *
 * Чистый модуль: без Electron и файловой системы — покрыт unit-тестами.
 */
import manifestJson from '../workers/qwen/manifest.json';
import type { QwenManifest } from '../workers/qwen/setupCore.mjs';

export type TtsEngineId = 'piper' | 'qwen';
/** Вид голоса — то, что выбирает пользователь. */
export type QwenVoiceKind = 'custom' | 'design';
/** Вид модели — то, что загружено в сайдкар. */
export type QwenModelKind = 'custom' | 'design' | 'base';

export const QWEN_MODEL_KINDS: readonly QwenModelKind[] = ['custom', 'design', 'base'];

export const QWEN_MANIFEST = manifestJson as QwenManifest;

export const QWEN_VOICE_PREFIX = 'qwen:';

/** Движок голоса по его идентификатору — по нему сервис озвучки выбирает, куда отправить текст. */
export function resolveVoiceEngine(voiceId: string): TtsEngineId {
  return typeof voiceId === 'string' && voiceId.startsWith(QWEN_VOICE_PREFIX) ? 'qwen' : 'piper';
}

export interface QwenSpeaker {
  id: string;
  label: string;
  /** Родной язык диктора: русского среди пресетов нет, по-русски они говорят с акцентом. */
  native: string;
  gender: string;
}

export const QWEN_SPEAKERS: readonly QwenSpeaker[] = QWEN_MANIFEST.speakers;

export const DEFAULT_QWEN_VOICE_ID = `${QWEN_VOICE_PREFIX}custom:serena`;

/** Идентификатор черновика голоса: проба рецепта до сохранения. */
export const QWEN_DRAFT_VOICE_ID = `${QWEN_VOICE_PREFIX}design:@draft`;

export const QWEN_LANGUAGE_NAMES: Record<'ru' | 'en', string> = { ru: 'Russian', en: 'English' };

export const MAX_INSTRUCT_CHARS = 400;
export const MAX_LABEL_CHARS = 60;
export const MAX_SEED = 2_147_483_647;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function makeQwenPresetVoiceId(speaker: string): string {
  return `${QWEN_VOICE_PREFIX}custom:${speaker}`;
}

export function makeQwenDesignVoiceId(slug: string): string {
  return `${QWEN_VOICE_PREFIX}design:${slug}`;
}

export function isValidDesignSlug(slug: string): boolean {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

export type ParsedQwenVoiceId =
  | { kind: 'custom'; speaker: string }
  | { kind: 'design'; slug: string }
  | { kind: 'design'; draft: true };

export function parseQwenVoiceId(voiceId: string): ParsedQwenVoiceId | null {
  if (resolveVoiceEngine(voiceId) !== 'qwen') return null;
  if (voiceId === QWEN_DRAFT_VOICE_ID) return { kind: 'design', draft: true };
  const [, kind, name, ...rest] = voiceId.split(':');
  if (rest.length > 0 || !name) return null;
  if (kind === 'custom') return QWEN_SPEAKERS.some((s) => s.id === name) ? { kind: 'custom', speaker: name } : null;
  if (kind === 'design') return isValidDesignSlug(name) ? { kind: 'design', slug: name } : null;
  return null;
}

/**
 * Какая модель озвучивает голос: пресет — CustomVoice, сохранённый голос по описанию — Base
 * (клон эталонной записи), черновик — VoiceDesign (она и создаёт эталон).
 */
export function modelForVoice(parsed: ParsedQwenVoiceId): QwenModelKind {
  if (parsed.kind === 'custom') return 'custom';
  return 'draft' in parsed ? 'design' : 'base';
}

/**
 * Текст эталонной записи — он же текст пробы: пользователь слышит ровно то, что сохранится.
 * Длина подобрана под 7–10 с звука: на коротком эталоне эмбеддинг диктора выходит неустойчивым.
 */
export const QWEN_REFERENCE_TEXT: Record<'ru' | 'en', string> = {
  ru: 'Это проба голоса для озвучки ответов в приложении: так он звучит на обычной фразе средней длины.',
  en: 'This is a voice probe for reading replies aloud in the app: this is how it sounds on an ordinary sentence of medium length.'
};

/** Инструкция подачи или описание голоса: одна строка, без управляющих символов, с ограничением длины. */
export function normalizeInstruct(text: unknown, maxChars: number = MAX_INSTRUCT_CHARS): string {
  if (typeof text !== 'string') return '';
  return Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? ' ' : ch;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
    .trim();
}

export interface QwenDesignRecipe {
  slug: string;
  label: string;
  /** Описание голоса на естественном языке: тембр, возраст, манера. */
  instruct: string;
  /** Зерно генератора: по описанию, зерну и тексту эталон воспроизводится побитово. */
  seed: number;
  /** Текст эталонной записи. */
  refText: string;
  createdAt: string;
}

/** Ключ прослушанного черновика: сохраняется только тот эталон, который прозвучал. */
export function draftKey(instruct: string, seed: number): string {
  return `${seed}|${normalizeInstruct(instruct)}`;
}

export type RecipeValidation =
  | { ok: true; label: string; instruct: string; seed: number }
  | { ok: false; field: 'label' | 'instruct' | 'seed' };

export function isValidSeed(seed: unknown): seed is number {
  return typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED;
}

export function validateDesignRecipe(input: { label?: unknown; instruct?: unknown; seed?: unknown }): RecipeValidation {
  const label = normalizeInstruct(input.label, MAX_LABEL_CHARS);
  if (!label) return { ok: false, field: 'label' };
  const instruct = normalizeInstruct(input.instruct);
  // Слишком короткое описание модель игнорирует, и голос получается случайным
  if (instruct.length < 10) return { ok: false, field: 'instruct' };
  if (!isValidSeed(input.seed)) return { ok: false, field: 'seed' };
  return { ok: true, label, instruct, seed: input.seed };
}

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

/**
 * Имя файла рецепта из названия голоса: «Тёплый диктор» → `teplyy-diktor`. Занятое имя получает
 * числовой суффикс, пустое — `voice`.
 */
export function makeDesignSlug(label: string, taken: Iterable<string> = []): string {
  const base =
    String(label)
      .toLowerCase()
      .split('')
      .map((ch) => CYRILLIC[ch] ?? ch)
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'voice';
  const used = new Set([...taken].map((s) => s.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface QwenInstallFacts {
  venvPythonExists: boolean;
  /** Запись `install.json`, которую оставляет скрипт установки; `null` — установки не было. */
  record: { runtimeKey?: string | null; python?: string | null; torch?: string | null; gpu?: string | null } | null;
  /** Все ли файлы модели лежат на диске нужного размера. */
  models: Record<QwenModelKind, boolean>;
}

export interface QwenInstallStatus {
  /** Окружение Python установлено и есть модель, которой можно озвучивать реплики. */
  installed: boolean;
  runtimeReady: boolean;
  models: Record<QwenModelKind, boolean>;
  python: string | null;
  torch: string | null;
  gpu: string | null;
}

export function evaluateQwenInstall(facts: QwenInstallFacts): QwenInstallStatus {
  const runtimeReady = facts.venvPythonExists && Boolean(facts.record?.runtimeKey);
  return {
    // Говорить можно пресетом или сохранённым голосом; одной VoiceDesign для реплик недостаточно
    installed: runtimeReady && (facts.models.custom || facts.models.base),
    runtimeReady,
    models: { ...facts.models },
    python: facts.record?.python ?? null,
    torch: facts.record?.torch ?? null,
    gpu: facts.record?.gpu ?? null
  };
}

/** Сколько байт весов придётся скачать для выбранных моделей. */
export function qwenModelBytes(kind: QwenModelKind): number {
  return QWEN_MANIFEST.models[kind].files.reduce((sum, file) => sum + file.size, 0);
}

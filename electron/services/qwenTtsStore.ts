/**
 * Хранилище второго движка озвучки Qwen3-TTS: состояние установки и «сконструированные» голоса
 * (TASK-104, decision-64).
 *
 * Окружение Python лежит в `<userData>/qwen-tts`, веса — в общем кэше моделей
 * `<userData>/models/qwen-tts` (decision-7). Ставит их скрипт `electron/workers/qwen/setup.mjs`;
 * здесь только чтение того, что он оставил, и голоса, созданные по описанию: рецепт
 * `<имя>.json` и эталонная запись `<имя>.wav`, которой модель Base озвучивает реплики.
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getUserDataDir, getWorkerScriptCandidates } from './appPaths';
import { resolveLayout, resolveModelFile, type QwenLayout } from '../workers/qwen/setupCore.mjs';
import {
  evaluateQwenInstall,
  isValidDesignSlug,
  makeDesignSlug,
  makeQwenDesignVoiceId,
  makeQwenPresetVoiceId,
  normalizeInstruct,
  parseQwenVoiceId,
  QWEN_MANIFEST,
  QWEN_SPEAKERS,
  validateDesignRecipe,
  type QwenDesignRecipe,
  type QwenInstallStatus,
  type QwenModelKind,
  type QwenVoiceKind
} from './qwenTtsRegistry';
import { encodeWav16 } from './qwenSidecarProtocol';
import type { QwenTtsErrorCode } from './ttsErrorCodes';

export class QwenTtsStoreError extends Error {
  readonly code: QwenTtsErrorCode;
  readonly detail?: string;
  constructor(code: QwenTtsErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'QwenTtsStoreError';
    this.code = code;
    this.detail = detail;
  }
}

export interface QwenVoiceListItem {
  id: string;
  label: string;
  engine: 'qwen';
  kind: QwenVoiceKind;
  /** Модель, озвучивающая голос, скачана, окружение установлено. */
  installed: boolean;
  /** Родной язык диктора-пресета. */
  native?: string;
  gender?: string;
  /** Рецепт «сконструированного» голоса. */
  instruct?: string;
  seed?: number;
  createdAt?: string;
}

export function getQwenLayout(): QwenLayout & { voicesDir: string } {
  const layout = resolveLayout(getUserDataDir());
  return { ...layout, voicesDir: path.join(layout.modelsDir, 'voices') };
}

export function getQwenModelDir(kind: QwenModelKind): string {
  return path.join(getQwenLayout().modelsDir, QWEN_MANIFEST.models[kind].dir);
}

async function isModelOnDisk(kind: QwenModelKind): Promise<boolean> {
  const dir = getQwenModelDir(kind);
  for (const file of QWEN_MANIFEST.models[kind].files) {
    const stat = await fs.stat(resolveModelFile(dir, file.path)).catch(() => null);
    // Хэш сверяет установка; здесь достаточно размера — недокачанный файл лежит под именем `.part`
    if (!stat || stat.size !== file.size) return false;
  }
  return true;
}

export async function getQwenInstallStatus(): Promise<QwenInstallStatus> {
  const layout = getQwenLayout();
  let record: Parameters<typeof evaluateQwenInstall>[0]['record'] = null;
  try {
    record = JSON.parse(await fs.readFile(layout.installManifest, 'utf8'));
  } catch {
    // установки не было или запись повреждена — считаем, что не установлено
  }
  const [custom, design, base] = await Promise.all([
    isModelOnDisk('custom'),
    isModelOnDisk('design'),
    isModelOnDisk('base')
  ]);
  return evaluateQwenInstall({
    venvPythonExists: existsSync(layout.venvPython),
    record,
    models: { custom, design, base }
  });
}

/**
 * Кладёт актуальный `sidecar.py` рядом с окружением и возвращает путь к нему.
 *
 * В упакованном приложении скрипт лежит внутри `app.asar`, а внешний процесс Python читать архив
 * не умеет. Копия обновляется при каждом запуске, поэтому обновление приложения подхватывается само.
 */
export async function materializeSidecarScript(): Promise<string | null> {
  const source = getWorkerScriptCandidates(path.join('qwen', 'sidecar.py')).find((p) => existsSync(p));
  if (!source) return null;
  const layout = getQwenLayout();
  const content = await fs.readFile(source);
  const current = await fs.readFile(layout.sidecarCopy).catch(() => null);
  if (!current || !current.equals(content)) {
    await fs.mkdir(layout.home, { recursive: true });
    await fs.writeFile(layout.sidecarCopy, content);
  }
  return layout.sidecarCopy;
}

function recipePath(slug: string): string {
  return path.join(getQwenLayout().voicesDir, `${slug}.json`);
}

/** Эталонная запись голоса: лежит рядом с рецептом под тем же именем. */
export function referenceAudioPath(slug: string): string {
  return path.join(getQwenLayout().voicesDir, `${slug}.wav`);
}

/** Звук прослушанной пробы — он и становится эталоном голоса. */
export interface QwenReferenceAudio {
  samples: Float32Array;
  sampleRate: number;
  /** Текст, который произнесён в записи. */
  text: string;
}

/** Эталон короче этого не годится: эмбеддинг диктора по обрывку выходит неустойчивым. */
const MIN_REFERENCE_SEC = 2;

async function readRecipe(file: string): Promise<QwenDesignRecipe | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<QwenDesignRecipe>;
    const slug = path.basename(file, '.json');
    if (!isValidDesignSlug(slug)) return null;
    const checked = validateDesignRecipe(parsed);
    if (!checked.ok) return null;
    // Рецепт без эталонной записи озвучить нечем — такого голоса нет
    if (!existsSync(referenceAudioPath(slug))) return null;
    return {
      slug,
      label: checked.label,
      instruct: checked.instruct,
      seed: checked.seed,
      refText: normalizeInstruct(parsed.refText),
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : ''
    };
  } catch {
    return null;
  }
}

export async function listDesignRecipes(): Promise<QwenDesignRecipe[]> {
  const dir = getQwenLayout().voicesDir;
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const recipes: QwenDesignRecipe[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const recipe = await readRecipe(path.join(dir, name));
    if (recipe) recipes.push(recipe);
  }
  // В порядке создания: новый голос появляется в конце списка, а не посреди него
  return recipes.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.slug.localeCompare(b.slug));
}

export async function getDesignRecipe(slug: string): Promise<QwenDesignRecipe | null> {
  if (!isValidDesignSlug(slug)) return null;
  return readRecipe(recipePath(slug));
}

export async function saveDesignRecipe(
  input: { label?: unknown; instruct?: unknown; seed?: unknown },
  reference: QwenReferenceAudio | null
): Promise<QwenDesignRecipe> {
  const checked = validateDesignRecipe(input);
  if (!checked.ok) throw new QwenTtsStoreError('qwen_invalid_recipe', checked.field);
  // Сохраняется только прослушанный голос: без пробы эталона нет
  if (!reference || reference.samples.length < reference.sampleRate * MIN_REFERENCE_SEC) {
    throw new QwenTtsStoreError('qwen_probe_required');
  }

  const dir = getQwenLayout().voicesDir;
  await fs.mkdir(dir, { recursive: true });
  const taken = (await fs.readdir(dir).catch(() => [] as string[])).map((name) => name.replace(/\.(json|wav)$/i, ''));
  const recipe: QwenDesignRecipe = {
    slug: makeDesignSlug(checked.label, taken),
    label: checked.label,
    instruct: checked.instruct,
    seed: checked.seed,
    refText: normalizeInstruct(reference.text),
    createdAt: new Date().toISOString()
  };
  // Флаг wx: два сохранения с одним названием в один момент не затрут друг друга. Запись звука
  // идёт первой — рецепт без эталона голосом не считается, и обрыв посередине не оставит «голос»,
  // который нечем озвучить
  const audioPath = referenceAudioPath(recipe.slug);
  await fs.writeFile(audioPath, encodeWav16(reference.samples, reference.sampleRate), { flag: 'wx' });
  try {
    await fs.writeFile(recipePath(recipe.slug), JSON.stringify(recipe, null, 2), { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    await fs.rm(audioPath, { force: true }).catch(() => {});
    throw err;
  }
  return recipe;
}

export async function deleteDesignRecipe(voiceId: string): Promise<boolean> {
  const parsed = parseQwenVoiceId(voiceId);
  if (!parsed || parsed.kind !== 'design' || !('slug' in parsed)) {
    throw new QwenTtsStoreError('qwen_voice_not_found', voiceId);
  }
  const file = recipePath(parsed.slug);
  const audio = referenceAudioPath(parsed.slug);
  if (!existsSync(file) && !existsSync(audio)) return false;
  await fs.rm(file, { force: true });
  await fs.rm(audio, { force: true });
  return true;
}

export function recipeToListItem(recipe: QwenDesignRecipe, installed: boolean): QwenVoiceListItem {
  return {
    id: makeQwenDesignVoiceId(recipe.slug),
    label: recipe.label,
    engine: 'qwen',
    kind: 'design',
    installed,
    instruct: recipe.instruct,
    seed: recipe.seed,
    createdAt: recipe.createdAt
  };
}

/** Пресеты CustomVoice и сохранённые рецепты VoiceDesign с признаком «готов к работе». */
export async function listQwenVoices(): Promise<QwenVoiceListItem[]> {
  const status = await getQwenInstallStatus();
  const presets: QwenVoiceListItem[] = QWEN_SPEAKERS.map((speaker) => ({
    id: makeQwenPresetVoiceId(speaker.id),
    label: speaker.label,
    engine: 'qwen',
    kind: 'custom',
    installed: status.runtimeReady && status.models.custom,
    native: speaker.native,
    gender: speaker.gender
  }));
  // Сохранённый голос озвучивает модель Base; VoiceDesign нужна только для создания новых
  const designed = (await listDesignRecipes()).map((recipe) =>
    recipeToListItem(recipe, status.runtimeReady && status.models.base)
  );
  return [...presets, ...designed];
}

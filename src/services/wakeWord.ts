/**
 * Ключевое слово активации (wake word) по транскрипту Whisper (TASK-83).
 *
 * Внешние движки wake word (Porcupine, openWakeWord) сюда не подключаются: openWakeWord тянет
 * Python и модель, Porcupine — проприетарный ключ и онлайн-активацию, и оба дублировали бы уже
 * работающий конвейер VAD + Whisper. Вместо этого первая фраза распознанного чанка сверяется с
 * настраиваемым списком ключевых слов — распознавание уже произошло, стоимость проверки нулевая.
 * Подробности выбора — в [[decision-30]].
 *
 * Сопоставление идёт по словам, а не по подстроке: «хабар» не должен считаться обращением «хаб».
 * Регистр и пунктуация игнорируются, «ё» приравнивается к «е» (Whisper пишет то так, то так),
 * а текст команды возвращается из исходной строки — чтобы не потерять регистр имён собственных
 * («открой проект WorldSim»).
 *
 * Чистый модуль без React и Electron — покрыт unit-тестами.
 */

export interface WakeWordMatch {
  /** Транскрипт начинается с ключевого слова. */
  matched: boolean;
  /** Команда без ключевого слова; пустая строка — произнесли только само ключевое слово. */
  command: string;
  /** Какая из настроенных фраз совпала (в исходном виде). */
  phrase?: string;
}

/** Список по умолчанию; пользователь меняет его в настройках, как и остальные фразы команд. */
export const DEFAULT_WAKE_WORD_PHRASES = ['хаб', 'привет хаб', 'эй хаб', 'окей хаб', 'hub', 'hey hub', 'ok hub'];

/**
 * Типичные ошибки Whisper на коротком «хаб». На живой проверке 2026-09-17 (whisper-base, два
 * голоса Piper) «хаб» примерно в половине фраз распознавался как «хап» или «кап» — и ключевое слово
 * не срабатывало. Поэтому варианты принимаются без настройки. `anywhere` — вариант безопасен и в
 * одиночной фразе; `afterGreeting` — только в составе обращения («привет кап»): одиночное «кап»
 * слишком похоже на обычную речь.
 */
const WAKE_WORD_CONFUSIONS: Record<string, { anywhere: string[]; afterGreeting: string[] }> = {
  хаб: { anywhere: ['хап', 'хабп'], afterGreeting: ['кап'] }
};

/** Варианты слова фразы: само слово и его известные искажения. */
function wordVariants(word: string, inGreeting: boolean): string[] {
  const confusion = WAKE_WORD_CONFUSIONS[word];
  if (!confusion) return [word];
  return [word, ...confusion.anywhere, ...(inGreeting ? confusion.afterGreeting : [])];
}

interface Token {
  text: string;
  end: number;
}

/** Слова и их границы в исходной строке: по границам восстанавливается остаток команды. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push({ text: match[0], end: match.index + match[0].length });
  }
  return tokens;
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/ё/g, 'е');
}

/**
 * Проверяет, начинается ли транскрипт с ключевого слова.
 *
 * Более длинные фразы проверяются первыми: «привет хаб открой гит» должно совпасть с «привет хаб»,
 * а не оставить «хаб» в тексте команды.
 */
export function matchWakeWord(transcript: string, phrases: string[] = DEFAULT_WAKE_WORD_PHRASES): WakeWordMatch {
  const source = transcript ?? '';
  const fallback: WakeWordMatch = { matched: false, command: source.trim() };

  const prepared = (phrases ?? [])
    .filter((phrase): phrase is string => typeof phrase === 'string')
    .map((phrase) => ({ raw: phrase, words: tokenize(phrase).map((token) => normalizeWord(token.text)) }))
    .filter((phrase) => phrase.words.length > 0)
    .sort((a, b) => b.words.length - a.words.length);

  if (prepared.length === 0) return fallback;

  const tokens = tokenize(source);
  if (tokens.length === 0) return fallback;
  const normalized = tokens.map((token) => normalizeWord(token.text));

  for (const phrase of prepared) {
    if (normalized.length < phrase.words.length) continue;
    const inGreeting = phrase.words.length > 1;
    const hit = phrase.words.every((word, index) => wordVariants(word, inGreeting).includes(normalized[index]));
    if (!hit) continue;

    const cut = tokens[phrase.words.length - 1].end;
    const command = source.slice(cut).replace(/^[\s,.!?;:—–-]+/u, '').trim();
    return { matched: true, command, phrase: phrase.raw };
  }

  return fallback;
}

/**
 * Нужно ли выполнять фразу в hands-free режиме.
 *
 * Пока ключевое слово выключено, выполняется всё подряд — это сегодняшнее поведение. Когда оно
 * включено, команда принимается либо сразу после ключевого слова, либо в течение короткого окна
 * после него: «Хаб» → пауза → «открой задачи» должно работать так же, как одна фраза.
 */
export interface WakeWindowState {
  /** Время, до которого ключевое слово считается ещё действующим. */
  openUntil: number;
}

export function createWakeWindow(): WakeWindowState {
  return { openUntil: 0 };
}

export interface WakeGateResult {
  /** Фразу следует выполнить как команду. */
  accepted: boolean;
  /** Текст команды без ключевого слова. */
  command: string;
  /** Ключевое слово услышано, команда не названа — ждём её следующей фразой. */
  awaitingCommand: boolean;
  phrase?: string;
}

/** Сколько ключевое слово остаётся «открытым» после произнесения без команды. */
export const WAKE_WINDOW_MS = 8000;

export function applyWakeGate(
  transcript: string,
  options: { enabled: boolean; phrases?: string[]; now: number; windowMs?: number },
  state: WakeWindowState
): WakeGateResult {
  const text = (transcript ?? '').trim();
  if (!options.enabled) {
    return { accepted: text.length > 0, command: text, awaitingCommand: false };
  }

  const windowMs = options.windowMs ?? WAKE_WINDOW_MS;
  const hit = matchWakeWord(text, options.phrases);

  if (hit.matched) {
    if (hit.command) {
      state.openUntil = 0;
      return { accepted: true, command: hit.command, awaitingCommand: false, phrase: hit.phrase };
    }
    state.openUntil = options.now + windowMs;
    return { accepted: false, command: '', awaitingCommand: true, phrase: hit.phrase };
  }

  if (state.openUntil > options.now && text.length > 0) {
    state.openUntil = 0;
    return { accepted: true, command: text, awaitingCommand: false };
  }

  return { accepted: false, command: text, awaitingCommand: false };
}

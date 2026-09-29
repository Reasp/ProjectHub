/**
 * Карточка результата push-to-talk (TASK-115, [[decision-65]]).
 *
 * После отпускания клавиши системный оверлей не прячется, а превращается в закреплённую карточку:
 * распознанный текст целиком и итог команды. Карточка висит без таймера, пока её не закроют
 * крестиком, кликом мимо, Esc или новым нажатием push-to-talk.
 *
 * Модуль чистый — без Electron и React: его используют и рендерер (закрепление, переходы), и main
 * (видимость окна, попадание глобального клика в границы карточки).
 */

export type ResultCardStatus = 'classifying' | 'done';

export interface VoiceResultCard {
  /** Поколение карточки: закрытие старой не должно снимать новую, пришедшую следом. */
  id: number;
  transcript: string;
  /** Итог команды: «Напечатано…», «Открываю доску задач», «Не понял команду». */
  feedback: string | null;
  status: ResultCardStatus;
}

export interface PinDecisionInput {
  text: string;
  isFinal: boolean;
  /** Фраза записана удержанием клавиши, а не hands-free. */
  fromPushToTalk: boolean;
  /** Запись отменена сочетанием клавиш (правый Ctrl+C): её результат не показываем. */
  cancelled?: boolean;
}

/** Закреплять ли результат: только финальная непустая фраза push-to-talk без отмены. */
export function shouldPinResult(input: PinDecisionInput): boolean {
  if (!input.isFinal || !input.fromPushToTalk || input.cancelled === true) return false;
  return input.text.trim().length > 0;
}

/** Новая карточка заменяет прежнюю целиком: итог прошлой команды к новой фразе не относится. */
export function pinResult(id: number, transcript: string): VoiceResultCard {
  return { id, transcript: transcript.trim(), feedback: null, status: 'classifying' };
}

/** Итог команды дописывается в карточку; пустой итог (сброс по таймеру полосы) карточку не трогает. */
export function applyCardFeedback(card: VoiceResultCard | null, feedback: string | null | undefined): VoiceResultCard | null {
  if (!card) return null;
  const text = typeof feedback === 'string' ? feedback.trim() : '';
  if (!text || text === card.feedback) return card;
  return { ...card, feedback: text };
}

/** Разбор команды закончен. Опоздавшее завершение прежней карточки новую не трогает. */
export function completeCard(card: VoiceResultCard | null, id: number): VoiceResultCard | null {
  if (!card || card.id !== id || card.status === 'done') return card;
  return { ...card, status: 'done' };
}

/**
 * Закрытие карточки. Без `id` закрывается любая (новое нажатие push-to-talk); с `id` — только та,
 * которую закрыли: крестик по старой карточке не должен снять новую, пришедшую за время IPC.
 */
export function dismissCard(card: VoiceResultCard | null, id?: number): VoiceResultCard | null {
  if (!card) return null;
  if (id !== undefined && card.id !== id) return card;
  return null;
}

/** Нормализует карточку, пришедшую по IPC: всё, что не похоже на карточку, считается её отсутствием. */
export function toResultCard(value: unknown): VoiceResultCard | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'number' || !Number.isFinite(raw.id)) return null;
  const transcript = typeof raw.transcript === 'string' ? raw.transcript.trim() : '';
  if (!transcript) return null;
  return {
    id: raw.id,
    transcript,
    feedback: typeof raw.feedback === 'string' && raw.feedback.trim() ? raw.feedback.trim() : null,
    status: raw.status === 'done' ? 'done' : 'classifying'
  };
}

/**
 * Видна ли карточка с точки зрения main: закрытую в main карточку рендерер мог ещё не успеть снять,
 * и синхронизация, пришедшая в эту щель, не должна показать её снова.
 */
export function isCardVisible(card: VoiceResultCard | null, dismissedId: number | null): boolean {
  return card !== null && card.id !== dismissedId;
}

// ───────────────────────────── Геометрия ─────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Физические пиксели хука (uiohook на Windows и Linux) → логические пиксели Electron (DIP).
 * Масштаб — коэффициент дисплея (1.25 при 125 %); негодный масштаб считается единичным.
 */
export function physicalToDip(point: Point, scaleFactor: number): Point {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return { x: point.x / scale, y: point.y / scale };
}

/** Точка внутри прямоугольника; правая и нижняя границы не входят, как у пикселей окна. */
export function isPointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

/** Клик мимо карточки: точка хука в физических пикселях, границы окна — в DIP. */
export function isClickOutsideCard(physicalPoint: Point, dipBounds: Bounds, scaleFactor: number): boolean {
  return !isPointInBounds(physicalToDip(physicalPoint, scaleFactor), dipBounds);
}

export interface CardSizeInput {
  transcriptLength: number;
  feedbackLength: number;
  /** Ширина карточки в DIP. */
  width: number;
  /** Высота рабочей области экрана в DIP: выше доли её карточка не растёт, дальше — прокрутка. */
  maxHeight: number;
}

/** Типографика карточки: должна совпадать со стилями `SystemVoiceOverlay` в режиме `card`. */
export const CARD_LAYOUT = {
  transcriptFont: 24,
  transcriptLineHeight: 1.3,
  feedbackFont: 16,
  feedbackLineHeight: 1.35,
  /** Внутренние поля карточки по горизонтали (слева + справа), с запасом на рамку окна. */
  paddingX: 64,
  /** Шапка, подсказка внизу, поля и промежутки по вертикали. */
  chromeHeight: 116,
  /** Средняя ширина символа в долях кегля: кириллица шире латиницы, берём с запасом. */
  charWidthRatio: 0.56,
  minHeight: 170
} as const;

function lineCount(length: number, font: number, width: number): number {
  if (length <= 0) return 0;
  const perLine = Math.max(1, Math.floor((width - CARD_LAYOUT.paddingX) / (font * CARD_LAYOUT.charWidthRatio)));
  return Math.ceil(length / perLine);
}

/**
 * Высота окна карточки под многострочный текст. Оценка по числу символов, а не замер: окно должно
 * получить размер вместе с первым показом, без мигания маленьким и последующего роста.
 */
export function estimateCardHeight(input: CardSizeInput): number {
  const transcriptLines = Math.max(1, lineCount(input.transcriptLength, CARD_LAYOUT.transcriptFont, input.width));
  // Под итог всегда место хотя бы на строку: «Распознаю команду…» появляется сразу.
  const feedbackLines = Math.max(1, lineCount(input.feedbackLength, CARD_LAYOUT.feedbackFont, input.width));
  const content =
    transcriptLines * CARD_LAYOUT.transcriptFont * CARD_LAYOUT.transcriptLineHeight +
    feedbackLines * CARD_LAYOUT.feedbackFont * CARD_LAYOUT.feedbackLineHeight;
  const height = Math.ceil(CARD_LAYOUT.chromeHeight + content);
  const cap = Math.max(CARD_LAYOUT.minHeight, Math.floor(input.maxHeight));
  return Math.min(cap, Math.max(CARD_LAYOUT.minHeight, height));
}

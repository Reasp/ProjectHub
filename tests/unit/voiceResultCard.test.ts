import { describe, expect, it } from 'vitest';
import {
  CARD_LAYOUT,
  applyCardFeedback,
  completeCard,
  dismissCard,
  estimateCardHeight,
  isCardVisible,
  isClickOutsideCard,
  isPointInBounds,
  physicalToDip,
  pinResult,
  shouldPinResult,
  toResultCard
} from '../../src/utils/voiceResultCard';

describe('shouldPinResult', () => {
  it('закрепляет финальную непустую фразу push-to-talk', () => {
    expect(shouldPinResult({ text: 'открой задачи', isFinal: true, fromPushToTalk: true })).toBe(true);
  });

  it('не закрепляет пустое и пробельное распознавание', () => {
    expect(shouldPinResult({ text: '', isFinal: true, fromPushToTalk: true })).toBe(false);
    expect(shouldPinResult({ text: '   \n', isFinal: true, fromPushToTalk: true })).toBe(false);
  });

  it('не закрепляет запись, отменённую сочетанием клавиш', () => {
    expect(shouldPinResult({ text: 'текст', isFinal: true, fromPushToTalk: true, cancelled: true })).toBe(false);
  });

  it('не закрепляет промежуточный результат и фразы hands-free', () => {
    expect(shouldPinResult({ text: 'текст', isFinal: false, fromPushToTalk: true })).toBe(false);
    expect(shouldPinResult({ text: 'текст', isFinal: true, fromPushToTalk: false })).toBe(false);
  });
});

describe('переходы карточки', () => {
  it('новая карточка ждёт итога и обрезает пробелы', () => {
    expect(pinResult(7, '  привет  ')).toEqual({ id: 7, transcript: 'привет', feedback: null, status: 'classifying' });
  });

  it('итог команды дописывается, пустой итог карточку не трогает', () => {
    const card = pinResult(1, 'открой доску');
    const withFeedback = applyCardFeedback(card, 'Открываю доску задач');
    expect(withFeedback?.feedback).toBe('Открываю доску задач');
    expect(applyCardFeedback(withFeedback, null)).toBe(withFeedback);
    expect(applyCardFeedback(withFeedback, '  ')).toBe(withFeedback);
    expect(applyCardFeedback(withFeedback, 'Открываю доску задач')).toBe(withFeedback);
    expect(applyCardFeedback(null, 'итог')).toBeNull();
  });

  it('завершение переводит в done только свою карточку', () => {
    const card = pinResult(2, 'текст');
    expect(completeCard(card, 2)?.status).toBe('done');
    expect(completeCard(card, 1)).toBe(card);
    const done = completeCard(card, 2);
    expect(completeCard(done, 2)).toBe(done);
    expect(completeCard(null, 2)).toBeNull();
  });

  it('закрытие по id не снимает новую карточку, без id снимает любую', () => {
    const card = pinResult(5, 'текст');
    expect(dismissCard(card, 4)).toBe(card);
    expect(dismissCard(card, 5)).toBeNull();
    expect(dismissCard(card)).toBeNull();
    expect(dismissCard(null, 5)).toBeNull();
  });
});

describe('toResultCard и видимость', () => {
  it('принимает только похожее на карточку', () => {
    expect(toResultCard(null)).toBeNull();
    expect(toResultCard({ id: '1', transcript: 'x' })).toBeNull();
    expect(toResultCard({ id: 1, transcript: '  ' })).toBeNull();
    expect(toResultCard({ id: 1, transcript: ' x ', feedback: '', status: 'weird' })).toEqual({
      id: 1,
      transcript: 'x',
      feedback: null,
      status: 'classifying'
    });
    expect(toResultCard({ id: 2, transcript: 'x', feedback: 'итог', status: 'done' })?.status).toBe('done');
  });

  it('закрытая в main карточка не показывается снова, новая показывается', () => {
    const card = pinResult(3, 'текст');
    expect(isCardVisible(card, null)).toBe(true);
    expect(isCardVisible(card, 3)).toBe(false);
    expect(isCardVisible(pinResult(4, 'текст'), 3)).toBe(true);
    expect(isCardVisible(null, null)).toBe(false);
  });
});

describe('попадание клика в карточку', () => {
  const bounds = { x: 100, y: 500, width: 800, height: 200 };

  it('границы: левая и верхняя входят, правая и нижняя нет', () => {
    expect(isPointInBounds({ x: 100, y: 500 }, bounds)).toBe(true);
    expect(isPointInBounds({ x: 899, y: 699 }, bounds)).toBe(true);
    expect(isPointInBounds({ x: 900, y: 600 }, bounds)).toBe(false);
    expect(isPointInBounds({ x: 500, y: 700 }, bounds)).toBe(false);
    expect(isPointInBounds({ x: 99, y: 600 }, bounds)).toBe(false);
  });

  it('физические пиксели хука пересчитываются в DIP по масштабу дисплея', () => {
    expect(physicalToDip({ x: 250, y: 125 }, 1.25)).toEqual({ x: 200, y: 100 });
    expect(physicalToDip({ x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
    expect(physicalToDip({ x: 10, y: 20 }, Number.NaN)).toEqual({ x: 10, y: 20 });
  });

  it('при масштабе 150 % клик внутри окна в физических пикселях не считается кликом мимо', () => {
    // Окно в DIP: 100..900 × 500..700 → в физических: 150..1350 × 750..1050.
    expect(isClickOutsideCard({ x: 1300, y: 1000 }, bounds, 1.5)).toBe(false);
    // Без учёта масштаба та же точка оказалась бы за пределами окна.
    expect(isClickOutsideCard({ x: 1300, y: 1000 }, bounds, 1)).toBe(true);
    expect(isClickOutsideCard({ x: 1400, y: 1000 }, bounds, 1.5)).toBe(true);
    expect(isClickOutsideCard({ x: 140, y: 800 }, bounds, 1.5)).toBe(true);
  });
});

describe('estimateCardHeight', () => {
  const base = { feedbackLength: 20, width: 900, maxHeight: 700 };

  it('короткая фраза получает минимальную высоту', () => {
    expect(estimateCardHeight({ ...base, transcriptLength: 10 })).toBe(CARD_LAYOUT.minHeight);
  });

  it('длинная фраза растит карточку, но не выше предела', () => {
    const short = estimateCardHeight({ ...base, transcriptLength: 10 });
    const long = estimateCardHeight({ ...base, transcriptLength: 400 });
    expect(long).toBeGreaterThan(short);
    expect(estimateCardHeight({ ...base, transcriptLength: 50_000 })).toBe(700);
  });

  it('узкая карточка выше широкой при том же тексте', () => {
    const wide = estimateCardHeight({ ...base, transcriptLength: 300 });
    const narrow = estimateCardHeight({ ...base, transcriptLength: 300, width: 500 });
    expect(narrow).toBeGreaterThan(wide);
  });
});

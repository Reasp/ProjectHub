import { describe, expect, it } from 'vitest';
import {
  LOW_CONFIDENCE_THRESHOLD,
  VOICE_INTENT_CATALOG,
  VoiceClassifierCache,
  buildVoiceClassifierPrompt,
  getVoiceIntentSpec,
  isConfident,
  normalizeCacheKey,
  parseVoiceClassifierResponse,
  type VoiceClassification
} from '../../electron/services/voiceCommandClassifier';

const ok = (intent: string, confidence = 0.9): VoiceClassification => ({
  intent,
  type: getVoiceIntentSpec(intent)!.type,
  confidence,
  source: 'json'
});

describe('buildVoiceClassifierPrompt: промпт классификатора (TASK-83, AC #2)', () => {
  it('перечисляет интенты и требует один JSON-объект', () => {
    const prompt = buildVoiceClassifierPrompt({ transcript: 'сверни всё и покажи задачи' });
    expect(prompt).toContain('navigate_kanban');
    expect(prompt).toContain('send_prompt');
    expect(prompt).toContain('"intent"');
    expect(prompt).toContain('сверни всё и покажи задачи');
    expect(prompt).toContain('unknown');
  });

  it('контекст попадает в промпт: проекты и ожидающее подтверждение', () => {
    const prompt = buildVoiceClassifierPrompt({
      transcript: 'давай',
      projectNames: ['ProjectHub', 'WorldSim'],
      hasPendingApproval: true
    });
    expect(prompt).toContain('WorldSim');
    expect(prompt).toContain('ждёт подтверждения');
  });

  it('при выключенном управлении компьютером интент computer_task не предлагается', () => {
    const off = buildVoiceClassifierPrompt({ transcript: 'кликни сохранить', computerUseEnabled: false });
    expect(off).not.toContain('computer_task —');
    expect(off).toContain('Управление компьютером выключено');

    const on = buildVoiceClassifierPrompt({ transcript: 'кликни сохранить', computerUseEnabled: true });
    expect(on).toContain('computer_task —');
  });

  it('каталог самодостаточен: у каждого интента есть тип и описание', () => {
    for (const spec of VOICE_INTENT_CATALOG) {
      expect(spec.id, spec.id).toMatch(/^[a-z0-9_]+$/);
      expect(spec.description.length, spec.id).toBeGreaterThan(0);
      for (const field of spec.payload ?? []) {
        expect(field.hint.length, `${spec.id}.${field.name}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('parseVoiceClassifierResponse: разбор ответа модели', () => {
  it('чистый JSON', () => {
    expect(parseVoiceClassifierResponse('{"intent":"navigate_git","payload":{},"confidence":0.92}')).toMatchObject({
      intent: 'navigate_git',
      type: 'navigation',
      confidence: 0.92,
      source: 'json'
    });
  });

  it('JSON в ```-ограде и с пояснениями вокруг', () => {
    const raw = 'Конечно! Вот результат:\n```json\n{"intent": "run_tests", "confidence": 0.8}\n```\nНадеюсь, помог.';
    expect(parseVoiceClassifierResponse(raw)).toMatchObject({ intent: 'run_tests', type: 'action', source: 'json' });
  });

  it('«голый» идентификатор интента — запасной формат для слабых моделей', () => {
    expect(parseVoiceClassifierResponse('navigate_kanban')).toMatchObject({ intent: 'navigate_kanban', source: 'bare' });
    expect(parseVoiceClassifierResponse('  NAVIGATE-DOCS  ')).toMatchObject({ intent: 'navigate_docs', source: 'bare' });
    expect(parseVoiceClassifierResponse('intent: stop_reading')).toMatchObject({ intent: 'stop_reading', source: 'bare' });
  });

  it('синонимы приводятся к каноничным идентификаторам', () => {
    expect(parseVoiceClassifierResponse('{"intent":"open_tasks"}').intent).toBe('navigate_kanban');
    expect(parseVoiceClassifierResponse('{"intent":"approve"}').intent).toBe('agent_approve');
    expect(parseVoiceClassifierResponse('{"intent":"none"}').intent).toBe('unknown');
  });

  it('номера приходят от модели с единицы, наружу уходят с нуля', () => {
    expect(parseVoiceClassifierResponse('{"intent":"agent_select_option","payload":{"optionIndex":2}}')).toMatchObject({
      intent: 'agent_select_option',
      payload: { optionIndex: 1 }
    });
    expect(parseVoiceClassifierResponse('{"intent":"switch_project_index","payload":{"tabIndex":-1}}')).toMatchObject({
      payload: { tabIndex: -1 }
    });
    // Ноль и дробные номера отбрасываются: поле необязательное, рендерер подставит значение по умолчанию.
    expect(parseVoiceClassifierResponse('{"intent":"switch_session_index","payload":{"sessionIndex":0}}').payload).toBeUndefined();
  });

  it('payload очищается по спецификации интента: лишние поля отбрасываются', () => {
    const result = parseVoiceClassifierResponse(
      '{"intent":"send_prompt","payload":{"text":"  проверь тесты  ","rm":"-rf /"},"confidence":0.7}'
    );
    expect(result.payload).toEqual({ text: 'проверь тесты' });
  });

  it('обязательный payload отсутствует — интент не исполняется', () => {
    const result = parseVoiceClassifierResponse('{"intent":"send_prompt","payload":{},"confidence":0.95}');
    expect(result).toMatchObject({ intent: 'unknown', confidence: 0 });
    expect(result.error).toContain('send_prompt');
  });

  it('шкала уверенности приводится к 0..1', () => {
    expect(parseVoiceClassifierResponse('{"intent":"run_dev","confidence":85}').confidence).toBeCloseTo(0.85);
    expect(parseVoiceClassifierResponse('{"intent":"run_dev","confidence":8}').confidence).toBeCloseTo(0.8);
    expect(parseVoiceClassifierResponse('{"intent":"run_dev","confidence":-3}').confidence).toBe(0);
    // Поля нет — берём среднюю уверенность, а не максимальную.
    expect(parseVoiceClassifierResponse('{"intent":"run_dev"}').confidence).toBe(0.5);
  });

  it('мусор, пустой ответ и выдуманные интенты дают unknown, а не исключение', () => {
    expect(parseVoiceClassifierResponse('')).toMatchObject({ intent: 'unknown', source: 'none' });
    expect(parseVoiceClassifierResponse('не знаю, что вы имели в виду')).toMatchObject({ intent: 'unknown' });
    expect(parseVoiceClassifierResponse('{"intent":"launch_missiles"}')).toMatchObject({ intent: 'unknown' });
    expect(parseVoiceClassifierResponse('{"intent": broken json')).toMatchObject({ intent: 'unknown' });
    expect(parseVoiceClassifierResponse('[1,2,3]')).toMatchObject({ intent: 'unknown' });
  });

  it('порог уверенности отделяет исполнение от переспроса', () => {
    expect(isConfident(ok('navigate_git', 0.9))).toBe(true);
    expect(isConfident(ok('navigate_git', 0.3))).toBe(false);
    expect(isConfident({ intent: 'unknown', type: 'unknown', confidence: 1, source: 'json' })).toBe(false);
    expect(LOW_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
  });
});

describe('VoiceClassifierCache: кэш частых фраз', () => {
  it('ключ не зависит от регистра, пунктуации и лишних пробелов', () => {
    expect(normalizeCacheKey('  Открой,  ЗАДАЧИ! ', 'ru')).toBe(normalizeCacheKey('открой задачи', 'ru'));
    expect(normalizeCacheKey('всё', 'ru')).toBe(normalizeCacheKey('все', 'ru'));
    expect(normalizeCacheKey('открой задачи', 'ru')).not.toBe(normalizeCacheKey('открой задачи', 'en'));
  });

  it('повторная фраза возвращается из кэша', () => {
    const cache = new VoiceClassifierCache();
    expect(cache.set('сверни всё', 'ru', ok('hide_sidebar'), 0)).toBe(true);
    expect(cache.get('Сверни всё!', 'ru', 100)).toMatchObject({ intent: 'hide_sidebar' });
    expect(cache.get('сверни всё', 'en', 100)).toBeNull();
  });

  it('неуверенные и нераспознанные ответы не кэшируются', () => {
    const cache = new VoiceClassifierCache();
    expect(cache.set('непонятно', 'ru', { intent: 'unknown', type: 'unknown', confidence: 0, source: 'none' }, 0)).toBe(false);
    expect(cache.set('непонятно', 'ru', ok('navigate_git', 0.2), 0)).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('пустая фраза не кэшируется', () => {
    const cache = new VoiceClassifierCache();
    expect(cache.set('   ', 'ru', ok('navigate_git'), 0)).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('запись устаревает по TTL', () => {
    const cache = new VoiceClassifierCache({ ttlMs: 1000 });
    cache.set('открой гит', 'ru', ok('navigate_git'), 0);
    expect(cache.get('открой гит', 'ru', 900)).not.toBeNull();
    expect(cache.get('открой гит', 'ru', 1500)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('вытеснение по LRU: обращение продлевает жизнь записи', () => {
    const cache = new VoiceClassifierCache({ maxEntries: 2 });
    cache.set('фраза один', 'ru', ok('navigate_git'), 0);
    cache.set('фраза два', 'ru', ok('navigate_docs'), 1);
    // Обращение к первой делает самой старой вторую.
    expect(cache.get('фраза один', 'ru', 2)).not.toBeNull();
    cache.set('фраза три', 'ru', ok('navigate_files'), 3);

    expect(cache.size).toBe(2);
    expect(cache.get('фраза один', 'ru', 4)).not.toBeNull();
    expect(cache.get('фраза два', 'ru', 4)).toBeNull();
    expect(cache.get('фраза три', 'ru', 4)).not.toBeNull();
  });

  it('clear очищает кэш', () => {
    const cache = new VoiceClassifierCache();
    cache.set('открой гит', 'ru', ok('navigate_git'), 0);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

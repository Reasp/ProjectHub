import { describe, expect, it } from 'vitest';
import { messagesForModel, providerErrorAdvice, providerErrorTitle, providerErrorView, retryTarget } from '../../src/lib/providerErrorView';
import { ru } from '../../src/i18n/ru';
import { en } from '../../src/i18n/en';
import type { AIMessage, ProviderErrorInfo } from '../../src/types/electron';
import { classifyHttpError, classifyNetworkError, PROVIDER_ERROR_KINDS } from '../../electron/services/providerErrors';

const ollamaMissing = classifyHttpError(
  { status: 404, body: `{"error":{"message":"model 'no-such:1b' not found","type":"not_found_error"}}` },
  { provider: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1/chat/completions', model: 'no-such:1b', local: true }
) as ProviderErrorInfo;

describe('providerErrorView: заголовок и совет из словаря (ru/en)', () => {
  it('модель Ollama не найдена', () => {
    const vRu = providerErrorView(ollamaMissing, ru.providerErrors);
    expect(vRu.title).toBe('Модель не найдена');
    expect(vRu.advice).toContain('ollama pull no-such:1b');
    expect(vRu.retryHint).toBe(ru.providerErrors.notRetryable);
    expect(vRu.details).toEqual([
      { label: 'Провайдер', value: 'Ollama' },
      { label: 'Модель', value: 'no-such:1b' },
      { label: 'Адрес', value: 'http://127.0.0.1:11434/v1/chat/completions' },
      { label: 'Код', value: 'HTTP 404 · not_found_error' }
    ]);
    expect(vRu.serverMessage).toBe("model 'no-such:1b' not found");

    const vEn = providerErrorView(ollamaMissing, en.providerErrors);
    expect(vEn.title).toBe('Model not found');
    expect(vEn.advice).toContain('Pull the model (`ollama pull no-such:1b`)');
  });

  it('сервер не запущен — причина важнее вида, совет для локального сервера', () => {
    const refused = classifyNetworkError(
      Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11999'), { code: 'ECONNREFUSED' }) }),
      { provider: 'Ollama', local: true }
    ) as ProviderErrorInfo;
    expect(providerErrorTitle(refused, en.providerErrors)).toBe('Server refuses connections');
    expect(providerErrorAdvice(refused, ru.providerErrors)).toContain('Запустите локальный сервер');
    expect(providerErrorView(refused, ru.providerErrors).retryHint).toBe(ru.providerErrors.retryable);
  });

  it('лимит с retry-after и ключ профиля', () => {
    const rl = classifyHttpError({ status: 429, body: '{}', headers: { 'retry-after': '12' } }) as ProviderErrorInfo;
    expect(providerErrorAdvice(rl, en.providerErrors)).toMatch(/^Wait 12 s and retry/);
    const auth = classifyHttpError({ status: 401, body: '{"detail":"Invalid API Key"}' }, { provider: 'Mistral', profileId: 'p-m' }) as ProviderErrorInfo;
    expect(providerErrorAdvice(auth, ru.providerErrors)).toBe('Проверьте API-ключ профиля «Mistral» в настройках AI Studio → «Профили провайдеров».');
    const legacy = classifyHttpError({ status: 401, body: '{}' }, { provider: 'Anthropic' }) as ProviderErrorInfo;
    expect(providerErrorAdvice(legacy, en.providerErrors)).toBe('Check the API key of provider «Anthropic» in AI Studio settings.');
  });

  it('ошибка настройки — текст main-процесса как совет', () => {
    const cfg: ProviderErrorInfo = { kind: 'config', reason: 'no_model', retryable: false, message: 'Модель не выбрана в настройках AI Studio.' };
    expect(providerErrorView(cfg, en.providerErrors)).toMatchObject({ title: 'Configuration error', advice: 'Модель не выбрана в настройках AI Studio.' });
  });

  it('у каждого вида есть заголовок в обоих словарях', () => {
    for (const kind of PROVIDER_ERROR_KINDS) {
      expect(ru.providerErrors.kinds[kind]).toBeTruthy();
      expect(en.providerErrors.kinds[kind]).toBeTruthy();
    }
  });
});

describe('история для модели и повтор', () => {
  const msg = (id: string, role: AIMessage['role'], content: string, extra: Partial<AIMessage> = {}): AIMessage => ({
    id,
    role,
    content,
    timestamp: '2026-09-19T00:00:00Z',
    ...extra
  });

  it('упавший пустой ответ не уходит модели, частичный ответ — уходит', () => {
    const history = [
      msg('u1', 'user', 'привет'),
      msg('a1', 'assistant', '', { error: 'x', providerError: ollamaMissing }),
      msg('u2', 'user', 'ещё раз'),
      msg('a2', 'assistant', 'частичный ответ', { error: 'обрыв' }),
      msg('a3', 'assistant', 'обычный ответ')
    ];
    expect(messagesForModel(history).map((m) => m.id)).toEqual(['u1', 'u2', 'a2', 'a3']);
  });

  it('retryTarget — сообщение пользователя перед упавшим ответом', () => {
    const history = [msg('u1', 'user', 'вопрос'), msg('a1', 'assistant', '', { error: 'x' }), msg('a2', 'assistant', 'ok')];
    expect(retryTarget(history, 'a1')).toEqual({ userText: 'вопрос', removeIds: ['u1', 'a1'] });
    expect(retryTarget(history, 'a2')).toBeUndefined(); // без ошибки повторять нечего
    expect(retryTarget(history, 'nope')).toBeUndefined();
    expect(retryTarget([msg('a1', 'assistant', '', { error: 'x' })], 'a1')).toBeUndefined();
  });
});

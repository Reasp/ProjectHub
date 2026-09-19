import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ProviderError,
  classifyHttpError,
  classifyNetworkError,
  classifyStreamError,
  describeProviderErrorBrief,
  formatProviderErrorMessage,
  parseErrorBody,
  parseRetryAfter,
  providerConfigError,
  providerErrorInfoOf,
  redactSecrets,
  retryAfterFromText,
  safeEndpoint,
  secretsFromHeaders,
  timeoutError,
  toProviderErrorInfo,
  type ProviderErrorInfo
} from '../../electron/services/providerErrors';

interface HttpCase {
  id: string;
  source: 'live' | 'docs';
  status: number;
  body: string;
  headers?: Record<string, string>;
  local?: boolean;
  toolsSent?: boolean;
  reasoningEffort?: string;
  expect: Partial<ProviderErrorInfo>;
}

interface StreamCase {
  id: string;
  source: 'live' | 'docs';
  payload: unknown;
  expect: Partial<ProviderErrorInfo>;
}

const fixtures = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'provider-errors.json'), 'utf8')
) as { cases: HttpCase[]; stream: StreamCase[] };

describe('classifyHttpError — реальные тела и фикстуры по документации', () => {
  it('фикстуры есть обоих видов', () => {
    expect(fixtures.cases.filter((c) => c.source === 'live').length).toBeGreaterThanOrEqual(15);
    expect(fixtures.cases.filter((c) => c.source === 'docs').length).toBeGreaterThanOrEqual(15);
  });

  for (const c of fixtures.cases) {
    it(`${c.id} (${c.source}) → ${c.expect.kind}${c.expect.reason ? `/${c.expect.reason}` : ''}`, () => {
      const info = classifyHttpError(
        { status: c.status, body: c.body, headers: c.headers },
        {
          provider: 'P',
          endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
          model: 'm',
          local: c.local,
          toolsSent: c.toolsSent ?? false,
          reasoningEffort: c.reasoningEffort
        }
      );
      expect(info).toMatchObject(c.expect);
      expect(info.status).toBe(c.status);
      expect(info.message).toMatch(/^Провайдер «P» \(http:\/\/127\.0\.0\.1:11434\/v1\/chat\/completions\), модель «m»: /);
      if (c.body.trim()) expect(info.serverMessage).toBeTruthy();
    });
  }
});

describe('classifyStreamError', () => {
  for (const c of fixtures.stream) {
    it(`${c.id} → ${c.expect.kind}`, () => {
      expect(classifyStreamError(c.payload, { provider: 'OpenRouter' })).toMatchObject(c.expect);
    });
  }

  it('обычный чанк без error — не ошибка', () => {
    expect(classifyStreamError({ choices: [{ delta: { content: 'hi' } }] })).toBeUndefined();
    expect(classifyStreamError({ error: null, choices: [] })).toBeUndefined();
    expect(classifyStreamError('text')).toBeUndefined();
  });
});

describe('classifyNetworkError — формы ошибок fetch из Node 22 (сняты вживую)', () => {
  const fetchFailed = (cause: unknown) => Object.assign(new TypeError('fetch failed'), { cause });

  it('ECONNREFUSED на 127.0.0.1 — сервер не запущен', () => {
    const err = fetchFailed(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11999'), { code: 'ECONNREFUSED' }));
    const info = classifyNetworkError(err, { provider: 'Ollama', endpoint: 'http://127.0.0.1:11999/v1/chat/completions', local: true, model: 'qwen' })!;
    expect(info).toMatchObject({ kind: 'unavailable', reason: 'refused', code: 'ECONNREFUSED', retryable: true, local: true });
    expect(info.message).toContain('сервер не принимает подключения');
    expect(info.message).toContain('Запустите локальный сервер');
    expect(info.serverMessage).toContain('ECONNREFUSED 127.0.0.1:11999');
  });

  it('localhost: AggregateError с кодом у вложенных ошибок', () => {
    const inner = [Object.assign(new Error('a'), { code: 'ECONNREFUSED' }), Object.assign(new Error('b'), { code: 'ECONNREFUSED' })];
    const agg = Object.assign(new AggregateError(inner, ''), { code: 'ECONNREFUSED' });
    expect(classifyNetworkError(fetchFailed(agg))).toMatchObject({ reason: 'refused' });
    const aggNoCode = new AggregateError(inner, '');
    expect(classifyNetworkError(fetchFailed(aggNoCode))).toMatchObject({ reason: 'refused' });
  });

  it('DNS, TLS, connect timeout, TimeoutError, обрыв потока', () => {
    expect(classifyNetworkError(fetchFailed(Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' })))).toMatchObject({
      reason: 'dns',
      retryable: false
    });
    expect(classifyNetworkError(fetchFailed(Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })))).toMatchObject({
      reason: 'tls',
      retryable: false
    });
    expect(
      classifyNetworkError(fetchFailed(Object.assign(new Error('Connect Timeout Error'), { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' })))
    ).toMatchObject({ reason: 'timeout', retryable: true });
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(classifyNetworkError(timeout)).toMatchObject({ reason: 'timeout' });
    expect(classifyNetworkError(Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET' } }))).toMatchObject({ reason: 'network' });
  });

  it('отмена и обычные ошибки кода — не сетевые', () => {
    const abort = new Error('This operation was aborted');
    abort.name = 'AbortError';
    expect(classifyNetworkError(abort)).toBeUndefined();
    expect(classifyNetworkError(new Error('Cannot read properties of undefined'))).toBeUndefined();
    expect(classifyNetworkError(new TypeError('x is not a function'))).toBeUndefined();
  });
});

describe('toProviderErrorInfo и ProviderError', () => {
  it('ProviderError передаёт снимок как есть, message — текст пользователю', () => {
    const info = classifyHttpError({ status: 401, body: '{"detail":"Invalid API Key"}' }, { provider: 'Mistral' });
    const err = new ProviderError(info);
    expect(err.message).toBe(info.message);
    expect(providerErrorInfoOf(err)).toBe(info);
    expect(toProviderErrorInfo(err)).toBe(info);
    // После IPC или structuredClone класс теряется — снимок узнаётся по форме.
    expect(providerErrorInfoOf({ info: JSON.parse(JSON.stringify(info)) })).toMatchObject({ kind: 'auth' });
    expect(providerErrorInfoOf({ info: { kind: 'nope', message: 'x' } })).toBeUndefined();
  });

  it('AbortError — не ошибка провайдера, прочее — unknown с текстом', () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    expect(toProviderErrorInfo(abort)).toBeUndefined();
    expect(toProviderErrorInfo(new Error('boom'), { provider: 'X' })).toMatchObject({ kind: 'unknown', message: 'boom', provider: 'X', retryable: false });
  });

  it('ошибка настройки сохраняет текст вызывающего кода', () => {
    const err = providerConfigError('Модель не выбрана: укажите идентификатор модели.', 'no_model');
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Модель не выбрана: укажите идентификатор модели.');
    expect(err.info).toMatchObject({ kind: 'config', reason: 'no_model', retryable: false });
  });

  it('таймаут complete() — unavailable/timeout с моделью', () => {
    const info = timeoutError(60_000, { provider: 'Ollama', model: 'qwen', local: true });
    expect(info).toMatchObject({ kind: 'unavailable', reason: 'timeout', retryable: true });
    expect(info.message).toContain('нет ответа за 60 с');
  });
});

describe('сообщение: что случилось, где, что сделать', () => {
  it('модель Ollama не найдена — совет ollama pull', () => {
    const info = classifyHttpError(
      { status: 404, body: `{"error":{"message":"model 'no-such:1b' not found","type":"not_found_error"}}` },
      { provider: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1/chat/completions', model: 'no-such:1b', local: true }
    );
    expect(info.message).toBe(
      "Провайдер «Ollama» (http://127.0.0.1:11434/v1/chat/completions), модель «no-such:1b»: модель не найдена (HTTP 404). " +
        'Что сделать: Загрузите модель (`ollama pull no-such:1b`) или выберите установленную; обновите каталог моделей профиля. ' +
        "Ответ сервера: model 'no-such:1b' not found"
    );
  });

  it('облачная модель не найдена — совет обновить каталог', () => {
    const info = classifyHttpError({ status: 404, body: '{"error":{"code":"model_not_found","message":"The model `x` does not exist"}}' }, { provider: 'OpenAI', model: 'x' });
    expect(info.message).toContain('Обновите каталог моделей профиля');
  });

  it('401 — проверить ключ профиля', () => {
    const info = classifyHttpError({ status: 401, body: 'Authentication Fails (governor)' }, { provider: 'DeepSeek' });
    expect(info.message).toContain('нет доступа: ключ не принят (HTTP 401)');
    expect(info.message).toContain('Проверьте API-ключ провайдера «DeepSeek» в настройках AI Studio.');
    const profile = classifyHttpError({ status: 401, body: 'x' }, { provider: 'Groq', profileId: 'p-g' });
    expect(profile.message).toContain('Проверьте API-ключ профиля «Groq» в настройках AI Studio → «Профили провайдеров».');
  });

  it('усилие рассуждений — подсказка с уровнем (decision-41 п. 2)', () => {
    const info = classifyHttpError(
      { status: 400, body: '{"error":{"message":"\\"qwen2.5:7b-instruct\\" does not support thinking"}}' },
      { reasoningEffort: 'high' }
    );
    expect(info.message).toContain('модель не приняла усилие рассуждений');
    expect(info.message).toContain('вместо «high»');
    // Без отправленного усилия упоминание thinking — не повод советовать уровень.
    expect(classifyHttpError({ status: 400, body: 'does not support thinking' }).reason).toBeUndefined();
    // Отказ не про рассуждения — не про усилие, даже если оно было отправлено.
    expect(classifyHttpError({ status: 400, body: 'bad parameter temperature' }, { reasoningEffort: 'high' }).reason).toBeUndefined();
  });

  it('tools — только если инструменты были в запросе', () => {
    const body = '{"error":{"message":"x does not support tools"}}';
    expect(classifyHttpError({ status: 400, body }, { toolsSent: true }).reason).toBe('tools');
    expect(classifyHttpError({ status: 400, body }, { toolsSent: false }).reason).toBeUndefined();
  });

  it('краткая строка для экспорта', () => {
    const info = classifyHttpError({ status: 429, body: '{"error":{"message":"slow down"}}', headers: { 'Retry-After': '12' } });
    expect(describeProviderErrorBrief(info)).toBe('rate_limit (HTTP 429, повтор через 12 с, можно повторить)');
    const auth = classifyHttpError({ status: 401, body: '{"error":{"code":"invalid_api_key","message":"bad"}}' });
    expect(describeProviderErrorBrief(auth)).toBe('auth (HTTP 401, код invalid_api_key, повтор без изменения настроек не поможет)');
  });

  it('formatProviderErrorMessage без контекста не ломается', () => {
    expect(formatProviderErrorMessage({ kind: 'unknown', retryable: false, message: '' })).toBe('Провайдер: ошибка запроса.');
  });
});

describe('ключи не попадают в сообщение', () => {
  const key = 'sk-or-v1-0123456789abcdef0123456789abcdef';

  it('значение ключа из заголовков вырезается из ответа сервера', () => {
    const secrets = secretsFromHeaders({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'ProjectHub' });
    expect(secrets).toEqual([key]);
    const info = classifyHttpError(
      { status: 401, body: `{"error":{"message":"Key ${key} is disabled; header was Authorization: Bearer ${key}"}}` },
      { secrets, provider: 'OpenRouter' }
    );
    expect(info.message).not.toContain(key);
    expect(JSON.stringify(info)).not.toContain(key);
    expect(info.serverMessage).toContain('***');
  });

  it('шаблоны ключей и Bearer вырезаются даже без списка секретов', () => {
    const text = 'got sk-proj-AbCdEfGhIjKlMnOp and Bearer abcdefghijklmnop and sk-ant-api03-ZZZZZZZZZZZZZZZZ';
    const out = redactSecrets(text);
    expect(out).not.toMatch(/AbCdEfGh|abcdefghijklmnop|ZZZZZZZZ/);
    // Уже замаскированный сервером ключ остаётся как есть.
    expect(redactSecrets('Incorrect API key provided: sk-inval*******-key.')).toBe('Incorrect API key provided: sk-inval*******-key.');
  });

  it('адрес без логина, пароля и query', () => {
    expect(safeEndpoint('https://user:secret@host.example/v1/chat/completions?key=abc#x')).toBe('https://host.example/v1/chat/completions');
    expect(safeEndpoint('not a url?key=abc')).toBe('not a url');
    expect(safeEndpoint('')).toBeUndefined();
  });
});

describe('разбор тела и retry-after', () => {
  it('разные форматы тела', () => {
    expect(parseErrorBody('{"error":"plain"}').message).toBe('plain');
    expect(parseErrorBody('{"detail":[{"msg":"a"},{"msg":"b"}]}').message).toBe('a; b');
    expect(parseErrorBody('<!DOCTYPE html><html><title>Bad Gateway</title></html>').message).toBe('Bad Gateway');
    expect(parseErrorBody('  multi\n line  ').message).toBe('multi line');
    expect(parseErrorBody('').message).toBeUndefined();
    expect(parseErrorBody('{"error":{"message":"Provider returned error","metadata":{"raw":"upstream 429"}}}').message).toBe(
      'Provider returned error (upstream 429)'
    );
  });

  it('длинное тело обрезается до 500 символов', () => {
    const info = classifyHttpError({ status: 500, body: 'x'.repeat(2000) });
    expect(info.serverMessage!.length).toBe(500);
  });

  it('Retry-After секундами и датой, «try again in» в тексте', () => {
    expect(parseRetryAfter('20')).toBe(20_000);
    expect(parseRetryAfter('1.5')).toBe(1500);
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:10 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'))).toBe(10_000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(retryAfterFromText('Please try again in 7.66s.')).toBe(7660);
    expect(retryAfterFromText('Please try again in 120ms')).toBe(120);
    expect(retryAfterFromText('Please try again in 1m30s')).toBe(90_000);
    expect(retryAfterFromText('nothing here')).toBeUndefined();
  });
});

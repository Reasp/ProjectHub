import { describe, expect, it } from 'vitest';
import { detectSecrets, looksLikeSecretValue } from '../../electron/services/secretPatterns';
import { redactSecrets } from '../../electron/services/hitlAudit';

/** Детектор секретов для памяти проекта (TASK-76.1, decision-51 п. 5). */

const kinds = (text: string) => detectSecrets(text).map((f) => f.kind);

describe('detectSecrets — находит', () => {
  it.each([
    ['ключ Anthropic', 'ключ sk-ant-api03-AbCdEf0123456789xyzXYZ', 'provider_key'],
    ['ключ OpenRouter', 'OPENROUTER=sk-or-v1-0123456789abcdef0123', 'provider_key'],
    ['ключ Groq', 'gsk_0123456789abcdefABCDEF', 'provider_key'],
    ['GitHub PAT', 'token ghp_0123456789abcdefABCDEF0123', 'github_token'],
    ['fine-grained PAT', 'github_pat_11ABCDEFG0123456789_abcdef', 'github_token'],
    ['Slack', 'xoxb-1234567890-abcdefghij', 'slack_token'],
    ['AWS', 'AKIAIOSFODNN7EXAMPLE', 'aws_key'],
    ['Google API', 'AIzaSyA0123456789abcdefghijklmnopqrstuv', 'google_key'],
    ['Hugging Face', 'hf_abcdefghijklmnopqrstuvwxyz012345', 'huggingface_token'],
    ['приватный ключ', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA==', 'private_key'],
    ['RSA-ключ', '-----BEGIN RSA PRIVATE KEY-----', 'private_key'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'jwt'],
    ['пароль в URL', 'postgres://admin:S3cretPass@db.local:5432/app', 'url_password'],
    ['Bearer', 'Authorization: Bearer abcDEF0123456789ghiJKL', 'bearer_token'],
    ['переменная окружения', 'OPENAI_API_KEY=abc123def456ghi789', 'assigned_secret'],
    ['пароль с двоеточием', 'password: "Qwerty123456!"', 'assigned_secret']
  ])('%s', (_name, text, kind) => {
    expect(kinds(text)).toContain(kind);
  });
});

describe('detectSecrets — не срабатывает на обычный текст', () => {
  it.each([
    'password: хранится в safeStorage, в лог не пишется',
    'Токен передаётся в переменной окружения PROJECTHUB_MCP_TOKEN, в конфиги не писать',
    'token: ${PROJECTHUB_MCP_TOKEN}',
    'API_KEY=<your-key-here>',
    'postgres://user:***@db/app',
    'postgres://user:${DB_PASSWORD}@db/app',
    'Замаскированный ключ sk-inval****-key из ответа сервера',
    'Сборка pack:win падает, если открыт release/win-unpacked/ProjectHub.exe',
    'secret = true; key = value',
    'Коммит 3b71fd6, ветка swarm/abc123/done-task-1-3',
    ''
  ])('%s', (text) => {
    expect(detectSecrets(text)).toEqual([]);
  });
});

describe('detectSecrets — форма результата', () => {
  it('по одной находке каждого вида, по порядку позиции, без значения', () => {
    const text = 'a sk-ant-api03-AbCdEf0123456789xyz b sk-ant-api03-ZZZZZZ0123456789xyz AKIAIOSFODNN7EXAMPLE';
    const found = detectSecrets(text);
    expect(found.map((f) => f.kind)).toEqual(['provider_key', 'aws_key']);
    expect(found[0].index).toBe(2);
    expect(Object.keys(found[0]).sort()).toEqual(['index', 'kind']);
  });

  it('повторный вызов не зависит от lastIndex глобальных шаблонов', () => {
    const text = 'x AKIAIOSFODNN7EXAMPLE';
    expect(kinds(text)).toEqual(['aws_key']);
    expect(kinds(text)).toEqual(['aws_key']);
  });
});

describe('looksLikeSecretValue', () => {
  it('длинное значение с буквами и цифрами без пробелов', () => {
    expect(looksLikeSecretValue('abc123def456')).toBe(true);
    expect(looksLikeSecretValue('"abc123def456ghi"')).toBe(true);
    expect(looksLikeSecretValue('short1')).toBe(false);
    expect(looksLikeSecretValue('onlylettersherexx')).toBe(false);
    expect(looksLikeSecretValue('${SECRET_VALUE_123}')).toBe(false);
    expect(looksLikeSecretValue('%API_KEY%')).toBe(false);
  });
});

describe('hitlAudit.redactSecrets на общих шаблонах', () => {
  it('маскирует как прежде', () => {
    expect(redactSecrets('OPENAI_API_KEY=sk-abcdef123456 npm test')).toBe('OPENAI_API_KEY=*** npm test');
    expect(redactSecrets('git clone https://user:pass@host/repo')).toBe('git clone https://user:***@host/repo');
    expect(redactSecrets('echo ghp_abcdefghij1234')).toBe('echo gh*_***');
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Шифрование ОС в тестах недоступно: secretStorageService хранит ключ с префиксом-заглушкой.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`x${s}`),
    decryptString: (b: Buffer) => b.toString().slice(1)
  }
}));

const { LlmProfileService } = await import('../../electron/services/llmProfileService');
const { LlmModelCatalogService } = await import('../../electron/services/llmModelCatalogService');

let dir: string;
let service: InstanceType<typeof LlmProfileService>;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-llm-profiles-'));
  service = new LlmProfileService(path.join(dir, 'llm-profiles.json'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('LlmProfileService (TASK-70.1)', () => {
  it('сохраняет несколько профилей, ключ на диске зашифрован и наружу не отдаётся', async () => {
    await service.saveProfile({ profile: { id: 'or', presetId: 'openrouter' }, apiKey: 'sk-secret' });
    await service.saveProfile({ profile: { id: 'local', presetId: 'ollama', name: 'Ноутбук' } });

    const list = await service.listProfiles();
    expect(list.map((p) => [p.id, p.hasApiKey])).toEqual([['or', true], ['local', false]]);
    expect(JSON.stringify(list)).not.toContain('sk-secret');

    const raw = await fs.readFile(path.join(dir, 'llm-profiles.json'), 'utf-8');
    expect(raw).not.toContain('sk-secret');

    const { apiKey } = await service.getProfileWithKey('or');
    expect(apiKey).toBe('sk-secret');
  });

  it('ключ: undefined — оставить, пустая строка — удалить', async () => {
    await service.saveProfile({ profile: { id: 'g', presetId: 'groq' }, apiKey: 'k1' });
    await service.saveProfile({ profile: { id: 'g', presetId: 'groq', name: 'Переименован' } });
    expect((await service.getProfileWithKey('g')).apiKey).toBe('k1');
    expect((await service.listProfiles())[0].name).toBe('Переименован');

    await service.saveProfile({ profile: { id: 'g', presetId: 'groq' }, apiKey: '' });
    expect((await service.getProfileWithKey('g')).apiKey).toBeUndefined();
  });

  it('параллельные сохранения не теряют друг друга', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => service.saveProfile({ profile: { id: `p${i}`, presetId: 'lmstudio' } }))
    );
    expect((await service.listProfiles()).map((p) => p.id).sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
  });

  it('удаление и понятные ошибки для отсутствующего профиля', async () => {
    await service.saveProfile({ profile: { id: 'x', presetId: 'jan' } });
    expect(await service.deleteProfile('x')).toBe(true);
    expect(await service.deleteProfile('x')).toBe(false);
    await expect(service.getProfileWithKey('x')).rejects.toThrow(/не найден/);
    await expect(service.getProfileWithKey(undefined)).rejects.toThrow(/не выбран/);
  });

  it('испорченный профиль в файле пропускается, остальные читаются', async () => {
    await fs.writeFile(
      path.join(dir, 'llm-profiles.json'),
      JSON.stringify({ version: 1, profiles: [{ id: 'ok', presetId: 'vllm' }, { id: 'bad', presetId: 'custom' }] })
    );
    expect((await service.listProfiles()).map((p) => p.id)).toEqual(['ok']);
  });

  it('resolveRequestTarget: адрес, заголовки и флаги профиля', async () => {
    await service.saveProfile({ profile: { id: 'oa', presetId: 'openai' }, apiKey: 'k' });
    const target = await service.resolveRequestTarget('oa');
    expect(target.endpoint).toBe('https://api.openai.com/v1/chat/completions');
    expect(target.headers.Authorization).toBe('Bearer k');
    expect(target.compat.maxTokensField).toBe('max_completion_tokens');
  });
});

describe('LlmModelCatalogService (TASK-70.2)', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  it('кэширует список, обновляет по запросу и при ошибке отдаёт прежний список с причиной', async () => {
    await service.saveProfile({ profile: { id: 'o', presetId: 'ollama' } });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'qwen3:8b' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'down' }, 503));
    const catalog = new LlmModelCatalogService(service, path.join(dir, 'catalog.json'), fetchImpl as unknown as typeof fetch);

    const first = await catalog.listModels('o');
    expect(first).toMatchObject({ models: ['qwen3:8b'], cached: false });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/models', expect.objectContaining({ method: 'GET' }));

    const second = await catalog.listModels('o');
    expect(second).toMatchObject({ models: ['qwen3:8b'], cached: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const refreshed = await catalog.listModels('o', { refresh: true });
    expect(refreshed.models).toEqual(['qwen3:8b']);
    expect(refreshed.cached).toBe(true);
    expect(refreshed.error).toMatch(/сервер недоступен \(HTTP 503\): down/);
  });

  it('сервер не запущен — понятная причина вместо «fetch failed» (decision-43)', async () => {
    await service.saveProfile({ profile: { id: 'l', presetId: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11999/v1', local: true } });
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11999'), { code: 'ECONNREFUSED' })
    });
    const catalog = new LlmModelCatalogService(service, path.join(dir, 'catalog.json'), vi.fn().mockRejectedValue(refused) as unknown as typeof fetch);
    const result = await catalog.listModels('l');
    expect(result.models).toEqual([]);
    expect(result.error).toContain('сервер не принимает подключения (ECONNREFUSED)');
    expect(result.error).toContain('Запустите локальный сервер');
    expect(result.error).not.toContain('fetch failed');
  });

  it('смена адреса профиля делает кэш недействительным', async () => {
    await service.saveProfile({ profile: { id: 'c', presetId: 'custom', baseUrl: 'http://localhost:1/v1' } });
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => jsonResponse({ data: [{ id: url.includes(':1/') ? 'a' : 'b' }] }));
    const catalog = new LlmModelCatalogService(service, path.join(dir, 'catalog.json'), fetchImpl as unknown as typeof fetch);

    expect((await catalog.listModels('c')).models).toEqual(['a']);
    await service.saveProfile({ profile: { id: 'c', presetId: 'custom', baseUrl: 'http://localhost:2/v1' } });
    expect((await catalog.listModels('c')).models).toEqual(['b']);
  });

  it('облачный профиль без ключа — ошибка до сетевого запроса', async () => {
    await service.saveProfile({ profile: { id: 'm', presetId: 'mistral' } });
    const fetchImpl = vi.fn();
    const catalog = new LlmModelCatalogService(service, path.join(dir, 'catalog.json'), fetchImpl as unknown as typeof fetch);
    const res = await catalog.listModels('m');
    expect(res.error).toMatch(/API ключ не указан/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

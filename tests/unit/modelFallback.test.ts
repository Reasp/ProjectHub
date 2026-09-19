import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AgentFleetService } from '../../electron/services/agentFleetService';
import { aiAgentService } from '../../electron/services/aiAgentService';
import { llmProfileService } from '../../electron/services/llmProfileService';
import { profileFromPreset } from '../../electron/services/llmProfiles';
import { appEventBus } from '../../electron/services/eventBus';
import { classifyHttpError, classifyNetworkError, parseClaudeCliErrorEvent } from '../../electron/services/providerErrors';
import { emptyModelTierSettings, type ModelTierSettings } from '../../electron/services/modelTiers';
import type { AppBusEvent } from '../../electron/services/hitlTypes';
import type { SwarmSession } from '../../electron/services/swarmTypes';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await wait(10);
  }
}

function tiers(balanced: ModelTierSettings['tiers']['balanced'], cheap: ModelTierSettings['tiers']['cheap'] = [], extra: Partial<ModelTierSettings> = {}): ModelTierSettings {
  return { ...emptyModelTierSettings(), ...extra, tiers: { cheap, balanced, frontier: [] } };
}

const OLLAMA = { ...profileFromPreset('ollama', 'p-ollama', 'Ollama'), hasApiKey: false };
const DEAD = { ...profileFromPreset('ollama', 'p-dead', 'Dead'), baseUrl: 'http://127.0.0.1:11999/v1', hasApiKey: false };

/** Ответы «сервера» по модели: реальные тела Ollama 0.34 и сетевая ошибка Node 22. */
function mockStream(fail: Record<string, 'not_found' | 'refused' | 'auth' | 'rate_limit'>) {
  const seen: string[] = [];
  vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (req, onChunk, onComplete, onError) => {
    const key = `${req.config.profileId ?? req.config.provider}/${req.config.model}`;
    seen.push(key);
    const kind = fail[key];
    const ctx = { provider: req.config.profileId, model: req.config.model, local: true };
    if (kind === 'not_found') {
      const info = classifyHttpError({ status: 404, body: `{"error":{"message":"model '${req.config.model}' not found","type":"not_found_error"}}` }, ctx);
      onError(info.message, info);
      return;
    }
    if (kind === 'refused') {
      const err = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11999'), { code: 'ECONNREFUSED' }) });
      const info = classifyNetworkError(err, ctx)!;
      onError(info.message, info);
      return;
    }
    if (kind === 'auth') {
      const info = classifyHttpError({ status: 401, body: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' }, ctx);
      onError(info.message, info);
      return;
    }
    if (kind === 'rate_limit') {
      const info = classifyHttpError({ status: 429, body: '{"error":{"message":"Rate limit reached","type":"rate_limit_error"}}', headers: { 'retry-after': '1' } }, ctx);
      onError(info.message, info);
      return;
    }
    onChunk({ text: 'Париж' });
    onComplete({ id: 'm', role: 'assistant', content: 'Париж', timestamp: new Date().toISOString() });
  });
  return seen;
}

let busEvents: AppBusEvent[] = [];
let unsubscribe: (() => void) | null = null;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(AgentFleetService.prototype, 'runJudge').mockResolvedValue(null);
  vi.spyOn(aiAgentService, 'getConfig').mockResolvedValue({ provider: 'anthropic', model: '' });
  vi.spyOn(llmProfileService, 'listProfiles').mockResolvedValue([OLLAMA, DEAD]);
  busEvents = [];
  unsubscribe = appEventBus.subscribe((e) => busEvents.push(e));
});

afterEach(() => {
  unsubscribe?.();
});

async function runSlot(fleet: AgentFleetService, slot: Record<string, unknown>): Promise<SwarmSession> {
  const session = await fleet.startFanOut({
    projectPath: 'F:/ProjectHub',
    prompt: 'Столица Франции?',
    useWorktrees: false,
    agents: [{ id: 'a', name: 'A', engine: 'api', ...slot } as never]
  });
  await until(() => !['pending', 'preparing', 'running'].includes(session.agents[0].status));
  return session;
}

describe('fallback-цепочка слота (TASK-79, decision-44)', () => {
  it('model_not_found → выключенный профиль → рабочая модель: 2 переключения, ответ, лог и уведомление', async () => {
    const seen = mockStream({ 'p-ollama/no-such-model:1b': 'not_found', 'p-dead/qwen2.5:7b-instruct': 'refused' });
    const fleet = new AgentFleetService(null);
    fleet.setModelTierSettings(
      tiers([
        { engine: 'api', profile: 'Ollama', model: 'no-such-model:1b' },
        { engine: 'api', profile: 'Dead', model: 'qwen2.5:7b-instruct' },
        { engine: 'api', profile: 'Ollama', model: 'qwen2.5:7b-instruct' }
      ])
    );
    const session = await runSlot(fleet, { modelTier: 'balanced' });
    const agent = session.agents[0];
    expect(agent.status).toBe('completed');
    expect(agent.finalOutput).toBe('Париж');
    expect(agent.liveOutput).toBe('Париж');
    expect(agent.providerError).toBeUndefined();
    expect(seen).toEqual(['p-ollama/no-such-model:1b', 'p-dead/qwen2.5:7b-instruct', 'p-ollama/qwen2.5:7b-instruct']);
    expect(agent.providerInfo).toMatchObject({ profileId: 'p-ollama', model: 'qwen2.5:7b-instruct', local: true });
    expect(agent.modelRouting).toMatchObject({
      requestedTier: 'balanced',
      source: 'tier',
      engine: 'api',
      chainLength: 3,
      current: { engine: 'api', profile: 'Ollama', model: 'qwen2.5:7b-instruct', tier: 'balanced' }
    });
    expect(agent.modelRouting!.switches.map((s) => `${s.kind}/${s.reason ?? ''}:${s.from.model}@${s.from.profile}->${s.to.profile}`)).toEqual([
      'model_not_found/:no-such-model:1b@Ollama->Dead',
      'unavailable/refused:qwen2.5:7b-instruct@Dead->Ollama'
    ]);
    expect(agent.logs.filter((l) => l.includes('🔀 Переключение модели')).length).toBe(2);
    const fallbacks = busEvents.filter((e) => e.type === 'agent:modelFallback');
    expect(fallbacks).toHaveLength(2);
    expect(fallbacks[0]).toMatchObject({ errorKind: 'model_not_found', toModel: 'qwen2.5:7b-instruct · профиль «Dead»' });

    const md = fleet.exportSession(session.id, 'markdown')!;
    expect(md).toContain('Тир модели');
    expect(md).toContain('Переключения модели');
    const json = JSON.parse(fleet.exportSession(session.id, 'json')!);
    expect(json.session.agents[0].modelRouting.switches).toHaveLength(2);
  });

  it('третья неудача — слот падает с причиной «лимит переключений»', async () => {
    mockStream({ 'p-ollama/m1:1b': 'not_found', 'p-ollama/m2:1b': 'not_found', 'p-ollama/m3:1b': 'not_found' });
    const fleet = new AgentFleetService(null);
    fleet.setModelTierSettings(
      tiers([
        { engine: 'api', profile: 'Ollama', model: 'm1:1b' },
        { engine: 'api', profile: 'Ollama', model: 'm2:1b' },
        { engine: 'api', profile: 'Ollama', model: 'm3:1b' },
        { engine: 'api', profile: 'Ollama', model: 'm4:1b' }
      ])
    );
    const agent = (await runSlot(fleet, { modelTier: 'balanced' })).agents[0];
    expect(agent.status).toBe('failed');
    expect(agent.modelRouting!.switches).toHaveLength(2);
    expect(agent.modelRouting!.stopped).toBe('limit');
    expect(agent.providerError).toMatchObject({ kind: 'model_not_found', model: 'm3:1b' });
    expect(agent.error).toContain('исчерпан лимит переключений модели (2)');
  });

  it('auth не переключает: другая модель той же настройки не поможет', async () => {
    const seen = mockStream({ 'anthropic/claude-x': 'auth' });
    const fleet = new AgentFleetService(null);
    fleet.setModelTierSettings(
      tiers([
        { engine: 'api', provider: 'anthropic', model: 'claude-x' },
        { engine: 'api', profile: 'Ollama', model: 'qwen2.5:7b-instruct' }
      ])
    );
    vi.mocked(aiAgentService.getConfig).mockResolvedValue({ provider: 'anthropic', model: 'claude-x', apiKey: 'sk-ant-wrong' });
    const agent = (await runSlot(fleet, { modelTier: 'balanced' })).agents[0];
    expect(seen).toEqual(['anthropic/claude-x']);
    expect(agent.status).toBe('failed');
    expect(agent.providerError?.kind).toBe('auth');
    expect(agent.modelRouting).toMatchObject({ switches: [], stopped: 'not_switchable' });
    expect(busEvents.some((e) => e.type === 'agent:modelFallback')).toBe(false);
  });

  it('явная модель слота — первое звено, тир даёт запасные; спуск в младший тир', async () => {
    const seen = mockStream({ 'p-ollama/mine:1b': 'not_found' });
    const fleet = new AgentFleetService(null);
    fleet.setModelTierSettings(tiers([], [{ engine: 'api', profile: 'Ollama', model: 'llama3.2:3b' }]));
    const agent = (
      await runSlot(fleet, { modelTier: 'balanced', providerConfig: { provider: 'openai-compatible', profileId: 'p-ollama', model: 'mine:1b' } })
    ).agents[0];
    expect(seen).toEqual(['p-ollama/mine:1b', 'p-ollama/llama3.2:3b']);
    expect(agent.status).toBe('completed');
    expect(agent.modelRouting).toMatchObject({ source: 'explicit', current: { model: 'llama3.2:3b', tier: 'cheap' } });
    // Слот хранит id профиля, в отчёте — его имя.
    expect(agent.modelRouting!.switches[0].from).toEqual({ engine: 'api', model: 'mine:1b', profile: 'Ollama' });
  });

  it('без тира — как раньше: одна попытка, без modelRouting; тир без звеньев для движка — пояснение', async () => {
    const seen = mockStream({ 'p-ollama/x:1b': 'not_found' });
    const fleet = new AgentFleetService(null);
    fleet.setModelTierSettings(tiers([{ engine: 'claude-cli', model: 'sonnet' }]));
    const plain = (await runSlot(fleet, { providerConfig: { provider: 'openai-compatible', profileId: 'p-ollama', model: 'x:1b' } })).agents[0];
    expect(plain.status).toBe('failed');
    expect(plain.modelRouting).toBeUndefined();
    expect(seen).toEqual(['p-ollama/x:1b']);

    const noEngine = (await runSlot(fleet, { modelTier: 'balanced', providerConfig: { provider: 'openai-compatible', profileId: 'p-ollama', model: 'qwen2.5:7b-instruct' } })).agents[0];
    // Явная модель есть, но звеньев тира для api нет — цепочка из одной явной модели.
    expect(noEngine.status).toBe('completed');
    expect(noEngine.modelRouting).toMatchObject({ source: 'explicit', chainLength: 1 });

    const empty = (await runSlot(fleet, { modelTier: 'frontier' })).agents[0];
    expect(empty.modelRouting).toMatchObject({ source: 'default', chainLength: 0 });
    expect(empty.logs.some((l) => l.includes('тир «frontier» для движка api не настроен'))).toBe(true);
  });

  it('rate_limit: ждёт Retry-After (не дольше maxWaitMs), остановка агента прерывает ожидание', async () => {
    mockStream({ 'p-ollama/busy:1b': 'rate_limit' });
    const fleet = new AgentFleetService(null);
    fleet.setModelTierSettings(
      tiers([
        { engine: 'api', profile: 'Ollama', model: 'busy:1b' },
        { engine: 'api', profile: 'Ollama', model: 'qwen2.5:7b-instruct' }
      ], [], { maxWaitMs: 400 })
    );
    const started = Date.now();
    const agent = (await runSlot(fleet, { modelTier: 'balanced' })).agents[0];
    expect(agent.status).toBe('completed');
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    expect(agent.modelRouting!.switches[0]).toMatchObject({ kind: 'rate_limit', waitedMs: 400 });
  });
});

describe('живой HTTP-сервер: 429 с Retry-After через настоящий aiAgentService (TASK-79)', () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];

  beforeEach(async () => {
    hits.length = 0;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const model = (JSON.parse(body || '{}') as { model?: string }).model ?? '';
        hits.push(`${req.url} ${model}`);
        if (model === 'limited') {
          res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
          res.end('{"error":{"message":"Rate limit reached for requests","type":"requests","code":"rate_limit_exceeded"}}');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Париж' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    const stub = { ...profileFromPreset('custom', 'p-stub', 'Stub'), baseUrl: `http://127.0.0.1:${port}/v1`, local: true, hasApiKey: false };
    vi.mocked(llmProfileService.listProfiles).mockResolvedValue([stub]);
    vi.spyOn(llmProfileService, 'getProfileWithKey').mockResolvedValue({ profile: stub, apiKey: undefined } as never);
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('первое звено отвечает 429 Retry-After: 1 → ожидание 1 с → второе звено отвечает', async () => {
    const fleet = new AgentFleetService(null);
    fleet.setModelTierSettings(
      tiers([
        { engine: 'api', profile: 'Stub', model: 'limited' },
        { engine: 'api', profile: 'Stub', model: 'ok-model' }
      ])
    );
    const started = Date.now();
    const agent = (await runSlot(fleet, { modelTier: 'balanced' })).agents[0];
    expect(agent.status, agent.error).toBe('completed');
    expect(agent.finalOutput).toBe('Париж');
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(hits).toEqual(['/v1/chat/completions limited', '/v1/chat/completions ok-model']);
    expect(agent.modelRouting!.switches[0]).toMatchObject({ kind: 'rate_limit', status: 429, waitedMs: 1000, from: { model: 'limited' }, to: { model: 'ok-model' } });
  }, 10_000);
});

/**
 * Фейковый `claude` в начале PATH (spawn с shell: true ищет только в PATH): на `--model no-such-model-xyz`
 * отвечает теми же событиями, что настоящий Claude CLI 2.1.275, на остальные модели — ответом.
 */
const FAKE_CLAUDE = `
const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1] || 'default';
require('node:fs').appendFileSync(require('node:path').join(__dirname, 'calls.txt'), model + '\\n');
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
process.stdin.resume();
process.stdin.on('end', () => {
  out({ type: 'system', subtype: 'init', session_id: 's-1' });
  if (model === 'no-such-model-xyz') {
    out({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: "There's an issue with the selected model (no-such-model-xyz). It may not exist or you may not have access to it." }] }, session_id: 's-1', error: 'model_not_found', is_api_error_message: true });
    out({ type: 'result', subtype: 'success', is_error: true, api_error_status: 404, terminal_reason: 'api_error', num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, result: "There's an issue with the selected model (no-such-model-xyz).", session_id: 's-1' });
  } else {
    out({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'Париж' }], usage: { input_tokens: 10, output_tokens: 2 } }, session_id: 's-1' });
    out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 2 }, result: 'Париж', session_id: 's-1' });
  }
  process.exit(0);
});
`;

describe.runIf(process.platform === 'win32')('Claude CLI: API-ошибка из stream-json и перезапуск с --model (TASK-79)', () => {
  const originalPath = process.env.PATH;
  let dir = '';

  beforeEach(async () => {
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ph-fake-claude-'));
    await fsp.writeFile(path.join(dir, 'claude.cjs'), FAKE_CLAUDE);
    await fsp.writeFile(path.join(dir, 'claude.cmd'), `@"${process.execPath}" "${path.join(dir, 'claude.cjs')}" %*\r\n`);
    process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
    vi.spyOn(AgentFleetService.prototype as never, 'prepareAgentHitl').mockResolvedValue({ args: [], env: {}, cleanup: () => undefined } as never);
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    const fsp = await import('node:fs/promises');
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  async function runCli(fleet: AgentFleetService, slot: Record<string, unknown>): Promise<SwarmSession> {
    const session = await fleet.startFanOut({
      projectPath: 'F:/ProjectHub',
      prompt: 'Столица Франции?',
      useWorktrees: false,
      agents: [{ id: 'c', name: 'C', engine: 'claude-cli', ...slot } as never]
    });
    await until(() => !['pending', 'preparing', 'running'].includes(session.agents[0].status), 20_000);
    return session;
  }

  it('несуществующая модель без тира — failed с model_not_found, а не completed с текстом ошибки', async () => {
    const fleet = new AgentFleetService(null);
    const agent = (await runCli(fleet, { providerConfig: { model: 'no-such-model-xyz' } })).agents[0];
    expect(agent.status).toBe('failed');
    expect(agent.providerError).toMatchObject({ kind: 'model_not_found', status: 404, provider: 'Claude CLI', model: 'no-such-model-xyz' });
    expect(agent.liveOutput).not.toContain("There's an issue");
    expect(agent.logs.some((l) => l.includes('Claude CLI: ошибка API (model_not_found)'))).toBe(true);
  }, 30_000);

  it('тир: первое звено не найдено → перезапуск хода с --model следующего звена', async () => {
    const fleet = new AgentFleetService(null);
    fleet.setModelTierSettings(
      tiers([
        { engine: 'claude-cli', model: 'no-such-model-xyz' },
        { engine: 'claude-cli', model: 'sonnet' }
      ])
    );
    const agent = (await runCli(fleet, { modelTier: 'balanced' })).agents[0];
    expect(agent.status, agent.error).toBe('completed');
    expect(agent.finalOutput).toBe('Париж');
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');
    expect((await fsp.readFile(path.join(dir, 'calls.txt'), 'utf-8')).trim().split(/\r?\n/)).toEqual(['no-such-model-xyz', 'sonnet']);
    expect(agent.modelRouting).toMatchObject({ source: 'tier', current: { engine: 'claude-cli', model: 'sonnet' } });
    expect(agent.modelRouting!.switches[0]).toMatchObject({ kind: 'model_not_found', from: { model: 'no-such-model-xyz' }, to: { model: 'sonnet' } });
  }, 30_000);
});

describe('parseClaudeCliErrorEvent — события stream-json Claude CLI 2.1.275', () => {
  it('assistant с error, result с api_error_status, rate_limit_event rejected', () => {
    // Сняты вживую: `claude -p --model no-such-model-xyz --output-format stream-json --verbose`.
    const assistant = {
      type: 'assistant',
      message: { model: '<synthetic>', content: [{ type: 'text', text: "There's an issue with the selected model (no-such-model-xyz). It may not exist or you may not have access to it." }] },
      error: 'model_not_found',
      is_api_error_message: true
    };
    expect(parseClaudeCliErrorEvent(assistant)).toEqual({ errorType: 'model_not_found', message: expect.stringContaining('no-such-model-xyz') });
    const result = { type: 'result', subtype: 'success', is_error: true, api_error_status: 404, terminal_reason: 'api_error', result: 'x' };
    expect(parseClaudeCliErrorEvent(result)).toEqual({ status: 404, message: 'x' });
    expect(parseClaudeCliErrorEvent({ type: 'result', subtype: 'success', is_error: false, result: 'ok' })).toBeUndefined();
    expect(parseClaudeCliErrorEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })).toBeUndefined();
    const now = 1_790_000_000_000;
    expect(parseClaudeCliErrorEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: now / 1000 + 12 } }, now)).toEqual({ retryAfterMs: 12_000 });
    expect(parseClaudeCliErrorEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1790042400 } }, now)).toBeUndefined();
  });
});

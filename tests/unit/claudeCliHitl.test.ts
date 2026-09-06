import { afterEach, describe, expect, it, vi } from 'vitest';

// claudeBridgeService тянет electron через secretStorageService/processManager — подменяем модуль.
vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  },
  BrowserWindow: { getAllWindows: () => [] }
}));

const { buildCliPermissionSettings, claudeBridgeService } = await import('../../electron/services/claudeBridgeService');
type ApprovalRequest = import('../../electron/services/claudeBridgeService').ApprovalRequest;
type ClaudeBridgeMessageChunk = import('../../electron/services/claudeBridgeService').ClaudeBridgeMessageChunk;
type AIProviderConfig = import('../../electron/services/aiAgentService').AIProviderConfig;
type AutoApproveRules = import('../../electron/services/aiAgentService').AutoApproveRules;

const PROJECT = process.cwd();

const RULES: AutoApproveRules = {
  enabled: true,
  allowCommands: true,
  allowFileWrite: true,
  allowFileRead: true,
  allowSubagents: true,
  writeExcludePatterns: ['.env*', '**/*.key'],
  readExcludePatterns: ['**/*.pem'],
  commandDenyList: ['rm -rf', 'git push']
};

const cfg = (autoApprove: boolean, rules: Partial<AutoApproveRules> = {}): AIProviderConfig => ({
  provider: 'anthropic',
  model: 'default',
  autoApprove,
  autoApproveRules: { ...RULES, ...rules }
});

/** Регистрирует сессию и собирает карточки одобрения, которые она отправила бы в рендерер. */
function session(id: string, config: AIProviderConfig, approvals: ApprovalRequest[] = []) {
  claudeBridgeService.registerCliPermissionContext(id, PROJECT, config, (chunk: ClaudeBridgeMessageChunk) => {
    if (chunk.approvalRequest) approvals.push(chunk.approvalRequest);
  });
  return approvals;
}

async function waitFor(approvals: ApprovalRequest[], count: number) {
  for (let i = 0; i < 100 && approvals.length < count; i++) await new Promise((r) => setTimeout(r, 5));
  expect(approvals.length).toBeGreaterThanOrEqual(count);
}

/** Ждёт появления карточки и отвечает на неё от имени пользователя. */
async function answer(approvals: ApprovalRequest[], response: { approved: boolean; text?: string }) {
  await waitFor(approvals, 1);
  const req = approvals[approvals.length - 1];
  expect(claudeBridgeService.sendApprovalResponse(req.id, response)).toBe(true);
  return req;
}

afterEach(() => {
  claudeBridgeService.killAll();
  claudeBridgeService.removeAllListeners();
});

describe('handleCliPermissionRequest (TASK-42, аудит 5.3)', () => {
  it('неизвестная сессия — deny без карточки', async () => {
    const res = await claudeBridgeService.handleCliPermissionRequest('nope', { tool_name: 'Bash', input: { command: 'ls' } });
    expect(res.behavior).toBe('deny');
    expect(claudeBridgeService.getPendingApprovalIds()).toEqual([]);
  });

  it('autoApprove=false: Bash ждёт решения пользователя, allow возвращает исходный вход', async () => {
    const approvals = session('cli', cfg(false));
    const input = { command: 'npm test', description: 'Запуск тестов' };
    const p = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Bash', input });
    const req = await answer(approvals, { approved: true });
    expect(req.type).toBe('command');
    expect(req.command).toBe('npm test');
    expect(req.details).toBe('Запуск тестов');
    await expect(p).resolves.toEqual({ behavior: 'allow', updatedInput: input });
    expect(claudeBridgeService.getPendingApprovalIds('cli')).toEqual([]);
  });

  it('autoApprove=false: отказ пользователя с комментарием уходит в CLI как deny с текстом', async () => {
    const approvals = session('cli', cfg(false));
    const p = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Bash', input: { command: 'npm test' } });
    await answer(approvals, { approved: false, text: 'сначала линтер' });
    const res = await p;
    expect(res.behavior).toBe('deny');
    expect(res.behavior === 'deny' && res.message).toContain('сначала линтер');
  });

  it('autoApprove=true: обычные команда и запись разрешаются без карточек', async () => {
    const approvals = session('cli', cfg(true));
    const bash = await claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Bash', input: { command: 'npm test' } });
    const edit = await claudeBridgeService.handleCliPermissionRequest('cli', {
      tool_name: 'Edit',
      input: { file_path: 'src/index.ts', old_string: 'a', new_string: 'b' }
    });
    expect(bash.behavior).toBe('allow');
    expect(edit.behavior).toBe('allow');
    expect(approvals).toEqual([]);
    expect(claudeBridgeService.getPendingApprovalIds()).toEqual([]);
  });

  it('autoApprove=true: команда из deny-list требует подтверждения до выполнения', async () => {
    const approvals = session('cli', cfg(true));
    const p = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Bash', input: { command: 'git push origin main' } });
    const req = await answer(approvals, { approved: false });
    expect(req.title).toContain('Заблокированная команда');
    expect((await p).behavior).toBe('deny');
  });

  it('autoApprove=true: запись в файл из списка исключений требует подтверждения и несёт диф', async () => {
    const approvals = session('cli', cfg(true));
    const p = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Write', input: { file_path: '.env.local', content: 'X=1' } });
    const req = await answer(approvals, { approved: true });
    expect(req.type).toBe('file_write');
    expect(req.title).toContain('исключений');
    expect(req.diff?.newContent).toBe('X=1');
    expect((await p).behavior).toBe('allow');
  });

  it('allowCommands=false и allowFileWrite=false при autoApprove=true — спрашивают', async () => {
    const approvals = session('cli', cfg(true, { allowCommands: false, allowFileWrite: false }));
    const p1 = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Bash', input: { command: 'ls' } });
    await answer(approvals, { approved: true });
    await expect(p1).resolves.toMatchObject({ behavior: 'allow' });
    const p2 = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Write', input: { file_path: 'a.txt', content: '' } });
    await waitFor(approvals, 2);
    claudeBridgeService.sendApprovalResponse(approvals[1].id, { approved: false });
    await expect(p2).resolves.toMatchObject({ behavior: 'deny' });
    expect(approvals).toHaveLength(2);
  });

  it('запись вне корня проекта отклоняется сразу даже при autoApprove=true', async () => {
    const approvals = session('cli', cfg(true));
    const res = await claudeBridgeService.handleCliPermissionRequest('cli', {
      tool_name: 'Write',
      input: { file_path: '../outside.txt', content: 'x' }
    });
    expect(res.behavior).toBe('deny');
    expect(res.behavior === 'deny' && res.message).toContain('вне корня проекта');
    expect(approvals).toEqual([]);
  });

  it('чтение: обычный файл разрешается, защищённый — вопрос allow/deny', async () => {
    const approvals = session('cli', cfg(false));
    const ok = await claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Read', input: { file_path: 'src/index.ts' } });
    expect(ok.behavior).toBe('allow');
    expect(approvals).toEqual([]);

    const p = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Read', input: { file_path: 'certs/server.pem' } });
    const req = await answer(approvals, { approved: true, text: 'Запретить чтение' });
    expect(req.type).toBe('question');
    expect(req.questionData?.options.map((o) => o.id)).toEqual(['allow', 'deny']);
    expect((await p).behavior).toBe('deny');
  });

  it('AskUserQuestion: по карточке на вопрос, ответы возвращаются в updatedInput.answers', async () => {
    const approvals = session('cli', cfg(true));
    const input = {
      questions: [
        {
          question: 'Какой формат?',
          header: 'Формат',
          options: [{ label: 'Кратко', description: 'a' }, { label: 'Подробно', description: 'b' }],
          multiSelect: false
        },
        { question: 'Какие разделы?', header: 'Разделы', options: [{ label: 'Введение' }, { label: 'Вывод' }], multiSelect: true }
      ]
    };
    const p = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'AskUserQuestion', input });
    const q1 = await answer(approvals, { approved: true, text: 'Кратко' });
    expect(q1.type).toBe('question');
    expect(q1.questionData?.subtitle).toBe('Какой формат?');
    expect(q1.questionData?.options.map((o) => o.label)).toEqual(['Кратко', 'Подробно']);
    // Вторая карточка: ответ «Other: …» уходит в CLI как свободный текст без префикса
    await waitFor(approvals, 2);
    expect(approvals[1].questionData?.isMultiSelect).toBe(true);
    claudeBridgeService.sendApprovalResponse(approvals[1].id, { approved: true, text: 'Other: только выводы' });
    await expect(p).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { questions: input.questions, answers: { 'Какой формат?': 'Кратко', 'Какие разделы?': 'только выводы' } }
    });
  });

  it('AskUserQuestion: закрытие карточки — deny', async () => {
    const approvals = session('cli', cfg(true));
    const p = claudeBridgeService.handleCliPermissionRequest('cli', {
      tool_name: 'AskUserQuestion',
      input: { questions: [{ question: 'Q?', options: [{ label: 'A' }, { label: 'B' }] }] }
    });
    await answer(approvals, { approved: false });
    expect((await p).behavior).toBe('deny');
  });

  it('подагенты: спрашивает только при allowSubagents=false', async () => {
    const approvals = session('cli', cfg(false));
    const free = await claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Agent', input: { description: 'x', prompt: 'y' } });
    expect(free.behavior).toBe('allow');

    session('cli', cfg(true, { allowSubagents: false }), approvals);
    const p = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Agent', input: { description: 'Поиск', prompt: 'найди' } });
    const req = await answer(approvals, { approved: true });
    expect(req.type).toBe('subagent_dispatch');
    expect((await p).behavior).toBe('allow');
  });

  it('прочие инструменты: allow при autoApprove, иначе общая карточка', async () => {
    const approvals = session('cli', cfg(true));
    const auto = await claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'WebFetch', input: { url: 'https://x' } });
    expect(auto.behavior).toBe('allow');

    session('cli', cfg(false), approvals);
    const p = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'WebFetch', input: { url: 'https://x' } });
    const req = await answer(approvals, { approved: true });
    expect(req.title).toContain('WebFetch');
    expect((await p).behavior).toBe('allow');
  });

  it('abortSession во время ожидания — deny, а не зависший запрос', async () => {
    const approvals = session('cli', cfg(false));
    (claudeBridgeService as any).activeSessions.set('cli', PROJECT);
    const p = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Bash', input: { command: 'ls' } });
    await waitFor(approvals, 1);
    expect(claudeBridgeService.getProjectStatus(PROJECT).status).toBe('waiting_approval');
    claudeBridgeService.abortSession('cli');
    const res = await p;
    expect(res.behavior).toBe('deny');
    expect(res.behavior === 'deny' && res.message).toContain('прервана');
  });

  it('после ответа статус проекта возвращается в running, если сессия ещё активна', async () => {
    const approvals = session('cli', cfg(false));
    (claudeBridgeService as any).activeSessions.set('cli', PROJECT);
    const p = claudeBridgeService.handleCliPermissionRequest('cli', { tool_name: 'Bash', input: { command: 'ls' } });
    await answer(approvals, { approved: true });
    await p;
    expect(claudeBridgeService.getProjectStatus(PROJECT).status).toBe('running');
  });

  it('killAll забывает контексты сессий CLI', async () => {
    session('cli', cfg(true));
    expect(claudeBridgeService.hasCliPermissionContext('cli')).toBe(true);
    claudeBridgeService.killAll();
    expect(claudeBridgeService.hasCliPermissionContext('cli')).toBe(false);
  });
});

describe('buildCliPermissionSettings', () => {
  it('autoApprove=false: ask на команды и запись плюс правила из списков', () => {
    const ask = buildCliPermissionSettings(cfg(false))!.permissions.ask;
    expect(ask).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']));
    expect(ask).toEqual(expect.arrayContaining(['Bash(rm -rf*)', 'Bash(git push*)']));
    expect(ask).toEqual(expect.arrayContaining(['Edit(./.env*)', 'Edit(**/.env*)', 'Write(**/*.key)', 'Read(**/*.pem)']));
    expect(ask).not.toContain('Agent');
    expect(ask).not.toContain('Read');
  });

  it('autoApprove=true: только правила-исключения, без общих ask', () => {
    const ask = buildCliPermissionSettings(cfg(true))!.permissions.ask;
    expect(ask).not.toContain('Bash');
    expect(ask).not.toContain('Write');
    expect(ask).toContain('Bash(git push*)');
    expect(ask).toContain('Read(**/*.pem)');
  });

  it('флаги allow*=false добавляют ask на соответствующие инструменты', () => {
    const ask = buildCliPermissionSettings(cfg(true, { allowCommands: false, allowFileRead: false, allowSubagents: false }))!.permissions.ask;
    expect(ask).toEqual(expect.arrayContaining(['Bash', 'Read', 'Agent', 'Task']));
  });

  it('без правил и при autoApprove=true — null', () => {
    expect(buildCliPermissionSettings({ provider: 'anthropic', model: 'default', autoApprove: true })).toBeNull();
  });
});

describe('isPathExcluded (шаблоны списков исключений)', () => {
  const ex = (p: string, patterns: string[]) => claudeBridgeService.isPathExcluded(p, patterns);

  it('понимает шаблоны по умолчанию, включая **/*.ext', () => {
    const defaults = ['.env*', '**/*.key', '**/*.pem', 'infra.config.json'];
    expect(ex('.env.local', defaults)).toBe(true);
    expect(ex('config/.env', defaults)).toBe(true);
    expect(ex('certs/server.pem', defaults)).toBe(true);
    expect(ex('F:\proj\keys\id.key', defaults)).toBe(true);
    expect(ex('infra.config.json', defaults)).toBe(true);
    expect(ex('src/infra.config.json', defaults)).toBe(true);
    expect(ex('src/index.ts', defaults)).toBe(false);
    expect(ex('environment.ts', defaults)).toBe(false);
  });

  it('поддерживает ./, подстроки и пустые списки', () => {
    expect(ex('secrets/a.txt', ['./secrets/a.txt'])).toBe(true);
    expect(ex('a/secret-file.txt', ['*secret*'])).toBe(true);
    expect(ex('a.txt', [])).toBe(false);
    expect(ex('', ['*'])).toBe(false);
  });
});

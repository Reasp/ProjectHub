import { describe, expect, it } from 'vitest';
import { hookEnvSnippets, inferSyncOptions } from '../../src/components/ai/roles/roleSyncView';
import type { RoleSyncFile } from '../../src/types/electron';

const GEN = '# projecthub:generated role=x hash=0123456789abcdef\n';

function file(over: Partial<RoleSyncFile>): RoleSyncFile {
  return { relPath: 'x', kind: 'agent', action: 'create', desired: '', current: null, notes: [], ...over };
}

describe('inferSyncOptions', () => {
  it('несинхронизированный проект — Claude Code с хуками', () => {
    expect(inferSyncOptions({ files: [file({ target: 'claude' }), file({ target: 'codex', current: 'чужой' })] })).toEqual({ targets: ['claude'], hooks: true });
  });

  it('берёт движки и хуки из сгенерированных файлов', () => {
    expect(inferSyncOptions({ files: [file({ target: 'codex', current: GEN })] })).toEqual({ targets: ['codex'], hooks: false });
    expect(
      inferSyncOptions({ files: [file({ target: 'claude', current: GEN }), file({ target: 'codex', current: GEN }), file({ kind: 'hookScript', current: `// ${GEN.slice(2)}` })] })
    ).toEqual({ targets: ['claude', 'codex'], hooks: true });
    expect(inferSyncOptions({ files: [file({ kind: 'hookScript', current: GEN })] })).toEqual({ targets: ['claude'], hooks: true });
  });

  it('Antigravity: по агентам или по нашей группе в .agents/hooks.json (маркера у слитого файла нет)', () => {
    expect(inferSyncOptions({ files: [file({ target: 'antigravity', current: GEN })] })).toEqual({ targets: ['antigravity'], hooks: false });
    const hooksJson = file({ kind: 'hookSettings', target: 'antigravity', current: '{"projecthub":{"Stop":[{"command":"node ../.projecthub/hooks/projecthub-hook.mjs antigravity Stop"}]}}' });
    expect(inferSyncOptions({ files: [file({ kind: 'hookScript', current: GEN }), hooksJson] })).toEqual({ targets: ['antigravity'], hooks: true });
    const foreignHooks = file({ kind: 'hookSettings', target: 'antigravity', current: '{"probe":{}}' });
    expect(inferSyncOptions({ files: [file({ target: 'claude', current: GEN }), foreignHooks] })).toEqual({ targets: ['claude'], hooks: false });
  });
});

describe('hookEnvSnippets', () => {
  it('PowerShell и bash с адресом по умолчанию', () => {
    expect(hookEnvSnippets({ url: null, token: 'ph_hook_t', failMode: 'closed' })).toEqual({
      powershell: '$env:PROJECTHUB_HOOK_URL = "http://127.0.0.1:42042"; $env:PROJECTHUB_HOOK_TOKEN = "ph_hook_t"; $env:PROJECTHUB_HOOK_FAIL_MODE = "closed"',
      bash: 'export PROJECTHUB_HOOK_URL="http://127.0.0.1:42042" PROJECTHUB_HOOK_TOKEN="ph_hook_t" PROJECTHUB_HOOK_FAIL_MODE="closed"'
    });
  });
});

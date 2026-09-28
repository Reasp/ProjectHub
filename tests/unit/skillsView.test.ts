import { describe, expect, it } from 'vitest';
import { copyBlocked, entryCopyActions, importPlan } from '../../src/components/ai/roles/skillsView';
import type { SkillCopy, SkillEntry, SkillImportItem, SkillRoot } from '../../src/types/electron';

function copy(root: SkillRoot, extra: Partial<SkillCopy> = {}): SkillCopy {
  return { root, id: 'demo', files: [], hash: `h-${root}`, totalBytes: 0, problems: [], skillMd: '', ...extra };
}

function entry(status: SkillEntry['status'], copies: SkillEntry['copies']): SkillEntry {
  return { id: 'demo', status, copies };
}

function item(actions: SkillImportItem['actions']): SkillImportItem {
  return { id: 'demo', from: 'claude', problems: [], sourceDiverged: false, actions };
}

describe('skillsView', () => {
  it('copyBlocked: нет копии, нет хэша, блокирующие проблемы', () => {
    expect(copyBlocked(undefined)).toBe(true);
    expect(copyBlocked(copy('claude'))).toBe(false);
    expect(copyBlocked(copy('claude', { hash: '' }))).toBe(true);
    expect(copyBlocked(copy('claude', { problems: ['symlinks'] }))).toBe(true);
    expect(copyBlocked(copy('claude', { problems: ['noDescription'] }))).toBe(false);
  });

  it('entryCopyActions по статусу', () => {
    expect(entryCopyActions(entry('synced', { claude: copy('claude'), agents: copy('agents') }))).toEqual([]);
    expect(entryCopyActions(entry('claudeOnly', { claude: copy('claude') }))).toEqual([{ from: 'claude', to: 'agents', overwrite: false }]);
    expect(entryCopyActions(entry('agentsOnly', { agents: copy('agents') }))).toEqual([{ from: 'agents', to: 'claude', overwrite: false }]);
    expect(entryCopyActions(entry('diverged', { claude: copy('claude'), agents: copy('agents') }))).toEqual([
      { from: 'claude', to: 'agents', overwrite: true },
      { from: 'agents', to: 'claude', overwrite: true }
    ]);
    expect(entryCopyActions(entry('diverged', { claude: copy('claude', { problems: ['tooLarge'], hash: '' }), agents: copy('agents') }))).toEqual([
      { from: 'agents', to: 'claude', overwrite: true }
    ]);
  });

  it('importPlan: только выбранные корни, без неизменных, перезапись отдельно', () => {
    expect(importPlan(item({ claude: 'create', agents: 'overwrite' }), ['claude', 'agents'])).toEqual({ roots: ['claude', 'agents'], overwrite: ['agents'] });
    expect(importPlan(item({ claude: 'unchanged', agents: 'create' }), ['claude'])).toEqual({ roots: [], overwrite: [] });
    expect(importPlan(item({ claude: 'overwrite', agents: 'create' }), ['agents', 'claude'])).toEqual({ roots: ['claude', 'agents'], overwrite: ['claude'] });
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildSkillCatalog,
  diffSkillFiles,
  hashSkillFileContent,
  hashSkillFiles,
  parseSkillMd,
  skillCopyAction,
  skillCopyBlocker,
  summarizeSkillCatalog,
  validateSkillId,
  type SkillCopy,
  type SkillFileEntry,
  type SkillRoot
} from '../../electron/services/skillCatalog';

const file = (relPath: string, content: string): SkillFileEntry => ({ relPath, size: content.length, hash: hashSkillFileContent(Buffer.from(content)) });

function copy(root: SkillRoot, id: string, files: SkillFileEntry[], extra: Partial<SkillCopy> = {}): SkillCopy {
  return { root, id, files, hash: hashSkillFiles(files), totalBytes: 0, problems: [], skillMd: null, ...extra };
}

describe('skillCatalog', () => {
  it('validateSkillId: один-два сегмента, без обхода каталогов и служебных имён', () => {
    expect(validateSkillId('init-dev-project')).toBeNull();
    expect(validateSkillId('gitnexus/gitnexus-cli')).toBeNull();
    expect(validateSkillId('Skill_1.v2')).toBeNull();
    for (const bad of ['', '..', '../x', 'a/../b', 'a\\b', '.hidden', 'a/b/c', 'node_modules', 'x.', 'C:', 'a b', 42]) {
      expect(validateSkillId(bad), String(bad)).not.toBeNull();
    }
  });

  it('хэш текста не зависит от окончаний строк, бинарный файл — побайтно', () => {
    expect(hashSkillFileContent(Buffer.from('a\r\nb\r\n'))).toBe(hashSkillFileContent(Buffer.from('a\nb\n')));
    expect(hashSkillFileContent(Buffer.from('a\nb'))).not.toBe(hashSkillFileContent(Buffer.from('a\nc')));
    const bin1 = Buffer.from([0, 1, 13, 10]);
    const bin2 = Buffer.from([0, 1, 10]);
    expect(hashSkillFileContent(bin1)).not.toBe(hashSkillFileContent(bin2));
  });

  it('хэш скилла не зависит от порядка файлов, но зависит от путей', () => {
    const a = file('SKILL.md', 'x');
    const b = file('refs/a.md', 'y');
    expect(hashSkillFiles([a, b])).toBe(hashSkillFiles([b, a]));
    expect(hashSkillFiles([a, { ...b, relPath: 'refs/b.md' }])).not.toBe(hashSkillFiles([a, b]));
  });

  it('parseSkillMd: name/description и проблемы формата', () => {
    const ok = parseSkillMd('---\nname: demo\ndescription: "Use when"\n---\n# Demo\n', 'demo');
    expect(ok).toEqual({ name: 'demo', description: 'Use when', problems: [] });
    expect(parseSkillMd(null, 'demo').problems).toEqual(['noSkillMd']);
    expect(parseSkillMd('# без frontmatter\n', 'demo').problems).toEqual(['noName', 'noDescription']);
    expect(parseSkillMd('---\nname: other\ndescription: d\n---\n', 'demo').problems).toEqual(['nameMismatch']);
    expect(parseSkillMd('---\nname: [unclosed\n---\n', 'demo').problems).toEqual(['badFrontmatter']);
    // Дата в YAML — объект Date; в метаданные уходит строка (правило 16).
    expect(parseSkillMd('---\nname: demo\ndescription: 2026-09-03\n---\n', 'demo').description).toBe('2026-09-03');
  });

  it('diffSkillFiles: одинаковые, изменённые и файлы только в одной копии', () => {
    const diff = diffSkillFiles([file('SKILL.md', 'a'), file('only-c.md', 'c'), file('same.md', 's')], [file('SKILL.md', 'b'), file('only-a.md', 'a'), file('same.md', 's')]);
    expect(diff).toEqual([
      { relPath: 'SKILL.md', state: 'changed' },
      { relPath: 'only-a.md', state: 'onlyAgents' },
      { relPath: 'only-c.md', state: 'onlyClaude' },
      { relPath: 'same.md', state: 'same' }
    ]);
  });

  it('buildSkillCatalog: статусы и сводка', () => {
    const same = [file('SKILL.md', 'same')];
    const entries = buildSkillCatalog([
      copy('claude', 'b-synced', same, { name: 'b-synced' }),
      copy('agents', 'b-synced', same),
      copy('claude', 'a-diverged', [file('SKILL.md', 'v1')]),
      copy('agents', 'a-diverged', [file('SKILL.md', 'v2')], { name: 'from-agents' }),
      copy('claude', 'c-claude', same, { problems: ['noDescription'] }),
      copy('agents', 'd-agents', same)
    ]);
    expect(entries.map((e) => [e.id, e.status])).toEqual([
      ['a-diverged', 'diverged'],
      ['b-synced', 'synced'],
      ['c-claude', 'claudeOnly'],
      ['d-agents', 'agentsOnly']
    ]);
    expect(entries[0].fileDiff).toEqual([{ relPath: 'SKILL.md', state: 'changed' }]);
    expect(entries[0].name).toBeUndefined();
    expect(entries[1].name).toBe('b-synced');
    expect(entries[2].fileDiff).toBeUndefined();
    expect(summarizeSkillCatalog(entries)).toEqual({ total: 4, synced: 1, diverged: 1, claudeOnly: 1, agentsOnly: 1, withProblems: 1 });
  });

  it('слишком большие копии не считаются одинаковыми', () => {
    const entries = buildSkillCatalog([copy('claude', 'big', [], { hash: '' }), copy('agents', 'big', [], { hash: '' })]);
    expect(entries[0].status).toBe('diverged');
  });

  it('skillCopyAction и skillCopyBlocker', () => {
    const src = copy('claude', 's', [file('SKILL.md', 'x')]);
    expect(skillCopyAction(src, undefined)).toBe('create');
    expect(skillCopyAction(src, copy('agents', 's', [file('SKILL.md', 'x')]))).toBe('unchanged');
    expect(skillCopyAction(src, copy('agents', 's', [file('SKILL.md', 'y')]))).toBe('overwrite');
    expect(skillCopyBlocker(src)).toBeNull();
    expect(skillCopyBlocker({ ...src, problems: ['tooLarge'], hash: '' })).toMatch(/больше/);
    expect(skillCopyBlocker({ ...src, problems: ['symlinks'] })).toMatch(/ссылки/);
    expect(skillCopyBlocker({ ...src, problems: ['noSkillMd'] })).toMatch(/SKILL\.md/);
    // Проблемы формата не мешают копированию.
    expect(skillCopyBlocker({ ...src, problems: ['noDescription', 'nameMismatch'] })).toBeNull();
  });
});

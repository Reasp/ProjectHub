import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  globToRegExp,
  isEnvFile,
  maskSecretsInPatch,
  matchesAnyGlob,
  scanDiffForSecrets,
  summarizeSecretFindings,
  unquoteGitPath
} from '../../electron/services/diffSecretScan';

/** Скан диффа на секреты (TASK-73.1, decision-56 п. 3). Патч — настоящий `git diff --cached` (git 2.x, Windows). */

const patch = readFileSync(path.join(__dirname, 'fixtures', 'security', 'git-diff-cached.patch'), 'utf8');
const cyrillicFile = 'src/настройки бота.yml';

describe('scanDiffForSecrets на настоящем staged-диффе', () => {
  it('находит ключи только в добавленных строках, с файлом и номером строки', () => {
    const result = scanDiffForSecrets(patch);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        { kind: 'env_file', file: '.env' },
        { kind: 'assigned_secret', file: '.env', line: 1 },
        { kind: 'provider_key', file: 'src/config.ts', line: 2 },
        { kind: 'github_token', file: 'src/config.ts', line: 4 },
        { kind: 'telegram_token', file: cyrillicFile, line: 1 },
        { kind: 'aws_key', file: 'tests/fixtures/keys.ts', line: 1 }
      ])
    );
    // удалённый OLD_KEY (строка «-») не находится; .env.example с заглушкой — не env_file и не секрет
    expect(result.findings.filter((f) => f.file === 'src/config.ts' && f.kind === 'provider_key')).toHaveLength(1);
    expect(result.findings.some((f) => f.file === '.env.example')).toBe(false);
    expect(result.findings.some((f) => f.file === 'logo.png' || f.file === 'README.md')).toBe(false);
    expect(result.suppressed).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.filesScanned).toBe(7);
  });

  it('значение секрета не попадает в находки', () => {
    const json = JSON.stringify(scanDiffForSecrets(patch));
    expect(json).not.toContain('AbCdEf0123456789');
    expect(json).not.toContain('AAHdqTcvCH1');
  });

  it('маркер projecthub:allow-secret снимает находку только для изменений человека', () => {
    const human = scanDiffForSecrets(patch, { honorInlineMarker: true });
    expect(human.findings.some((f) => f.kind === 'github_token')).toBe(false);
    expect(human.suppressed).toBe(1);
    const agent = scanDiffForSecrets(patch, { honorInlineMarker: false });
    expect(agent.findings.some((f) => f.kind === 'github_token')).toBe(true);
  });

  it('allowPaths из основного дерева подавляет находки по glob', () => {
    const result = scanDiffForSecrets(patch, { allowPaths: ['tests/**', '*.yml'] });
    expect(result.findings.some((f) => f.file.startsWith('tests/'))).toBe(false);
    expect(result.findings.some((f) => f.file === cyrillicFile)).toBe(false);
    expect(result.suppressed).toBe(2);
  });

  it('лимит объёма помечает результат усечённым', () => {
    const result = scanDiffForSecrets(patch, { maxAddedBytes: 40 });
    expect(result.truncated).toBe(true);
  });

  it('из длинной строки сканируется только начало', () => {
    const long = `diff --git a/b.js b/b.js\n--- a/b.js\n+++ b/b.js\n@@ -1 +1 @@\n+${'x'.repeat(50)} ghp_0123456789abcdefABCDEF0123\n`;
    expect(scanDiffForSecrets(long, { maxLineChars: 20 }).findings).toEqual([]);
    expect(scanDiffForSecrets(long).findings).toEqual([{ kind: 'github_token', file: 'b.js', line: 1 }]);
  });

  it('номера строк идут по новой версии файла через несколько hunk', () => {
    const multi = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '+two()',
      '@@ -10,2 +10,3 @@',
      ' ten',
      '+login("ghp_0123456789abcdefABCDEF0123");',
      ' eleven',
      '\\ No newline at end of file'
    ].join('\r\n');
    expect(scanDiffForSecrets(multi).findings).toEqual([{ kind: 'github_token', file: 'a.ts', line: 11 }]);
  });

  it('пустой патч — пустой результат', () => {
    expect(scanDiffForSecrets('')).toEqual({ findings: [], suppressed: 0, filesScanned: 0, truncated: false });
  });
});

describe('maskSecretsInPatch', () => {
  it('маскирует значения в добавленных строках, не трогая структуру и удалённые строки', () => {
    const masked = maskSecretsInPatch(patch);
    expect(masked).not.toContain('AbCdEf0123456789xyzXYZ');
    expect(masked).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ');
    expect(masked).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(masked).not.toContain('abc123def456ghi789');
    expect(masked).toContain('+export const client = { apiKey: "***" };');
    expect(masked).toContain('+OPENAI_API_KEY=***');
    expect(masked).toContain('+PORT=3000');
    // удалённая строка остаётся как есть — это не новый секрет, и ревьюер должен видеть, что убрано
    expect(masked).toContain('-const OLD_KEY = "sk-ant-api03-OldOldOld0123456789xyz";');
    expect(masked.split('\n').length).toBe(patch.split('\n').length);
    expect(scanDiffForSecrets(masked).findings.filter((f) => f.kind !== 'env_file')).toEqual([]);
  });

  it('тело PEM вычищается целиком', () => {
    const pem = [
      'diff --git a/id_rsa b/id_rsa',
      '--- /dev/null',
      '+++ b/id_rsa',
      '@@ -0,0 +1,4 @@',
      '+-----BEGIN OPENSSH PRIVATE KEY-----',
      '+b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ',
      '+AAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQ',
      '+-----END OPENSSH PRIVATE KEY-----'
    ].join('\n');
    const masked = maskSecretsInPatch(pem).split('\n');
    expect(masked.slice(4)).toEqual(['+-----BEGIN OPENSSH PRIVATE KEY-----', '+***', '+***', '+-----END OPENSSH PRIVATE KEY-----']);
  });
});

describe('вспомогательные функции', () => {
  it('unquoteGitPath собирает октальные байты UTF-8', () => {
    expect(unquoteGitPath('"b/src/\\320\\275\\320\\260\\321\\201\\321\\202\\321\\200\\320\\276\\320\\271\\320\\272\\320\\270 \\320\\261\\320\\276\\321\\202\\320\\260.yml"')).toBe(`b/${cyrillicFile}`);
    expect(unquoteGitPath('"b/with \\"quote\\".txt"')).toBe('b/with "quote".txt');
    expect(unquoteGitPath('b/plain.txt')).toBe('b/plain.txt');
  });

  it('isEnvFile отличает .env от шаблонов', () => {
    expect(isEnvFile('.env')).toBe(true);
    expect(isEnvFile('apps/web/.env.production')).toBe(true);
    expect(isEnvFile('.env.example')).toBe(false);
    expect(isEnvFile('.env.sample')).toBe(false);
    expect(isEnvFile('src/env.ts')).toBe(false);
    expect(isEnvFile('.envrc')).toBe(false);
  });

  it('globToRegExp: ** на любой глубине, * внутри сегмента, шаблон без слэша — по имени', () => {
    expect(globToRegExp('tests/**').test('tests/unit/a.test.ts')).toBe(true);
    expect(globToRegExp('**/fixtures/*.json').test('tests/unit/fixtures/x.json')).toBe(true);
    expect(globToRegExp('**/fixtures/*.json').test('fixtures/x.json')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/deep/a.ts')).toBe(false);
    expect(globToRegExp('*.pem').test('certs/dev.pem')).toBe(true);
    expect(globToRegExp('a?.txt').test('ab.txt')).toBe(true);
    expect(matchesAnyGlob('Tests\\Unit\\a.ts', ['tests/unit/**'])).toBe(true);
    expect(matchesAnyGlob('src/a.ts', [])).toBe(false);
  });

  it('summarizeSecretFindings перечисляет виды и места без значений', () => {
    const text = summarizeSecretFindings(scanDiffForSecrets(patch).findings);
    expect(text).toContain('env_file (.env)');
    expect(text).toContain('provider_key (src/config.ts:2)');
    expect(text).toContain(`telegram_token (${cyrillicFile}:1)`);
  });
});

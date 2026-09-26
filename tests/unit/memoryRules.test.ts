import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkMemoryFile, indexLinks, MEMORY_LIMITS, MEMORY_TYPES, STRICT_SECRET_PATTERNS, validateMemoryDir } from '../../scripts/memory-rules.mjs';
import { MEMORY_INDEX_FILE, MEMORY_DIR, MEMORY_LIMITS as TS_LIMITS, MEMORY_TYPES as TS_TYPES } from '../../electron/services/memoryFormat';
import { deleteMemoryFact, memoryDirOf, writeMemoryFact } from '../../electron/services/memoryStore';
import { detectSecrets } from '../../electron/services/secretPatterns';

/** Проверка памяти в lint:docs и её совпадение с форматом приложения (TASK-76.3, decision-51 п. 7). */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-memrules-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const draft = (title: string, description: string) => ({ title, description, body: `Тело: ${title}`, type: 'project' as const });

describe('memory-rules.mjs совпадает с memoryFormat.ts', () => {
  it('типы, лимиты, каталог и индекс', () => {
    expect(MEMORY_TYPES).toEqual([...TS_TYPES]);
    expect(MEMORY_LIMITS).toEqual({ title: TS_LIMITS.title, description: TS_LIMITS.description, body: TS_LIMITS.body });
    expect(MEMORY_DIR).toBe('backlog/memory');
    expect(MEMORY_INDEX_FILE).toBe('MEMORY.md');
  });

  it('строгие шаблоны секретов — подмножество детектора приложения', () => {
    const samples: Record<string, string> = {
      private_key: '-----BEGIN RSA PRIVATE KEY-----',
      provider_key: 'sk-ant-api03-AbCdEf0123456789xyzXYZ',
      github_token: 'ghp_0123456789abcdefABCDEF0123',
      slack_token: 'xoxb-1234567890-abcdefghij',
      aws_key: 'AKIAIOSFODNN7EXAMPLE',
      google_key: 'AIzaSyA0123456789abcdefghijklmnopqrstuv',
      huggingface_token: 'hf_abcdefghijklmnopqrstuvwxyz012345',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    };
    for (const [kind, re] of STRICT_SECRET_PATTERNS) {
      expect(re.test(samples[kind]), kind).toBe(true);
      expect(detectSecrets(samples[kind]).map((f) => f.kind), kind).toContain(kind);
    }
  });
});

describe('validateMemoryDir', () => {
  it('факты, записанные хранилищем приложения, проходят проверку', async () => {
    await writeMemoryFact(root, draft('Сборка падает при открытом exe', 'Закрыть exe перед pack:win'));
    await writeMemoryFact(root, draft('Ollama виснет под нагрузкой', 'Перезапустить ollama'));
    await writeMemoryFact(root, draft('Ollama зависает при нагрузке', 'Перезапуск сервера'), { replace: 'mem-2' });
    await deleteMemoryFact(root, 'mem-1');
    const result = validateMemoryDir(root);
    expect([...result.keys()].sort()).toEqual(['backlog/memory/MEMORY.md', 'backlog/memory/mem-2 - Ollama-зависает-при-нагрузке.md']);
    for (const errors of result.values()) expect(errors).toEqual([]);
  });

  it('без каталога — пусто', () => {
    expect(validateMemoryDir(root).size).toBe(0);
  });

  it('ловит расхождение индекса с файлами', async () => {
    await writeMemoryFact(root, draft('Первый факт', 'описание'));
    const dir = memoryDirOf(root);
    await fs.writeFile(path.join(dir, MEMORY_INDEX_FILE), '# Память\n\n- [Пропавший](mem-9%20-%20X.md) — нет файла\n', 'utf-8');
    const errors = validateMemoryDir(root).get('backlog/memory/MEMORY.md')!;
    expect(errors.join('\n')).toContain('не упомянут в индексе');
    expect(errors.join('\n')).toContain('отсутствующий файл "mem-9 - X.md"');
  });

  it('ловит незакавыченную дату, чужой тип, неверный id, секрет и имя файла', () => {
    const bad = '---\nid: "mem-3"\ntitle: "t"\ndescription: "d"\ntype: "decision"\ncreated: 2026-09-26\n---\n\nключ sk-ant-api03-AbCdEf0123456789xyzXYZ\n';
    const errors = checkMemoryFile('mem-4 - t.md', bad).join('\n');
    expect(errors).toContain('"created" должно быть строкой');
    expect(errors).toContain('type "decision"');
    expect(errors).toContain('не совпадает с именем файла');
    expect(errors).toContain('provider_key');
    expect(checkMemoryFile('notes.md', '')).toHaveLength(1);
  });

  it('indexLinks раскодирует пробелы', () => {
    expect(indexLinks('- [a](mem-1%20-%20A.md) — d\n- [b](mem-2.md) — e\n')).toEqual(['mem-1 - A.md', 'mem-2.md']);
  });
});

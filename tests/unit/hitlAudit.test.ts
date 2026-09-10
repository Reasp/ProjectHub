import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  HitlAuditLog,
  auditFileName,
  commandPreview,
  hashCommand,
  monthKey,
  redactSecrets,
  toCsv,
  truncateComment
} from '../../electron/services/hitlAudit';
import type { HitlAuditEntry } from '../../electron/services/hitlTypes';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-audit-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function entry(partial: Partial<HitlAuditEntry>): HitlAuditEntry {
  return {
    ts: new Date().toISOString(),
    kind: 'decision',
    requestId: 'r',
    sessionId: 's',
    projectPath: 'F:/ProjectHub',
    ...partial
  };
}

describe('redactSecrets / commandPreview / hashCommand', () => {
  it('вырезает bearer-токены, ключи, пароли в URL и переменные окружения', () => {
    const cmd = 'API_KEY=abc123 curl -H "Authorization: Bearer sk-ant-abcdefgh12345" https://user:p4ss@host/x?token=zzz --password=qwerty';
    const out = redactSecrets(cmd);
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('sk-ant-abcdefgh12345');
    expect(out).not.toContain('p4ss');
    expect(out).not.toContain('zzz');
    expect(out).not.toContain('qwerty');
    expect(out).toContain('curl');
    expect(redactSecrets('ghp_abcdefghijklmnop123 xoxb-1234567890-abc AKIAABCDEFGHIJKLMNOP')).toBe('gh*_*** xox*-*** AKIA***');
  });

  it('commandPreview схлопывает пробелы и усекает', () => {
    expect(commandPreview('npm   test\n\n--watch')).toBe('npm test --watch');
    const long = 'x'.repeat(500);
    expect(commandPreview(long, 20)).toBe(`${'x'.repeat(20)}…`);
  });

  it('hashCommand детерминирован (sha256 hex)', () => {
    expect(hashCommand('npm test')).toBe(hashCommand('npm test'));
    expect(hashCommand('npm test')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCommand('a')).not.toBe(hashCommand('b'));
  });

  it('truncateComment', () => {
    expect(truncateComment(undefined)).toBeUndefined();
    expect(truncateComment('   ')).toBeUndefined();
    expect(truncateComment('a'.repeat(300), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});

describe('HitlAuditLog: файлы по месяцам, выборка, экспорт', () => {
  it('пишет строки в hitl-<yyyy-mm>.jsonl и читает их обратно', async () => {
    const log = new HitlAuditLog(dir);
    await log.append(entry({ requestId: 'a', decision: 'allow', decidedBy: 'local', tool: 'Bash', commandPreview: 'npm test' }));
    await log.append(entry({ requestId: 'b', decision: 'deny', decidedBy: 'auto', rule: 'outside-project', filePath: '../x' }));
    await log.append(entry({ requestId: 'a', kind: 'outcome', outcome: 'executed' }));
    await log.flush();

    const month = monthKey(new Date());
    const files = await fs.readdir(dir);
    expect(files).toEqual([auditFileName(month)]);
    const lines = (await fs.readFile(path.join(dir, files[0]), 'utf-8')).trim().split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();

    expect(await log.listMonths()).toEqual([month]);
    const all = await log.query({});
    // новые первыми
    expect(all.map((e) => `${e.requestId}:${e.kind}`)).toEqual(['a:outcome', 'b:decision', 'a:decision']);
    expect(await log.query({ decidedBy: 'auto' })).toHaveLength(1);
    expect(await log.query({ decision: 'allow' })).toHaveLength(1);
    expect(await log.query({ search: 'npm' })).toHaveLength(1);
    expect(await log.query({ month: '1999-01' })).toEqual([]);
    expect(await log.query({ limit: 2 })).toHaveLength(2);
  });

  it('ротация по месяцам: разные даты → разные файлы, listMonths новые первыми', async () => {
    let current = new Date('2026-08-15T10:00:00Z');
    const log = new HitlAuditLog(dir, () => current);
    await log.append(entry({ requestId: 'aug' }));
    current = new Date('2026-09-01T10:00:00Z');
    await log.append(entry({ requestId: 'sep' }));
    await log.flush();
    expect(await log.listMonths()).toEqual(['2026-09', '2026-08']);
    expect((await log.readMonth('2026-08')).map((e) => e.requestId)).toEqual(['aug']);
    expect(await log.readMonth('bad')).toEqual([]);
  });

  it('повреждённые строки пропускаются', async () => {
    const log = new HitlAuditLog(dir);
    await log.append(entry({ requestId: 'ok' }));
    await log.flush();
    const file = path.join(dir, (await fs.readdir(dir))[0]);
    await fs.appendFile(file, '{broken json\n\n', 'utf-8');
    expect((await log.query({})).map((e) => e.requestId)).toEqual(['ok']);
  });

  it('экспорт в csv/json/jsonl', async () => {
    const log = new HitlAuditLog(dir);
    await log.append(entry({ requestId: 'a', title: 'Команда, с запятой и "кавычками"', decision: 'allow' }));
    await log.flush();
    const csv = await log.export({}, 'csv');
    const [header, row] = csv.split('\n');
    expect(header.split(',')).toContain('commandHash');
    expect(row).toContain('"Команда, с запятой и ""кавычками"""');
    const json = JSON.parse(await log.export({}, 'json'));
    expect(json[0].requestId).toBe('a');
    const jsonl = await log.export({}, 'jsonl');
    expect(jsonl.trim().split('\n')).toHaveLength(1);
    expect(toCsv([])).toContain('ts,kind,requestId');
  });
});

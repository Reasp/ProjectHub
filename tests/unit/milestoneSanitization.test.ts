import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listMilestones } from '../../electron/services/milestoneService';

describe('milestoneService: защита от Date объектов в frontmatter (правило 16)', () => {
  let tempProject: string;

  beforeAll(async () => {
    tempProject = await fs.mkdtemp(path.join(os.tmpdir(), 'projecthub-milestone-test-'));
    const msDir = path.join(tempProject, 'backlog', 'milestones');
    await fs.mkdir(msDir, { recursive: true });

    // Файл с незакавыченными датами в frontmatter
    const unquotedYaml = `---
id: milestone-1
title: 2026-09-01
target_date: 2026-10-15
status: Planning
---
# Milestone Description
`;
    await fs.writeFile(path.join(msDir, 'milestone-1 - Test.md'), unquotedYaml, 'utf-8');
  });

  afterAll(async () => {
    await fs.rm(tempProject, { recursive: true, force: true });
  });

  it('приводит незакавыченные даты в title и targetDate к строкам', async () => {
    const milestones = await listMilestones(tempProject);
    expect(milestones).toHaveLength(1);
    const m = milestones[0];

    expect(typeof m.id).toBe('string');
    expect(typeof m.title).toBe('string');
    expect(m.title).toBe('2026-09-01');
    expect(typeof m.targetDate).toBe('string');
    expect(m.targetDate).toBe('2026-10-15');
    expect(typeof m.status).toBe('string');
  });
});

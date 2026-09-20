import { describe, expect, it } from 'vitest';
import {
  MAX_PLAN_NODES,
  MAX_SUBTASK_TITLE,
  PLAN_FENCE,
  buildPlanInstructions,
  findCycle,
  normalizePlan,
  parseAgentPlan,
  planKey,
  planRetryPrompt,
  topoOrder
} from '../../electron/services/planSchema';
import type { AgentPlan, PlanSubtaskDraft } from '../../electron/services/planTypes';

/** Схема и нормализация плана роли architect (TASK-80.1, decision-49 п. 2). */

const node = (key: string, dependsOn: string[] = []): PlanSubtaskDraft => ({
  key,
  title: `Подзадача ${key}`,
  description: '',
  acceptanceCriteria: [],
  dependsOn
});

const fence = (obj: unknown) => `Вот план.\n\`\`\`${PLAN_FENCE}\n${JSON.stringify(obj)}\n\`\`\``;

const validPlan = {
  summary: 'Разбил на две части',
  subtasks: [
    { key: 'core', title: 'Чистое ядро и тесты', description: 'd1', acceptanceCriteria: ['Тесты зелёные'], dependsOn: [] },
    { key: 'ui', title: 'Экран поверх ядра', description: 'd2', acceptanceCriteria: ['Видно на экране'], dependsOn: ['core'] }
  ]
};

describe('parseAgentPlan', () => {
  it('берёт план из ограды и нормализует поля', () => {
    const res = parseAgentPlan(fence(validPlan));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.summary).toBe('Разбил на две части');
    expect(res.plan.subtasks.map((s) => [s.key, s.title, s.dependsOn])).toEqual([
      ['core', 'Чистое ядро и тесты', []],
      ['ui', 'Экран поверх ядра', ['core']]
    ]);
    expect(res.warnings).toEqual([]);
  });

  it('берёт последнюю ограду, если модель прислала несколько', () => {
    const text = `${fence({ summary: 'старый', subtasks: [{ key: 'a', title: 'Первый вариант', dependsOn: [] }] })}\nПередумал.\n${fence(validPlan)}`;
    const res = parseAgentPlan(text);
    expect(res.ok && res.plan.summary).toBe('Разбил на две части');
  });

  it('без ограды берёт последний JSON-объект с subtasks и игнорирует посторонние', () => {
    const text = `Сначала посмотрел {"files": 3} и {"note": "не план"}.\n${JSON.stringify(validPlan)}`;
    const res = parseAgentPlan(text);
    expect(res.ok && res.plan.subtasks).toHaveLength(2);
  });

  it('терпит текст вокруг JSON и незакрытые скобки в рассуждениях', () => {
    const text = `Думаю так: { неполная скобка в тексте\n${fence(validPlan)}\nГотово.`;
    expect(parseAgentPlan(text).ok).toBe(true);
  });

  it('понимает snake_case и синонимы полей', () => {
    const res = parseAgentPlan(
      fence({
        subtasks: [
          { key: 'a', title: 'Первая часть работы', acceptance_criteria: ['Работает'], depends_on: [] },
          { id: 'b', title: 'Вторая часть работы', criteria: ['Тоже работает'], dependencies: ['a'], modelTier: 'CHEAP', size: 'Small' }
        ]
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.subtasks[0].acceptanceCriteria).toEqual(['Работает']);
    expect(res.plan.subtasks[1]).toMatchObject({ key: 'b', dependsOn: ['a'], modelTier: 'cheap', size: 'small' });
  });

  it('отвергает ответ без плана', () => {
    const res = parseAgentPlan('Задача слишком сложная, давай обсудим.');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toContain(PLAN_FENCE);
  });

  it('отвергает битый JSON в ограде', () => {
    const res = parseAgentPlan(`\`\`\`${PLAN_FENCE}\n{"subtasks": [ {"key": "a", }\n\`\`\``);
    expect(res.ok).toBe(false);
  });

  it('отвергает пустой список подзадач и узел без заголовка', () => {
    expect(parseAgentPlan(fence({ subtasks: [] })).ok).toBe(false);
    const res = parseAgentPlan(fence({ subtasks: [{ key: 'a', title: 'x', dependsOn: [] }] }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toContain('заголовок');
  });

  it('отвергает цикл зависимостей с указанием пути', () => {
    const res = parseAgentPlan(
      fence({
        subtasks: [
          { key: 'a', title: 'Первая часть работы', dependsOn: ['c'] },
          { key: 'b', title: 'Вторая часть работы', dependsOn: ['a'] },
          { key: 'c', title: 'Третья часть работы', dependsOn: ['b'] }
        ]
      })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // путь печатается по направлению зависимости: a ждёт c, c ждёт b, b ждёт a
    expect(res.errors[0]).toContain('a → c → b → a');
  });
});

describe('normalizePlan', () => {
  const plan = (subtasks: PlanSubtaskDraft[]): AgentPlan => ({ summary: '', subtasks });

  it('переименовывает повторяющиеся ключи и сохраняет зависимости первого', () => {
    const res = normalizePlan(plan([node('a'), node('a'), node('b', ['a'])]));
    expect(res.plan.subtasks.map((s) => s.key)).toEqual(['a', 'a-2', 'b']);
    expect(res.plan.subtasks[2].dependsOn).toEqual(['a']);
    expect(res.warnings[0]).toContain('повторялся');
  });

  it('снимает самоссылки и ссылки на неизвестные узлы', () => {
    const res = normalizePlan(plan([node('a', ['a', 'нет-такого', 'b']), node('b')]));
    expect(res.plan.subtasks[0].dependsOn).toEqual(['b']);
    expect(res.warnings.join(' ')).toContain('самой себя');
    expect(res.warnings.join(' ')).toContain('неизвестного');
  });

  it('обрезает длинный заголовок и переносит полный текст в описание', () => {
    const long = 'Очень длинный заголовок подзадачи '.repeat(6).trim();
    const res = normalizePlan(plan([{ ...node('a'), title: long, description: 'детали' }]));
    const first = res.plan.subtasks[0];
    expect(first.title.length).toBeLessThanOrEqual(MAX_SUBTASK_TITLE);
    expect(first.description).toContain(long);
    expect(first.description).toContain('детали');
    expect(res.warnings.join(' ')).toContain(String(MAX_SUBTASK_TITLE));
  });

  it('отбрасывает узлы сверх лимита', () => {
    const many = Array.from({ length: MAX_PLAN_NODES + 3 }, (_, i) => node(`n${i}`));
    const res = normalizePlan(plan(many));
    expect(res.plan.subtasks).toHaveLength(MAX_PLAN_NODES);
    expect(res.warnings.join(' ')).toContain(`больше ${MAX_PLAN_NODES}`);
  });

  it('приводит ключ к слагу, сохраняя кириллицу, пустой заменяет запасным', () => {
    expect(planKey('Разбор Конфига!', 'x')).toBe('разбор-конфига');
    expect(planKey('A B/C', 'f')).toBe('a-b-c');
    expect(planKey('  ', 'node-1')).toBe('node-1');
    expect(planKey('!!!', 'node-2')).toBe('node-2');
  });

  it('русские ключи и зависимости между ними не теряются', () => {
    const res = parseAgentPlan(
      fence({
        subtasks: [
          { key: 'Ядро', title: 'Чистое ядро и тесты', dependsOn: [] },
          { key: 'Интерфейс', title: 'Экран поверх ядра', dependsOn: ['Ядро'] }
        ]
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.subtasks.map((s) => [s.key, s.dependsOn])).toEqual([
      ['ядро', []],
      ['интерфейс', ['ядро']]
    ]);
    expect(res.warnings).toEqual([]);
  });
});

describe('topoOrder и findCycle', () => {
  it('сортирует по уровням, внутри уровня — по порядку ответа', () => {
    const nodes = [node('c', ['a', 'b']), node('b'), node('a'), node('d', ['c'])];
    expect(topoOrder(nodes)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('детерминирован при повторных вызовах', () => {
    const nodes = [node('x'), node('y'), node('z', ['x', 'y'])];
    expect(topoOrder(nodes)).toEqual(topoOrder(nodes));
  });

  it('возвращает пустой порядок при цикле и путь цикла', () => {
    const nodes = [node('a', ['b']), node('b', ['a'])];
    expect(topoOrder(nodes)).toEqual([]);
    expect(findCycle(nodes)).toEqual(['a', 'b', 'a']);
  });

  it('граф без рёбер отдаёт исходный порядок', () => {
    expect(topoOrder([node('a'), node('b')])).toEqual(['a', 'b']);
    expect(findCycle([node('a'), node('b')])).toEqual([]);
  });
});

describe('промпты', () => {
  it('инструкция называет ограду, лимиты и критерии родителя', () => {
    const text = buildPlanInstructions('TASK-80', ['Схема покрыта тестами', 'UI показывает граф']);
    expect(text).toContain(PLAN_FENCE);
    expect(text).toContain(String(MAX_SUBTASK_TITLE));
    expect(text).toContain('1. Схема покрыта тестами');
    expect(text).toContain('разные файлы');
  });

  it('инструкция без критериев не обещает их', () => {
    expect(buildPlanInstructions('TASK-1', [])).not.toContain('Критерии приёмки родительской задачи');
  });

  it('повторный запрос перечисляет замечания и номер попытки', () => {
    const text = planRetryPrompt(['Зависимости образуют цикл: a → b → a'], 2, 3);
    expect(text).toContain('попытка 2 из 3');
    expect(text).toContain('- Зависимости образуют цикл');
    expect(text).toContain(PLAN_FENCE);
  });
});

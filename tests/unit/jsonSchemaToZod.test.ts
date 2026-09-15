import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZod, jsonSchemaToZodShape } from '../../electron/services/jsonSchemaToZod';

// Схема left_click из tools/list рантайма 7.4.0 (сокращены описания).
const LEFT_CLICK = {
  type: 'object',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  properties: {
    coordinate: { minItems: 2, maxItems: 2, type: 'array', items: { type: 'number' }, description: '[x, y] logical pixels' },
    target_app: { description: 'App id', type: 'string' },
    target_window_id: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
    focus_strategy: { type: 'string', enum: ['strict', 'best_effort', 'none', 'prepare_display'] },
    approval_token: { type: 'string' }
  },
  required: ['coordinate']
};

describe('jsonSchemaToZodShape: схемы рантайма для registerTool прокси', () => {
  const schema = z.object(jsonSchemaToZodShape(LEFT_CLICK, { omit: ['approval_token'] }));

  it('обязательные/необязательные поля, массивы с границами, enum', () => {
    expect(schema.safeParse({ coordinate: [10, 20] }).success).toBe(true);
    expect(schema.safeParse({ coordinate: [10, 20], focus_strategy: 'strict', target_window_id: 42 }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ coordinate: [10] }).success).toBe(false);
    expect(schema.safeParse({ coordinate: [1, 2], focus_strategy: 'whatever' }).success).toBe(false);
    expect(schema.safeParse({ coordinate: [1, 2], target_window_id: 1.5 }).success).toBe(false);
  });

  it('служебные поля рантайма можно скрыть; описания сохраняются', () => {
    expect(Object.keys(schema.shape)).not.toContain('approval_token');
    expect(schema.shape.coordinate.description).toBe('[x, y] logical pixels');
  });

  it('anyOf, type-массив, вложенные объекты, exclusiveMinimum', () => {
    const anyOf = jsonSchemaToZod({ anyOf: [{ type: 'integer' }, { type: 'string' }] });
    expect(anyOf.safeParse(3).success).toBe(true);
    expect(anyOf.safeParse('x').success).toBe(true);
    expect(anyOf.safeParse(true).success).toBe(false);

    const locs = jsonSchemaToZod({ type: 'array', items: { type: 'array', minItems: 3, maxItems: 3, items: { type: ['number', 'string'] } } });
    expect(locs.safeParse([[1, 2, 'text']]).success).toBe(true);
    expect(locs.safeParse([[1, 2]]).success).toBe(false);

    const fields = jsonSchemaToZod({
      type: 'array',
      items: { type: 'object', properties: { role: { type: 'string' }, value: { type: 'string' } }, required: ['role'] }
    });
    expect(fields.safeParse([{ role: 'AXTextField', value: 'a' }]).success).toBe(true);
    expect(fields.safeParse([{ value: 'a' }]).success).toBe(false);

    const width = jsonSchemaToZod({ type: 'integer', exclusiveMinimum: 0 });
    expect(width.safeParse(0).success).toBe(false);
    expect(width.safeParse(1366).success).toBe(true);
  });

  it('неизвестные конструкции деградируют до any, а не ломают регистрацию', () => {
    expect(jsonSchemaToZod({ not: { type: 'string' } }).safeParse(123).success).toBe(true);
    expect(jsonSchemaToZod(undefined).safeParse(null).success).toBe(true);
    expect(jsonSchemaToZodShape({ type: 'object' })).toEqual({});
  });
});

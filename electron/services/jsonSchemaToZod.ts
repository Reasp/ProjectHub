import { z, type ZodRawShape, type ZodTypeAny } from 'zod';

/**
 * Подмножество JSON Schema → zod (TASK-82). `McpServer.registerTool` принимает только zod-схемы,
 * а прокси ре-экспортирует инструменты рантайма с их JSON Schema. Конвертер сохраняет типы,
 * перечисления, границы и описания, чтобы `tools/list` прокси отдавал модели те же схемы, что и
 * рантайм. Неподдерживаемые конструкции деградируют до `z.any()`, а не ломают регистрацию.
 */

type JsonSchema = Record<string, unknown>;
type Literal = string | number | boolean | null;

function isSchema(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Границы вида ±(2^53−1), которые генерирует zod-to-json-schema рантайма, — не информативны. */
function meaningful(bound: unknown): bound is number {
  return typeof bound === 'number' && Number.isFinite(bound) && Math.abs(bound) < Number.MAX_SAFE_INTEGER;
}

function withDescription<T extends ZodTypeAny>(type: T, schema: JsonSchema): T {
  return typeof schema.description === 'string' && schema.description ? (type.describe(schema.description) as T) : type;
}

function convertNumber(schema: JsonSchema, integer: boolean): ZodTypeAny {
  let t = z.number();
  if (integer) t = t.int();
  if (meaningful(schema.minimum)) t = t.min(schema.minimum);
  if (meaningful(schema.maximum)) t = t.max(schema.maximum);
  if (meaningful(schema.exclusiveMinimum)) t = t.gt(schema.exclusiveMinimum);
  if (meaningful(schema.exclusiveMaximum)) t = t.lt(schema.exclusiveMaximum);
  return t;
}

function convertByType(type: string, schema: JsonSchema): ZodTypeAny {
  switch (type) {
    case 'string': {
      const values = Array.isArray(schema.enum) ? schema.enum : [];
      if (values.length > 0 && values.every((v): v is string => typeof v === 'string')) {
        return z.enum(values as [string, ...string[]]);
      }
      let t = z.string();
      if (meaningful(schema.minLength)) t = t.min(schema.minLength);
      if (meaningful(schema.maxLength)) t = t.max(schema.maxLength);
      return t;
    }
    case 'integer':
      return convertNumber(schema, true);
    case 'number':
      return convertNumber(schema, false);
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array': {
      let t = z.array(isSchema(schema.items) ? jsonSchemaToZod(schema.items) : z.any());
      if (meaningful(schema.minItems)) t = t.min(schema.minItems);
      if (meaningful(schema.maxItems)) t = t.max(schema.maxItems);
      return t;
    }
    case 'object': {
      const obj = z.object(jsonSchemaToZodShape(schema));
      return schema.additionalProperties === false ? obj.strict() : obj.passthrough();
    }
    default:
      return z.any();
  }
}

function union(types: ZodTypeAny[]): ZodTypeAny {
  if (types.length === 0) return z.any();
  if (types.length === 1) return types[0];
  return z.union(types as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function isLiteral(value: unknown): value is Literal {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

export function jsonSchemaToZod(schema: JsonSchema | undefined | null): ZodTypeAny {
  if (!isSchema(schema)) return z.any();
  let result: ZodTypeAny;
  const variants = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null;
  if (variants) {
    result = union(variants.filter(isSchema).map((s) => jsonSchemaToZod(s)));
  } else if (Array.isArray(schema.type)) {
    result = union(schema.type.filter((t): t is string => typeof t === 'string').map((t) => convertByType(t, { ...schema, type: t })));
  } else if (typeof schema.type === 'string') {
    result = convertByType(schema.type, schema);
  } else if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    result = union(schema.enum.filter(isLiteral).map((v) => z.literal(v)));
  } else {
    result = z.any();
  }
  return withDescription(result, schema);
}

/**
 * Свойства объектной схемы → `ZodRawShape` для `registerTool`. Необязательные свойства получают
 * `.optional()`; значения по умолчанию не подставляются — их применяет сам рантайм.
 */
export function jsonSchemaToZodShape(schema: JsonSchema | undefined | null, options: { omit?: string[] } = {}): ZodRawShape {
  const shape: ZodRawShape = {};
  const properties = isSchema(schema) && isSchema(schema.properties) ? schema.properties : {};
  const required = new Set<string>(isSchema(schema) && Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === 'string') : []);
  const omit = new Set(options.omit ?? []);
  for (const [name, propSchema] of Object.entries(properties)) {
    if (omit.has(name)) continue;
    const type = jsonSchemaToZod(isSchema(propSchema) ? propSchema : undefined);
    shape[name] = required.has(name) ? type : type.optional();
  }
  return shape;
}

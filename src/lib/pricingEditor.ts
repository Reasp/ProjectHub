import type { ModelPrice, OpenRouterImportedPrice, PriceOverrideEntry, PriceOverrides, PriceTable } from '../types/electron';

/**
 * Чистые функции редактора цен (TASK-70.4, decision-42) — без React и Electron.
 * Ключи окончательно нормализует main-процесс при сохранении (`sanitizePriceOverrides`).
 */

export type PriceRowStatus = 'builtin' | 'overridden' | 'custom';

export interface PriceRow {
  id: string;
  status: PriceRowStatus;
  /** Действующая цена: переопределение, иначе встроенная. */
  price: ModelPrice;
  builtin?: ModelPrice;
  override?: PriceOverrideEntry;
}

const STATUS_ORDER: Record<PriceRowStatus, number> = { custom: 0, overridden: 1, builtin: 2 };

/** Строки таблицы: сначала свои модели, затем переопределённые, затем встроенные; внутри — по id. */
export function buildPriceRows(builtin: PriceTable, overrides: PriceOverrides, query = ''): PriceRow[] {
  const q = query.trim().toLowerCase();
  const ids = new Set([...Object.keys(builtin.models), ...Object.keys(overrides.models)]);
  const rows: PriceRow[] = [];
  for (const id of ids) {
    if (q && !id.includes(q)) continue;
    const b = builtin.models[id];
    const o = overrides.models[id];
    const status: PriceRowStatus = o ? (b ? 'overridden' : 'custom') : 'builtin';
    rows.push({ id, status, price: o ?? b, ...(b ? { builtin: b } : {}), ...(o ? { override: o } : {}) });
  }
  return rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.id.localeCompare(b.id));
}

export interface PriceDraft {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

export function draftFromPrice(price?: ModelPrice): PriceDraft {
  const str = (v: number | undefined) => (typeof v === 'number' ? String(v) : '');
  return { input: str(price?.input), output: str(price?.output), cacheRead: str(price?.cacheRead), cacheWrite: str(price?.cacheWrite) };
}

/** Поле цены: пусто → undefined, число (допускается запятая) ≥ 0 → число, иначе null (ошибка). */
export function parsePriceField(text: string): number | undefined | null {
  const t = text.trim().replace(',', '.');
  if (!t) return undefined;
  // Только цифры, точка и экспонента: Number() принял бы и «0x10», и «Infinity».
  if (/[^0-9.eE+-]/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Черновик → цена; вход и выход обязательны, кэш — по желанию. null — ошибка ввода. */
export function priceFromDraft(draft: PriceDraft): ModelPrice | null {
  const input = parsePriceField(draft.input);
  const output = parsePriceField(draft.output);
  const cacheRead = parsePriceField(draft.cacheRead);
  const cacheWrite = parsePriceField(draft.cacheWrite);
  if (typeof input !== 'number' || typeof output !== 'number' || cacheRead === null || cacheWrite === null) return null;
  return {
    input,
    output,
    ...(typeof cacheRead === 'number' ? { cacheRead } : {}),
    ...(typeof cacheWrite === 'number' ? { cacheWrite } : {})
  };
}

/** Id модели для новой строки: без пробелов по краям, в нижнем регистре (как ключи таблицы). */
export function normalizeDraftModelId(id: string): string {
  return id.trim().toLowerCase();
}

export function setOverride(overrides: PriceOverrides, id: string, price: ModelPrice, source: PriceOverrideEntry['source'] = 'manual'): PriceOverrides {
  return { ...overrides, models: { ...overrides.models, [id]: { ...price, ...(source ? { source } : {}) } } };
}

/** Удаляет переопределение: встроенная модель возвращается к встроенной цене, своя — исчезает. */
export function removeOverride(overrides: PriceOverrides, id: string): PriceOverrides {
  if (!(id in overrides.models)) return overrides;
  const models = { ...overrides.models };
  delete models[id];
  return { ...overrides, models };
}

export function filterImportEntries(entries: OpenRouterImportedPrice[], query: string): OpenRouterImportedPrice[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.id.includes(q) || e.sourceId.toLowerCase().includes(q) || (e.name ?? '').toLowerCase().includes(q));
}

/** Добавляет выбранные импортированные цены в черновик переопределений (пометка `openrouter`). */
export function applyImportSelection(overrides: PriceOverrides, entries: OpenRouterImportedPrice[], selected: ReadonlySet<string>): PriceOverrides {
  let next = overrides;
  for (const e of entries) {
    if (selected.has(e.sourceId)) next = setOverride(next, e.id, e.price, 'openrouter');
  }
  return next;
}

/** Цена для таблицы: до 4 значащих знаков после запятой, без хвостовых нулей; нет значения — «—». */
export function formatPrice(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return String(Number(value.toPrecision(6)));
}

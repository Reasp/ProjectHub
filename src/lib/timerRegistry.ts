/**
 * Реестр отложенных вызовов с гарантированной очисткой (TASK-50).
 *
 * Чистый модуль без React и Electron: вся логика учёта `setTimeout` живёт здесь и
 * покрыта unit-тестами, а React-хуки (`useTimers`, `useTimeoutState`, `useToast`)
 * лишь создают реестр на время жизни компонента и вызывают `dispose()` в cleanup.
 * Это устраняет setState на размонтированных компонентах и «залипающие» уведомления.
 */
export type TimerHandle = ReturnType<typeof setTimeout>;

export class TimerRegistry {
  private timers = new Set<TimerHandle>();
  private disposed = false;

  /** Сколько таймеров сейчас ожидает срабатывания. */
  get size(): number {
    return this.timers.size;
  }

  /** Реестр уже освобождён (компонент размонтирован). */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Планирует вызов `fn` через `delayMs`. После `dispose()` новые таймеры не
   * создаются — возвращается `null`, чтобы вызывающий код не хранил мёртвые хэндлы.
   */
  set(fn: () => void, delayMs: number): TimerHandle | null {
    if (this.disposed) return null;
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      if (this.disposed) return;
      fn();
    }, delayMs);
    this.timers.add(handle);
    return handle;
  }

  /** Снимает один таймер; повторный вызов и `null` безопасны. */
  clear(handle: TimerHandle | null | undefined): void {
    if (handle === null || handle === undefined) return;
    if (!this.timers.delete(handle)) return;
    clearTimeout(handle);
  }

  /** Снимает все таймеры, но оставляет реестр пригодным для дальнейшего использования. */
  clearAll(): void {
    for (const handle of this.timers) clearTimeout(handle);
    this.timers.clear();
  }

  /** Финальная очистка: снимает таймеры и блокирует создание новых. */
  dispose(): void {
    this.clearAll();
    this.disposed = true;
  }
}

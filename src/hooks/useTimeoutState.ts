import { useCallback, useEffect, useRef, useState } from 'react';
import { TimerRegistry, type TimerHandle } from '../lib/timerRegistry';

/**
 * Реестр таймеров, живущий ровно столько же, сколько компонент (TASK-50).
 * Все отложенные вызовы (фокус поля, автоскрытие уведомления, повторный опрос)
 * регистрируются здесь и снимаются при размонтировании.
 */
export function useTimers() {
  const registryRef = useRef<TimerRegistry | null>(null);
  if (!registryRef.current) registryRef.current = new TimerRegistry();

  useEffect(() => {
    const registry = registryRef.current;
    return () => {
      registry?.dispose();
      // Строгий режим React монтирует компонент дважды: после dispose нужен свежий реестр,
      // иначе второй монтаж получит заблокированный и таймеры молча перестанут работать.
      registryRef.current = null;
    };
  }, []);

  const getRegistry = useCallback((): TimerRegistry => {
    if (!registryRef.current) registryRef.current = new TimerRegistry();
    return registryRef.current;
  }, []);

  const setTimer = useCallback(
    (fn: () => void, delayMs: number): TimerHandle | null => getRegistry().set(fn, delayMs),
    [getRegistry]
  );

  const clearTimer = useCallback(
    (handle: TimerHandle | null | undefined) => getRegistry().clear(handle),
    [getRegistry]
  );

  const clearTimers = useCallback(() => getRegistry().clearAll(), [getRegistry]);

  return { setTimer, clearTimer, clearTimers };
}

/**
 * Состояние, которое само возвращается к `resetValue` через заданный таймаут.
 * Таймер снимается при размонтировании и при каждом новом показе, поэтому
 * setState после unmount и «залипающие» уведомления невозможны.
 *
 * @returns `[value, show, reset]`, где `show(next, delayMs?)` показывает значение,
 * а `reset()` немедленно возвращает состояние к `resetValue`.
 */
export function useTimeoutState<T>(resetValue: T, defaultDelayMs = 3000) {
  const [value, setValue] = useState<T>(resetValue);
  const { setTimer, clearTimers } = useTimers();
  // Значение по умолчанию и задержка читаются через ref, чтобы show/reset оставались
  // стабильными и не ломали зависимости useEffect/useCallback в компонентах.
  const resetValueRef = useRef(resetValue);
  resetValueRef.current = resetValue;
  const delayRef = useRef(defaultDelayMs);
  delayRef.current = defaultDelayMs;

  const reset = useCallback(() => {
    clearTimers();
    setValue(resetValueRef.current);
  }, [clearTimers]);

  const show = useCallback(
    (next: T, delayMs?: number) => {
      clearTimers();
      setValue(next);
      setTimer(() => setValue(resetValueRef.current), delayMs ?? delayRef.current);
    },
    [clearTimers, setTimer]
  );

  return [value, show, reset] as const;
}

/**
 * Частный случай `useTimeoutState` для временных уведомлений: значение по умолчанию — `null`.
 *
 * @returns `[toast, showToast, clearToast]`
 */
export function useToast<T>(defaultDelayMs = 4000) {
  return useTimeoutState<T | null>(null, defaultDelayMs);
}

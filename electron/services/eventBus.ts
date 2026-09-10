import { EventEmitter } from 'node:events';
import type { AppBusEvent, AppBusEventType } from './hitlTypes.js';

/**
 * Единая шина событий main-процесса (TASK-57, decision-10 п. 5).
 *
 * Издатели: `hitlService` (`hitl:*`), `claudeBridgeService` и `agentFleetService` (`agent:*`).
 * Подписчики: IPC-мост в рендерер (`bus:event`), Remote Control (телефон/другой ПК, TASK-65),
 * уведомления и Telegram (TASK-63). Подписчик получает копию события; исключения подписчика
 * не роняют издателя.
 */
class AppEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  public publish(event: AppBusEvent): void {
    this.safeEmit(event.type, event);
    this.safeEmit('*', event);
  }

  /** Подписка на все события; возвращает функцию отписки. */
  public subscribe(listener: (event: AppBusEvent) => void): () => void {
    this.on('*', listener);
    return () => {
      this.off('*', listener);
    };
  }

  /** Подписка на один тип события. */
  public subscribeTo<T extends AppBusEventType>(
    type: T,
    listener: (event: Extract<AppBusEvent, { type: T }>) => void
  ): () => void {
    const handler = listener as (event: AppBusEvent) => void;
    this.on(type, handler);
    return () => {
      this.off(type, handler);
    };
  }

  private safeEmit(name: string, event: AppBusEvent): void {
    for (const listener of this.listeners(name)) {
      try {
        (listener as (e: AppBusEvent) => void)(event);
      } catch (err) {
        console.error(`[EventBus] listener for ${name} failed:`, err);
      }
    }
  }
}

export const appEventBus = new AppEventBus();

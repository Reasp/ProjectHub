import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEDUP_WINDOW_MS,
  NotificationDeduper,
  computeTrayState,
  defaultNotificationSettings,
  describeBusEvent,
  formatTelegramMessage,
  isQuietTime,
  normalizeSettings,
  parseTimeOfDay,
  resolveChannels
} from '../../electron/services/notificationRules';
import type { AppBusEvent, HitlRequest } from '../../electron/services/hitlTypes';
import type { NotificationSettings } from '../../electron/services/notificationTypes';

function at(hours: number, minutes = 0): Date {
  const d = new Date(2026, 8, 11, hours, minutes, 0, 0);
  return d;
}

function request(overrides: Partial<HitlRequest> = {}): HitlRequest {
  return {
    id: 'appr-1',
    sessionId: 'swarm-a1',
    projectPath: 'F:\\Projects\\demo',
    type: 'command',
    title: 'Выполнить команду',
    command: 'npm run build',
    createdAt: 1_700_000_000_000,
    agentName: 'Кодер',
    role: 'implementer',
    ...overrides
  };
}

describe('parseTimeOfDay', () => {
  it('разбирает корректное время', () => {
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('08:30')).toBe(510);
    expect(parseTimeOfDay('23:59')).toBe(1439);
  });

  it('отклоняет мусор и выход за границы', () => {
    for (const value of ['', '24:00', '12:60', '9', 'abc', null, undefined, 930]) {
      expect(parseTimeOfDay(value)).toBeNull();
    }
  });
});

describe('isQuietTime', () => {
  const quiet = { enabled: true, from: '23:00', to: '08:00', allowCritical: true };

  it('выключенные тихие часы всегда false', () => {
    expect(isQuietTime({ ...quiet, enabled: false }, at(2))).toBe(false);
  });

  it('интервал через полночь покрывает обе стороны суток', () => {
    expect(isQuietTime(quiet, at(23, 30))).toBe(true);
    expect(isQuietTime(quiet, at(3))).toBe(true);
    expect(isQuietTime(quiet, at(7, 59))).toBe(true);
    expect(isQuietTime(quiet, at(8))).toBe(false);
    expect(isQuietTime(quiet, at(12))).toBe(false);
    expect(isQuietTime(quiet, at(22, 59))).toBe(false);
  });

  it('обычный интервал внутри суток', () => {
    const day = { enabled: true, from: '09:00', to: '18:00', allowCritical: false };
    expect(isQuietTime(day, at(8, 59))).toBe(false);
    expect(isQuietTime(day, at(9))).toBe(true);
    expect(isQuietTime(day, at(17, 59))).toBe(true);
    expect(isQuietTime(day, at(18))).toBe(false);
  });

  it('равные границы означают отсутствие тихих часов', () => {
    expect(isQuietTime({ enabled: true, from: '10:00', to: '10:00', allowCritical: false }, at(10))).toBe(false);
  });
});

describe('resolveChannels', () => {
  const base = defaultNotificationSettings();

  it('берёт каналы из матрицы по типу события', () => {
    expect(resolveChannels(base, { kind: 'hitl', severity: 'critical' }, at(12))).toEqual([
      'tray',
      'os',
      'sound',
      'telegram',
      'remote'
    ]);
    expect(resolveChannels(base, { kind: 'deviceConnected', severity: 'info' }, at(12))).toEqual(['tray']);
  });

  it('общий выключатель оставляет только трей', () => {
    const off: NotificationSettings = { ...base, enabled: false };
    expect(resolveChannels(off, { kind: 'hitl', severity: 'critical' }, at(12))).toEqual(['tray']);
  });

  it('тихие часы глушат ОС, звук и Telegram', () => {
    const quiet: NotificationSettings = {
      ...base,
      quietHours: { enabled: true, from: '23:00', to: '08:00', allowCritical: false }
    };
    expect(resolveChannels(quiet, { kind: 'hitl', severity: 'critical' }, at(2))).toEqual(['tray', 'remote']);
    expect(resolveChannels(quiet, { kind: 'hitl', severity: 'critical' }, at(12))).toContain('telegram');
  });

  it('allowCritical пропускает важное сквозь тихие часы, но не рутину', () => {
    const quiet: NotificationSettings = {
      ...base,
      quietHours: { enabled: true, from: '23:00', to: '08:00', allowCritical: true }
    };
    expect(resolveChannels(quiet, { kind: 'hitl', severity: 'critical' }, at(2))).toContain('telegram');
    expect(resolveChannels(quiet, { kind: 'agentFinished', severity: 'success' }, at(2))).toEqual(['tray', 'remote']);
  });

  it('неизвестный тип события не роняет и не доставляется', () => {
    const broken = { ...base, channels: { ...base.channels } } as NotificationSettings;
    delete (broken.channels as Record<string, unknown>).hitl;
    expect(resolveChannels(broken, { kind: 'hitl', severity: 'critical' }, at(12))).toEqual([]);
  });
});

describe('NotificationDeduper', () => {
  it('подавляет повтор того же ключа в том же канале внутри окна', () => {
    const deduper = new NotificationDeduper();
    expect(deduper.shouldDeliver('pr:checks:p:1', 'telegram', 1000, DEFAULT_DEDUP_WINDOW_MS)).toBe(true);
    expect(deduper.shouldDeliver('pr:checks:p:1', 'telegram', 30_000, DEFAULT_DEDUP_WINDOW_MS)).toBe(false);
    expect(deduper.shouldDeliver('pr:checks:p:1', 'telegram', 70_000, DEFAULT_DEDUP_WINDOW_MS)).toBe(true);
  });

  it('каналы независимы, как и разные ключи', () => {
    const deduper = new NotificationDeduper();
    expect(deduper.shouldDeliver('k', 'telegram', 0, 60_000)).toBe(true);
    expect(deduper.shouldDeliver('k', 'os', 0, 60_000)).toBe(true);
    expect(deduper.shouldDeliver('other', 'telegram', 0, 60_000)).toBe(true);
  });

  it('forget снимает подавление по ключу во всех каналах', () => {
    const deduper = new NotificationDeduper();
    deduper.shouldDeliver('hitl:appr-1', 'telegram', 0, 60_000);
    deduper.shouldDeliver('hitl:appr-1', 'os', 0, 60_000);
    deduper.forget('hitl:appr-1');
    expect(deduper.shouldDeliver('hitl:appr-1', 'telegram', 10, 60_000)).toBe(true);
    expect(deduper.shouldDeliver('hitl:appr-1', 'os', 10, 60_000)).toBe(true);
  });

  it('нулевое окно ничего не подавляет', () => {
    const deduper = new NotificationDeduper();
    expect(deduper.shouldDeliver('k', 'os', 0, 0)).toBe(true);
    expect(deduper.shouldDeliver('k', 'os', 0, 0)).toBe(true);
  });

  it('вытесняет старые записи при переполнении', () => {
    const deduper = new NotificationDeduper(10);
    for (let i = 0; i < 50; i++) deduper.shouldDeliver(`k${i}`, 'os', i, 60_000);
    expect(deduper.size).toBeLessThanOrEqual(10);
  });
});

describe('computeTrayState', () => {
  it('внимание важнее работы', () => {
    expect(computeTrayState(0, 0)).toBe('idle');
    expect(computeTrayState(0, 3)).toBe('working');
    expect(computeTrayState(2, 0)).toBe('attention');
    expect(computeTrayState(2, 3)).toBe('attention');
  });
});

describe('describeBusEvent', () => {
  it('hitl:requested — critical, с requestId и действием на очередь', () => {
    const n = describeBusEvent({ type: 'hitl:requested', request: request() })!;
    expect(n.kind).toBe('hitl');
    expect(n.severity).toBe('critical');
    expect(n.requestId).toBe('appr-1');
    expect(n.dedupKey).toBe('hitl:appr-1');
    expect(n.action).toEqual({ type: 'openHitl', requestId: 'appr-1' });
    expect(n.body).toContain('demo');
    expect(n.body).toContain('npm run build');
  });

  it('решения и отмены HITL не превращаются в уведомление', () => {
    const decided: AppBusEvent = {
      type: 'hitl:decided',
      request: request(),
      approved: true,
      source: { kind: 'local' }
    };
    expect(describeBusEvent(decided)).toBeNull();
    expect(describeBusEvent({ type: 'hitl:expired', request: request() })).toBeNull();
    expect(describeBusEvent({ type: 'hitl:cancelled', request: request() })).toBeNull();
  });

  it('старт агента не уведомляет, а завершение и ошибка — да', () => {
    const base = {
      sessionId: 'swarm-a1',
      projectPath: '/home/u/demo',
      origin: 'swarm' as const,
      agentName: 'Кодер',
      at: 1000
    };
    expect(describeBusEvent({ type: 'agent:started', ...base })).toBeNull();

    const finished = describeBusEvent({ type: 'agent:finished', outcome: 'done', durationMs: 95_000, ...base })!;
    expect(finished.kind).toBe('agentFinished');
    expect(finished.severity).toBe('success');
    expect(finished.body).toContain('1 мин 35 с');

    const failed = describeBusEvent({ type: 'agent:failed', error: 'exit 1', ...base })!;
    expect(failed.kind).toBe('agentFailed');
    expect(failed.severity).toBe('critical');
    expect(failed.dedupKey).toBe('agent:failed:swarm-a1');
  });

  it('swarm:finished различает успех и ошибки', () => {
    const ok = describeBusEvent({
      type: 'swarm:finished',
      swarmId: 's1',
      projectPath: '/home/u/demo',
      name: 'TASK-63',
      mode: 'handoff',
      outcome: 'completed',
      agentsTotal: 3,
      agentsFailed: 0,
      at: 5
    })!;
    expect(ok.severity).toBe('success');
    expect(ok.title).toContain('Handoff');
    expect(ok.body).toContain('3/3');

    const bad = describeBusEvent({
      type: 'swarm:finished',
      swarmId: 's1',
      projectPath: '/home/u/demo',
      name: 'TASK-63',
      mode: 'fan-out',
      outcome: 'failed',
      agentsTotal: 3,
      agentsFailed: 1,
      at: 5
    })!;
    expect(bad.severity).toBe('warning');
    expect(bad.body).toContain('2/3');
  });

  it('process:crashed, pr:* и remote:deviceConnected раскладываются по типам', () => {
    const crashed = describeBusEvent({
      type: 'process:crashed',
      processId: 'p::dev',
      name: 'dev',
      projectPath: '/home/u/demo',
      exitCode: 1,
      at: 1
    })!;
    expect(crashed.kind).toBe('processCrashed');
    expect(crashed.action).toEqual({ type: 'openProcesses', projectPath: '/home/u/demo' });

    const created = describeBusEvent({
      type: 'pr:created',
      projectPath: '/home/u/demo',
      number: 42,
      title: 'feat: notifications',
      url: 'https://example.test/pr/42',
      at: 1
    })!;
    expect(created.kind).toBe('prCreated');
    expect(created.dedupKey).toBe('pr:created:/home/u/demo:42');

    const checks = describeBusEvent({
      type: 'pr:checksFailed',
      projectPath: '/home/u/demo',
      number: 42,
      title: 'feat: notifications',
      url: 'https://example.test/pr/42',
      at: 1
    })!;
    expect(checks.kind).toBe('prChecksFailed');
    expect(checks.severity).toBe('warning');

    const device = describeBusEvent({
      type: 'remote:deviceConnected',
      deviceId: 'd1',
      deviceName: 'Pixel',
      mode: 'relay',
      isApproved: false,
      at: 1
    })!;
    expect(device.kind).toBe('deviceConnected');
    expect(device.body).toContain('ожидает одобрения');
  });
});

describe('normalizeSettings', () => {
  it('пустой ввод даёт значения по умолчанию', () => {
    expect(normalizeSettings(undefined)).toEqual(defaultNotificationSettings());
    expect(normalizeSettings(null)).toEqual(defaultNotificationSettings());
    expect(normalizeSettings('nonsense')).toEqual(defaultNotificationSettings());
  });

  it('отбрасывает неизвестные каналы и оставляет известные', () => {
    const result = normalizeSettings({ channels: { hitl: ['telegram', 'ftp', 'tray'] } });
    expect(result.channels.hitl).toEqual(['tray', 'telegram']);
    // Остальные строки матрицы не тронуты.
    expect(result.channels.agentFailed).toEqual(defaultNotificationSettings().channels.agentFailed);
  });

  it('чинит некорректное время тихих часов и зажимает числа', () => {
    const result = normalizeSettings({
      quietHours: { enabled: true, from: '25:00', to: '07:15', allowCritical: false },
      soundVolume: 12,
      dedupWindowMs: -5
    });
    expect(result.quietHours.from).toBe('23:00');
    expect(result.quietHours.to).toBe('07:15');
    expect(result.soundVolume).toBe(1);
    expect(result.dedupWindowMs).toBe(0);
  });

  it('патч накладывается на текущие настройки, а не на дефолт', () => {
    const current: NotificationSettings = { ...defaultNotificationSettings(), minimizeToTray: false, soundVolume: 0.1 };
    const result = normalizeSettings({ enabled: false }, current);
    expect(result.enabled).toBe(false);
    expect(result.minimizeToTray).toBe(false);
    expect(result.soundVolume).toBe(0.1);
  });
});

describe('formatTelegramMessage', () => {
  it('экранирует markdown и ставит иконку важности', () => {
    const n = describeBusEvent({ type: 'hitl:requested', request: request({ title: 'Запуск *важной* команды' }) })!;
    const text = formatTelegramMessage(n);
    expect(text.startsWith('🚨 *')).toBe(true);
    expect(text).toContain('\\*важной\\*');
  });
});

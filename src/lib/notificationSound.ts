import type { NotificationSeverity } from '../types/electron';

/**
 * Звуковой сигнал уведомления (TASK-63, decision-13 п.2).
 *
 * Тон синтезируется WebAudio, а не берётся из аудиофайла: не нужно тащить ассет в сборку и
 * решать, где он лежит в упакованном приложении. Решение «звучать ли вообще» принимает main
 * (матрица каналов + тихие часы) — сюда приходит только факт «сыграть» и громкость.
 */

/** Пары «частота, Гц» и длительность ноты в секундах для каждой важности. */
const PATTERNS: Record<NotificationSeverity, Array<[number, number]>> = {
  info: [[660, 0.09]],
  success: [
    [660, 0.08],
    [880, 0.12]
  ],
  warning: [
    [520, 0.1],
    [440, 0.14]
  ],
  critical: [
    [880, 0.1],
    [660, 0.1],
    [880, 0.16]
  ]
};

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context || context.state === 'closed') context = new Ctor();
  if (context.state === 'suspended') void context.resume();
  return context;
}

export function playNotificationSound(severity: NotificationSeverity, volume = 0.5): void {
  const level = Math.min(1, Math.max(0, volume));
  if (level <= 0) return;
  const ctx = getContext();
  if (!ctx) return;

  const pattern = PATTERNS[severity] || PATTERNS.info;
  let at = ctx.currentTime;
  for (const [frequency, duration] of pattern) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    // Мягкая атака и затухание: прямоугольный gain даёт щелчок на старте и в конце.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level * 0.25, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
    at += duration + 0.03;
  }
}

/**
 * Сравнение версий `x.y.z` без внешней зависимости (semver избыточен для сверки тегов
 * GitHub Releases в {@link file://./updaterService.ts}). Вынесено в отдельный модуль без
 * `electron`, чтобы юнит-тест не тянул mock всего Electron API ради одной чистой функции.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const b = current.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

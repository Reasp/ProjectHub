import { describe, it, expect } from 'vitest';
import { emptyProjectScopedState } from '../../src/store/useProjectStore';
import { FALLBACK_STATUS_CONFIG } from '../../src/utils/taskStatus';

/**
 * Сброс экрана при смене проекта (TASK-67): пока данные нового проекта не загрузились,
 * в сторе не должно остаться ничего от предыдущего — иначе пользователь видит его задачи,
 * коммиты и документы и думает, что переключение не сработало.
 */
describe('emptyProjectScopedState', () => {
  it('обнуляет все проектные данные: списки пустые, выбранные сущности сброшены', () => {
    const state = emptyProjectScopedState();

    for (const [key, value] of Object.entries(state)) {
      if (key === 'backlogConfig') {
        // Состав статусов проектный (TASK-68): сброс — это четыре стандартных статуса,
        // а не колонки предыдущего проекта.
        expect(value, 'backlogConfig должен вернуться к стандартным статусам').toEqual(FALLBACK_STATUS_CONFIG);
      } else if (key === 'docLinkIndex') {
        // Связи документации проектные (TASK-122): обратные ссылки чужого проекта показывать нельзя.
        expect(value, 'docLinkIndex должен быть пустым индексом').toEqual({ backlinks: {}, headings: {} });
      } else if (Array.isArray(value)) {
        expect(value, `${key} должен быть пустым списком`).toEqual([]);
      } else {
        expect([null, '', false], `${key} должен быть сброшен`).toContain(value);
      }
    }
  });

  it('покрывает все проектные поля стора, включая фильтры задач', () => {
    expect(Object.keys(emptyProjectScopedState()).sort()).toEqual(
      [
        'activeProcessId',
        'backlogConfig',
        'dirtyTaskId',
        'docAnchorToOpen',
        'docBackStack',
        'docContent',
        'docLinkIndex',
        'docsList',
        'gitDiffContent',
        'gitLogs',
        'gitRepoDetails',
        'gitSelectedFile',
        'isDocDirty',
        'memoryRefToOpen',
        'milestones',
        'prDiffContent',
        'prProviderInfo',
        'processes',
        'prs',
        'selectedDoc',
        'selectedLabelFilter',
        'selectedMilestoneFilter',
        'selectedPR',
        'taskRefToOpen',
        'tasks'
      ].sort()
    );
  });

  it('возвращает новые объекты на каждый вызов (нет общих ссылок между проектами)', () => {
    const first = emptyProjectScopedState();
    const second = emptyProjectScopedState();

    expect(first.tasks).not.toBe(second.tasks);
    expect(first.docsList).not.toBe(second.docsList);
    expect(first.backlogConfig).not.toBe(second.backlogConfig);
    expect(first.backlogConfig.statuses).not.toBe(second.backlogConfig.statuses);
  });
});

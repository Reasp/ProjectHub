---
id: TASK-70.2
title: Каталог моделей профиля из /v1/models с кэшем и ручным обновлением
status: Done
assignee: []
created_date: '2026-09-18 12:40'
updated_date: '2026-09-18 13:05'
labels:
  - ai
  - model-agnostic
dependencies:
  - TASK-70.1
references:
  - electron/services/llmModelCatalog.ts
  - electron/services/llmModelCatalogService.ts
  - src/components/ai/LlmProfilesSection.tsx
  - tests/unit/llmProfiles.test.ts
  - tests/unit/llmProfileService.test.ts
parent_task_id: TASK-70
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AC#2 TASK-70. Список моделей профиля загружается из `GET {baseUrl}/models`, кэшируется (TTL), обновляется вручную. Ручной ввод id сохраняется. Ни одна модель не захардкожена как дефолтная. В поле модели AISettingsModal — подсказки из каталога, кнопка обновления, понятная ошибка при недоступности.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Разбор ответа /models (OpenAI-формат) и кэш покрыты unit-тестами
- [x] #2 Каталог доступен через IPC с кэшем и принудительным обновлением
- [x] #3 В UI поле модели подсказывает модели профиля, есть обновление; ручной ввод работает
- [x] #4 Проверено вживую на локальном Ollama
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация (decision-39, 2026-09-18)
- `llmModelCatalog.ts` — чистый разбор `GET {baseUrl}/models` (OpenAI `data[].id`, запасной вариант Ollama `models[].name`), без дублей, по алфавиту; `isCatalogFresh` — TTL 24 ч по паре «профиль + адрес».
- `llmModelCatalogService.ts` — кэш `~/.projecthub/llm-model-catalog.json`, `refresh` в обход кэша, таймаут 15 с; ошибка сервера возвращает прежний список вместе с причиной; облачный профиль без ключа — ошибка до сетевого запроса; кэш удалённого профиля забывается.
- IPC `llmProfiles:listModels(id, refresh)`; в UI — строка «Каталог моделей: N · обновлено · из кэша», кнопка обновления, текст ошибки; модели — подсказки datalist поля «Модель», ручной ввод id сохраняется. Дефолтной модели нет.

## Живая проверка на Ollama 0.34 (2026-09-18)
Временный тест через настоящие сервисы (удалён после прогона): профиль из пресета `ollama` → каталог с сервера `bge-m3:latest, nomic-embed-text:latest, qwen2.5:7b-instruct` → `complete` на `qwen2.5:7b-instruct` («Париж») → `streamChat` в режиме agent с исполнителем: вызов `read_file` package.json, второй шаг с ответом `project-hub` → пустая модель даёт «Модель не выбрана…». В собранном exe каталог показал «models: 3», datalist содержит те же 3 id.
Первый прогон агентского запроса (без исполнителя — тогда tools не отправляются, это задумано) однажды не уложился в 180 с; в 5 следующих прогонах завершался за 2–4 с, причина не воспроизведена (на машине параллельно шла нагрузка на GPU).

Группировка моделей по профилям в `ModelSelectorDropdown` AI Studio — TASK-70.5.
<!-- SECTION:NOTES:END -->

---
id: TASK-100
title: >-
  Живая проверка облачного профиля: TASK-70.x и fallback TASK-79 на реальном
  ключе
status: To Do
assignee: []
created_date: '2026-09-19 07:33'
labels:
  - ai
  - providers
  - verification
milestone: m-0
dependencies:
  - TASK-70
  - TASK-79
priority: medium
type: task
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Облачных ключей не было, поэтому вживую не проверены: облачный профиль в слоте Swarm и Arena (AC#4 TASK-70.5, AC#6 TASK-70), usage и стоимость облачных серверов (decision-42), тела 429/402/5xx и ошибки посреди потока (decision-43, фикстуры source=docs), fallback TASK-79 на облачном 429/503 с Retry-After (decision-44). Когда появится ключ (OpenRouter или другой OpenAI-совместимый), прогнать временным тестом через настоящие сервисы, дополнить фикстуры `provider-errors.json` живыми телами (source=live), отметить AC и закрыть TASK-70.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Слот Swarm и ревьюер Arena с облачным профилем отвечают, usage и стоимость приходят от провайдера
- [ ] #2 Живые тела ошибок облака (хотя бы 401 и одна из 429/402/5xx) добавлены в фикстуры с source=live
- [ ] #3 Fallback TASK-79 с облачным звеном в цепочке проверен вживую
- [ ] #4 AC#4 TASK-70.5 и AC#6 TASK-70 отмечены, decision-26 переведён в accepted (кроме п. 4)
<!-- AC:END -->

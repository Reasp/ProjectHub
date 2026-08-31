---
id: task-8
title: >-
  Модуль интеграции и управления Pull & Merge Requests (GitHub, GitLab, PR
  Links)
status: Done
assignee: []
created_date: ''
updated_date: '2026-08-31 02:22'
labels:
  - pr
  - mr
  - github
  - gitlab
  - code-review
  - integration
dependencies: []
---

# task-8: Модуль интеграции и управления Pull & Merge Requests (GitHub, GitLab, PR Links)

## Description
Разработать модуль для просмотра, создания и мониторинга Pull/Merge Requests (GitHub / GitLab) прямо из интерфейса ProjectHub, с автоматической синхронизацией статусов задач Backlog.

## Acceptance Criteria
- [ ] Поддержка авторизации в GitHub (через локальный `gh auth token` / OAuth / Personal Access Token) и GitLab.
- [ ] Вкладка "Merge / Pull Requests" в карточке проекта со списком активных и закрытых PR/MR.
- [ ] Отображение статусов CI/CD проверок (GitHub Actions, GitLab CI), списка измененных файлов и комментариев ревьюеров.
- [ ] Создание PR в 1 клик из текущей ветки задачи:
  - Автозаполнение заголовка и описания PR на основе markdown-файла задачи (`backlog/tasks/task-N.md`).
  - Выбор целевой ветки (base branch) и ревьюеров.
- [ ] Синхронизация с жизненным циклом задачи Backlog:
  - Автоматический перевод задачи в статус `Review` при открытии PR.
  - Автоматический перевод задачи в статус `Done` при подтверждении слияния PR.

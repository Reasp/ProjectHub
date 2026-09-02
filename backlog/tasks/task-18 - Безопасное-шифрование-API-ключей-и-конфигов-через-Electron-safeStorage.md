---
id: TASK-18
title: Безопасное шифрование API-ключей и конфигов через Electron safeStorage
status: Done
assignee: []
created_date: '2026-09-02 05:24'
updated_date: '2026-09-02 05:28'
labels:
  - security
  - encryption
  - electron
  - ai-studio
dependencies: []
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Внедрение системного шифрования через Electron safeStorage (Windows DPAPI) для защиты API-ключей (Anthropic, OpenAI, OpenRouter, Groq, DeepSeek) в конфигурациях ProjectHub.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Интеграция Electron safeStorage API (DPAPI на Windows) для шифрования и дешифрования API-ключей
- [x] #2 Бесшовная миграция существующих незашифрованных ключей в зашифрованные без потери данных
- [x] #3 Безопасное сохранение и загрузка конфигурации AI Studio и Voice Whisper
- [x] #4 Маскирование секретов в логах и UI
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Интегрирован сервис secretStorageService на базе Electron safeStorage (Windows DPAPI). API-ключи провайдеров Anthropic, OpenAI, OpenRouter, Groq, DeepSeek автоматически шифруются с префиксом enc_v1: перед записью на диск в ai-config.json и secrets.enc.json. Исключено сохранение открытых ключей в localStorage. В UI настроек добавлен бейдж безопасности. Проведено тестирование сборки и линтинга.
<!-- SECTION:FINAL_SUMMARY:END -->

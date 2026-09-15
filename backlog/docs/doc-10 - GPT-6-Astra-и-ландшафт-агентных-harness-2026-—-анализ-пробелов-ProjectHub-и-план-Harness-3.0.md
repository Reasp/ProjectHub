---
id: doc-10
title: >-
  GPT-6 Astra и ландшафт агентных harness 2026 — анализ пробелов ProjectHub и
  план Harness 3.0
type: specification
created_date: "2026-09-15 03:04"
tags:
  - harness
  - gpt-6-astra
  - codex
  - claude-code
  - roadmap
  - piper
---
# GPT-6 Astra и ландшафт агентных harness 2026 — анализ пробелов ProjectHub и план Harness 3.0

> **Дата**: "2026-09-15". **Статус**: аналитика + роадмап (milestone `Harness 3.0`, задачи TASK-69…TASK-81).
> Принятые из этого документа решения вынесены в [[decision-25]] (TTS) и [[decision-26]] (Codex app-server, провайдер OpenAI, тиры моделей); остальные ADR создаются в задачах, где решение принимается (правило 18).

## 1. Что такое GPT-6 Astra и что это меняет

GPT-6 Astra выпущена OpenAI 3 сентября 2026 (ограниченный доступ), 4 сентября — общая доступность
для Plus/Pro/Business/Enterprise, через API, Azure и Bedrock. Одновременно вышла линейка GPT-5.6
(`sol`, `terra`, `luna`); `gpt-5.4`/`gpt-5.4-mini` сняты 31 августа 2026.

| Параметр | Значение |
|---|---|
| API id | `gpt-6-astra` (OpenRouter: `openai/gpt-6-astra`), долгий горизонт — `gpt-6-astra-aeon` |
| Контекст / вход / выход | 1 050 000 / 922 000 / 128 000 токенов |
| Knowledge cutoff | 2026-04-30 |
| Цена (стандарт) | $10 вход, $50 выход, $1 кэш-чтение, $12,5 кэш-запись за 1 млн |
| Наценка за длинный контекст | вход > 272 000 токенов: ×2 вход, ×1,5 выход на весь запрос |
| Режимы | batch/flex −50 %, fast ×2 |
| `reasoning_effort` | `low`, `medium`, `high`, `xhigh`, `max` (в Codex дополнительно `ultra` — «максимум рассуждений с автоделегированием») |
| Бенчмарки | OSWorld 2.0 72,6 %, Terminal-Bench 4.0 57,9 %, ARC-AGI-3 99,9 %, FrontierMath T4 97,6 % |
| Архитектура | «recurrent depth / looped transformers» — эффективнее, но цепочка рассуждений хуже наблюдаема |
| Безопасность | первый «Critical» уровень по киберспособностям (Preparedness Framework); устойчивость к prompt injection 99,79 %; CoT-мониторинг деградировал; 2/500 прогонов с supply-chain-риском в оценке UK AISI |

Что важно для harness, а не для чата:

1. **Computer use стал рабочим.** «Всё, что вы делаете на компьютере, Astra сделает за вас» — модель
   уверенно управляет браузером и GUI. Harness, который не даёт агенту посмотреть на результат
   (запустить приложение, снять скриншот, прокликать сценарий), теряет половину ценности модели.
2. **Context notes вместо compaction.** Astra ведёт структурированные заметки, доступные поиску
   между окнами контекста (в Codex: `features.context_management.experimental_mode`,
   `auto_compact_token_limit = 850000`). Это фича модели, но её можно воспроизвести на уровне
   harness для всех движков — память проекта и заметки хода (TASK-76).
3. **Безопасность переезжает в harness.** OpenAI прямо рекомендует хуки `pre_tool_use` с
   обязательным подтверждением shell, `approval_policy = "untrusted"` для автоматических
   пайплайнов и аудит MCP-результатов, а не чтение транскриптов. У ProjectHub уже есть HITL-контур
   и аудит-лог ([[decision-10]]) — их надо распространить на Codex и на терминальные сессии
   (TASK-71, TASK-77) и запретить полный auto-approve для автономных запусков ([[decision-26]] п. 5).
4. **Codex перешёл на app-server.** Все поверхности Codex (CLI, VS Code, web) работают через
   `codex app-server` — JSON-RPC 2.0 с потоками (`thread/start|resume|fork`), ходами
   (`turn/start|steer|interrupt`), событиями `item/*`, серверными запросами одобрений
   (`execCommandApproval`, `applyPatchApproval`), каталогом моделей (`model/list` с
   `supportedReasoningEfforts`), хуками, субагентами и `review/start`. Наш `codex exec --json`
   — тупиковая ветка (TASK-71).
5. **Смена поколений моделей раз в квартал.** Жёсткие id моделей в ролях ломаются; нужен слой
   тиров и fallback (TASK-79).

Доступ: Astra выдаётся поэтапно (Trusted Access → подписки); Codex на машине разработки не
установлен и не оплачен, поэтому TASK-70/71 реализуются по документации и требуют ручного
smoke-теста, как TASK-60.

## 2. Ландшафт harness'ов в сентябре 2026

Общий вывод обзоров 2026 года: модели внутри инструментов сошлись по качеству, разницу делает
harness. Ниже — что считается «best-in-class» по каждому направлению.

| Направление | Кто лучший | Что именно |
|---|---|---|
| Программируемость | Claude Code | хуки (PreToolUse/PostToolUse/Stop/SubagentStart/PreCompact/WorktreeCreate…), скиллы, субагенты, плагины и маркетплейс, Routines (cron/GitHub-триггеры), чекпоинты и `/rewind`, авто-память, Agent SDK с `canUseTool` |
| Охват поверхностей | Codex | app-server как единый протокол, cloud-задачи, computer use, hosted shell, tool search, плагины (`codex plugin`), `review/start` |
| Фоновые агенты | Devin, Codex Cloud, Cursor Cloud Agents, Jules | fire-and-forget задачи в изолированных VM, PR на выходе |
| Мульти-провайдерность | OpenCode (75+), Cline (30+) | любая модель, self-host |
| Приватность | Hermes, OpenHands | self-host, без телеметрии, persistent memory |
| Ревью PR | Claude `/ultrareview`, Cursor BugBot, Copilot | мульти-агентное ревью с верификацией находок |

Что есть у ProjectHub и чего нет ни у кого из них в одном месте: локальный канбан-источник истины
(Backlog.md), worktree на агента, Swarm Arena с объективным судьёй, роли как сущности, единый HITL
с аудитом, федерация машин, Remote Control/Telegram, голосовое управление, RAG по документации и
граф кода в контексте агента. Это фундамент; пробелы — ниже.

## 3. Матрица: ProjectHub против лучших практик

| Возможность | Лучшие практики | ProjectHub сейчас | Пробел → задача |
|---|---|---|---|
| Нативный протокол Codex | app-server JSON-RPC, одобрения, resume, effort | `codex exec --json`, без HITL/resume | TASK-71 |
| GPT-6 Astra / GPT-5.6 напрямую | `reasoning_effort` до `max`, кэш-цены, наценка > 272K | только через OpenRouter/custom, без effort и кэш-цен | TASK-70 |
| Маршрутизация моделей | тиры, fallback при 429 | жёсткие id в ролях | TASK-79 |
| Замкнутый контур «до готовности» | агент ↔ проверки до выполнения критериев | чеки один раз после Arena, AC отмечает агент | TASK-75 |
| Автоматизации / Routines | cron и событийные триггеры | только автозапуск назначенной задачи | TASK-74 |
| Память между сессиями | context notes, auto-memory | контекст собирается заново каждый раз | TASK-76 |
| Чекпоинты / rewind, трасса | снимок перед изменением, `/rewind`, `duration_ms` | авто-коммит результата, без отката по ходам и таймлайна | TASK-72 |
| Декомпозиция и параллель | plan mode, субагенты, автоделегирование | fan-out/handoff без подзадач | TASK-80 |
| Роли и политики вне ProjectHub | нативные субагенты и хуки | роли действуют только при запуске из ProjectHub | TASK-77 |
| Визуальная верификация / computer use | Playwright MCP, скриншоты, OSWorld-класс | нет | TASK-78 |
| Автоматическое ревью PR | ultrareview, BugBot | LLM-ревьюер только в Arena | TASK-81 |
| Безопасность цепочки поставок | аудит зависимостей, сканер секретов | не реализовано (doc-6 §4.2) | TASK-73 |
| Локальный нейросетевой TTS | Piper/Kokoro оффлайн | системный `speechSynthesis` | TASK-69 |

Что уже на уровне или лучше рынка и не требует задач: worktree-изоляция ([[decision-6]]),
HITL-контур ([[decision-10]]), Arena с судьёй ([[decision-12]], [[decision-20]]), учёт
стоимости ([[decision-16]]), контекст задачи + RAG + GitNexus ([[decision-18]]), федерация и
Remote Control ([[decision-11]], [[decision-19]]), уведомления ([[decision-13]]).

## 4. План Harness 3.0 — порядок и зависимости

```mermaid
flowchart LR
    T70[TASK-70 провайдер OpenAI] --> T79[TASK-79 тиры моделей]
    T71[TASK-71 Codex app-server] --> T79
    T75[TASK-75 Done-loop] --> T80[TASK-80 планировщик]
    T74[TASK-74 Automations] --> T81[TASK-81 авто-ревью PR]
    T75 --> T78[TASK-78 визуальная верификация]
    T72[TASK-72 чекпоинты и трасса]
    T76[TASK-76 память агента]
    T77[TASK-77 экспорт ролей и хуки]
    T73[TASK-73 Security Health]
    T69[TASK-69 Piper TTS]
```

Рекомендуемая очередность (по ценности на единицу усилий):

1. **TASK-75 Done-loop** — самый большой прирост качества результата для любого движка, без новых зависимостей.
2. **TASK-70 провайдер OpenAI** — маленькая задача, открывает Astra/5.6 с корректной стоимостью.
3. **TASK-71 Codex app-server** — закрывает архитектурный долг из [[decision-4]] и даёт HITL для Codex.
4. **TASK-76 память** и **TASK-72 чекпоинты/трасса** — «взрослая» наблюдаемость и накопление знаний.
5. **TASK-74 Automations** → **TASK-81 авто-ревью**, **TASK-79 тиры**, **TASK-77 роли/хуки**.
6. **TASK-80 планировщик**, **TASK-78 визуальная верификация**, **TASK-73 Security Health**, **TASK-69 Piper TTS** — по спросу.

Инварианты для всех задач: чистые модули с unit-тестами (правило 17), ADR в той же задаче
(правило 18), модалки через `createPortal` ([[decision-17]]), `Done` никогда не выставляется
автоматически (правило 5), полный auto-approve недоступен автономным запускам.

## 5. Piper TTS — краткая сводка (детали в TASK-69 и [[decision-25]])

- `rhasspy/piper` заархивирован (октябрь 2025); развитие — `OHF-Voice/piper1-gpl` под GPL-3.0 (из-за espeak-ng), Python `piper-tts` 1.6.0 (июль 2026). Node-биндинга нет.
- Русские голоса: `irina`, `dmitri`, `denis`, `ruslan` (все medium, 22050 Гц, данные RHVoice, лицензия датасета «Unknown»). Kokoro-82M русский не поддерживает.
- Рантайм для Electron: `sherpa-onnx-node` 1.13.8 (Apache-2.0, prebuilt для win/linux/mac, встроенный espeak-ng, готовые конвертированные Piper-голоса) в `worker_threads` main-процесса по образцу Whisper ([[decision-21]]); запасной путь — WASM в рендерере (`@mintplex-labs/piper-tts-web`).
- Бонус против `speechSynthesis`: вывод через выбранное устройство (`setSinkId`), генерация по предложениям, отмена по `jobId`, глушение VAD на время речи.

## 6. Источники

- OpenAI — GPT-6 Astra: https://openai.com/index/gpt-6-astra/ , https://openai.com/index/safety-overview-gpt-6-astra/ , https://deploymentsafety.openai.com/gpt-6-astra
- Wikipedia — GPT-6 Astra: https://en.wikipedia.org/wiki/GPT-6_Astra
- OpenRouter — `openai/gpt-6-astra`: https://openrouter.ai/openai/gpt-6-astra
- Codex Knowledge Base — Astra в Codex CLI (лимиты, цены, хуки, context notes): https://codex.danielvaughan.com/2026/09/03/gpt-6-astra-codex-cli-configuration-context-notes-safety/
- Codex Weekly 2026-09-07 (бенчмарки, режимы цен): https://www.bighatgroup.com/blog/codex-weekly-2026-09-07/
- Codex app-server: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md , https://openai.com/index/unlocking-the-codex-harness/ , https://gist.github.com/oneryalcin/ee2c27e2d8aa040da8fbe7eebcc2ecea
- Claude Code 2026 (Routines, hooks, rewind, plugins): https://www.gradually.ai/en/changelogs/claude-code/ , https://toolsbase.dev/en/reference/claude-code-features
- Claude Agent SDK (TypeScript): https://code.claude.com/docs/en/agent-sdk/typescript
- Обзоры harness'ов 2026: https://ssojet.com/blog/ai-coding-agents-compared , https://www.firecrawl.dev/blog/best-ai-coding-agents , https://www.vellum.ai/blog/best-ai-coding-agents
- Piper: https://github.com/OHF-Voice/piper1-gpl , https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU , https://www.promptquorum.com/power-local-llm/piper-tts-review
- sherpa-onnx: https://www.npmjs.com/package/sherpa-onnx-node , https://k2-fsa.github.io/sherpa/onnx/tts/piper.html
- Локальные TTS 2026 (Kokoro без русского): https://localaimaster.com/blog/best-local-tts-models , https://contracollective.com/blog/kokoro-vs-piper-vs-xtts-local-text-to-speech-m5-max-2026

---
name: feedback-network-node-huggingface
description: Node fetch/https к huggingface.co нестабилен в этой сессии/сети — обходить curl-ом
metadata:
  type: feedback
---

В этой рабочей среде (эта машина/сеть) запросы из Node.js (и `fetch`/undici, и встроенный
`https`) к `huggingface.co/*/resolve/*` стабильно рвутся с `ECONNRESET` — проверено и через
Bash-тул, и через PowerShell-тул, и с отключённым сандбоксом. При этом `curl` к тем же URL
проходит в среднем 2 из 3 попыток. Похоже на что-то специфичное для TLS-стека Node в этой
сети (не подтверждено, что это проблема на стороне HuggingFace).

**Why:** потратил много попыток (bare fetch, native https, разные тулы) прежде чем нашёл
рабочий обход — важно не повторять тот же путь диагностики заново.

**How to apply:** если `@huggingface/transformers` (или любая другая либа, скачивающая файлы
через Node) не может скачать модель — не считать это фатальным и не переключаться на другую
модель/библиотеку сразу. Обходной путь: скачать нужные файлы вручную через
`curl -sSL --retry 20 --retry-all-errors --retry-delay 1-2` (обязательно `-L`, иначе curl
сохранит HTML-редирект вместо файла) прямо в директорию кэша библиотеки, потом штатный код
подхватит их из файлового кэша без обращения к сети. Для `@huggingface/transformers` ключ
кэша — `path.join(cacheDir, repo_id, filename)`, без `resolve/main` в пути (см.
`getModelFile` в `dist/transformers.node.mjs`). Список файлов репозитория модели — через
`https://huggingface.co/api/models/<repo_id>` (тоже требует retry). Это специфика именно
данной сессии/сети, не факт что повторится на машине пользователя при обычном запуске.

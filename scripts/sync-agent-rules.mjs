import fs from 'node:fs';
import path from 'node:path';
import { INFRA_ROOT, PROJECT_ROOT } from './config.mjs';

// Источник (infra-dev.md) — часть самой инфраструктуры, лежит в INFRA_ROOT.
// Цели (CLAUDE.md/GEMINI.md/AGENTS.md) — в PROJECT_ROOT, там их ищут агенты.
// В standalone-режиме (инфра = корень проекта) это одна и та же папка.
const SOURCE = path.join(INFRA_ROOT, 'infra-dev.md');
// AGENTS.md (не AGENT.md) — так называют дженерик-файл правил и Backlog.md
// (`backlog init --agent-instructions agents`), и GitNexus (`gitnexus analyze`),
// так что infra-dev-секция окажется в том же файле, а не в отдельном третьем.
const TARGETS = ['CLAUDE.md', 'GEMINI.md', 'AGENTS.md'];

// Google Antigravity читает workspace rules не только из корневых GEMINI.md/AGENTS.md,
// но и из отдельной папки `.agents/rules/` (текущий дефолт; `.agent/rules/` — старое имя,
// оставлено для обратной совместимости самим Antigravity, но новых файлов там не пишем).
// Формат — обычный Markdown без фронтматтера, поэтому пишем файл целиком, без секций.
const ANTIGRAVITY_RULES_TARGET = path.join('.agents', 'rules', 'infra-dev.md');

const START = '<!-- infra-dev:start (сгенерировано из infra-dev.md, правь его, не эту секцию) -->';
const END = '<!-- infra-dev:end -->';

function syncMergedTargets(block) {
  for (const target of TARGETS) {
    const targetPath = path.join(PROJECT_ROOT, target);

    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, `# ${target}\n\n${block}\n`);
      console.log(`создан: ${target}`);
      continue;
    }

    const current = fs.readFileSync(targetPath, 'utf-8');
    const startIdx = current.indexOf(START);
    const endIdx = current.indexOf(END);

    let next;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      next = current.slice(0, startIdx) + block + current.slice(endIdx + END.length);
    } else {
      const sep = current.endsWith('\n') ? '\n' : '\n\n';
      next = current + sep + block + '\n';
    }

    if (next !== current) {
      fs.writeFileSync(targetPath, next);
      console.log(`обновлён: ${target}`);
    } else {
      console.log(`без изменений: ${target}`);
    }
  }
}

function syncAntigravityRules(body) {
  const targetPath = path.join(PROJECT_ROOT, ANTIGRAVITY_RULES_TARGET);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const next = `${body}\n`;
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
  if (next !== current) {
    fs.writeFileSync(targetPath, next);
    console.log(`обновлён: ${ANTIGRAVITY_RULES_TARGET}`);
  } else {
    console.log(`без изменений: ${ANTIGRAVITY_RULES_TARGET}`);
  }
}

function main() {
  const body = fs.readFileSync(SOURCE, 'utf-8').trim();
  const block = `${START}\n\n${body}\n\n${END}`;

  syncMergedTargets(block);
  syncAntigravityRules(body);
}

main();

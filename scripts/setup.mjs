import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { INFRA_ROOT, CONFIG_PATH_EXPORTED } from './config.mjs';

function parseArgs(argv) {
  const args = { features: null, projectRoot: null, interactive: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-root') args.projectRoot = argv[++i];
    else if (a === '--features') args.features = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--no-interactive') args.interactive = false;
  }
  return args;
}

const ALL_FEATURES = ['docsRag', 'envTools', 'backlogMcp', 'bootstrap', 'lightrag'];
const DEFAULT_ON = ['docsRag', 'envTools', 'backlogMcp', 'bootstrap']; // lightrag — опционально, по умолчанию выключен

async function ask(rl, question, fallback) {
  const answer = (await rl.question(`${question} `)).trim();
  return answer === '' ? fallback : answer;
}

async function resolveInteractively(args) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    let projectRoot = args.projectRoot;
    if (projectRoot === null) {
      const mode = await ask(
        rl,
        'Эта папка — корень проекта (1) или подключена как подпапка в существующий проект (2)? [1]',
        '1',
      );
      if (mode === '2') {
        projectRoot = await ask(rl, 'Путь от этой папки до корня проекта [..]:', '..');
      } else {
        projectRoot = '.';
      }
    }

    let features = args.features;
    if (features === null) {
      features = [];
      for (const f of ALL_FEATURES) {
        const def = DEFAULT_ON.includes(f) ? 'Y/n' : 'y/N';
        const defAnswer = DEFAULT_ON.includes(f) ? 'y' : 'n';
        const label = {
          docsRag: 'Векторный RAG по документации (docs-rag, MCP)',
          envTools: 'MCP-инструменты работы с окружением (env-tools)',
          backlogMcp: 'Нативный MCP-сервер Backlog.md (backlog mcp start)',
          bootstrap: 'Кросс-платформенный bootstrap окружения (git/node/…)',
          lightrag: 'LightRAG — граф технической документации (Python + локальная LLM через Ollama, тяжело)',
        }[f];
        const answer = (await ask(rl, `${label}? [${def}]`, defAnswer)).toLowerCase();
        if (answer === 'y' || answer === 'yes' || answer === 'д' || answer === 'да') features.push(f);
      }
    }

    return { projectRoot, features };
  } finally {
    rl.close();
  }
}

const MCP_KEYS = ['docs-rag', 'env-tools', 'backlog', 'docs-graph'];

function buildDesiredMcpServers(prefix, features) {
  const desired = {};
  if (features.includes('docsRag')) {
    desired['docs-rag'] = { command: 'node', args: [`${prefix}scripts/rag/rag-server.mjs`] };
  }
  if (features.includes('envTools')) {
    desired['env-tools'] = { command: 'node', args: [`${prefix}scripts/env/env-server.mjs`] };
  }
  if (features.includes('backlogMcp')) {
    desired['backlog'] = { command: 'npx', args: ['--yes', 'backlog.md', 'mcp', 'start'] };
  }
  if (features.includes('lightrag')) {
    desired['docs-graph'] = { command: 'node', args: [`${prefix}scripts/lightrag/lightrag-server.mjs`] };
  }
  return desired;
}

// Пишем один и тот же набор mcpServers в оба формата конфига: `.mcp.json` читает Claude
// Code, `.agents/mcp_config.json` (тот же ключ mcpServers/command/args) — Google Antigravity.
// Чужие записи mcpServers не трогаем — синхронизируем только свои ключи из MCP_KEYS.
function writeMcpConfig(configPath, desired) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : { mcpServers: {} };
  existing.mcpServers ??= {};

  for (const key of MCP_KEYS) {
    if (desired[key]) existing.mcpServers[key] = desired[key];
    else delete existing.mcpServers[key];
  }

  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
  return configPath;
}

function mergeMcpConfig(projectRootAbs, features) {
  const relInfra = path.relative(projectRootAbs, INFRA_ROOT).split(path.sep).join('/');
  const prefix = relInfra ? `${relInfra}/` : '';
  const desired = buildDesiredMcpServers(prefix, features);

  const mcpPath = writeMcpConfig(path.join(projectRootAbs, '.mcp.json'), desired);
  const antigravityMcpPath = writeMcpConfig(path.join(projectRootAbs, '.agents', 'mcp_config.json'), desired);
  return [mcpPath, antigravityMcpPath];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const interactive = args.interactive !== false && (args.projectRoot === null || args.features === null) && process.stdin.isTTY;

  const resolved = interactive
    ? await resolveInteractively(args)
    : {
        projectRoot: args.projectRoot ?? '.',
        features: args.features ?? DEFAULT_ON,
      };

  for (const f of resolved.features) {
    if (!ALL_FEATURES.includes(f)) throw new Error(`Неизвестная фича: "${f}". Допустимые: ${ALL_FEATURES.join(', ')}`);
  }

  const config = {
    projectRoot: resolved.projectRoot,
    features: Object.fromEntries(ALL_FEATURES.map((f) => [f, resolved.features.includes(f)])),
  };
  fs.writeFileSync(CONFIG_PATH_EXPORTED, JSON.stringify(config, null, 2) + '\n');
  console.log(`Записан ${path.relative(INFRA_ROOT, CONFIG_PATH_EXPORTED)}:`);
  console.log(JSON.stringify(config, null, 2));

  const projectRootAbs = path.resolve(INFRA_ROOT, resolved.projectRoot);
  fs.mkdirSync(projectRootAbs, { recursive: true });
  const mcpPaths = mergeMcpConfig(projectRootAbs, resolved.features);
  console.log(
    `\nОбновлены ${mcpPaths.map((p) => path.relative(INFRA_ROOT, p)).join(', ')} ` +
      '(записи docs-rag/env-tools/backlog/docs-graph синхронизированы с включёнными фичами).',
  );

  console.log('\nДальше:');
  if (config.features.docsRag) console.log('  npm run index-docs     # собрать векторный индекс документации');
  if (config.features.bootstrap) console.log('  npm run bootstrap       # поставить git/node/… под текущую ОС');
  if (config.features.lightrag) {
    console.log('  npm run lightrag-setup  # ОДНОРАЗОВО: venv, lightrag-hku, модели Ollama (несколько ГБ, отдельный шаг)');
    console.log('  npm run lightrag-index  # построить граф документации');
  }
  console.log('  npm run sync-rules      # разослать infra-dev.md в CLAUDE.md/GEMINI.md/AGENTS.md целевого проекта');
}

main();

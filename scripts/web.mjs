import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { PROJECT_ROOT } from './config.mjs';

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort = 6420, endPort = 6500) {
  for (let port = startPort; port <= endPort; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  return 6420;
}

const action = process.argv[2] ?? 'start';

if (action === 'start') {
  if (!fs.existsSync(path.join(PROJECT_ROOT, 'backlog'))) {
    console.error('❌ Каталог backlog/ не найден. Сначала выполните: npx backlog.md init');
    process.exit(1);
  }

  const port = await findAvailablePort(6420, 6500);
  console.log(`\n🔍 Найден свободный порт: ${port}`);
  console.log(`🌐 Запуск Backlog.md интерфейса на http://localhost:${port} ...\n`);

  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(cmd, ['--yes', 'backlog.md', 'browser', '--port', String(port), '--non-interactive'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
} else if (action === 'status') {
  console.log('Для запуска веб-интерфейса используйте start-web.bat или node scripts/web.mjs start');
} else if (action === 'stop') {
  console.log('Для остановки сервера просто закройте окно терминала или нажмите Ctrl+C.');
} else {
  console.error('Использование: node scripts/web.mjs [start|stop|status]');
  process.exit(1);
}

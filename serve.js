'use strict';

// Простой локальный сервер для проверки приложения: node serve.js [порт] [--open]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const root = __dirname;
const port = Number(process.argv.find((a) => /^\d+$/.test(a))) || 8080;
const url = `http://localhost:${port}`;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.md': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, url).pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Не найдено');
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`Приложение запущено: ${url}`);
  console.log('Не закрывайте это окно, пока пользуетесь приложением. Остановить: Ctrl+C.');
  if (process.argv.includes('--open')) {
    const cmd = process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd);
  }
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Порт ${port} занят. Возможно, приложение уже запущено — откройте ${url}`);
  else console.error(e.message);
  process.exitCode = 1;
});

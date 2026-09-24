#!/usr/bin/env node
/* ============================================================================
 * server.js —— 零依赖开发服务器（只有 Node 内置模块，npm install 都不用跑）
 * ---------------------------------------------------------------------------
 * /            -> index.html，并把 src/manifest.json 里的每个模块注入成一排
 *                 <script src="/src/xxx.js"></script>（多文件开发形态）
 * /src/*.js    -> 源文件（no-store，改完刷新即可）
 * /dist/*      -> npm run build 产出的单文件版
 * 其它          -> 项目内的静态文件（README、reference/ 等）
 * 用法：node server.js [--port 9240] [--host 127.0.0.1] [--open]
 * ==========================================================================*/
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const MANIFEST_FILE = path.join(ROOT, 'src', 'manifest.json');
// 默认端口：9240 取自参考图宽度 924（原版 --width 的默认值），也是本项目自己的号；
// 特意避开各种工具链的默认值 —— 5173 是 Vite、3000 是 Next/Express、8000 是
// python -m http.server、4173 是 vite preview。这里跟 Vite 没有任何关系。
const DEFAULT_PORT = 9240;
const PLACEHOLDER = '<!--SCRIPTS-->';

/**
 * **每次都重新读** manifest：开发服务器是长驻进程，而 manifest 会在开发过程中
 * 增删模块（比如新加了 ui.js）。早先这里缓存了一份，结果"manifest 变了但服务器
 * 还是注入旧列表"，页面少了入口模块 —— 模块全都加载成功、却什么都没构造，
 * 表现为**空白画面 + 控制台零输出**，极难排查。缓存这点开销不值得冒这个险。
 */
function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.py': 'text/x-python; charset=utf-8'
};

function readIndex() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const manifest = loadManifest();
  const missing = manifest.files.filter((f) => !fs.existsSync(path.join(ROOT, 'src', f)));
  if (missing.length) console.error('manifest 里列了不存在的模块: ' + missing.join(', '));
  const tags = manifest.files
    .map((f) => `<script src="/src/${f}"></script>`)
    .join('\n');
  return html.replace(PLACEHOLDER, tags);
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function serveStatic(res, file) {
  // 只允许项目目录内的文件
  const full = path.resolve(ROOT, '.' + file);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden\n');
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, 'not found: ' + file + '\n');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}

function handler(req, res) {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/' || url === '/index.html') return send(res, 200, readIndex(), MIME['.html']);
  serveStatic(res, url);
}

function parseArgs(argv) {
  const a = { port: Number(process.env.PORT) || DEFAULT_PORT, host: '127.0.0.1', open: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') a.port = Number(argv[++i]);
    else if (argv[i] === '--host') a.host = argv[++i];
    else if (argv[i] === '--open' || argv[i] === '-o') a.open = true;
    else if (argv[i] === '--help' || argv[i] === '-h') a.help = true;
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`用法: node server.js [--port ${DEFAULT_PORT}] [--host 127.0.0.1] [--open]\n`);
    return;
  }
  const server = http.createServer(handler);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${args.port} 被占用，换一个：node server.js --port ${args.port + 1}`);
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });
  server.listen(args.port, args.host, () => {
    const url = `http://${args.host}:${args.port}/`;
    console.log('烟花 · Fireworks（开发形态：多文件）');
    console.log('  ' + url);
    console.log('  注入的模块: ' + loadManifest().files.join(' -> '));
    console.log('  换端口:     node server.js --port 8080');
    console.log('  单文件版:   npm run build  ->  dist/turtle_fireworks.html（可直接双击打开）');
    if (args.open) execFile('open', [url], () => {});
  });
}

main();

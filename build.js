#!/usr/bin/env node
/* ============================================================================
 * build.js —— 把 index.html + src/*.js 打成**一个自包含的 HTML 文件**
 * ---------------------------------------------------------------------------
 * 产物 dist/turtle_fireworks.html 不依赖服务器、不依赖网络，双击就能放
 * （也可以挂到任何静态托管上）。构建时顺带检查每个源文件的体量：
 * 超过 manifest 里的 maxLines（默认 300 行）直接报错退出。
 * 用法：node build.js [--out dist/xxx.html] [--check] [--force]
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const PLACEHOLDER = '<!--SCRIPTS-->';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));
const MAX_LINES = MANIFEST.maxLines || 300;

// 体量检查也要管住这几个文件（原版 1171 行，所以拆成多文件而不是单文件）
const CHECK_FILES = MANIFEST.files.map((f) => path.join('src', f))
  .concat(['index.html', 'server.js', 'build.js']);

function countLines(text) {
  const s = text.replace(/\s+$/, '');
  return s === '' ? 0 : s.split('\n').length;
}

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function parseArgs(argv) {
  const a = { out: path.join(ROOT, 'dist', 'turtle_fireworks.html'), check: false,
              force: false, stamp: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out' || argv[i] === '-o') a.out = path.resolve(argv[++i]);
    else if (argv[i] === '--check') a.check = true;
    else if (argv[i] === '--force') a.force = true;
    else if (argv[i] === '--stamp') a.stamp = true;   // 在产物里写入构建时间（默认不写）
  }
  return a;
}

/** 体量体检：返回 { rows, over }。 */
function audit() {
  const rows = [];
  let over = 0;
  for (const rel of CHECK_FILES) {
    const text = read(rel);
    const n = countLines(text);
    if (n > MAX_LINES) over++;
    rows.push({ rel, lines: n, bytes: Buffer.byteLength(text) });
  }
  return { rows, over };
}

function printAudit(rows) {
  console.log(`体量体检（每个文件 ≤ ${MAX_LINES} 行）`);
  for (const r of rows) {
    const flag = r.lines > MAX_LINES ? '  ✗ 超了' : '';
    console.log(`  ${r.lines.toString().padStart(4)} 行  ${(r.bytes / 1024).toFixed(1).padStart(6)} KB  ${r.rel}${flag}`);
  }
}

function build(args) {
  const html = read('index.html');
  if (!html.includes(PLACEHOLDER)) {
    console.error(`index.html 里找不到 ${PLACEHOLDER} 占位符，无法注入脚本。`);
    process.exit(1);
  }
  const parts = [];
  let srcLines = 0;
  for (const f of MANIFEST.files) {
    const code = read(path.join('src', f)).replace(/\s+$/, '');
    srcLines += countLines(code);
    parts.push(`/* ===================== src/${f} ===================== */\n${code}`);
  }
  // 默认**不写构建时间**：同样的源文件构建出来的字节完全一致。dist 是要入库的
  // 交付物，产物可复现才不会每次重建都产生一堆无谓 diff（要时间戳就加 --stamp）。
  const banner = [
    '<!--',
    '  烟花 · Canvas 复刻版 —— 单文件版（由 npm run build 生成，请勿直接编辑）',
    '  改动请改 index.html 与 src/*.js，然后重新 npm run build。',
    `  模块: ${MANIFEST.files.join(' -> ')}`,
    args.stamp ? `  构建: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}` : null,
    '-->'
  ].filter((line) => line !== null).join('\n');
  const inline = `<script>\n${parts.join('\n\n')}\n</script>`;
  const out = banner + '\n' + html.replace(PLACEHOLDER, () => inline);

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, out);

  // 产物自检：单文件版必须是自包含的，源码一个都不能漏
  const back = fs.readFileSync(args.out, 'utf8');
  const broken = [];
  if (back.includes(PLACEHOLDER)) broken.push('占位符没被替换');
  if (/<script[^>]+src=/.test(back)) broken.push('还引用了外部脚本');
  for (const f of MANIFEST.files) {
    if (!back.includes(`===== src/${f} =====`)) broken.push(`漏了 src/${f}`);
  }
  if (broken.length) {
    console.error('产物自检失败: ' + broken.join('；'));
    process.exit(1);
  }
  const raw = Buffer.byteLength(out);
  const gz = zlib.gzipSync(Buffer.from(out)).length;
  const rel = path.relative(ROOT, args.out);
  console.log(`\n单文件版已生成: ${rel}`
    + `  (${new Date().toISOString().replace('T', ' ').slice(0, 19)})`);
  console.log(`  ${MANIFEST.files.length} 个模块 / ${srcLines} 行 JS + HTML`
    + `  ->  ${(raw / 1024).toFixed(1)} KB（gzip ${(gz / 1024).toFixed(1)} KB）`);
  console.log(`  自检通过: 自包含、无外部脚本、${MANIFEST.files.length} 个模块齐全`);
  console.log('  直接双击打开，或用任意静态服务器托管都能跑。');
}

function main() {
  const args = parseArgs(process.argv);
  const { rows, over } = audit();
  printAudit(rows);
  if (over > 0 && !args.force) {
    console.error(`\n有 ${over} 个文件超过 ${MAX_LINES} 行：请拆文件，或用 --force 放行。`);
    process.exit(1);
  }
  if (args.check) {
    console.log(`\n体检通过（--check 不写产物）。`);
    return;
  }
  build(args);
}

main();

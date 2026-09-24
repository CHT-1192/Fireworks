/* ============================================================================
 * pw.js —— Playwright 与开发服务器的公共件
 * ---------------------------------------------------------------------------
 * 用 playwright-core 驱动**系统已装的** Chrome/Chromium（executablePath），
 * 不下载它自带的浏览器：这台机器上就是 /Applications/Chromium.app。
 *
 * 有了 Playwright，浏览器级自检就是"真"的：真键盘、真鼠标、真控制台、真截图，
 * 不再需要 --dump-dom 轮询、iframe 转发合成事件那一套。
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

const EXES = [
  process.env.CHROME,
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome'
].filter(Boolean);

/** 本机可用的 Chrome/Chromium 路径（找不到返回 null）。 */
function findChrome() {
  for (const p of EXES) if (fs.existsSync(p)) return p;
  return null;
}

let chromium = null;
try {
  chromium = require('playwright-core').chromium;
} catch (e) {
  chromium = null;
}

/** 缺依赖或浏览器时给出人话，调用方据此退出。 */
function whyUnavailable() {
  if (!chromium) {
    return '浏览器自检需要 playwright-core：npm i（它只驱动系统已装的 Chrome/Chromium，不下载浏览器）';
  }
  if (!findChrome()) {
    return '找不到 Chrome/Chromium（用 CHROME=/path/to/chrome 指定）';
  }
  return null;
}

/** 起一个浏览器。用完记得 browser.close()。 */
function launch() {
  const exe = findChrome();
  if (!chromium || !exe) throw new Error(whyUnavailable());
  return chromium.launch({
    executablePath: exe,
    // 这台机器（以及大多数容器）里 Chromium 自己的沙箱起不来，一律关掉
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--no-first-run']
  });
}

/** 打开一页，顺手把控制台输出收进 logs 数组。 */
async function openPage(browser, url, o) {
  o = o || {};
  const page = await browser.newPage({
    viewport: o.viewport || { width: 1280, height: 800 },
    deviceScaleFactor: o.scale || 1
  });
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  return { page, logs };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpText(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? await res.text() : null;
  } catch (e) {
    return null;
  }
}

/** 开发服务器没在跑就自己起一个；返回子进程（用完 kill）或 null（复用已有的）。 */
async function ensureServer(port) {
  const base = `http://127.0.0.1:${port}`;
  if (await httpText(base + '/src/manifest.json')) return null;
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(port)],
                     { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await httpText(base + '/src/manifest.json')) return proc;
  }
  try { proc.kill('SIGKILL'); } catch (e) { /* 起不来就算了 */ }
  return undefined;                          // undefined = 起不来
}

module.exports = { ROOT, sleep, findChrome, whyUnavailable, launch, openPage,
                   httpText, ensureServer };

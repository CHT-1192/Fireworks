#!/usr/bin/env node
/* ============================================================================
 * browser_check.js —— 真实浏览器里的端到端自检（不需要 golden 图）
 * ---------------------------------------------------------------------------
 * 假 canvas（render_smoke）只能验证"渲染器下了哪些指令"，验证不了"页面在真实
 * 浏览器里到底跑没跑起来"：canvas 尺寸算错、CSS 把它盖住、脚本报错导致循环停摆、
 * 或者**少加载了一个模块**，这些都只有真浏览器能发现。这里查两条路：
 *
 *   A) 交付路径：file:// 打开 dist 的单文件版，定格在某一帧，从 DOM 里的 HUD 读数
 *      断言：没报错（app.js 的异常兜底会写进 HUD）、图元/线段数不为零（画面非空）、
 *      时刻与 ?frames 一致（固定 1/60 步长按预期推进）、?ui=0 真的收起了 UI。
 *
 *   B) 开发路径：http://127.0.0.1:9240/ 的**多文件**页面。这一条曾经漏掉，结果
 *      服务器缓存了旧的 manifest、少注入入口模块 ui.js —— 页面模块全加载成功却
 *      什么都没构造，表现为空白画面 + 控制台零输出。所以这里额外比对
 *      "注入的 <script> 列表" 与 src/manifest.json 必须一致。
 *
 * 找不到浏览器时：A 跳过、B 的列表比对仍然要跑（它不需要浏览器）。
 * 用法：node tools/browser_check.js      （CHROME=/path/to/chrome 可指定）
 * ==========================================================================*/
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'turtle_fireworks.html');
const MANIFEST = path.join(ROOT, 'src', 'manifest.json');
const PORT = Number(process.env.PORT) || 9240;
const BASE = `http://127.0.0.1:${PORT}`;
const DT = 1 / 60;

const BROWSERS = [
  process.env.CHROME,
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome'
].filter(Boolean);

const DIST_CASES = [
  // 第 1 帧（still=1）只有两枚上升中的弹体、尾迹还没成形，所以只要求"画了东西"
  { name: 'classic 第1帧', q: 'scene=classic&seed=7&still=1&w=924&h=691', time: 0, segs: false, scene: 'classic' },
  // 彩蛋规则：数字种子 -> 纯随机秀；敲对密语 -> 参考图风格；乱敲的字母 -> 不认
  { name: '数字种子→纯随机', q: 'seed=7&still=1&w=924&h=691', time: 0, segs: false, scene: 'random' },
  { name: '那个词→参考图风格', q: 'seed=' + readSecret() + '&still=1&w=924&h=691', time: 0, segs: false, scene: 'classic' },
  { name: '乱敲字母→退回数字', q: 'seed=KQXW&still=1&w=924&h=691', time: 0, segs: false, scene: 'random' },
  { name: 'classic 第150帧', q: 'scene=classic&seed=7&frames=150&w=924&h=691', time: 149 * DT, segs: true },
  { name: 'random 第150帧', q: 'scene=random&seed=42&frames=150&w=924&h=691', time: 149 * DT, segs: true },
  { name: 'random 第150帧(无UI)', q: 'scene=random&seed=42&frames=150&w=924&h=691&ui=0', time: 149 * DT, segs: true, uiHidden: true }
];

function findBrowser() {
  for (const b of BROWSERS) if (fs.existsSync(b)) return b;
  return null;
}

/* ------------------------------------------------------------ 小工具 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpText(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? await res.text() : null;
  } catch (e) {
    return null;                             // 没起服务器就是连不上
  }
}

/**
 * 无头浏览器 --dump-dom（Chromium 有时不会自己退出，所以轮询到 HUD 出现就收工）。
 * 同时用 --enable-logging=stderr 把页面 console 的输出捞回来 —— 彩蛋打的就是控制台，
 * 不然没法自动验。返回 { html, log }。
 */
function dumpDom(bin, url, waitFor) {
  const ready = waitFor || /id="hud-state"/;
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fwcheck-'));
    const p = spawn(bin, ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox',
      '--disable-dev-shm-usage', '--no-first-run', '--user-data-dir=' + profile,
      '--enable-logging=stderr', '--log-level=0',
      '--virtual-time-budget=4000', '--dump-dom', url],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', log = '', done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll); clearTimeout(guard);
      try { p.kill('SIGKILL'); } catch (e) { /* 已经退出了 */ }
      // 刚 SIGKILL 掉，Chromium 的子进程可能还在写 profile —— 清理失败不该让自检挂掉
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (e) { /* 留在系统临时目录里也无妨 */ }
      resolve({ html: out, log });
    };
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { log += d; });
    const poll = setInterval(() => { if (ready.test(out)) finish(); }, 300);
    const guard = setTimeout(finish, 45000);
    p.on('close', finish);
    p.on('error', reject);
  });
}

/** 从 src/app.js 里读彩蛋密语（测试需要知道它，但不该把它硬编码在这儿）。 */
function readSecret() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  const m = src.match(/var SECRET = '([^']+)'/);
  if (!m) throw new Error('src/app.js 里找不到 SECRET');
  return m[1];
}

function consoleLines(log) {
  return log.split('\n').filter((l) => /CONSOLE/.test(l)).join('\n        ');
}

function hud(html, id) {
  const m = html.match(new RegExp('id="hud-' + id + '"[^>]*>([^<]*)<'));
  return m ? m[1].trim() : null;
}

/** 按用例断言 HUD 读数，返回 { problems, ... }（problems 为空即通过）。 */
function checkHud(html, c) {
  const problems = [];
  const state = hud(html, 'state');
  const geos = Number(hud(html, 'geos'));
  const segs = Number(hud(html, 'segs'));
  const time = Number(String(hud(html, 'time')).replace('s', ''));
  if (!/canvas id="stage"/.test(html)) problems.push('页面里没有 canvas');
  if (!/<title>烟花 · Fireworks/.test(html)) problems.push('标题不是「烟花 · Fireworks」');
  if (state === null) problems.push('没读到 HUD（脚本没跑起来？）');
  else if (/出错/.test(state)) problems.push(`脚本报错：${state}`);
  else if (state !== '已定格') problems.push(`状态是「${state}」，应为「已定格」`);
  if (!(geos > 0)) problems.push(`图元数 ${hud(html, 'geos')} 不为正 —— 画面是空的`);
  if (c.segs && !(segs > 0)) problems.push(`线段数 ${hud(html, 'segs')} 不为正`);
  if (!(Math.abs(time - c.time) < 0.05)) problems.push(`时刻 ${time}s，预期 ${c.time.toFixed(2)}s`);
  if (c.uiHidden && !/id="panel"[^>]*hidden/.test(html)) problems.push('?ui=0 但控制台没收起');
  const scene = hud(html, 'scene');
  if (c.scene && scene !== c.scene) problems.push(`场景是「${scene}」，应为「${c.scene}」`);
  return { problems, state, geos, segs, time, scene };
}

function line(ok, name, detail) {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name.padEnd(22)} ${detail}`);
}

function report(name, r) {
  line(r.problems.length === 0, name,
       `时刻 ${String(r.time).padStart(4)}s  图元 ${String(r.geos).padStart(4)}  `
       + `线段 ${String(r.segs).padStart(4)}  场景 ${String(r.scene).padEnd(7)} 状态 ${r.state}`
       + (r.problems.length ? '\n        ' + r.problems.join('\n        ') : ''));
}

/* ------------------------------------------------------------ A) 交付路径 */

async function checkDist(bin) {
  console.log('A) 交付路径：file:// 打开构建产物 ' + path.relative(ROOT, DIST));
  if (!fs.existsSync(DIST)) {
    console.log(' FAIL  dist/turtle_fireworks.html 不存在，先跑 npm run build');
    return 1;
  }
  if (!bin) {
    console.log('  跳过：找不到 Chrome/Chromium（用 CHROME=/path/to/chrome 指定）');
    return 0;
  }
  let bad = 0;
  for (const c of DIST_CASES) {
    const { html } = await dumpDom(bin, 'file://' + DIST + '?' + c.q);
    const r = checkHud(html, c);
    bad += r.problems.length;
    report(c.name, r);
  }
  return bad;
}

/* ------------------------------------------------------------ B) 开发路径 */

/** 没在跑就自己起一个；返回子进程（结束时 kill）、null（复用已有的）、undefined（起不来）。 */
async function ensureServer() {
  if (await httpText(BASE + '/src/manifest.json')) return null;
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(PORT)],
                     { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await httpText(BASE + '/src/manifest.json')) return proc;
  }
  try { proc.kill('SIGKILL'); } catch (e) { /* 起不来就算了 */ }
  return undefined;
}

async function checkDev(bin) {
  console.log('\nB) 开发路径：' + BASE + '/（多文件）');
  const proc = await ensureServer();
  if (proc === undefined) {
    console.log(` FAIL  开发服务器起不来（端口 ${PORT} 被占用？）`);
    return 1;
  }
  let bad = 0;
  try {
    // B1) 注入的脚本列表必须与 manifest 完全一致 —— 不需要浏览器，专门盯
    //     "服务器缓存了旧 manifest / manifest 里列了不存在的文件"
    const want = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).files;
    const html = await httpText(BASE + '/');
    const got = html
      ? [...html.matchAll(/<script src="\/src\/([^"]+)"><\/script>/g)].map((m) => m[1])
      : null;
    if (!got) {
      bad++;
      console.log(' FAIL  注入模块列表        读不到首页');
    } else if (got.join() !== want.join()) {
      bad++;
      console.log(' FAIL  注入模块列表        与 manifest 不一致'
        + '\n        manifest: ' + want.join(', ')
        + '\n        页面注入: ' + got.join(', ')
        + '\n        （服务器是长驻进程，改完 manifest 要重启它）');
    } else {
      line(true, '注入模块列表', `${got.length} 个模块与 manifest 一致`);
    }

    // B2) 真浏览器打开开发页：多文件这条路也得真的出画面
    if (!bin) {
      console.log('  跳过：找不到 Chrome/Chromium，只做了上面的列表比对');
      return bad;
    }
    const c = { time: 149 * DT, segs: true };
    const { html: dom } = await dumpDom(bin, BASE + '/?scene=classic&seed=7&frames=150&w=924&h=691');
    const r = checkHud(dom, c);
    bad += r.problems.length;
    report('开发页出画面', r);

    // B3) 控制台便条：只给"有几个字母"，**不能**把那个词本身打出来
    const SECRET = readSecret();
    const num = await dumpDom(bin, BASE + '/?seed=7&frames=30&w=924&h=691');
    const numOk = new RegExp(SECRET.length + ' 个字母').test(num.log)
      && !num.log.includes(SECRET);
    bad += numOk ? 0 : 1;
    line(numOk, '控制台便条',
         numOk ? `提了"${SECRET.length} 个字母"、没写出那个词` : '文案不符合预期或写出了那个词');
    if (!numOk) console.log('        ' + consoleLines(num.log));

    // B4) 逐字符守卫：在真浏览器里一个字母一个字母敲（夹具页驱动，不用 CDP）
    const probe = await dumpDom(bin, BASE + '/tools/typing_probe.html', /probe-(ok|fail)/);
    const m = probe.html.match(/id="probe">(probe-(?:ok|fail)\s*[\s\S]*?)<\/pre>/);
    const okTyping = !!m && m[1].indexOf('probe-ok') === 0;
    bad += okTyping ? 0 : 1;
    if (okTyping) {
      const detail = JSON.parse(m[1].replace(/^probe-ok\s*/, ''));
      line(true, '逐字符拼词', detail.steps.join('；'));
    } else {
      line(false, '逐字符拼词',
           m ? JSON.parse(m[1].replace(/^probe-fail\s*/, '')).problems.join('；') : '夹具页没给出结果');
    }
  } finally {
    if (proc) { try { proc.kill('SIGKILL'); } catch (e) { /* 已退出 */ } }
  }
  return bad;
}

async function main() {
  const bin = findBrowser();
  console.log('真浏览器端到端自检' + (bin ? '' : '（没找到浏览器：只做 HTTP 层比对）'));
  console.log('─'.repeat(84));
  let bad = await checkDist(bin);
  bad += await checkDev(bin);
  console.log('─'.repeat(84));
  console.log(bad
    ? `结论：${bad} 处不对`
    : '结论：交付路径与开发路径都能跑起来，画面非空，参数符合预期 ✓');
  return bad ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });

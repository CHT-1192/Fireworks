#!/usr/bin/env node
/* ============================================================================
 * browser_check.js —— 真实浏览器里的端到端自检（不需要 golden 图）
 * ---------------------------------------------------------------------------
 * 假 canvas（render_smoke）只能验证"渲染器下了哪些指令"，验证不了"页面在真实
 * 浏览器里到底跑没跑起来"：canvas 尺寸算错、CSS 把它盖住、脚本报错导致循环停摆，
 * 这些都只有真浏览器能发现。所以这里用无头浏览器打开**构建出的单文件版**，让它
 * 定格在某一帧，然后从 DOM 里的 HUD 读数断言：
 *
 *   * 状态是「已定格」，不是「出错: ...」（app.js 的单帧异常兜底会把它写进 HUD）
 *   * 图元数 / 线段数 > 0（证明主循环与渲染器都真的跑了，画面不是空的）
 *   * 时刻与 --frames 的预期一致（证明固定 1/60 步长按预期推进）
 *   * ?ui=0 时控制台确实被收起
 *
 * 用 file:// 打开，所以顺带验证了"双击就能放"。找不到浏览器时打印提示并跳过。
 * 用法：node tools/browser_check.js        （CHROME=/path/to/chrome 可指定）
 * ==========================================================================*/
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'turtle_fireworks.html');
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

const CASES = [
  // original 场景全是填充图元（辐条/发射尾迹是矩形，圆点是多边形），没有折线，
  // 所以那一格只要求"画了东西"，不要求线段数
  { name: '原版复刻单帧', q: 'scene=original&still=1&w=924&h=691', time: 0, segs: false },
  { name: 'classic 第150帧', q: 'scene=classic&seed=7&frames=150&w=924&h=691', time: 149 * DT, segs: true },
  { name: 'random 第150帧', q: 'scene=random&seed=42&frames=150&w=924&h=691', time: 149 * DT, segs: true },
  { name: 'random 第150帧(无UI)', q: 'scene=random&seed=42&frames=150&w=924&h=691&ui=0', time: 149 * DT, segs: true, uiHidden: true }
];

function findBrowser() {
  for (const b of BROWSERS) if (fs.existsSync(b)) return b;
  return null;
}

/** 无头浏览器 --dump-dom（Chromium 有时不会自己退出，所以轮询到 HUD 出现就收工）。 */
function dumpDom(bin, url) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fwcheck-'));
    const p = spawn(bin, ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox',
      '--disable-dev-shm-usage', '--no-first-run', '--user-data-dir=' + profile,
      '--virtual-time-budget=4000', '--dump-dom', url], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '', done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll); clearTimeout(guard);
      try { p.kill('SIGKILL'); } catch (e) { /* 已经退出了 */ }
      fs.rmSync(profile, { recursive: true, force: true });
      resolve(out);
    };
    p.stdout.on('data', (d) => { out += d; });
    const poll = setInterval(() => { if (/id="hud-state"/.test(out)) finish(); }, 300);
    const guard = setTimeout(finish, 45000);
    p.on('close', finish);
    p.on('error', reject);
  });
}

function hud(html, id) {
  const m = html.match(new RegExp('id="hud-' + id + '"[^>]*>([^<]*)<'));
  return m ? m[1].trim() : null;
}

async function main() {
  if (!fs.existsSync(DIST)) {
    console.error('还没有 dist/turtle_fireworks.html，先跑 npm run build');
    return 1;
  }
  const bin = findBrowser();
  if (!bin) {
    console.log('找不到 Chrome/Chromium —— 跳过真浏览器自检。');
    console.log('（用 CHROME=/path/to/chrome 指定，或忽略；npm run baseline 不受影响）');
    return 0;
  }
  console.log('真浏览器端到端自检：' + path.relative(ROOT, DIST) + '（file:// 打开）');
  console.log('─'.repeat(84));

  let bad = 0;
  for (const c of CASES) {
    const url = 'file://' + DIST + '?' + c.q;
    const html = await dumpDom(bin, url);
    const problems = [];
    const state = hud(html, 'state');
    const geos = Number(hud(html, 'geos'));
    const segs = Number(hud(html, 'segs'));
    const time = Number(hud(html, 'time').replace('s', ''));
    if (!/canvas id="stage"/.test(html)) problems.push('页面里没有 canvas');
    if (state === null) problems.push('没读到 HUD（脚本可能没跑起来）');
    else if (/出错/.test(state)) problems.push(`脚本报错：${state}`);
    else if (state !== '已定格') problems.push(`状态是「${state}」，应为「已定格」`);
    if (!(geos > 0)) problems.push(`图元数 ${hud(html, 'geos')} 不为正`);
    if (c.segs && !(segs > 0)) problems.push(`线段数 ${hud(html, 'segs')} 不为正`);
    if (!(Math.abs(time - c.time) < 0.05)) {
      problems.push(`时刻 ${time}s，预期 ${c.time.toFixed(2)}s`);
    }
    if (c.uiHidden && !/id="panel"[^>]*hidden/.test(html)) problems.push('?ui=0 但控制台没收起');
    bad += problems.length;
    console.log(`${problems.length ? ' FAIL ' : '  OK  '} ${c.name.padEnd(20)} `
      + `时刻 ${String(time).padStart(4)}s  图元 ${String(geos).padStart(4)}  `
      + `线段 ${String(segs).padStart(4)}  状态 ${state}`
      + (problems.length ? '\n        ' + problems.join('\n        ') : ''));
  }
  console.log('─'.repeat(84));
  console.log(bad ? `结论：${bad} 处不对` : '结论：真实浏览器里跑得通，画面非空，固定步长与 UI 参数都符合预期 ✓');
  return bad ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });

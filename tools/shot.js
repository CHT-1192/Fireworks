#!/usr/bin/env node
/* ============================================================================
 * shot.js —— 一条命令截一张图（预览图必须是可复现的）
 * ---------------------------------------------------------------------------
 *   node tools/shot.js --out docs/preview/ui.png --url "?seed=7&frames=1&max=1500"
 *   node tools/shot.js --out x.png --url "?seed=7" --spam 16 --step 200 --size 1280x800
 *
 * --spam N   先按 N 次 R（真键盘，走的是和真人一样的快捷键路径）
 * --step M   然后**同步**推进 M 个固定步再截图。
 *
 * 可复现的做法：URL 里带 frames=N（或 still=1）让页面一进来就是定格状态，再配合
 * --spam/--step —— 这样画面逐像素可复现（只有 HUD 里的 fps 读数会随实时计时变化）。
 * 没定格也能截，但按键与推帧之间会混进不确定的 rAF 帧。
 * 需要 npm i（playwright-core）+ 系统已装的 Chrome/Chromium；开发服务器会自动起。
 * ==========================================================================*/
'use strict';

const path = require('path');
const pw = require('./pw');

const PORT = Number(process.env.PORT) || 9240;
const BASE = `http://127.0.0.1:${PORT}`;

function parseArgs(argv) {
  const a = { url: '/?seed=7&frames=150', out: null, size: '1280x800', spam: 0, step: 0 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--url') a.url = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--size') a.size = argv[++i];
    else if (k === '--spam') a.spam = Number(argv[++i]);
    else if (k === '--step') a.step = Number(argv[++i]);
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv);
  if (!a.out) {
    console.error('用法: node tools/shot.js --out <PNG> [--url "?seed=7&frames=150"]'
      + ' [--size 1280x800] [--spam 16] [--step 200]');
    return 2;
  }
  const why = pw.whyUnavailable();
  if (why) {
    console.error(why);
    return 1;
  }
  const proc = await pw.ensureServer(PORT);
  if (proc === undefined) {
    console.error(`开发服务器起不来（端口 ${PORT} 被占用？）`);
    return 1;
  }
  const size = a.size.split('x').map(Number);
  let browser = null;
  try {
    browser = await pw.launch();
    const { page } = await pw.openPage(browser, BASE + '/' + a.url.replace(/^\//, ''),
                                       { viewport: { width: size[0], height: size[1] } });
    if (a.spam > 0 || a.step > 0) {
      // 先冻住再按键：这样按键之间不会混进不确定的 rAF 帧
      await page.evaluate(() => { window.FW.app.instance.paused = true; });
      await page.click('#stage');                       // 把焦点从任何输入框上挪开
      for (let i = 0; i < a.spam; i++) await page.keyboard.press('r');
      await page.evaluate((steps) => {
        const app = window.FW.app.instance;
        app.paused = true;                              // 冻住，后面手动推
        for (let i = 0; i < steps; i++) app.show.step(1 / 60);
        app.renderer.draw(app.show.frameGeos);
        app.hud();
      }, a.step);
    }
    await page.screenshot({ path: a.out });
    console.log(`已截图 ${path.relative(process.cwd(), a.out)}`
      + `（${a.size}${a.spam ? `，按了 ${a.spam} 次 R` : ''}${a.step ? `，推进 ${a.step} 帧` : ''}）`);
  } finally {
    if (browser) await browser.close();
    if (proc) { try { proc.kill('SIGKILL'); } catch (e) { /* 已退出 */ } }
  }
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });

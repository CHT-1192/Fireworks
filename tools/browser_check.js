#!/usr/bin/env node
/* ============================================================================
 * browser_check.js —— 真浏览器里的端到端自检（Playwright + 系统 Chromium）
 * ---------------------------------------------------------------------------
 * 假 canvas（render_smoke）只能验证"渲染器下了哪些指令"，验证不了"页面在真实
 * 浏览器里到底跑没跑起来"。这里用 Playwright 真开页面、真打字、真按键，查两条路：
 *
 *   A) 交付路径：file:// 打开 dist 的单文件版，定格在某一帧，读 HUD 断言：
 *      标题对、没报错、画面非空、场景与种子规则一致、?ui=0 彻底无 UI。
 *   B) 开发路径：开发服务器的多文件页面。除了出画面，还要
 *      ① 注入的 <script> 列表 == src/manifest.json（曾经因为服务器缓存旧 manifest
 *         少注入入口模块，页面全加载成功却什么都没构造：空白 + 控制台零输出）；
 *      ② 控制台便条只提字母个数、不写出那个词；
 *      ③ 真键盘逐字符拼那个词（敲对留下、敲错弹回）；
 *      ④ 快捷键：滑块聚焦时 R 要能放，种子框打字时 R 不放，回车收焦点，Esc 随时有效。
 *   C) 录制：真按「录制」-> 面板收起 -> 停止 -> 下载的 WebM 能被 ffprobe 读到
 *      SEED 元数据、能被浏览器解码、文件名带种子（没有 ffprobe 就跳过元数据那一步）。
 *   D) 交互：点画面在该处炸（坐标换算对不对）、每日按钮跳到当天种子、复制链接把
 *      可用链接写进剪贴板、全屏按钮真的进全屏；存图下载的 PNG 里要带种子与链接的
 *      元数据（并且图本身还能解码）。
 *
 * 缺 playwright-core 或浏览器时：A 跳过、B 的列表比对仍然要跑。
 * 用法：node tools/browser_check.js      （npm i 一次；CHROME= 可指定浏览器）
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const pw = require('./pw');
const FWPNG = require('./loader').loadSim(['pngmeta.js']);

const DIST = path.join(pw.ROOT, 'dist', 'turtle_fireworks.html');
const MANIFEST = path.join(pw.ROOT, 'src', 'manifest.json');
const PORT = Number(process.env.PORT) || 9240;
const BASE = `http://127.0.0.1:${PORT}`;
const DT = 1 / 60;

/** 从 src/app.js 里读那个词（测试需要知道它，但不该硬编码，也不该打出来）。 */
function readSecret() {
  const src = fs.readFileSync(path.join(pw.ROOT, 'src', 'app.js'), 'utf8');
  const m = src.match(/var SECRET = '([^']+)'/);
  if (!m) throw new Error('src/app.js 里找不到 SECRET');
  return m[1];
}

const DIST_CASES = [
  // 第 1 帧只有两枚上升中的弹体（尾迹还没成形），所以只要求"画了东西"
  { name: 'classic 第1帧', q: 'scene=classic&seed=7&still=1', time: 0, segs: false, scene: 'classic' },
  // 种子规则：数字 -> 纯随机秀；拼对那个词 -> 参考图风格；乱敲的字母 -> 不认
  { name: '数字种子→纯随机', q: 'seed=7&still=1', time: 0, segs: false, scene: 'random' },
  { name: '那个词→参考图风格', q: 'seed=' + readSecret() + '&still=1', time: 0, segs: false, scene: 'classic' },
  { name: '乱敲字母→退回数字', q: 'seed=KQXW&still=1', time: 0, segs: false, scene: 'random' },
  { name: 'classic 第150帧', q: 'scene=classic&seed=7&frames=150', time: 149 * DT, segs: true },
  { name: 'random 第150帧', q: 'scene=random&seed=42&frames=150', time: 149 * DT, segs: true },
  { name: 'random 第150帧(无UI)', q: 'scene=random&seed=42&frames=150&ui=0', time: 149 * DT, segs: true, uiHidden: true }
];

/** 读 HUD（顺便读标题），HUD 缺字段会返回 NaN / null，交给断言去骂。 */
async function readHud(page) {
  const grab = (id) => page.textContent('#hud-' + id).catch(() => null);
  const [state, geos, segs, time, scene, title, budget] = await Promise.all([
    grab('state'), grab('geos'), grab('segs'), grab('time'), grab('scene'),
    page.title(), grab('budget')]);
  return {
    state, scene, title, budget,
    geos: Number(geos),
    segs: Number(segs),
    time: Number(String(time).replace('s', ''))
  };
}

/** 按用例断言。返回问题列表（空 = 通过）。 */
async function check(page, c, where) {
  const h = await readHud(page);
  const problems = [];
  if (!/^烟花 · Fireworks/.test(h.title)) problems.push(`标题是「${h.title}」`);
  // 图标必须是**内联的 SVG**（单文件版要零外部请求）
  const icon = await page.getAttribute('link[rel=icon]', 'href').catch(() => null);
  if (!icon || icon.indexOf('data:image/svg+xml') !== 0) {
    problems.push('favicon 不是内联的 SVG data URI：' + String(icon).slice(0, 32));
  }
  if (h.state === null) problems.push('没读到 HUD');
  else if (/出错/.test(h.state)) problems.push(`脚本报错：${h.state}`);
  else if (h.state !== '已定格') problems.push(`状态是「${h.state}」，应为「已定格」`);
  if (!(h.geos > 0)) problems.push(`图元数 ${h.geos} 不为正 —— 画面是空的`);
  if (c.segs && !(h.segs > 0)) problems.push(`线段数 ${h.segs} 不为正`);
  if (!(Math.abs(h.time - c.time) < 0.05)) problems.push(`时刻 ${h.time}s，预期 ${c.time.toFixed(2)}s`);
  if (c.scene && h.scene !== c.scene) problems.push(`场景是「${h.scene}」，应为「${c.scene}」`);
  if (c.uiHidden) {
    if (!(await page.isHidden('#panel'))) problems.push('?ui=0 但控制台没收起');
    if (!(await page.isHidden('#show'))) problems.push('?ui=0 但恢复按钮还在（应该彻底无 UI）');
  }
  return { h, problems, where };
}

function line(ok, name, detail) {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name.padEnd(22)} ${detail}`);
}

function report(name, r) {
  const h = r.h;
  line(r.problems.length === 0, name,
       `时刻 ${String(h.time).padStart(4)}s  图元 ${String(h.geos).padStart(4)}  `
       + `线段 ${String(h.segs).padStart(4)}  预算 ${String(h.budget).padEnd(11)} `
       + `场景 ${String(h.scene).padEnd(7)} 状态 ${h.state}`
       + (r.problems.length ? '\n        ' + r.problems.join('\n        ') : ''));
}

/* ------------------------------------------------------------ A) 交付路径 */

async function checkDist(browser) {
  console.log('A) 交付路径：file:// 打开构建产物 ' + path.relative(pw.ROOT, DIST));
  if (!fs.existsSync(DIST)) {
    console.log(' FAIL  dist/turtle_fireworks.html 不存在，先跑 npm run build');
    return 1;
  }
  let bad = 0;
  for (const c of DIST_CASES) {
    const { page } = await pw.openPage(browser, 'file://' + DIST + '?' + c.q,
                                       { viewport: { width: 924, height: 691 } });
    const r = await check(page, c);
    bad += r.problems.length;
    report(c.name, r);
    await page.close();
  }
  return bad;
}

/* ------------------------------------------------------------ B) 开发路径 */

/** 真键盘逐字符拼那个词：敲对留下、敲错弹回、拼全解锁。 */
async function checkTyping(page, secret) {
  const problems = [];
  const steps = [];
  const wrongFirst = secret.charAt(0) === 'Q' ? 'Z' : 'Q';
  const value = () => page.inputValue('#seed');

  await page.click('#seed');
  await page.fill('#seed', '');                     // 面板里本来带着上一场的种子
  await page.keyboard.type(wrongFirst);
  steps.push(`错首字母 -> [${await value()}]`);
  if (await value() !== '') problems.push(`错的首字母应当进不去，实际 [${await value()}]`);

  await page.keyboard.type(secret.charAt(0));
  steps.push(`对首字母 -> [${await value()}]`);
  if (await value() !== secret.charAt(0)) problems.push('对的首字母应当留下');

  const wrongMid = secret.charAt(1) === 'X' ? 'Y' : 'X';
  await page.keyboard.type(wrongMid);
  steps.push(`中间敲错 -> [${await value()}]`);
  if (await value() !== secret.charAt(0)) problems.push('中途敲错应退回上一个正确前缀');

  await page.keyboard.type(secret.slice(1));
  const scene = await page.textContent('#hud-scene');
  steps.push(`敲完 -> 场景 ${scene}`);
  if (await value() !== secret) problems.push(`敲完后框里应是那个词，实际 [${await value()}]`);
  if (scene !== 'classic') problems.push(`敲完后场景应是 classic，实际 ${scene}`);

  await page.keyboard.press('Enter');               // 回车收焦点
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused === 'seed') problems.push('回车后种子框没有失焦');
  steps.push(`回车 -> 焦点 ${focused || 'body'}`);
  return { problems, steps };
}

/** 快捷键：R / Esc 在不同焦点下的行为（曾经因为守卫写成"input 一概让位"而失灵）。 */
async function checkKeys(page) {
  const problems = [];
  const steps = [];
  // 暂停 + 数 spawnRandom 的调用次数，就没有"烟花刚好结束"的竞态
  await page.evaluate(() => {
    const app = FW.app.instance;
    app.paused = true;
    window.__spawns = 0;
    const orig = app.show.spawnRandom.bind(app.show);
    app.show.spawnRandom = function (n) { window.__spawns++; return orig(n); };
  });
  const spawns = () => page.evaluate(() => window.__spawns);

  // 1) 滑块（也是 <input>）有焦点时，R 必须照样放
  await page.focus('#budget');
  const a = await spawns();
  await page.keyboard.press('r');
  steps.push(`滑块聚焦 + R -> ${(await spawns()) > a ? '放了' : '没放'}`);
  if (!((await spawns()) > a)) problems.push('滑块有焦点时按 R 没放烟花');

  // 2) 种子框有焦点时，R 是"在打字"，不该放
  await page.click('#seed');
  const b = await spawns();
  await page.keyboard.press('r');
  steps.push(`种子框聚焦 + R -> ${(await spawns()) === b ? '没放' : '放了'}`);
  if ((await spawns()) !== b) problems.push('种子框打字时按 R 不该放烟花');

  // 3) Esc 在种子框里也要有效（收起 UI）
  const hiddenBefore = await page.isHidden('#panel');
  await page.keyboard.press('Escape');
  const hiddenAfter = await page.isHidden('#panel');
  steps.push(`种子框聚焦 + Esc -> ${hiddenAfter !== hiddenBefore ? '收起/展开' : '没反应'}`);
  if (hiddenAfter === hiddenBefore) problems.push('种子框有焦点时 Esc 没反应');
  await page.keyboard.press('Escape');              // 还原
  return { problems, steps };
}

async function checkDev(browser) {
  console.log('\nB) 开发路径：' + BASE + '/（多文件）');
  const proc = await pw.ensureServer(PORT);
  if (proc === undefined) {
    console.log(` FAIL  开发服务器起不来（端口 ${PORT} 被占用？）`);
    return 1;
  }
  let bad = 0;
  try {
    // B1) 注入的脚本列表必须与 manifest 完全一致 —— 不需要浏览器
    const want = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).files;
    const html = await pw.httpText(BASE + '/');
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
        + '\n        页面注入: ' + got.join(', '));
    } else {
      line(true, '注入模块列表', `${got.length} 个模块与 manifest 一致`);
    }

    if (!browser) return bad;

    // B2) 多文件这条路也得真的出画面
    const r0 = await pw.openPage(browser, BASE + '/?scene=classic&seed=7&frames=150',
                                 { viewport: { width: 924, height: 691 } });
    const rDev = await check(r0.page, { time: 149 * DT, segs: true });
    bad += rDev.problems.length;
    report('开发页出画面', rDev);

    // B3) 控制台便条：只给"有几个字母"，不能把那个词打出来
    const SECRET = readSecret();
    const note = r0.logs.join('\n');
    const noteOk = new RegExp(SECRET.length + ' 个字母').test(note) && !note.includes(SECRET);
    bad += noteOk ? 0 : 1;
    line(noteOk, '控制台便条',
         noteOk ? `提了"${SECRET.length} 个字母"、没写出那个词` : '文案不符合预期或写出了那个词');

    // B4) 真键盘：逐字符拼词
    const typing = await checkTyping(r0.page, SECRET);
    bad += typing.problems.length;
    line(typing.problems.length === 0, '逐字符拼词',
         typing.steps.join('；') + (typing.problems.length ? '\n        ' + typing.problems.join('\n        ') : ''));

    // B5) 快捷键
    const keys = await checkKeys(r0.page);
    bad += keys.problems.length;
    line(keys.problems.length === 0, '快捷键',
         keys.steps.join('；') + (keys.problems.length ? '\n        ' + keys.problems.join('\n        ') : ''));

    await r0.page.close();
  } finally {
    if (proc) { try { proc.kill('SIGKILL'); } catch (e) { /* 已退出 */ } }
  }
  return bad;
}

/* ---------------------------------------------------------------- C) 录制 */

function hasFfprobe() {
  try { return spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0; }
  catch (e) { return false; }
}

async function checkRecord(browser) {
  console.log('\nC) 录制：按「录制」-> 面板收起 -> 停止 -> 检查下载的 WebM');
  if (!browser) {
    console.log('  跳过：没有浏览器');
    return 0;
  }
  let bad = 0;
  const problems = [];
  const steps = [];
  const { page } = await pw.openPage(browser, BASE + '/?seed=7&max=900');

  await page.click('#record');
  await page.waitForTimeout(250);
  const panelHidden = await page.isHidden('#panel');
  const pillShown = !(await page.isHidden('#rec'));
  if (!panelHidden) problems.push('录制时面板没收起');
  if (!pillShown) problems.push('录制时没有停止条');
  steps.push(`录制中：面板收起 ${panelHidden}、停止条 ${pillShown}`);

  await page.waitForTimeout(1800);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#rec-stop')
  ]);
  const file = path.join(os.tmpdir(), 'fw-record-check.webm');
  await dl.saveAs(file);
  const name = dl.suggestedFilename();
  const back = !(await page.isHidden('#panel')) && (await page.isHidden('#rec'));
  if (!back) problems.push('停止后面板/停止条没有恢复');
  if (name.indexOf('seed7') < 0) problems.push('文件名里没有种子：' + name);
  steps.push(`下载 ${name}（${Math.round(fs.statSync(file).size / 1024)} KB）`);

  if (hasFfprobe()) {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
      'format_tags:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
    const tags = (j.format && j.format.tags) || {};
    if (tags.SEED !== '7') problems.push('元数据里没有 SEED=7：' + JSON.stringify(tags));
    steps.push(`ffprobe 读到 SEED=${tags.SEED}，时长 ${j.format.duration}s`);
  } else {
    steps.push('（没有 ffprobe，跳过元数据检查）');
  }

  const dec = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const v = document.createElement('video');
    v.src = URL.createObjectURL(new Blob([u8], { type: 'video/webm' }));
    try {
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = () => rej(new Error('decode error'));
        setTimeout(() => rej(new Error('timeout')), 8000);
      });
      return { ok: true, w: v.videoWidth, h: v.videoHeight };
    } catch (e) { return { ok: false, err: e.message }; }
  }, fs.readFileSync(file).toString('base64'));
  if (!dec.ok) problems.push('浏览器解不开录出来的文件：' + dec.err);
  else if (!dec.w) problems.push('解码后没有画面尺寸');
  else steps.push(`浏览器解码 ${dec.w}×${dec.h}`);
  try { fs.rmSync(file, { force: true }); } catch (e) { /* 无所谓 */ }

  await page.close();
  bad += problems.length;
  line(problems.length === 0, '录制导出', steps.join('；')
    + (problems.length ? '\n        ' + problems.join('\n        ') : ''));
  return bad;
}

/* ---------------------------------------------------------------- D) 交互 */

async function checkInteract(browser) {
  console.log('\nD) 交互：点画面发射 / 每日 / 复制链接 / 全屏');
  if (!browser) {
    console.log('  跳过：没有浏览器');
    return 0;
  }
  let bad = 0;
  const problems = [];
  const steps = [];
  const { page } = await pw.openPage(browser, BASE + '/?seed=7&max=900',
                                     { viewport: { width: 1280, height: 800 } });
  try { await page.context().grantPermissions(['clipboard-read', 'clipboard-write']); }
  catch (e) { /* 头less 下给不了就算了，后面会退回检查提示 */ }

  // 暂停 + 只数 launchAt 的调用，免得自动发射干扰判断
  await page.evaluate(() => {
    const app = window.FW.app.instance;
    app.paused = true;
    window.__launched = 0;
    const orig = app.show.launchAt.bind(app.show);
    app.show.launchAt = function (x, y) { window.__launched++; return orig(x, y); };
  });

  // D1) 点画面：应该在**点的那个位置**炸（视口 1280×800，逻辑中心即画面中心）
  await page.mouse.click(600, 300);
  const launched = await page.evaluate(() => window.__launched);
  const hit = await page.evaluate(() => {
    const f = FW.app.instance.show.fireworks.slice(-1)[0];
    return f ? { x: Math.round(f.x1), y: Math.round(f.y1) } : null;
  });
  if (launched !== 1) problems.push(`点画面没有发射（launchAt 调用 ${launched} 次）`);
  if (!hit || Math.abs(hit.x - (-40)) > 2 || Math.abs(hit.y - 100) > 2) {
    problems.push(`落点不对：期望 (-40, 100)，实际 ${JSON.stringify(hit)}`);
  }
  steps.push(`点 (600,300) -> 落点 ${hit ? hit.x + ',' + hit.y : '无'}`);

  // D2) 每日按钮 = 当天种子
  await page.click('#daily');
  const daily = await page.evaluate(() => ({ got: FW.app.instance.seed,
                                             want: String(FW.rng.dailySeed()) }));
  if (daily.got !== daily.want) problems.push(`每日没跳到当天种子：${daily.got} != ${daily.want}`);
  steps.push(`每日 -> seed ${daily.got}`);

  // D3) 复制链接：剪贴板里要有能复现这一场的地址
  await page.click('#share');
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  const urlOk = clip.indexOf('seed=' + daily.got) >= 0 && clip.indexOf('?') > 0;
  if (!urlOk) problems.push('剪贴板里的链接不对：' + clip);
  steps.push(`链接 ${clip.slice(0, 72)}`);

  // D4) 存图：PNG 元数据里要有种子与链接，且图还能解码
  const seedNow = await page.evaluate(() => FW.app.instance.seed);
  const [png] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#save')
  ]);
  const pngFile = path.join(os.tmpdir(), 'fw-save-check.png');
  await png.saveAs(pngFile);
  const pngBytes = fs.readFileSync(pngFile);
  await page.waitForTimeout(200);
  const meta = FWPNG.pngmeta.readText(new Uint8Array(pngBytes));
  const pngName = png.suggestedFilename();
  if (meta.Seed !== String(seedNow)) {
    problems.push(`PNG 元数据里的种子是「${meta.Seed}」，应为「${seedNow}」`);
  }
  if (!/seed=/.test(meta.Comment || '')) problems.push('PNG 元数据里没有这一场的链接');
  if (!/seed/.test(pngName)) problems.push('PNG 文件名里没有种子：' + pngName);
  const imgDim = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    try {
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('decode error'));
        setTimeout(() => rej(new Error('timeout')), 6000);
      });
      return { w: img.naturalWidth, h: img.naturalHeight };
    } catch (e) { return { err: e.message }; }
  }, pngBytes.toString('base64'));
  if (!imgDim.w) problems.push('插了元数据的 PNG 解码失败：' + (imgDim.err || '无尺寸'));
  steps.push(`存图 ${pngName}（${Math.round(pngBytes.length / 1024)} KB）`
    + ` 元数据 Seed=${meta.Seed} Comment=${String(meta.Comment).slice(0, 40)}…`
    + ` 解码 ${imgDim.w}×${imgDim.h}`);
  try { fs.rmSync(pngFile, { force: true }); } catch (e) { /* 无所谓 */ }

  // D5) 全屏
  await page.click('#fullscreen');
  await page.waitForTimeout(400);
  const inFs = await page.evaluate(() => !!document.fullscreenElement);
  if (!inFs) problems.push('点全屏没有进全屏');
  steps.push(`全屏 ${inFs}`);
  if (inFs) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  await page.close();
  bad += problems.length;
  line(problems.length === 0, '点/每日/分享/全屏', steps.join('；')
    + (problems.length ? '\n        ' + problems.join('\n        ') : ''));
  return bad;
}

async function main() {
  const why = pw.whyUnavailable();
  if (why) console.log('（' + why + '）');
  else console.log('真浏览器端到端自检（Playwright + ' + pw.findChrome() + '）');
  console.log('─'.repeat(88));
  const browser = why ? null : await pw.launch();
  let bad = 0;
  try {
    bad += await checkDist(browser);
    bad += await checkDev(browser);
    bad += await checkRecord(browser);
    bad += await checkInteract(browser);
  } finally {
    if (browser) await browser.close();
  }
  console.log('─'.repeat(88));
  console.log(bad
    ? `结论：${bad} 处不对`
    : '结论：交付路径与开发路径都能跑起来，画面非空，参数、打字与快捷键都符合预期 ✓');
  return bad ? 1 : 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });

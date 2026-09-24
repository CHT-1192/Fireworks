#!/usr/bin/env node
/* ============================================================================
 * render_smoke.js —— 不需要浏览器就能跑通的两段自检
 * ---------------------------------------------------------------------------
 * 1) 渲染路径：用假 canvas 接住 view.js 的全部绘制调用，检查
 *      * 每个坐标/线宽都是有限数（NaN / undefined 立刻抓出来）
 *      * 每个 fillStyle / strokeStyle 都是合法 #rrggbb（颜色漏传当场暴露）
 *      * 每个图元的 shape 都被识别（有没有画不出来的图元）
 *    这三种问题在浏览器里只会表现为画面空白 —— rAF 把异常吞了，所以必须在
 *    Node 里拦住。（真浏览器那一段见 tools/browser_check.js）
 *
 * 2) 主循环：app.js 不碰 DOM，所以能在 Node 里直接构造 App 并手动推帧，验证
 *    定格帧、固定步长推进、暂停、以及"渲染异常被 tick 兜住"。
 *
 * 用法：node tools/render_smoke.js
 * ==========================================================================*/
'use strict';

const { makeFakeCanvas, stubWindow, loadWithRenderer } = require('./fake_canvas');

/* ---- 假 canvas（见 tools/fake_canvas.js）---- */
stubWindow(924, 691);
const { canvas, ctx, problems } = makeFakeCanvas(924, 691);
const FW = loadWithRenderer();

const SCENES = ['classic', 'random'];
const FRAMES = 240;
const rows = [];

/* ------------------------------------------------ 1) 渲染路径 */

for (const scene of SCENES) {
  const renderer = new FW.view.Renderer(canvas, 2);
  renderer.layout(924, 691);
  const show = new FW.show.Show(924, 691, new FW.rng.Random(7),
                                { maxGeos: FW.show.DEFAULT_GEOS });
  FW.show.build(show, scene);
  const before = ctx.ops;
  let segs = 0, geos = 0, drawn = 0;
  for (let i = 0; i < FRAMES; i++) {
    show.step(i === 0 ? 0 : 1 / 60);
    renderer.draw(show.frameGeos);
    segs += renderer.segs;
    geos += renderer.geos;
    if (renderer.geos > 0) drawn++;
  }
  rows.push({ scene, geos: Math.round(geos / FRAMES), segs: Math.round(segs / FRAMES),
              ops: Math.round((ctx.ops - before) / FRAMES), drawn });
}

console.log(`渲染路径自检（假 canvas，924×691，每场景 ${FRAMES} 帧，预算 ${FW.show.DEFAULT_GEOS}）`);
console.log('─'.repeat(76));
console.log('  场景        图元/帧  线段/帧  绘制调用/帧  有画面的帧');
for (const r of rows) {
  console.log(`  ${r.scene.padEnd(10)}  ${String(r.geos).padStart(6)}`
    + `  ${String(r.segs).padStart(7)}  ${String(r.ops).padStart(10)}`
    + `  ${String(r.drawn).padStart(10)}`);
}
console.log('─'.repeat(76));

for (const r of rows) {
  if (r.drawn === 0) problems.push(`${r.scene} 一帧都没画出东西`);
}
// 每个场景都必须真的在描边（尾迹是折线）
for (const r of rows) {
  if (!(r.segs > 0)) problems.push(`${r.scene} 没有任何折线描边，尾迹没画出来`);
}

/* ------------------------------------------------ 1.5) 绘制预算真的会改变画面密度 */

/** 跑一段，返回图元峰值与均值。 */
function densityOf(budget, secs) {
  const show = new FW.show.Show(924, 691, new FW.rng.Random(7), { maxGeos: budget });
  FW.show.build(show, 'random');
  const n = Math.round(secs * 60);
  let peak = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    show.step(i === 0 ? 0 : 1 / 60);
    peak = Math.max(peak, show.frameGeos.length);
    sum += show.frameGeos.length;
  }
  return { peak, avg: sum / n };
}

// 预算是"画面容量"：调大必须真的更满（以前它只能往下压，调大毫无效果）
const small = densityOf(450, 60);
const big = densityOf(1400, 60);
const budgetProblems = [];
if (!(big.avg > small.avg * 1.5)) {
  budgetProblems.push(`调大预算没让画面变密：均值 ${small.avg.toFixed(0)} -> ${big.avg.toFixed(0)}`);
}
if (!(big.peak > small.peak * 1.4)) {
  budgetProblems.push(`调大预算没让峰值变高：${small.peak} -> ${big.peak}`);
}
if (!(small.avg > 0)) budgetProblems.push('预算 450 时画面是空的');

console.log('绘制预算自检（预算是容量目标：空则多发、满则收敛）');
console.log('─'.repeat(76));
if (budgetProblems.length) {
  for (const p of budgetProblems) console.log('  ✗ ' + p);
} else {
  console.log(`  OK   预算 450 -> 均值 ${small.avg.toFixed(0)} / 峰值 ${small.peak}`
    + `；1400 -> 均值 ${big.avg.toFixed(0)} / 峰值 ${big.peak}`);
}
console.log('─'.repeat(76));
for (const p of budgetProblems) problems.push(p);

/* ------------------------------------------------ 1.6) PNG 元数据 */

// crc32 用标准测试向量；插块用合成 PNG 往返（Node 里就能验，不用浏览器）
const pngChecks = [];
if (FW.pngmeta.crc32(new TextEncoder().encode('123456789')) !== 0xcbf43926) {
  pngChecks.push('crc32("123456789") 不等于标准向量 0xcbf43926');
}
{
  // 合成最小 PNG：IHDR + IDAT + IEND
  const zlib = require('zlib');
  const mk = (type, data) => {
    const t = Buffer.from(type, 'latin1');
    const body = Buffer.concat([t, data]);
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(FW.pngmeta.crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const raw = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    mk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    mk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 128, 0]))),
    mk('IEND', Buffer.alloc(0))
  ]);
  const pairs = FW.pngmeta.tags({ seed: '49388', scene: 'random',
                                  url: 'https://x/Fireworks/?seed=49388',
                                  time: new Date('2026-09-24T02:30:00Z') });
  const tagged = Buffer.from(FW.pngmeta.addText(new Uint8Array(raw), pairs));
  const back = FW.pngmeta.readText(new Uint8Array(tagged));
  if (back.Seed !== '49388') pngChecks.push('PNG 元数据读不回种子');
  if (!/seed=49388/.test(back.Comment || '')) pngChecks.push('PNG 元数据读不回链接');
  if (back.Software !== '烟花 · Fireworks') pngChecks.push('PNG 元数据的 Software 不对（UTF-8？）');
  const order = FW.pngmeta.chunks(new Uint8Array(tagged)).map((c) => c.type).join(' ');
  if (order !== 'IHDR iTXt iTXt iTXt iTXt iTXt IDAT IEND') pngChecks.push('块顺序不对：' + order);
  const idat = FW.pngmeta.chunks(new Uint8Array(tagged)).find((c) => c.type === 'IDAT');
  if (zlib.inflateSync(Buffer.from(idat.data)).length !== 4) pngChecks.push('插块后 IDAT 坏了');
}

console.log('PNG 元数据自检（crc32 标准向量 + 合成 PNG 插块往返）');
console.log('─'.repeat(76));
if (pngChecks.length) for (const p of pngChecks) console.log('  ✗ ' + p);
else console.log('  OK   crc32 对上标准向量；iTXt 插在 IHDR 之后；种子/链接/Software 读得回；IDAT 未损坏');
console.log('─'.repeat(76));
for (const p of pngChecks) problems.push(p);

/* ------------------------------------------------ 2) 主循环 */

const { App } = FW.app;
const loopProblems = [];
const makeApp = (query) => new App({ canvas: makeFakeCanvas(924, 691).canvas,
                                     search: new URLSearchParams(query) });

// 2.1 ?frames=N 应在构造时就定格在 (N-1)/60 秒，且第一帧已同步画出来
const frozen = makeApp('scene=classic&seed=7&frames=150&w=924&h=691');
const tFrozen = 149 / 60;
if (Math.abs(frozen.show.time - tFrozen) > 1e-9) {
  loopProblems.push(`frames=150 定格在 ${frozen.show.time}s，预期 ${tFrozen}s`);
}
if (!frozen.paused) loopProblems.push('frames=150 没有定格');
if (!(frozen.renderer.geos > 0)) loopProblems.push('定格帧没有被同步画出来');

// 2.2 继续放：60 个 16.67ms 的帧应推进约 1.0 秒（固定步长累加器）
frozen.togglePause();
let ts = performance.now();
for (let i = 0; i < 60; i++) { ts += 1000 / 60; frozen.stepFrame(ts); }
const advanced = frozen.show.time - tFrozen;
if (Math.abs(advanced - 1.0) > 0.05) loopProblems.push(`60 帧只推进了 ${advanced.toFixed(3)}s`);

// 2.3 暂停后时间不再走
frozen.togglePause();
const hold = frozen.show.time;
for (let i = 0; i < 30; i++) { ts += 1000 / 60; frozen.stepFrame(ts); }
if (frozen.show.time !== hold) loopProblems.push('暂停后时间还在走');

// 2.4 种子规则：正常只收数字；密语 -> 参考图风格，数字 -> 纯随机
const SECRET = FW.app.SECRET;
const cases = [
  ['seed=7', 'random', '7'],
  ['seed=007', 'random', '007'],
  ['seed=%20' + SECRET.toLowerCase() + '%20', 'classic', SECRET],   // 大小写/空格归一
  ['scene=classic&seed=7', 'classic', '7'],                         // 显式场景优先
  ['scene=random&seed=' + SECRET, 'random', SECRET]
];
for (const [q, scene, seed] of cases) {
  const a = makeApp(q);
  if (a.scene !== scene) loopProblems.push(`${q} 应该是 ${scene}，实际 ${a.scene}`);
  if (a.seed !== seed) loopProblems.push(`${q} 种子应为 ${seed}，实际 ${a.seed}`);
}
// 乱敲的字母一律不认，退回随机数字种子（纯随机秀）
const bogus = makeApp('seed=KQXW');
if (bogus.scene !== 'random') loopProblems.push('乱敲的字母种子应当退回纯随机秀');
if (!/^\d+$/.test(bogus.seed)) loopProblems.push(`乱敲的字母种子应退回数字，实际 ${bogus.seed}`);

// 逐字符守卫（种子框只允许"数字"或"密语的正确前缀"）—— 彩蛋就靠它做反馈
const wrongFirst = (SECRET[0] === 'Q') ? 'Z' : 'Q';
const wrongMid = SECRET.slice(0, 1) + ((SECRET[1] === 'X') ? 'Y' : 'X');
const okTexts = ['', '0', '2024'];
for (let i = 0; i <= SECRET.length; i++) okTexts.push(SECRET.slice(0, i));
const badTexts = [wrongFirst, wrongMid, SECRET + 'A', 'T5', '1T', SECRET.slice(0, 2) + '5'];
for (const s of okTexts) {
  if (!FW.app.seedContentOk(s)) loopProblems.push(`种子框本该接受「${s}」`);
}
for (const s of badTexts) {
  if (FW.app.seedContentOk(s)) loopProblems.push(`种子框本该拒绝「${s}」`);
}

// 同一个密语必须放出同一场
const c1 = makeApp('seed=' + SECRET + '&frames=30'), c2 = makeApp('seed=' + SECRET + '&frames=30');
if (c1.show.lastGeos !== c2.show.lastGeos) loopProblems.push('密语种子不可复现');

// 2.5 渲染器抛异常要被 tick 兜住（onError），而不是把主循环打断
const boom = makeApp('scene=classic&seed=7&frames=10&w=924&h=691');
let caught = null;
boom.onError = (e) => { caught = e; };
boom.renderer.draw = () => { throw new Error('boom'); };
boom.tick(performance.now() + 20);
if (!caught) loopProblems.push('渲染异常没有被 onError 兜住');
if (!boom.crashed) loopProblems.push('异常后没有标记 crashed');

console.log('主循环自检（Node 里直接构造 App 并手动推帧）');
console.log('─'.repeat(76));
if (loopProblems.length) {
  for (const p of loopProblems) console.log('  ✗ ' + p);
} else {
  console.log(`  OK   定格 (N-1)/60 秒、60 帧推进 ${advanced.toFixed(3)}s、暂停不走、异常被兜住`);
  console.log(`  OK   数字种子→纯随机、密语→参考图风格、逐字符守卫 ${okTexts.length} 收 / ${badTexts.length} 拒、可复现`);
}
console.log('─'.repeat(76));
for (const p of loopProblems) problems.push(p);

/* ------------------------------------------------ 结论 */

if (problems.length) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems.slice(0, 20)) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('结论：图元全部被识别、坐标/线宽/颜色合法、主循环行为符合预期 ✓');

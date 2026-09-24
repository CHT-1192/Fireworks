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

// 2.4 字母种子 -> 参考图风格；数字种子 -> 纯随机；大小写/空格归一
const cases = [
  ['seed=KQXW', 'classic', 'KQXW'],
  ['seed=kqxw', 'classic', 'KQXW'],
  ['seed=%207%20', 'random', '7'],
  ['seed=7&scene=classic', 'classic', '7'],
  ['scene=random&seed=KQXW', 'random', 'KQXW']
];
for (const [q, scene, seed] of cases) {
  const a = makeApp(q);
  if (a.scene !== scene) loopProblems.push(`${q} 应该是 ${scene}，实际 ${a.scene}`);
  if (a.seed !== seed) loopProblems.push(`${q} 种子应为 ${seed}，实际 ${a.seed}`);
}
// 同一个字母种子必须放出同一场
const s1 = makeApp('seed=KQXW&frames=30'), s2 = makeApp('seed=KQXW&frames=30');
if (s1.show.lastGeos !== s2.show.lastGeos) loopProblems.push('字母种子不可复现');

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
  console.log(`  OK   字母种子→参考图风格、数字种子→纯随机、大小写归一、同种子可复现`);
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

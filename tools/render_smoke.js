#!/usr/bin/env node
/* ============================================================================
 * render_smoke.js —— 不需要浏览器就能跑通的渲染路径自检
 * ---------------------------------------------------------------------------
 * 用一只"假 canvas 上下文"接住 view.js 的全部绘制调用，检查：
 *   * 每个坐标/线宽都是有限数（NaN / undefined 立刻抓出来）
 *   * 每个 fillStyle / strokeStyle 都是合法的 #rrggbb（颜色数组漏传会当场暴露）
 *   * 每个图元的 shape 都被识别（有没有画不出来的图元）
 * 三种场景 × 精确/增强两种模式各跑若干帧。这类"某条分支没接住新图元"的问题
 * 在浏览器里只会表现为画面空白（异常被 rAF 吞掉），在 Node 里必须能拦住。
 * 用法：node tools/render_smoke.js
 * ==========================================================================*/
'use strict';

const path = require('path');
const { loadSim, ROOT } = require('./loader');
const vm = require('vm');
const fs = require('fs');

/* ---- 假 window / canvas ---- */
global.window = { devicePixelRatio: 1, innerWidth: 924, innerHeight: 691 };

const problems = [];

function chkNum(v, what) {
  if (typeof v !== 'number' || !isFinite(v)) problems.push(`${what} = ${v}`);
}

const HEX = /^#[0-9a-f]{6}$/;

function FakeCtx() {
  this.ops = 0; this.fills = 0; this.strokes = 0; this.rects = 0;
  this._fillStyle = '#000000'; this._strokeStyle = '#000000';
  this.lineWidth = 1; this.lineCap = ''; this.lineJoin = '';
}
Object.defineProperty(FakeCtx.prototype, 'fillStyle', {
  get() { return this._fillStyle; },
  set(v) { if (!HEX.test(String(v))) problems.push(`fillStyle = ${v}`); this._fillStyle = v; }
});
Object.defineProperty(FakeCtx.prototype, 'strokeStyle', {
  get() { return this._strokeStyle; },
  set(v) { if (!HEX.test(String(v))) problems.push(`strokeStyle = ${v}`); this._strokeStyle = v; }
});
FakeCtx.prototype.setTransform = function (a, b, c, d, e, f) {
  [a, b, c, d, e, f].forEach((v, i) => chkNum(v, `setTransform[${i}]`));
  this.ops++;
};
FakeCtx.prototype.fillRect = function (x, y, w, h) {
  [x, y, w, h].forEach((v, i) => chkNum(v, `fillRect[${i}]`));
  this.rects++; this.ops++;
};
FakeCtx.prototype.beginPath = function () { this.ops++; };
FakeCtx.prototype.closePath = function () { this.ops++; };
FakeCtx.prototype.moveTo = function (x, y) { chkNum(x, 'moveTo.x'); chkNum(y, 'moveTo.y'); this.ops++; };
FakeCtx.prototype.lineTo = function (x, y) { chkNum(x, 'lineTo.x'); chkNum(y, 'lineTo.y'); this.ops++; };
FakeCtx.prototype.fill = function () { this.fills++; this.ops++; };
FakeCtx.prototype.stroke = function () {
  chkNum(this.lineWidth, 'lineWidth');
  if (this.lineWidth <= 0) problems.push(`lineWidth = ${this.lineWidth}`);
  this.strokes++; this.ops++;
};

const ctx = new FakeCtx();
const canvas = {
  clientWidth: 924, clientHeight: 691, width: 0, height: 0,
  getContext: () => ctx,
  toDataURL: () => 'data:image/png;base64,'
};

/* ---- 加载仿真模块 + 渲染器 ---- */
const FW = loadSim();
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src', 'view.js'), 'utf8'),
                    { filename: 'src/view.js' });

const SCENES = ['classic', 'original', 'random'];
const MODES = [false, true];
const FRAMES = 240;
const rows = [];

for (const scene of SCENES) {
  for (const dense of MODES) {
    const r = new FW.view.Renderer(canvas, 2);
    r.layout(924, 691);
    const show = new FW.show.Show(924, 691, new FW.rng.Random(7),
                                  { maxGeos: 130, denseTrails: dense });
    FW.show.build(show, scene);
    const before = ctx.ops;
    let segs = 0, geos = 0, drawn = 0;
    for (let i = 0; i < FRAMES; i++) {
      show.step(i === 0 ? 0 : 1 / 60);
      r.draw(show.frameGeos);
      segs += r.segs; geos += r.geos;
      if (r.geos > 0) drawn++;
    }
    rows.push({ scene, dense, geos: Math.round(geos / FRAMES), segs: Math.round(segs / FRAMES),
                ops: ctx.ops - before, drawn });
  }
}

console.log('渲染路径自检（假 canvas 上下文，924×691，每格 ' + FRAMES + ' 帧）');
console.log('─'.repeat(76));
console.log('  场景        模式      图元/帧  线段/帧  绘制调用/帧  有画面的帧');
for (const r of rows) {
  console.log(`  ${r.scene.padEnd(10)}  ${(r.dense ? '光滑尾迹' : '原版口径').padEnd(8)}`
    + `  ${String(r.geos).padStart(6)}  ${String(r.segs).padStart(7)}`
    + `  ${String(Math.round(r.ops / FRAMES)).padStart(10)}  ${String(r.drawn).padStart(10)}`);
}
console.log('─'.repeat(76));

const noDraw = rows.filter((r) => r.drawn === 0);
for (const r of noDraw) problems.push(`${r.scene}/${r.dense ? 'dense' : 'exact'} 一帧都没画出东西`);

// 增强模式在 classic/random 下必须真的更密
for (const scene of ['classic', 'random']) {
  const a = rows.find((r) => r.scene === scene && !r.dense);
  const b = rows.find((r) => r.scene === scene && r.dense);
  if (!(b.segs > a.segs)) problems.push(`${scene}: 增强模式线段数(${b.segs}) 未超过原版口径(${a.segs})`);
}

if (problems.length) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems.slice(0, 20)) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('结论：所有图元都被正确识别，坐标/线宽/颜色全部合法 ✓');

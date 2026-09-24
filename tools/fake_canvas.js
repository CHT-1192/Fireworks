/* ============================================================================
 * fake_canvas.js —— Node 里的"假 canvas 上下文"
 * ---------------------------------------------------------------------------
 * 两个用途：
 *   1) 合法性校验：坐标/线宽必须是有限数、fillStyle/strokeStyle 必须是合法
 *      #rrggbb、shape 必须被识别 —— 某条分支没接住新图元时立刻报错，而不是在
 *      浏览器里默默画出一片空白（rAF 会把异常吞掉）。
 *   2) 指令指纹：把渲染器这一帧到底下了哪些绘制指令（含变换、线宽、圆头设置）
 *      哈希成短摘要，交给 tools/baseline.js 做回归 —— 于是"改坏了渲染器"这种事
 *      不需要浏览器也能被测出来。
 * 具体的光栅化不归它管（那由真实浏览器负责）。
 * ==========================================================================*/
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadSim, ROOT } = require('./loader');

const HEX = /^#[0-9a-f]{6}$/;

function makeFakeCanvas(w, h) {
  const problems = [];
  const ctx = new FakeCtx(problems);
  const canvas = {
    clientWidth: w, clientHeight: h, width: 0, height: 0,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,'
  };
  return { canvas, ctx, problems };
}

function chkNum(problems, v, what) {
  if (typeof v !== 'number' || !isFinite(v)) problems.push(`${what} = ${v}`);
}

function FakeCtx(problems) {
  this.problems = problems;
  this.ops = 0; this.fills = 0; this.strokes = 0; this.rects = 0;
  this.lineWidth = 1; this.lineCap = ''; this.lineJoin = '';
  this._fillStyle = '#000000'; this._strokeStyle = '#000000';
  this.beginFrame();
}

/** 开始记录一帧：之后的每条绘制指令都会进这一帧的指纹。 */
FakeCtx.prototype.beginFrame = function () {
  this._h = crypto.createHash('sha256');
  this._frameOps = 0;
};

/** 本帧绘制指令指纹（前 8 位十六进制）。 */
FakeCtx.prototype.frameDigest = function () {
  return this._h.digest('hex').slice(0, 8);
};

FakeCtx.prototype._op = function (name, args) {
  this._h.update(name);
  for (const a of args) this._h.update('|' + a);
  this._h.update('\n');
  this._frameOps++; this.ops++;
};

Object.defineProperty(FakeCtx.prototype, 'fillStyle', {
  get() { return this._fillStyle; },
  set(v) {
    if (!HEX.test(String(v))) this.problems.push(`fillStyle = ${v}`);
    this._fillStyle = v;
  }
});
Object.defineProperty(FakeCtx.prototype, 'strokeStyle', {
  get() { return this._strokeStyle; },
  set(v) {
    if (!HEX.test(String(v))) this.problems.push(`strokeStyle = ${v}`);
    this._strokeStyle = v;
  }
});

FakeCtx.prototype.setTransform = function (a, b, c, d, e, f) {
  [a, b, c, d, e, f].forEach((v, i) => chkNum(this.problems, v, `setTransform[${i}]`));
  this._op('setTransform', [a, b, c, d, e, f]);
};
FakeCtx.prototype.fillRect = function (x, y, w, h) {
  [x, y, w, h].forEach((v, i) => chkNum(this.problems, v, `fillRect[${i}]`));
  this._op('fillRect', [x, y, w, h, this._fillStyle]);
  this.rects++;
};
FakeCtx.prototype.beginPath = function () { this._op('beginPath', []); };
FakeCtx.prototype.closePath = function () { this._op('closePath', []); };
FakeCtx.prototype.moveTo = function (x, y) {
  chkNum(this.problems, x, 'moveTo.x'); chkNum(this.problems, y, 'moveTo.y');
  this._op('moveTo', [x, y]);
};
FakeCtx.prototype.lineTo = function (x, y) {
  chkNum(this.problems, x, 'lineTo.x'); chkNum(this.problems, y, 'lineTo.y');
  this._op('lineTo', [x, y]);
};
FakeCtx.prototype.fill = function () { this._op('fill', [this._fillStyle]); this.fills++; };
FakeCtx.prototype.stroke = function () {
  chkNum(this.problems, this.lineWidth, 'lineWidth');
  if (this.lineWidth <= 0) this.problems.push(`lineWidth = ${this.lineWidth}`);
  this._op('stroke', [this._strokeStyle, this.lineWidth, this.lineCap, this.lineJoin]);
  this.strokes++;
};

/** 浏览器里 view.js 会用到 window（设备像素比 / 视口尺寸），先支起来。 */
function stubWindow(w, h, dpr) {
  global.window = { devicePixelRatio: dpr === undefined ? 1 : dpr,
                    innerWidth: w, innerHeight: h };
  // 主循环用 requestAnimationFrame 排下一帧；Node 里没有，桩成空实现
  // （测试直接调 stepFrame/tick，自己控制时间戳）
  global.requestAnimationFrame = function () { return 0; };
}

/** 仿真 + 渲染器 + 应用核心一起加载（这三者都不需要 DOM；ui.js 才需要）。 */
function loadWithRenderer() {
  const FW = loadSim();
  for (const f of ['view.js', 'app.js', 'ebml.js', 'pngmeta.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'),
                        { filename: 'src/' + f });
  }
  return FW;
}

module.exports = { makeFakeCanvas, stubWindow, loadWithRenderer, FakeCtx };

/* ============================================================================
 * view.js —— canvas 渲染器（替代原版的 TurtleCanvas + Eraser）
 * ---------------------------------------------------------------------------
 * 原版用「一只乌龟盖章 / 另一只乌龟沿同一条路径涂背景色」来画和擦，这里换成
 * 每帧整屏重绘：
 *     清屏 -> 按数组顺序把 Geo 画上去（后面的盖住前面的 = 同样的层叠顺序）
 * 视觉等价，而且省掉了原版一半的画布操作（--no-smear 演示的那件事）。
 *
 * 坐标：Show 用的是「以画面中心为原点、y 轴向上」的逻辑坐标（和 turtle 一致）。
 * 这里用与原版 TurtleCanvas 完全相同的仿射变换把形状点映射到屏幕：
 *     px = x + sin(h)·X + cos(h)·Y      X,Y = 形状局部坐标 × (wid, leng)
 *     py = y - cos(h)·X + sin(h)·Y
 * 再整体缩放平移，所以连 18 边形圆点的顶点相位都和 turtle 一致。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var core = FW.core, data = FW.data;
  var DOT = data.DOT, PATH = data.PATH, DOT_PTS = data.DOT_PTS;
  var toHex = core.toHex, RAD2DEG = core.RAD2DEG;

  /**
   * @param {HTMLCanvasElement} canvas
   * 逻辑尺寸由 Show 决定（每个场景一个），屏幕尺寸由窗口决定；
   * 两边不一致时按等比缩放居中（original 场景固定 924×691，所以窗口再大也
   * 是完整构图而不是被裁掉）。
   */
  function Renderer(canvas, maxDpr) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxDpr = maxDpr === undefined ? 2 : maxDpr;
    this.bg = toHex(core.BG);
    this.geos = 0;
    this.segs = 0;          // 本帧实际描边的线段数（增强模式会远超图元数）
    this.layout(1, 1);
  }

  /** 算设备像素比 + 适配缩放；窗口尺寸/逻辑尺寸变了都要调。 */
  Renderer.prototype.layout = function (logicalW, logicalH) {
    var dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    var cw = this.canvas.clientWidth || window.innerWidth;
    var ch = this.canvas.clientHeight || window.innerHeight;
    var pw = Math.max(1, Math.round(cw * dpr));
    var ph = Math.max(1, Math.round(ch * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.dpr = dpr;
    this.cw = cw;
    this.ch = ch;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);          // 之后按 CSS 像素画
    this.scale = Math.min(cw / logicalW, ch / logicalH);  // 等比适配
    this.ox = cw / 2;
    this.oy = ch / 2;
    return this;
  };

  /** 一帧：清屏 + 画图元。geos 为空时也要清（否则旧画面会留在 canvas 上）。 */
  Renderer.prototype.draw = function (geos) {
    var ctx = this.ctx, i;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, this.cw, this.ch);
    this.geos = geos.length;
    this.segs = 0;
    for (i = 0; i < geos.length; i++) this.shape(geos[i]);
  };

  /**
   * 折线图元（canvas 增强）：整条尾迹用圆头 / 圆角描边画成一串首尾相接的线段。
   * 相邻线段共用端点 + 圆头，所以接头处没有豁口；每段还能各自带颜色和粗细，
   * 于是"越旧越暗越细"的渐变照样成立 —— 原版只能用矩形图章一段段盖，做不到这些。
   */
  Renderer.prototype.path = function (g) {
    var ctx = this.ctx, s = this.scale, dpr = this.dpr, segs = g.segs, i, sg;
    // 逻辑坐标 -> 屏幕：平移 + 等比缩放 + y 轴翻转（线宽也随之缩放）
    ctx.setTransform(s * dpr, 0, 0, -s * dpr, this.ox * dpr, this.oy * dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (i = 0; i < segs.length; i++) {
      sg = segs[i];
      ctx.strokeStyle = toHex(sg[4]);
      ctx.lineWidth = 2 * sg[5];
      ctx.beginPath();
      ctx.moveTo(sg[0], sg[1]);
      ctx.lineTo(sg[2], sg[3]);
      ctx.stroke();
    }
    this.segs += segs.length;
  };

  /** 画一个图元：直接把形状局部坐标的仿射矩阵写进 setTransform，省掉 save/restore。 */
  Renderer.prototype.shape = function (g) {
    if (g.shape === PATH) return this.path(g);
    var ctx = this.ctx, s = this.scale;
    var h = g.heading / RAD2DEG, sn = Math.sin(h), cs = Math.cos(h);
    // 局部 (X,Y) -> 屏幕：平移 + 缩放 + y 翻转 + 旋转，一次算进 a..f
    ctx.setTransform(s * sn * this.dpr, s * cs * this.dpr,
                     s * cs * this.dpr, -s * sn * this.dpr,
                     (this.ox + s * g.x) * this.dpr, (this.oy - s * g.y) * this.dpr);
    ctx.fillStyle = toHex(g.color);
    // 圆点：正 18 边形（半径 1）按 (wid, leng) 缩放；DOT_PTS 就是 turtle 那份形状表
    var pts = DOT_PTS, i, X, Y;
    ctx.beginPath();
    for (i = 0; i < pts.length; i++) {
      X = pts[i][0] * g.wid; Y = pts[i][1] * g.leng;
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.closePath();
    ctx.fill();
  };

  /** 导出 PNG 用的 dataURL（浏览器 Canvas 自带，不用手写 zlib/PNG）。 */
  Renderer.prototype.toDataURL = function () { return this.canvas.toDataURL('image/png'); };

  FW.view = { Renderer: Renderer };
})(globalThis.FW || (globalThis.FW = {}));

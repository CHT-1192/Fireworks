/* ============================================================================
 * trails.js —— 会自己散掉的尾迹：弹体 / 发射尾迹 / 钉死的折线
 * 对应 turtle_fireworks.py 的 Rocket、Trail、FixedLine、stem_segments。
 * 与 elements.js 共用 FW.elements 这个命名空间（同一个模块表）。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var core = FW.core, data = FW.data, el = FW.elements;
  var fade = core.fade, mix = core.mix, decimate = core.decimate;
  var DOT = data.DOT, geo = data.geo, pathGeo = data.pathGeo, DENSE = data.DENSE;
  var Element = el.Element;

  /* ------------------------------------------ 弹体：白热的头 + 身后一点火星 */

  function Rocket(show, firework) {
    Element.call(this, show);
    this.fw = firework;
  }
  Rocket.prototype = Object.create(Element.prototype);
  Rocket.prototype.constructor = Rocket;

  Rocket.prototype.frame = function () {
    var fw = this.fw;
    return [geo(DOT, fw.palette.core, fw.x, fw.y, 0.0, 4.6, 4.6),
            geo(DOT, fade(fw.palette.stem, 0.85),
                fw.x - fw.vx * 0.02, fw.y - fw.vy * 0.02, 0.0, 3.0, 3.0)];
  };

  /* ------------------------------------------------------- 发射尾迹 */

  /**
   * 参考图里最显眼的橙线 / 绿线。把弹体**真实飞过的位置**一段段采样下来连成
   * 折线 —— 不是从发射架到弹体的一条绷直的线，所以弹体横飘时尾迹不会被「拖
   * 着转」，而是留在原地：下端是早就凉掉的旧料，头端是刚从弹体喷出的白热段。
   * 停止喂点（爆炸）之后，整条尾迹由尾巴先散，一路熄到弹体处。
   */
  function Trail(show, x, y, o) {
    Element.call(this, show);
    this.pts = [[x, y, show.time]];                       // 已经落下的轨迹点
    this.head = [x, y, show.time];                        // 弹体当前所在（最新鲜的一段）
    this.width = o.width;
    this.hot = o.hot;
    this.cool = o.cool;
    this.fadeTime = o.fadeTime === undefined ? 3.4 : o.fadeTime;
    this.minStep = o.minStep === undefined ? 9.0 : o.minStep;
    this.maxPts = o.maxPts === undefined ? 80 : o.maxPts;
  }
  Trail.prototype = Object.create(Element.prototype);
  Trail.prototype.constructor = Trail;

  /** 弹体飞到这里了：头端一直更新，离上一个记录点够远了才落一个新点。 */
  Trail.prototype.push = function (x, y) {
    var now = this.show.time;
    this.head = [x, y, now];
    var last = this.pts[this.pts.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) >= this.minStep) {
      this.pts.push(this.head);
      if (this.pts.length > this.maxPts) this.pts.shift();
    }
  };

  Trail.prototype.update = function () {
    var now = this.show.time;
    while (this.pts.length > 1 && now - this.pts[0][2] > this.fadeTime) {
      this.pts.shift();                                   // 冷透的尾巴先掉
    }
    if (now - this.head[2] > this.fadeTime && now - this.pts[0][2] > this.fadeTime) {
      this.alive = false;                                 // 整条都凉了
    }
  };

  Trail.prototype.frame = function () {
    var tail = this.pts[this.pts.length - 1];
    var pts = (this.head === tail) ? this.pts : this.pts.concat([this.head]);
    if (pts.length < 2) return [];
    // 整条真实飞行轨迹一次描边（原版受图章预算限制只能画 6 段）
    var segs = this.segsFor(decimate(pts, Math.min(pts.length - 1, DENSE.trail)));
    return segs.length ? [pathGeo(segs)] : [];
  };

  /** 把抽稀后的轨迹点连成线段：[x0, y0, x1, y1, color, half]（原版的取色/取宽公式）。 */
  Trail.prototype.segsFor = function (q) {
    var now = this.show.time, segs = [];
    for (var i = 0; i + 1 < q.length; i++) {
      var a = q[i], b = q[i + 1];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var d = Math.hypot(dx, dy);
      if (d < 0.6) continue;
      var fresh = Math.max(0.0, 1.0 - (now - (a[2] + b[2]) * 0.5) / this.fadeTime);
      segs.push([a[0], a[1], b[0], b[1], mix(this.cool, this.hot, fresh),
                 Math.max(0.5, this.width * (0.6 + 0.4 * fresh))]);
    }
    return segs;
  };

  FW.elements.Rocket = Rocket;
  FW.elements.Trail = Trail;
})(globalThis.FW || (globalThis.FW = {}));

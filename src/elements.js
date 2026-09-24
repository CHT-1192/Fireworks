/* ============================================================================
 * elements.js —— 可擦除的元素：闪光 / 余烬 / 火花 / 弹体 / 发射尾迹 / 定线
 * 对应 turtle_fireworks.py 的「可擦除的元素」与「各种火花」两节。
 * ---------------------------------------------------------------------------
 * 与原版的一个结构性差异：原版靠「另一只橡皮乌龟沿同一条路径涂背景色」来
 * 擦上一帧（turtle 的图章只会叠加，不会自己消失）。canvas 每帧整屏重绘即可
 * 达到同样效果，所以这里不再有 discard/erase/commit 的图章簿记，只保留
 * update() -> frame() 两步；step() 里的**调用顺序**与原版严格一致，
 * 因为 frame() 里也有 rng 消耗（末端闪烁），顺序错了同 seed 就对不上了。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var core = FW.core, data = FW.data;
  var fade = core.fade, mix = core.mix, decimate = core.decimate;
  var DOT = data.DOT, geo = data.geo, rayGeo = data.rayGeo, pathGeo = data.pathGeo;
  var DENSE = data.DENSE;

  /* ------------------------------------------------------------ 基类 */

  function Element(show) {
    this.show = show;
    this.alive = true;
  }
  Element.prototype.update = function (/* dt */) {};
  Element.prototype.frame = function () { return []; };

  /* ------------------------------------------- 爆心闪光：一瞬撑开又消失 */

  function Flash(show, x, y, palette, size) {
    Element.call(this, show);
    this.x = x; this.y = y;
    this.size = size === undefined ? 34.0 : size;
    this.palette = palette;
    this.age = 0.0;
    this.life = 0.22;
  }
  Flash.prototype = Object.create(Element.prototype);
  Flash.prototype.constructor = Flash;

  Flash.prototype.update = function (dt) {
    this.age += dt;
    if (this.age >= this.life) this.alive = false;
  };

  Flash.prototype.frame = function () {
    var k = Math.max(0.0, 1.0 - this.age / this.life);   // 死亡那帧 age 会略微超过 life
    var r = Math.max(0.5, this.size * (0.35 + 0.65 * k) * Math.sqrt(k));  // 边暗边缩
    return [geo(DOT, fade(this.palette.core, Math.pow(k, 1.6)), this.x, this.y, 0.0, r, r)];
  };

  /* ------------------------------------------------ 余烬：掉下来的小碎屑 */

  function Ember(show, x, y, vx, vy, color, size, life) {
    Element.call(this, show);
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.color = color;
    this.size = size;
    this.life = life;
    this.age = 0.0;
    this.twinkle = show.rng.random();
  }
  Ember.prototype = Object.create(Element.prototype);
  Ember.prototype.constructor = Ember;

  Ember.prototype.update = function (dt) {
    this.age += dt;
    this.vy -= 150.0 * dt;
    this.vx *= Math.exp(-0.8 * dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.age >= this.life) this.alive = false;
  };

  Ember.prototype.frame = function () {
    var k = Math.max(0.0, 1.0 - this.age / this.life);
    if (this.twinkle > 0.75) k *= 0.35 + 0.65 * Math.abs(Math.sin(this.age * 22.0));
    var r = Math.max(0.5, this.size * (0.4 + 0.6 * k));
    return [geo(DOT, fade(this.color, k), this.x, this.y, 0.0, r, r)];
  };

  /* ---------------------------------------------- 火星：真实轨迹 + 当前点 */

  /**
   * 一发烟花里的一颗火星。画法：
   *   trail —— **真实轨迹**尾迹：把自己飞过的位置按间隔采样成一串点再连成
   *            折线，越靠后越旧、越暗越细。所以它不是「从爆心拉到当前位置的
   *            一根绷直的线」（那样会像雨刷一样跟着火星扫），而是留在原地的
   *            一段拖尾：出膛时是笔直的辐条，火星开始下坠后拖尾自己弯成弧线。
   *   dot   —— 当前点（永远有）。
   */
  function Spark(show, x, y, vx, vy, o) {
    Element.call(this, show);
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.color = o.color;
    this.trailHot = o.trailHot;
    this.trailCool = o.trailCool;
    this.size = o.size;
    this.life = o.life;
    this.age = 0.0;
    this.gravity = o.gravity;
    this.drag = o.drag;
    this.trailTime = o.trailTime === undefined ? 0.0 : o.trailTime;
    this.trailSeg = Math.max(1, o.trailSeg === undefined ? 3 : o.trailSeg);
    this.trailStep = o.trailStep === undefined ? 12.0 : o.trailStep;
    this.emberRate = o.emberRate === undefined ? 0.0 : o.emberRate;
    this.twinkle = o.twinkle === undefined ? true : o.twinkle;
    this.emberAcc = 0.0;
    // 轨迹采样：[x, y, 出生时刻]。第一个点就是爆心。
    this.track = this.trailTime > 0 ? [[x, y, show.time]] : [];
  }
  Spark.prototype = Object.create(Element.prototype);
  Spark.prototype.constructor = Spark;

  Spark.prototype.update = function (dt) {
    this.age += dt;
    var now = this.show.time;
    var k = Math.exp(-this.drag * dt);
    this.vx *= k;
    this.vy = this.vy * k - this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.track.length) {                              // 采样真实轨迹
      var last = this.track[this.track.length - 1];
      if (Math.hypot(this.x - last[0], this.y - last[1]) >= this.trailStep) {
        this.track.push([this.x, this.y, now]);           // 够远了才记一个点
      }
      while (this.track.length > 1 && now - this.track[0][2] > this.trailTime) {
        this.track.shift();                               // 尾巴先散
      }
    }

    if (this.emberRate) {                                 // 掉余烬
      this.emberAcc += this.emberRate * dt;
      while (this.emberAcc >= 1.0) {
        this.emberAcc -= 1.0;
        this.show.add(new Ember(this.show, this.x, this.y,
                                this.vx * 0.25 + this.show.rng.uniform(-14, 14),
                                this.vy * 0.2 + this.show.rng.uniform(-10, 6),
                                this.trailHot, this.size * 0.42,
                                this.show.rng.uniform(0.5, 1.3)));
      }
    }
    if (this.age >= this.life) this.alive = false;
  };

  /** 把抽稀后的轨迹点连成线段：[x0, y0, x1, y1, color, half]（原版的取色/取宽公式）。 */
  Spark.prototype.trailSegs = function (q, shade) {
    var now = this.show.time, segs = [];
    for (var i = 0; i + 1 < q.length; i++) {
      var a = q[i], b = q[i + 1];
      var d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d < 0.4) continue;
      var age = now - (a[2] + b[2]) * 0.5;
      var fresh = Math.max(0.0, 1.0 - age / this.trailTime) * (0.35 + 0.65 * shade);
      segs.push([a[0], a[1], b[0], b[1], mix(this.trailCool, this.trailHot, fresh),
                 Math.max(0.5, this.size * 0.16 * (0.5 + 0.5 * fresh))]);
    }
    return segs;
  };

  Spark.prototype.frame = function () {
    var k = Math.max(0.0, 1.0 - this.age / this.life);
    var shade = Math.pow(k, 0.8);                         // 变暗曲线
    if (this.twinkle && k < 0.34 && this.show.rng.random() < 0.35) {
      shade *= this.show.rng.uniform(0.15, 1.0);          // 末期随机闪烁
    }
    var geos = [];
    if (this.track.length) {
      var now = this.show.time;
      // 记录点 + 这一帧的「活头端」，保证尾迹始终连在火花身上
      var pts = this.track.concat([[this.x, this.y, now]]);
      if (this.trailSeg === 1) {
        // trail_seg=1 的语义就是「一条直线」（参考图那 14 条辐条），不细采样
        var seg = this.trailSegs([pts[0], pts[pts.length - 1]], shade)[0];
        if (seg) geos.push(rayGeo(seg));
      } else {
        // 沿真实轨迹细采样，圆头描边连成一条光滑曲线
        var dense = this.trailSegs(decimate(pts, Math.min(pts.length - 1, DENSE.spark)), shade);
        if (dense.length) geos.push(pathGeo(dense));
      }
    }
    var r = this.size * (0.55 + 0.45 * shade);
    geos.push(geo(DOT, fade(this.color, shade), this.x, this.y, 0.0, r, r));
    return geos;
  };

  FW.elements = { Element: Element, Flash: Flash, Ember: Ember, Spark: Spark };
})(globalThis.FW || (globalThis.FW = {}));

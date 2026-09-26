/* ============================================================================
 * firework.js —— 一发烟花：先发射，到顶点炸开，火花飞散、下落、变暗
 * 对应 turtle_fireworks.py 的 Firework 一节。
 * ---------------------------------------------------------------------------
 * burst() 里的 rng 调用顺序是逐条对着 Python 抄的：同 seed 想放出同一场，
 * 任何一次 uniform/randint 的先后颠倒都会让画面对不上（tools/verify.js 会查）。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var core = FW.core, data = FW.data, el = FW.elements;
  var mix = core.mix, fade = core.fade, pyRound = core.pyRound;
  var STYLES = data.STYLES;

  var ROCKET_G = 520.0;                 // 上升段重力（决定发射速度与上升时间）

  function Firework(show, style, palette, launch, burst, rng, o) {
    o = o || {};
    this.show = show;
    this.rng = rng;
    this.style = style;
    this.palette = palette;
    this.spec = STYLES[style];
    this.x0 = launch[0]; this.y0 = launch[1];
    this.x1 = burst[0]; this.y1 = burst[1];
    this.x = this.x0; this.y = this.y0;
    this.vy = Math.sqrt(Math.max(1.0, 2 * ROCKET_G * (this.y1 - this.y0)));
    this.vx = (this.x1 - this.x0) / Math.max(1e-3, this.vy / ROCKET_G);
    this.phase = 'rise';
    this.children = [];
    // 发射尾迹：头端白热、尾端是凉掉的红
    this.trail = new el.Trail(show, this.x0, this.y0, {
      width: 1.7,
      hot: mix(palette.stem, palette.core, 0.35),
      cool: fade(palette.ray, 0.10)
    });
    this.rocket = new el.Rocket(show, this);
    this.children.push(this.trail, this.rocket);
    show.add(this.trail);
    show.add(this.rocket);
    this.emberAcc = 0.0;
    this.count = (o.count === undefined) ? null : o.count;
    this.radius = (o.radius === undefined) ? null : o.radius;
  }

  /* ---------------------------------------------------------------- 上升 */

  /**
   * 上升段：推进弹体、喂尾迹、撒几颗余烬。
   *
   * 爆完之后这里**什么都不做**：原来还有个"爆炸后继续撒火星"的分支 —— 它在爆点
   * （就是爆炸中心）以约 11 颗/秒继续喷余烬，一直喷到发射尾迹淡完（3.4s），实测
   * 全部余烬的 61% 来自这里。那批碎屑飘在中心不散，正是"烟花都爆完了粒子还在"的
   * 来源（有人截图的那一刻：在飞的 3 发全爆完了，屏幕上还有 21 火花 + 26 余烬）。
   * 现在爆点的碎屑只留爆心闪光那一瞬，要掉碎屑靠火花自己（willow / palm 的 ember）。
   *
   * 注意别顺手去收花火的 life / 上升尾迹：那些"余韵"是花型本身的样子，不是残留。
   */
  Firework.prototype.update = function (dt) {
    if (this.phase !== 'rise') return;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy -= ROCKET_G * dt;
    this.trail.push(this.x, this.y);                    // 把真实路径喂给尾迹
    this.emberAcc += dt;
    if (this.emberAcc > 0.07) {                         // 上升时撒一点火星
      this.emberAcc = 0.0;
      this.show.add(new el.Ember(this.show, this.x, this.y - 6,
                                 this.rng.uniform(-10, 10), -this.rng.uniform(20, 60),
                                 this.palette.stem, 2.2, this.rng.uniform(0.3, 0.7)));
    }
    if (this.vy <= 0.0) {
      this.y = this.y1;
      this.burst();
    }
  };

  /* ---------------------------------------------------------------- 爆炸 */

  Firework.prototype.burst = function () {
    this.phase = 'burst';
    this.rocket.alive = false;              // 弹体到此为止（尾迹不再喂点，自己熄灭）
    // 上升尾迹**照旧挂着慢慢熄**（Trail 默认 fadeTime 3.4s）：那是弹体留下的一道烟迹，
    // 是这一发"来过"的痕迹，别在爆开那一刻把它抹掉（试过切成 0.35s，观感像尾迹突然消失）。
    var rng = this.rng, spec = this.spec, pal = this.palette;
    var count = (this.count !== null) ? this.count : rng.randint(spec.count[0], spec.count[1]);
    // 画布太满就少炸几颗，别把帧率拖垮
    if (this.count === null) count = Math.max(6, pyRound(count * this.show.density()));
    var rmin, rmax;
    if (this.radius !== null) { rmin = this.radius[0]; rmax = this.radius[1]; }
    else { rmin = spec.radius[0]; rmax = spec.radius[1]; }
    var drag = spec.drag;
    var cx = this.x, cy = this.y;
    this.show.add(new el.Flash(this.show, cx, cy, pal, rng.uniform(26, 40)));

    var start = rng.uniform(0, 360);
    var sector = 360.0 / count;
    var jitter = (spec.jitter === undefined) ? 0.3 : spec.jitter;
    var floatUp = spec.float_up || 0.0;
    for (var i = 0; i < count; i++) {
      // 角度分层：每个火花在自己的扇区里抖动，均匀但不呆板
      var ang = start + sector * (i + rng.uniform(-1, 1) * jitter);
      var rad = rng.uniform(rmin, rmax);
      if (spec.spread !== undefined) {                  // 环：半径也收窄一点
        rad = rad * rng.uniform(1 - spec.spread, 1.0);
      }
      var th = ang * Math.PI / 180;
      var speed = rad * drag;                           // 阻尼模型下最终半径 ≈ v/k
      var vx = Math.cos(th) * speed;
      var vy = Math.sin(th) * speed + floatUp;          // 有些花型整体上飘

      // ↓↓↓ 以下取值顺序 = Python 关键字实参的求值顺序，不要重排 ↓↓↓
      var dot = rng.uniform(spec.dot[0], spec.dot[1]);
      var life = rng.uniform(spec.life[0], spec.life[1]);
      var gravity = spec.gravity * rng.uniform(0.85, 1.15);
      var sparkDrag = drag * rng.uniform(0.9, 1.1);
      var trailTime = (spec.trail || 0.0) * rng.uniform(0.9, 1.1);
      var trailSeg = (spec.trail_seg === undefined) ? 3 : spec.trail_seg;
      var emberRate = (spec.ember || 0.0) * rng.uniform(0.6, 1.4);

      this.show.add(new el.Spark(this.show, cx, cy, vx, vy, {
        color: pal.dot,
        trailHot: mix(pal.ray, pal.core, 0.22),         // 头端偏白热
        trailCool: fade(pal.ray, 0.18),                 // 尾端凉掉
        size: dot,
        life: life,
        gravity: gravity,
        drag: sparkDrag,
        trailTime: trailTime,
        trailSeg: trailSeg,
        emberRate: emberRate
      }));
    }
  };

  Firework.prototype.done = function () {
    if (this.phase !== 'burst') return false;
    for (var i = 0; i < this.children.length; i++) {
      if (this.children[i].alive) return false;
    }
    return true;
  };

  FW.firework = { Firework: Firework, ROCKET_G: ROCKET_G };
})(globalThis.FW || (globalThis.FW = {}));

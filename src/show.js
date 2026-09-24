/* ============================================================================
 * show.js —— 整场秀：管所有元素，按固定顺序推进一帧
 * 对应 turtle_fireworks.py 的 Show 一节（含 classic / original 两个场景布局）。
 * ---------------------------------------------------------------------------
 * 每帧的固定顺序（与原版一致）：
 *   1) 物理更新（可能产生新元素）
 *   2) 出图元（**临死这帧也要调 frame()**，因为它会消耗 rng）
 *   3) 收掉死亡元素 / 完成的烟花
 *   4) 排下一发的发射
 * 原版第 1 步之前还有「丢弃上一帧图章」和第 2、3 步之间的「橡皮涂抹」，
 * 在 canvas 里由整屏重绘取代，见 elements.js 顶部说明。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var data = FW.data, Fw = FW.firework.Firework;
  var HALLOWEEN = data.HALLOWEEN, MATRIX = data.MATRIX;
  var STYLE_NAMES = data.STYLE_NAMES, ORIGINAL = data.ORIGINAL;
  var stemSegments = FW.elements.stemSegments, FixedLine = FW.elements.FixedLine;
  var Spark = FW.elements.Spark;

  function Show(w, h, rng, o) {
    o = o || {};
    this.w = w;
    this.h = h;
    this.rng = rng;
    // 图元预算：一帧里所有元素画出的图元总数（性能保护）
    this.maxGeos = (o.maxGeos === undefined) ? 130 : o.maxGeos;
    // 增强模式：尾迹沿真实轨迹细采样（只影响画法，不影响物理/随机数）。
    // 可在运行中随时开关（读的就是这个字段）。
    this.denseTrails = (o.denseTrails === undefined) ? true : o.denseTrails;
    this.lastGeos = 0;
    this.elements = [];
    this.fireworks = [];
    this.frameGeos = [];                    // 最近一帧要画的图元（给渲染器）
    this.time = 0.0;
    this.nextSpawn = 0.0;
    this.nextFinale = rng.uniform(14.0, 22.0);
  }

  /* -------------------------------------------------------------- 元素 */

  Show.prototype.add = function (e) { this.elements.push(e); };

  /** 画布快满了就少放几颗火星（烟花照放，只是稀一点）。 */
  Show.prototype.density = function () {
    if (this.maxGeos <= 0) return 1.0;
    var ratio = this.lastGeos / this.maxGeos;
    if (ratio < 0.55) return 1.0;
    if (ratio < 0.85) return 0.65;
    if (ratio < 1.10) return 0.4;
    return 0.25;
  };

  Show.prototype.spawn = function (style, launch, burst, palette, o) {
    var fw = new Fw(this, style, palette, launch, burst, this.rng, o);
    this.fireworks.push(fw);
    return fw;
  };

  /** 随机发射点 / 爆心。 */
  Show.prototype.randomLaunch = function () {
    var rng = this.rng;
    var x0 = rng.uniform(-0.42, 0.42) * this.w;
    var x1 = Math.max(-0.46 * this.w,
                      Math.min(0.46 * this.w, x0 + rng.uniform(-0.20, 0.20) * this.w));
    var y1 = rng.uniform(0.06, 0.46) * this.h;          // 中上部炸开
    return [[x0, -this.h / 2 - 6], [x1, y1]];
  };

  Show.prototype.spawnRandom = function (n) {
    for (var i = 0; i < n; i++) {
      if (this.lastGeos > this.maxGeos || this.elements.length > 260) return;
      var style = this.rng.choice(STYLE_NAMES);         // 已经画不完了，这波先不放
      var lb = this.randomLaunch();
      this.spawn(style, lb[0], lb[1], data.randomPalette(this.rng));
    }
  };

  /* -------------------------------------------------------------- 场景 */

  /** 参考图风格的开场：左边红辐条 + 黄点，右边绿云团（几何是随机生成的）。 */
  Show.prototype.classicOpening = function () {
    this.spawn('spoke', [-152, -this.h / 2 - 6], [-204, 56], HALLOWEEN,
               { count: 14, radius: [138, 220] });
    this.spawn('cloud', [98, -this.h / 2 - 6], [226, 10], MATRIX,
               { count: 38, radius: [120, 310] });
    this.nextSpawn = 3.2;
  };

  /**
   * **复刻原版**：完全按参考截图里量出来的坐标/颜色摆出那两发烟花，第一帧与
   * 参考图一致（?scene=original&still=1 可以直接出对比图），之后火花照常往外
   * 飞、下坠、变暗，画面就活起来了。
   */
  Show.prototype.originalScene = function () {
    var t0 = this.time, rng = this.rng, i, dx, dy, ang, rad;

    // ---- 左：红射线 + 黄圆点 ------------------------------------------
    var cx = ORIGINAL.LEFT_CENTER[0], cy = ORIGINAL.LEFT_CENTER[1];
    for (i = 0; i < ORIGINAL.LEFT_DOTS.length; i++) {
      dx = ORIGINAL.LEFT_DOTS[i][0]; dy = ORIGINAL.LEFT_DOTS[i][1];
      ang = Math.atan2(dy - cy, dx - cx);
      rad = Math.hypot(dx - cx, dy - cy);
      var sp = new Spark(this, dx, dy, Math.cos(ang) * rad * 1.2, Math.sin(ang) * rad * 1.2, {
        color: ORIGINAL.YELLOW,
        trailHot: ORIGINAL.RAY,             // 原图里射线是均匀的纯红
        trailCool: ORIGINAL.RAY,
        size: ORIGINAL.DOT_R,
        life: rng.uniform(2.4, 3.0),
        gravity: 95.0, drag: 5.0,
        trailTime: 1e9,                     // 整条射线一直保留
        trailSeg: 1,                        // 一段直线：爆心 -> 圆点
        trailStep: 1e9                      // 中间不再采样
      });
      // 预先把「爆心 -> 圆点」这段路径塞进轨迹，第一帧就是一条直线
      sp.track = [[cx, cy, t0], [dx, dy, t0]];
      this.add(sp);
    }

    // ---- 右：绿圆点云团 ----------------------------------------------
    var bx = ORIGINAL.RIGHT_STEM[1][0], by = ORIGINAL.RIGHT_STEM[1][1];
    for (i = 0; i < ORIGINAL.RIGHT_DOTS.length; i++) {
      dx = ORIGINAL.RIGHT_DOTS[i][0]; dy = ORIGINAL.RIGHT_DOTS[i][1];
      ang = Math.atan2(dy - by, dx - bx);
      rad = Math.hypot(dx - bx, dy - by);
      this.add(new Spark(this, dx, dy, Math.cos(ang) * rad * 1.1, Math.sin(ang) * rad * 1.1, {
        color: ORIGINAL.GREEN,
        trailHot: ORIGINAL.GREEN, trailCool: ORIGINAL.GREEN,
        size: ORIGINAL.DOT_R,
        life: rng.uniform(2.6, 3.6),
        gravity: 70.0, drag: 2.6
      }));
    }

    // ---- 两条发射尾迹 ------------------------------------------------
    this.add(new FixedLine(this, stemSegments(
      ORIGINAL.LEFT_STEM[0], ORIGINAL.LEFT_STEM[1],
      ORIGINAL.STEM_LEFT[0], ORIGINAL.STEM_LEFT[1], ORIGINAL.STEM_HALF[0]), { life: 5.5 }));
    this.add(new FixedLine(this, stemSegments(
      ORIGINAL.RIGHT_STEM[0], ORIGINAL.RIGHT_STEM[1],
      ORIGINAL.STEM_RIGHT[0], ORIGINAL.STEM_RIGHT[1], ORIGINAL.STEM_HALF[1]), { life: 5.5 }));
    this.nextSpawn = 5.5;                   // 先静静看几秒原版
  };

  /* -------------------------------------------------------------- 每帧 */

  Show.prototype.step = function (dt) {
    this.time += dt;
    var i, j, els = this.elements, fws = this.fireworks;
    for (i = 0; i < fws.length; i++) fws[i].update(dt);

    // 1) 物理更新。用下标循环：Python 在遍历中 append 进来的 Ember 也会被本
    //    轮访问到，下标循环才能复现这一点（帧内的 rng 消耗顺序随之对齐）。
    for (i = 0; i < els.length; i++) els[i].update(dt);

    // 2) 出图元。临死这帧同样要调 frame()（它可能消耗 rng），只是不画出来。
    //    预算按 Python 口径结算：折线图元用它自己报的 cost（见 data.pathGeo）。
    var total = 0, out = [];
    for (i = 0; i < els.length; i++) {
      var e = els[i];
      var geos = e.frame();
      for (j = 0; j < geos.length; j++) total += (geos[j].cost === undefined ? 1 : geos[j].cost);
      if (e.alive) for (j = 0; j < geos.length; j++) out.push(geos[j]);
    }
    this.frameGeos = out;
    this.lastGeos = total;

    // 3) 收尸
    var aliveEls = [];
    for (i = 0; i < els.length; i++) if (els[i].alive) aliveEls.push(els[i]);
    this.elements = aliveEls;
    var aliveFws = [];
    for (i = 0; i < fws.length; i++) if (!fws[i].done()) aliveFws.push(fws[i]);
    this.fireworks = aliveFws;

    // 4) 排下一发（定期来一波齐射）
    if (this.time >= this.nextFinale) {
      this.nextFinale = this.time + this.rng.uniform(18.0, 30.0);
      this.spawnRandom(this.rng.randint(2, 4));
      this.nextSpawn = this.time + 2.0;
    } else if (this.time >= this.nextSpawn) {
      this.nextSpawn = this.time + this.rng.uniform(0.9, 2.3);
      this.spawnRandom(1);
    }
  };

  /** 开场：original=按截图实测坐标复刻；classic=参考图风格开场后继续随机；random=纯随机。 */
  function build(show, scene) {
    if (scene === 'original') show.originalScene();
    else if (scene === 'classic') show.classicOpening();
    else show.spawnRandom(2);
  }

  FW.show = { Show: Show, build: build };
})(globalThis.FW || (globalThis.FW = {}));

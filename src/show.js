/* ============================================================================
 * show.js —— 整场秀：管所有元素，按固定顺序推进一帧
 * 对应 turtle_fireworks.py 的 Show 一节（classic 场景布局）。
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
  var STYLE_NAMES = data.STYLE_NAMES, drawnCost = data.drawnCost;

  //: 每帧绘制预算的默认值（基本图元数：折线按段算）。按实测选的：这个值下画面密度
  //: 与原版口径时期基本一致（元素峰值 72~119），但数字真正对应 canvas 的开销。
  //: 注意节流是启发式的（只影响后续发射的火花数），所以单帧峰值会超过预算。
  var DEFAULT_GEOS = 450;

  function Show(w, h, rng, o) {
    o = o || {};
    this.w = w;
    this.h = h;
    this.rng = rng;
    // 绘制预算：一帧里**实际**画出多少个基本图元（折线按段数算）—— 它直接对应
    // canvas 的描边/填充开销，也是 density() 节流的依据。
    this.maxGeos = (o.maxGeos === undefined) ? DEFAULT_GEOS : o.maxGeos;
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

  /**
   * 拥挤度 -> 放量倍率。上一帧的实际图元数 / 预算 就是拥挤度：
   * 空着就多发、每发更大；满了就少发、每发更小。
   * 预算是**画面容量**而不是死线（节流是启发式的，单帧峰值会超过它）。
   */
  Show.prototype.crowd = function () {
    if (this.maxGeos <= 0) return 1.0;
    var load = this.lastGeos / this.maxGeos;
    if (load >= 1.15) return 0.25;      // 超了：明显收敛
    if (load >= 0.95) return 0.40;
    if (load >= 0.72) return 0.65;
    if (load >= 0.48) return 1.0;       // 差不多：按原样
    if (load >= 0.28) return 1.5;       // 还空：多发、每发大一点
    if (load >= 0.12) return 2.2;
    return 3.0;                         // 空得很：铺满
  };

  /** 每发的规模倍率（封顶 2：别让单发变成一颗巨型球）。 */
  Show.prototype.density = function () { return Math.min(2, this.crowd()); };

  /** 发射节奏倍率：间隔除以它。 */
  Show.prototype.pace = function () { return this.crowd(); };

  /** 是否已经超出预算（预算 <= 0 = 不限，别把它当成"永远超了"）。 */
  Show.prototype.full = function () {
    return this.maxGeos > 0 && this.lastGeos > this.maxGeos;
  };

  /** 元素表的安全上限：按预算缩放（原来写死 260，预算调大后会把画面卡住）。 */
  Show.prototype.elementCap = function () {
    return (this.maxGeos > 0) ? Math.round(this.maxGeos * 0.6) : 2000;
  };

  Show.prototype.spawn = function (style, launch, burst, palette, o) {
    var fw = new Fw(this, style, palette, launch, burst, this.rng, o);
    this.fireworks.push(fw);
    return fw;
  };

  /** 在指定的逻辑坐标炸一发（点击/触摸用）：从画面下方升上来，风格与配色随机。 */
  Show.prototype.launchAt = function (x, y) {
    if (this.full() || this.elements.length > this.elementCap()) return null;
    var lim = 20;
    x = Math.max(-this.w / 2 + lim, Math.min(this.w / 2 - lim, x));
    y = Math.max(-this.h / 2 + 60, Math.min(this.h / 2 - 30, y));
    var rng = this.rng;
    var style = rng.choice(STYLE_NAMES);
    var launch = [x + rng.uniform(-14, 14), -this.h / 2 - 6];
    return this.spawn(style, launch, [x, y], data.randomPalette(rng));
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
      if (this.full() || this.elements.length > this.elementCap()) return;
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

  /* -------------------------------------------------------------- 每帧 */

  Show.prototype.step = function (dt) {
    this.time += dt;
    var i, j, els = this.elements, fws = this.fireworks;
    for (i = 0; i < fws.length; i++) fws[i].update(dt);

    // 1) 物理更新。用下标循环：Python 在遍历中 append 进来的 Ember 也会被本
    //    轮访问到，下标循环才能复现这一点（帧内的 rng 消耗顺序随之对齐）。
    for (i = 0; i < els.length; i++) els[i].update(dt);

    // 2) 出图元。临死这帧同样要调 frame()（它可能消耗 rng），只是不画出来。
    //    预算按实际绘制开销结算（折线按段数），所以它反映的就是这一帧要画多少东西。
    var total = 0, out = [];
    for (i = 0; i < els.length; i++) {
      var e = els[i];
      var geos = e.frame();
      for (j = 0; j < geos.length; j++) total += drawnCost(geos[j]);
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

    // 4) 排下一发（定期来一波齐射）。节奏也跟着拥挤度走：空的时候间隔更短、
    //    齐射更大，所以把预算调大是真的会变满，而不只是"少压一点"。
    if (this.time >= this.nextFinale) {
      this.nextFinale = this.time + this.rng.uniform(18.0, 30.0) / this.pace();
      this.spawnRandom(Math.round(this.rng.randint(2, 4) * this.density()));
      this.nextSpawn = this.time + 2.0;
    } else if (this.time >= this.nextSpawn) {
      this.nextSpawn = this.time + this.rng.uniform(0.9, 2.3) / this.pace();
      this.spawnRandom(1);
    }
  };

  /** 开场：classic=参考图风格（左右两发的配色/花型）；random=纯随机。 */
  function build(show, scene) {
    if (scene === 'classic') show.classicOpening();
    else show.spawnRandom(2);
  }

  FW.show = { Show: Show, build: build, DEFAULT_GEOS: DEFAULT_GEOS };
})(globalThis.FW || (globalThis.FW = {}));

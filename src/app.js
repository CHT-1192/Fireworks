/* ============================================================================
 * app.js —— 浏览器外壳：固定步长主循环 + 键盘 / 控制台 + HUD
 * 对应 turtle_fireworks.py 的 TurtleApp 与命令行一节。
 * ---------------------------------------------------------------------------
 * 和原版的两处有意的差别：
 *   * 原版用 ontimer + 实测帧间隔 dt 推进（帧率抖动会改变整场演出）；
 *     这里改成**固定 1/60 步长 + 累加器**，所以「同 seed = 同一场」在浏览器里
 *     是严格成立的，也正好对上原版 --render 的固定步长。
 *   * original 场景的逻辑坐标固定为参考图的 924×691，窗口再大也是完整构图
 *     （等比缩放居中），而不是被裁掉。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var FIXED_DT = 1 / 60;                 // 固定步长（= 原版 --render 的 60fps）
  var MAX_STEPS = 4;                     // 单帧最多追几步，避免掉帧后雪崩
  var DT_CLAMP = 0.06;                   // 单帧最多推进 60ms（同原版）
  var ORIGINAL = FW.data.ORIGINAL;

  var SCENES = {
    classic: ['参考图风格', '按参考图的配色/花型开场，随后继续随机放'],
    random: ['纯随机', '全部程序化随机生成的一场烟花秀'],
    original: ['原版复刻', '按截图实测坐标/颜色摆出那两发烟花（可与参考图逐帧对比）']
  };

  function $(id) { return document.getElementById(id); }

  function App() {
    var q = new URLSearchParams(location.search);
    this.canvas = $('stage');
    this.renderer = new FW.view.Renderer(this.canvas, 2);

    this.scene = SCENES[q.get('scene')] ? q.get('scene') : 'classic';
    this.seed = parseInt(q.get('seed'), 10);
    if (!(this.seed >= 0)) this.seed = FW.rng.defaultSeed();
    this.maxGeos = parseInt(q.get('max'), 10) || 130;
    // ?w=&h= 钉死逻辑坐标系（对应原版的 --width/--height）：构图与窗口大小无关，
    // 还原 Python 那一场 / 逐像素对拍时必须用。
    this.forceW = parseInt(q.get('w'), 10) || 0;
    this.forceH = parseInt(q.get('h'), 10) || 0;
    // ?frames=N 与 --render --frames N 同一条路径；?still=1 等价于 frames=1（参考图那一帧）
    if (q.has('frames')) this.freezeFrames = Math.max(1, parseInt(q.get('frames'), 10) || 1);
    else if (q.get('still') === '1' || q.get('still') === '') this.freezeFrames = 1;
    else this.freezeFrames = null;

    this.paused = false;
    this.hideUi = (q.get('ui') === '0');   // ?ui=0 开局就收起控制台（截图 / 嵌入用）
    // 光滑尾迹（canvas 增强）：?exact=1 关掉，退回原版的 2~6 段折线口径（兼容层，
    // 供行为基线与原版逐像素对拍使用；日常用法不必关心）
    this.denseTrails = (q.get('exact') !== '1');
    this.acc = 0.0;
    this.frames = 0;
    this.fps = 0;
    this.fpsT = performance.now();
    this.last = this.fpsT;
    this.show = null;

    this.build();
    this.bindPanel();
    this.bindKeys();
    this.syncPanel();
    if (this.hideUi) this.hideAllUi();
    this.last = performance.now();
    var self = this;
    requestAnimationFrame(function (t) { self.tick(t); });
  }

  /* ------------------------------------------------------------ 构建 / 重开 */

  App.prototype.build = function () {
    var cw = this.canvas.clientWidth || window.innerWidth;
    var ch = this.canvas.clientHeight || window.innerHeight;
    var lw, lh;
    if (this.forceW && this.forceH) { lw = this.forceW; lh = this.forceH; }
    else if (this.scene === 'original') { lw = ORIGINAL.W; lh = ORIGINAL.H; }
    else { lw = cw; lh = ch; }
    this.show = new FW.show.Show(lw, lh, new FW.rng.Random(this.seed),
                                 { maxGeos: this.maxGeos, denseTrails: this.denseTrails });
    FW.show.build(this.show, this.scene);
    this.acc = 0.0;
    if (this.freezeFrames !== null) {
      // 与 --render 完全同一条路径：先 step(0) 出初始几何，再走 N-1 个 1/60 步
      this.show.step(0.0);
      for (var i = 1; i < this.freezeFrames; i++) this.show.step(FIXED_DT);
      this.paused = true;
    }
    this.renderer.layout(this.show.w, this.show.h);
    document.title = '烟花 · seed ' + this.seed + ' · ' + this.scene;
    this.syncPanel();
  };

  /** 换场景 / 换种子 / 重放：整场重开。 */
  App.prototype.rebuild = function (scene, seed) {
    if (scene !== undefined && scene !== null) this.scene = scene;
    if (seed !== undefined && seed !== null) this.seed = seed;
    this.freezeFrames = null;                    // URL 的定格帧只在首次加载生效
    this.paused = false;
    this.build();
  };

  /* --------------------------------------------------------------- 主循环 */

  App.prototype.tick = function (now) {
    try {
      this.stepFrame(now);
    } catch (err) {
      // 与原版 TurtleApp.tick 一样不让一帧的异常把窗口卡死：原版打印 traceback 后
      // 停掉；这里把错误摆到 HUD 上 —— canvas 里 rAF 抛的异常默认是看不见的。
      this.crashed = true;
      console.error(err);
      $('panel').hidden = false;
      $('hud').hidden = false;
      $('show').hidden = true;
      var st = $('hud-state');
      st.textContent = '出错: ' + err.message;
      st.style.color = '#ff8a8a';
      return;                                  // 不再排下一帧
    }
    var self = this;
    requestAnimationFrame(function (t) { self.tick(t); });
  };

  /** 一帧：固定步长推进 + 重绘 + HUD（异常由 tick 兜住）。 */
  App.prototype.stepFrame = function (now) {
    var dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 1e-4;
    dt = Math.min(DT_CLAMP, Math.max(1e-4, dt));

    if (!this.paused) {
      this.acc += dt;
      var steps = 0;
      while (this.acc >= FIXED_DT && steps < MAX_STEPS) {
        this.show.step(FIXED_DT);
        this.acc -= FIXED_DT;
        steps++;
      }
      if (steps >= MAX_STEPS) this.acc = 0.0;    // 落后太多就丢掉，不追
    }

    this.fit();
    this.renderer.draw(this.show.frameGeos);
    this.frames++;
    if (now - this.fpsT >= 500) {
      this.fps = this.frames * 1000 / (now - this.fpsT);
      this.frames = 0;
      this.fpsT = now;
      this.hud();
    }
  };

  /** 窗口尺寸变了：重算适配缩放；非 original 场景顺带把逻辑尺寸铺满窗口。 */
  App.prototype.fit = function () {
    var cw = this.canvas.clientWidth || window.innerWidth;
    var ch = this.canvas.clientHeight || window.innerHeight;
    if (cw === this.renderer.cw && ch === this.renderer.ch) return;
    var pinned = (this.forceW && this.forceH) || this.scene === 'original';
    if (!pinned) { this.show.w = cw; this.show.h = ch; }
    this.renderer.layout(this.show.w, this.show.h);
  };

  /* ------------------------------------------------------------------ HUD */

  App.prototype.hud = function () {
    $('hud-seed').textContent = this.seed;
    $('hud-scene').textContent = this.scene;
    $('hud-fps').textContent = this.fps.toFixed(0);
    $('hud-budget').textContent = this.show.lastGeos;
    $('hud-geos').textContent = this.renderer.geos;
    $('hud-segs').textContent = this.renderer.segs;
    $('hud-els').textContent = this.show.elements.length;
    $('hud-fw').textContent = this.show.fireworks.length;
    $('hud-wh').textContent = Math.round(this.show.w) + '×' + Math.round(this.show.h)
      + (Math.abs(this.renderer.scale - 1) > 1e-6 ? ' @' + this.renderer.scale.toFixed(2) : '');
    $('hud-time').textContent = this.show.time.toFixed(1) + 's';
    $('hud-state').textContent = this.paused
      ? (this.freezeFrames !== null || this.show.time === 0 ? '已定格' : '已暂停')
      : '运行中';
  };

  /** 把内部状态刷到控件上（换场景/换种子后调用）。 */
  App.prototype.syncPanel = function () {
    $('scene').value = this.scene;
    $('seed').value = this.seed;
    $('budget').value = this.maxGeos;
    $('dense').checked = this.denseTrails;
    $('budget-val').textContent = this.maxGeos;
    $('pause').textContent = this.paused ? '继续' : '暂停';
    $('scene-help').textContent = SCENES[this.scene][1];
    this.hud();
  };

  /* -------------------------------------------------------------- 交互 */

  App.prototype.togglePause = function () {
    if (this.paused && this.freezeFrames !== null) {
      // 从定格帧接着往下放（复刻图 → 会动的复刻版）
      this.freezeFrames = null;
    }
    this.paused = !this.paused;
    this.acc = 0.0;
    this.syncPanel();
  };

  App.prototype.bindPanel = function () {
    var self = this;
    $('scene').addEventListener('change', function () { self.rebuild(this.value, null); });
    $('seed').addEventListener('change', function () {
      var v = parseInt(this.value, 10);
      self.rebuild(null, (v >= 0) ? v : FW.rng.defaultSeed());
    });
    $('dice').addEventListener('click', function () {
      self.rebuild(null, FW.rng.defaultSeed());
    });
    $('pause').addEventListener('click', function () { self.togglePause(); });
    $('extra').addEventListener('click', function () { self.show.spawnRandom(1); });
    $('still').addEventListener('click', function () {
      self.rebuild('original', self.seed);
      self.show.step(0.0);                      // 第 1 帧 = 参考图
      self.paused = true;
      self.syncPanel();
    });
    $('replay').addEventListener('click', function () { self.rebuild(self.scene, self.seed); });
    $('save').addEventListener('click', function () { self.savePng(); });
    $('hide').addEventListener('click', function () { self.toggleUi(false); });
    $('show').addEventListener('click', function () { self.toggleUi(true); });
    $('dense').addEventListener('change', function () {
      // 只改画法，不动物理：运行中途开关都不会影响这一场演出
      self.show.denseTrails = this.checked;
      self.denseTrails = this.checked;
    });
    $('budget').addEventListener('input', function () {
      self.maxGeos = parseInt(this.value, 10);
      self.show.maxGeos = self.maxGeos;
      $('budget-val').textContent = self.maxGeos;
    });
  };

  App.prototype.bindKeys = function () {
    var self = this;
    window.addEventListener('keydown', function (e) {
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); self.togglePause(); }
      else if (e.key === 'r' || e.key === 'R') self.show.spawnRandom(1);
      else if (e.key === 'Escape') self.toggleUi($('panel').hidden);
    });
  };

  /** ?ui=0：面板 / HUD / ≡ 按钮全部藏掉（截图、嵌入用）。 */
  App.prototype.hideAllUi = function () {
    $('panel').hidden = true;
    $('hud').hidden = true;
    $('show').hidden = true;
  };

  App.prototype.toggleUi = function (showPanel) {
    $('panel').hidden = !showPanel;
    $('hud').hidden = !showPanel;
    $('show').hidden = showPanel;
  };

  App.prototype.savePng = function () {
    var a = document.createElement('a');
    a.download = 'fireworks_' + this.scene + '_seed' + this.seed
               + '_t' + this.show.time.toFixed(2) + '.png';
    a.href = this.renderer.toDataURL();
    a.click();
  };

  function boot() { FW.app = new App(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(globalThis.FW || (globalThis.FW = {}));

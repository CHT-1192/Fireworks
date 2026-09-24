/* ============================================================================
 * app.js —— 应用核心：状态 + 固定步长主循环
 * ---------------------------------------------------------------------------
 * 这里**不碰 DOM**：构造时只接收一个 canvas 和 URL 查询参数，HUD / 控制台 / 键盘
 * 全部通过下面这些钩子交给 src/ui.js 实现（钩子默认是空操作）。好处：
 *   * app.js 能在 Node 里直接构造、手动推进来测（真浏览器那一段交给 browser_check）
 *   * UI 改动不会碰到主循环，主循环改动不会碰到 DOM
 *
 * 主循环用**固定 1/60 步长累加器**推进物理（不是跟着 rAF 的实测 dt），所以同一个
 * seed 每次都能放出一模一样的一场；单帧最多追 4 步，掉帧不雪崩。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var FIXED_DT = 1 / 60;                 // 固定步长（= 原版离线渲染的 60fps）
  var MAX_STEPS = 4;                     // 单帧最多追几步
  var DT_CLAMP = 0.06;                   // 单帧最多推进 60ms（同原版）

  var SCENES = {
    classic: ['参考图风格', '左右两发照参考图的配色/花型开场，随后继续随机放'],
    random: ['纯随机', '全部程序化随机生成的一场烟花秀']
  };

  /**
   * 彩蛋密语。种子框**正常只收数字**；字母必须一个字符一个字符敲对才留得下来，
   * 所以"试探每个字母"本身就是找彩蛋的过程（敲错了那个字符根本进不去）。
   * 想换彩蛋就改这一行 —— 提示语里的字母个数会自动跟着变。
   */
  var SECRET = 'TURTLE';

  /** 种子框允许的内容：全数字，或者密语的正确前缀（含空串）。 */
  function seedContentOk(text) {
    if (/^\d*$/.test(text)) return true;
    return text === SECRET.slice(0, text.length);
  }

  /** 外部来的种子（URL / 输入框）规整：数字原样、密语原样，其它一律不认。 */
  function seedFromRaw(raw) {
    var text = String(raw == null ? '' : raw).trim().toUpperCase();
    if (/^\d+$/.test(text)) return text;
    return text === SECRET ? text : '';
  }

  /**
   * 场景：数字种子 -> 纯随机秀；敲对了密语 -> 参考图风格。
   * ?scene= 显式指定时以它为准，方便分享链接里锁死场景。
   */
  function sceneForSeed(seed, sceneParam) {
    if (SCENES[sceneParam]) return sceneParam;
    return seed === SECRET ? 'classic' : 'random';
  }

  /** opts = { canvas, search: URLSearchParams }。构造完不会自己开跑，需 start()。 */
  function App(opts) {
    var q = opts.search;
    this.canvas = opts.canvas;
    this.renderer = new FW.view.Renderer(this.canvas, 2);

    // 种子：URL 里是数字就用它，是密语就用密语，其它（含乱敲的字母）一律不认，
    // 退回随机数字种子。
    var raw = seedFromRaw(q.get('seed'));
    this.secretFound = (raw === SECRET);
    this.seed = raw || String(FW.rng.defaultSeed());
    this.scene = sceneForSeed(this.seed, q.get('scene'));
    this.maxGeos = parseInt(q.get('max'), 10) || FW.show.DEFAULT_GEOS;
    // ?w=&h= 钉死逻辑坐标系（对应原版的 --width/--height）：构图与窗口大小无关
    this.forceW = parseInt(q.get('w'), 10) || 0;
    this.forceH = parseInt(q.get('h'), 10) || 0;
    // ?frames=N 先走 N 个固定步再定格；?still=1 等价于 frames=1（参考图那一帧）
    if (q.has('frames')) this.freezeFrames = Math.max(1, parseInt(q.get('frames'), 10) || 1);
    else if (q.get('still') === '1' || q.get('still') === '') this.freezeFrames = 1;
    else this.freezeFrames = null;
    this.hideUi = (q.get('ui') === '0');   // ?ui=0 开局就收起控制台（截图 / 嵌入用）

    this.paused = false;
    this.crashed = false;
    this.uiHidden = false;
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
    // 同步画第一帧：避免开局空窗，也让"页面到底跑没跑起来"能直接从 DOM 读到
    // （无头 --dump-dom 模式下 rAF 不保证触发）
    this.fit();
    this.renderer.draw(this.show.frameGeos);
    this.hud();
  }

  /* ---------------------------------------------------- UI 钩子（ui.js 覆盖） */

  App.prototype.hud = function () {};
  App.prototype.syncPanel = function () {};
  App.prototype.bindPanel = function () {};
  App.prototype.bindKeys = function () {};
  App.prototype.onError = function (err) { console.error(err); };

  /* ------------------------------------------------------------ 构建 / 重开 */

  App.prototype.build = function () {
    var cw = this.canvas.clientWidth || this.canvas.width || 1;
    var ch = this.canvas.clientHeight || this.canvas.height || 1;
    var lw, lh;
    if (this.forceW && this.forceH) { lw = this.forceW; lh = this.forceH; }
    else { lw = cw; lh = ch; }
    this.show = new FW.show.Show(lw, lh, new FW.rng.Random(this.seed),
                                 { maxGeos: this.maxGeos });
    FW.show.build(this.show, this.scene);
    this.acc = 0.0;
    if (this.freezeFrames !== null) {
      // 固定步长走 N 帧后定格（第 1 帧 = step(0)，就是初始几何）
      this.show.step(0.0);
      for (var i = 1; i < this.freezeFrames; i++) this.show.step(FIXED_DT);
      this.paused = true;
    }
    this.renderer.layout(this.show.w, this.show.h);
  };

  /**
   * 换种子 / 换场景 / 重放，整场重开（URL 里的定格帧只在首次加载生效）。
   * scene 传 null/undefined = 按种子形态重新推断（字母 -> 参考图风格，数字 -> 纯随机）。
   */
  App.prototype.rebuild = function (scene, seed) {
    if (seed !== undefined && seed !== null) {
      var raw = seedFromRaw(seed);
      this.secretFound = (raw === SECRET);
      this.seed = raw || String(FW.rng.defaultSeed());   // 认不出来就换个数字种子
    }
    this.scene = sceneForSeed(this.seed, scene);
    this.freezeFrames = null;
    this.paused = false;
    this.build();
    this.syncPanel();
  };

  /** 随机换一个数字种子（纯随机秀）。 */
  App.prototype.reseed = function () { this.rebuild(undefined, FW.rng.defaultSeed()); };

  /* --------------------------------------------------------------- 主循环 */

  App.prototype.start = function () {
    this.last = performance.now();
    this.fpsT = this.last;
    var self = this;
    requestAnimationFrame(function (t) { self.tick(t); });
  };

  App.prototype.tick = function (now) {
    try {
      this.stepFrame(now);
    } catch (err) {
      this.crashed = true;
      this.paused = true;
      this.onError(err);      // ui.js 会把错误摆到 HUD 上：rAF 里的异常默认看不见
      return;                 // 不再排下一帧
    }
    var self = this;
    requestAnimationFrame(function (t) { self.tick(t); });
  };

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

  /** 窗口尺寸变了：重算适配缩放；未钉死坐标系的场景顺带把逻辑尺寸铺满窗口。 */
  App.prototype.fit = function () {
    var cw = this.canvas.clientWidth || this.canvas.width || 1;
    var ch = this.canvas.clientHeight || this.canvas.height || 1;
    if (cw === this.renderer.cw && ch === this.renderer.ch) return;
    if (!(this.forceW && this.forceH)) { this.show.w = cw; this.show.h = ch; }
    this.renderer.layout(this.show.w, this.show.h);
  };

  /* ---------------------------------------------------------------- 操作 */

  App.prototype.togglePause = function () {
    if (this.paused && this.freezeFrames !== null) {
      this.freezeFrames = null;     // 从定格帧接着往下放（复刻图 -> 会动的复刻版）
    }
    this.paused = !this.paused;
    this.acc = 0.0;
    this.syncPanel();
  };

  App.prototype.extra = function () { this.show.spawnRandom(1); };

  FW.app = { App: App, SCENES: SCENES, FIXED_DT: FIXED_DT,
             sceneForSeed: sceneForSeed, seedContentOk: seedContentOk,
             seedFromRaw: seedFromRaw, SECRET: SECRET };
})(globalThis.FW || (globalThis.FW = {}));

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

  /**
   * 种子框只认这一个词。整场秀只有一种（纯随机），这个词换来的不是另一种"场"，
   * 而是一次**插播**：两发参考图风格的烟花。正常只收数字，字母必须一个字符一个
   * 字符敲对才留得下来（敲错的当场被弹回去），所以"一个一个字母试"本身就有反馈。
   * 换词就改这一行 —— 提示语里的字母个数会自动跟着变。
   *
   * 它**不是种子**：敲对的那一刻只往正在放的这场里插两发，种子仍是原来那个数字。
   * 所以链接、文件名、PNG/WebM 元数据里都不会出现它 —— 那个词发不出去。
   */
  var SECRET = 'FIREWORKS';

  /** 种子框允许的内容：全数字，或者密语的正确前缀（含空串）。 */
  function seedContentOk(text) {
    if (/^\d*$/.test(text)) return true;
    return text === SECRET.slice(0, text.length);
  }

  /** 外部来的种子（URL / 存储 / 输入框）规整：只认数字，其它一律不认。 */
  function seedFromRaw(raw) {
    var text = String(raw == null ? '' : raw).trim();
    return /^\d+$/.test(text) ? text : '';
  }

  /**
   * opts = { canvas, search, store }
   *   store 是 { get(key), set(key, value) } —— 由 ui.js 用 localStorage 实现，
   *   app.js 自己不碰 DOM/存储（这样主循环在 Node 里也能测）。
   * 存储里两个键：`seed` = 这一场的数字种子，`daily` = '1' 表示这一场跟着日期走。
   * 构造完不会自己开跑，需 start()。
   */
  function App(opts) {
    var q = opts.search;
    this.canvas = opts.canvas;
    this.store = opts.store || { get: function () { return null; }, set: function () {} };
    this.renderer = new FW.view.Renderer(this.canvas, 2);

    // 种子的来源顺序：URL -> "每日"这个模式 -> 上次用过的 -> 今天这一场。都只认数字；
    // 那个词不是种子（它只在种子框里被敲对的那一刻插播两发，见 interlude()）。
    var raw = seedFromRaw(q.get('seed'));
    var kept = this.store.get('seed');
    if (raw) {
      this.dailyMode = false;              // 链接里明确给了种子 = 钉住那一场，不跟日期走
    } else if (this.store.get('daily') === '1') {
      raw = String(FW.rng.dailySeed());    // 上次就在"每日"：那今天就放今天这一场
      this.dailyMode = true;
    } else {
      raw = seedFromRaw(kept);
      // 更早的版本把那个词当种子存过（fw.seed=FIREWORKS）：认不出来就顺手抹掉，
      // 别让它留在浏览器存储里 —— 那也是会被翻出来的地方。
      this.dailyMode = !raw;               // 第一次来（没有可用种子）：今天这一场 + 每日
      if (!raw) raw = String(FW.rng.dailySeed());
    }
    this.eggFound = false;               // 那个词只在本场被敲对时置位，不进 URL/存储
    this.seed = raw;
    this.persistSeed();
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
  App.prototype.onDayRoll = function () {};      // "每日"跨日自动换场后通知 UI

  /* ------------------------------------------------------------ 构建 / 重开 */

  App.prototype.build = function () {
    var cw = this.canvas.clientWidth || this.canvas.width || 1;
    var ch = this.canvas.clientHeight || this.canvas.height || 1;
    var lw, lh;
    if (this.forceW && this.forceH) { lw = this.forceW; lh = this.forceH; }
    else { lw = cw; lh = ch; }
    this.show = new FW.show.Show(lw, lh, new FW.rng.Random(this.seed),
                                 { maxGeos: this.maxGeos });
    FW.show.build(this.show);
    this.acc = 0.0;
    if (this.freezeFrames !== null) {
      // 固定步长走 N 帧后定格（第 1 帧 = step(0)，就是初始几何）
      this.show.step(0.0);
      for (var i = 1; i < this.freezeFrames; i++) this.show.step(FIXED_DT);
      this.paused = true;
    }
    this.renderer.layout(this.show.w, this.show.h);
  };

  /** 把"这一场"和"每日"开关一起落盘（存储被禁用时 store 自己吞掉异常）。 */
  App.prototype.persistSeed = function () {
    this.store.set('seed', this.seed);
    this.store.set('daily', this.dailyMode ? '1' : '0');
  };

  /**
   * 换种子 / 重放，整场重开（URL 里的定格帧只在首次加载生效）。
   * seed 认不出来就换一个数字种子；daily 传 true/false 会切换"每日"开关，
   * 不传（重放）就保持原样。所以种子框里敲数字 = 钉住那一场，退出"每日"。
   */
  App.prototype.rebuild = function (seed, daily) {
    if (seed !== undefined && seed !== null) {
      var raw = seedFromRaw(seed);
      if (!raw) raw = String(FW.rng.defaultSeed());      // 认不出来就换个数字种子
      this.seed = raw;
    }
    if (daily !== undefined) this.dailyMode = !!daily;
    this.persistSeed();
    this.freezeFrames = null;
    this.paused = false;
    this.build();
    this.syncPanel();
  };

  /** 随机换一个数字种子（钉住这一场，退出"每日"）。 */
  App.prototype.reseed = function () { this.rebuild(FW.rng.defaultSeed(), false); };

  /** 跳到"今天这一场"，并进入"每日"：以后每天都会自动换成当天那一场。 */
  App.prototype.daily = function () { this.rebuild(FW.rng.dailySeed(), true); };

  /**
   * 跨日检测（只在"每日"模式下有意义）：日期一过就自己换成新一天那一场。
   * 由主循环每 500ms 那一拍调用；标签页在后台时 rAF 本来就停着，回到前台时补上。
   * 暂停中（或 ?frames= 定格中）不打扰 —— 解除暂停后的第一拍就会换。
   */
  App.prototype.checkDay = function () {
    if (!this.dailyMode || this.paused || this.freezeFrames !== null) return false;
    var today = String(FW.rng.dailySeed());
    if (today === this.seed) return false;
    this.rebuild(today, true);             // 换天的同时保持"每日"
    this.onDayRoll(this.seed);
    return true;
  };

  /**
   * 插播：往**正在放的**这场里塞两发参考图风格（那个词刚被敲对时调用）。
   * 不重开——画面接着放，只是多了这两发。**种子不动**：那个词不是种子，只在敲对的
   * 这一刻生效，所以分享链接、文件名与元数据里永远只有那个数字种子，带不走它。
   */
  App.prototype.interlude = function () {
    this.show.interlude();
    this.eggFound = true;
    this.syncPanel();          // 顺带把种子框刷回数字：屏幕上不留那个词的痕迹
  };

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
      this.checkDay();          // "每日"模式下跨日了：自己换成今天这一场
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

  /** 点/触摸画布：把屏幕坐标换算成逻辑坐标，在那里炸一发。 */
  App.prototype.launchAt = function (clientX, clientY) {
    var r = this.renderer;
    var rect = this.canvas.getBoundingClientRect();
    var x = (clientX - rect.left - r.ox) / r.scale;
    var y = (r.oy - (clientY - rect.top)) / r.scale;
    return this.show.launchAt(x, y);
  };

  /**
   * 这一场的链接：基于**当前页面地址**，所以在子路径下托管（比如 GitHub Pages）
   * 也照样能用；file:// 打开时给出的仍是本地文件地址。
   */
  App.prototype.shareUrl = function () {
    var q = ['seed=' + encodeURIComponent(this.seed)];
    if (this.maxGeos !== FW.show.DEFAULT_GEOS) q.push('max=' + this.maxGeos);
    return location.href.split('#')[0].split('?')[0] + '?' + q.join('&');
  };

  FW.app = { App: App, FIXED_DT: FIXED_DT, SECRET: SECRET,
             seedContentOk: seedContentOk, seedFromRaw: seedFromRaw };
})(globalThis.FW || (globalThis.FW = {}));

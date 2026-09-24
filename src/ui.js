/* ============================================================================
 * ui.js —— 所有 DOM：控制台、HUD、键盘、存 PNG、入口启动
 * ---------------------------------------------------------------------------
 * app.js 只留状态与主循环，并留了一组钩子（hud / syncPanel / bindPanel /
 * bindKeys / onError）；这里把那组钩子实现出来，然后在 DOM 就绪后创建 App。
 * 之所以把"启动"也放在这里：脚本按 manifest 顺序加载，本文件是最后一个，
 * 保证 App 的钩子在被构造之前就已就位。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------------ HUD */

  FW.app.App.prototype.hud = function () {
    var rows = {
      seed: this.seed,
      fps: this.fps.toFixed(0),
      budget: this.show.lastGeos + ' / ' + this.show.maxGeos,
      geos: this.renderer.geos,
      segs: this.renderer.segs,
      fw: this.show.fireworks.length,
      wh: Math.round(this.show.w) + '×' + Math.round(this.show.h)
        + (Math.abs(this.renderer.scale - 1) > 1e-6 ? ' @' + this.renderer.scale.toFixed(2) : ''),
      time: this.show.time.toFixed(1) + 's',
      state: this.paused
        ? ((this.freezeFrames !== null || this.show.time === 0) ? '已定格' : '已暂停')
        : '运行中'
    };
    for (var k in rows) {
      var el = $('hud-' + k);
      if (el) el.textContent = rows[k];        // 标记里没有这一项就跳过
    }
  };

  /** 把内部状态刷到控件上（换种子 / 插播 / 跨日 / 暂停后调用）。 */
  FW.app.App.prototype.syncPanel = function () {
    $('seed').value = this.seed;
    $('budget').value = this.maxGeos;
    $('budget-val').textContent = this.maxGeos;
    $('pause').textContent = this.paused ? '继续' : '暂停';
    // 「每日」是个开关：亮着 = 这一场会跟着日期自动换（每天零点后自己变成新的一天）
    var d = $('daily');
    if (d) {
      d.setAttribute('aria-pressed', this.dailyMode ? 'true' : 'false');
      d.title = this.dailyMode
        ? '今日这一场（已开启：跨日会自己换成新的一天）'
        : '回到今天这一场，并跟着日期自动更新';
    }
    document.title = '烟花 · Fireworks · seed ' + this.seed;
    this.applyUiVisibility();
    this.hud();
  };

  /** "每日"模式下跨日自动换场了：在控制台说一声，别打断画面。 */
  FW.app.App.prototype.onDayRoll = function (seed) {
    console.log('%c跨日 —— 换成今天的这一场', 'color:#7fd1ff;font-weight:600', 'seed ' + seed);
  };

  FW.app.App.prototype.applyUiVisibility = function () {
    var hidden = this.hideUi || this.uiHidden;
    $('panel').hidden = hidden;
    $('hud').hidden = hidden;
    // ?ui=0 是"彻底无 UI"（截图 / 嵌入），连恢复按钮都不留；
    // 手动「收起」才留一个「控制台」按钮把面板叫回来。
    $('show').hidden = this.hideUi || !hidden;
  };

  FW.app.App.prototype.toggleUi = function () {
    this.uiHidden = !this.uiHidden;
    this.applyUiVisibility();
  };

  /** 出错了：把信息摆到 HUD 上（canvas 里 rAF 抛的异常默认是看不见的）。 */
  FW.app.App.prototype.onError = function (err) {
    console.error(err);
    this.hideUi = false;
    this.uiHidden = false;
    this.applyUiVisibility();
    var st = $('hud-state');
    st.textContent = '出错: ' + err.message;
    st.style.color = '#ff8a8a';
  };

  /* --------------------------------------------------------------- 交互 */

  /**
   * 种子框的"逐字符"守卫：正常只收数字；字母只有当它正好接上那个词时才留得下来，
   * 敲错了就当场退回上一个合法内容并抖一下 —— 所以"一个一个字母试"是有反馈的。
   * 粘贴也走同一条校验。
   */
  FW.app.App.prototype.bindSeedInput = function () {
    var self = this;
    var input = $('seed');
    var lastValid = this.seed;
    input.value = lastValid;

    input.addEventListener('input', function () {
      var text = this.value.toUpperCase();
      if (!FW.app.seedContentOk(text)) {          // 既不是数字，也不是那个词的前缀
        this.value = lastValid;
        this.classList.remove('reject');
        void this.offsetWidth;                    // 强制重排，动画才会重播
        this.classList.add('reject');
        clearTimeout(self.rejectTimer);
        self.rejectTimer = setTimeout(function () { input.classList.remove('reject'); }, 240);
        return;
      }
      lastValid = text;
      this.value = text;
      if (text === FW.app.SECRET) {               // 拼全了：当场插播一次
        self.interlude();
        lastValid = this.value;                   // 框里已被刷回数字种子
        console.log('%c插播：参考图风格的两发', 'color:#ffd34d;font-weight:700');
      }
    });

    // 聚焦就全选：想换种子直接敲，不用先手动删掉旧的
    input.addEventListener('focus', function () { this.select(); });

    // 回车 = 敲完了：收起焦点，快捷键随即恢复（否则 R 还会被当成在打字）
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') this.blur();
    });

    // 数字种子在失焦 / 回车时生效（免得每敲一位就重开一场）
    input.addEventListener('change', function () {
      if (/^\d+$/.test(this.value)) self.rebuild(this.value, false);   // 敲数字 = 钉住这一场
      else if (this.value === '') self.reseed();
    });
  };

  FW.app.App.prototype.bindPanel = function () {
    var self = this;
    this.bindSeedInput();
    $('dice-number').addEventListener('click', function () { self.reseed(); });
    $('pause').addEventListener('click', function () { self.togglePause(); });
    $('extra').addEventListener('click', function () { self.extra(); });
    $('replay').addEventListener('click', function () { self.rebuild(self.seed); });
    $('save').addEventListener('click', function () { self.savePng(); });
    $('hide').addEventListener('click', function () { self.toggleUi(); });
    $('record').addEventListener('click', function () { self.toggleRecord(); });
    $('rec-stop').addEventListener('click', function () { self.stopRecord(); });
    // 点/触摸画面：在那里炸一发；顺便把焦点从种子框收回（R 之类立刻恢复）
    this.canvas.addEventListener('pointerdown', function (e) {
      var el = document.activeElement;
      if (el && el.id === 'seed') el.blur();
      self.launchAt(e.clientX, e.clientY);
    });
    $('daily').addEventListener('click', function () { self.daily(); });
    $('share').addEventListener('click', function () { self.copyLink(this); });
    $('fullscreen').addEventListener('click', function () { self.toggleFullscreen(this); });
    $('show').addEventListener('click', function () { self.toggleUi(); });
    $('budget').addEventListener('input', function () {
      self.maxGeos = parseInt(this.value, 10);
      self.show.maxGeos = self.maxGeos;
      $('budget-val').textContent = self.maxGeos;
    });
  };

  FW.app.App.prototype.bindKeys = function () {
    var self = this;
    window.addEventListener('keydown', function (e) {
      // Esc 永远有效（它不会往输入框里塞字符）；录制中先停录制
      if (e.key === 'Escape') {
        if (self.recorder && self.recorder.recording()) self.stopRecord();
        else self.toggleUi();
        return;
      }
      // 只有"真的在往里打字"的控件才让出快捷键。原来是 input/select/textarea 一概
      // 让位 —— 而「绘制预算」滑块本身就是 <input>，拖完滑块再按 R 会毫无反应。
      var el = e.target || {};
      var tag = String(el.tagName || '').toLowerCase();
      var typing = (tag === 'textarea') || (tag === 'select')
        || (tag === 'input'
            && /^(text|number|search|email|url|password|tel)$/.test(el.type || 'text'));
      if (typing) return;
      if (e.code === 'Space') { e.preventDefault(); self.togglePause(); }
      else if (e.key === 'r' || e.key === 'R') self.extra();
    });
  };

  /* --------------------------------------------------------------- 启动 */

  /**
   * 控制台里那张便条：只交代"种子框认数字"，顺口提一句那个词有几个字母，
   * 不点破是哪个词，也不说敲对了会换来什么（剩下的靠往种子框里一个一个
   * 字母试，敲错了会被弹回来）。
   */
  function consoleNote(app) {
    var gold = 'color:#ffd34d;font-weight:600';
    var cyan = 'color:#7fd1ff;font-weight:600';
    console.log('%c烟花 · Fireworks', gold);
    console.log('seed %c' + app.seed + (app.dailyMode ? '（每日：跟着日期走）' : ''), cyan);
    if (app.eggFound) return;
    console.log('种子框只收数字。有一个 %c' + FW.app.SECRET.length
      + ' 个字母%c的词是例外 —— 一个一个敲试试。',
      'color:#ffd34d', 'color:inherit');
  }

  /** localStorage 里记两个键：上次的种子，和"每日"这个开关（隐私模式下会抛错，所以都包起来）。 */
  function store() {
    return {
      get: function (k) { try { return localStorage.getItem('fw.' + k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem('fw.' + k, v); } catch (e) { /* 无所谓 */ } }
    };
  }

  function boot() {
    var inst = new FW.app.App({
      canvas: $('stage'),
      search: new URLSearchParams(location.search),
      store: store()
    });
    FW.app.instance = inst;
    inst.start();
    consoleNote(inst);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(globalThis.FW || (globalThis.FW = {}));

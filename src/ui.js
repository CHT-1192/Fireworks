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

  var SCENES = FW.app.SCENES;

  function $(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------------ HUD */

  FW.app.App.prototype.hud = function () {
    $('hud-seed').textContent = this.seed;
    $('hud-scene').textContent = this.scene;
    $('hud-fps').textContent = this.fps.toFixed(0);
    $('hud-budget').textContent = this.show.lastGeos + ' / ' + this.show.maxGeos;
    $('hud-geos').textContent = this.renderer.geos;
    $('hud-segs').textContent = this.renderer.segs;
    $('hud-els').textContent = this.show.elements.length;
    $('hud-fw').textContent = this.show.fireworks.length;
    $('hud-wh').textContent = Math.round(this.show.w) + '×' + Math.round(this.show.h)
      + (Math.abs(this.renderer.scale - 1) > 1e-6 ? ' @' + this.renderer.scale.toFixed(2) : '');
    $('hud-time').textContent = this.show.time.toFixed(1) + 's';
    $('hud-state').textContent = this.paused
      ? ((this.freezeFrames !== null || this.show.time === 0) ? '已定格' : '已暂停')
      : '运行中';
  };

  /** 把内部状态刷到控件上（换场景 / 换种子 / 暂停后调用）。 */
  FW.app.App.prototype.syncPanel = function () {
    $('seed').value = this.seed;
    $('budget').value = this.maxGeos;
    $('budget-val').textContent = this.maxGeos;
    $('pause').textContent = this.paused ? '继续' : '暂停';
    $('scene-help').textContent = SCENES[this.scene][1];
    document.title = '烟花 · Fireworks · seed ' + this.seed;
    this.applyUiVisibility();
    this.hud();
  };

  FW.app.App.prototype.applyUiVisibility = function () {
    var hidden = this.hideUi || this.uiHidden;
    $('panel').hidden = hidden;
    $('hud').hidden = hidden;
    // ?ui=0 是"彻底无 UI"（截图 / 嵌入），连恢复按钮都不留；
    // 手动「收起 UI」才留一个「≡ 控制台」把面板叫回来。
    $('show').hidden = this.hideUi || !hidden;
  };

  FW.app.App.prototype.toggleUi = function () {
    this.uiHidden = !this.uiHidden;
    this.applyUiVisibility();
  };

  /* ---------------------------------------------------------------- 录制 */

  /** 录 / 停。录制期间收起面板 —— captureStream 只抓 canvas，面板本来就不在画面里，
   *  收起来只是让你看着干净；停止条是 DOM 浮层，也不会进画面。 */
  FW.app.App.prototype.toggleRecord = function () {
    if (this.recorder && this.recorder.recording()) this.stopRecord();
    else this.startRecord();
  };

  FW.app.App.prototype.startRecord = function () {
    if (!FW.record.supported()) {
      console.warn('这个浏览器没有 MediaRecorder / captureStream，录不了。');
      return;
    }
    if (!this.recorder) {
      this.recorder = new FW.record.Recorder(this.canvas, { fps: 60, maxSeconds: 30 });
    }
    if (!this.recorder.start()) return;
    var self = this;
    this.recorder.onAutoStop = function () { self.stopRecord(); };   // 录满 30 秒自动收
    this.recUiWasHidden = this.hideUi;
    this.hideUi = true;
    this.applyUiVisibility();
    $('rec').hidden = false;
    $('record').textContent = '停止录制';
    this.recTimer = setInterval(function () {
      $('rec-time').textContent = self.recorder.elapsed().toFixed(1) + 's';
    }, 100);
    console.log('开始录制（只录画布，不含界面）');
  };

  FW.app.App.prototype.stopRecord = function () {
    if (!this.recorder || !this.recorder.recording()) return;
    var self = this;
    clearInterval(this.recTimer);
    this.recTimer = null;
    var secs = this.recorder.elapsed();
    $('rec').hidden = true;
    $('record').textContent = '录制';
    this.hideUi = this.recUiWasHidden;      // 恢复录制前的界面状态
    this.applyUiVisibility();
    // 元数据写种子（WebM 没有官方口子，见 src/record.js 的 EBML 处理）
    this.recorder.stop([['SEED', this.seed]]).then(function (blob) {
      if (!blob) return;
      var name = 'fireworks_' + self.scene + '_seed' + self.seed + '_'
               + secs.toFixed(0) + 's.webm';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      console.log('录了 ' + secs.toFixed(1) + ' 秒 -> ' + name
        + '（' + Math.round(blob.size / 1024) + ' KB，元数据里写了 seed）');
    });
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
      if (text === FW.app.SECRET) {               // 拼全了：换成参考图风格
        self.rebuild(undefined, text);
        console.log('%c' + FW.app.SECRET + ' —— 参考图风格', 'color:#ffd34d;font-weight:700');
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
      if (/^\d+$/.test(this.value)) self.rebuild(undefined, this.value);
      else if (this.value === '') self.reseed();
    });
  };

  FW.app.App.prototype.bindPanel = function () {
    var self = this;
    this.bindSeedInput();
    $('dice-number').addEventListener('click', function () { self.reseed(); });
    $('pause').addEventListener('click', function () { self.togglePause(); });
    $('extra').addEventListener('click', function () { self.extra(); });
    $('replay').addEventListener('click', function () { self.rebuild(self.scene, self.seed); });
    $('save').addEventListener('click', function () { self.savePng(); });
    $('hide').addEventListener('click', function () { self.toggleUi(); });
    $('record').addEventListener('click', function () { self.toggleRecord(); });
    $('rec-stop').addEventListener('click', function () { self.stopRecord(); });
    // 点一下画面 = 我看完了：把焦点从种子框收回，R 之类立刻恢复
    this.canvas.addEventListener('pointerdown', function () {
      var el = document.activeElement;
      if (el && el.id === 'seed') el.blur();
    });
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

  FW.app.App.prototype.savePng = function () {
    var a = document.createElement('a');
    a.download = 'fireworks_' + this.scene + '_seed' + this.seed
               + '_t' + this.show.time.toFixed(2) + '.png';
    a.href = this.renderer.toDataURL();
    a.click();
  };

  /* --------------------------------------------------------------- 启动 */

  /**
   * 控制台里那张便条：只交代"种子框认数字"，顺口提一句那个词有几个字母，
   * 不点破是哪个词（剩下的靠往种子框里一个一个字母试，敲错了会被弹回来）。
   */
  function consoleNote(app) {
    var gold = 'color:#ffd34d;font-weight:600';
    var cyan = 'color:#7fd1ff;font-weight:600';
    console.log('%c烟花 · Fireworks', gold);
    console.log('seed %c' + app.seed, cyan);
    if (app.secretFound) return;
    console.log('种子框只收数字。有一个 %c' + FW.app.SECRET.length
      + ' 个字母%c的词是例外 —— 这里正在放的那个，一个一个敲试试。',
      'color:#ffd34d', 'color:inherit');
  }

  function boot() {
    var inst = new FW.app.App({
      canvas: $('stage'),
      search: new URLSearchParams(location.search)
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

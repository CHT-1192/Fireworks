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
    $('hud-budget').textContent = this.show.lastGeos;
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
    $('scene').value = this.scene;
    $('seed').value = this.seed;
    $('budget').value = this.maxGeos;
    $('budget-val').textContent = this.maxGeos;
    $('pause').textContent = this.paused ? '继续' : '暂停';
    $('scene-help').textContent = SCENES[this.scene][1];
    document.title = '烟花 · seed ' + this.seed + ' · ' + this.scene;
    this.applyUiVisibility();
    this.hud();
  };

  FW.app.App.prototype.applyUiVisibility = function () {
    var hidden = this.hideUi || this.uiHidden;
    $('panel').hidden = hidden;
    $('hud').hidden = hidden;
    $('show').hidden = !hidden;             // 收起后留着「≡ 控制台」按钮
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

  FW.app.App.prototype.bindPanel = function () {
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
    $('extra').addEventListener('click', function () { self.extra(); });
    $('still').addEventListener('click', function () { self.stillFrame(); });
    $('replay').addEventListener('click', function () { self.rebuild(self.scene, self.seed); });
    $('save').addEventListener('click', function () { self.savePng(); });
    $('hide').addEventListener('click', function () { self.toggleUi(); });
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
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); self.togglePause(); }
      else if (e.key === 'r' || e.key === 'R') self.extra();
      else if (e.key === 'Escape') self.toggleUi();
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

  function boot() {
    var inst = new FW.app.App({
      canvas: $('stage'),
      search: new URLSearchParams(location.search)
    });
    FW.app.instance = inst;
    inst.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(globalThis.FW || (globalThis.FW = {}));

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
    $('seed').value = this.seed;
    $('budget').value = this.maxGeos;
    $('budget-val').textContent = this.maxGeos;
    $('pause').textContent = this.paused ? '继续' : '暂停';
    $('scene-help').textContent = SCENES[this.scene][1]
      + (this.secretFound
         ? '　🎉 密语已解锁'
         : '　（种子只收数字；另有一串字母是彩蛋）');
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

  /**
   * 种子框的"逐字符"守卫：正常只收数字；字母只有当它正好接上密语时才留得下来，
   * 敲错了就当场退回上一个合法内容并抖一下 —— 所以"试探每个字母"是有反馈的，
   * 找彩蛋就是这么一个字母一个字母试出来的。粘贴也走同一条校验。
   */
  FW.app.App.prototype.bindSeedInput = function () {
    var self = this;
    var input = $('seed');
    var lastValid = this.seed;
    input.value = lastValid;

    input.addEventListener('input', function () {
      var text = this.value.toUpperCase();
      if (!FW.app.seedContentOk(text)) {          // 不是数字、也不是密语的前缀
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
      if (text === FW.app.SECRET) {               // 敲全了：立刻解锁参考图风格
        self.rebuild(undefined, text);
        console.log('%c🎉 彩蛋找到了：' + FW.app.SECRET + ' —— 参考图风格已解锁',
                    'color:#ffd34d;font-weight:700');
      }
    });

    // 聚焦就全选：想换种子直接敲，不用先手动删掉旧的
    input.addEventListener('focus', function () { this.select(); });

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

  /**
   * 控制台彩蛋的引子：说清"种子只收数字"，并给一个**不解谜**的提示（只报字母个数，
   * 不报内容）—— 剩下的靠往种子框里一个字母一个字母试。
   */
  function consoleEgg(app) {
    var gold = 'color:#ffd34d;font-weight:600';
    var cyan = 'color:#7fd1ff;font-weight:600';
    console.log('%c烟花 · Canvas 维护版', gold);
    console.log('本场 seed: %c' + app.seed + '%c  （数字种子 → 纯随机秀）',
                cyan, 'color:inherit');
    if (app.secretFound) {
      console.log('%c彩蛋已解锁：参考图风格', gold);
      return;
    }
    console.log('彩蛋：种子框正常只收数字。不过有一串 %c' + FW.app.SECRET.length
      + ' 个字母%c的词能打开参考图风格。',
      'color:#ffd34d', 'color:inherit');
    console.log('　往种子里一个字母一个字母地敲：%c敲对了会留下来，敲错了会被弹回来%c。'
      + '（提示：这一版的原版，是拿它画的）', 'color:#9ad', 'color:inherit');
  }

  function boot() {
    var inst = new FW.app.App({
      canvas: $('stage'),
      search: new URLSearchParams(location.search)
    });
    FW.app.instance = inst;
    inst.start();
    consoleEgg(inst);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(globalThis.FW || (globalThis.FW = {}));

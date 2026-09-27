/* ============================================================================
 * actions.js —— 面板上那些"动作"：存图 / 分享链接 / 全屏 / 录制
 * ---------------------------------------------------------------------------
 * 与 ui.js 的分工：ui.js 管"界面本身"（HUD、面板同步、键盘、种子框守卫、启动），
 * 这里管"按一下之后做的事"。都挂在 FW.app.App 上，由 ui.js 的 bindPanel 调用。
 *
 * 录制的机制在 src/record.js（captureStream + MediaRecorder），容器手术在
 * src/ebml.js；这里只负责按钮、计时条、收起面板与下载。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------- 音效 */

  /**
   * 音效开关（存 fw.sound）。关掉只是把主增益拉到 0，不拆音频节点 ——
   * 再打开是瞬时的，也不会因为反复建 AudioContext 触发浏览器的数量上限。
   */
  FW.app.App.prototype.setSound = function (on) {
    if (!this.sound) return false;
    var enabled = this.sound.setEnabled(on);
    if (enabled) { this.sound.ensure(); this.sound.resume(); }
    this.store.set('sound', enabled ? '1' : '0');
    this.syncPanel();
    return enabled;
  };

  /**
   * 模拟抛出来的发射/爆炸事件 → 音效。
   * 这个钩子是**只读**的：音效不碰 rng、不改任何状态，同一个种子照样放出同一场。
   */
  FW.app.App.prototype.onShowEvent = function (ev) {
    if (this.sound) this.sound.event(ev);
  };

  /** 面板上的「声音」按钮：第一次点击本身就算"用户手势"，音频上下文在那时才建。 */
  FW.app.App.prototype.bindSound = function () {
    var self = this;
    var snd = $('sound');
    if (!snd) return;
    if (!this.sound) {                       // 浏览器没有 Web Audio：按钮藏起来
      snd.hidden = true;
      return;
    }
    snd.addEventListener('click', function () {
      // 第一次手势：先建上下文，再切开关（顺序反了 Safari 上会静音）
      self.gesture();
      var on = self.setSound(!self.sound.enabled);
      self.say(on ? '音效已开' : '音效已关');
    });
  };

  /* ------------------------------------------------------- 分享 / 全屏 */

  /** 复制这一场的链接；成功与否都直接写在按钮上（两秒后恢复）。 */
  FW.app.App.prototype.copyLink = function (btn) {
    var url = this.shareUrl();
    var self = this;
    function done(ok) {
      var old = btn.textContent;
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(function () { btn.textContent = old; }, 1500);
      if (ok) console.log('这一场的链接：' + url);
      self.say(ok ? '链接已复制' : '链接复制失败');
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done(true); },
                                             function () { done(fallback(url)); });
    } else {
      done(fallback(url));
    }
    // 剪贴板 API 要安全上下文；不行就退回老办法
    function fallback(text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
  };

  FW.app.App.prototype.toggleFullscreen = function (btn) {
    var el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el);
    }
    void btn;
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
    // 音效开着的话，把合成出来的那一路也录进去（没音频文件，所以不会有加载延迟）
    this.gesture();                    // 在这一次点击（手势）里把音频上下文建起来
    this.recorder.start({ audio: this.sound ? this.sound.stream() : null });
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
    this.say('开始录制' + (this.sound && this.sound.enabled ? '（含音效）' : ''));
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
      var name = 'fireworks_seed' + self.seed + '_' + secs.toFixed(0) + 's.webm';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      console.log('录了 ' + secs.toFixed(1) + ' 秒 -> ' + name
        + '（' + Math.round(blob.size / 1024) + ' KB，元数据里写了 seed）');
    });
  };

  /**
   * 存 PNG。canvas 自己导出的 PNG 是"裸"的，所以这里把**种子与这一场的链接**
   * 写进它的元数据（iTXt 块，UTF-8；见 src/pngmeta.js）。文件名也带种子。
   */
  FW.app.App.prototype.savePng = function () {
    var name = 'fireworks_seed' + this.seed
             + '_t' + this.show.time.toFixed(2) + '.png';
    var tags = FW.pngmeta.tags({
      seed: this.seed, url: this.shareUrl(), time: new Date()
    });
    function save(blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      console.log('存图 ' + name + '（元数据里写了种子与链接）');
    }
    if (this.canvas.toBlob) {
      this.canvas.toBlob(function (blob) {
        if (!blob) return;
        blob.arrayBuffer().then(function (buf) {
          save(new Blob([FW.pngmeta.addText(new Uint8Array(buf), tags)], { type: 'image/png' }));
        });
      }, 'image/png');
    } else {                                  // 老浏览器：退回没有元数据的 PNG
      var a = document.createElement('a');
      a.download = name;
      a.href = this.renderer.toDataURL();
      a.click();
    }
  };
})(globalThis.FW || (globalThis.FW = {}));

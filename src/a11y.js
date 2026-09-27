/* ============================================================================
 * a11y.js —— 可访问性：读屏播报 + "减少动效"
 * ---------------------------------------------------------------------------
 * canvas 里的东西读屏软件一概看不见，所以这里补两件事：
 *
 *   1) 播报（`#a11y-status`，role="status" + aria-live="polite" 的视觉隐藏区）：
 *      在**用户动作**之后说一句（暂停/换种子/音效开关/插播/存图…）。不播报每一发
 *      烟花 —— 那是装饰，逐发播报只会把读屏用户淹掉。
 *
 *   2) 系统"减少动效"（prefers-reduced-motion）：开着就 `show.auto = false`（不再
 *      自动排烟花，只有你按 R / 点画面才放）、`motionScale` 降到 0.55（每发小一号），
 *      并且跟着系统设置的改变走。CSS 那边的过渡/动画也在 index.html 里一起关掉。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  /**
   * 给读屏软件说一句。同一句话连说两次（比如连按两次暂停）也要能被读到：
   * 先清空再写，才一定会触发 aria-live 的变化。
   */
  FW.app.App.prototype.say = function (text) {
    var el = $('a11y-status');
    if (!el) return;
    el.textContent = '';
    el.textContent = String(text);
  };

  /** 暂停/继续 + 播报（按钮和空格都走这里）。 */
  FW.app.App.prototype.pauseAndSay = function () {
    this.togglePause();
    this.say(this.paused ? '已暂停' : '继续播放');
  };

  /** 顺手解锁音频上下文（浏览器要求"用户手势之后"才允许出声）。 */
  FW.app.App.prototype.gesture = function () {
    if (this.sound) { this.sound.ensure(); this.sound.resume(); }
  };

  /** 系统"减少动效"：读一次，并跟着系统设置的改变走。 */
  FW.app.App.prototype.bindReducedMotion = function (mq) {
    var self = this;
    this.setReduceMotion(mq.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', function (e) {
        self.setReduceMotion(e.matches);
        self.say(e.matches ? '已按系统设置减少动效：只有你放才动' : '恢复自动放烟花');
      });
    }
  };

  /** 把媒体查询结果转成面板上的说明（读屏之外也让人知道为什么"不动"）。 */
  FW.app.App.prototype.motionNote = function () {
    var el = $('motion-note');
    if (!el) return;
    el.hidden = !this.reduceMotion;
    if (this.reduceMotion) {
      el.textContent = '系统开了「减少动效」：不自动放，按 R 或点画面才放。';
    }
  };
})(globalThis.FW || (globalThis.FW = {}));

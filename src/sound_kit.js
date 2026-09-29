/* ============================================================================
 * sound_kit.js —— 合成小件：白噪声缓冲、带包络的噪声、滑音正弦
 * ---------------------------------------------------------------------------
 * 这三件挂在 sound.js 的 Engine 上（发射/爆炸都由它们拼出来）。单独一个文件是为了
 * 守住"每个文件 ≤300 行"：sound.js 管编排（层次、脆闷、发声预算），这里只管"怎么造
 * 一个声音"。
 *
 * 注意：这里必须写 `FW.sound.Engine.prototype`，**不能写裸名 Engine** —— 单文件版把
 * 所有模块串成一个 <script>，模块里一旦抛 ReferenceError，后面的模块（包括 ui.js）
 * 就全不执行，页面直接空白（这个坑真踩过）。tools/modules_check.js 守着这一类问题。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  /* ------------------------------------------------------------- 合成小件 */

  /** 白噪声（1 秒，够所有效果用了；噪声源都 loop 它）。 */
  FW.sound.Engine.prototype.noise = function (ctx) {
    if (this.buf) return this.buf;
    var n = Math.floor(ctx.sampleRate * 1.0);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.buf = buf;
    return buf;
  };

  /** 一小段带包络的噪声：滤波类型/频率/时长/音量由调用者给。 */
  FW.sound.Engine.prototype.noiseHit = function (ctx, t, o) {
    var src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q === undefined ? 1.2 : o.q;
    f.frequency.setValueAtTime(o.from, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    var g = ctx.createGain();
    var end = o.end === undefined ? 0.0001 : o.end;    // 收尾电平：决定衰减斜率(dB/s)
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack || 0.012));
    g.gain.exponentialRampToValueAtTime(end, t + o.dur);
    src.connect(f); f.connect(g); g.connect(this.comp);
    src.start(t);
    src.stop(t + o.dur + 0.05);
    return g;
  };

  /**
   * 一小段**滑音正弦** —— 发射音里那条窄带"哨音"（真实发射声有，纯噪声没有）。
   * 参考录音量出来是 2906Hz 线性滑到 2438Hz、比同频段噪声底高 +25dB、窄到 35Hz。
   * 加一点慢抖动（Hz 级的频率调制）是为了别听起来像信号发生器。
   */
  FW.sound.Engine.prototype.toneHit = function (ctx, t, o) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(o.from, t);
    osc.frequency.linearRampToValueAtTime(o.to, t + o.dur);   // 频谱上是条直线
    if (o.wobble) {
      var lfo = ctx.createOscillator(), la = ctx.createGain();
      lfo.frequency.value = o.wobble.rate;
      la.gain.value = o.wobble.depth;
      lfo.connect(la);
      la.connect(osc.frequency);
      lfo.start(t); lfo.stop(t + o.dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack || 0.03));
    g.gain.exponentialRampToValueAtTime(o.end === undefined ? 0.0001 : o.end, t + o.dur);
    osc.connect(g);
    g.connect(this.comp);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  };

})(globalThis.FW || (globalThis.FW = {}));

/* ============================================================================
 * sound.js —— 音效：Web Audio 现场合成，没有一个音频文件
 * ---------------------------------------------------------------------------
 * 三条硬约束：
 *   1) 零素材 —— 单文件版不能有外部请求，所以发射是"滤波噪声扫频 + 一点啸叫"，
 *      爆炸是"正弦下扫 + 噪声爆裂 + 几声噼啪"，全部现场合成（白噪声缓冲建一次反复用）。
 *   2) 不能影响模拟 —— 音效只"听"模拟抛出的事件（Show.onEvent），自己不碰 rng、
 *      不改任何状态，所以同一个种子照样放出同一场（render_smoke 会断言这一点）。
 *   3) 不能自动出声 —— 浏览器要求用户手势之后才允许播音频，所以 AudioContext 是
 *      懒创建的：第一次点击/按键时才建、必要时 resume()。开关记在 fw.sound。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  function supported() {
    return typeof window !== 'undefined'
        && !!(window.AudioContext || window.webkitAudioContext);
  }

  /**
   * 同时发声的预算：齐射时别叠 16 个爆炸声（叠了只会糊成一片爆音）。
   * 注意是**只压不丢**：超预算的那一声仍然响，只是音量压到 SQUEEZED。
   * 早先的版本直接丢音，实测 max=1500 时 30 秒丢掉 10/60 个事件 —— 听起来就是
   * "怎么有时候跳过一些"。
   */
  var TOKENS_MAX = 8, TOKENS_PER_SEC = 8, SQUEEZED = 0.45;

  function Engine(o) {
    o = o || {};
    this.level = (o.level === undefined) ? 0.2 : o.level;
    this.enabled = o.enabled !== false;
    this.ctx = o.context || null;        // 注入上下文 = 离线渲染（tools/sound_shot.js 用）
    this.comp = null;
    this.master = null;
    this.mix = null;                 // 录制用的音频输出（MediaStreamDestination）
    this.buf = null;                 // 复用的白噪声
    this.tokens = TOKENS_MAX;
    this.refillAt = 0;
    this.launches = 0;
    this.bursts = 0;
    this.squeezed = 0;              // 因为超预算而被压小的次数（丢音次数恒为 0）
  }

  /**
   * 建（或取）音频上下文与节点图。必须在用户手势里第一次调用。
   * 上下文可以是注入进来的（离线渲染用 OfflineAudioContext）—— 所以"建上下文"和
   * "搭节点图"是两件事：注入了上下文时仍要把压缩器/主增益接上（否则没地方出声）。
   */
  Engine.prototype.ensure = function () {
    if (!this.ctx) {
      if (!supported()) return null;
      var C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
    }
    var ctx = this.ctx;
    if (this.comp) return ctx;                        // 图已经搭好了
    this.comp = ctx.createDynamicsCompressor();        // 收一下峰值，别爆音
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 8;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.level : 0;
    // 低通 17kHz：真实录音的顶上是滚降的，白噪声一路到 24k 听着会"太嘶"
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 15000;
    this.tone.Q.value = 0.4;
    this.comp.connect(this.tone);
    this.tone.connect(this.master);
    this.master.connect(ctx.destination);
    if (ctx.createMediaStreamDestination) {            // 离线上下文没有这个，跳过
      this.mix = ctx.createMediaStreamDestination();
      this.master.connect(this.mix);
    }
    return ctx;
  };

  /** 用户手势里调一下（Safari 上上下文会先是 suspended）。 */
  Engine.prototype.resume = function () {
    var ctx = this.ctx;
    if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume();
  };

  Engine.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (this.master) {
      this.master.gain.value = this.enabled ? this.level : 0;   // 直接静音，不拆节点
    }
    return this.enabled;
  };

  /** 录制时要接进来的音轨（没建上下文 / 没有这个能力就返回 null）。 */
  Engine.prototype.stream = function () {
    return (this.mix && this.enabled) ? this.mix.stream : null;
  };

  Engine.prototype.stats = function () {
    return { launches: this.launches, bursts: this.bursts, squeezed: this.squeezed,
             enabled: this.enabled, context: this.ctx ? this.ctx.state : 'none' };
  };

  /* ------------------------------------------------------------- 合成小件 */

  /** 白噪声（1 秒，够所有效果用了；噪声源都 loop 它）。 */
  Engine.prototype.noise = function (ctx) {
    if (this.buf) return this.buf;
    var n = Math.floor(ctx.sampleRate * 1.0);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.buf = buf;
    return buf;
  };

  /**
   * 这一声该多响：预算够就是 1，超了压到 SQUEEZED（**不丢音**）。
   * 齐射本来就该听着像"一声更大的"，而不是"漏掉几声"。
   */
  Engine.prototype.gainFactor = function () {
    var now = this.ctx ? this.ctx.currentTime : 0;
    if (now > this.refillAt) {                       // 按过去的时间补名额（不是每查一次补一个）
      var add = Math.floor((now - this.refillAt) * TOKENS_PER_SEC) + 1;
      this.tokens = Math.min(TOKENS_MAX, this.tokens + add);
      this.refillAt = now + 1 / TOKENS_PER_SEC;
    }
    if (this.tokens > 0) { this.tokens--; return 1; }
    this.squeezed++;
    return SQUEEZED;
  };

  /** 一小段带包络的噪声：滤波类型/频率/时长/音量由调用者给。 */
  Engine.prototype.noiseHit = function (ctx, t, o) {
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
  Engine.prototype.toneHit = function (ctx, t, o) {
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

  /* ----------------------------------------------------------------- 两种声 */

  /**
   * 发射：**四层宽带噪声**（对照真实发射录音量出来的形状，见 tools/sound_shot.js）：
   *
   *   A   5.5kHz 带通  起音 12ms  收得最快（0.14s）—— 开头那一下"嚓"
   *   B1  3.6kHz 高通  起音 50ms  中等（0.95s）   —— 高频先死（参考 0.15s 后就不亮了）
   *   B2  2.4kHz 带通  起音 75ms  最慢（1.6s）   —— 长尾，0.4s 之后听到的主要是它
   *   C    700Hz 带通  起音 50ms  短（0.45s）    —— 一点低频体积
   *   D   2906→2438Hz 正弦，起音后 0.12s 才出现，0.66s 滑完 —— **窄带下滑哨音**
   *
   * D 是这版才补上的：真实发射声里有一条很窄的哨音（频谱上一条细亮线，比同频段噪声底
   * 高 ~25dB，还略微下滑）。之前我把它当成"噪声里的杂讯"忽略了，结果听起来就只有"嘶"
   * 没有"呜"。
   *
   * 合起来（tools/sound_shot.js 量的）：起音 ~60ms、衰减 ~40dB/s、峰值谱心 ~7.4kHz、
   * −20dB @ +0.44s、哨音 2871→? Hz 且突出度 +25dB —— 参考录音：−43.5dB/s、谱心 7.2kHz、
   * −20dB @ +0.45s、哨音 2906→2438Hz、突出度 +17~25dB。
   * 早先的版本是"带通 380→1700Hz 扫频 + 620→1250Hz 正弦啸叫、0.42s" —— 正好比参考
   * 多一条音调、少整个高频层，听起来像电子音。
   */
  Engine.prototype.launch = function () {
    var ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    var t = ctx.currentTime + 0.005;
    var k = this.gainFactor();                           // 齐射时压小，但不丢
    // A：一记宽带脆响，~0.15s 内消失（参考里 0.15s 之后就不亮了）
    this.noiseHit(ctx, t, { type: 'bandpass', q: 0.55, from: 5500,
                            dur: 0.14, gain: 0.13 * k, attack: 0.012, end: 0.00007 });
    // B1：中高频主体，留到 ~0.7s
    this.noiseHit(ctx, t, { type: 'highpass', q: 0.6, from: 3600,
                            dur: 0.95, gain: 0.055 * k, attack: 0.05, end: 0.00004 });
    // B2：长尾（0.4s 之后听到的主要是它）
    this.noiseHit(ctx, t + 0.004, { type: 'bandpass', q: 0.7, from: 2400,
                                    dur: 1.60, gain: 0.062 * k, attack: 0.075, end: 0.00005 });
    // C：一点低频体积
    this.noiseHit(ctx, t + 0.004, { type: 'bandpass', q: 0.9, from: 700,
                                    dur: 0.45, gain: 0.040 * k, attack: 0.05, end: 0.00015 });
    // 哨音：起音后 0.12s 出现（跟参考一样），线性下滑，之后没入噪声
    this.toneHit(ctx, t + 0.12, { from: 2906, to: 2438, dur: 0.66, gain: 0.019 * k,
                                  attack: 0.035, end: 0.0009 * k,
                                  wobble: { rate: 5.5, depth: 5 } });
    this.launches++;
  };

  /**
   * 爆炸：低频"咚" + 噪声爆裂 + 几声噼啪。音量/亮度跟着弹壳大小走
   * （radius 越大越低沉），噼啪的位置用 Math.random —— 不是模拟的 rng。
   */
  Engine.prototype.burst = function (ev) {
    var ctx = this.ctx;                                  // 同上：不在手势里就别建上下文
    if (!ctx || !this.enabled) return;
    var t = ctx.currentTime + 0.01;
    var k = this.gainFactor();                           // 齐射时压小，但不丢
    var big = Math.min(1, ((ev && ev.radius) || 150) / 260);       // 0 小 … 1 大
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(180 - 70 * big, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime((0.30 + 0.22 * big) * k, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(this.comp);
    o.start(t); o.stop(t + 0.36);
    this.noiseHit(ctx, t, { type: 'highpass', q: 0.7, from: 1800,
                            dur: 0.16, gain: 0.20 * k, attack: 0.004 });
    var crackles = 5 + Math.floor(Math.random() * 4);
    for (var i = 0; i < crackles; i++) {
      this.noiseHit(ctx, t + 0.05 + Math.random() * 0.42, {
        type: 'bandpass', q: 6, from: 2600 + Math.random() * 3200,
        dur: 0.035, gain: 0.05 * k, attack: 0.002 });
    }
    this.bursts++;
  };

  /** 模拟抛出来的事件转成声音（事件本身来自 show.js / firework.js）。 */
  Engine.prototype.event = function (ev) {
    if (!ev) return;
    if (ev.type === 'launch') this.launch();
    else if (ev.type === 'burst') this.burst(ev);
  };

  FW.sound = { Engine: Engine, supported: supported };
})(globalThis.FW || (globalThis.FW = {}));

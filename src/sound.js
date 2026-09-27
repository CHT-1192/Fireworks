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

  /** 同时发声的预算：齐射时别叠 16 个爆炸声（叠了只会糊成一片爆音）。 */
  var TOKENS_MAX = 6, TOKENS_PER_SEC = 6;

  function Engine(o) {
    o = o || {};
    this.level = (o.level === undefined) ? 0.2 : o.level;
    this.enabled = o.enabled !== false;
    this.ctx = null;
    this.comp = null;
    this.master = null;
    this.mix = null;                 // 录制用的音频输出（MediaStreamDestination）
    this.buf = null;                 // 复用的白噪声
    this.tokens = TOKENS_MAX;
    this.refillAt = 0;
    this.launches = 0;
    this.bursts = 0;
    this.dropped = 0;
  }

  /** 建（或取）音频上下文。必须在用户手势里第一次调用。 */
  Engine.prototype.ensure = function () {
    if (this.ctx) return this.ctx;
    if (!supported()) return null;
    var C = window.AudioContext || window.webkitAudioContext;
    var ctx = new C();
    this.comp = ctx.createDynamicsCompressor();     // 收一下峰值，别爆音
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 8;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.level : 0;
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);
    if (ctx.createMediaStreamDestination) {
      this.mix = ctx.createMediaStreamDestination();
      this.master.connect(this.mix);
    }
    this.ctx = ctx;
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
    return { launches: this.launches, bursts: this.bursts, dropped: this.dropped,
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

  /** 名额：齐射时先到先得，超了就丢（记在 dropped 里，测试能看见）。 */
  Engine.prototype.spend = function () {
    var now = this.ctx ? this.ctx.currentTime : 0;
    if (now > this.refillAt) {
      this.refillAt = now + 1 / TOKENS_PER_SEC;
      if (this.tokens < TOKENS_MAX) this.tokens++;
    }
    if (this.tokens <= 0) { this.dropped++; return false; }
    this.tokens--;
    return true;
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
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack || 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(this.comp);
    src.start(t);
    src.stop(t + o.dur + 0.02);
    return g;
  };

  /* ----------------------------------------------------------------- 两种声 */

  /**
   * 发射：噪声从低扫到高（"咻"）。
   * 注意这里是读 `this.ctx` 而**不是** ensure()：上下文只允许在用户手势里创建，
   * 否则 Chromium 会拦下来（控制台抱怨 "AudioContext was not allowed to start"）
   * 并让上下文停在 suspended。没上下文就安静 —— 用户一动手（点画面/按 R/点开关）
   * 才会建，之后自动放的那些也就有声音了。
   */
  Engine.prototype.launch = function () {
    var ctx = this.ctx;
    if (!ctx || !this.enabled || !this.spend()) return;
    var t = ctx.currentTime + 0.01;
    this.noiseHit(ctx, t, { type: 'bandpass', q: 1.6, from: 380, to: 1700,
                            dur: 0.42, gain: 0.16, attack: 0.06 });
    var o = ctx.createOscillator();                 // 一点啸叫，让它更像"上去"
    var g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(620 * (1 + Math.random() * 0.1), t);
    o.frequency.exponentialRampToValueAtTime(1250, t + 0.38);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); g.connect(this.comp);
    o.start(t); o.stop(t + 0.42);
    this.launches++;
  };

  /**
   * 爆炸：低频"咚" + 噪声爆裂 + 几声噼啪。音量/亮度跟着弹壳大小走
   * （radius 越大越低沉），噼啪的位置用 Math.random —— 不是模拟的 rng。
   */
  Engine.prototype.burst = function (ev) {
    var ctx = this.ctx;                                  // 同上：不在手势里就别建上下文
    if (!ctx || !this.enabled || !this.spend()) return;
    var t = ctx.currentTime + 0.01;
    var big = Math.min(1, ((ev && ev.radius) || 150) / 260);       // 0 小 … 1 大
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(180 - 70 * big, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.30 + 0.22 * big, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(this.comp);
    o.start(t); o.stop(t + 0.36);
    this.noiseHit(ctx, t, { type: 'highpass', q: 0.7, from: 1800,
                            dur: 0.16, gain: 0.20, attack: 0.004 });
    var crackles = 5 + Math.floor(Math.random() * 4);
    for (var i = 0; i < crackles; i++) {
      this.noiseHit(ctx, t + 0.05 + Math.random() * 0.42, {
        type: 'bandpass', q: 6, from: 2600 + Math.random() * 3200,
        dur: 0.035, gain: 0.05, attack: 0.002 });
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

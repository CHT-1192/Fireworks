/* ============================================================================
 * record.js —— 把画布录成 WebM（含把种子写进元数据）
 * ---------------------------------------------------------------------------
 * 编码完全交给浏览器：canvas.captureStream() + MediaRecorder（VP9→VP8 兜底），
 * 所以不需要任何依赖或素材。
 *
 * **面板不会被录进去**：captureStream 只抓 canvas 自己画的内容，面板/HUD 是浮在
 * 上面的 DOM，天然不在画面里。录制期间隐藏 UI 只是让你看着干净。
 *
 * 元数据：WebM 容器手术在 src/ebml.js（覆盖头部 Void 填充块，零偏移）。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var MIMES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

  /** 有没有录制能力（老浏览器可能没有 MediaRecorder / captureStream）。 */
  function supported() {
    return typeof MediaRecorder !== 'undefined'
        && typeof HTMLCanvasElement !== 'undefined'
        && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  function pickMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < MIMES.length; i++) {
      if (MediaRecorder.isTypeSupported(MIMES[i])) return MIMES[i];
    }
    return '';
  }

  /**
   * 码率：**必须自己算，不能交给默认值**。Chromium 的默认码率是个与分辨率无关的
   * 小常数（实测 1280×800@60fps 只有 1.5Mbps 上下），而 captureStream 抓的是画布
   * 的**后备缓冲**（Retina 上就是 CSS 尺寸 × dpr），于是越清晰的屏幕录出来越糊 ——
   * 烟花又偏偏是最吃码率的题材：黑底上一堆比像素还小的亮粒子，码率不够就被抹成块。
   *
   * 按"每像素每帧多少比特"给：0.12bpp 对这类高对比细碎画面够用（普通视频 0.05~0.08
   * 就很好看了），再夹到 4~40Mbps，免得小窗口太低、5K 屏失控。
   */
  function bitrateFor(width, height, fps) {
    var bps = width * height * fps * 0.12;
    return Math.max(4000000, Math.min(40000000, Math.round(bps)));
  }

  /** 画布实际会被抓成多大（后备缓冲尺寸；拿不到就退回 width/height 属性）。 */
  function captureSize(canvas, stream) {
    try {
      var st = stream.getVideoTracks()[0].getSettings();
      if (st && st.width && st.height) return { w: st.width, h: st.height };
    } catch (e) { /* 那就用画布自己的尺寸 */ }
    return { w: canvas.width || 1, h: canvas.height || 1 };
  }

  /* ------------------------------------------------------------- Recorder */

  /**
   * Recorder(canvas, { fps, maxSeconds })
   *   start()               开始录
   *   stop(tags)            停止，返回 Promise<Blob>（已把 tags 写进元数据）
   *   recording             是否在录
   *   onAutoStop            录满 maxSeconds 时回调（让你有机会改 UI）
   */
  function Recorder(canvas, o) {
    o = o || {};
    this.canvas = canvas;
    this.fps = o.fps || 60;
    this.maxSeconds = o.maxSeconds || 30;
    this.rec = null;
    this.chunks = [];
    this.timer = null;
    this.onAutoStop = null;
    this.startedAt = 0;
  }

  Recorder.prototype.recording = function () { return !!this.rec; };

  /** 已录秒数（用于界面上的计时）。 */
  Recorder.prototype.elapsed = function () {
    return this.rec ? (Date.now() - this.startedAt) / 1000 : 0;
  };

  /**
   * 开始录。o.audio 是音效那一路 MediaStream（音效开着时给，没开就是 null）——
   * 有音轨就一起录进去，播放器里就是有声的。
   */
  Recorder.prototype.start = function (o) {
    o = o || {};
    if (this.rec || !supported()) return false;
    var stream = this.canvas.captureStream(this.fps);
    this.hasAudio = false;
    if (o.audio) {
      var at = o.audio.getAudioTracks ? o.audio.getAudioTracks() : [];
      for (var i = 0; i < at.length; i++) { stream.addTrack(at[i]); this.hasAudio = true; }
    }
    var mime = pickMime();
    var size = captureSize(this.canvas, stream);
    this.width = size.w;
    this.height = size.h;
    this.bitsPerSecond = bitrateFor(size.w, size.h, this.fps);
    var opts = { videoBitsPerSecond: this.bitsPerSecond };
    if (this.hasAudio) opts.audioBitsPerSecond = 128000;
    if (mime) opts.mimeType = mime;
    this.chunks = [];
    this.rec = new MediaRecorder(stream, opts);
    var self = this;
    this.rec.ondataavailable = function (e) { if (e.data && e.data.size) self.chunks.push(e.data); };
    this.rec.start();
    this.startedAt = Date.now();
    console.log('录制 ' + size.w + '×' + size.h + ' @' + this.fps + 'fps · 目标 '
      + (this.bitsPerSecond / 1e6).toFixed(1) + ' Mbps'
      + (this.hasAudio ? ' · 128 kbps 音效' : ' · 无声')
      + (mime ? ' · ' + mime.replace('video/webm;codecs=', '') : ''));
    if (this.maxSeconds > 0) {
      this.timer = setTimeout(function () {
        if (self.rec && self.onAutoStop) self.onAutoStop();
      }, this.maxSeconds * 1000);
    }
    return true;
  };

  /** 停止并返回带元数据的 Blob；没在录则返回 null。 */
  Recorder.prototype.stop = function (tags) {
    var self = this;
    if (!this.rec) return Promise.resolve(null);
    var rec = this.rec;
    this.rec = null;
    clearTimeout(this.timer);
    this.timer = null;
    var mime = rec.mimeType || 'video/webm';
    return new Promise(function (resolve) {
      rec.onstop = function () {
        var blob = new Blob(self.chunks, { type: mime });
        self.chunks = [];
        blob.arrayBuffer().then(function (buf) {
          var out = FW.ebml.writeTags(new Uint8Array(buf), tags);
          resolve(new Blob([out], { type: mime }));
        });
      };
      rec.stop();
    });
  };

  FW.record = { supported: supported, Recorder: Recorder, pickMime: pickMime };
})(globalThis.FW || (globalThis.FW = {}));

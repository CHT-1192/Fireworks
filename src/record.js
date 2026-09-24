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

  Recorder.prototype.start = function () {
    if (this.rec || !supported()) return false;
    var stream = this.canvas.captureStream(this.fps);
    var mime = pickMime();
    this.chunks = [];
    this.rec = mime ? new MediaRecorder(stream, { mimeType: mime })
                    : new MediaRecorder(stream);
    var self = this;
    this.rec.ondataavailable = function (e) { if (e.data && e.data.size) self.chunks.push(e.data); };
    this.rec.start();
    this.startedAt = Date.now();
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

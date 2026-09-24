/* ============================================================================
 * record.js —— 把画布录成 WebM（含把种子写进元数据）
 * ---------------------------------------------------------------------------
 * 编码完全交给浏览器：canvas.captureStream() + MediaRecorder（VP9→VP8 兜底），
 * 所以不需要任何依赖或素材。
 *
 * **面板不会被录进去**：captureStream 只抓 canvas 自己画的内容，面板/HUD 是浮在
 * 上面的 DOM，天然不在画面里。录制期间隐藏 UI 只是让你看着干净。
 *
 * 元数据：MediaRecorder 没有写 tag 的接口，所以这里自己往 EBML 里追加一个 Tags
 * 元素，并把 Segment 的长度回填 —— 不回填的话播放器按声明长度读到 Clusters 就停，
 * 标签等于白写（ffprobe 实测过）。写完的文件仍是标准 WebM（ffprobe/播放器都认）。
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

  /* ------------------------------------------------------------ EBML 小工具 */

  /** EBML 长度字段（可变长）。width 给定时按该宽度写 —— EBML 允许非最短编码，
   *  多写一个字节就能把空隙正好填满。 */
  function vintSize(n, width) {
    var w = width;
    if (!w) for (w = 1; w <= 8; w++) if (n < Math.pow(2, 7 * w) - 1) break;
    var out = new Uint8Array(w);
    for (var i = 0; i < w; i++) out[i] = Math.floor(n / Math.pow(2, 8 * (w - 1 - i))) % 256;
    out[0] |= (1 << (8 - w)) & 0xff;
    return out;
  }

  function readVint(buf, at) {
    var first = buf[at];
    if (!first) return null;
    var w = 1;
    while (w <= 8 && !(first & (1 << (8 - w)))) w++;
    if (w > 8) return null;
    var value = first & ((1 << (8 - w)) - 1);
    var allOnes = value === (1 << (8 - w)) - 1;
    for (var i = 1; i < w; i++) {
      allOnes = allOnes && buf[at + i] === 0xff;
      value = value * 256 + buf[at + i];
    }
    return { value: allOnes ? null : value, width: w };
  }

  /** 读一个元素头：{ idHex, headerLen, size（未知为 null）, total }。 */
  function elemAt(buf, at) {
    var first = buf[at];
    if (!first) return null;
    var iw = 1;
    while (iw <= 4 && !(first & (1 << (8 - iw)))) iw++;
    if (iw > 4) return null;
    var id = '';
    for (var i = 0; i < iw; i++) id += ('0' + buf[at + i].toString(16)).slice(-2);
    var size = readVint(buf, at + iw);
    if (!size) return null;
    return { idHex: id, headerLen: iw + size.width, size: size.value,
             total: size.value === null ? null : iw + size.width + size.value };
  }

  function cat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }

  var ID = { tags: [0x12, 0x54, 0xc3, 0x67], tag: [0x73, 0x73], targets: [0x63, 0xc0],
             simple: [0x67, 0xc8], name: [0x45, 0xa3], value: [0x44, 0x87] };
  var SEGMENT = '18538067', CLUSTER = '1f43b675', VOID = 'ec';

  function utf8(s) { return new TextEncoder().encode(String(s)); }

  function el(id, payload, sizeExtra) {
    return cat([new Uint8Array(id), vintSize(payload.length, sizeExtra ? sizeExtra + 1 : 0),
                payload]);
  }

  /** Tags 元素：pairs = [['SEED','7'], ['DESCRIPTION','...']] */
  function tagBytes(pairs, sizeExtra) {
    var simple = pairs.map(function (kv) {
      return el(ID.simple, cat([el(ID.name, utf8(kv[0])), el(ID.value, utf8(kv[1]))]));
    });
    var body = cat([el(ID.targets, new Uint8Array(0))].concat(simple));
    return el(ID.tags, el(ID.tag, body), sizeExtra);
  }

  /** 总长度正好为 total 的 Void 填充元素（total < 2 时返回 null）。 */
  function voidBytes(total) {
    for (var w = 1; w <= 8; w++) {
      var payload = total - 1 - w;
      if (payload < 0) continue;
      if (payload < Math.pow(2, 7 * w) - 1) {
        var out = new Uint8Array(total);
        out[0] = 0xec;
        out.set(vintSize(payload, w), 1);
        return out;
      }
    }
    return null;
  }

  /** 在"第一个 Cluster 之前"扫出 Segment 信息与可用的 Void 空隙（Chromium 留了一块）。 */
  function scanSegment(bytes) {
    var segAt = -1, i, j;
    for (i = 0; i + 4 <= bytes.length && i < 4096; i++) {
      var hit = true;
      for (j = 0; j < 4; j++) if (bytes[i + j] !== parseInt(SEGMENT.substr(j * 2, 2), 16)) { hit = false; break; }
      if (hit) { segAt = i; break; }
    }
    if (segAt < 0) return null;
    var head = readVint(bytes, segAt + 4);
    if (!head) return null;
    var start = segAt + 4 + head.width;
    var end = head.value === null ? bytes.length
                                  : Math.min(bytes.length, start + head.value);
    var holes = [], at = start;
    while (at < end) {
      var e = elemAt(bytes, at);
      if (!e || e.total === null) break;
      if (e.idHex === CLUSTER) break;
      if (e.idHex === VOID && e.total >= 2) holes.push({ at: at, total: e.total });
      at += e.total;
    }
    return { sizeAt: segAt + 4, sizeWidth: head.width, size: head.value, holes: holes };
  }

  /** 让 tags 正好填满 holeTotal：允许非最短 size 编码，也允许留一个 Void 补零。 */
  function fitTags(pairs, holeTotal) {
    for (var n = pairs.length; n >= 1; n--) {
      for (var extra = 0; extra <= 3; extra++) {
        var tags = tagBytes(pairs.slice(0, n), extra);
        var gap = holeTotal - tags.length;
        if (gap === 0) return { tags: tags, pad: null };
        if (gap >= 2) {
          var pad = voidBytes(gap);
          if (pad) return { tags: tags, pad: pad };
        }
      }
    }
    return null;
  }

  /**
   * 把种子之类写进 WebM 元数据。
   *   首选：**覆盖头部那个 Void 填充块** —— 既在第一个 Cluster 之前（ffmpeg/播放器
   *   只在头部找标签），又零偏移（SeekHead / Cues 全不用改）。
   *   退路：尾接 + 回填 Segment 长度。文件仍合法能播，只是只在头部找标签的工具看不到。
   */
  function writeTags(bytes, pairs) {
    if (!pairs || !pairs.length) return bytes;
    var info = scanSegment(bytes);
    if (!info) return bytes;
    if (info.holes.length) {
      var hole = info.holes[0];
      for (var h = 1; h < info.holes.length; h++) {
        if (info.holes[h].total > hole.total) hole = info.holes[h];
      }
      var fit = fitTags(pairs, hole.total);
      if (fit) {
        bytes.set(fit.tags, hole.at);
        if (fit.pad) bytes.set(fit.pad, hole.at + fit.tags.length);
        return bytes;
      }
    }
    var extra = tagBytes(pairs);
    var out = new Uint8Array(bytes.length + extra.length);
    out.set(bytes, 0);
    out.set(extra, bytes.length);
    if (info.size !== null) {
      var grown = vintSize(info.size + extra.length, info.sizeWidth);
      for (var k = 0; k < info.sizeWidth; k++) out[info.sizeAt + k] = grown[k];
    }
    return out;
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
          var out = writeTags(new Uint8Array(buf), tags);
          resolve(new Blob([out], { type: mime }));
        });
      };
      rec.stop();
    });
  };

  FW.record = { supported: supported, Recorder: Recorder, writeTags: writeTags,
                tagBytes: tagBytes, pickMime: pickMime };
})(globalThis.FW || (globalThis.FW = {}));

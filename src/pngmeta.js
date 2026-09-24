/* ============================================================================
 * pngmeta.js —— 给导出的 PNG 写元数据（种子 / 场景 / 这一场的链接）
 * ---------------------------------------------------------------------------
 * canvas 自己导出的 PNG 是"裸"的，一个文本块都没有。这里直接往 PNG 字节流里插入
 * **iTXt** 块（不是 tEXt：iTXt 用 UTF-8，中文不会坏），插在 IHDR 之后 —— 这是文本
 * 块的标准位置。
 *
 * 纯函数、不碰 DOM：可以在 Node 里直接测（crc32 对标准测试向量，块用合成 PNG 往返）。
 * WebM 那边的同类操作在 src/ebml.js。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  /** PNG 用的 CRC-32（反射多项式 0xEDB88320）。 */
  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(s) { return new TextEncoder().encode(String(s)); }

  function u32(n) {
    return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  }

  function cat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }

  /**
   * 一个 iTXt 块：[长度][iTXt][关键词\0 压缩标志 压缩方法 语言\0 译名\0 正文][CRC]
   * 关键词必须是 Latin-1、1~79 字节；正文用 UTF-8。
   */
  function iTXt(keyword, text) {
    var data = cat([utf8(keyword), new Uint8Array([0, 0, 0, 0, 0]), utf8(text)]);
    var type = utf8('iTXt');
    var body = cat([type, data]);
    return cat([u32(data.length), body, u32(crc32(body))]);
  }

  /** 解析 PNG 的块序列：[{ type, dataLen, at, data }] */
  function chunks(png) {
    var out = [], at = 8, i;
    for (i = 0; i < SIG.length; i++) if (png[i] !== SIG[i]) return null;
    while (at + 8 <= png.length) {
      var len = (png[at] << 24 | png[at + 1] << 16 | png[at + 2] << 8 | png[at + 3]) >>> 0;
      var type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
      out.push({ type: type, at: at, dataLen: len,
                 data: png.subarray(at + 8, at + 8 + len) });
      if (type === 'IEND') break;
      at += 12 + len;
    }
    return out;
  }

  /** 读出已有的 iTXt 文本块：{ 关键词: 正文 }（给校验用）。 */
  function readText(png) {
    var list = chunks(png), out = {};
    if (!list) return out;
    for (var i = 0; i < list.length; i++) {
      if (list[i].type !== 'iTXt') continue;
      var d = list[i].data, z = d.indexOf(0);
      if (z < 0) continue;
      var keyword = String.fromCharCode.apply(null, d.subarray(0, z));
      if (d[z + 1] !== 0) continue;                    // 只处理未压缩的
      var p = z + 3;                                   // 跳过压缩标志/方法
      p = d.indexOf(0, p) + 1;                         // 跳过语言标签
      p = d.indexOf(0, p) + 1;                         // 跳过译名
      out[keyword] = new TextDecoder().decode(d.subarray(p));
    }
    return out;
  }

  /** 合成要给 PNG 写的键值对（顺序稳定，方便对拍）。 */
  function tags(o) {
    o = o || {};
    var list = [['Software', '烟花 · Fireworks']];
    if (o.seed !== undefined) list.push(['Seed', String(o.seed)]);
    if (o.url) list.push(['Comment', String(o.url)]);
    if (o.time) list.push(['Creation Time', (o.time instanceof Date ? o.time : new Date(o.time))
      .toISOString()]);
    return list;
  }

  /** 把文本块插进 PNG（IHDR 之后）；认不出 PNG 就原样返回。 */
  function addText(png, pairs) {
    if (!pairs || !pairs.length) return png;
    var head = chunks(png);
    if (!head || !head.length || head[0].type !== 'IHDR') return png;
    var afterIhdr = head[0].at + 12 + head[0].dataLen;
    var blocks = pairs.map(function (kv) { return iTXt(kv[0], kv[1]); });
    var insert = cat(blocks);
    var out = new Uint8Array(png.length + insert.length);
    out.set(png.subarray(0, afterIhdr), 0);
    out.set(insert, afterIhdr);
    out.set(png.subarray(afterIhdr), afterIhdr + insert.length);
    return out;
  }

  FW.pngmeta = { crc32: crc32, iTXt: iTXt, tags: tags, addText: addText,
                 readText: readText, chunks: chunks };
})(globalThis.FW || (globalThis.FW = {}));

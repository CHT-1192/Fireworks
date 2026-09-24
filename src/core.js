/* ============================================================================
 * core.js —— 数学 / 颜色基础件
 * 对应 turtle_fireworks.py 的「颜色小工具」一节。
 * 纯计算，不碰 DOM：Node 侧的复刻校验脚本也会加载它。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var TAU = Math.PI * 2;
  var RAD2DEG = 180 / Math.PI;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** HSV(0..1) -> RGB(0..1)；与 Python colorsys.hsv_to_rgb 同口径。 */
  function hsv(h, s, v) {
    h = ((h % 1) + 1) % 1;
    s = clamp(s, 0, 1);
    v = clamp(v, 0, 1);
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: return [v, t, p];
      case 1: return [q, v, p];
      case 2: return [p, v, t];
      case 3: return [p, q, v];
      case 4: return [t, p, v];
      default: return [v, p, q];
    }
  }

  /** 夜空背景，取自参考图 #000020。 */
  var BG = hsv(2 / 3, 1.0, 0.125);

  /**
   * 变暗 = 朝背景色淡出（k=1 原色，k=0 与背景一模一样）。
   * 比单纯乘系数干净：将熄的火花不会在深蓝夜空上留一圈灰黑残影。
   */
  function fade(c, k) {
    if (k <= 0) return BG;
    if (k >= 1) return c;
    return [BG[0] + (c[0] - BG[0]) * k,
            BG[1] + (c[1] - BG[1]) * k,
            BG[2] + (c[2] - BG[2]) * k];
  }

  /** 两色线性插值。 */
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t];
  }

  /** Python 的 round()：四舍六入五取偶（banker's rounding）。 */
  function pyRound(x) {
    var f = Math.floor(x);
    var d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }

  /** RGB(0..1) -> '#rrggbb'；顺手夹掉越界 / NaN。 */
  function toHex(c) {
    var out = '#';
    for (var i = 0; i < 3; i++) {
      var v = c[i];
      if (!(v === v) || v < 0) v = 0; else if (v > 1) v = 1;
      out += (pyRound(v * 255) + 0x100).toString(16).slice(1);
    }
    return out;
  }

  /** 把一长串轨迹点均匀抽稀到最多 segMax 段，控制每帧要画多少图元。 */
  function decimate(pts, segMax) {
    var n = pts.length;
    if (n <= segMax + 1) return pts;
    var out = new Array(segMax + 1);
    for (var i = 0; i <= segMax; i++) out[i] = pts[pyRound(i * (n - 1) / segMax)];
    return out;
  }

  FW.core = {
    TAU: TAU, RAD2DEG: RAD2DEG, clamp: clamp, hsv: hsv, BG: BG,
    fade: fade, mix: mix, pyRound: pyRound, toHex: toHex, decimate: decimate
  };
})(globalThis.FW || (globalThis.FW = {}));

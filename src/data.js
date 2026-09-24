/* ============================================================================
 * data.js —— 配色 / 形状 / 花型参数 / 原版复刻实测数据
 * 对应 turtle_fireworks.py 的「原版复刻数据」「自定义形状 + 图元」两节，
 * 以及 STYLES 表。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var hsv = FW.core.hsv, TAU = FW.core.TAU;

  /* ---------------------------------------------------------------- 配色 */

  /** Palette(name, dot, ray, stem, core)：圆点 / 射线 / 发射尾迹 / 爆心闪光。 */
  function Palette(name, dot, ray, stem, core) {
    return { name: name, dot: dot, ray: ray, stem: stem, core: core };
  }

  //: 参考图两发烟花的配色（颜色取自截图采样）
  var HALLOWEEN = Palette('halloween', hsv(0.167, 1.0, 0.88), hsv(0.003, 0.94, 0.88),
                          hsv(0.031, 0.85, 0.94), hsv(0.10, 0.25, 1.0));
  var MATRIX = Palette('matrix', hsv(1 / 3, 1.0, 1.0), hsv(1 / 3, 1.0, 0.5),
                       hsv(1 / 3, 1.0, 0.5), hsv(1 / 3, 0.2, 1.0));

  /** 随机配色：同色系 / 冷暖撞色 / 互补色，三种套路（取值顺序要与 Python 一致）。 */
  function randomPalette(rng) {
    var h = rng.random(), roll = rng.random();
    var dot, ray, stem;
    if (roll < 0.30) {                                   // 同色系
      dot = hsv(h, rng.uniform(0.85, 1.0), 1.0);
      ray = hsv(h, 1.0, rng.uniform(0.45, 0.72));
      stem = hsv(h, 1.0, rng.uniform(0.70, 0.95));
    } else if (roll < 0.72) {                            // 冷暖撞色
      dot = hsv(h, rng.uniform(0.85, 1.0), 1.0);
      ray = hsv(h + 0.5 + rng.uniform(-0.09, 0.09), 0.95, rng.uniform(0.72, 0.95));
      stem = hsv(h + rng.uniform(-0.05, 0.05), 1.0, rng.uniform(0.85, 1.0));
    } else {                                             // 邻近色
      dot = hsv(h, rng.uniform(0.7, 1.0), 1.0);
      ray = hsv(h + rng.uniform(0.06, 0.16), 1.0, rng.uniform(0.6, 0.9));
      stem = hsv(h + rng.uniform(-0.10, -0.03), 1.0, 0.95);
    }
    return Palette('random', dot, ray, stem, hsv(h, 0.18, 1.0));
  }

  /* ------------------------------------------------- 自定义形状 / 图元 */

  var DOT = 'fw_dot', PATH = 'fw_path', DOT_SIDES = 18;

  /** 单位圆点（半径 1，正 18 边形），按 (wid, leng) 缩放后就是任意大小的圆点。 */
  var DOT_PTS = (function () {
    var pts = new Array(DOT_SIDES);
    for (var i = 0; i < DOT_SIDES; i++) {
      var a = TAU * i / DOT_SIDES;
      pts[i] = [Math.cos(a), Math.sin(a)];
    }
    return pts;
  })();

  /** 一个待绘制的图元：字段顺序与 Python 的 Geo NamedTuple 一致。 */
  function geo(shape, color, x, y, heading, wid, leng) {
    return {
      shape: shape, color: color, x: x, y: y,
      heading: heading === undefined ? 0.0 : heading,
      wid: wid === undefined ? 1.0 : wid,
      leng: leng === undefined ? 1.0 : leng
    };
  }

  /**
   * **折线图元**：把一条尾迹的多段打包成一个图元，交给 canvas 用圆头圆角描边连成
   * 一条光滑带子。turtle 没有"带粗细的折线"，只能一段轨迹盖一个矩形图章，所以原版
   * 的尾迹是一节一节的；canvas 直接描边就没有这个问题。
   *
   * segs 格式与单段直线相同：[[x0, y0, x1, y1, color, half], ...]
   */
  function pathGeo(segs) { return { shape: PATH, segs: segs }; }

  /** 一个图元实际要画几个基本图元：折线按段数算，其余各算 1。图元预算是它的和。 */
  function drawnCost(g) { return g.segs ? g.segs.length : 1; }

  /** 尾迹细采样上限（段）：肉眼已看不出折线，同时兜住单条尾迹的开销。 */
  var DENSE = { spark: 14, trail: 48 };

  /* ------------------------------------------------------------ 花型参数 */

  /**
   * 每种花型的参数区间（都是程序化随机取值的范围）
   *   jitter    —— 角度分层的抖动比例：把 360° 均分给 count 个火花
   *   trail     —— 尾迹保留时长（秒，0/缺省 = 不留尾迹）
   *   trail_seg —— 尾迹最多分几段（图元预算）
   */
  var STYLES = {
    spoke: { count: [10, 13], radius: [140, 215], dot: [10.0, 12.0], drag: 5.0,
             life: [2.1, 3.0], gravity: 95.0, jitter: 0.18, trail: 2.4, trail_seg: 2 },
    cloud: { count: [30, 44], radius: [120, 310], dot: [10.0, 12.0], drag: 2.6,
             life: [2.3, 3.6], gravity: 70.0, jitter: 0.42, float_up: 26.0 },
    ring: { count: [22, 32], radius: [150, 205], dot: [8.5, 10.5], drag: 3.4,
            life: [1.9, 2.7], gravity: 90.0, jitter: 0.08, spread: 0.06,
            trail: 1.7, trail_seg: 2 },
    willow: { count: [14, 20], radius: [70, 150], dot: [7.5, 9.5], drag: 2.0,
              life: [2.6, 3.8], gravity: 140.0, jitter: 0.4,
              trail: 0.85, trail_seg: 3, ember: 1.6 },
    palm: { count: [7, 10], radius: [190, 270], dot: [11.0, 13.0], drag: 3.0,
            life: [2.2, 3.2], gravity: 115.0, jitter: 0.25,
            trail: 1.5, trail_seg: 3, ember: 1.0 }
  };
  var STYLE_NAMES = Object.keys(STYLES);

  FW.data = {
    Palette: Palette, HALLOWEEN: HALLOWEEN, MATRIX: MATRIX, randomPalette: randomPalette,
    DOT: DOT, PATH: PATH, DOT_SIDES: DOT_SIDES, DOT_PTS: DOT_PTS,
    geo: geo, pathGeo: pathGeo, drawnCost: drawnCost, DENSE: DENSE,
    STYLES: STYLES, STYLE_NAMES: STYLE_NAMES
  };
})(globalThis.FW || (globalThis.FW = {}));

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

  /**
   * 三种配色套路的分量（默认 30/42/28 —— 就是原来写死的 0.30 / 0.72 两个阈值）。
   * 面板可以改（见 src/tune.js 的「权重」组）。注意 30/100 与 0.30 是**同一个双精度数**，
   * 所以默认值下的分支与改之前一位都不差（40/72 之类改了分量才换比例）。
   */
  var PALETTE_W = { same: 30, clash: 42, near: 28 };

  /** 随机配色：同色系 / 冷暖撞色 / 邻近色，三种套路（取值顺序要与 Python 一致）。 */
  function randomPalette(rng) {
    var h = rng.random(), roll = rng.random();
    var dot, ray, stem;
    var wt = PALETTE_W, total = wt.same + wt.clash + wt.near;
    if (!(total > 0)) total = 100;                       // 三个都是 0：当默认，别抽出 NaN
    if (roll < wt.same / total) {                        // 同色系
      dot = hsv(h, rng.uniform(0.85, 1.0), 1.0);
      ray = hsv(h, 1.0, rng.uniform(0.45, 0.72));
      stem = hsv(h, 1.0, rng.uniform(0.70, 0.95));
    } else if (roll < (wt.same + wt.clash) / total) {    // 冷暖撞色
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
   *   life      —— 火花寿命：撑到半径只要 0.2~0.5s（时间常数 1/drag），剩下的是
   *                下坠与拖尾 —— 这段"余韵"就是花型该有的样子，别乱收
   *   trail     —— 尾迹保留时长（秒，0/缺省 = 不留尾迹）
   *   trail_seg —— 尾迹最多分几段（图元预算）
   *   ember     —— 火花每秒掉几颗余烬（willow / palm 才有）
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

  /**
   * 花型出现概率（权重）：默认全是 1 = 等概率 = 与移植时一模一样；0 = 这一型不出现。
   * 抽签统一走下面的 pickStyle()，**默认权重时它仍然只调一次 rng.choice()**，所以
   * 同种子还是同一场（行为基线与分享出去的链接都不受影响）；一旦动了权重，这一场的
   * 随机流就变了 —— 那是"换了一场"，面板里写明了这件事。
   */
  var STYLE_W = { spoke: 1, cloud: 1, ring: 1, willow: 1, palm: 1 };

  function weightedStyle(rng) {
    var i, n = STYLE_NAMES.length, total = 0, w = new Array(n);
    for (i = 0; i < n; i++) { w[i] = STYLE_W[STYLE_NAMES[i]] || 0; total += w[i]; }
    if (!(total > 0)) return null;                       // 全 0：交给调用方退回等概率
    var roll = rng.uniform(0, total);
    for (i = 0; i < n; i++) { roll -= w[i]; if (roll < 0) return STYLE_NAMES[i]; }
    return STYLE_NAMES[n - 1];
  }

  /** 按权重抽一个花型（默认权重 = 原来的等概率，一位都不差）。 */
  function pickStyle(rng) {
    var i;
    for (i = 0; i < STYLE_NAMES.length; i++) {
      if (STYLE_W[STYLE_NAMES[i]] !== 1) return weightedStyle(rng) || rng.choice(STYLE_NAMES);
    }
    return rng.choice(STYLE_NAMES);
  }

  FW.data = {
    Palette: Palette, HALLOWEEN: HALLOWEEN, MATRIX: MATRIX, randomPalette: randomPalette,
    DOT: DOT, PATH: PATH, DOT_SIDES: DOT_SIDES, DOT_PTS: DOT_PTS,
    geo: geo, pathGeo: pathGeo, drawnCost: drawnCost, DENSE: DENSE,
    STYLES: STYLES, STYLE_NAMES: STYLE_NAMES,
    STYLE_W: STYLE_W, PALETTE_W: PALETTE_W, pickStyle: pickStyle
  };
})(globalThis.FW || (globalThis.FW = {}));

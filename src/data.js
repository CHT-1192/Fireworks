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

  var DOT = 'fw_dot', RAY = 'fw_ray', PATH = 'fw_path', DOT_SIDES = 18;

  /** 单位圆点（半径 1，正 18 边形），按 (wid, leng) 缩放后就是任意大小的圆点。 */
  var DOT_PTS = (function () {
    var pts = new Array(DOT_SIDES);
    for (var i = 0; i < DOT_SIDES; i++) {
      var a = TAU * i / DOT_SIDES;
      pts[i] = [Math.cos(a), Math.sin(a)];
    }
    return pts;
  })();

  /**
   * 单位线段：x∈[-1,1] 是粗细，y∈[0,1] 是长度。
   * turtle 里形状的 +y 轴才是「乌龟正前方」，所以长度方向放在 y 上；
   * 画到 canvas 时用 (wid, leng) 缩放 + heading 旋转得到任意角度/长度/粗细。
   */
  var RAY_PTS = [[-1.0, 0.0], [1.0, 0.0], [1.0, 1.0], [-1.0, 1.0]];
  var SHAPES = {};
  SHAPES[DOT] = DOT_PTS;
  SHAPES[RAY] = RAY_PTS;

  /** 一个待绘制的图元：字段顺序与 Python 的 Geo NamedTuple 一致。 */
  function geo(shape, color, x, y, heading, wid, leng) {
    return {
      shape: shape, color: color, x: x, y: y,
      heading: heading === undefined ? 0.0 : heading,
      wid: wid === undefined ? 1.0 : wid,
      leng: leng === undefined ? 1.0 : leng
    };
  }

  /** 单段射线（原版口径）：由 [x0, y0, x1, y1, color, half] 直接生成一个 RAY 图元。 */
  function rayGeo(s) {
    var dx = s[2] - s[0], dy = s[3] - s[1];
    return geo(RAY, s[4], s[0], s[1], Math.atan2(dy, dx) * FW.core.RAD2DEG,
               s[5], Math.hypot(dx, dy));
  }

  /**
   * **折线图元**：把整条尾迹的多段打包成一个图元，交给 canvas 用圆头圆角一次
   * 描边连成光滑带子。这是原版做不到的事 —— turtle 没有"带粗细的折线"，只能
   * 一段轨迹盖一个矩形图章，所以尾迹看着是一节一节的，弯道处还会折成多边形。
   *
   * segs 与单段射线同格式：[[x0, y0, x1, y1, color, half], ...]
   * cost = 这一帧它在 **Python 口径**下算几个图元。图元预算 / 密度节流仍按原版
   *        口径统计，所以"画得更细"不会改变任何一颗火星的位置与随机数消耗 ——
   *        同 seed 依然是同一场。这是**兼容层**（服务于行为基线与原版对拍），
   *        新特性不必继承这个口径。
   */
  function pathGeo(segs, cost) { return { shape: PATH, segs: segs, cost: cost }; }

  /** 增强模式的细采样上限（段）：远超原版的图章预算，肉眼已看不出折线。 */
  var DENSE = { spark: 14, trail: 48 };

  /* --------------------------------------------- 原版复刻（截图实测数据） */

  //: 屏幕像素坐标 = 原图像素 / 1.8701 - 中心；颜色取像素众数/最饱和值。
  var ORIGINAL = {
    //: 左发的爆心（14 条射线的最小二乘交点）
    LEFT_CENTER: [-233.9, 35.1],
    //: 左发 14 个黄色圆点的实测位置
    LEFT_DOTS: [
      [-395.7, 11.9], [-371.5, -71.8], [-319.3, -140.5], [-250.9, -157.4],
      [-176.1, -154.3], [-90.7, -124.9], [-55.7, -75.6], [-47.5, -9.9],
      [-56.9, 79.8], [-102.9, 152.0], [-171.4, 183.4], [-250.5, 190.5],
      [-337.2, 159.5], [-381.0, 97.3]
    ],
    //: 左发发射尾迹：底 -> 顶（顶端落在爆心附近）
    LEFT_STEM: [[-106.6, -343.4], [-210.4, 46.0]],
    //: 右发 33 个绿色圆点的实测位置
    RIGHT_DOTS: [
      [35.8, 125.2], [66.3, 43.3], [82.3, 235.8], [78.6, 162.7],
      [100.5, 93.4], [124.0, 256.6], [131.4, 143.3], [137.1, 53.0],
      [120.1, -28.8], [198.4, 281.3], [159.3, 192.2], [194.6, 134.8],
      [176.5, 83.4], [167.9, 4.3], [234.1, 231.0], [235.0, 178.6],
      [228.7, 89.7], [245.7, -48.0], [278.8, 281.2], [289.8, 193.4],
      [273.9, 121.2], [253.1, 65.2], [289.7, 28.6], [251.8, 4.3],
      [314.2, 84.7], [316.6, -56.6], [367.9, 236.1], [353.5, 151.9],
      [353.3, 60.5], [350.9, -32.4], [411.8, 137.2], [409.6, 74.9],
      [387.3, -7.0]
    ],
    //: 右发发射尾迹：底 -> 顶
    RIGHT_STEM: [[87.7, -343.4], [218.0, -7.5]],
    //: 实测颜色（背景就是 BG = #000020，直接从截图取的）
    RAY: [1.0, 0.0, 0.01],                       // #ff0002 纯红
    YELLOW: [0.882, 0.882, 0.0],                 // #e1e100
    GREEN: [0.0, 1.0, 0.0],                      // #00ff00
    STEM_LEFT: [[0.89, 0.30, 0.12], [0.82, 0.34, 0.22]],   // 底 #e34d1f -> 顶 #d15738
    STEM_RIGHT: [[0.05, 0.47, 0.09], [0.03, 0.42, 0.03]],  // 底 #0d7817 -> 顶 #086b08
    //: 实测尺寸：圆点直径 23.5px，射线粗 3.6px，尾迹粗 ~8px
    DOT_R: 11.7,
    RAY_HALF: 1.8,
    STEM_HALF: [4.0, 3.7],
    //: 参考图原始画面尺寸（Widget 里的逻辑坐标系）
    W: 924,
    H: 691
  };

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
    DOT: DOT, RAY: RAY, PATH: PATH, DOT_SIDES: DOT_SIDES, DOT_PTS: DOT_PTS, RAY_PTS: RAY_PTS,
    SHAPES: SHAPES, geo: geo, rayGeo: rayGeo, pathGeo: pathGeo, DENSE: DENSE,
    STYLES: STYLES, STYLE_NAMES: STYLE_NAMES, ORIGINAL: ORIGINAL
  };
})(globalThis.FW || (globalThis.FW = {}));

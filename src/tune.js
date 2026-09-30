/* ============================================================================
 * tune.js —— 调参面板的"参数表"：登记可改项 / 读写 / 持久化 / 导出
 * ---------------------------------------------------------------------------
 * 两条硬约束：
 *   1) **默认值不在这里**。每个参数的真身仍是各模块里那个对象（show.js 的 ORCH、
 *      elements.js 的 PHYS、firework.js 的 CFG、sound.js 的 BUDGET/CRISP/TONE/LEVEL、
 *      data.js 的 STYLES/DENSE、view.js 的 BG）—— 这里只拿**引用**登记，原地写回。
 *      所以不开面板时行为与之前逐位一致（npm run baseline 守着：默认参数不许变）。
 *   2) **只有 ?tune=1 才读存储**。否则任何人打开页面都是默认档，不会因为某台机器上
 *      存着一份调参结果而变样；分享链接里也不带调参（shareUrl 只管 seed/max）。
 * 面板本体（DOM / 事件 / 样式）在 src/tune_ui.js。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var KEY = 'tune';                    // localStorage: fw.tune，只存"改过的那几项"
  var MOTION = { reduced: 0.55 };      // 系统"减少动效"时每发的降幅（app.js 读它）

  var STYLE_CN = { spoke: '辐条', cloud: '云团', ring: '环形', willow: '垂柳', palm: '棕榈' };
  /** 花型的键 -> [中文名, 最小值, 最大值, 步长, 常用(★)]。花型没有的键会自动跳过。 */
  var STYLE_KEYS = {
    count: ['火花数', 1, 60, 1, true],
    radius: ['扩散半径', 10, 400, 5, true],
    dot: ['火花大小', 2, 20, 0.5, true],
    drag: ['阻尼（弹开快慢）', 0.2, 8, 0.1, true],
    life: ['寿命', 0.2, 6, 0.05, true],
    gravity: ['下坠力度', 0, 300, 5, true],
    jitter: ['角度抖动', 0, 1, 0.01, true],
    trail: ['拖尾时长', 0, 5, 0.05, true],
    trail_seg: ['拖尾最多几段', 1, 8, 1, false],
    ember: ['每秒掉几颗余烬', 0, 5, 0.1, false],
    float_up: ['整体上飘', 0, 80, 2, false],
    spread: ['半径收窄', 0, 0.6, 0.02, false]
  };
  var CURVE = ['预算 ≥115%（最挤）', '≥95%', '≥72%', '≥48%', '≥28%', '≥12%', '最空（<12%）'];

  var controls = [], index = {}, defaults = {};

  /** 登记一棵"根"：面板只认这几棵树，别的一律碰不到（比如 SECRET 就不在里面）。 */
  function add(root, path, label, group, min, max, step, star, live) {
    var parts = path.split('.'), holder = root.obj, i;
    for (i = 0; i < parts.length - 1; i++) holder = holder[parts[i]];
    var key = parts[parts.length - 1];
    var c = {
      // live 是标在"根"上的（背景色 / 电平 / 低通 / 减少动效降幅这几棵）：它们都是"建
      // 的时候取一次"，所以改完要顺手作用到正在跑的对象上，不能等下一位访客。
      id: root.name + '.' + path, label: label, group: group, live: live || root.live || null,
      min: min, max: max, step: step, star: !!star, kind: 'number',
      get: function () { return holder[key]; },
      set: function (v) { holder[key] = v; return holder[key]; },
      isDefault: function () { return holder[key] === defaults[this.id]; }
    };
    controls.push(c);
    index[c.id] = c;
    return c;
  }

  function root(name, obj, live) { return { name: name, obj: obj, live: live || null }; }

  /* ------------------------------------------------ 登记：花型 / 编排 / 元素 */

  var R_STYLES = root('styles', FW.data.STYLES);
  Object.keys(FW.data.STYLES).forEach(function (name) {
    var spec = FW.data.STYLES[name], group = '花型 · ' + (STYLE_CN[name] || name);
    Object.keys(STYLE_KEYS).forEach(function (k) {
      var v = spec[k], m = STYLE_KEYS[k];
      if (v === undefined) return;                       // 这个花型没这一项
      if (Array.isArray(v)) {                            // 区间：上下限各一行
        add(R_STYLES, name + '.' + k + '.0', m[0] + ' 下限', group, m[1], m[2], m[3], m[4]);
        add(R_STYLES, name + '.' + k + '.1', m[0] + ' 上限', group, m[1], m[2], m[3], m[4]);
      } else {
        add(R_STYLES, name + '.' + k, m[0], group, m[1], m[2], m[3], m[4]);
      }
    });
  });

  // 权重（"抽到哪个"的概率）：花型出现率、配色三种套路的分量、落点偏好
  var R_STYLEW = root('stylew', FW.data.STYLE_W);
  FW.data.STYLE_NAMES.forEach(function (name) {
    add(R_STYLEW, name, (STYLE_CN[name] || name) + ' · ' + name, '权重', 0, 10, 1, true);
  });
  var R_PALW = root('palettew', FW.data.PALETTE_W);
  add(R_PALW, 'same', '配色 · 同色系', '权重', 0, 100, 1, true);
  add(R_PALW, 'clash', '配色 · 冷暖撞色', '权重', 0, 100, 1, true);
  add(R_PALW, 'near', '配色 · 邻近色', '权重', 0, 100, 1, true);

  var R_DENSE = root('dense', FW.data.DENSE);
  add(R_DENSE, 'spark', '火花轨迹采样上限（段）', '画面', 2, 40, 1, true);
  add(R_DENSE, 'trail', '发射尾迹采样上限（段）', '画面', 2, 120, 1, true);

  var R_ORCH = root('orch', FW.show.ORCH);
  add(R_ORCH, 'spawnMin', '常规发射间隔 下限', '编排', 0.1, 8, 0.05, true);
  add(R_ORCH, 'spawnMax', '常规发射间隔 上限', '编排', 0.1, 8, 0.05, true);
  add(R_ORCH, 'finaleMin', '齐射间隔 下限', '编排', 4, 90, 0.5, true);
  add(R_ORCH, 'finaleMax', '齐射间隔 上限', '编排', 4, 90, 0.5, true);
  add(R_ORCH, 'salvoMin', '一波齐射 最少几发', '编排', 1, 8, 1, false);
  add(R_ORCH, 'salvoMax', '一波齐射 最多几发', '编排', 1, 8, 1, true);
  add(R_ORCH, 'densityCap', '每发规模上限', '编排', 1, 4, 0.05, true);
  add(R_ORCH, 'elementRatio', '元素表上限 = 预算 ×', '编排', 0.1, 1.5, 0.05, false);
  add(R_ORCH, 'xSpread', '发射点水平散布', '编排', 0, 0.9, 0.01, true);
  add(R_ORCH, 'drift', '爆心横向漂移', '编排', 0, 0.9, 0.01, false);
  add(R_ORCH, 'xLimit', '爆心横向硬边界', '编排', 0, 1, 0.01, false);
  add(R_ORCH, 'yMin', '爆心高度 下限', '编排', 0, 0.9, 0.01, true);
  add(R_ORCH, 'yMax', '爆心高度 上限', '编排', 0, 0.9, 0.01, true);
  // 落点偏好 = 分布指数：1 均匀、<1 往两端/高处、>1 向中间/低处（见面板上「权重」那行说明）
  add(R_ORCH, 'xBias', '水平分布指数', '权重', 0.2, 3, 0.05, true);
  add(R_ORCH, 'yBias', '高度分布指数', '权重', 0.2, 3, 0.05, true);
  add(R_ORCH, 'firstFinaleMin', '开播后第一波齐射 最早', '编排', 2, 60, 0.5, false);
  add(R_ORCH, 'firstFinaleMax', '开播后第一波齐射 最晚', '编排', 2, 60, 0.5, false);
  FW.show.ORCH.crowd.forEach(function (band, i) {
    add(R_ORCH, 'crowd.' + i + '.1', CURVE[i] + ' → 倍率', '拥挤度曲线', 0, 5, 0.05, false);
  });

  var R_PHYS = root('phys', FW.elements.PHYS);
  add(R_PHYS, 'flashLife', '爆心闪光 寿命', '爆心', 0.02, 1, 0.01, true);
  add(R_PHYS, 'flashFade', '爆心闪光 变暗指数', '爆心', 0.3, 4, 0.1, false);
  add(R_PHYS, 'flashShrink.0', '爆心闪光 收缩基准', '爆心', 0, 1, 0.05, false);
  add(R_PHYS, 'flashShrink.1', '爆心闪光 收缩比例', '爆心', 0, 1, 0.05, false);
  add(R_PHYS, 'emberGravity', '余烬 下坠', '余烬', 0, 400, 5, true);
  add(R_PHYS, 'emberDrag', '余烬 横向阻尼', '余烬', 0, 4, 0.1, true);
  add(R_PHYS, 'emberTwinkleAt', '余烬 闪烁门槛', '余烬', 0, 1, 0.05, false);
  add(R_PHYS, 'emberTwinkleHz', '余烬 闪烁频率', '余烬', 0, 60, 0.5, false);
  add(R_PHYS, 'emberSize.0', '余烬 半径基准', '余烬', 0, 1, 0.05, false);
  add(R_PHYS, 'emberSize.1', '余烬 半径随亮度', '余烬', 0, 1, 0.05, false);
  add(R_PHYS, 'emberLife.0', '火花掉的余烬 寿命 下限', '余烬', 0.05, 4, 0.05, false);
  add(R_PHYS, 'emberLife.1', '火花掉的余烬 寿命 上限', '余烬', 0.05, 4, 0.05, false);
  add(R_PHYS, 'emberSizeK', '火花掉的余烬 大小（× 火花半径）', '余烬', 0, 1, 0.01, false);
  add(R_PHYS, 'sparkTrailStep', '轨迹采样步长（像素）', '火花', 1, 40, 0.5, true);
  add(R_PHYS, 'sparkShade', '火花变暗指数', '火花', 0.2, 3, 0.05, false);
  add(R_PHYS, 'sparkTwinkleBelow', '末期闪烁 亮度门槛', '火花', 0, 1, 0.02, false);
  add(R_PHYS, 'sparkTwinkleChance', '末期闪烁 概率', '火花', 0, 1, 0.05, false);
  add(R_PHYS, 'sparkTrailWidth', '尾迹半宽（× 火花半径）', '火花', 0, 1, 0.02, true);
  add(R_PHYS, 'trailFade', '发射尾迹 散掉要多久', '发射尾迹', 0.1, 8, 0.1, true);
  add(R_PHYS, 'trailStep', '发射尾迹 采样步长', '发射尾迹', 1, 40, 0.5, true);
  add(R_PHYS, 'trailMaxPts', '发射尾迹 最多几个点', '发射尾迹', 8, 300, 2, false);

  var R_CFG = root('cfg', FW.firework.CFG);
  add(R_CFG, 'rocketG', '火箭重力（决定上升时间）', '发射', 50, 2000, 10, true);
  add(R_CFG, 'flashSize.0', '爆心闪光 半径 下限', '爆心', 4, 120, 1, true);
  add(R_CFG, 'flashSize.1', '爆心闪光 半径 上限', '爆心', 4, 120, 1, true);
  add(R_CFG, 'riseEmberSec', '上升撒火星 间隔', '发射', 0.01, 0.5, 0.01, false);
  add(R_CFG, 'riseEmberSize', '上升撒火星 大小', '发射', 0.5, 8, 0.1, false);
  add(R_CFG, 'riseEmberLife.0', '上升撒火星 寿命 下限', '发射', 0.05, 3, 0.05, false);
  add(R_CFG, 'riseEmberLife.1', '上升撒火星 寿命 上限', '发射', 0.05, 3, 0.05, false);
  add(R_CFG, 'puff.seconds', '爆心碎屑 撒多久', '爆心', 0, 1.5, 0.01, true);
  add(R_CFG, 'puff.interval', '爆心碎屑 间隔', '爆心', 0.002, 0.2, 0.002, true);
  add(R_CFG, 'puff.size', '爆心碎屑 大小', '爆心', 0.5, 12, 0.1, true);
  add(R_CFG, 'puff.life.0', '爆心碎屑 寿命 下限', '爆心', 0.05, 2, 0.01, false);
  add(R_CFG, 'puff.life.1', '爆心碎屑 寿命 上限', '爆心', 0.05, 2, 0.01, true);

  /* --------------------------------------------------------- 登记：音效 / 外观 */

  var R_BUDGET = root('budget', FW.sound.BUDGET);
  add(R_BUDGET, 'perSec', '发声预算（个/秒）', '音效', 1, 30, 1, true);
  add(R_BUDGET, 'max', '同时发声上限', '音效', 1, 30, 1, false);
  add(R_BUDGET, 'squeezed', '超预算时压到', '音效', 0.05, 1, 0.05, false);
  var R_CRISP = root('crisp', FW.sound.CRISP);
  add(R_CRISP, 'base', '爆炸 脆闷基准（0 闷 ~ 1 脆）', '音效', 0.05, 0.95, 0.01, true);
  add(R_CRISP, 'spread', '爆炸 每发的随机幅度', '音效', 0, 1, 0.02, true);
  add(R_CRISP, 'shellRef', '壳径基准（越大越闷）', '音效', 20, 500, 10, false);
  add(R_CRISP, 'shellSpan', '壳径影响跨度', '音效', 50, 2000, 10, false);
  add(root('level', FW.sound.LEVEL, 'level'), 'init', '整体电平', '音效', 0, 1, 0.02, true);
  add(root('tone', FW.sound.TONE, 'tone'), 'hz', '主链低通（Hz）', '音效', 2000, 20000, 100, true);
  add(root('bg', FW.view.BG, 'bg'), 'hex', '背景色', '画面', 0, 0, 0, true).kind = 'color';
  add(root('motion', MOTION, 'motion'), 'reduced', '减少动效时的降幅', '画面', 0.1, 1, 0.01, true);

  Object.keys(index).forEach(function (id) { defaults[id] = index[id].get(); });

  /* ------------------------------------------------------------------ 读写 */

  function get(id) { return index[id] ? index[id].get() : undefined; }
  function set(id, v) { return index[id] ? index[id].set(v) : undefined; }

  /** 改过的项（只存/只导出这些，以后源码默认值改了也不会被旧记录盖住）。 */
  function diff() {
    var out = {};
    controls.forEach(function (c) { if (!c.isDefault()) out[c.id] = c.get(); });
    return out;
  }

  function changed() { return Object.keys(diff()).length; }

  /** `?tune=1` = 一进来就自动把面板打开（面板本身随时可用：控制台「调参」或按 T）。 */
  function wanted() {
    var q = (typeof location === 'undefined') ? '' : (location.search || '');
    return /[?&]tune=1(&|$)/.test(q);
  }

  /** 把某一行"活"地作用到正在跑的对象上（背景色、电平这些不是读一次就完的事）。 */
  function applyLive(id) {
    var c = index[id], app2 = FW.app && FW.app.instance;
    if (!c || !app2) return;
    if (c.live === 'bg') app2.renderer.setBg(c.get());
    else if (c.live === 'motion') app2.setReduceMotion(app2.reduceMotion);
    else if (c.live === 'level' && app2.sound) app2.sound.setLevel(c.get());
    else if (c.live === 'tone' && app2.sound) app2.sound.setTone(c.get());
  }

  function applyLiveAll() { controls.forEach(function (c) { applyLive(c.id); }); }

  /** 从存储读回改过的项（只在 ?tune=1 时调用）。认不出来的键一律忽略。 */
  function load(store) {
    var raw = store && store.get(KEY), data, n = 0;
    if (!raw) return 0;
    try { data = JSON.parse(raw); } catch (e) { return 0; }
    controls.forEach(function (c) {
      var v = data[c.id];
      if (c.kind === 'color' ? (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))
                             : (typeof v === 'number' && isFinite(v))) {
        c.set(v); n++;
      }
    });
    applyLiveAll();
    return n;
  }

  /** 写回存储：没有改动就把键删掉，别留一个空壳。 */
  function save(store) {
    if (!store) return 0;
    var d = diff(), n = Object.keys(d).length;
    if (n) store.set(KEY, JSON.stringify(d));
    else if (store.remove) store.remove(KEY);
    return n;
  }

  /** 复位：全部回到源码默认值，并把存储里的那份删掉。 */
  function reset(store) {
    controls.forEach(function (c) { c.set(defaults[c.id]); });
    if (store) { if (store.remove) store.remove(KEY); else store.set(KEY, ''); }
    applyLiveAll();
    return 0;
  }

  /** 导出：只有改过的那几项（贴回源码 = 把值写回对应模块的默认值）。 */
  function diffJson() { return JSON.stringify(diff(), null, 2); }

  /** 全部参数的当前值（"全部参数"那个框用）。 */
  function allJson() {
    var out = {};
    controls.forEach(function (c) { out[c.id] = c.get(); });
    return JSON.stringify(out, null, 1);
  }

  /**
   * 把"全部参数"框里的 JSON 应用回去：只认登记过的键，数值/颜色合法才写。
   * 返回 { applied, ignored } 好让面板说清楚发生了什么。
   */
  function applyJson(text) {
    var data, applied = 0, ignored = 0;
    try { data = JSON.parse(text); } catch (e) { return { applied: 0, ignored: -1 }; }
    if (!data || typeof data !== 'object') return { applied: 0, ignored: -1 };
    Object.keys(data).forEach(function (id) {
      var c = index[id];
      if (!c) { ignored++; return; }
      var v = data[id];
      if (c.kind === 'color' ? (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))
                             : (typeof v === 'number' && isFinite(v))) {
        c.set(v); applyLive(id); applied++;
      } else ignored++;
    });
    return { applied: applied, ignored: ignored };
  }

  FW.tune = {
    KEY: KEY, MOTION: MOTION,
    controls: function () { return controls; },
    group: function (name) { return controls.filter(function (c) { return c.group === name; }); },
    groups: function () {
      var seen = [];
      controls.forEach(function (c) { if (seen.indexOf(c.group) < 0) seen.push(c.group); });
      return seen;
    },
    styleNames: STYLE_CN,
    get: get, set: set, applyLive: applyLive, applyLiveAll: applyLiveAll,
    changed: changed, diff: diff, diffJson: diffJson, allJson: allJson, applyJson: applyJson,
    wanted: wanted, load: load, save: save, reset: reset
  };
})(globalThis.FW || (globalThis.FW = {}));

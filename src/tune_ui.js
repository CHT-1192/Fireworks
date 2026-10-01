/* ============================================================================
 * tune_ui.js —— 调参面板的 DOM（参数表在 src/tune.js）
 * ---------------------------------------------------------------------------
 * **平时不建任何节点**（连 <style> 都不注入）：控制台里的「调参」按钮或按 **T** 才第一次
 * 挂上来（`?tune=1` 只是"一进来就自动打开"，老链接照旧好用）。面板放在**右下**
 * （HUD 在右上、控制台在左），互不遮挡。
 *
 * 面板只做三件事：拖动 -> 原地改默认值（tune.set）、送一次"活"更新（tune.applyLive）、
 * 松手时把"改过的那几项"落盘（tune.save -> localStorage 的 fw.tune）。
 * 「复制改动 JSON」给的是 `{"styles.spoke.life": 1.8, ...}` 这种**只有改动**的清单：
 * 贴回源码 = 把值写回对应模块的默认值，然后把 fw.tune 复位即可，旧记录不会盖住新默认。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var mounted = null;          // 已经建出来的那块面板（懒加载：没打开就没有节点）

  // 哪一组需要额外解释一句（权重会影响随机流，得说清楚）
  var NOTES = {
    '权重': '只管"抽到哪个"：0 = 不出现。默认（花型全 1、配色 30/42/28、分布指数 1）与之前'
         + '逐位一致；一改动，同一个种子就会放出不同的一场。分布指数 1 = 均匀，'
         + '< 1 往两侧 / 往高处，> 1 向中间 / 往低处。'
  };

  var CSS = [
    '#tune{position:fixed;right:12px;bottom:12px;z-index:5;width:330px;max-height:min(72vh,760px);',
    'overflow:auto;padding:12px;border-radius:14px;background:rgba(8,12,32,.88);',
    'backdrop-filter:blur(10px);border:1px solid rgba(255,211,77,.3);',
    'box-shadow:0 14px 34px rgba(0,0,0,.55);display:flex;flex-direction:column;gap:7px;',
    'font-size:12px;color:#d7e5ff}',
    '#tune .head{display:flex;align-items:center;gap:8px}',
    '#tune .head b{font-size:13px;color:#f2f6ff}',
    '#tune .head button{margin-left:auto}',
    '#tune h2{margin:6px 0 1px;font-size:11.5px;font-weight:600;letter-spacing:.3px;color:#ffd98a}',
    '#tune .row{display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(200,215,255,.78)}',
    '#tune .row .k{flex:0 0 124px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#tune .row input[type=range]{flex:1 1 auto;min-width:0;accent-color:#ffd34d}',
    '#tune .row input[type=color]{flex:0 0 44px;height:24px;padding:0}',
    '#tune .row output{flex:0 0 42px;text-align:right;font-weight:600;color:#ffd98a;',
    'font-variant-numeric:tabular-nums}',
    '#tune select{width:100%}',
    '#tune .note{margin:0;font-size:10.5px;line-height:1.6;color:rgba(178,198,255,.62)}',
    '#tune .acts{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}',
    '#tune textarea{width:100%;height:140px;padding:6px;border-radius:9px;resize:vertical;',
    'font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8f0ff;outline:none;',
    'background:rgba(255,255,255,.05);border:1px solid rgba(140,170,255,.22)}',
    '#tune details summary{cursor:pointer;font-size:11.5px;color:#ffd98a;margin-top:4px}',
    '#tune .msg{margin:0;font-size:10.5px;line-height:1.5;color:#9ad7ff}',
    // 消息行没内容时整行收掉：<p> 的 1em 上下边距 + 面板的 gap 会白占四十多像素
    '#tune .msg:empty{display:none}',
    '@media (max-width:740px){#tune{width:calc(100vw - 24px)}}'
  ].join('');

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function fmt(v) {
    return (typeof v === 'number') ? String(Math.round(v * 1000) / 1000) : String(v);
  }

  /** 一行控件：标签 + 滑条（或取色器）+ 当前值。label 包住输入，读屏能念出名字。 */
  function row(c, T, store, after) {
    var lab = h('label', 'row');
    lab.appendChild(h('span', 'k', c.label));
    var inp = document.createElement('input');
    if (c.kind === 'color') { inp.type = 'color'; inp.value = c.get(); }
    else {
      inp.type = 'range';
      inp.min = c.min; inp.max = c.max; inp.step = c.step;
      inp.value = c.get();
    }
    inp.setAttribute('aria-label', c.label);
    inp.title = c.id;
    var out = h('output', null, fmt(c.get()));
    inp.addEventListener('input', function () {
      T.set(c.id, c.kind === 'color' ? inp.value : parseFloat(inp.value));
      out.textContent = fmt(c.get());
      T.applyLive(c.id);            // 背景色 / 电平这类要立刻作用到正在跑的对象上
      after();
    });
    inp.addEventListener('change', function () {        // 松手（或选完颜色）才落盘
      T.save(store);
      after('已存到 fw.tune');
    });
    lab.appendChild(inp);
    lab.appendChild(out);
    return { lab: lab, inp: inp, out: out };
  }

  function mount(store) {
    var T = FW.tune, app = FW.app.instance;
    if (!T || !app) return null;
    if (mounted) return mounted;                  // 幂等：重复调用只是拿到同一块面板
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var box = h('aside');
    box.id = 'tune';
    box.setAttribute('aria-label', '调参面板');
    var inputs = {};                                   // id -> {inp, out}，用于复位/应用后刷新

    var stat = h('p', 'note');
    var msgEl = h('p', 'msg');
    msgEl.setAttribute('role', 'status');
    msgEl.setAttribute('aria-live', 'polite');

    function status(extra) {
      var n = T.changed();
      stat.textContent = '改动 ' + n + ' 项 · 存在 fw.tune（只在这里生效，不进分享链接）'
        + (extra ? ' · ' + extra : '');
    }
    function after(extra) { status(extra); }

    /* -------------------------------------------------------------- 标题栏 */

    var head = h('div', 'head');
    head.appendChild(h('b', null, '调参面板'));
    var close = h('button', 'mini', '收起');
    close.id = 'tune-close';
    close.title = '只把这个面板收起来（控制台「调参」或按 T 再打开）；调参继续生效，复位请按「复位全部」';
    close.addEventListener('click', function () { box.hidden = true; msgEl.textContent = '已收起（按 T 再打开）'; });
    head.appendChild(close);
    box.appendChild(head);
    box.appendChild(h('p', 'note', '★ 的项是常用参数。改动对之后放的烟花生效 —— 按「放一发」或「重放」立刻看。'));

    var acts = h('div', 'acts');
    var shot = h('button', 'mini', '放一发');
    var replay = h('button', 'mini', '重放');
    var copy = h('button', 'mini', '复制改动 JSON');
    var reset = h('button', 'mini', '复位全部');
    shot.id = 'tune-shot'; replay.id = 'tune-replay';
    copy.id = 'tune-copy'; reset.id = 'tune-reset';
    shot.addEventListener('click', function () { app.gesture(); app.extra(); status('放了一发'); });
    replay.addEventListener('click', function () { app.rebuild(app.seed); status('已重放'); });
    copy.addEventListener('click', function () { copyOut(); });
    reset.addEventListener('click', function () {
      T.reset(store);
      refresh();
      msgEl.textContent = '已复位：全部回到源码默认值，fw.tune 也删掉了';
      status();
    });
    acts.appendChild(shot); acts.appendChild(replay);
    acts.appendChild(copy); acts.appendChild(reset);
    box.appendChild(acts);
    stat.id = 'tune-stat';
    box.appendChild(stat);
    box.appendChild(msgEl);

    /* ------------------------------------------------------------ 常用滑条 */

    var styleSec = h('section');
    styleSec.appendChild(h('h2', null, '花型'));
    var sel = document.createElement('select');
    sel.id = 'tune-style';
    sel.setAttribute('aria-label', '要调的花型');
    Object.keys(T.styleNames).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = T.styleNames[k] + ' · ' + k;
      sel.appendChild(o);
    });
    sel.value = Object.keys(T.styleNames)[0];
    sel.addEventListener('change', function () { fillStyle(sel.value); });
    styleSec.appendChild(sel);
    box.appendChild(styleSec);

    function fillStyle(name) {
      while (styleSec.lastChild !== sel) styleSec.removeChild(styleSec.lastChild);
      T.group('花型 · ' + T.styleNames[name]).forEach(function (c) {
        if (!c.star) return;
        var r = row(c, T, store, after);
        inputs[c.id] = r;
        styleSec.appendChild(r.lab);
      });
    }

    ['权重', '编排', '拥挤度曲线', '发射', '爆心', '火花', '余烬', '发射尾迹', '音效', '画面']
      .forEach(function (group) {
        var star = T.group(group).filter(function (c) { return c.star; });
        if (!star.length) return;
        var sec = h('section');
        sec.appendChild(h('h2', null, group));
        if (NOTES[group]) sec.appendChild(h('p', 'note', NOTES[group]));
        star.forEach(function (c) {
          var r = row(c, T, store, after);
          inputs[c.id] = r;
          sec.appendChild(r.lab);
        });
        box.appendChild(sec);
      });
    fillStyle(sel.value);

    /* -------------------------------------------------------- 全部参数 JSON */

    var det = document.createElement('details');
    det.appendChild(h('summary', null, '全部参数（JSON，' + T.controls().length + ' 项）'));
    var ta = document.createElement('textarea');
    ta.id = 'tune-json';
    ta.spellcheck = false;
    ta.setAttribute('aria-label', '全部参数的 JSON');
    ta.value = T.allJson();
    det.appendChild(ta);
    var jacts = h('div', 'acts');
    var apply = h('button', 'mini', '应用');
    var reload = h('button', 'mini', '重载');
    apply.id = 'tune-apply'; reload.id = 'tune-reload';
    apply.addEventListener('click', function () {
      var r = T.applyJson(ta.value);
      if (r.ignored < 0) { msgEl.textContent = 'JSON 解析失败，什么都没改'; return; }
      T.save(store);
      refresh();
      msgEl.textContent = '已应用 ' + r.applied + ' 项'
        + (r.ignored ? '，忽略 ' + r.ignored + ' 项（名字不认识或值不合法）' : '');
      status();
    });
    reload.addEventListener('click', function () { ta.value = T.allJson(); msgEl.textContent = '已重载当前值'; });
    jacts.appendChild(apply); jacts.appendChild(reload);
    det.appendChild(jacts);
    box.appendChild(det);

    function refresh() {
      Object.keys(inputs).forEach(function (id) {
        var v = T.get(id);
        inputs[id].inp.value = v;
        inputs[id].out.textContent = fmt(v);
      });
      ta.value = T.allJson();
    }

    function copyOut() {
      var text = T.diffJson();
      var done = function (how) { msgEl.textContent = '改动 JSON 已' + how + '（' + T.changed() + ' 项）'; };
      var fallback = function () {
        console.log('调参改动 JSON（贴回源码用）：\n' + text);
        done('打到控制台');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done('复制'); }, fallback);
      } else fallback();
    }

    document.body.appendChild(box);
    mounted = box;
    status();
    return box;
  }

  /** 打开 / 收起：第一次调用才真的把面板建出来（别人不进调参就一点开销都没有）。 */
  function toggle(store) {
    if (!mounted) return mount(store);
    mounted.hidden = !mounted.hidden;
    return mounted;
  }

  /** 键盘：**T** 打开 / 收起。正在打字（文本类控件 / 下拉 / 文本域）时让位。 */
  function bindKeys(store) {
    window.addEventListener('keydown', function (e) {
      var el = e.target || {};
      var tag = String(el.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'select') return;
      if (tag === 'input' && /^(text|number|search|email|url|password|tel|color)$/.test(el.type || '')) return;
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        toggle(store);            // 第一次按 = 建出来并显示，之后再按就是收起 / 展开
      }
    });
  }

  FW.tuneUi = { mount: mount, toggle: toggle, bindKeys: bindKeys };
})(globalThis.FW || (globalThis.FW = {}));

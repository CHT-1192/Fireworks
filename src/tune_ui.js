/* ============================================================================
 * tune_ui.js —— 调参面板的 DOM（参数表在 src/tune.js）
 * ---------------------------------------------------------------------------
 * 只在 `?tune=1` 时由 ui.js 挂上来；平时这个文件不建任何节点，连 <style> 都不注入。
 * 面板放在**右下**（HUD 在右上、控制台在左），互不遮挡。
 *
 * 面板只做三件事：拖动 -> 原地改默认值（tune.set）、送一次"活"更新（tune.applyLive）、
 * 松手时把"改过的那几项"落盘（tune.save -> localStorage 的 fw.tune）。
 * 「复制改动 JSON」给的是 `{"styles.spoke.life": 1.8, ...}` 这种**只有改动**的清单：
 * 贴回源码 = 把值写回对应模块的默认值，然后把 fw.tune 复位即可，旧记录不会盖住新默认。
 * ==========================================================================*/
;(function (FW) {
  'use strict';

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
    '#tune .msg{min-height:14px;font-size:10.5px;line-height:1.5;color:#9ad7ff}',
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
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var box = h('aside');
    box.id = 'tune';
    box.setAttribute('aria-label', '调参面板（?tune=1 时出现）');
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
    close.title = '只把这个面板收起来（按 T 再打开）；调参继续生效，复位请按「复位全部」';
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

    ['编排', '拥挤度曲线', '发射', '爆心', '火花', '余烬', '发射尾迹', '音效', '画面']
      .forEach(function (group) {
        var star = T.group(group).filter(function (c) { return c.star; });
        if (!star.length) return;
        var sec = h('section');
        sec.appendChild(h('h2', null, group));
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

    /* ------------------------------------------------------------------ 键盘 */

    function toggle(e) {
      var el = e.target || {};
      var tag = String(el.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'select') return;
      if (tag === 'input' && /^(text|number|search|email|url|password|tel|color)$/.test(el.type || '')) return;
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        box.hidden = !box.hidden;
        msgEl.textContent = box.hidden ? '已收起（按 T 再打开）' : '调参面板已打开';
      }
    }

    document.body.appendChild(box);
    window.addEventListener('keydown', toggle);
    status();
    return box;
  }

  FW.tuneUi = { mount: mount };
})(globalThis.FW || (globalThis.FW = {}));

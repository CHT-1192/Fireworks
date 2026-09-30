#!/usr/bin/env node
/* ============================================================================
 * render_smoke.js —— 不需要浏览器就能跑通的两段自检
 * ---------------------------------------------------------------------------
 * 1) 渲染路径：用假 canvas 接住 view.js 的全部绘制调用，检查
 *      * 每个坐标/线宽都是有限数（NaN / undefined 立刻抓出来）
 *      * 每个 fillStyle / strokeStyle 都是合法 #rrggbb（颜色漏传当场暴露）
 *      * 每个图元的 shape 都被识别（有没有画不出来的图元）
 *    这三种问题在浏览器里只会表现为画面空白 —— rAF 把异常吞了，所以必须在
 *    Node 里拦住。（真浏览器那一段见 tools/browser_check.js）
 *
 * 2) 主循环：app.js 不碰 DOM，所以能在 Node 里直接构造 App 并手动推帧，验证
 *    定格帧、固定步长推进、暂停、以及"渲染异常被 tick 兜住"。
 *
 * 用法：node tools/render_smoke.js
 * ==========================================================================*/
'use strict';

const { makeFakeCanvas, stubWindow, loadWithRenderer } = require('./fake_canvas');

/* ---- 假 canvas（见 tools/fake_canvas.js）---- */
stubWindow(924, 691);
const { canvas, ctx, problems } = makeFakeCanvas(924, 691);
const FW = loadWithRenderer();

// 一个普通种子 + 同一个种子加一次插播（那个词触发的就是后者）
const CASES = [{ seed: '7' }, { seed: '7', interlude: true, name: 'seed=7+插播' }];
const FRAMES = 240;
const rows = [];

/* ------------------------------------------------ 1) 渲染路径 */

for (const cs of CASES) {
  const renderer = new FW.view.Renderer(canvas, 2);
  renderer.layout(924, 691);
  const show = new FW.show.Show(924, 691, new FW.rng.Random(cs.seed),
                                { maxGeos: FW.show.DEFAULT_GEOS });
  FW.show.build(show);
  if (cs.interlude) show.interlude();
  const before = ctx.ops;
  let segs = 0, geos = 0, drawn = 0;
  for (let i = 0; i < FRAMES; i++) {
    show.step(i === 0 ? 0 : 1 / 60);
    renderer.draw(show.frameGeos);
    segs += renderer.segs;
    geos += renderer.geos;
    if (renderer.geos > 0) drawn++;
  }
  rows.push({ name: cs.name || 'seed=' + cs.seed, geos: Math.round(geos / FRAMES),
              segs: Math.round(segs / FRAMES),
              ops: Math.round((ctx.ops - before) / FRAMES), drawn });
}

console.log(`渲染路径自检（假 canvas，924×691，每组 ${FRAMES} 帧，预算 ${FW.show.DEFAULT_GEOS}）`);
console.log('─'.repeat(76));
console.log('  组            图元/帧  线段/帧  绘制调用/帧  有画面的帧');
for (const r of rows) {
  console.log(`  ${r.name.padEnd(12)}  ${String(r.geos).padStart(6)}`
    + `  ${String(r.segs).padStart(7)}  ${String(r.ops).padStart(10)}`
    + `  ${String(r.drawn).padStart(10)}`);
}
console.log('─'.repeat(76));

for (const r of rows) {
  if (r.drawn === 0) problems.push(`${r.name} 一帧都没画出东西`);
}
// 每组都必须真的在描边（尾迹是折线）
for (const r of rows) {
  if (!(r.segs > 0)) problems.push(`${r.name} 没有任何折线描边，尾迹没画出来`);
}

/* ------------------------------------------------ 1.5) 绘制预算真的会改变画面密度 */

/**
 * 跑一段，返回"绘制开销"的峰值与均值。
 * 口径必须是 show.lastGeos（折线按**段数**算）而不是 frameGeos.length（那是图元
 * **个数**）—— 预算与 HUD 的「预算」一行用的都是段数口径，两条折线能差出二三十倍，
 * 之前这里量错了对象，表里的数字和 HUD 对不上。
 */
function densityOf(budget, secs) {
  const show = new FW.show.Show(924, 691, new FW.rng.Random(7), { maxGeos: budget });
  FW.show.build(show);
  const n = Math.round(secs * 60);
  let peak = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    show.step(i === 0 ? 0 : 1 / 60);
    peak = Math.max(peak, show.lastGeos);
    sum += show.lastGeos;
  }
  return { peak, avg: sum / n };
}

// 预算是"画面容量"：调大必须真的更满（以前它只能往下压，调大毫无效果）
const small = densityOf(450, 60);
const big = densityOf(1400, 60);
const budgetProblems = [];
if (!(big.avg > small.avg * 1.5)) {
  budgetProblems.push(`调大预算没让画面变密：均值 ${small.avg.toFixed(0)} -> ${big.avg.toFixed(0)}`);
}
// 峰值只要求"明显更高"：口径换成段数之后，单帧最大值由齐射主导，实测 1.3~1.6 倍，
// 单种子抖动大；均值才是稳定信号（要求 1.5 倍以上）。
if (!(big.peak > small.peak * 1.2)) {
  budgetProblems.push(`调大预算没让峰值变高：${small.peak} -> ${big.peak}`);
}
if (!(small.avg > 0)) budgetProblems.push('预算 450 时画面是空的');

console.log('绘制预算自检（预算是容量目标：空则多发、满则收敛）');
console.log('─'.repeat(76));
if (budgetProblems.length) {
  for (const p of budgetProblems) console.log('  ✗ ' + p);
} else {
  console.log(`  OK   预算 450 -> 均值 ${small.avg.toFixed(0)} / 峰值 ${small.peak}`
    + `；1400 -> 均值 ${big.avg.toFixed(0)} / 峰值 ${big.peak}`);
}
console.log('─'.repeat(76));
for (const p of budgetProblems) problems.push(p);

/* ------------------------------------------------ 1.55) 事件钩子不影响模拟 */

/**
 * 音效是靠 Show.onEvent 这个钩子"听"模拟的。它必须**只读**：装了钩子之后，
 * 同一颗种子跑出来的每一帧都要和没装时一模一样（否则音效就在偷偷改演出）。
 */
function eventHookFingerprint(withHook) {
  const show = new FW.show.Show(924, 691, new FW.rng.Random(7),
                                { maxGeos: FW.show.DEFAULT_GEOS });
  let events = 0;
  if (withHook) show.onEvent = function (ev) { events += ev.type === 'burst' ? 2 : 1; };
  FW.show.build(show);
  let h = 0;
  for (let i = 0; i < 240; i++) {
    show.step(i === 0 ? 0 : 1 / 60);
    h = (h * 31 + show.lastGeos + show.elements.length * 7
         + show.fireworks.length * 13 + show.frameGeos.length) % 1000000007;
    for (const g of show.frameGeos) {
      // 折线图元没有 x/y/wid/leng（它们是 segs 数组），所以先过滤掉非数值
      const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
      h = (h * 31 + Math.round((n(g.x) + n(g.y) + n(g.wid) + n(g.leng)) * 1000)
           + (g.segs ? g.segs.length : 1) + String(g.shape).length) % 1000000007;
    }
  }
  return { h, events };
}
const noHook = eventHookFingerprint(false);
const withHook = eventHookFingerprint(true);
const hookProblems = [];
if (noHook.h !== withHook.h) hookProblems.push('装了事件钩子之后模拟结果变了（音效不该影响演出）');
if (!(withHook.events > 0)) hookProblems.push('事件钩子一个发射/爆炸事件都没收到');

console.log('事件钩子自检（音效只"听"，不影响这一场）');
console.log('─'.repeat(76));
if (hookProblems.length) {
  for (const p of hookProblems) console.log('  ✗ ' + p);
} else {
  console.log(`  OK   240 帧指纹一致（${noHook.h}），期间收到 ${withHook.events} 个发射/爆炸事件`);
}
console.log('─'.repeat(76));
for (const p of hookProblems) problems.push(p);

/* ------------------------------------------------ 1.6) PNG 元数据 */

// crc32 用标准测试向量；插块用合成 PNG 往返（Node 里就能验，不用浏览器）
const pngChecks = [];
if (FW.pngmeta.crc32(new TextEncoder().encode('123456789')) !== 0xcbf43926) {
  pngChecks.push('crc32("123456789") 不等于标准向量 0xcbf43926');
}
{
  // 合成最小 PNG：IHDR + IDAT + IEND
  const zlib = require('zlib');
  const mk = (type, data) => {
    const t = Buffer.from(type, 'latin1');
    const body = Buffer.concat([t, data]);
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(FW.pngmeta.crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const raw = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    mk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    mk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 128, 0]))),
    mk('IEND', Buffer.alloc(0))
  ]);
  const pairs = FW.pngmeta.tags({ seed: '49388',
                                  url: 'https://x/Fireworks/?seed=49388',
                                  time: new Date('2026-09-24T02:30:00Z') });
  const tagged = Buffer.from(FW.pngmeta.addText(new Uint8Array(raw), pairs));
  const back = FW.pngmeta.readText(new Uint8Array(tagged));
  if (back.Seed !== '49388') pngChecks.push('PNG 元数据读不回种子');
  if (!/seed=49388/.test(back.Comment || '')) pngChecks.push('PNG 元数据读不回链接');
  if (back.Software !== '烟花 · Fireworks') pngChecks.push('PNG 元数据的 Software 不对（UTF-8？）');
  const order = FW.pngmeta.chunks(new Uint8Array(tagged)).map((c) => c.type).join(' ');
  if (order !== 'IHDR iTXt iTXt iTXt iTXt IDAT IEND') pngChecks.push('块顺序不对：' + order);
  const idat = FW.pngmeta.chunks(new Uint8Array(tagged)).find((c) => c.type === 'IDAT');
  if (zlib.inflateSync(Buffer.from(idat.data)).length !== 4) pngChecks.push('插块后 IDAT 坏了');
}

console.log('PNG 元数据自检（crc32 标准向量 + 合成 PNG 插块往返）');
console.log('─'.repeat(76));
if (pngChecks.length) for (const p of pngChecks) console.log('  ✗ ' + p);
else console.log('  OK   crc32 对上标准向量；iTXt 插在 IHDR 之后；种子/链接/Software 读得回；IDAT 未损坏');
console.log('─'.repeat(76));
for (const p of pngChecks) problems.push(p);

/* ------------------------------------------------ 2) 主循环 */

const { App } = FW.app;
const loopProblems = [];
const makeApp = (query) => new App({ canvas: makeFakeCanvas(924, 691).canvas,
                                     search: new URLSearchParams(query) });

// 2.1 ?frames=N 应在构造时就定格在 (N-1)/60 秒，且第一帧已同步画出来
const frozen = makeApp('seed=7&frames=150&w=924&h=691');
const tFrozen = 149 / 60;
if (Math.abs(frozen.show.time - tFrozen) > 1e-9) {
  loopProblems.push(`frames=150 定格在 ${frozen.show.time}s，预期 ${tFrozen}s`);
}
if (!frozen.paused) loopProblems.push('frames=150 没有定格');
if (!(frozen.renderer.geos > 0)) loopProblems.push('定格帧没有被同步画出来');

// 2.2 继续放：60 个 16.67ms 的帧应推进约 1.0 秒（固定步长累加器）
frozen.togglePause();
let ts = performance.now();
for (let i = 0; i < 60; i++) { ts += 1000 / 60; frozen.stepFrame(ts); }
const advanced = frozen.show.time - tFrozen;
if (Math.abs(advanced - 1.0) > 0.05) loopProblems.push(`60 帧只推进了 ${advanced.toFixed(3)}s`);

// 2.3 暂停后时间不再走
frozen.togglePause();
const hold = frozen.show.time;
for (let i = 0; i < 30; i++) { ts += 1000 / 60; frozen.stepFrame(ts); }
if (frozen.show.time !== hold) loopProblems.push('暂停后时间还在走');

// 2.4 种子规则：只收数字；那个词不是种子，写进 URL 也照样退回数字种子
const SECRET = FW.app.SECRET;
const cases = [
  ['seed=7', '7'],
  ['seed=007', '007'],
  ['seed=%20' + SECRET.toLowerCase() + '%20', null],     // 那个词：URL 里不认
  ['seed=%20', null],                                    // 空 -> 今天的种子（数字）
  ['scene=classic&seed=7', '7']                          // 老链接里的 scene= 直接无视
];
for (const [q, seed] of cases) {
  const a = makeApp(q);
  if (seed === null ? !/^\d+$/.test(a.seed) : a.seed !== seed) {
    loopProblems.push(`${q} 种子应为 ${seed === null ? '数字' : seed}，实际 ${a.seed}`);
  }
}
// 乱敲的字母一律不认，退回随机数字种子
const bogus = makeApp('seed=KQXW');
if (!/^\d+$/.test(bogus.seed)) loopProblems.push(`乱敲的字母种子应退回数字，实际 ${bogus.seed}`);

// 2.4b 那个词 = 一次插播，而且**发不出去、也留不下**：
// 直接触发只是多两发，种子不动，链接/存储/文件名/元数据里都不该出现它
const fakeStore = (data) => ({
  data,
  get(k) { return this.data[k] === undefined ? null : this.data[k]; },
  set(k, v) { this.data[k] = v; },
  remove(k) { delete this.data[k]; }
});
const plain = makeApp('seed=7&w=924&h=691');
const eggStore = fakeStore({ seed: '7' });
const egg = new App({ canvas: makeFakeCanvas(924, 691).canvas,
                      search: new URLSearchParams('seed=7&w=924&h=691'), store: eggStore });
egg.interlude();
if (plain.show.fireworks.length !== 2) {
  loopProblems.push(`普通种子开场应有 2 发，实际 ${plain.show.fireworks.length}`);
}
if (egg.show.fireworks.length !== plain.show.fireworks.length + 2) {
  loopProblems.push(`插播应多 2 发，实际 ${egg.show.fireworks.length} 发`);
}
if (egg.seed !== '7') loopProblems.push(`插播不该改种子，实际 ${egg.seed}`);
const shareQuery = egg.shareUrl().split('?')[1] || '';
if (!/^seed=\d+(&max=\d+)?$/.test(shareQuery)) {
  loopProblems.push('分享链接的参数里出现了非数字：' + egg.shareUrl());
}
if (eggStore.data.seed !== '7') {
  loopProblems.push('插播往浏览器存储里写了东西：' + eggStore.data.seed);
}
if (FW.app.seedFromRaw(SECRET) !== '') loopProblems.push('seedFromRaw 不该放那个词进来');
if (!egg.eggFound) loopProblems.push('插播后没有记住"词已找到"（控制台提示该闭嘴了）');

// 2.4c 存储里只该有数字：更早的版本把那个词存过一份，开机就该被抹掉
const stale = fakeStore({ seed: SECRET });
const cleaned = new App({ canvas: makeFakeCanvas(924, 691).canvas,
                          search: new URLSearchParams('w=924&h=691'), store: stale });
if (/[A-Za-z]/.test(String(stale.data.seed))) {
  loopProblems.push('存储里那份那个词没被抹掉：' + stale.data.seed);
}
if (!/^\d+$/.test(cleaned.seed)) loopProblems.push(`抹掉后应退回数字种子，实际 ${cleaned.seed}`);
// 数字种子照旧沿用（上次那一场）
const keptStore = fakeStore({ seed: '42' });
const kept = new App({ canvas: makeFakeCanvas(924, 691).canvas,
                       search: new URLSearchParams('w=924&h=691'), store: keptStore });
if (kept.seed !== '42' || keptStore.data.seed !== '42') {
  loopProblems.push(`上次的种子没被沿用：${kept.seed} / ${keptStore.data.seed}`);
}
if (kept.dailyMode) loopProblems.push('上次是明确选的种子，不该算"每日"');

// 2.4d "每日"是个跟着日期走的开关（存 fw.daily）：
//   * 第一次来 -> 今天这一场 + 开关打开
//   * 开关开着 + 昨天存下的种子 -> 换成今天这一场（这就是"自动更新"）
//   * 开关关着 -> 老老实实放上次那一场
//   * URL 里明确给了种子 -> 钉住那一场，开关关上
//   * 运行中跨日 -> 自己换场，并且仍然是"每日"
const realDaily = FW.rng.dailySeed;
const firstStore = fakeStore({});
const first = new App({ canvas: makeFakeCanvas(924, 691).canvas,
                        search: new URLSearchParams('w=924&h=691'), store: firstStore });
if (!first.dailyMode) loopProblems.push('第一次来应该进入"每日"');
if (first.seed !== String(realDaily())) loopProblems.push(`第一次来应放今天这一场，实际 ${first.seed}`);
if (firstStore.data.daily !== '1' || firstStore.data.seed !== first.seed) {
  loopProblems.push(`"每日"开关没落盘：${JSON.stringify(firstStore.data)}`);
}

// 开关开着，但存的是"昨天"那一场：开机就该换成今天这一场
FW.rng.dailySeed = () => 111111;                    // 假装"今天"是 111111
const staleDailyStore = fakeStore({ seed: '222222', daily: '1' });
const rolled = new App({ canvas: makeFakeCanvas(924, 691).canvas,
                         search: new URLSearchParams('w=924&h=691'), store: staleDailyStore });
if (rolled.seed !== '111111' || !rolled.dailyMode) {
  loopProblems.push(`"每日"没跟着日期换场：seed ${rolled.seed} / daily ${rolled.dailyMode}`);
}
if (staleDailyStore.data.seed !== '111111') {
  loopProblems.push('换场后没把新种子落盘：' + staleDailyStore.data.seed);
}

// 运行中跨日：checkDay() 自己换场，换完仍然是"每日"
FW.rng.dailySeed = () => 333333;
const rolledLive = rolled.checkDay();
if (!rolledLive || rolled.seed !== '333333' || !rolled.dailyMode) {
  loopProblems.push(`跨日没有自动换场：${rolledLive} / ${rolled.seed} / ${rolled.dailyMode}`);
}
if (rolled.checkDay()) loopProblems.push('同一天里不该反复换场');
// 暂停中不打扰；解除暂停后的第一拍才换
FW.rng.dailySeed = () => 444444;
rolled.paused = true;
if (rolled.checkDay() || rolled.seed !== '333333') {
  loopProblems.push('暂停中不该自动换场');
}
rolled.paused = false;
if (!rolled.checkDay() || rolled.seed !== '444444') {
  loopProblems.push('解除暂停后应该换到新的一天');
}
FW.rng.dailySeed = () => 333333;

// 开关关着 / URL 明确给了种子：都不跟日期走
const pinnedStore = fakeStore({ seed: '42', daily: '0' });
const pinned = new App({ canvas: makeFakeCanvas(924, 691).canvas,
                         search: new URLSearchParams('w=924&h=691'), store: pinnedStore });
if (pinned.seed !== '42' || pinned.dailyMode) {
  loopProblems.push(`开关关着不该换场：${pinned.seed} / ${pinned.dailyMode}`);
}
const fromUrlStore = fakeStore({ seed: '222222', daily: '1' });
const fromUrl = new App({ canvas: makeFakeCanvas(924, 691).canvas,
                          search: new URLSearchParams('seed=42&w=924&h=691'), store: fromUrlStore });
if (fromUrl.seed !== '42' || fromUrl.dailyMode || fromUrlStore.data.daily !== '0') {
  loopProblems.push(`URL 明确给的种子应当钉住：${fromUrl.seed} / ${fromUrl.dailyMode}`);
}
// 「随机」和「每日」按钮分别关掉 / 打开这个开关
pinned.reseed();
if (pinned.dailyMode || pinnedStore.data.daily !== '0') loopProblems.push('「随机」没有关掉"每日"');
pinned.daily();
if (!pinned.dailyMode || pinnedStore.data.daily !== '1') loopProblems.push('「每日」没有打开开关');
// 重放不改开关（只是从头再放一遍）
pinned.rebuild(pinned.seed);
if (!pinned.dailyMode) loopProblems.push('「重放」不该关掉"每日"');
// 插播也不改开关
pinned.interlude();
if (!pinned.dailyMode || pinned.seed !== '333333') {
  loopProblems.push(`插播不该动"每日"或种子：${pinned.dailyMode} / ${pinned.seed}`);
}
FW.rng.dailySeed = realDaily;                       // 还原真实时钟

// 逐字符守卫（种子框只允许"数字"或"密语的正确前缀"）—— 彩蛋就靠它做反馈
const wrongFirst = (SECRET[0] === 'Q') ? 'Z' : 'Q';
const wrongMid = SECRET.slice(0, 1) + ((SECRET[1] === 'X') ? 'Y' : 'X');
const okTexts = ['', '0', '2024'];
for (let i = 0; i <= SECRET.length; i++) okTexts.push(SECRET.slice(0, i));
const badTexts = [wrongFirst, wrongMid, SECRET + 'A', 'T5', '1T', SECRET.slice(0, 2) + '5'];
for (const s of okTexts) {
  if (!FW.app.seedContentOk(s)) loopProblems.push(`种子框本该接受「${s}」`);
}
for (const s of badTexts) {
  if (FW.app.seedContentOk(s)) loopProblems.push(`种子框本该拒绝「${s}」`);
}

// 同一次插播也必须可复现（它同样消耗 rng，所以两次要走同一条路）
function eggRun() {
  const show = new FW.show.Show(924, 691, new FW.rng.Random('7'),
                                { maxGeos: FW.show.DEFAULT_GEOS });
  FW.show.build(show);
  show.interlude();
  for (let i = 0; i < 30; i++) show.step(i === 0 ? 0 : 1 / 60);
  return [show.lastGeos, show.elements.length, show.fireworks.length].join('|');
}
if (eggRun() !== eggRun()) loopProblems.push('同一个种子 + 同样一次插播不可复现');

// 2.5 渲染器抛异常要被 tick 兜住（onError），而不是把主循环打断
const boom = makeApp('seed=7&frames=10&w=924&h=691');
let caught = null;
boom.onError = (e) => { caught = e; };
boom.renderer.draw = () => { throw new Error('boom'); };
boom.tick(performance.now() + 20);
if (!caught) loopProblems.push('渲染异常没有被 onError 兜住');
if (!boom.crashed) loopProblems.push('异常后没有标记 crashed');

console.log('主循环自检（Node 里直接构造 App 并手动推帧）');
console.log('─'.repeat(76));
if (loopProblems.length) {
  for (const p of loopProblems) console.log('  ✗ ' + p);
} else {
  console.log(`  OK   定格 (N-1)/60 秒、60 帧推进 ${advanced.toFixed(3)}s、暂停不走、异常被兜住`);
  console.log(`  OK   数字种子照收、那个词不是种子、插播只多 2 发且不进链接/存储、逐字符守卫 ${okTexts.length} 收 / ${badTexts.length} 拒、"每日"开关跟着日期走、可复现`);
}
console.log('─'.repeat(76));
for (const p of loopProblems) problems.push(p);

/* ------------------------------------------------ 3) 调参面板的参数表 */

/**
 * 调参面板（src/tune.js + src/tune_ui.js）只做一件事：**原地改写**各模块里那些
 * 本来是常量的对象。所以这里守三条：
 *   ① 面板上每一行的默认值都必须正好落在滑条的格子上 —— 否则浏览器会把 value
 *      吸附到最近一格，一打开面板默认值就被悄悄挪走（还会被当成"改动"存下来）；
 *   ② 不改 = 行为逐位不变：复位之后跑出来的指纹必须与从没碰过时一模一样；
 *   ③ 只存/只导出"改过的那几项"，认不出的键一律忽略 —— 以后源码默认值改了，
 *      旧机器上那份记录也不会把它盖回去。
 */
const tuneProblems = [];
const T = FW.tune;

function tuneFingerprint() {
  const show = new FW.show.Show(924, 691, new FW.rng.Random(7),
                                { maxGeos: FW.show.DEFAULT_GEOS });
  FW.show.build(show);
  let h = 0;
  for (let i = 0; i < 180; i++) {
    show.step(i === 0 ? 0 : 1 / 60);
    h = (h * 31 + show.lastGeos + show.elements.length * 7 + show.frameGeos.length) % 1000000007;
  }
  return h;
}

// 3.1 默认值必须在格子上（面板一打开就不该是"改动过"的状态）
for (const c of T.controls()) {
  if (c.kind !== 'number') continue;
  const v = c.get(), x = (v - c.min) / c.step;
  if (!(v >= c.min && v <= c.max)) {
    tuneProblems.push(`${c.id} 默认值 ${v} 不在 [${c.min}, ${c.max}] 里`);
  } else if (Math.abs(x - Math.round(x)) > 1e-6) {
    tuneProblems.push(`${c.id} 默认值 ${v} 不在格子上（min ${c.min} / step ${c.step}）`);
  }
}

// 3.2 只有 ?tune=1 认账
global.location.search = '?seed=7';
if (T.wanted()) tuneProblems.push('没有 ?tune=1 时不该认调参');
global.location.search = '?tune=10';
if (T.wanted()) tuneProblems.push('?tune=10 不该被当成 ?tune=1');
global.location.search = '?seed=7&tune=1';
if (!T.wanted()) tuneProblems.push('?tune=1 时应当认调参');

// 3.3 默认状态下"一项都没改"；存储里认不出的键一律忽略
const tstore = fakeStore({});
if (T.changed() !== 0 || T.load(tstore) !== 0 || T.changed() !== 0) {
  tuneProblems.push('默认状态下不该有任何改动：' + T.diffJson());
}
const weirdStore = fakeStore({ tune: JSON.stringify({ 'nope.nope': 1, 'phys.flashLife': 'x' }) });
if (T.load(weirdStore) !== 0 || T.changed() !== 0) {
  tuneProblems.push('存储里认不出的键不该被采用：' + T.diffJson());
}

// 3.4 改一项：演出真的变、只导出/只落盘这一项
const defPrint = tuneFingerprint();
T.set('phys.flashLife', 0.5);
const oneDiff = JSON.parse(T.diffJson());
if (Object.keys(oneDiff).length !== 1 || oneDiff['phys.flashLife'] !== 0.5) {
  tuneProblems.push('改动清单不止一项：' + T.diffJson());
}
if (T.save(tstore) !== 1 || JSON.parse(tstore.data.tune)['phys.flashLife'] !== 0.5) {
  tuneProblems.push('落盘的不是"只改过的那一项"：' + tstore.data.tune);
}
if (tuneFingerprint() === defPrint) tuneProblems.push('改了参数但演出没有任何变化');

// 3.5 复位：回到与默认逐位一致，存储里的键也删掉
T.reset(tstore);
if (T.changed() !== 0 || tstore.data.tune !== undefined) {
  tuneProblems.push('复位没有清干净：' + JSON.stringify(tstore.data));
}
if (tuneFingerprint() !== defPrint) tuneProblems.push('复位之后没有回到与默认逐位一致');

// 3.6 存储里那份改动读得回来（重开页面走的就是这条路）
const d0 = T.get('styles.willow.life.1');
T.set('styles.willow.life.1', d0 + 0.4);
T.save(tstore);
T.set('styles.willow.life.1', d0);                    // 手动回默认，假装"新开的页面"
if (T.load(tstore) !== 1 || T.get('styles.willow.life.1') !== d0 + 0.4) {
  tuneProblems.push('存储里的改动没被读回来：' + tstore.data.tune);
}
T.reset(tstore);

// 3.7 "全部参数" JSON：往返 + 认不出的键忽略 + 解析失败不炸
if (Object.keys(JSON.parse(T.allJson())).length !== T.controls().length) {
  tuneProblems.push('"全部参数"漏了项：' + T.allJson().length);
}
const ar = T.applyJson(JSON.stringify({ 'phys.flashLife': 0.9, 'nope': 5 }));
if (ar.applied !== 1 || ar.ignored !== 1 || Math.abs(T.get('phys.flashLife') - 0.9) > 1e-9) {
  tuneProblems.push('applyJson 结果不对：' + JSON.stringify(ar));
}
if (T.applyJson('{oops').ignored !== -1) tuneProblems.push('JSON 解析失败应当报 -1');
T.reset(tstore);
if (T.changed() !== 0) tuneProblems.push('收尾没复位干净');
// 权重那几棵根也登记在案：复位要能一起清回去
FW.data.STYLE_W.spoke = 7;
FW.data.PALETTE_W.same = 99;
FW.show.ORCH.xBias = 2.5;
if (T.changed() !== 3) tuneProblems.push('权重不在参数表里（改动数 ' + T.changed() + '）');
T.reset(tstore);
if (T.changed() !== 0 || FW.data.STYLE_W.spoke !== 1
    || FW.data.PALETTE_W.same !== 30 || FW.show.ORCH.xBias !== 1) {
  tuneProblems.push('复位没有把权重清回默认');
}

// 3.8 分享链接里不带调参（别人打开必须是默认档）
const tuneApp = makeApp('seed=7&tune=1');
if (/tune/.test(tuneApp.shareUrl())) tuneProblems.push('分享链接里带了 tune：' + tuneApp.shareUrl());

// 3.9 权重（花型出现率 / 配色套路分量 / 落点偏好）：
//   * 默认档必须与改之前**等价**（花型走同一条 choice、配色阈值是同一个双精度数），
//     所以同一个种子还是同一场 —— 这条由 npm run baseline 全程守着，这里再点一下要害；
//   * 改了权重就是"换了一场"：0 要真的一次都不出现，重的要明显更多；
//   * 落点偏好默认 1 必须是**原样返回**（不能只是"看起来差不多"）。
{
  const r1 = new FW.rng.Random(7), r2 = new FW.rng.Random(7);
  let parity = true;
  for (let i = 0; i < 60 && parity; i++) {
    const a = FW.data.pickStyle(r1);
    const b = FW.data.STYLE_NAMES[r2.randbelow(FW.data.STYLE_NAMES.length)];
    if (a !== b) parity = false;
  }
  for (let i = 0; i < 20 && parity; i++) if (r1.random() !== r2.random()) parity = false;
  if (!parity) tuneProblems.push('默认权重下 pickStyle 与等概率 choice 不等价（会改掉同种子的那一场）');
}
{
  const W = FW.data.STYLE_W;
  W.spoke = 8; W.willow = 0;
  const rng = new FW.rng.Random(42), c = {};
  for (let i = 0; i < 800; i++) {
    const st = FW.data.pickStyle(rng);
    c[st] = (c[st] || 0) + 1;
  }
  const others = Math.max(c.cloud || 0, c.ring || 0, c.palm || 0);
  if (c.willow) tuneProblems.push(`权重 0 的垂柳还出现了 ${c.willow} 次`);
  if (!(c.spoke > others * 2)) {
    tuneProblems.push(`权重 8 的辐条没有明显更多：${JSON.stringify(c)}`);
  }
  Object.keys(W).forEach((k) => { W[k] = 0; });          // 全 0：退回等概率，别抽出空
  if (!FW.data.pickStyle(new FW.rng.Random(3))) tuneProblems.push('权重全 0 时应当退回等概率');
  Object.keys(W).forEach((k) => { W[k] = 1; });
}
{
  // 配色：默认 30/42/28 与原来的 0.30 / 0.72 必须是同一个双精度数
  if (30 / 100 !== 0.3 || 72 / 100 !== 0.72) {
    tuneProblems.push('配色的默认分量没有与原来的 0.30 / 0.72 重合');
  }
  const hueOf = (c) => {                                  // hsv() 返回的是 RGB，这里反推色相
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
    if (d === 0) return 0;
    let h;
    if (mx === c[0]) h = ((c[1] - c[2]) / d + 6) % 6;
    else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
    else h = (c[0] - c[1]) / d + 4;
    return h / 6;
  };
  const schemeOf = (p) => {                               // 同色系 / 冷暖撞色(±0.5) / 邻近色(+0.06~0.16)
    let d = hueOf(p.ray) - hueOf(p.dot);
    d -= Math.round(d);
    if (Math.abs(d) < 0.02) return 'same';
    if (Math.abs(Math.abs(d) - 0.5) < 0.15) return 'clash';
    return 'near';
  };
  const share = (n) => {
    const rng = new FW.rng.Random(9), c = { same: 0, clash: 0, near: 0 };
    for (let i = 0; i < n; i++) c[schemeOf(FW.data.randomPalette(rng))]++;
    return c;
  };
  const d0 = share(600);
  if (!(d0.same > d0.near && d0.clash > d0.near)) {
    tuneProblems.push('默认分量下三种套路的比例不对：' + JSON.stringify(d0));
  }
  const W = FW.data.PALETTE_W;
  W.same = 0; W.clash = 0; W.near = 100;
  const d1 = share(300);
  if (d1.same || d1.clash) {
    tuneProblems.push('把邻近色调到 100 之后不该再出别的套路：' + JSON.stringify(d1));
  }
  W.same = 30; W.clash = 42; W.near = 28;
}
{
  const O = FW.show.ORCH;
  const xMean = (b) => {
    O.xBias = b;
    const show = new FW.show.Show(924, 691, new FW.rng.Random(7), { maxGeos: FW.show.DEFAULT_GEOS });
    let sum = 0;
    for (let i = 0; i < 400; i++) sum += Math.abs(show.randomLaunch()[0][0]);
    return sum / 400;
  };
  const m1 = xMean(1), m3 = xMean(3), mHalf = xMean(0.5);
  O.xBias = 1;
  // 指数 1 = 均匀；>1 往中间收（平均 |x| 变小），<1 往两侧摊（变大）
  if (!(m3 < m1 && mHalf > m1)) {
    tuneProblems.push(`水平分布指数没起作用：3 -> ${m3.toFixed(1)} / 1 -> ${m1.toFixed(1)} / 0.5 -> ${mHalf.toFixed(1)}`);
  }
  const yMean = (b) => {
    O.yBias = b;
    const show = new FW.show.Show(924, 691, new FW.rng.Random(5), { maxGeos: FW.show.DEFAULT_GEOS });
    let sum = 0;
    for (let i = 0; i < 400; i++) sum += show.randomLaunch()[1][1];
    return sum / 400;
  };
  const y1 = yMean(1), y3 = yMean(3), yHalf = yMean(0.5);
  O.yBias = 1;
  if (!(y3 < y1 && yHalf > y1)) {
    tuneProblems.push(`高度分布指数没起作用：3 -> ${y3.toFixed(1)} / 1 -> ${y1.toFixed(1)} / 0.5 -> ${yHalf.toFixed(1)}`);
  }
  // bias = 1 必须是原样：第一个发射点要和 rng.uniform(-xSpread, xSpread) * w 完全相等
  const rA = new FW.rng.Random(11), rB = new FW.rng.Random(11);
  const sA = new FW.show.Show(924, 691, rA, { maxGeos: FW.show.DEFAULT_GEOS });
  rB.uniform(O.firstFinaleMin, O.firstFinaleMax);         // 对齐构造时消耗的那一次
  if (sA.randomLaunch()[0][0] !== rB.uniform(-O.xSpread, O.xSpread) * 924) {
    tuneProblems.push('xBias=1 时发射点与原来的公式不相等（默认档被改动了）');
  }
}

const starCount = T.controls().filter((c) => c.star).length;
console.log('调参面板自检（参数表 / 默认值 / 落盘 / 复位）');
console.log('─'.repeat(76));
if (tuneProblems.length) {
  for (const p of tuneProblems) console.log('  ✗ ' + p);
} else {
  console.log(`  OK   ${T.controls().length} 项参数（★ ${starCount} 项；花型那 12 条按选择器切换）默认值都在格子上；`
    + `复位后指纹 ${defPrint} 与默认逐位一致；只落盘改过的项、认不出的键忽略`);
}
console.log('─'.repeat(76));
for (const p of tuneProblems) problems.push(p);
global.location.search = '';

/* ------------------------------------------------ 结论 */

if (problems.length) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems.slice(0, 20)) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('结论：图元全部被识别、坐标/线宽/颜色合法、主循环行为符合预期 ✓');

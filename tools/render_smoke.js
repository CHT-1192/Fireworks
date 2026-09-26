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
// 峰值只要求"明显更高"：它是 60 秒里的单帧最大值，两种子撞在一起齐射就窜一下，
// 单种子抖动大（实测 1.3~1.6 倍）；均值才是稳定的信号（1.5 倍以上）。
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
  set(k, v) { this.data[k] = v; }
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

/* ------------------------------------------------ 结论 */

if (problems.length) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems.slice(0, 20)) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('结论：图元全部被识别、坐标/线宽/颜色合法、主循环行为符合预期 ✓');

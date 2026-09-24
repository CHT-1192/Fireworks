#!/usr/bin/env node
/* ============================================================================
 * baseline.js —— 行为基线回归（维护版的"安全带"）
 * ---------------------------------------------------------------------------
 * 这个项目已经不再以"完全忠于 Python 原版"为目标（那份代码受 turtle 限制、
 * 难维护），它是**维护版**：新特性都加在这里。于是"对不对"不能再用"和原版
 * 对拍"来定义 —— 那套对拍（tools/verify.js）退化为移植考古，只在确认移植本身
 * 有没有走样时才有意义。
 *
 * 维护版真正需要的是：**改东西时别无意中改别的东西**。所以这里给每个种子拍一份
 * "行为指纹"存进 baseline.json：
 *
 *   每帧指纹 = sha256( MT19937 全部 624 状态字 + 图元流 + 图元预算 + 元素数 )
 *
 *   * RNG 部分：任何一次 random/randint/uniform 的差异都会露出来
 *   * 图元流部分：颜色/坐标/线宽/折线段等**画面输出**的差异也会露出来
 *   （所以它同时覆盖物理与渲染；数值按 6 位小数取整，容忍 exp/hypot 的 1ulp 噪声）
 *
 * 用法：
 *   node tools/baseline.js            比对当前代码与基线（不需要 python3）
 *   node tools/baseline.js --update   重新录制基线，并列出与旧基线的差异
 *
 * 有意改行为（新特性）时：先跑一次确认"只有我预期的地方变了"，再 --update。
 * ==========================================================================*/
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { makeFakeCanvas, stubWindow, loadWithRenderer } = require('./fake_canvas');

const FILE = path.join(__dirname, 'baseline.json');
const DT = 1 / 60;
const W = 924;
const H = 691;
const FRAMES = 400;

/**
 * 覆盖到的种子。最后一组是那个词的插播片段（它不是种子，所以单独点名：
 * 只有这一组会额外调用 show.interlude()）。
 */
const SEEDS = ['7', '42', '123456'];

function cases() {
  const out = SEEDS.map((seed) => ({ seed }));
  out.push({ seed: '7', interlude: true, name: 'seed=7+插播' });
  return out;
}

// 渲染器也要被指纹覆盖：view.js 只依赖 window（设备像素比/视口）和一个 canvas
// 上下文，所以给它一个假 canvas 就能在 Node 里跑，把"这一帧下了哪些绘制指令"
// 一起摘进指纹 —— 否则改坏渲染器（变换/圆头/线宽）基线是发现不了的。
stubWindow(W, H);
const FW = loadWithRenderer();

/* ------------------------------------------------------------ 指纹计算 */

function num(v) { return typeof v === 'number' ? v.toFixed(6) : String(v); }

function ser(v) {
  if (Array.isArray(v)) return '[' + v.map(ser).join(',') + ']';
  return num(v);
}

/** 图元流：字段顺序固定，折线图元连每一段都进指纹。 */
function geoText(g) {
  return [g.shape, ser(g.color), num(g.x), num(g.y), num(g.heading),
          num(g.wid), num(g.leng), g.segs ? ser(g.segs) : ''].join('|');
}

function rngBytes(rng) {
  const buf = Buffer.allocUnsafe((rng.mt.length + 1) * 4);
  for (let i = 0; i < rng.mt.length; i++) buf.writeUInt32LE(rng.mt[i], i * 4);
  buf.writeUInt32LE(rng.mti, rng.mt.length * 4);
  return buf;
}

function runCase(cs) {
  const rng = new FW.rng.Random(cs.seed);
  const show = new FW.show.Show(W, H, rng, { maxGeos: FW.show.DEFAULT_GEOS });
  FW.show.build(show);
  if (cs.interlude) show.interlude();                   // 与 app.js 的插播路径一致
  const { canvas, ctx, problems } = makeFakeCanvas(W, H);
  const renderer = new FW.view.Renderer(canvas, 2);
  renderer.layout(W, H);

  const sig = [], geos = [], els = [], segs = [];
  for (let i = 0; i < FRAMES; i++) {
    show.step(i === 0 ? 0 : DT);
    ctx.beginFrame();
    renderer.draw(show.frameGeos);
    if (problems.length) {
      throw new Error(`${key(cs)} 第 ${i} 帧渲染参数非法: ${problems[0]}`);
    }
    const h = crypto.createHash('sha256');
    h.update(rngBytes(rng));                          // 随机数流
    for (const g of show.frameGeos) h.update(geoText(g));   // 图元流（画面内容）
    h.update(`${show.lastGeos}|${show.elements.length}|${ctx.frameDigest()}`);  // 预算/元素/绘制指令
    sig.push(h.digest('hex').slice(0, 8));
    geos.push(show.lastGeos);
    els.push(show.elements.length);
    segs.push(renderer.segs);
  }
  return { sig: sig.join(''), geos: geos.join(','), els: els.join(','), segs: segs.join(',') };
}

function key(cs) { return cs.name || `seed=${cs.seed}`; }

function collect() {
  const out = { note: '行为基线：每帧指纹 = sha256(RNG 624 状态字 + 图元流 + 预算/元素数 + 渲染绘制指令)，取前 8 位十六进制',
                dt: DT, width: W, height: H,
                maxGeos: FW.show.DEFAULT_GEOS, frames: FRAMES, cases: {} };
  for (const cs of cases()) out.cases[key(cs)] = runCase(cs);
  return out;
}

/** 每帧指纹块大小为 8 个十六进制字符，据此定位第一处不同。 */
function firstDiff(a, b) {
  if (a === b) return -1;
  const n = Math.max(a.length, b.length) / 8;
  for (let i = 0; i < n; i++) {
    if (a.slice(i * 8, i * 8 + 8) !== b.slice(i * 8, i * 8 + 8)) return i;
  }
  return -2;                                  // 长度不一致但前缀相同
}

function peak(s) {
  return s.split(',').reduce((m, v) => Math.max(m, Number(v) || 0), 0);
}

/* ------------------------------------------------------------------ main */

function main() {
  const update = process.argv.includes('--update');
  const cur = collect();
  const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;

  if (update) {
    const changed = [];
    if (old) {
      for (const k of Object.keys(cur.cases)) {
        const a = old.cases[k], b = cur.cases[k];
        if (!a) { changed.push([k, '新增']); continue; }
        const f = firstDiff(a.sig, b.sig);
        if (f >= 0) changed.push([k, `第 ${f} 帧起行为变化`]);
      }
      for (const k of Object.keys(old.cases)) if (!cur.cases[k]) changed.push([k, '移除']);
    }
    fs.writeFileSync(FILE, JSON.stringify(cur, null, 1) + '\n');
    console.log(`基线已${old ? '更新' : '录制'}: tools/baseline.json`
      + `（${Object.keys(cur.cases).length} 组 × ${FRAMES} 帧，`
      + `${(fs.statSync(FILE).size / 1024).toFixed(0)} KB）`);
    if (changed.length) {
      console.log('与旧基线的差异：');
      for (const [k, what] of changed) console.log(`  ~ ${k.padEnd(28)} ${what}`);
    } else if (old) {
      console.log('与旧基线完全一致（这次 --update 没有改动任何行为）。');
    }
    return 0;
  }

  if (!old) {
    console.error('还没有基线文件。先跑：node tools/baseline.js --update');
    return 1;
  }

  console.log(`行为基线回归（${Object.keys(cur.cases).length} 组 × ${FRAMES} 帧，`
    + '每帧比对 RNG 状态 + 图元流指纹）');
  console.log('─'.repeat(78));
  let bad = 0;
  for (const k of Object.keys(cur.cases)) {
    const a = old.cases[k], b = cur.cases[k];
    const f = a ? firstDiff(a.sig, b.sig) : -1;
    if (!a) {
      bad++;
      console.log(` FAIL  ${k.padEnd(28)} 基线里没有这一组（新种子？需要 --update）`);
    } else if (f >= 0) {
      bad++;
      console.log(` FAIL  ${k.padEnd(28)} 第 ${f} 帧起行为变化`
        + `  (预算 ${a.geos.split(',')[f]} → ${b.geos.split(',')[f]}，`
        + `元素 ${a.els.split(',')[f]} → ${b.els.split(',')[f]}，`
        + `线段 ${(a.segs || '').split(',')[f]} → ${b.segs.split(',')[f]})`);
    } else if (a.geos !== b.geos || a.els !== b.els || a.segs !== b.segs) {
      bad++;
      console.log(` FAIL  ${k.padEnd(28)} 指纹相同但计数不同（不该发生）`);
    } else {
      console.log(`  OK   ${k.padEnd(28)} ${FRAMES} 帧一致`
        + `   预算峰值 ${peak(b.geos)}，元素峰值 ${peak(b.els)}，线段峰值 ${peak(b.segs)}`);
    }
  }
  for (const k of Object.keys(old.cases)) {
    if (!cur.cases[k]) { bad++; console.log(` FAIL  ${k.padEnd(28)} 基线里有、代码里没了`); }
  }
  console.log('─'.repeat(78));
  if (bad) {
    console.log(`结论：${bad} 组行为变化。若是有意为之（新特性），跑 npm run baseline:update 重新录制。`);
  } else {
    console.log('结论：行为与基线完全一致 ✓');
  }
  return bad ? 1 : 0;
}

process.exit(main());

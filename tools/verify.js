#!/usr/bin/env node
/* ============================================================================
 * verify.js —— 复刻校验：JS 版 vs 原版 Python
 * ---------------------------------------------------------------------------
 * 1) RNG 逐位对拍：tools/dump_rng.py / dump_rng.js，要求完全相等（===）。
 * 2) 精确模式逐帧对拍：同 scene/seed 跑固定 1/60 步长，比较每一帧的图元列表
 *    （形状/颜色/位置/朝向/尺寸），容差 1e-9 —— 因为 math.exp / math.hypot 在
 *    libm 与 V8 之间可能差 1ulp。
 * 3) 增强模式对拍：canvas 把尾迹画成细采样折线（比原版的图章预算密得多），
 *    这里比较**每帧 MT19937 的全部 624 个状态字 + 下标**的摘要 —— 只要有一次
 *    random/randint/uniform 的差异就会暴露。摘要全等 = 同一场烟花，
 *    证明"画得更细"完全没有动到物理与随机数。
 * 用法：node tools/verify.js [--frames 90] [--seeds 7,42]
 * ==========================================================================*/
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = __dirname;
const TOL = 1e-9;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: path.join(HERE, '..'), encoding: 'utf8',
                                   maxBuffer: 1 << 30 });
  if (r.status !== 0) {
    console.error(`[FAIL] ${cmd} ${args.join(' ')}\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  return r.stdout;
}

function tmp(name) { return path.join(os.tmpdir(), `fw_verify_${name}`); }

/* --------------------------------------------------------------- 1) RNG */

function verifyRng() {
  const py = JSON.parse(run('python3', [path.join(HERE, 'dump_rng.py')]));
  const js = JSON.parse(run('node', [path.join(HERE, 'dump_rng.js')]));
  let bad = 0, total = 0;
  for (const key of Object.keys(py)) {
    const a = py[key], b = js[key];
    if (a.length !== b.length) { bad++; continue; }
    for (let i = 0; i < a.length; i++) {
      total++;
      if (a[i] !== b[i]) {
        bad++;
        if (bad <= 3) console.error(`   seed ${key} 第 ${i} 个取值不同: py=${a[i]} js=${b[i]}`);
      }
    }
  }
  return { name: 'RNG 逐位对拍', total, bad, note: `${Object.keys(py).length} 个 seed` };
}

/* ------------------------------------------------ 2) 精确模式 / 3) 增强模式 */

const FIELDS = ['shape', 'r', 'g', 'b', 'x', 'y', 'heading', 'wid', 'leng'];

function close(a, b) {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  const d = Math.abs(a - b);
  return d <= TOL || d <= TOL * Math.max(Math.abs(a), Math.abs(b));
}

function dumpOne(scene, seed, frames, dense) {
  const file = tmp(`${scene}_${seed}_${dense ? 'dense' : 'py'}.json`);
  const args = ['--scene', scene, '--seed', String(seed), '--frames', String(frames),
                '--out', file];
  run('python3', [path.join(HERE, 'dump_geo.py')].concat(args));
  const py = JSON.parse(fs.readFileSync(file, 'utf8'));
  const jsFile = tmp(`${scene}_${seed}_${dense ? 'densejs' : 'js'}.json`);
  const jsArgs = args.slice(0, -2).concat(['--out', jsFile]);
  if (dense) jsArgs.push('--dense', '1');
  run('node', [path.join(HERE, 'dump_geo.js')].concat(jsArgs));
  return { py, js: JSON.parse(fs.readFileSync(jsFile, 'utf8')) };
}

function verifyScene(scene, seed, frames) {
  const exact = dumpOne(scene, seed, frames, false);
  let total = 0, bad = 0, maxDiff = 0, shown = 0;
  const nFrames = Math.min(exact.py.frames.length, exact.js.frames.length);
  if (exact.py.frames.length !== exact.js.frames.length) bad++;

  for (let f = 0; f < nFrames; f++) {
    const A = exact.py.frames[f], B = exact.js.frames[f];
    for (const key of ['lastGeos', 'elements', 'rng']) {
      total++;
      if (A[key] !== B[key]) {
        bad++;
        if (shown++ < 3) console.error(`   [${scene}/${seed}] 帧 ${f} ${key}: py=${A[key]} js=${B[key]}`);
      }
    }
    total++;
    if (!close(A.time, B.time)) { bad++; if (shown++ < 3) console.error(`   [${scene}/${seed}] 帧 ${f} time`); }
    total++;
    if (A.geos.length !== B.geos.length) {
      bad++;
      if (shown++ < 3) console.error(`   [${scene}/${seed}] 帧 ${f} 图元数: py=${A.geos.length} js=${B.geos.length}`);
      continue;
    }
    for (let g = 0; g < A.geos.length; g++) {
      for (let k = 0; k < FIELDS.length; k++) {
        total++;
        const a = A.geos[g][k], b = B.geos[g][k];
        if (!close(a, b)) {
          bad++;
          if (shown++ < 3) {
            console.error(`   [${scene}/${seed}] 帧 ${f} 图元 ${g} 字段 ${FIELDS[k]}: py=${a} js=${b}`);
          }
        } else if (typeof a === 'number') {
          maxDiff = Math.max(maxDiff, Math.abs(a - b));
        }
      }
    }
  }
  const exactRes = { name: `精确模式 ${scene} seed=${seed}`, total, bad,
                     note: `${nFrames} 帧, 最大数值偏差 ${maxDiff.toExponential(2)}` };

  // ---- 增强模式：只比"决定演出"的量（RNG 状态摘要 + 预算 + 元素数） ----
  const dense = dumpOne(scene, seed, frames, true);
  let dTotal = 0, dBad = 0, maxSegs = 0, maxPyGeos = 0, denseFrames = 0, dShown = 0;
  const dFrames = Math.min(dense.py.frames.length, dense.js.frames.length);
  for (let f = 0; f < dFrames; f++) {
    const A = dense.py.frames[f], B = dense.js.frames[f];
    for (const key of ['rng', 'lastGeos', 'elements']) {
      dTotal++;
      if (A[key] !== B[key]) {
        dBad++;
        if (dShown++ < 3) console.error(`   [增强/${scene}/${seed}] 帧 ${f} ${key}: py=${A[key]} js=${B[key]}`);
      }
    }
    // 逐帧不变量：增强模式"实际画出来的图元数"（折线段 + 其它图元）不得少于原版。
    // 折线取代了原来的 N 段射线，段数只会更多 —— 这条能同时抓住"细采样没生效"
    // 和"某类图元被漏掉"。
    const drawn = B.geos.length + (B.denseSegs || 0);
    dTotal++;
    if (drawn < A.geos.length) {
      dBad++;
      if (dShown++ < 3) {
        console.error(`   [增强/${scene}/${seed}] 帧 ${f} 画出的图元(${drawn}) 少于原版(${A.geos.length})`);
      }
    }
    if (B.denseSegs > 0) { maxSegs = Math.max(maxSegs, B.denseSegs); denseFrames++; }
    maxPyGeos = Math.max(maxPyGeos, A.lastGeos);
  }
  let note;
  if (denseFrames === 0) {
    // 该场景没有可细采样的尾迹（如 original 的直线辐条 + 定线）：必须与原版逐图元一致
    for (let f = 0; f < dFrames; f++) {
      const A = dense.py.frames[f], B = dense.js.frames[f];
      dTotal++;
      if (A.geos.length !== B.geos.length) {
        dBad++;
        if (dShown++ < 3) console.error(`   [增强/${scene}/${seed}] 帧 ${f} 图元数不同`);
        continue;
      }
      for (let g = 0; g < A.geos.length; g++) {
        for (let k = 0; k < FIELDS.length; k++) {
          dTotal++;
          if (!close(A.geos[g][k], B.geos[g][k])) {
            dBad++;
            if (dShown++ < 3) console.error(`   [增强/${scene}/${seed}] 帧 ${f} 图元 ${g} ${FIELDS[k]}`);
          }
        }
      }
    }
    note = `${dFrames} 帧 RNG 状态全等；本场景无尾迹可细采样，逐图元与原版一致`;
  } else {
    note = `${dFrames} 帧 RNG 状态全等；${denseFrames} 帧有细采样尾迹，`
         + `最多 ${maxSegs} 段描边（原版同场最多 ${maxPyGeos} 个图章）`;
  }
  const denseRes = { name: `增强模式 ${scene} seed=${seed}`, total: dTotal, bad: dBad, note };
  return [exactRes, denseRes];
}

/* ------------------------------------------------------------------ main */

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : dflt;
}

const frames = Number(arg('frames', 90));
const seeds = arg('seeds', '7').split(',').map(Number);
const results = [verifyRng()];
const scenes = arg('scenes', 'classic,original,random').split(',');
for (const scene of scenes) {
  // original 场景的几何与 seed 无关（只有火花寿命跟着抖），随机场景多跑几个 seed
  const useSeeds = (scene === 'random') ? seeds : [seeds[0]];
  for (const s of useSeeds) results.push(...verifyScene(scene, s, frames));
}

console.log('\n复刻校验结果');
console.log('─'.repeat(84));
let failed = 0;
for (const r of results) {
  const ok = r.bad === 0;
  if (!ok) failed++;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${r.name.padEnd(26)} `
    + `${String(r.total - r.bad)}/${r.total} 项一致   ${r.note}`);
}
console.log('─'.repeat(84));
console.log(failed === 0
  ? '结论：与 Python 原版一致（RNG 精确相等、仿真 1e-9 容差内、增强模式不改变演出）'
  : `结论：${failed} 组不一致`);
process.exit(failed === 0 ? 0 : 1);

#!/usr/bin/env node
/* ============================================================================
 * rng_check.js —— 随机数与 CPython random.Random 逐位对拍
 * ---------------------------------------------------------------------------
 * 这是**特性**级校验，不是移植考古：src/rng.js 用的是 MT19937 + CPython 的
 * init_by_array 播种，所以 `?seed=7` 这样的种子可以跨语言分享、和 Python 那边
 * 放出同一串随机数。哪天有人动 rng.js，这个脚本负责保证它没被改坏。
 *
 * 需要 python3（只用标准库）。用法：node tools/rng_check.js
 * ==========================================================================*/
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const HERE = __dirname;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: path.join(HERE, '..'), encoding: 'utf8',
                                   maxBuffer: 1 << 24 });
  if (r.status !== 0) {
    console.error(`[FAIL] ${cmd} ${args.join(' ')}\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  return r.stdout;
}

function main() {
  let py, js;
  try {
    py = JSON.parse(run('python3', [path.join(HERE, 'dump_rng.py')]));
  } catch (err) {
    console.error('需要一个能跑 python3 的环境（只用标准库）。');
    return 1;
  }
  js = JSON.parse(run('node', [path.join(HERE, 'dump_rng.js')]));

  let total = 0, bad = 0;
  for (const key of Object.keys(py)) {
    const a = py[key], b = js[key];
    if (a.length !== b.length) { bad++; continue; }
    for (let i = 0; i < a.length; i++) {
      total++;
      if (a[i] !== b[i]) {
        bad++;
        if (bad <= 5) console.error(`  seed ${key} 第 ${i} 个取值不同: py=${a[i]} js=${b[i]}`);
      }
    }
  }
  console.log(`随机数逐位对拍（${Object.keys(py).length} 个 seed × ${total / Object.keys(py).length} 次调用）`);
  console.log('─'.repeat(60));
  console.log(bad === 0
    ? `  OK   ${total}/${total} 与 CPython 完全相同（seed 可跨语言复现）`
    : ` FAIL   ${bad}/${total} 不一致`);
  return bad ? 1 : 0;
}

process.exit(main());

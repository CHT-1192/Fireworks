#!/usr/bin/env node
/* 把 JS 版 Random 的取值序列导出成 JSON（协议与 tools/dump_rng.py 完全一致）。 */
'use strict';

const { loadSim } = require('./loader');
const FW = loadSim(["core.js", "rng.js"]);

const SEEDS = [0, 1, 2, 7, 42, 123456, 999999, -5];
const STYLES = ['spoke', 'cloud', 'ring', 'willow', 'palm'];

function sample(seed) {
  const r = new FW.rng.Random(seed);
  const out = [];
  for (let i = 0; i < 5; i++) out.push(r.random());
  for (let i = 0; i < 3; i++) out.push(r.randint(1, 100));
  for (let i = 0; i < 3; i++) out.push(r.uniform(-1.0, 1.0));
  for (let i = 0; i < 3; i++) out.push(STYLES.indexOf(r.choice(STYLES)));
  for (let i = 0; i < 20; i++) {
    out.push(r.random());
    out.push(r.randint(10, 13));
    out.push(r.uniform(140.0, 215.0));
    out.push(STYLES.indexOf(r.choice(STYLES)));
    out.push(r.randint(30, 44));
    out.push(r.uniform(-0.42, 1.0));
  }
  return out;
}

const data = {};
for (const s of SEEDS) data[String(s)] = sample(s);
process.stdout.write(JSON.stringify(data) + '\n');

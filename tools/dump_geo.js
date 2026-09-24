#!/usr/bin/env node
/* 把 JS 版仿真的逐帧图元导出成 JSON（协议与 tools/dump_geo.py 完全一致）。 */
'use strict';

const crypto = require('crypto');
const { loadSim } = require('./loader');
const FW = loadSim();

const DT = 1 / 60;

/** MT19937 全部 624 个状态字 + 下标 的摘要（与 tools/dump_geo.py 的字节布局一致）。 */
function rngDigest(rng) {
  const buf = Buffer.allocUnsafe((rng.mt.length + 1) * 4);
  for (let i = 0; i < rng.mt.length; i++) buf.writeUInt32LE(rng.mt[i], i * 4);
  buf.writeUInt32LE(rng.mti, rng.mt.length * 4);
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function parseArgs(argv) {
  const a = { scene: 'classic', seed: 7, frames: 90, width: 924, height: 691,
              maxGeos: 130, out: null, dense: false };
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, ''), v = argv[i + 1];
    if (k === 'scene') a.scene = v;
    else if (k === 'seed') a.seed = Number(v);
    else if (k === 'frames') a.frames = Number(v);
    else if (k === 'width') a.width = Number(v);
    else if (k === 'height') a.height = Number(v);
    else if (k === 'max-geos') a.maxGeos = Number(v);
    else if (k === 'dense') a.dense = (v === '1' || v === 'true');
    else if (k === 'out') a.out = v;
  }
  return a;
}

function pack(g) {
  const c = g.color;
  return [g.shape, c[0], c[1], c[2], g.x, g.y, g.heading, g.wid, g.leng];
}

const args = parseArgs(process.argv);
const rng = new FW.rng.Random(args.seed);
const show = new FW.show.Show(args.width, args.height, rng,
                              { maxGeos: args.maxGeos, denseTrails: args.dense });
FW.show.build(show, args.scene);

const frames = [];
function snapshot(i) {
  const geos = [];
  let segs = 0;
  for (const g of show.frameGeos) {
    if (g.segs) segs += g.segs.length; else geos.push(pack(g));
  }
  frames.push({ i, time: show.time, lastGeos: show.lastGeos, denseSegs: segs,
                elements: show.elements.length, rng: rngDigest(rng), geos });
}

show.step(0.0);
snapshot(0);
for (let i = 1; i < Math.max(1, args.frames); i++) {
  show.step(DT);
  snapshot(i);
}

const data = { scene: args.scene, seed: args.seed, width: args.width,
               height: args.height, dt: DT, frames };
const text = JSON.stringify(data);
if (args.out) require('fs').writeFileSync(args.out, text);
else process.stdout.write(text + '\n');

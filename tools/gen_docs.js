#!/usr/bin/env node
/* ============================================================================
 * gen_docs.js —— 从源码生成 docs/styles.md（花型参数表）
 * ---------------------------------------------------------------------------
 * 参数表手抄一定会过期，所以直接读 src/data.js 的 STYLES 生成。
 * 用法：npm run docs（改完花型跑一次）
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const { loadSim, ROOT } = require('./loader');

const FW = loadSim(['core.js', 'rng.js', 'data.js']);
const { STYLES, STYLE_NAMES, HALLOWEEN, MATRIX } = FW.data;

/** 参数的展示名与单位。顺序 = 生成的列顺序。 */
const FIELDS = [
  ['count', '火花数', true],
  ['radius', '爆心半径', true],
  ['dot', '圆点半径', true],
  ['drag', '阻尼 drag', false],
  ['life', '寿命(秒)', true],
  ['gravity', '重力', false],
  ['jitter', '角度抖动', false],
  ['trail', '尾迹时长(秒)', false],
  ['trail_seg', '尾迹段数', false],
  ['ember', '余烬速率', false],
  ['float_up', '整体上飘', false],
  ['spread', '半径收窄', false]
];

const fmt = (v) => Array.isArray(v) ? `${v[0]}~${v[1]}` : String(v);

const cols = FIELDS.map(([, label]) => label);
const rows = STYLE_NAMES.map((name) => {
  const s = STYLES[name];
  return [name].concat(FIELDS.map(([key]) => (key in s ? fmt(s[key]) : '—')));
});

const hex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

const md = `# 花型参数表

<!-- 由 \`npm run docs\` 从 src/data.js 生成，不要手改；改花型后重跑一次。 -->

每个花型的参数是**区间**（发射时按 seed 在区间里随机取）或定值。
\`STYLES\` 里没写的键就是该花型不用它（表里显示 —）。

| ${['花型'].concat(cols).join(' | ')} |
|${['---'].concat(cols.map(() => '---')).join('|')}|
${rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n')}

## 参数含义

| 键 | 作用 |
| --- | --- |
| \`count\` | 一发烟花有几颗火星（区间） |
| \`radius\` | 爆心半径：阻尼模型下最终半径 ≈ v/k，所以它同时决定初速 |
| \`dot\` | 圆点半径 |
| \`drag\` | 空气阻尼系数 k（越大越快停在半空） |
| \`life\` | 寿命（秒） |
| \`gravity\` | 重力（叠加在阻尼之后，决定下落） |
| \`jitter\` | 角度分层抖动比例：360° 均分后每颗在自己扇区里抖动多少 |
| \`trail\` | 尾迹保留时长（秒）；缺省 = 不留尾迹 |
| \`trail_seg\` | 尾迹最多分几段（细采样上限 \`DENSE.spark\` 之内的预算提示） |
| \`ember\` | 每秒掉几颗余烬 |
| \`float_up\` | 整体上飘的初速（云团型用） |
| \`spread\` | 半径额外收窄比例（环型用） |

## 加一个花型

1. 在 \`src/data.js\` 的 \`STYLES\` 里加一项，照着上面挑参数；
2. 它会自动进随机池（\`STYLE_NAMES\` 由 \`Object.keys\` 得到）；
3. \`npm run docs\` 更新这张表，\`npm run smoke\` 确认图元都画得出来；
4. 有意改行为，所以 \`npm run baseline:update\` 重录行为基线。

**注意**：\`burst()\` 里取参数的顺序是固定的（同 seed 才放得出同一场），加参数时别重排。

## 固定配色

| 名字 | 圆点 dot | 射线 ray | 尾迹 stem | 爆心 core |
| --- | --- | --- | --- | --- |
| halloween | \`${hex(HALLOWEEN.dot)}\` | \`${hex(HALLOWEEN.ray)}\` | \`${hex(HALLOWEEN.stem)}\` | \`${hex(HALLOWEEN.core)}\` |
| matrix | \`${hex(MATRIX.dot)}\` | \`${hex(MATRIX.ray)}\` | \`${hex(MATRIX.stem)}\` | \`${hex(MATRIX.core)}\` |
| random | 由 \`randomPalette()\` 随机（同色系 / 冷暖撞色 / 邻近色） | | | |

（halloween 与 matrix 就是参考图左右两发的配色。）
`;

const out = path.join(ROOT, 'docs', 'styles.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md);
console.log(`已生成 docs/styles.md（${STYLE_NAMES.length} 个花型，${md.split('\n').length} 行）`);

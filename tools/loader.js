/* ============================================================================
 * loader.js —— 在 Node 里按 manifest 顺序加载 src/ 下的 IIFE 模块。
 * 这些模块只写 globalThis.FW，不碰 DOM，所以能直接跑在 Node 里做复刻校验。
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/** 只加载纯计算模块（有 DOM 的 view/app 不在此列）。 */
const SIM_FILES = ['core.js', 'rng.js', 'data.js', 'elements.js', 'trails.js', 'firework.js', 'show.js'];

function loadSim(files) {
  for (const file of (files || SIM_FILES)) {
    const full = path.join(ROOT, 'src', file);
    const code = fs.readFileSync(full, 'utf8');
    vm.runInThisContext(code, { filename: full });
  }
  return globalThis.FW;
}

module.exports = { ROOT, SIM_FILES, loadSim };

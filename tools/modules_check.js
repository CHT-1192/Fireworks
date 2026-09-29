#!/usr/bin/env node
/* ============================================================================
 * modules_check.js —— 模块加载自检：按 manifest 顺序把所有模块跑一遍，再点名关键接口
 * ---------------------------------------------------------------------------
 * 为什么需要它：**单文件版把所有模块串成一个 `<script>`**，所以任何一个模块在加载时
 * 抛错，后面的模块（包括 ui.js）就全都不执行 —— 页面一片空白，而多文件开发页却是好的。
 * 这个坑踩过两次：
 *
 *   1) sound_kit.js 里写成裸名 `Engine`（其实是 sound.js 内部函数）→ ReferenceError，
 *      产物里 App 根本没起来，而 dev 页正常；
 *   2) 搬代码时把 `gainFactor` 的定义弄丢了 → 只有发声音那一刻才会 TypeError。
 *
 * 所以这里做两件事：① 每个模块单独 try 一次，谁抛错就点名；② 检查关键接口/方法都还在
 * （丢定义、改名字、模块被漏掉，都会在这里现形）。
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));

/** 最小 DOM 桩：只要够这些模块"加载"就行（boot 不触发：readyState 停在 loading） */
function stubDom() {
  const noop = function () {};
  const el = () => ({
    style: {}, classList: { add: noop, remove: noop }, dataset: {},
    addEventListener: noop, removeEventListener: noop, setAttribute: noop,
    getAttribute: () => null, appendChild: noop, removeChild: noop,
    querySelector: () => null, querySelectorAll: () => [], focus: noop, blur: noop
  });
  global.window = {
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    AudioContext: function () {}          // 只为 supported() 的存在判断
  };
  global.document = {
    readyState: 'loading',                 // 关键：别让 ui.js 现在就 boot
    title: '', documentElement: el(), body: el(), activeElement: null,
    addEventListener: noop, removeEventListener: noop,
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: el
  };
  global.location = { href: 'https://example.test/Fireworks/', search: '' };
  // Node 自带 navigator（只有 getter），不用覆盖
  global.requestAnimationFrame = () => 0;
  global.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
}

/** 加载完必须存在的接口（模块没加载 / 抛错 / 名字写错都会在这里现形） */
const WANT = [
  'FW.core.toHex', 'FW.rng.Random', 'FW.rng.dailySeed', 'FW.data.STYLES', 'FW.data.drawnCost',
  'FW.elements.Spark', 'FW.elements.Ember', 'FW.elements.Trail',
  'FW.firework.Firework.prototype.burst', 'FW.show.Show.prototype.step', 'FW.show.build',
  'FW.show.Show.prototype.interlude', 'FW.show.Show.prototype.launchAt',
  'FW.view.Renderer.prototype.draw',
  'FW.app.App.prototype.syncPanel', 'FW.app.App.prototype.bindPanel',
  'FW.app.App.prototype.onShowEvent', 'FW.app.App.prototype.hud',
  'FW.ebml.writeTags', 'FW.record.Recorder.prototype.start', 'FW.pngmeta.addText',
  'FW.sound.Engine.prototype.ensure', 'FW.sound.Engine.prototype.launch',
  'FW.sound.Engine.prototype.burst', 'FW.sound.Engine.prototype.event',
  'FW.sound.Engine.prototype.gainFactor', 'FW.sound.Engine.prototype.noise',
  'FW.sound.Engine.prototype.noiseHit', 'FW.sound.Engine.prototype.toneHit',
  'FW.sound.Engine.prototype.setEnabled', 'FW.sound.Engine.prototype.stream',
  'FW.app.App.prototype.setSound', 'FW.app.App.prototype.bindSound',
  'FW.app.App.prototype.savePng', 'FW.app.App.prototype.copyLink',
  'FW.app.App.prototype.startRecord', 'FW.app.App.prototype.stopRecord',
  'FW.app.App.prototype.say', 'FW.app.App.prototype.pauseAndSay',
  'FW.app.App.prototype.gesture', 'FW.app.App.prototype.bindReducedMotion',
  'FW.app.App.prototype.setReduceMotion', 'FW.app.App.prototype.motionNote'
];

stubDom();
const loadProblems = [];
for (const f of manifest.files) {
  try {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'),
                        { filename: 'src/' + f });
  } catch (e) {
    loadProblems.push(`${f} 加载就抛错：${e.name}: ${e.message}`);
  }
}

const missing = [];
for (const p of WANT) {
  let cur = global;
  for (const part of p.split('.')) cur = cur === undefined || cur === null ? undefined : cur[part];
  if (cur === undefined) missing.push(p);
}

console.log(`模块加载自检（${manifest.files.length} 个模块，按 manifest 顺序）`);
console.log('─'.repeat(76));
if (loadProblems.length) for (const p of loadProblems) console.log('  ✗ ' + p);
if (missing.length) for (const p of missing) console.log('  ✗ 少了接口：' + p);
if (!loadProblems.length && !missing.length) {
  console.log(`  OK   ${manifest.files.length} 个模块全部加载成功，${WANT.length} 个接口都在`);
}
console.log('─'.repeat(76));
if (loadProblems.length || missing.length) {
  console.error('模块加载自检失败 —— 单文件版会因此整片空白，别提交。');
  process.exit(1);
}

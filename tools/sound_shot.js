#!/usr/bin/env node
/* ============================================================================
 * sound_shot.js —— 把合成音渲染成 WAV，并量出它的"形状"（对着真实录音调音效用）
 * ---------------------------------------------------------------------------
 *   node tools/sound_shot.js --which launch              # 渲染发射音并量一遍
 *   node tools/sound_shot.js --which burst --png /tmp/b.png
 *   node tools/sound_shot.js --ref "~/Movies/xxx.mp4"    # 真实录音也量一遍（要 ffmpeg）
 *
 * 渲染走浏览器的 OfflineAudioContext（Web Audio 的节点只有浏览器里有）；量的是
 * 包络（起音/衰减 dB/s/收尾时间）与频段分布 + 谱心 —— 和 --ref 用同一套指标，
 * 所以两行输出可以直接对着看。
 *
 * 为什么要这么量：音效"质感"其实是可测的 —— 起音多快、衰减多陡、能量落在哪些
 * 频段、高频是不是先死。照着真实录音把这几个数对上，听感就接近了。
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const pw = require('./pw');

const PORT = Number(process.env.PORT) || 9240;
const BASE = `http://127.0.0.1:${PORT}`;

function parseArgs(argv) {
  const a = { which: 'launch', out: null, ref: null, png: null, secs: 2.5, crisp: undefined };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--which') a.which = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--ref') a.ref = argv[++i];
    else if (k === '--png') a.png = argv[++i];
    else if (k === '--secs') a.secs = Number(argv[++i]);
    else if (k === '--crisp') a.crisp = Number(argv[++i]);
  }
  return a;
}

/* --------------------------------------------------------------- 分析 */

const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));

/** 读 16bit 单声道 WAV → Float32（手写，环境里没有 numpy/音频库） */
function readWav(file) {
  const buf = fs.readFileSync(file);
  let off = 12, dataOff = 0, dataLen = 0, rate = 48000;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(off + 12);
    if (id === 'data') { dataOff = off + 8; dataLen = len; }
    off += 8 + len + (len % 2);
  }
  const n = Math.floor(dataLen / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
  return { x, rate };
}

/** 迭代 FFT（就地） */
function fft(re, im) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
}

/** 峰值附近与之后几个窗的频段能量 + 谱心 */
function bands(x, rate, at) {
  const N = 2048, i0 = Math.max(0, Math.min(x.length - N, Math.round(at * rate)));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[i0 + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  fft(re, im);
  const edges = [0, 500, 1000, 2000, 4000, 8000, 12000, 20000, 24000];
  const names = ['0-.5k', '.5-1k', '1-2k', '2-4k', '4-8k', '8-12k', '12-20k', '20k+'];
  const bin = rate / N;
  let tot = 0, cen = 0;
  const out = [];
  for (let b = 0; b < edges.length - 1; b++) {
    let e = 0;
    for (let k = Math.ceil(edges[b] / bin); k < Math.min(N / 2, edges[b + 1] / bin); k++) {
      const m = re[k] * re[k] + im[k] * im[k];
      e += m; tot += m; cen += m * k * bin;
    }
    out.push(e);
  }
  return { tot, cen: cen / Math.max(tot, 1e-12), names,
           parts: out.map((e, i) => [names[i], e / Math.max(tot, 1e-12)]) };
}

/**
 * 一行行地报：起音、衰减斜率(τ)、−20/−40/−60dB 时刻、包络、若干窗的频段分布与谱心。
 *
 * **时间原点用"起音"而不是"峰值"**：脉冲型声音（爆炸）的峰值位置会随参数在
 * "脆响"和"低频身体"之间跳，拿峰值当基准会让两次测量的频段根本不在同一时刻
 * —— 调参时被这个坑过一次。
 */
function analyze(label, x, rate) {
  const hop = Math.round(rate * 0.01);
  const env = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let s = 0;
    for (let j = 0; j < hop; j++) s += x[i + j] * x[i + j];
    env.push(Math.sqrt(s / hop));
  }
  const peak = Math.max(...env);
  if (!(peak > 1e-6)) { console.log(`${label}: 全是静音`); return; }
  const iPeak = env.indexOf(peak);
  const peakDb = db(peak);
  const iStart = env.findIndex((v) => v > peak * 0.05);          // 起音
  const t = (i) => (i - iStart) * 0.01;                          // 相对起音
  const t90 = (env.findIndex((v) => v > peak * 0.9) - iStart) * 0.01;
  const peakAt = t(iPeak);
  // 衰减斜率：峰值之后到峰值 −60dB 之间的点做最小二乘
  const pts = [];
  for (let i = iPeak; i < env.length; i++) {
    const v = db(env[i]) - peakDb;
    if (v < -60) break;
    if (v < 0) pts.push([t(i), v]);
  }
  const N = pts.length;
  const sx = pts.reduce((a, p) => a + p[0], 0), sy = pts.reduce((a, p) => a + p[1], 0);
  const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0), sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
  const slope = (N * sxy - sx * sy) / (N * sxx - sx * sx);
  const b0 = (sy - slope * sx) / N;
  const at = (rel) => ((rel - b0) / slope).toFixed(2);           // 相对峰值多少 dB 的时刻
  console.log(`${label}: ${(x.length / rate).toFixed(2)}s · 峰值 ${peakDb.toFixed(1)}dB @ 起音+${peakAt.toFixed(2)}s`
    + ` · 起音→90% ${(t90 * 1000).toFixed(0)}ms`);
  console.log(`   衰减 ${slope.toFixed(1)} dB/s（τ≈${(-8.686 / slope).toFixed(3)}s）`
    + ` · −20dB @ 起音+${at(-20)}s · −40dB @ +${at(-40)}s · −60dB @ +${at(-60)}s`);
  const envRel = [];
  for (let k = 0; k < 30; k++) {
    const i = iStart + k * 5;                                    // 每格 0.05s
    if (i >= env.length) break;
    envRel.push((db(env[i]) - peakDb).toFixed(0));
  }
  console.log('   包络(0.05s/格, 相对峰值 dB, 1.5s): ' + envRel.join(' '));
  for (const dt of [0, 0.03, 0.08, 0.15, 0.3, 0.6]) {            // 相对**起音**
    const b = bands(x, rate, (iStart * 0.01) + dt);
    if (b.tot < 1e-12) continue;
    console.log(`   @起音+${dt.toFixed(2)}s 谱心 ${b.cen.toFixed(0)}Hz · `
      + b.parts.filter(([, f]) => f > 0.01).map(([n2, f]) => `${n2} ${(f * 100).toFixed(0)}%`).join(' '));
  }
}

/* --------------------------------------------------- 参考录音（要 ffmpeg） */

function analyzeRef(ref) {
  const src = ref.replace(/^~/, os.homedir());
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    console.log('（没有 ffmpeg，跳过 --ref）');
    return;
  }
  const wav = path.join(os.tmpdir(), 'sound-shot-ref.wav');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-ac', '1', '-ar', '48000', wav]);
  const { x, rate } = readWav(wav);
  analyze('参考 ' + path.basename(src), x, rate);
}

/* ------------------------------------------------------- 渲染合成音（浏览器） */

/** 在页面里离线渲染成 WAV（要传给 page.evaluate，所以必须是顶层真的函数） */
async function renderInPage(arg) {
  const ctx = new OfflineAudioContext(1, Math.round(48000 * arg.secs), 48000);
  const eng = new FW.sound.Engine({ context: ctx, enabled: true });   // 用线上同档的电平（0.2）
  eng.ensure();
  if (arg.which === 'launch') eng.launch();
  else eng.burst({ radius: 200, count: 30, crisp: arg.crisp });
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  const ab = new ArrayBuffer(44 + d.length * 2);
  const dv = new DataView(ab);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 48000, true); dv.setUint32(28, 96000, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) {
    const v = Math.max(-1, Math.min(1, d[i]));
    dv.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  const u8 = new Uint8Array(ab);
  let out = '';
  for (let i = 0; i < u8.length; i += 8192) {
    out += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  }
  return btoa(out);
}

async function render(a) {
  const server = await pw.ensureServer(PORT);
  const browser = await pw.launch();
  try {
    const { page, logs } = await pw.openPage(browser, BASE + '/?seed=7&still=1');
    const b64 = await page.evaluate(renderInPage, { which: a.which, secs: a.secs, crisp: a.crisp });
    if (logs.length) console.log('（页面日志：' + logs.join(' | ').slice(0, 120) + '）');
    return Buffer.from(b64, 'base64');
  } finally {
    await browser.close();
    if (server) { try { server.kill('SIGKILL'); } catch (e) { /* 已退出 */ } }
  }
}

(async () => {
  const a = parseArgs(process.argv);
  if (a.ref) analyzeRef(a.ref);
  const wav = await render(a);
  const out = a.out || path.join(os.tmpdir(), `sound-${a.which}.wav`);
  fs.writeFileSync(out, wav);
  const { x, rate } = readWav(out);
  analyze(`合成 ${a.which}` + (a.out ? `（${a.out}）` : `（${out}）`), x, rate);
  if (a.png) {
    if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', out, '-filter_complex',
        'showwavespic=s=1200x220:colors=#ffd34d', '-frames:v', '1', a.png]);
      console.log(`波形图：${a.png}`);
    } else {
      console.log('（没有 ffmpeg，跳过 --png）');
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });

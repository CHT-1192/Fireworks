/* ============================================================================
 * rng.js —— MT19937，逐位对齐 CPython 的 random.Random
 * ---------------------------------------------------------------------------
 * 原版用 random.Random(seed) 决定整场演出的位置/颜色/寿命。这里把 Mersenne
 * Twister 和 CPython 的播种（init_by_array）一起搬过来，所以**同一个 seed 在
 * Python 与浏览器里放出的是同一场烟花**（tools/verify.js 会逐位校验）。
 *   random()  -> genrand_res53（两个 32bit 拼 53bit）
 *   randint / randrange / choice -> _randbelow_with_getrandbits
 * ==========================================================================*/
;(function (FW) {
  'use strict';

  var N = 624, M = 397;
  var MATRIX_A = 0x9908b0df, UPPER = 0x80000000, LOWER = 0x7fffffff;

  /** 整数种子（含任意长的数字串）-> init_by_array 的 key，与 CPython 完全一致。 */
  function seedToKey(value) {
    var v;
    if (typeof value === 'bigint') v = value;
    else {
      var text = String(value).trim();
      v = /^[+-]?\d+$/.test(text) ? BigInt(text)          // 大整数也精确，不经过 Number
                                  : BigInt(Math.trunc(Number(value)));
    }
    if (v < 0n) v = -v;                            // CPython 也取绝对值
    var key = [];
    if (v === 0n) key.push(0);                     // seed 0 -> key = [0]
    while (v > 0n) { key.push(Number(v & 0xffffffffn)); v >>= 32n; }
    return key;
  }

  /** 种子是不是"纯数字"（决定它与 CPython 逐位一致、以及用哪个场景）。 */
  function isNumericSeed(value) { return /^[+-]?\d+$/.test(String(value).trim()); }

  /**
   * 字母/文字种子 -> 32 位无符号整数（FNV-1a）。
   * 这是**本版自定义**的映射（Python 那边没有对应物）：同一个字符串永远得到同一个
   * 数字，所以字母种子同样可复现、可分享 —— 只是不再和 CPython 逐位对齐。
   */
  function hashSeed(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }


  function bitLength(n) {
    var k = 0;
    while (n > 0) { n = Math.floor(n / 2); k++; }
    return k;
  }

  function defaultSeed() { return 1 + Math.floor(Math.random() * 999999); }

  function Random(seed) {
    this.mt = new Uint32Array(N);
    this.mti = N + 1;
    this.seed(seed === undefined || seed === null ? defaultSeed() : seed);
  }

  /** 数字种子与 CPython 逐位一致；含字母的种子先 FNV-1a 哈希成数字再用。 */
  Random.prototype.seed = function (value) {
    var text = String(value).trim();
    this.initByArray(seedToKey(isNumericSeed(text) ? text : hashSeed(text)));
    return this;
  };

  Random.prototype.initGenrand = function (s) {
    var mt = this.mt;
    mt[0] = s >>> 0;
    for (var i = 1; i < N; i++) {
      var prev = mt[i - 1];
      mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    this.mti = N;
  };

  Random.prototype.initByArray = function (key) {
    var mt = this.mt, kl = key.length, i = 1, j = 0, k, prev;
    this.initGenrand(19650218);
    for (k = Math.max(N, kl); k; k--) {
      prev = mt[i - 1];
      mt[i] = ((mt[i] ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= kl) j = 0;
    }
    for (k = N - 1; k; k--) {
      prev = mt[i - 1];
      mt[i] = ((mt[i] ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  };

  /** MT19937 的 genrand_uint32：twist + temper。 */
  Random.prototype.genrandUint32 = function () {
    var mt = this.mt, y, kk;
    if (this.mti >= N) {
      if (this.mti === N + 1) this.initGenrand(5489);      // 兜底，正常播种不会走到
      for (kk = 0; kk < N - M; kk++) {
        y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0);
      }
      y = (mt[N - 1] & UPPER) | (mt[0] & LOWER);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0);
      this.mti = 0;
    }
    y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  };

  /** random.random() = genrand_res53。 */
  Random.prototype.random = function () {
    var a = this.genrandUint32() >>> 5;
    var b = this.genrandUint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  };

  /** getrandbits(k)：k<=32 与 CPython 完全一致；更大的 k 走 BigInt 精确拼装。 */
  Random.prototype.getrandbits = function (k) {
    if (k <= 0) throw new RangeError('number of bits must be greater than zero');
    if (k <= 32) return this.genrandUint32() >>> (32 - k);
    var acc = 0n, shift = 0n, left = k;
    while (left > 0) {
      var w = this.genrandUint32();
      if (left < 32) w >>>= (32 - left);
      acc |= BigInt(w) << shift;
      shift += 32n; left -= 32;
    }
    return Number(acc);
  };

  /** _randbelow_with_getrandbits：拒绝采样。 */
  Random.prototype.randbelow = function (n) {
    var k = bitLength(n), r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  };

  Random.prototype.randrange = function (a, b, step) {
    if (b === undefined) { b = a; a = 0; }
    step = step === undefined ? 1 : step;
    var width = Math.ceil((b - a) / step);
    return a + step * this.randbelow(width);
  };

  Random.prototype.randint = function (a, b) { return a + this.randbelow(b - a + 1); };

  Random.prototype.uniform = function (a, b) { return a + (b - a) * this.random(); };

  Random.prototype.choice = function (seq) { return seq[this.randbelow(seq.length)]; };

  FW.rng = { Random: Random, defaultSeed: defaultSeed,
             isNumericSeed: isNumericSeed, hashSeed: hashSeed };
})(globalThis.FW || (globalThis.FW = {}));

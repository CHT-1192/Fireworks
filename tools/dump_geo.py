#!/usr/bin/env python3
"""把原版 Python 仿真的逐帧图元导出成 JSON，供 tools/verify.js 与 JS 版对拍。

不画图、不开窗口：用一只"黑洞"画布接住 stamp/drop，只统计几何。
每帧记录 last_geos（含临死元素的图元数）、存活元素数，以及**存活元素**
这一帧的图元列表 —— 与 JS 版 Show.frameGeos 的口径完全一致。

用法：python3 tools/dump_geo.py --scene classic --seed 7 --frames 90
"""
import argparse
import hashlib
import importlib.util
import json
import os
import random
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, os.pardir, "reference", "turtle_fireworks.py")
DT = 1.0 / 60.0


class SinkCanvas:
    """只统计，不做任何光栅化（SoftwareCanvas 的 drop 是线性扫描，这里省掉）。"""

    def stamp(self, g):
        return None

    def drop(self, sid):
        pass


def load_reference():
    spec = importlib.util.spec_from_file_location("turtle_fireworks", REF)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def rng_digest(rng):
    """MT19937 全部 624 个状态字 + 下标 的摘要：逐帧比它就能证明随机数流完全一致
    （比逐个图元比对更强 —— 任何一次 random/randint/uniform 的差异都会暴露）。"""
    state = rng.getstate()[1]
    return hashlib.sha256(
        struct.pack("<%dI" % len(state), *[v & 0xFFFFFFFF for v in state])
    ).hexdigest()[:16]


def pack(g):
    return [g.shape, g.color[0], g.color[1], g.color[2],
            g.x, g.y, g.heading, g.wid, g.leng]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", default="classic",
                    choices=("classic", "random", "original"))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--frames", type=int, default=90)
    ap.add_argument("--width", type=int, default=924)
    ap.add_argument("--height", type=int, default=691)
    ap.add_argument("--max-geos", type=int, default=130)
    ap.add_argument("--out", default=None, help="输出文件（默认 stdout）")
    args = ap.parse_args()

    tf = load_reference()
    rng = random.Random(args.seed)
    show = tf.Show(SinkCanvas(), tf.BG, args.width, args.height, rng,
                   max_geos=args.max_geos)
    tf.build_show(show, args.scene)

    frames = []

    def snapshot(i):
        geos = []
        for e in show.elements:               # commit() 把本帧图元留在 e.prev 里
            for g in e.prev:
                geos.append(pack(g))
        frames.append({"i": i, "time": show.time, "lastGeos": show.last_geos,
                       "elements": len(show.elements), "rng": rng_digest(rng),
                       "geos": geos})

    show.step(0.0)                            # 先把初始几何画上（dt=0 不推进物理）
    snapshot(0)
    for i in range(1, max(1, args.frames)):
        show.step(DT)                         # 固定 60fps 步长
        snapshot(i)

    data = {"scene": args.scene, "seed": args.seed, "width": args.width,
            "height": args.height, "dt": DT, "frames": frames}
    text = json.dumps(data, separators=(",", ":"))
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

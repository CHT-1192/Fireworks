#!/usr/bin/env python3
"""把 CPython random.Random 的取值序列导出成 JSON，供 tools/verify.js 逐位比对。

调用序列对每个 seed 固定：random / randint / uniform / choice 交替，
覆盖 --randbelow（拒绝采样）与 --res53 两条路径。
"""
import json
import random
import sys

SEEDS = [0, 1, 2, 7, 42, 123456, 999999, -5]
STYLES = ("spoke", "cloud", "ring", "willow", "palm")


def sample(seed):
    r = random.Random(seed)
    out = []
    for _ in range(5):
        out.append(r.random())
    for _ in range(3):
        out.append(float(r.randint(1, 100)))
    for _ in range(3):
        out.append(r.uniform(-1.0, 1.0))
    for _ in range(3):
        out.append(float(STYLES.index(r.choice(STYLES))))
    for _ in range(20):
        out.append(r.random())
        out.append(float(r.randint(10, 13)))
        out.append(r.uniform(140.0, 215.0))
        out.append(float(STYLES.index(r.choice(STYLES))))
        out.append(float(r.randint(30, 44)))
        out.append(r.uniform(-0.42, 1.0))
    return out


def main():
    data = {str(s): sample(s) for s in SEEDS}
    json.dump(data, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

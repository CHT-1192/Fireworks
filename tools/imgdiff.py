#!/usr/bin/env python3
"""比较两张 PNG（原版软件光栅化 vs 浏览器 canvas 截图），用几个对边缘抗锯齿
不敏感的指标衡量构图是否一致：

  * 平均绝对误差（MAE，0-255）
  * 「亮像素」掩膜的 IoU：非背景像素算亮，衡量形状/位置是否对齐
  * 差异超阈值像素占比

不依赖 Pillow：自己解 PNG（只支持 8bit RGB/RGBA，正是两边都会产出的格式）。
用法：python3 tools/imgdiff.py a.png b.png [--tol 48]
"""
import argparse
import struct
import sys
import zlib


def read_png(path):
    with open(path, "rb") as fh:
        data = fh.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG: " + path
    pos, idat, w = 8, bytearray(), None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
            assert depth == 8 and ctype in (2, 6) and interlace == 0, "只支持 8bit RGB/RGBA"
            channels = 3 if ctype == 2 else 4
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
    raw = zlib.decompress(bytes(idat))
    stride = w * channels
    out = bytearray(w * h * 3)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        for i in range(stride):                     # 逐字节反滤波
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if f == 1:
                line[i] = (line[i] + a) & 0xFF
            elif f == 2:
                line[i] = (line[i] + b) & 0xFF
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        for x in range(w):
            j = (y * w + x) * 3
            k = x * channels
            out[j:j + 3] = line[k:k + 3]
        prev = line
    return w, h, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--tol", type=int, default=48, help="单像素差异阈值（0-255）")
    ap.add_argument("--bg", type=int, default=40, help="亮像素判定：通道最大值 > bg")
    args = ap.parse_args()

    wa, ha, pa = read_png(args.a)
    wb, hb, pb = read_png(args.b)
    if (wa, ha) != (wb, hb):
        print(f"尺寸不同: {wa}x{ha} vs {wb}x{hb}")
        return 1

    n = wa * ha
    total, bad, inter, union = 0, 0, 0, 0
    for i in range(0, len(pa), 3):
        d = 0
        for c in range(3):
            d = max(d, abs(pa[i + c] - pb[i + c]))
            total += abs(pa[i + c] - pb[i + c])
        if d > args.tol:
            bad += 1
        la = max(pa[i], pa[i + 1], pa[i + 2]) > args.bg
        lb = max(pb[i], pb[i + 1], pb[i + 2]) > args.bg
        if la and lb:
            inter += 1
        if la or lb:
            union += 1

    mae = total / (n * 3)
    iou = (inter / union) if union else 1.0
    print(f"尺寸 {wa}x{ha}  对比 {args.a} vs {args.b}")
    print(f"  平均绝对误差 MAE      : {mae:.2f} / 255")
    print(f"  超阈值({args.tol})像素占比 : {bad / n * 100:.2f}%")
    print(f"  亮像素 IoU            : {iou * 100:.2f}%   (交集 {inter} / 并集 {union})")
    ok = iou >= 0.95 and mae <= 6.0
    print("  结论: " + ("构图一致 ✓" if ok else "构图偏差偏大 ✗"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

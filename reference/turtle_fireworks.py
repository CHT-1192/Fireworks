#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
烟花 · Turtle Fireworks
=======================

参考图里的两发烟花：
  * 左：辐条形 —— 红色细射线 + 黄色大圆点 + 橙红色发射尾迹（万圣节配色）
  * 右：云团形 —— 纯绿圆点撒开 + 绿色发射尾迹（矩阵绿配色）

这里把它们做成一场**程序化生成**的烟花秀：配色、发射点、爆心、方向、
尺寸、射线数/点数、速度、重力、寿命、拖尾、余烬……全部随机生成。

实现要点
--------
1. 自定义 Turtle 形状（register_shape）
     fw_dot —— 单位圆（正 18 边形），用 shapesize(r, r) 缩放出任意大小的圆点
     fw_ray —— 从原点沿"乌龟正前方"伸出的单位矩形，用 shapesize(半厚度, 长度)
               拉伸、用 setheading() 旋转，就得到任意角度/长度/粗细的线段
   于是**一只乌龟**就能 stamp 出整场烟花的所有图元。

2. 尾迹 = 真实轨迹采样，不是"绷直的线"
   发射尾迹（Trail）和火花尾迹（Spark.track）都把**飞过的位置**按间隔记成
   一串点，再抽稀连成折线：每个点带出生时间，越旧越暗越细，尾巴先散。
   所以弹体横飘时，下面已经留下的尾迹不会被拖着转；火花开始下坠后，
   原本笔直的辐条会自己弯成一条落下的弧线。

3. 擦除：自定义形状"涂抹同一条路径"
   另一只"橡皮擦"乌龟用**背景色**的同一个自定义形状，按上一帧图元的位置/
   朝向/缩放（就是同一条路径）再盖一遍，把旧画面涂掉；下一帧再把这些橡皮
   图章 clearstamp 掉。画布上的图元数量因此是常数，不会无限堆积。

4. 动画：screen.tracer(0) + ontimer 驱动（按"帧开始时刻"排下一帧，帧率稳定），
   每帧固定顺序：
      丢弃上一帧图章 → 物理更新 → 橡皮沿旧路径涂抹 → 盖上本帧图章

5. 下落：每帧 v *= exp(-k·dt)（空气阻力）+ 重力，火花出膛后先减速再下坠。

6. 变暗：按"新鲜度"朝背景色淡出，末段随机闪烁（twinkle），圆点同时缩小，
   凉透即与夜空同色 = 熄灭。

用法
----
    python3 turtle_fireworks.py                     # 参考图风格开场，随后随机放
    python3 turtle_fireworks.py --scene original    # 原版复刻（按截图实测坐标/颜色）
    python3 turtle_fireworks.py --scene random --seed 7
    python3 turtle_fireworks.py --render still.png --frames 120
    python3 turtle_fireworks.py --render orig.png --scene original --frames 1   # 复刻图

    空格 暂停/继续    r 追加一发    Esc 退出
    觉得卡：--no-smear（省掉一半画布操作）或调小 --max-geos

种子与场景
----------
    * --scene original  完全按参考截图里量出来的坐标/颜色摆那两发：第 1 帧
                        就是原图（--render ... --frames 1 可直接对比），之后
                        火花照常飞散下坠变暗，变成会动的复刻版。
    * --scene classic   用同一套配色/花型参数开场，但几何是随机生成的。
    * --scene random    纯随机烟花秀。
    * --seed N          整场演出（位置/颜色/尺寸/数量/寿命全部）由它决定；
                        不给就随机挑一个并打印出来，窗口标题里也写着，
                        照这个号再跑就能复现同一场。original 的几何与种子无关。

注意：需要带 tkinter/turtle 的 Python。macOS 上 Homebrew 的 python3 常常没有
（brew install python-tk），python.org 官方版自带。用 --render 则不需要 tkinter。
"""

from __future__ import annotations

import argparse
import colorsys
import math
import random
import struct
import sys
import time
import zlib
from typing import NamedTuple, Optional, Sequence

try:                       # --render 离线渲染时不需要 tkinter
    import turtle
except Exception:          # pragma: no cover
    turtle = None


# ============================================================ 颜色小工具

Color = "tuple[float, float, float]"


def hsv(h: float, s: float, v: float) -> Color:
    """HSV(0..1) -> RGB(0..1)。"""
    return colorsys.hsv_to_rgb(h % 1.0, min(1.0, max(0.0, s)), min(1.0, max(0.0, v)))


BG: Color = hsv(2 / 3, 1.0, 0.125)          # 夜空背景，取自参考图 #000020


def fade(c: Color, k: float) -> Color:
    """
    变暗 = 朝背景色淡出（k=1 原色，k=0 与背景一模一样）。
    比单纯乘系数干净：将熄的火花不会在深蓝夜空上留一圈灰黑残影。
    """
    if k <= 0.0:
        return BG
    if k >= 1.0:
        return c
    return (BG[0] + (c[0] - BG[0]) * k,
            BG[1] + (c[1] - BG[1]) * k,
            BG[2] + (c[2] - BG[2]) * k)


def mix(a: Color, b: Color, t: float) -> Color:
    """两色线性插值。"""
    return (a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t)


def to_hex(c: Color) -> str:
    """RGB(0..1) -> '#rrggbb'；顺手夹掉越界/NaN，避免负亮度把颜色搞坏。"""
    out = []
    for v in c:
        if v != v or v < 0.0:          # NaN 或负值
            v = 0.0
        elif v > 1.0:
            v = 1.0
        out.append(int(round(v * 255)))
    return "#%02x%02x%02x" % tuple(out)


class Palette(NamedTuple):
    name: str
    dot: Color      # 火花圆点
    ray: Color      # 从爆心伸出的射线
    stem: Color     # 发射尾迹（最亮的那段）
    core: Color     # 爆炸瞬间的闪光


#: 参考图两发烟花的配色（颜色取自截图采样）
HALLOWEEN = Palette("halloween", dot=hsv(0.167, 1.0, 0.88), ray=hsv(0.003, 0.94, 0.88),
                    stem=hsv(0.031, 0.85, 0.94), core=hsv(0.10, 0.25, 1.0))
MATRIX = Palette("matrix", dot=hsv(1 / 3, 1.0, 1.0), ray=hsv(1 / 3, 1.0, 0.5),
                 stem=hsv(1 / 3, 1.0, 0.5), core=hsv(1 / 3, 0.2, 1.0))


# ============================================================ 原版复刻数据
# 下面这些坐标/颜色全部是从参考截图里逐像素量出来的（见注释里的换算），
# 用来在 --scene original 下把原图复刻出来：
#   屏幕像素坐标 = 原图像素 / 1.8701 - 中心；颜色取像素众数/最饱和值。

#: 左发的爆心（14 条射线的最小二乘交点）
ORIGINAL_LEFT_CENTER = (-233.9, 35.1)
#: 左发 14 个黄色圆点的实测位置
ORIGINAL_LEFT_DOTS = [
    (-395.7, 11.9), (-371.5, -71.8), (-319.3, -140.5), (-250.9, -157.4),
    (-176.1, -154.3), (-90.7, -124.9), (-55.7, -75.6), (-47.5, -9.9),
    (-56.9, 79.8), (-102.9, 152.0), (-171.4, 183.4), (-250.5, 190.5),
    (-337.2, 159.5), (-381.0, 97.3),
]
#: 左发发射尾迹：底 -> 顶（顶端落在爆心附近）
ORIGINAL_LEFT_STEM = ((-106.6, -343.4), (-210.4, 46.0))
#: 右发 33 个绿色圆点的实测位置
ORIGINAL_RIGHT_DOTS = [
    (35.8, 125.2), (66.3, 43.3), (82.3, 235.8), (78.6, 162.7),
    (100.5, 93.4), (124.0, 256.6), (131.4, 143.3), (137.1, 53.0),
    (120.1, -28.8), (198.4, 281.3), (159.3, 192.2), (194.6, 134.8),
    (176.5, 83.4), (167.9, 4.3), (234.1, 231.0), (235.0, 178.6),
    (228.7, 89.7), (245.7, -48.0), (278.8, 281.2), (289.8, 193.4),
    (273.9, 121.2), (253.1, 65.2), (289.7, 28.6), (251.8, 4.3),
    (314.2, 84.7), (316.6, -56.6), (367.9, 236.1), (353.5, 151.9),
    (353.3, 60.5), (350.9, -32.4), (411.8, 137.2), (409.6, 74.9),
    (387.3, -7.0),
]
#: 右发发射尾迹：底 -> 顶
ORIGINAL_RIGHT_STEM = ((87.7, -343.4), (218.0, -7.5))
#: 实测颜色（背景就是脚本里的 BG = #000020，直接从截图取的）
ORIGINAL_RAY = (1.0, 0.0, 0.01)                 # #ff0002 纯红
ORIGINAL_YELLOW = (0.882, 0.882, 0.0)           # #e1e100
ORIGINAL_GREEN = (0.0, 1.0, 0.0)                # #00ff00
ORIGINAL_STEM_LEFT = ((0.89, 0.30, 0.12), (0.82, 0.34, 0.22))    # 底 #e34d1f -> 顶 #d15738
ORIGINAL_STEM_RIGHT = ((0.05, 0.47, 0.09), (0.03, 0.42, 0.03))   # 底 #0d7817 -> 顶 #086b08
#: 实测尺寸：圆点直径 23.5px，射线粗 3.6px，尾迹粗 ~8px
ORIGINAL_DOT_R = 11.7
ORIGINAL_RAY_HALF = 1.8
ORIGINAL_STEM_HALF = (4.0, 3.7)


def random_palette(rng: random.Random) -> Palette:
    """随机配色：同色系 / 冷暖撞色 / 互补色，三种套路。"""
    h = rng.random()
    roll = rng.random()
    if roll < 0.30:                                     # 同色系（像参考图右边那发）
        dot = hsv(h, rng.uniform(0.85, 1.0), 1.0)
        ray = hsv(h, 1.0, rng.uniform(0.45, 0.72))
        stem = hsv(h, 1.0, rng.uniform(0.70, 0.95))
    elif roll < 0.72:                                   # 冷暖撞色（像参考图左边那发）
        dot = hsv(h, rng.uniform(0.85, 1.0), 1.0)
        ray = hsv(h + 0.5 + rng.uniform(-0.09, 0.09), 0.95, rng.uniform(0.72, 0.95))
        stem = hsv(h + rng.uniform(-0.05, 0.05), 1.0, rng.uniform(0.85, 1.0))
    else:                                               # 邻近色
        dot = hsv(h, rng.uniform(0.7, 1.0), 1.0)
        ray = hsv(h + rng.uniform(0.06, 0.16), 1.0, rng.uniform(0.6, 0.9))
        stem = hsv(h + rng.uniform(-0.10, -0.03), 1.0, 0.95)
    return Palette("random", dot, ray, stem, core=hsv(h, 0.18, 1.0))


# ============================================================ 自定义形状 + 图元

DOT = "fw_dot"
RAY = "fw_ray"
DOT_SIDES = 18

#: 单位圆点（半径 1），shapesize(r, r) 之后就是半径 r 的圆
DOT_PTS: tuple = tuple((math.cos(2 * math.pi * i / DOT_SIDES),
                        math.sin(2 * math.pi * i / DOT_SIDES)) for i in range(DOT_SIDES))
#: 单位线段：x∈[-1,1] 是粗细，y∈[0,1] 是长度。
#: Turtle 里形状的 +y 轴才是"乌龟正前方"，所以长度方向放在 y 上。
RAY_PTS: tuple = ((-1.0, 0.0), (1.0, 0.0), (1.0, 1.0), (-1.0, 1.0))
SHAPES = {DOT: DOT_PTS, RAY: RAY_PTS}


def register_shapes(screen) -> None:
    """把两个自定义形状注册进 Turtle 形状表。"""
    screen.register_shape(DOT, DOT_PTS)
    screen.register_shape(RAY, RAY_PTS)


class Geo(NamedTuple):
    """一个待绘制的图元：什么形状、什么颜色、放在哪、朝哪、拉多长多粗。"""
    shape: str
    color: Color
    x: float
    y: float
    heading: float = 0.0     # 度，0 = 向右，逆时针为正（同 turtle）
    wid: float = 1.0         # shapesize 的第一个参数（形状 x 方向）
    leng: float = 1.0        # shapesize 的第二个参数（形状 y 方向 = 朝向）


# ============================================================ 画布（Turtle / 软件）

class TurtleCanvas:
    """用一只隐藏的乌龟往画布上"盖章"：每个图元一个 stamp。"""

    def __init__(self, screen):
        self.t = turtle.RawTurtle(screen)
        self.t.hideturtle()
        self.t.penup()
        self.t.speed(0)
        self.t.resizemode("user")

    def stamp(self, g: Geo):
        t = self.t
        t.shape(g.shape)
        col = to_hex(g.color)
        t.color(col, col)
        t.shapesize(g.wid, g.leng, 1)
        t.setheading(g.heading)
        t.goto(g.x, g.y)
        return t.stamp()

    def drop(self, sid) -> None:
        if sid is not None:
            self.t.clearstamp(sid)


class Eraser:
    """橡皮擦乌龟：用背景色 + 同一个自定义形状，沿同一条路径涂一遍。"""

    def __init__(self, canvas, bg: Color, pad: float = 1.8):
        self.canvas = canvas
        self.bg = bg
        self.pad = pad          # 比原图元稍微放大一点，边缘不留残影

    def smear(self, g: Geo):
        return self.canvas.stamp(Geo(g.shape, self.bg, g.x, g.y, g.heading,
                                     g.wid + self.pad, g.leng + self.pad))

    def drop(self, sid) -> None:
        self.canvas.drop(sid)


class SoftwareCanvas:
    """
    与 TurtleCanvas 接口一致的软件画布：图元存在列表里，最后一次性光栅化成 PNG。
    它复刻了 turtle 的变换语义（形状坐标 -> 拉伸 -> 旋转 -> 平移，y 轴向上），
    所以 --render 出的图与窗口里看到的构图一致。
    """

    SS = 2                      # 2 倍超采样抗锯齿

    def __init__(self, width: int, height: int, bg: Color):
        self.w, self.h = width, height
        self.bg = bg
        self.items: list = []
        self._next = 0
        self._buf = bytearray(int(width * self.SS) * int(height * self.SS) * 3)
        r, g, b = (int(c * 255) for c in bg)
        for i in range(0, len(self._buf), 3):
            self._buf[i] = r
            self._buf[i + 1] = g
            self._buf[i + 2] = b

    def stamp(self, g: Geo):
        sid = self._next
        self._next += 1
        self.items.append((sid, g))
        return sid

    def drop(self, sid) -> None:
        for i, (s, _) in enumerate(self.items):
            if s == sid:
                del self.items[i]
                return

    # ---- 光栅化 -------------------------------------------------------
    def save(self, path: str) -> None:
        ss, w, h = self.SS, self.w, self.h
        buf = self._buf
        for _, g in self.items:                       # 按加入顺序画 = 画布层叠顺序
            rad = math.radians(g.heading)
            sn, cs = math.sin(rad), math.cos(rad)
            pts = []
            for sx, sy in SHAPES[g.shape]:
                X, Y = sx * g.wid, sy * g.leng
                px = g.x + sn * X + cs * Y            # turtle 内部变换（已实测）
                py = g.y - cs * X + sn * Y
                pts.append(((px + w / 2) * ss, (h / 2 - py) * ss))
            _fill_poly(buf, int(w * ss), int(h * ss), pts, g.color)
        # 超采样降采样
        out = bytearray(w * h * 3)
        big_w = int(w * ss)
        for y in range(h):
            for x in range(w):
                r = g_ = b = 0
                for dy in range(ss):
                    base = ((y * ss + dy) * big_w + x * ss) * 3
                    for dx in range(ss):
                        j = base + dx * 3
                        r += buf[j]
                        g_ += buf[j + 1]
                        b += buf[j + 2]
                n = ss * ss
                j = (y * w + x) * 3
                out[j] = r // n
                out[j + 1] = g_ // n
                out[j + 2] = b // n
        _write_png(path, w, h, out)


def _fill_poly(buf: bytearray, w: int, h: int, pts: Sequence, color: Color) -> None:
    """扫描线填充凸/凹多边形（偶奇规则）。"""
    n = len(pts)
    if n < 3:
        return
    r = min(255, max(0, int(color[0] * 255)))
    g = min(255, max(0, int(color[1] * 255)))
    b = min(255, max(0, int(color[2] * 255)))
    ys = [p[1] for p in pts]
    y0 = max(0, int(math.floor(min(ys))))
    y1 = min(h - 1, int(math.ceil(max(ys))))
    for y in range(y0, y1 + 1):
        yc = y + 0.5
        xs = []
        for i in range(n):
            xa, ya = pts[i]
            xb, yb = pts[(i + 1) % n]
            if (ya <= yc < yb) or (yb <= yc < ya):
                xs.append(xa + (yc - ya) * (xb - xa) / (yb - ya))
        if len(xs) < 2:
            continue
        xs.sort()
        row = y * w * 3
        for i in range(0, len(xs) - 1, 2):
            a = max(0, int(math.ceil(xs[i] - 0.5)))
            c = min(w - 1, int(math.floor(xs[i + 1] - 0.5)))
            for x in range(a, c + 1):
                j = row + x * 3
                buf[j] = r
                buf[j + 1] = g
                buf[j + 2] = b


def _write_png(path: str, w: int, h: int, rgb: bytes) -> None:
    """不依赖 Pillow 的最小 PNG 写出（8bit RGB）。"""
    raw = bytearray()
    for y in range(h):
        raw.append(0)                       # 每行滤波器 = None
        raw += rgb[y * w * 3:(y + 1) * w * 3]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


# ============================================================ 可擦除的元素

class Element:
    """
    画布上的一笔。自己负责"擦掉上一帧 / 画上这一帧"：
      prev    —— 上一帧的图元（擦除时按**同样的路径**涂抹背景色）
      drawn   —— 上一帧的图章 id（下一帧丢弃）
      smeared —— 上一帧的橡皮图章 id（下一帧丢弃）
    """

    def __init__(self, show: "Show"):
        self.show = show
        self.prev: list = []
        self.drawn: list = []
        self.smeared: list = []
        self.alive = True

    def discard(self) -> None:
        for sid in self.drawn:
            self.show.canvas.drop(sid)
        for sid in self.smeared:
            self.show.eraser.drop(sid)
        self.drawn = []
        self.smeared = []

    def erase(self) -> None:
        if self.show.smear and self.prev:
            self.smeared = [self.show.eraser.smear(g) for g in self.prev]
        self.prev = []

    def commit(self, geos: Sequence[Geo]) -> None:
        self.drawn = [self.show.canvas.stamp(g) for g in geos]
        self.prev = list(geos)

    def update(self, dt: float) -> None:      # 子类实现
        pass

    def frame(self) -> Sequence[Geo]:         # 子类实现
        return ()


# ============================================================ 各种火花

class Flash(Element):
    """爆心闪光：一瞬间撑开又消失的白点。"""

    def __init__(self, show: "Show", x: float, y: float, palette: Palette, size: float = 34.0):
        super().__init__(show)
        self.x, self.y = x, y
        self.size = size
        self.palette = palette
        self.age = 0.0
        self.life = 0.22

    def update(self, dt: float) -> None:
        self.age += dt
        if self.age >= self.life:
            self.alive = False

    def frame(self) -> Sequence[Geo]:
        k = max(0.0, 1.0 - self.age / self.life)        # 死亡那一帧 age 会略微超过 life
        r = max(0.5, self.size * (0.35 + 0.65 * k) * (k ** 0.5))   # 边暗边缩，收干净
        return (Geo(DOT, fade(self.palette.core, k ** 1.6), self.x, self.y, 0.0, r, r),)


class Ember(Element):
    """余烬：火花掉下来的小碎屑，会掉、会暗。"""

    def __init__(self, show: "Show", x: float, y: float, vx: float, vy: float,
                 color: Color, size: float, life: float):
        super().__init__(show)
        self.x, self.y = x, y
        self.vx, self.vy = vx, vy
        self.color = color
        self.size = size
        self.life = life
        self.age = 0.0
        self.twinkle = show.rng.random()

    def update(self, dt: float) -> None:
        self.age += dt
        self.vy -= 150.0 * dt
        self.vx *= math.exp(-0.8 * dt)
        self.x += self.vx * dt
        self.y += self.vy * dt
        if self.age >= self.life:
            self.alive = False

    def frame(self) -> Sequence[Geo]:
        k = max(0.0, 1.0 - self.age / self.life)
        if self.twinkle > 0.75:
            k *= 0.35 + 0.65 * abs(math.sin(self.age * 22.0))
        r = max(0.5, self.size * (0.4 + 0.6 * k))
        return (Geo(DOT, fade(self.color, k), self.x, self.y, 0.0, r, r),)


def decimate(pts: list, seg_max: int) -> list:
    """把一长串轨迹点均匀抽稀到最多 seg_max 段，控制每帧要盖多少图章。"""
    n = len(pts)
    if n <= seg_max + 1:
        return pts
    return [pts[round(i * (n - 1) / seg_max)] for i in range(seg_max + 1)]


class Spark(Element):
    """
    一发烟花里的一颗火星。画法：
      trail —— **真实轨迹**尾迹：把自己飞过的位置按间隔采样成一串点，
               再连成折线，越靠后越旧、越暗越细。
               所以它不是"从爆心拉到当前位置的一根绷直的线"（那样会像
               雨刷一样跟着火星扫），而是留在原地的一段拖尾：出膛时是笔直
               的辐条，火星开始下坠后拖尾就自己弯成弧线。
      dot   —— 当前点（永远有）
    """

    def __init__(self, show: "Show", x: float, y: float, vx: float, vy: float, *,
                 color: Color, trail_hot: Color, trail_cool: Color,
                 size: float, life: float, gravity: float, drag: float,
                 trail_time: float = 0.0, trail_seg: int = 3,
                 trail_step: float = 12.0, ember_rate: float = 0.0,
                 twinkle: bool = True):
        super().__init__(show)
        self.x, self.y = x, y
        self.vx, self.vy = vx, vy
        self.color = color
        self.trail_hot = trail_hot
        self.trail_cool = trail_cool
        self.size = size
        self.life = life
        self.age = 0.0
        self.gravity = gravity
        self.drag = drag
        self.trail_time = trail_time
        self.trail_seg = max(1, trail_seg)
        self.trail_step = trail_step
        self.ember_rate = ember_rate
        self.twinkle = twinkle
        self.ember_acc = 0.0
        # 轨迹采样：(x, y, 出生时刻)。第一个点就是爆心。
        self.track: list = [(x, y, show.time)] if trail_time > 0 else []

    def update(self, dt: float) -> None:
        self.age += dt
        now = self.show.time
        k = math.exp(-self.drag * dt)
        self.vx *= k
        self.vy = self.vy * k - self.gravity * dt
        self.x += self.vx * dt
        self.y += self.vy * dt

        if self.track:                            # 采样真实轨迹
            lx, ly, _ = self.track[-1]
            if math.hypot(self.x - lx, self.y - ly) >= self.trail_step:
                self.track.append((self.x, self.y, now))   # 够远了才记一个点
            while len(self.track) > 1 and now - self.track[0][2] > self.trail_time:
                self.track.pop(0)                          # 尾巴先散

        if self.ember_rate:                       # 掉余烬
            self.ember_acc += self.ember_rate * dt
            while self.ember_acc >= 1.0:
                self.ember_acc -= 1.0
                self.show.add(Ember(self.show, self.x, self.y,
                                    self.vx * 0.25 + self.show.rng.uniform(-14, 14),
                                    self.vy * 0.2 + self.show.rng.uniform(-10, 6),
                                    self.trail_hot, self.size * 0.42,
                                    self.show.rng.uniform(0.5, 1.3)))
        if self.age >= self.life:
            self.alive = False

    def frame(self) -> Sequence[Geo]:
        k = max(0.0, 1.0 - self.age / self.life)
        shade = k ** 0.8                          # 变暗曲线
        if self.twinkle and k < 0.34 and self.show.rng.random() < 0.35:
            shade *= self.show.rng.uniform(0.15, 1.0)      # 末期闪烁
        geos = []
        if self.track:
            now = self.show.time
            # 记录点 + 这一帧的"活头端"，保证尾迹始终连在火花身上
            pts = self.track + [(self.x, self.y, now)]
            q = decimate(pts, self.trail_seg)
            for (x0, y0, t0), (x1, y1, t1) in zip(q, q[1:]):
                d = math.hypot(x1 - x0, y1 - y0)
                if d < 0.4:
                    continue
                age = now - (t0 + t1) * 0.5
                fresh = max(0.0, 1.0 - age / self.trail_time) * (0.35 + 0.65 * shade)
                geos.append(Geo(RAY, mix(self.trail_cool, self.trail_hot, fresh),
                                x0, y0, math.degrees(math.atan2(y1 - y0, x1 - x0)),
                                max(0.5, self.size * 0.16 * (0.5 + 0.5 * fresh)), d))
        r = self.size * (0.55 + 0.45 * shade)
        geos.append(Geo(DOT, fade(self.color, shade), self.x, self.y, 0.0, r, r))
        return geos


class Rocket(Element):
    """上升的弹体：白热的头 + 身后一点火星。"""

    def __init__(self, show: "Show", firework: "Firework"):
        super().__init__(show)
        self.fw = firework

    def frame(self) -> Sequence[Geo]:
        fw = self.fw
        return (Geo(DOT, fw.palette.core, fw.x, fw.y, 0.0, 4.6, 4.6),
                Geo(DOT, fade(fw.palette.stem, 0.85),
                    fw.x - fw.vx * 0.02, fw.y - fw.vy * 0.02, 0.0, 3.0, 3.0))


class Trail(Element):
    """
    发射尾迹（参考图里最显眼的橙线/绿线）。
    把弹体**真实飞过的位置**一段段采样下来连成折线 —— 不是从发射架到弹体的
    一条绷直的线，所以弹体横飘时尾迹不会被"拖着转"，而是留在原地：
    下端是早就凉掉的旧料，头端是刚从弹体喷出的白热段。
    停止喂点（爆炸）之后，整条尾迹由尾巴先散，一路熄到弹体处。
    """

    def __init__(self, show: "Show", x: float, y: float, *, width: float,
                 hot: Color, cool: Color, fade_time: float = 3.4,
                 min_step: float = 9.0, seg_max: int = 6, max_pts: int = 80):
        super().__init__(show)
        self.pts: list = [(x, y, show.time)]        # 已经落下的轨迹点
        self.head = (x, y, show.time)               # 弹体当前所在（最新鲜的一段）
        self.width = width
        self.hot = hot
        self.cool = cool
        self.fade_time = fade_time
        self.min_step = min_step
        self.seg_max = seg_max
        self.max_pts = max_pts

    def push(self, x: float, y: float) -> None:
        """弹体飞到这里了：头端一直更新，离上一个记录点够远了才落一个新点。"""
        now = self.show.time
        self.head = (x, y, now)
        lx, ly, _ = self.pts[-1]
        if math.hypot(x - lx, y - ly) >= self.min_step:
            self.pts.append(self.head)
            if len(self.pts) > self.max_pts:
                self.pts.pop(0)

    def update(self, dt: float) -> None:
        now = self.show.time
        while len(self.pts) > 1 and now - self.pts[0][2] > self.fade_time:
            self.pts.pop(0)                    # 冷透的尾巴先掉
        if now - self.head[2] > self.fade_time and now - self.pts[0][2] > self.fade_time:
            self.alive = False                 # 整条都凉了

    def frame(self) -> Sequence[Geo]:
        pts = self.pts if self.head == self.pts[-1] else self.pts + [self.head]
        if len(pts) < 2:
            return ()
        now = self.show.time
        q = decimate(pts, self.seg_max)
        geos = []
        for (x0, y0, t0), (x1, y1, t1) in zip(q, q[1:]):
            d = math.hypot(x1 - x0, y1 - y0)
            if d < 0.6:
                continue
            fresh = max(0.0, 1.0 - (now - (t0 + t1) * 0.5) / self.fade_time)
            geos.append(Geo(RAY, mix(self.cool, self.hot, fresh), x0, y0,
                            math.degrees(math.atan2(y1 - y0, x1 - x0)),
                            max(0.5, self.width * (0.6 + 0.4 * fresh)), d))
        return geos


class FixedLine(Element):
    """
    钉在画布上的一段折线，颜色写死不动（复刻原图那两条发射尾迹用），
    到时间整条一起淡出。segs = [(x0, y0, x1, y1, color, 半宽), ...]
    """

    def __init__(self, show: "Show", segs: Sequence, life: float = 5.0, fade_pow: float = 0.7):
        super().__init__(show)
        self.segs = list(segs)
        self.life = life
        self.fade_pow = fade_pow
        self.age = 0.0

    def update(self, dt: float) -> None:
        self.age += dt
        if self.age >= self.life:
            self.alive = False

    def frame(self) -> Sequence[Geo]:
        k = max(0.0, min(1.0, 1.0 - self.age / self.life)) ** self.fade_pow
        geos = []
        for (x0, y0, x1, y1, col, half) in self.segs:
            d = math.hypot(x1 - x0, y1 - y0)
            if d < 0.5:
                continue
            geos.append(Geo(RAY, fade(col, k), x0, y0,
                            math.degrees(math.atan2(y1 - y0, x1 - x0)), half, d))
        return geos


def stem_segments(p0: tuple, p1: tuple, c0: Color, c1: Color,
                  half: float, n: int = 8) -> list:
    """把一条尾迹切成 n 段，给每段算一个渐变颜色（复刻原图用）。"""
    segs = []
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        x0 = p0[0] + (p1[0] - p0[0]) * t0
        y0 = p0[1] + (p1[1] - p0[1]) * t0
        x1 = p0[0] + (p1[0] - p0[0]) * t1
        y1 = p0[1] + (p1[1] - p0[1]) * t1
        segs.append((x0, y0, x1, y1, mix(c0, c1, (t0 + t1) * 0.5), half))
    return segs


# ============================================================ 一发烟花

#: 每种花型的参数区间（都是程序化随机取值的范围）
#: jitter    —— "角度分层"的抖动比例：把 360° 均分给 count 个火花，
#:              每个火花在自己的扇区里抖动 jitter×扇区宽，均匀又不呆板
#: trail     —— 尾迹保留时长（秒，0/缺省 = 不留尾迹）
#: trail_seg —— 尾迹最多分几段（图章预算）
STYLES = {
    "spoke": dict(count=(10, 13), radius=(140, 215), dot=(10.0, 12.0), drag=5.0,
                  life=(2.1, 3.0), gravity=95.0, jitter=0.18,
                  trail=2.4, trail_seg=2),
    "cloud": dict(count=(30, 44), radius=(120, 310), dot=(10.0, 12.0), drag=2.6,
                  life=(2.3, 3.6), gravity=70.0, jitter=0.42, float_up=26.0),
    "ring": dict(count=(22, 32), radius=(150, 205), dot=(8.5, 10.5), drag=3.4,
                 life=(1.9, 2.7), gravity=90.0, jitter=0.08, spread=0.06,
                 trail=1.7, trail_seg=2),
    "willow": dict(count=(14, 20), radius=(70, 150), dot=(7.5, 9.5), drag=2.0,
                   life=(2.6, 3.8), gravity=140.0, jitter=0.4,
                   trail=0.85, trail_seg=3, ember=1.6),
    "palm": dict(count=(7, 10), radius=(190, 270), dot=(11.0, 13.0), drag=3.0,
                 life=(2.2, 3.2), gravity=115.0, jitter=0.25,
                 trail=1.5, trail_seg=3, ember=1.0),
}
STYLE_NAMES = tuple(STYLES)


class Firework:
    """一发烟花：先发射，到顶点炸开，火花飞散、下落、变暗。"""

    ROCKET_G = 520.0        # 上升段重力（决定发射速度与上升时间）

    def __init__(self, show: "Show", style: str, palette: Palette,
                 launch: tuple, burst: tuple, rng: random.Random, *,
                 count: Optional[int] = None, radius: Optional[tuple] = None):
        self.show = show
        self.rng = rng
        self.style = style
        self.palette = palette
        self.spec = STYLES[style]
        self.x0, self.y0 = launch
        self.x1, self.y1 = burst
        self.x, self.y = launch
        self.vy = math.sqrt(max(1.0, 2 * self.ROCKET_G * (self.y1 - self.y0)))
        self.vx = (self.x1 - self.x0) / max(1e-3, self.vy / self.ROCKET_G)
        self.phase = "rise"
        self.children: list = []
        # 发射尾迹：头端白热、尾端是凉掉的红
        self.trail = Trail(show, self.x0, self.y0, width=1.7,
                           hot=mix(palette.stem, palette.core, 0.35),
                           cool=fade(palette.ray, 0.10))
        self.rocket = Rocket(show, self)
        self.children += [self.trail, self.rocket]
        show.add(self.trail)
        show.add(self.rocket)
        self.ember_acc = 0.0
        self.count = count
        self.radius = radius

    # ---- 上升 --------------------------------------------------------
    def update(self, dt: float) -> None:
        if self.phase == "rise":
            self.x += self.vx * dt
            self.y += self.vy * dt
            self.vy -= self.ROCKET_G * dt
            self.trail.push(self.x, self.y)                 # 把真实路径喂给尾迹
            self.ember_acc += dt
            if self.ember_acc > 0.07:                       # 上升时撒一点火星
                self.ember_acc = 0.0
                self.show.add(Ember(self.show, self.x, self.y - 6,
                                    self.rng.uniform(-10, 10), -self.rng.uniform(20, 60),
                                    self.palette.stem, 2.2, self.rng.uniform(0.3, 0.7)))
            if self.vy <= 0.0:
                self.y = self.y1
                self.burst()
        else:
            self.ember_acc += dt
            if self.ember_acc > 0.09:                       # 爆炸后尾巴上继续撒火星
                self.ember_acc = 0.0
                self.show.add(Ember(self.show, self.x, self.y,
                                    self.rng.uniform(-25, 25), self.rng.uniform(20, 70),
                                    self.palette.stem, 2.4, self.rng.uniform(0.5, 1.2)))

    # ---- 爆炸 --------------------------------------------------------
    def burst(self) -> None:
        self.phase = "burst"
        self.rocket.alive = False               # 弹体到此为止（尾迹不再喂点，自己熄灭）
        rng = self.rng
        spec = self.spec
        pal = self.palette
        count = self.count if self.count is not None else rng.randint(*spec["count"])
        # 画布太满就少炸几颗，别把帧率拖垮
        if self.count is None:
            count = max(6, int(round(count * self.show.density())))
        rmin, rmax = self.radius if self.radius is not None else spec["radius"]
        drag = spec["drag"]
        cx, cy = self.x, self.y
        self.show.add(Flash(self.show, cx, cy, pal, size=rng.uniform(26, 40)))

        start = rng.uniform(0, 360)
        sector = 360.0 / count
        for i in range(count):
            # 角度分层：每个火花在自己的扇区里抖动，均匀但不呆板
            ang = start + sector * (i + rng.uniform(-1, 1) * spec.get("jitter", 0.3))
            rad = rng.uniform(rmin, rmax)
            if "spread" in spec:                            # 环：半径也收窄一点
                rad = rad * rng.uniform(1 - spec["spread"], 1.0)
            th = math.radians(ang)
            speed = rad * drag                              # 阻尼模型下最终半径 ≈ v/k
            vx = math.cos(th) * speed
            vy = math.sin(th) * speed + spec.get("float_up", 0.0)   # 有些花型整体上飘
            self.show.add(Spark(
                self.show, cx, cy, vx, vy,
                color=pal.dot,
                trail_hot=mix(pal.ray, pal.core, 0.22),     # 头端偏白热
                trail_cool=fade(pal.ray, 0.18),             # 尾端凉掉
                size=rng.uniform(*spec["dot"]),
                life=rng.uniform(*spec["life"]),
                gravity=spec["gravity"] * rng.uniform(0.85, 1.15),
                drag=drag * rng.uniform(0.9, 1.1),
                trail_time=spec.get("trail", 0.0) * rng.uniform(0.9, 1.1),
                trail_seg=spec.get("trail_seg", 3),
                ember_rate=spec.get("ember", 0.0) * rng.uniform(0.6, 1.4)))

    def done(self) -> bool:
        return self.phase == "burst" and not any(c.alive for c in self.children)


# ============================================================ 整场秀

class Show:
    """管理所有元素，按固定顺序推进一帧。"""

    def __init__(self, canvas, bg: Color, width: float, height: float,
                 rng: random.Random, *, smear: bool = True, max_geos: int = 130):
        self.canvas = canvas
        self.eraser = Eraser(canvas, bg)
        self.w, self.h = width, height
        self.rng = rng
        self.smear = smear
        # 图章预算：一帧里所有元素画出的图元总数。每个图元要 stamp 一次、
        # 再被橡皮按同路径涂一次，所以 170 个图元 ≈ 每帧 680 次画布操作。
        self.max_geos = max_geos
        self.last_geos = 0
        self.elements: list = []
        self.fireworks: list = []
        self.time = 0.0
        self.next_spawn = 0.0
        self.next_finale = rng.uniform(14.0, 22.0)

    # ---- 元素 --------------------------------------------------------
    def add(self, el: Element) -> None:
        self.elements.append(el)

    def density(self) -> float:
        """画布快满了就少放几颗火星（烟花照放，只是稀一点）。"""
        if self.max_geos <= 0:
            return 1.0
        ratio = self.last_geos / self.max_geos
        if ratio < 0.55:
            return 1.0
        if ratio < 0.85:
            return 0.65
        if ratio < 1.10:
            return 0.4
        return 0.25

    def spawn(self, style: str, launch: tuple, burst: tuple, palette: Palette,
              **kw) -> Firework:
        fw = Firework(self, style, palette, launch, burst, self.rng, **kw)
        self.fireworks.append(fw)
        return fw

    def random_launch(self) -> tuple:
        """随机发射点 / 爆心。"""
        rng = self.rng
        x0 = rng.uniform(-0.42, 0.42) * self.w
        x1 = max(-0.46 * self.w, min(0.46 * self.w, x0 + rng.uniform(-0.20, 0.20) * self.w))
        y1 = rng.uniform(0.06, 0.46) * self.h          # 中上部炸开
        return (x0, -self.h / 2 - 6), (x1, y1)

    def spawn_random(self, n: int = 1) -> None:
        for _ in range(n):
            if self.last_geos > self.max_geos or len(self.elements) > 260:
                return                              # 已经画不完了，这波先不放
            style = self.rng.choice(STYLE_NAMES)
            launch, burst = self.random_launch()
            self.spawn(style, launch, burst, random_palette(self.rng))

    def classic_opening(self) -> None:
        """参考图风格的开场：左边红辐条 + 黄点，右边绿云团（几何是随机生成的）。"""
        self.spawn("spoke", (-152, -self.h / 2 - 6), (-204, 56), HALLOWEEN,
                   count=14, radius=(138, 220))
        self.spawn("cloud", (98, -self.h / 2 - 6), (226, 10), MATRIX,
                   count=38, radius=(120, 310))
        self.next_spawn = 3.2

    def original_scene(self) -> None:
        """
        **复刻原版**：完全按参考截图里量出来的坐标/颜色摆出那两发烟花，
        第一帧与参考图一致（--render --frames 1 可以直接出对比图），
        然后火花照常往外飞、下坠、变暗，画面就活起来了。
        """
        t0 = self.time
        rng = self.rng

        # ---- 左：红射线 + 黄圆点 --------------------------------------
        cx, cy = ORIGINAL_LEFT_CENTER
        for (dx, dy) in ORIGINAL_LEFT_DOTS:
            ang = math.atan2(dy - cy, dx - cx)
            rad = math.hypot(dx - cx, dy - cy)
            sp = Spark(self, dx, dy,
                       math.cos(ang) * rad * 1.2, math.sin(ang) * rad * 1.2,
                       color=ORIGINAL_YELLOW,
                       trail_hot=ORIGINAL_RAY,          # 原图里射线是均匀的纯红
                       trail_cool=ORIGINAL_RAY,
                       size=ORIGINAL_DOT_R,
                       life=rng.uniform(2.4, 3.0),
                       gravity=95.0, drag=5.0,
                       trail_time=1e9,                  # 整条射线一直保留
                       trail_seg=1,                     # 一段直线：爆心 -> 圆点
                       trail_step=1e9)                  # 中间不再采样
            # 预先把"爆心 -> 圆点"这段路径塞进轨迹，第一帧就是一条直线
            sp.track = [(cx, cy, t0), (dx, dy, t0)]
            self.add(sp)

        # ---- 右：绿圆点云团 ------------------------------------------
        bx, by = ORIGINAL_RIGHT_STEM[1]
        for (dx, dy) in ORIGINAL_RIGHT_DOTS:
            ang = math.atan2(dy - by, dx - bx)
            rad = math.hypot(dx - bx, dy - by)
            self.add(Spark(self, dx, dy,
                           math.cos(ang) * rad * 1.1, math.sin(ang) * rad * 1.1,
                           color=ORIGINAL_GREEN,
                           trail_hot=ORIGINAL_GREEN, trail_cool=ORIGINAL_GREEN,
                           size=ORIGINAL_DOT_R,
                           life=rng.uniform(2.6, 3.6),
                           gravity=70.0, drag=2.6))

        # ---- 两条发射尾迹 --------------------------------------------
        self.add(FixedLine(self, stem_segments(
            ORIGINAL_LEFT_STEM[0], ORIGINAL_LEFT_STEM[1],
            ORIGINAL_STEM_LEFT[0], ORIGINAL_STEM_LEFT[1], ORIGINAL_STEM_HALF[0]),
            life=5.5))
        self.add(FixedLine(self, stem_segments(
            ORIGINAL_RIGHT_STEM[0], ORIGINAL_RIGHT_STEM[1],
            ORIGINAL_STEM_RIGHT[0], ORIGINAL_STEM_RIGHT[1], ORIGINAL_STEM_HALF[1]),
            life=5.5))
        self.next_spawn = 5.5                       # 先静静看几秒原版

    # ---- 每帧 --------------------------------------------------------
    def step(self, dt: float) -> None:
        self.time += dt
        for f in self.fireworks:
            f.update(dt)

        for e in self.elements:                 # 1) 丢掉上一帧的所有图章
            e.discard()
        for e in self.elements:                 # 2) 物理更新（可能产生新元素）
            e.update(dt)
        for e in self.elements:                 # 3) 橡皮沿旧路径涂抹背景色
            e.erase()
        total = 0
        for e in self.elements:                 # 4) 盖上本帧图章
            geos = e.frame()
            total += len(geos)
            e.commit(geos)
        self.last_geos = total                  # 给下一帧的发数节流用

        alive = []
        for e in self.elements:
            if e.alive:
                alive.append(e)
            else:
                e.discard()                     # 临死这帧的图章也要收回
        self.elements = alive
        self.fireworks = [f for f in self.fireworks if not f.done()]

        if self.time >= self.next_finale:       # 定期来一波齐射
            self.next_finale = self.time + self.rng.uniform(18.0, 30.0)
            self.spawn_random(self.rng.randint(2, 4))
            self.next_spawn = self.time + 2.0
        elif self.time >= self.next_spawn:
            self.next_spawn = self.time + self.rng.uniform(0.9, 2.3)
            self.spawn_random(1)


# ============================================================ turtle 前端

class TurtleApp:
    """turtle 窗口 + ontimer 主循环 + 键盘控制。"""

    def __init__(self, args):
        if turtle is None:
            sys.exit("这个 Python 没有 tkinter/turtle。\n"
                     "  macOS(Homebrew):  brew install python-tk\n"
                     "  macOS(官方版):    用 /usr/local/bin/python3 或 python.org 版本\n"
                     "  仅想出一张图:     python3 turtle_fireworks.py --render still.png")
        self.args = args
        self.rng = random.Random(args.seed)
        self.screen = turtle.Screen()
        self.screen.setup(width=args.width, height=args.height)
        self.screen.title("Turtle Fireworks · seed %s · %s · 空格暂停 / r 再放一发 / Esc 退出"
                          % (args.seed, args.scene))
        self.screen.bgcolor(to_hex(BG))
        self.screen.tracer(0)
        try:
            self.screen.setundobuffer(0)        # 不需要撤销历史，省内存
        except Exception:
            pass
        register_shapes(self.screen)
        canvas = TurtleCanvas(self.screen)
        self.show = Show(canvas, BG, args.width, args.height, self.rng,
                         smear=not args.no_smear, max_geos=args.max_geos)
        self.running = True
        self.paused = False
        self.frames = 0
        self.interval = max(1, int(round(1000.0 / max(1.0, args.fps))))
        self.delay = self.interval
        self.t0 = time.perf_counter()
        self.last = self.t0

    def bind_keys(self) -> None:
        self.screen.onkeypress(self.toggle_pause, "space")
        self.screen.onkeypress(self.extra, "r")
        self.screen.onkeypress(self.stop, "Escape")
        self.screen.listen()
        # 点窗口红叉也要走干净的收尾流程，否则挂着的 ontimer 会报 TclError
        try:
            self.screen.getcanvas().winfo_toplevel().protocol(
                "WM_DELETE_WINDOW", self.stop)
        except Exception:
            pass

    def toggle_pause(self) -> None:
        self.paused = not self.paused
        self.last = time.perf_counter()          # 避免恢复时一帧跳太远

    def extra(self) -> None:
        self.show.spawn_random(1)

    def stop(self) -> None:
        if not self.running:
            return
        self.running = False
        try:
            self.screen.bye()
        except Exception:
            pass

    def run(self) -> None:
        build_show(self.show, self.args.scene)
        self.bind_keys()
        self.last = time.perf_counter()
        self.screen.ontimer(self.tick, self.delay)
        turtle.mainloop()

    def tick(self) -> None:
        if not self.running:
            return
        try:
            self._tick()
        except Exception:                       # 别让一帧的异常把窗口卡死
            import traceback
            traceback.print_exc()
            self.stop()

    def _tick(self) -> None:
        t0 = time.perf_counter()
        dt = min(0.06, max(1e-4, t0 - self.last))    # 拖窗口/暂停后不要瞬移
        self.last = t0
        if not self.paused:
            self.show.step(dt)
        self.screen.update()
        self.frames += 1
        # 按"本帧开始时刻"排下一帧，帧周期才稳定等于 interval；
        # 若按本帧结束时刻排，实际周期会变成 interval + 计算耗时。
        busy_ms = (time.perf_counter() - t0) * 1000.0
        self.delay = max(1, int(round(self.interval - busy_ms)))
        if self.args.frames and self.frames >= self.args.frames:
            self.stop()
            return
        if self.args.duration and t0 - self.t0 >= self.args.duration:
            self.stop()
            return
        self.screen.ontimer(self.tick, self.delay)


# ============================================================ 命令行

RENDER_FPS = 60.0                    # --render 的固定步长（1/60 秒一帧）


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="程序化生成的 turtle 烟花（自定义形状 + 背景色涂抹擦除 + 下落 + 变暗）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="例：python3 turtle_fireworks.py --scene original        # 原版复刻\n"
               "    python3 turtle_fireworks.py --scene random --fps 60 --seed 7\n"
               "    python3 turtle_fireworks.py --render still.png --frames 130 --seed 3\n"
               "    python3 turtle_fireworks.py --render orig.png --scene original --frames 1")
    p.add_argument("--width", type=int, default=924, help="窗口宽（默认 924，同参考图）")
    p.add_argument("--height", type=int, default=691, help="窗口高（默认 691，同参考图）")
    p.add_argument("--fps", type=float, default=30.0, help="帧率（默认 30；元素多时别调太高）")
    p.add_argument("--seed", type=int, default=None,
                   help="随机种子；不给就随机挑一个并打印出来，方便复现整场演出")
    p.add_argument("--scene", choices=("classic", "random", "original"), default="classic",
                   help="original=按截图实测坐标复刻原版那两发；classic=参考图风格开场后继续随机；"
                        "random=纯随机")
    p.add_argument("--max-geos", type=int, default=130,
                   help="每帧图元数上限（性能保护，1 个图元≈2 次画布操作）")
    p.add_argument("--no-smear", action="store_true",
                   help="关掉背景色涂抹（只用 clearstamp 擦），更快但少了'橡皮擦'演示")
    p.add_argument("--duration", type=float, default=0.0, help="跑多少秒后自动退出（0=一直跑）")
    p.add_argument("--frames", type=int, default=0,
                   help="跑多少帧后自动退出（0=一直跑）；--render 时 = 渲染第几帧（按 60fps 步长）")
    p.add_argument("--render", metavar="OUT.png",
                   help="不开窗口，直接把第 --frames 帧（默认 110）渲染成 PNG（无需 tkinter）")
    return p


def pick_seed(args) -> None:
    """没给 --seed 就随机挑一个并说出来，整场演出可以照这个号复现。"""
    if args.seed is None:
        args.seed = random.randrange(1, 1_000_000)
        print("随机种子 seed = %d   （想再看一遍同样的一场：加 --seed %d）"
              % (args.seed, args.seed))


def build_show(show: "Show", scene: str) -> None:
    if scene == "original":
        show.original_scene()
    elif scene == "classic":
        show.classic_opening()
    else:
        show.spawn_random(2)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    pick_seed(args)
    if args.render:
        frames = args.frames or 110
        rng = random.Random(args.seed)
        canvas = SoftwareCanvas(args.width, args.height, BG)
        show = Show(canvas, BG, args.width, args.height, rng,
                    smear=not args.no_smear, max_geos=args.max_geos)
        build_show(show, args.scene)
        show.step(0.0)                          # 先把初始几何画上（dt=0 不推进物理）
        for _ in range(max(0, frames - 1)):
            show.step(1.0 / RENDER_FPS)         # 离线渲染固定 60fps 步长
        canvas.save(args.render)
        print("已渲染 %d 帧 -> %s （%d 个图元）" % (frames, args.render, len(canvas.items)))
        return 0
    TurtleApp(args).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

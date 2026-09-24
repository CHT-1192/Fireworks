# 烟花 · Canvas 复刻版

[`turtle_fireworks.py`](reference/turtle_fireworks.py)（1171 行，Python + turtle）的浏览器移植。
不是"照着效果重写一版"，而是**逐位复刻**：同一个 seed，在 Python 原版与浏览器里放出的是
同一场烟花 —— 随机数序列完全相同，逐帧几何在 1e-9 容差内一致（实测最大偏差 2.3e-12），
渲染能与原版的软件光栅化逐像素对拍（亮像素 IoU 96%~99%）。

在此之上，canvas 还补上了 turtle 做不到的那部分：**尾迹是一条光滑曲线，而不是一节一节的折线**
（见下文「Canvas 增强」，且经校验不改变任何一颗火星）。

![界面](docs/preview/ui.png)
![原版复刻单帧](docs/preview/original-still.png)

## 快速开始

```bash
npm start          # 开发形态：零依赖 Node 服务器，打开 http://127.0.0.1:9240/
npm run dev        # 同上，并自动开浏览器
npm run build      # 交付形态：打出单文件版 dist/turtle_fireworks.html（双击就能放）
npm run check      # 只做体量体检：每个文件是否 ≤ 300 行
```

不需要 `npm install`：整个项目只用 Node 内置模块（`http` / `fs` / `path` / `zlib` / `vm` / `crypto`）。

## Canvas 增强：光滑尾迹（原版做不到的事）

原版的尾迹一节一节的，纯粹是 turtle 的架构限制：turtle 没有"带粗细的折线"图元，只能把真实
轨迹抽稀成 2~6 段（`trail_seg` 的注释就叫**图章预算**），每段单独盖一个矩形图章 —— 所以既看得见
接头豁口，弯道处又会折成多边形。

canvas 有 `stroke()` + `lineCap/lineJoin = 'round'`，于是一条真实轨迹可以是**一整条路径**：

* 不再抽稀到 2~6 段，而是沿**已经算好的真实轨迹点**细采样（火花 14 段、发射尾迹 48 段封顶），
  圆头圆角连成一条光滑带子，接头处由圆头补齐、没有豁口；
* 每段仍按原公式取色取宽，"越旧越暗越细"的渐变照样成立；
* 参考图那 14 条直线辐条按定义就是直线（`trail_seg=1`），不参与细采样，保持与原图一致。

![光滑尾迹 vs 原版口径](docs/preview/trails-compare.png)

（上：光滑尾迹；下：原版 2~6 段折线口径。同一 seed、同一帧，火花圆点位置完全一致。）

**关键是它不改变演出。** 原版每帧的 `last_geos`（图元数）会喂给 `density()` 决定"少炸几颗"，
一旦变了随机数消耗就跟着变。所以折线图元自带一个 `cost` 字段，声明"我在 Python 口径下算几个
图元"，预算仍按原版口径结算 —— 参数照旧、随机数照旧、每颗火星的位置/寿命/颜色照旧，只换了画法。

因此校验也升级了：增强模式下逐帧比对 **MT19937 全部 624 个状态字 + 下标**的 SHA-256 摘要
（比逐图元比对更强，任何一次 `random/randint/uniform` 的差异都会立刻暴露），400 帧 × 3 场景全等。

| 场景（400 帧内峰值） | 原版图章数 | 增强后描边段数 |
| --- | --- | --- |
| classic seed=7 | 116 | **264** |
| random seed=123456 | 214 | **616** |
| original seed=7 | 77 | 39（该场景前 5.5 秒只有直线辐条；之后随机烟花才开始有细采样尾迹） |

面板上的「光滑尾迹」可以**运行中随时开关**（只改画法不动物理），`?exact=1` 用原版口径启动。

## 复刻校验（npm run verify / npm run verify:render / npm run smoke）

| 层面 | 怎么比 | 结果 |
| --- | --- | --- |
| 随机数 | 8 个 seed × 134 次 `random/randint/uniform/choice`，与 CPython `random.Random` 逐位比 | **1072/1072 完全相同** |
| 仿真 | 同 scene/seed，固定 1/60 步长跑 400 帧，逐帧比对每个图元的形状/颜色/位置/朝向/粗细/长度 | **约 143 万项在 1e-9 容差内一致，最大偏差 2.3e-12** |
| 增强模式 | 逐帧比对 MT19937 状态摘要 + 图元预算 + 元素数，并检查"实际画出的图元数不少于原版" | **400 帧全等（RNG 精确相等）** |
| 渲染 | 原版 `--render`（软件光栅化）vs 单文件版截图（`?exact=1`），924×691 | **IoU 96.1%~99.1%，MAE 0.40~0.47 / 255** |
| 渲染路径 | Node 里用"假 canvas 上下文"跑三种场景 × 两种模式各 240 帧 | 坐标/线宽/颜色全部合法，图元无遗漏 |

```bash
npm run verify          # RNG + 精确模式逐帧 + 增强模式 RNG 状态对拍（需 python3）
npm run verify:long     # 同上，400 帧 × 多个 seed
npm run smoke           # 不需要浏览器/ python3 的渲染路径自检（假 canvas）
npm run verify:render   # smoke + 渲染对拍（需 python3 + Chrome/Chromium，可用 CHROME= 指定）
```

渲染对拍的残余差异全部来自抗锯齿实现（原版是 2× 超采样扫描线填充，canvas 是 GPU AA），
精确模式下超阈值像素占比只有 0.21%（original）/ 0.00%（classic、random），**不是构图差异**。
增强模式（默认）相对原版的 MAE 是 0.81~1.42 / 255 —— 差异只落在变光滑的那几条细尾迹上。

## 模块地图（Python → 本项目）

| turtle_fireworks.py | 本项目 | 内容 |
| --- | --- | --- |
| 颜色小工具 | `src/core.js` | `hsv / fade / mix / toHex`、`decimate`、Python 的 banker's rounding（五取偶） |
| `random.Random(seed)` | `src/rng.js` | MT19937 + CPython 的 `init_by_array` 播种、`genrand_res53`、`_randbelow` 拒绝采样 |
| 原版复刻数据 / 自定义形状 / STYLES | `src/data.js` | 截图实测坐标与颜色、18 边形圆点与单位线段、**折线图元 `pathGeo`**、花型参数表、`random_palette` |
| 可擦除的元素 / Flash / Ember / Spark | `src/elements.js` | 图元基类、爆心闪光、余烬、火星（真实轨迹尾迹） |
| Rocket / Trail / FixedLine / stem_segments | `src/trails.js` | 弹体、发射尾迹、钉死的折线 |
| `Firework` | `src/firework.js` | 发射 → 到顶点炸开；`burst()` 里 rng 取值顺序逐条对齐原版 |
| `Show` | `src/show.js` | 每帧顺序、图元预算（按 Python 口径结算 `cost`）、三个场景、齐射 |
| `TurtleCanvas` + `Eraser` | `src/view.js` | canvas 渲染器：同样的仿射变换；整屏重绘代替"橡皮涂抹"；折线用圆头描边 |
| `TurtleApp` + 命令行 | `src/app.js` | 主循环、键盘、控制台、HUD、存 PNG、URL 参数、异常兜底 |

## 与原版的差异（结构性四处 + 取舍两处）

1. **擦除方式：橡皮乌龟 → 整屏重绘。** 原版要第二只乌龟用背景色沿同一条路径涂一遍，是因为
   turtle 的图章只会叠加、不会自己消失；canvas 每帧填一次背景色再按顺序重画即可，视觉等价，
   而且省掉了原版一半的画布操作（就是 `--no-smear` 演示的那件事）。因此图元数只有原版
   `len(canvas.items)` 的一半 —— 那个数字含橡皮图章（classic 第 150 帧：原版报 216，实际 108）。
2. **尾迹画法：矩形图章 → 圆头描边折线**（见上文「Canvas 增强」，可用 `?exact=1` 回到原口径）。
3. **主循环：`ontimer` + 实测帧间隔 → 固定 1/60 步长累加器。** 原版交互模式的 `dt` 随帧率
   抖动，同一 seed 其实放不出严格相同的一场（只有 `--render` 的固定步长是确定的）；改成固定
   步长后"同 seed = 同一场"严格成立，也正好对齐原版 `--render`。单帧最多追 4 步，掉帧不雪崩。
4. **形状：`register_shape` → canvas 仿射矩阵。** 用的变换与原版 `TurtleCanvas.stamp` 完全
   相同（`px = x + sin h·X + cos h·Y`，`py = y − cos h·X + sin h·Y`），所以连 18 边形圆点的
   顶点相位都一致（不是用 `arc` 画圆）。
5. `--no-smear`、`--duration` 没有对应物：前者是 turtle 特有的取舍，后者在浏览器里用"暂停"代替。
6. Python 版需要 tkinter；本机没装，所以校验走的是原版**不需要 tkinter** 的 `--render` 路径
   （`SoftwareCanvas`，原版注释说明它与窗口里的构图一致）。另外原版 `TurtleApp.tick` 会用
   try/except 兜住单帧异常 —— canvas 里 rAF 抛的异常默认是看不见的，所以这里照样兜住并把
   错误摆到 HUD 上（这是原版有、我第一版漏掉的一处，`npm run smoke` 现在能拦住这类问题）。

## 为什么是「Node 服务器 + 多文件」，而不是单文件

原版 1171 行，单文件版会远超 300 行的体量红线，所以做成两态：

| 形态 | 命令 | 产物 |
| --- | --- | --- |
| 开发 | `npm start` | `index.html` + `src/*.js` 九个模块，由服务器按 `src/manifest.json` 的顺序注入 `<script>`，改完刷新即可（`no-store`）。默认端口 **9240**（取自参考图宽度 924，避开 Vite 的 5173 等工具链默认端口），`--port` 或 `PORT=` 可改 |
| 交付 | `npm run build` | 同一批源文件内联成一个自包含 HTML：**68.8 KB（gzip 22.6 KB）**，零外部请求，`file://` 直接跑 |

`npm run build` 会先体检体量，任何源文件超过 300 行就报错退出（`--force` 可放行）：

```
  89 行  src/core.js        140 行  src/rng.js       175 行  src/data.js
 194 行  src/elements.js    154 行  src/trails.js    141 行  src/firework.js
 196 行  src/show.js        131 行  src/view.js      275 行  src/app.js
```

## 操作与参数

| 操作 | 键 / 按钮 |
| --- | --- |
| 暂停 / 继续 | 空格 或「暂停」 |
| 追加一发 | R 或「放一发」 |
| 收起面板 | Esc 或「收起 UI」 |
| 光滑尾迹 / 原版口径 | 「光滑尾迹」勾选框（运行中随时切） |
| 按参考图实测坐标定格第 1 帧 | 「复刻单帧」 |
| 同 seed 从头再放 | 「重放本场」 |
| 导出当前画面 | 「存 PNG」 |
| 性能保护 | 「图元上限」滑块（30~300，原版 `--max-geos`） |

URL 参数：`?scene=classic|random|original&seed=7&frames=90&still=1&exact=1&ui=0&max=200&w=924&h=691`

* `frames=N` 与 `--render --frames N` 同一条路径（先 `step(0)` 再走 N−1 个 1/60 步）后定格；
  `still=1` 等价于 `frames=1`，即参考图那一帧
* `exact=1` 关掉光滑尾迹（回到原版 2~6 段折线的口径，逐像素对拍用）
* `ui=0` 隐藏全部 UI；`w` / `h` 钉死逻辑坐标系（对应原版 `--width/--height`）

| Python 命令行 | 本项目 |
| --- | --- |
| `--scene classic/random/original` | `?scene=` 或面板「场景」 |
| `--seed N` | `?seed=` 或面板「种子」（不给就随机挑一个，HUD 里显示） |
| `--max-geos N` | `?max=` 或「图元上限」 |
| `--frames N` | `?frames=N` |
| `--width/--height` | `?w=&h=`（默认铺满窗口；original 固定 924×691 等比适配） |
| `--render out.png` | 「存 PNG」按钮 |
| `--fps` | 固定 60Hz 步长，无需参数 |
| 窗口标题里的 seed | 浏览器标题栏 + HUD |

## 目录

```
index.html            页面外壳 + 控制台/HUD（单文件构建的模板）
server.js             零依赖开发服务器（按 manifest 注入模块）
build.js              npm run build：体量体检 + 打包单文件
src/                  9 个模块 + manifest.json（加载顺序）
reference/            原版 turtle_fireworks.py（只读参考，校验脚本要加载它）
tools/                verify.js（RNG/仿真/增强模式对拍）、render_smoke.js（假 canvas 自检）、
                      dump_rng.py|js、dump_geo.py|js、imgdiff.py、render_check.sh、loader.js
dist/                 npm run build 的产物：单文件版 turtle_fireworks.html
docs/preview/         预览图（无头浏览器实拍，含精确/增强尾迹对比）
```

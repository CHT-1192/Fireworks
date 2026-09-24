# 烟花 · Canvas（维护版）

浏览器 canvas 的烟花秀：程序化生成的配色、发射点、爆心、花型、寿命、尾迹全部随机。

**这一版是维护版。** 它由 `turtle_fireworks.py`（Python + turtle，1171 行）移植而来，
但原版受 turtle 的限制（没有带粗细的折线图元、只能靠图章预算硬凑）已经很难继续加东西，
**已经冻结成历史基线；新特性都加在这里**。按截图逐像素复刻的那个场景也已经删掉 ——
留下的「参考图风格」只保留原图的**配色与花型**，几何照样随机。

![界面](docs/preview/ui.png)
![尾迹](docs/preview/trails-compare.png)

## 快速开始

```bash
npm start          # 零依赖 Node 服务器，打开 http://127.0.0.1:9240/
npm run dev        # 同上，并自动开浏览器
npm run build      # 打出单文件版 dist/turtle_fireworks.html（双击就能放）
npm run verify     # 体量体检 + 渲染自检 + 行为基线（日常就这一条）
```

不需要 `npm install`：整个项目只用 Node 内置模块（`http` / `fs` / `path` / `zlib` / `vm` / `crypto`）。

| 形态 | 命令 | 产物 |
| --- | --- | --- |
| 开发 | `npm start` | `index.html` + `src/*.js` 十个模块，按 `src/manifest.json` 顺序注入 `<script>`，改完刷新即可（`no-store`；manifest 每次请求都重读，不用重启）。默认端口 **9240**（取自参考图宽度 924，避开 Vite 的 5173 等工具链默认端口），`--port` 或 `PORT=` 可改 |
| 交付 | `npm run build` | 内联成一个自包含 HTML：**68.8 KB（gzip 23.2 KB）**，零外部请求，`file://` 直接跑。构建完自检"自包含 / 无外部脚本 / 模块齐全"；产物**可复现**（不含时间戳，同样源文件字节一致，`--stamp` 才写） |

## 种子：一串密语是个彩蛋

**种子框正常只收数字**（数字种子 → 纯随机秀；同一个数字每次都是同一场，且与 CPython
`random.Random` 逐位一致）。参考图风格藏在一串**密语**后面：

* 往种子里敲字母时，**只有正好接上密语的那个字符才留得下来**；敲错了当场被弹回去，
  输入框还会抖一下。所以"一个字母一个字母试"本身就有反馈 —— 找彩蛋就是这么找的。
* 敲全的那一刻立刻解锁：开场换成参考图风格（左右两发照参考图的配色/花型），
  面板会显示「🎉 密语已解锁」。
* 密语是固定的一个词，写在 `src/app.js` 的 `SECRET` 一行里（想换彩蛋就改它，提示语里的
  字母个数会自动跟着变）。README 故意不写出来 —— 想找的话，看控制台。

启动时控制台会给引子，但**不会剧透密语本身**（只报字母个数）：

```
烟花 · Canvas 维护版
本场 seed: 7  （数字种子 → 纯随机秀）
彩蛋：种子框正常只收数字。不过有一串 6 个字母的词能打开参考图风格。
　往种子里一个字母一个字母地敲：敲对了会留下来，敲错了会被弹回来。（提示：这一版的原版，是拿它画的）
```

`?scene=classic|random` 仍可显式指定场景（覆盖种子推断），方便分享链接与调试；
`?seed=<密语>` 也认，所以解锁后可以直接把这一场分享出去。

## 尾迹：canvas 该做好的那一半

原版的尾迹一节一节的，纯粹是 turtle 的架构限制：没有"带粗细的折线"图元，只能把真实轨迹抽稀
成 2~6 段（`trail_seg` 的注释就叫**图章预算**），每段单独盖一个矩形图章。canvas 有 `stroke()`
+ `lineCap/lineJoin = 'round'`，于是一条真实轨迹就是**一整条路径**：沿已算好的真实轨迹细采样
（火花 14 段、发射尾迹 48 段封顶），圆头圆角连成光滑带子，接头由圆头补齐、没有豁口；每段仍按
原公式取色取宽，"越旧越暗越细"的渐变照旧。

![光滑尾迹 vs 原版口径](docs/preview/trails-compare.png)

（上：现在；下：原版折线口径。同一 seed 同一帧，火花圆点位置完全一致。）

图元只剩两种：**圆点**（正 18 边形，turtle 那份形状表）和**折线**。原版那个"单位矩形"图元
（`RAY`）随复刻场景一起删了 —— 折线用两段以上的点就能表达任意线段。

**每帧绘制预算**按实际开销算：折线按段数、圆点各算 1，默认 450。节流是启发式的（只影响后续
发射的火花数），所以单帧峰值会超过预算 —— 实测 400 帧内峰值 334~789。画不动就往下调滑块。

## 三层校验

维护版真正需要的不是"像不像原版"，而是**改东西时别无意中改坏别的东西**：

| 层 | 命令 | 作用 | 什么时候该失败 |
| --- | --- | --- | --- |
| **行为基线** | `npm run baseline` | 每帧指纹 = `sha256(RNG 624 状态字 + 图元流 + 预算/元素数 + 渲染绘制指令)`，4 组 × 400 帧 | 只有**你没打算改**的东西变了才失败。有意改行为就 `npm run baseline:update` 重录，并逐条 review 差异 |
| **Node 自检** | `npm run smoke` | 假 canvas 校验参数合法性 / 图元是否全被识别 / 绘制开销；另外直接构造 `App` 手动推帧，验证定格帧、固定步长、暂停、异常兜底、**种子规则与逐字符守卫**（10 收 / 6 拒） | 渲染器接不住新图元、坐标 NaN、颜色漏传、主循环或种子规则跑偏 |
| **真浏览器** | `npm run browser` | 两条路：① `file://` 打开构建产物，断言"没报错 / 画面非空 / 场景与种子规则一致 / `?ui=0` 生效"；② 开发服务器的多文件页面，比对"注入的 `<script>` 列表 == `src/manifest.json`"、**抓控制台**验证彩蛋只给提示不泄露密语，并用 `tools/typing_probe.html` 在 iframe 里**逐字符敲一遍密语**，验证"敲对留下、敲错弹回、敲全解锁" | 页面在真浏览器里跑不起来（canvas 尺寸、CSS 遮挡、脚本报错、少加载模块、彩蛋文案泄露或打字反馈失灵） |
| 跨语言随机数 | `npm run rng` | 与 CPython `random.Random` 逐位对拍（需 python3） | 有人动了 `src/rng.js` 的数字种子路径 |

基线不需要 python3、不需要浏览器，几秒跑完 —— 它是日常开发里真正会天天跑的那一层。它确实
能抓东西，实测：

```
# 改物理：spoke 的 drag 5.0 → 5.2
 FAIL  classic/seed=7   第 76 帧起行为变化 (预算 95 → 95，元素 69 → 69，线段 70 → 70)
（只有真的炸出 spoke 的那几个 seed 失败，其余照旧通过）

# 改渲染：圆头描边改成平头（物理与图元流完全没动）
 FAIL  classic/seed=7   第 7 帧起行为变化
（这一类在"只看图元流"的老口径下是发现不了的）

# 删掉复刻场景那次
  ~ original/seed=7     移除      ← 只报了这一条，classic/random 的指纹一个字节没变
```

## 新特性往哪儿加

| 想加什么 | 改哪里 | 注意 |
| --- | --- | --- |
| 新花型 / 调参数区间 | `src/data.js` 的 `STYLES`（`count/radius/dot/drag/life/gravity/jitter/trail/ember/float_up/spread`） | 加完自动进随机池；`baseline:update` |
| 新配色套路 | `src/data.js` 的 `randomPalette`；固定配色用 `Palette(...)` | 与 `show.js` 的场景配合 |
| 新图元（画法） | `data.js` 加 shape 常量 + 构造函数，`view.js` 的 `shape()` 加一个分支 | `npm run smoke` 会检查"每个图元都被识别" |
| 新元素（会动的东西） | 继承 `src/elements.js` 的 `Element`，实现 `update(dt)` / `frame()`，用 `show.add()` 注册 | 图元预算按 `data.drawnCost` 结算 |
| 换彩蛋密语 | `src/app.js` 的 `SECRET` 一行 | 大小写不敏感；提示语里的字母个数自动跟着变；`npm run smoke` / `browser` 都从那儿读，不会写死 |
| 新场景 / 改种子规则 | `src/app.js` 的 `SCENES`、`sceneForSeed()`、`seedContentOk()`；编排在 `src/show.js` | 种子哈希在 `src/rng.js` |
| UI / 交互 | `index.html` + `src/ui.js`（全部 DOM 在这：控制台、逐字符守卫、彩蛋文案） | 主循环逻辑改 `src/app.js`（不碰 DOM，可在 Node 里测） |
| 体量红线 | 每个文件 ≤ 300 行，`npm run check` 把关 | 目前最大 `src/app.js` 220 行 |

改完的固定动作：`npm run verify`（= 体检 + smoke + 基线），涉及页面就再加 `npm run build && npm run browser`。

**页面起不来时会自己说话**：`index.html` 里有一段兜底自检，1.5 秒内没创建出 App 实例就把
原因写到页面上（并列出已加载的模块）—— 一个模块都没加载完（例如直接双击未构建的
`index.html`）和入口模块没执行，以前都只表现为"空白画面 + 控制台零输出"。

## 操作与参数

| 操作 | 键 / 按钮 |
| --- | --- |
| 暂停 / 继续 | 空格 或「暂停」 |
| 追加一发 | R 或「放一发」 |
| 收起面板 | Esc 或「收起 UI」 |
| 随机换种子 | 「随机种子」（数字 → 纯随机秀） |
| 找彩蛋 | 往种子里**一个字母一个字母**试着敲（敲对留下、敲错弹回）；提示在控制台 |
| 同种子从头再放 | 「重放本场」 |
| 导出当前画面 | 「存 PNG」 |
| 性能保护 | 「图元上限」滑块（80~1500，按实际绘制开销算，默认 450） |

URL 参数：`?seed=7`、`?scene=classic|random`、`?frames=90`、`?still=1`、`?ui=0`、`?max=450`、`?w=924&h=691`

* `frames=N`：先走 N 个固定步再定格（第 1 帧 = `step(0)`，就是初始几何）；`still=1` 等价于 `frames=1`
* `scene=` 显式指定场景（覆盖"字母/数字种子"的推断）
* `ui=0` 隐藏全部 UI；`w` / `h` 钉死逻辑坐标系（构图与窗口大小无关，方便截图与复现）

## 模块地图

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `src/core.js` | 89 | `hsv / fade / mix / toHex`、`decimate`、banker's rounding |
| `src/rng.js` | 168 | MT19937 + CPython 播种（数字种子逐位一致）、文字种子 FNV-1a |
| `src/data.js` | 114 | 配色、圆点/折线图元、花型参数表 |
| `src/elements.js` | 186 | 图元基类、爆心闪光、余烬、火星（真实轨迹尾迹） |
| `src/trails.js` | 99 | 弹体、发射尾迹 |
| `src/firework.js` | 141 | 发射 → 顶点炸开 |
| `src/show.js` | 141 | 每帧顺序、绘制预算与节流、两个场景、齐射 |
| `src/view.js` | 119 | canvas 渲染器：仿射变换 + 整屏重绘 + 折线圆头描边 |
| `src/app.js` | 220 | 应用核心：状态、密语与种子规则、固定步长主循环（**不碰 DOM**） |
| `src/ui.js` | 189 | 全部 DOM：控制台、HUD、键盘、存 PNG、逐字符守卫、控制台彩蛋、启动 |

数据流：`ui.js` → `app.js`（固定步长）→ `show.js`（每帧顺序）→ `elements/trails/firework`
产出图元流 → `view.js` 画到 canvas。

## 目录

```
index.html            页面外壳 + 控制台/HUD + 兜底自检（单文件构建的模板）
server.js             零依赖开发服务器（每次请求重读 manifest 并注入模块）
build.js              npm run build：体量体检 + 打包可复现的单文件 + 产物自检
src/                  10 个模块 + manifest.json（加载顺序）
reference/            原版 turtle_fireworks.py（只读留档，无脚本依赖它）
tools/
  baseline.js|json    行为基线：录制 / 比对每帧指纹（日常主力）
  render_smoke.js     假 canvas 渲染自检 + Node 里的主循环与种子规则自检
  fake_canvas.js      假 canvas 上下文 + window/rAF 桩 + 模块加载
  browser_check.js    真浏览器端到端自检：交付产物 + 开发服务器 + 控制台彩蛋
  typing_probe.html   逐字符敲密语的测试夹具（被 browser_check 驱动，不需要 CDP）
  rng_check.js        MT19937 与 CPython 逐位对拍（需 python3）
  dump_rng.py|js      随机数序列导出（rng_check 用）
  loader.js           在 Node 里按顺序加载 src 模块
dist/                 npm run build 的产物：单文件版 turtle_fireworks.html
docs/preview/         预览图（无头浏览器实拍）
```

# 校验与维护

需要的不是"像不像原版"，而是**改东西时别无意中改坏别的东西**：

| 层 | 命令 | 作用 |
| --- | --- | --- |
| **行为基线** | `npm run baseline` | 每帧指纹 = `sha256(RNG 624 状态字 + 图元流 + 预算/元素数 + 渲染绘制指令)`，4 组 × 400 帧。不需要 python3 与浏览器，几秒跑完；只有**没打算改**的东西变了才失败，有意改就 `baseline:update` 重录 |
| **Node 自检** | `npm run smoke` | 假 canvas 校验参数合法性 / 图元是否全被识别 / 绘制开销；直接构造 `App` 手动推帧，验证定格帧、固定步长、暂停、异常兜底、种子规则与逐字符守卫（13 收 / 6 拒）；并验证**调大预算真的会让画面变密**（450 → 1400 均值/峰值都要明显上升） |
| **真浏览器** | `npm run browser` | Playwright 驱动系统 Chromium，真开页面、真打字、真按键、真下载：① `file://` 打开构建产物断言"没报错 / 标题对 / 画面非空 / 场景与种子一致 / `?ui=0` 彻底无 UI"；② 开发页比对注入的 `<script>` 列表 == manifest、控制台便条只提字母个数不写出那个词、**逐字符真敲**那个词、快捷键（滑块聚焦时 R 要能放、种子框打字时 R 不放、回车收焦点、Esc 随时有效）；③ **录制**：面板收起、下载的 WebM 用 ffprobe 读到 `SEED`、浏览器能解码；④ **交互**：点画面落点精确、每日按钮等于当天种子、剪贴板里的分享链接可用、全屏生效 |
| 跨语言随机数 | `npm run rng` | 与 CPython `random.Random` 逐位对拍（需 python3） |

基线能抓什么，实测：

```
# 改物理：spoke 的 drag 5.0 → 5.2
 FAIL  classic/seed=7   第 76 帧起行为变化 (预算 95 → 95，元素 69 → 69，线段 70 → 70)
（只有真的炸出 spoke 的那几个 seed 失败，其余照旧通过）

# 改渲染：圆头描边改成平头（物理与图元流完全没动）
 FAIL  classic/seed=7   第 7 帧起行为变化     ← 老口径看不到这一类

# 删掉复刻场景那次
  ~ original/seed=7     移除                ← 只报这一条，其它场景指纹一个字节没变
```

## 新特性往哪儿加

| 想加什么 | 改哪里 |
| --- | --- |
| 新花型 / 调参数区间 | `src/data.js` 的 `STYLES`（`count/radius/dot/drag/life/gravity/jitter/trail/ember/float_up/spread`），加完自动进随机池 |
| 新配色套路 | `src/data.js` 的 `randomPalette`；固定配色用 `Palette(...)` |
| 新图元 | `data.js` 加 shape 常量 + 构造函数，`view.js` 的 `shape()` 加一个分支（`smoke` 会检查"每个图元都被识别"） |
| 新元素 | 继承 `src/elements.js` 的 `Element`，实现 `update(dt)` / `frame()`，用 `show.add()` 注册；预算按 `data.drawnCost` 结算 |
| 换那个词 / 改种子规则 | `src/app.js` 的 `SECRET`、`seedContentOk()`、`sceneForSeed()`；哈希在 `src/rng.js` |
| 新场景编排 | `src/show.js` |
| UI / 交互 | `index.html` + `src/ui.js`（全部 DOM，含逐字符守卫与控制台便条）；主循环在 `src/app.js`（不碰 DOM，可在 Node 里测） |
| 体量红线 | 每个文件 ≤ 300 行，`npm run check` 把关；目前最大 `src/app.js` 224 行 |

改完固定动作：`npm run verify`；涉及页面再加 `npm run build && npm run browser`。

页面起不来时会自己说话：`index.html` 里有一段兜底自检，1.5 秒内没创建出 App 实例就把原因写在
页面上（并列出已加载的模块）—— 少加载一个模块以前只表现为"空白画面 + 控制台零输出"。

## 模块地图

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `src/core.js` | 89 | `hsv / fade / mix / toHex`、`decimate`、banker's rounding |
| `src/rng.js` | 178 | MT19937 + CPython 播种（数字种子逐位一致）、文字种子 FNV-1a、每日种子 |
| `src/data.js` | 114 | 配色、圆点/折线图元、花型参数表（见 [styles.md](styles.md)） |
| `src/elements.js` | 186 | 图元基类、爆心闪光、余烬、火星（真实轨迹尾迹） |
| `src/trails.js` | 99 | 弹体、发射尾迹 |
| `src/firework.js` | 141 | 发射 → 顶点炸开 |
| `src/show.js` | 177 | 每帧顺序、绘制预算（容量）与节奏、两个场景、齐射、点击落点 |
| `src/view.js` | 119 | canvas 渲染器：仿射变换 + 整屏重绘 + 折线圆头描边 |
| `src/app.js` | 254 | 应用核心：状态、种子规则、固定步长主循环（**不碰 DOM**） |
| `src/ebml.js` | 181 | WebM 容器手术：把种子写进元数据（纯函数，Node 可测） |
| `src/record.js` | 102 | 录制机制：captureStream + MediaRecorder |
| `src/actions.js` | 123 | 面板动作：存图 / 分享链接 / 全屏 / 录制 |
| `src/ui.js` | 210 | 界面本身：控制台、HUD、键盘、逐字符守卫、控制台便条、启动 |

数据流：`ui.js` / `actions.js` → `app.js`（固定步长）→ `show.js`（每帧顺序）→
`elements/trails/firework` 产出图元流 → `view.js` 画到 canvas。

## 目录

```
index.html            页面外壳 + 控制台/HUD + 兜底自检（单文件构建的模板）
favicon.svg           图标源文件（橙色系烟花，可读可改）
favicon.js            把图标压成 data URI —— 单文件版必须零外部请求，所以内联
server.js             零依赖开发服务器（每次请求重读 manifest 并注入模块）
build.js              npm run build：体量体检 + 打包可复现的单文件（顺带写 docs/index.html）
src/                  13 个模块 + manifest.json（加载顺序）
reference/            原版 turtle_fireworks.py（只读留档，无脚本依赖它）
docs/                 用法 / 校验 / 花型参数表 + preview 实拍图 +（构建出的）index.html
tools/
  pw.js               Playwright + 开发服务器的公共件（驱动系统 Chromium）
  shot.js             截图（--spam N 按 N 次 R、--step M 再推 M 帧，结果可复现）
  browser_check.js    真浏览器自检：交付产物 + 开发页 + 便条 + 打字 + 快捷键 + 录制 + 交互
  baseline.js|json    行为基线：录制 / 比对每帧指纹（日常主力）
  render_smoke.js     Node 自检：假 canvas 渲染 + 主循环 + 种子规则 + 预算
  fake_canvas.js      假 canvas 上下文 + window/rAF 桩 + 模块加载
  rng_check.js        MT19937 与 CPython 逐位对拍（需 python3）
  gen_docs.js         从源码生成 docs/styles.md
  icon_sheet.html     图标试看页（按 16/24/32/48/64 摆在浅/深标签栏上，改图标时用）
  dump_rng.py|js      随机数序列导出（rng_check 用）
  loader.js           在 Node 里按顺序加载 src 模块
```

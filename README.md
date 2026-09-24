# 烟花 · Fireworks

浏览器 canvas 的烟花秀：配色、发射点、爆心、花型、寿命、尾迹全部程序化随机。

这一版是**维护版**：它由 `turtle_fireworks.py`（Python + turtle，1171 行）移植而来，但原版受
turtle 限制（没有带粗细的折线图元，只能靠图章预算硬凑）已经很难继续加东西，冻结成历史基线；
新特性都加在这里。

![界面](docs/preview/ui.png)

（门面那张是"按住 R 打满"的样子，用
`npm run shot -- --url "?seed=7&frames=1&max=1500" --spam 16 --step 200` 截的：先冻住、
真键盘按 16 次 R、再同步推 200 帧。画面逐像素可复现，只有 HUD 里的 fps 读数会变。）

## 快速开始

```bash
npm start          # 零依赖 Node 服务器，打开 http://127.0.0.1:9240/
npm run build      # 单文件版 dist/turtle_fireworks.html（双击就能放；顺带写 docs/index.html）
npm run verify     # 体检 + Node 自检 + 行为基线（日常就这一条）

npm i              # 只有"浏览器级自检 / 截图"才需要：playwright-core
npm run browser    # 真浏览器端到端自检（Playwright 驱动**系统已装的** Chromium）
```

应用本身（服务器、构建、Node 自检）只用 Node 内置模块，**不需要 npm install**；只有
`npm run browser` / `npm run shot` 需要 `playwright-core`，它驱动系统已装的 Chrome/Chromium
（`CHROME=` 可指定路径），**不下载浏览器**。（本机 `~/.npm` 不可写时：`npm i --cache ./.npm-cache`。）

| 形态 | 命令 | 产物 |
| --- | --- | --- |
| 开发 | `npm start` | `index.html` + `src/*.js` 十三个模块，按 `src/manifest.json` 顺序注入（manifest 每次请求都重读，不用重启）。端口 9240，`--port` 可改 |
| 交付 | `npm run build` | 一个自包含 HTML：**94.0 KB（gzip 31.7 KB）**（含内联的 SVG 图标），零外部请求，`file://` 直接跑。构建后自检"自包含 / 无外部脚本 / 模块齐全"；产物可复现（不含时间戳，`--stamp` 才写） |

## 种子

**种子框只收数字**：数字种子 → 纯随机秀，同一个数字每次都是同一场，且与 CPython
`random.Random` 逐位一致（`npm run rng` 守着这条）。

还有一个词是例外。往种子里敲字母时，**只有正好接上那个词的一个字符才留得下来**，敲错了当场
被弹回去（输入框会抖一下）—— 所以"一个一个字母试"本身就有反馈。拼全的那一刻，开场换成
参考图风格：左右两发照参考图的配色与花型。

那个词写在 `src/app.js` 的 `SECRET` 一行里，换掉它提示里的字母个数会自动跟着变。
`?scene=classic|random` 可显式指定场景（覆盖推断），`?seed=<那个词>` 也认，方便分享。

## 尾迹

原版的尾迹一节一节的，纯粹是 turtle 的限制：没有"带粗细的折线"图元，只能把真实轨迹抽稀成
2~6 段（`trail_seg` 的注释就叫**图章预算**），每段单独盖一个矩形图章。canvas 有 `stroke()` +
圆头圆角，于是一条真实轨迹就是**一整条路径**：沿已算好的真实轨迹细采样（火花 14 段、发射尾迹
48 段封顶），连成光滑带子，接头由圆头补齐、没有豁口；每段仍按原公式取色取宽，"越旧越暗越细"
的渐变照旧。

![光滑尾迹 vs 原版折线](docs/preview/trails-compare.png)

（上：现在的圆头描边；下：当年 turtle 口径的 2~6 段折线。同一 seed 同一帧，火花圆点位置
完全一致 —— 这张对比图是当年切换画法时留下的。）

图元只剩两种：**圆点**（正 18 边形，turtle 那份形状表）和**折线**。

### 绘制预算

每帧的绘制预算按**实际开销**算：折线按段数、圆点各算 1，默认 450（面板上的「绘制预算」）。
预算是**画面容量**，不是硬上限 —— 空着就多发、每发更大，满了就少发、每发更小（同时作用于
"每发多少颗"和"多久放一发"）：450 → 图元均值 68 / 峰值 206；900 → 113 / 286；
1400 → 173 / 567（random 场景 60 秒实测）。节流是启发式的，单帧峰值会超过预算
（实测约 1.2~2 倍，齐射是瞬时的），HUD 的「预算」一行就是 `上一帧 / 上限`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/usage.md](docs/usage.md) | 每个按钮与快捷键、URL 参数、录制与分享、GitHub Pages 托管 |
| [docs/checks.md](docs/checks.md) | 三层校验（行为基线 / Node 自检 / 真浏览器）、实测证据、模块地图与目录 |
| [docs/styles.md](docs/styles.md) | 花型参数表（`npm run docs` 从源码生成，含"怎么加一个花型"） |

新特性往哪儿加、改完跑什么，见 [docs/checks.md](docs/checks.md)。

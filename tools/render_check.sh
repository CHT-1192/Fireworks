#!/usr/bin/env bash
# ============================================================================
# render_check.sh —— 渲染对拍：原版 Python 软件光栅化 vs 浏览器 canvas
# ---------------------------------------------------------------------------
# 对同一 scene/seed/帧做两次截图：
#   ?exact=1  用原版口径（2~6 段折线）渲染 —— 与原版逐像素对拍，判定构图一致
#   默认      光滑尾迹（细采样 + 圆头描边）—— 仅参考，报出"画得更细"带来的偏差
# 需要：python3、一个 Chrome/Chromium（用 CHROME 指定路径）、node。
# 用法：npm run verify:render      （或 bash tools/render_check.sh）
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Chromium.app/Contents/MacOS/Chromium}"
PORT="${PORT:-9240}"           # 与 server.js 的默认端口一致（不是 Vite 的 5173）
BASE="http://127.0.0.1:${PORT}"
W=924
H=691
OUT="$ROOT/.tmp/render"
PROFILE="$ROOT/.tmp/render_profile"

if [ ! -x "$CHROME" ]; then
  echo "找不到浏览器：$CHROME" >&2
  echo "用 CHROME=/path/to/Chromium npm run verify:render 指定。" >&2
  exit 1
fi

mkdir -p "$OUT" "$PROFILE"

# ---- 开发服务器：没在跑就自己起一个 ----
STARTED=0
if ! curl -sf -o /dev/null "$BASE/src/manifest.json"; then
  ( cd "$ROOT" && node server.js --port "$PORT" >"$OUT/server.log" 2>&1 ) &
  SERVER_PID=$!
  STARTED=1
  for _ in $(seq 1 30); do curl -sf -o /dev/null "$BASE/src/manifest.json" && break; sleep 0.3; done
fi

cleanup() {
  pkill -f "user-data-dir=$PROFILE" 2>/dev/null || true
  if [ "$STARTED" = 1 ]; then kill "${SERVER_PID:-0}" 2>/dev/null || true; fi
}
trap cleanup EXIT

shot() {                                   # shot <url> <png>
  rm -f "$2"
  "$CHROME" --headless=new --no-sandbox --disable-gpu-sandbox --disable-dev-shm-usage \
    --no-first-run --user-data-dir="$PROFILE" --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="${W},${H}" \
    --virtual-time-budget=6000 --screenshot="$2" "$1" >/dev/null 2>&1 &
  local pid=$!
  for _ in $(seq 1 80); do [ -s "$2" ] && break; sleep 0.5; done
  sleep 1
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  pkill -f "user-data-dir=$PROFILE" 2>/dev/null || true
}

FAIL=0
check() {                                  # check <name> <scene> <seed> <frames> <extra-query>
  local name="$1" scene="$2" seed="$3" frames="$4" extra="$5"
  local py="$OUT/py_${name}.png"
  local url="$BASE/dist/turtle_fireworks.html?scene=$scene&seed=$seed&frames=$frames&w=$W&h=$H&ui=0$extra"

  echo
  echo "── $name（scene=$scene seed=$seed frames=$frames）"
  python3 "$ROOT/reference/turtle_fireworks.py" --render "$py" --scene "$scene" \
    --seed "$seed" --frames "$frames" --width "$W" --height "$H" >/dev/null

  echo "[精确模式 ?exact=1 —— 与原版逐像素对拍]"
  shot "$url&exact=1" "$OUT/js_${name}_exact.png"
  python3 "$ROOT/tools/imgdiff.py" "$py" "$OUT/js_${name}_exact.png" || FAIL=1

  echo "[光滑尾迹（默认）—— 仅参考：看增强相对原版的偏差]"
  shot "$url" "$OUT/js_${name}_dense.png"
  python3 "$ROOT/tools/imgdiff.py" "$py" "$OUT/js_${name}_dense.png" || true
}

echo "渲染对拍（原版 --render  vs  单文件版浏览器 canvas）"
check original original 7 1 "&still=1"
check classic  classic  7 150 ""
check random   random   42 150 ""

echo
if [ "$FAIL" = 0 ]; then echo "结论：精确模式与原版构图一致 ✓"; else echo "结论：有偏差 ✗"; fi
exit "$FAIL"

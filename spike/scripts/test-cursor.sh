#!/usr/bin/env bash
# Phase 0 Step 4: Cursor CLI (cursor-agent) 验证脚本

set -uo pipefail

SPIKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$SPIKE_DIR/outputs"
mkdir -p "$OUT_DIR"

WORK_DIR="$(mktemp -d -t openspace-spike-cursor-XXXX)"
trap "rm -rf '$WORK_DIR'" EXIT

CURSOR_BIN="cursor-agent"

echo "=== Cursor CLI Spike Tests ==="
echo "Working dir: $WORK_DIR"
echo "Output dir:  $OUT_DIR"
echo "Binary:      $CURSOR_BIN"
echo ""

run_with_timeout() {
  local timeout=$1; shift
  local pid
  "$@" &
  pid=$!
  (
    sleep "$timeout"
    kill -0 "$pid" 2>/dev/null && kill "$pid" 2>/dev/null
  ) &
  local watcher=$!
  wait "$pid" 2>/dev/null
  local rc=$?
  kill "$watcher" 2>/dev/null
  return $rc
}

# ---------- Test 4.1: 基础 stream-json 输出 ----------
echo "[4.1] Basic stream-json output..."
START=$(date +%s)
$CURSOR_BIN -p --output-format stream-json \
  --workspace "$WORK_DIR" --trust \
  "用中文回复一段简短的自我介绍，不超过50字" \
  > "$OUT_DIR/cursor-basic.ndjson" 2> "$OUT_DIR/cursor-basic.stderr" || echo "(exited non-zero)"
END=$(date +%s)
echo "  Duration: $((END - START))s"
echo "  Lines: $(wc -l < "$OUT_DIR/cursor-basic.ndjson")"
echo "  Unique 'type' values:"
jq -r '.type' "$OUT_DIR/cursor-basic.ndjson" 2>/dev/null | sort -u | sed 's/^/    /'
echo "  Unique 'subtype' values:"
jq -r '.subtype // empty' "$OUT_DIR/cursor-basic.ndjson" 2>/dev/null | sort -u | sed 's/^/    /'
echo ""

# ---------- Test 4.2: 增量输出 (stream-partial-output) ----------
echo "[4.2] Partial output (text delta)..."
$CURSOR_BIN -p --output-format stream-json --stream-partial-output \
  --workspace "$WORK_DIR" --trust \
  "用中文写一段 100 字的项目介绍，介绍 OpenSpace（一个本地 AI Agent 协作平台）" \
  > "$OUT_DIR/cursor-stream.ndjson" 2> "$OUT_DIR/cursor-stream.stderr" || echo "(exited non-zero)"
echo "  Lines: $(wc -l < "$OUT_DIR/cursor-stream.ndjson")"
# 检查是否有 delta 类型的事件
DELTA_COUNT=$(grep -c 'delta\|partial\|chunk' "$OUT_DIR/cursor-stream.ndjson" 2>/dev/null || echo 0)
echo "  Delta-like lines: $DELTA_COUNT"
echo ""

# ---------- Test 4.3: 工作目录 + 工具调用 ----------
echo "[4.3] Working directory + shell tool..."
echo "hello" > "$WORK_DIR/a.txt"
echo "world" > "$WORK_DIR/b.md"

$CURSOR_BIN -p --output-format stream-json \
  --workspace "$WORK_DIR" --trust -f \
  "列出当前目录下的所有文件" \
  > "$OUT_DIR/cursor-tool.ndjson" 2> "$OUT_DIR/cursor-tool.stderr" || echo "(exited non-zero)"
echo "  Lines: $(wc -l < "$OUT_DIR/cursor-tool.ndjson")"
# 检查 tool_call 事件
jq -c 'select(.type == "tool_call")' "$OUT_DIR/cursor-tool.ndjson" 2>/dev/null | head -3 | sed 's/^/    /'
echo ""

# ---------- Test 4.4: stdin 上下文注入 ----------
echo "[4.4] Context injection via stdin..."
printf '%s\n' \
  "以下是历史对话:" \
  "[User] 我们在开发一个聊天应用" \
  "[Assistant] 好的，需要什么帮助？" \
  "---" \
  "请基于以上上下文回答：这个项目是什么？" | \
$CURSOR_BIN -p --output-format stream-json \
  --workspace "$WORK_DIR" --trust \
  > "$OUT_DIR/cursor-context.ndjson" 2> "$OUT_DIR/cursor-context.stderr" || echo "(exited non-zero)"
echo "  Lines: $(wc -l < "$OUT_DIR/cursor-context.ndjson")"
if grep -q "聊天应用\|chat" "$OUT_DIR/cursor-context.ndjson"; then
  echo "  ✓ Context acknowledged"
else
  echo "  ⚠ Context may not have been received via stdin"
fi
echo ""

# ---------- Test 4.5: 指定模型 ----------
echo "[4.5] Specify model (composer-2-fast)..."
$CURSOR_BIN -p --output-format stream-json \
  --workspace "$WORK_DIR" --trust \
  --model composer-2-fast \
  "say: model test ok" \
  > "$OUT_DIR/cursor-model.ndjson" 2> "$OUT_DIR/cursor-model.stderr" || echo "(exited non-zero)"
echo "  Lines: $(wc -l < "$OUT_DIR/cursor-model.ndjson")"
echo ""

echo "=== Done ==="
echo "Inspect outputs:"
ls -la "$OUT_DIR" | grep cursor | sed 's/^/  /'

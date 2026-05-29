#!/usr/bin/env bash
# Phase 0 Step 2: Codex CLI 验证脚本
# 将各个子测试的 JSONL 输出保存到 spike/outputs/

set -uo pipefail

SPIKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$SPIKE_DIR/outputs"
mkdir -p "$OUT_DIR"

# 使用一个临时工作目录，避免污染项目目录
WORK_DIR="$(mktemp -d -t openspace-spike-codex-XXXX)"
trap "rm -rf '$WORK_DIR'" EXIT

echo "=== Codex CLI Spike Tests ==="
echo "Working dir: $WORK_DIR"
echo "Output dir:  $OUT_DIR"
echo ""

# ---------- Test 2.1: 基础 JSONL 输出 ----------
echo "[2.1] Basic JSONL output..."
START=$(date +%s)
codex exec --json --ephemeral --skip-git-repo-check -C "$WORK_DIR" \
  "用中文回复一段简短的自我介绍，不超过50字" \
  < /dev/null \
  > "$OUT_DIR/codex-basic.jsonl" 2> "$OUT_DIR/codex-basic.stderr" || echo "(exited non-zero)"
END=$(date +%s)
echo "  Duration: $((END - START))s"
echo "  Lines: $(wc -l < "$OUT_DIR/codex-basic.jsonl")"
echo "  Unique 'type' values:"
jq -r '.type // .msg.type // "?"' "$OUT_DIR/codex-basic.jsonl" 2>/dev/null | sort -u | head -20 | sed 's/^/    /'
echo ""

# ---------- Test 2.2: 工作目录 + Sandbox ----------
echo "[2.2] Working directory + sandbox..."
# 在 WORK_DIR 放点文件给 Codex 列出
echo "hello" > "$WORK_DIR/a.txt"
echo "world" > "$WORK_DIR/b.md"

codex exec --json --ephemeral --skip-git-repo-check \
  -C "$WORK_DIR" \
  -s workspace-write \
  --dangerously-bypass-approvals-and-sandbox \
  "列出当前目录下的所有文件并告诉我文件名" \
  < /dev/null \
  > "$OUT_DIR/codex-workdir.jsonl" 2> "$OUT_DIR/codex-workdir.stderr" || echo "(exited non-zero)"
echo "  Lines: $(wc -l < "$OUT_DIR/codex-workdir.jsonl")"
echo "  Detected tool-call-ish events:"
jq -c 'select((.msg.type // .type // "" | tostring | test("exec_command|tool|shell"; "i")))' "$OUT_DIR/codex-workdir.jsonl" 2>/dev/null | head -3 | sed 's/^/    /'
echo ""

# ---------- Test 2.3: stdin 上下文注入 ----------
echo "[2.3] Context injection via stdin..."
printf '%s\n' \
  "以下是历史对话:" \
  "[User] 我们在开发一个聊天应用" \
  "[Assistant] 好的，需要什么帮助？" \
  "---" \
  "请基于以上上下文回答：这个项目是什么？" | \
codex exec --json --ephemeral --skip-git-repo-check -C "$WORK_DIR" - \
  > "$OUT_DIR/codex-context.jsonl" 2> "$OUT_DIR/codex-context.stderr" || echo "(exited non-zero)"
echo "  Lines: $(wc -l < "$OUT_DIR/codex-context.jsonl")"
# 检查模型是否引用到"聊天应用"
if grep -q "聊天应用\|chat" "$OUT_DIR/codex-context.jsonl"; then
  echo "  ✓ Context acknowledged"
else
  echo "  ⚠ Context may not have been received"
fi
echo ""

# ---------- Test 2.4: 环境变量注入 ----------
echo "[2.4] Environment variable injection..."
OPENSPACE_SPIKE_VAR="spike_test_42" \
codex exec --json --ephemeral --skip-git-repo-check \
  -C "$WORK_DIR" -s workspace-write \
  --dangerously-bypass-approvals-and-sandbox \
  "读取环境变量 OPENSPACE_SPIKE_VAR 的值并告诉我" \
  < /dev/null \
  > "$OUT_DIR/codex-env.jsonl" 2> "$OUT_DIR/codex-env.stderr" || echo "(exited non-zero)"
if grep -q "spike_test_42" "$OUT_DIR/codex-env.jsonl"; then
  echo "  ✓ Env var visible to agent"
else
  echo "  ⚠ Env var may not be propagated"
fi
echo ""

echo "=== Done ==="
echo "Inspect outputs:"
ls -la "$OUT_DIR" | sed 's/^/  /'

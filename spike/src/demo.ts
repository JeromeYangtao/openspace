/**
 * Phase 0 Spike Demo: 端到端验证三个适配器 + 统一 Runner
 *
 * 用法:
 *   npx tsx spike/src/demo.ts codex "用中文做一段自我介绍"
 *   npx tsx spike/src/demo.ts cursor "用中文做一段自我介绍"
 *   npx tsx spike/src/demo.ts claude "..."   # 仅占位，需要 Claude Code 安装
 *
 * 期望输出:
 *   - 实时打印每个 CLIEvent 的精简视图
 *   - 最终打印完整回复文本与统计信息
 */

import { CodexAdapter } from './codex-adapter.js';
import { CursorAdapter } from './cursor-adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { runCLI } from './runner.js';
import type { CLIAdapter, CLIEvent } from './types.js';

const ADAPTERS: Record<string, () => CLIAdapter> = {
  codex: () => new CodexAdapter(),
  cursor: () => new CursorAdapter(),
  claude: () => new ClaudeAdapter(),
};

async function main() {
  const [, , name, ...rest] = process.argv;
  const prompt = rest.join(' ') || '用中文回复一段简短的自我介绍，不超过50字';

  if (!name || !ADAPTERS[name]) {
    console.error(`Usage: npx tsx spike/src/demo.ts <codex|cursor|claude> [prompt]`);
    process.exit(1);
  }

  const adapter = ADAPTERS[name]();
  const check = await adapter.checkInstallation();

  console.log(`╔═══════════════════════════════════════════════════════════`);
  console.log(`║ OpenSpace CLI Spike Demo — ${adapter.name.toUpperCase()}`);
  console.log(`╠═══════════════════════════════════════════════════════════`);
  console.log(`║ Installed: ${check.installed}`);
  if (check.version) console.log(`║ Version:   ${check.version}`);
  if (check.path)    console.log(`║ Path:      ${check.path}`);
  if (check.error)   console.log(`║ Error:     ${check.error}`);
  console.log(`║ Prompt:    ${prompt}`);
  console.log(`║ Capabilities:`);
  for (const [key, val] of Object.entries(adapter.capabilities)) {
    console.log(`║   ${key.padEnd(26)} = ${val}`);
  }
  console.log(`╚═══════════════════════════════════════════════════════════`);
  console.log();

  if (!check.installed) {
    console.log(`[skipped] ${adapter.name} not installed`);
    process.exit(0);
  }

  const models = await adapter.getSupportedModels().catch(() => []);
  console.log(`Supported models: ${models.slice(0, 5).join(', ')}${models.length > 5 ? ', ...' : ''}`);
  console.log();

  const spec = adapter.buildCommand({
    prompt,
    permissive: true,
  });

  console.log(`> Spawning: ${spec.command} ${spec.args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`);
  console.log();

  const startTime = Date.now();
  let firstTokenAt: number | null = null;

  const result = await runCLI(adapter, spec, {
    timeoutMs: 120_000,
    onEvent: (ev: CLIEvent) => {
      if (firstTokenAt === null && (ev.type === 'text.delta' || ev.type === 'text.completed')) {
        firstTokenAt = Date.now();
      }
      printEvent(ev);
    },
    onStderr: (line) => {
      // Codex 会打一行 "Reading additional input from stdin..." 到 stderr，过滤掉
      if (line.includes('Reading additional input')) return;
      if (line.includes('ERROR')) console.error(`  [stderr] ${line}`);
    },
  });

  console.log();
  console.log(`╔═══════════════════════════════════════════════════════════`);
  console.log(`║ Summary`);
  console.log(`╠═══════════════════════════════════════════════════════════`);
  console.log(`║ Exit code:           ${result.exitCode}`);
  console.log(`║ Total duration:      ${result.duration_ms}ms`);
  if (firstTokenAt) {
    console.log(`║ First token latency: ${firstTokenAt - startTime}ms`);
  }
  console.log(`║ Timed out:           ${result.timedOut}`);
  console.log(`║ Total events:        ${result.events.length}`);
  console.log(`║ Full text length:    ${result.fullText.length} chars`);
  console.log(`╚═══════════════════════════════════════════════════════════`);
  console.log();
  console.log(`Full text:`);
  console.log(result.fullText);
  console.log();
  console.log(`Event type distribution:`);
  const dist: Record<string, number> = {};
  for (const ev of result.events) dist[ev.type] = (dist[ev.type] ?? 0) + 1;
  for (const [t, c] of Object.entries(dist).sort()) {
    console.log(`  ${t.padEnd(24)} × ${c}`);
  }

  process.exit(result.exitCode ?? 0);
}

function printEvent(ev: CLIEvent) {
  switch (ev.type) {
    case 'session.started':
      console.log(`  ▶ session.started       ${ev.session_id}`);
      break;
    case 'session.completed':
      console.log(`  ✓ session.completed     usage=${JSON.stringify(ev.usage ?? {})}`);
      break;
    case 'thinking.delta':
      process.stdout.write(`\x1b[90m${ev.text}\x1b[0m`);
      break;
    case 'thinking.completed':
      console.log(`\n  · thinking.completed`);
      break;
    case 'text.delta':
      process.stdout.write(ev.text);
      break;
    case 'text.completed':
      console.log(); // flush line if deltas were written
      console.log(`  █ text.completed       (${ev.text.length} chars)`);
      break;
    case 'tool.started':
      console.log(`  → tool.started   ${ev.tool.padEnd(8)} ${JSON.stringify(ev.args).slice(0, 120)}`);
      break;
    case 'tool.completed':
      console.log(`  ← tool.completed ${ev.tool.padEnd(8)} success=${ev.success} exit=${ev.exit_code ?? '?'}`);
      break;
    case 'error':
      console.log(`  ✗ error                 ${ev.code ?? ''}: ${ev.message}`);
      break;
  }
}

main().catch((e) => {
  console.error('Demo failed:', e);
  process.exit(1);
});

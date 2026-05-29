/**
 * Phase 0 Step 6: 性能基线采集
 *
 * 运行 5 个场景 × N 次 取平均，输出表格到 spike/outputs/baseline.json
 *
 * 指标:
 *   - first_token_ms: spawn 后到第一个 text/thinking 事件
 *   - total_ms: spawn 到进程退出
 *   - events_count: 总事件数
 */

import { writeFileSync } from 'node:fs';
import { CodexAdapter } from './codex-adapter.js';
import { CursorAdapter } from './cursor-adapter.js';
import { runCLI } from './runner.js';
import type { CLIAdapter, CLIEvent } from './types.js';

interface Sample {
  first_token_ms: number | null;
  total_ms: number;
  events_count: number;
  full_text_len: number;
  exit_code: number | null;
  timed_out: boolean;
}

async function runOne(
  adapter: CLIAdapter,
  prompt: string,
  stdinContext?: string,
): Promise<Sample> {
  const start = Date.now();
  let firstTokenAt: number | null = null;

  const spec = adapter.buildCommand({ prompt, stdinContext, permissive: true });

  const result = await runCLI(adapter, spec, {
    timeoutMs: 120_000,
    onEvent: (ev: CLIEvent) => {
      if (
        firstTokenAt === null &&
        (ev.type === 'text.delta' ||
          ev.type === 'text.completed' ||
          ev.type === 'thinking.delta')
      ) {
        firstTokenAt = Date.now();
      }
    },
  });

  return {
    first_token_ms: firstTokenAt ? firstTokenAt - start : null,
    total_ms: result.duration_ms,
    events_count: result.events.length,
    full_text_len: result.fullText.length,
    exit_code: result.exitCode,
    timed_out: result.timedOut,
  };
}

async function runScenario(
  label: string,
  adapter: CLIAdapter,
  prompt: string,
  repeats: number,
  stdinContext?: string,
): Promise<{ label: string; runtime: string; samples: Sample[] }> {
  console.log(`\n▶ ${adapter.name}  |  ${label}  (×${repeats})`);
  const samples: Sample[] = [];
  for (let i = 0; i < repeats; i++) {
    process.stdout.write(`    run ${i + 1}/${repeats}... `);
    const s = await runOne(adapter, prompt, stdinContext);
    console.log(
      `first=${s.first_token_ms ?? '-'}ms total=${s.total_ms}ms events=${s.events_count}`,
    );
    samples.push(s);
  }
  return { label, runtime: adapter.name, samples };
}

function stats(samples: Sample[], key: 'first_token_ms' | 'total_ms'): {
  avg: number | null;
  min: number | null;
  max: number | null;
} {
  const vals = samples.map((s) => s[key]).filter((v): v is number => v !== null);
  if (!vals.length) return { avg: null, min: null, max: null };
  return {
    avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}

async function main() {
  const repeats = parseInt(process.argv[2] ?? '2', 10);

  const codex = new CodexAdapter();
  const cursor = new CursorAdapter();

  const scenarios = [
    {
      name: 'simple-short',
      prompt: '用一句话中文回答：1+1 等于几？',
    },
    {
      name: 'with-context-4k',
      prompt: '根据上述对话历史，告诉我主题是什么',
      stdinContext: '以下是历史对话:\n' + '[User] 我们在讨论天气\n[Assistant] 今天很晴朗\n'.repeat(40),
    },
    {
      name: 'medium-reply',
      prompt: '用中文回复一段 50 字的自我介绍',
    },
  ];

  const results: Array<Awaited<ReturnType<typeof runScenario>>> = [];

  for (const adapter of [codex, cursor]) {
    const check = await adapter.checkInstallation();
    if (!check.installed) {
      console.log(`\n⚠ Skipping ${adapter.name}: not installed`);
      continue;
    }

    for (const sc of scenarios) {
      const r = await runScenario(sc.name, adapter, sc.prompt, repeats, sc.stdinContext);
      results.push(r);
    }
  }

  // 汇总表格
  console.log('\n\n════════════════════════ BASELINE SUMMARY ════════════════════════');
  console.log('runtime          scenario              first(avg/min/max) ms    total(avg/min/max) ms');
  console.log('─'.repeat(95));
  for (const r of results) {
    const ft = stats(r.samples, 'first_token_ms');
    const to = stats(r.samples, 'total_ms');
    console.log(
      `${r.runtime.padEnd(16)} ${r.label.padEnd(22)} ${String(ft.avg ?? '-').padStart(5)}/${String(ft.min ?? '-').padStart(5)}/${String(ft.max ?? '-').padStart(5)}           ${String(to.avg).padStart(5)}/${String(to.min).padStart(5)}/${String(to.max).padStart(5)}`,
    );
  }

  const outPath = new URL('../outputs/baseline.json', import.meta.url);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: {
          repeats,
          timestamp: new Date().toISOString(),
          machine: {
            os: process.platform,
            arch: process.arch,
            node: process.version,
          },
        },
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nSaved baseline to ${outPath.pathname}`);
}

main().catch((e) => {
  console.error('Baseline failed:', e);
  process.exit(1);
});

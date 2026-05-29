/**
 * CLIRunner: 统一进程运行器（spike 原型）
 *
 * 职责：
 * - 按 SpawnSpec 启动子进程
 * - 按行解析 stdout 为 CLIEvent 流
 * - 超时控制（D-5: 默认 300s）
 * - 聚合完整文本
 * - 捕获 stderr 便于诊断
 *
 * 对上层隐藏 child_process 细节，提供 Promise-based API。
 */

import { spawn } from 'node:child_process';
import type { CLIAdapter, CLIEvent, RunnerOptions, RunnerResult, SpawnSpec } from './types.js';

const DEFAULT_TIMEOUT_MS = 300_000;

export async function runCLI(
  adapter: CLIAdapter,
  spec: SpawnSpec,
  options: RunnerOptions = {},
): Promise<RunnerResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  return new Promise((resolve) => {
    const events: CLIEvent[] = [];
    let fullText = '';
    let stdoutBuf = '';
    let stderrBuf = '';
    let timedOut = false;

    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 超时 watcher
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // 2s 后强杀
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, 2000);
    }, timeoutMs);

    // stdin
    if (spec.stdin !== undefined) {
      child.stdin?.write(spec.stdin);
    }
    child.stdin?.end();

    // 按行切分 stdout
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      let idx: number;
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        processLine(line);
      }
    });

    let deltaBuffer = '';
    let completedBuffer = '';

    function processLine(line: string) {
      if (!line.trim()) return;
      options.onRawLine?.(line);
      const parsed = adapter.parseLine(line);
      for (const event of parsed) {
        events.push(event);
        // 文本聚合策略（按 adapter 能力区分）：
        //   supportsTextDelta=true（Cursor）：
        //     delta 持续累加；text.completed 是最终权威 replay → 覆盖 fullText
        //   supportsTextDelta=false（Codex）：
        //     无 delta；每个 text.completed 是独立 agent_message → 拼接
        if (event.type === 'text.delta') {
          deltaBuffer += event.text;
          fullText = deltaBuffer;
        }
        if (event.type === 'text.completed') {
          if (adapter.capabilities.supportsTextDelta) {
            fullText = event.text; // Cursor: 覆盖
          } else {
            completedBuffer += (completedBuffer ? '\n\n' : '') + event.text;
            fullText = completedBuffer; // Codex: 拼接多条 agent_message
          }
        }
        options.onEvent?.(event);
      }
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      stderrBuf += s;
      for (const line of s.split('\n')) {
        if (line.trim()) options.onStderr?.(line);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      const errEvent: CLIEvent = {
        type: 'error',
        message: err.message,
        code: 'spawn_error',
      };
      events.push(errEvent);
      options.onEvent?.(errEvent);
      resolve({
        exitCode: null,
        fullText,
        events,
        duration_ms: Date.now() - start,
        timedOut: false,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      // 处理 stdout 残留
      if (stdoutBuf.trim()) processLine(stdoutBuf);

      // 如果没有 text.completed 但有 text.delta 累积，合成一个 completed
      if (deltaBuffer && !events.some((e) => e.type === 'text.completed')) {
        const ev: CLIEvent = { type: 'text.completed', text: deltaBuffer };
        events.push(ev);
        fullText = deltaBuffer;
        options.onEvent?.(ev);
      }

      if (timedOut) {
        const ev: CLIEvent = {
          type: 'error',
          message: `Process timed out after ${timeoutMs}ms`,
          code: 'timeout',
        };
        events.push(ev);
        options.onEvent?.(ev);
      }

      resolve({
        exitCode: code,
        fullText: fullText || extractLastText(events),
        events,
        duration_ms: Date.now() - start,
        timedOut,
      });
    });
  });
}

function extractLastText(events: CLIEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'text.completed') return ev.text;
  }
  return '';
}
